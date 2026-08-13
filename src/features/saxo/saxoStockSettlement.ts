import { normalizeTicker } from "@/lib/marketData";
import type { StockSettlement, StockTransferEvent, TradeSimulation, WheelCycle } from "@/types/domain";
import { getStockSettlementHistoryKeys, normalizeStockSettlement } from "@/domain/stockSettlementState";
import { getSaxoHistoryStableKey, resolveSaxoHistoryUnderlyingSymbol, type SaxoHistoryDiscoveryItem } from "./saxoAccountSync";

export type SaxoStockSettlementTargetResult = {
  simulation?: TradeSimulation;
  errorMessage?: string;
};

export type SaxoStockSettlementDraftResult = {
  settlement?: StockSettlement;
  errorMessage?: string;
};

function roundUsdCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function normalizeSaxoStockSettlementTicker(value?: string): string {
  if (!value) return "";
  const normalized = value.trim().toUpperCase();
  const saxoOptionMatch = normalized.match(/^([A-Z.]+)\//);
  if (saxoOptionMatch?.[1]) return saxoOptionMatch[1];
  if (/NVIDIA|NVIDIA CORP/i.test(normalized)) return "NVDA";
  if (/AMAZON|AMAZON\.COM/i.test(normalized)) return "AMZN";
  if (/NETFLIX/i.test(normalized)) return "NFLX";
  if (/APPLE/i.test(normalized)) return "AAPL";
  if (/TESLA/i.test(normalized)) return "TSLA";
  if (/MICROSOFT/i.test(normalized)) return "MSFT";
  return normalizeTicker(normalized);
}

export function resolveSaxoStockSettlementTargetSimulation({
  item,
  simulations,
  stockTransfers,
  wheelCycles,
  selectedSimulationId,
}: {
  item: SaxoHistoryDiscoveryItem;
  simulations: TradeSimulation[];
  stockTransfers: StockTransferEvent[];
  wheelCycles: WheelCycle[];
  selectedSimulationId?: string;
}): SaxoStockSettlementTargetResult {
  const ticker = normalizeSaxoStockSettlementTicker(resolveSaxoHistoryUnderlyingSymbol(item) ?? item.symbol ?? item.instrumentCode);
  const shares = item.quantity !== undefined ? Math.abs(item.quantity) : undefined;
  if (!ticker) return { errorMessage: "株式売却履歴から銘柄を取得できません。Saxo履歴のsymbolを確認してください。" };
  if (shares === undefined || !Number.isFinite(shares) || shares <= 0) {
    return { errorMessage: "株式売却履歴から株数を取得できません。Saxo履歴のquantityを確認してください。" };
  }

  const matchingTransfers = stockTransfers
    .filter((transfer) => normalizeSaxoStockSettlementTicker(transfer.ticker) === ticker)
    .filter((transfer) => transfer.toAccountCode === "N")
    .filter((transfer) => Math.abs(transfer.shares - shares) <= 0.0001);
  const transferWheelIds = new Set(matchingTransfers.map((transfer) => transfer.destinationWheelCycleId).filter(Boolean));
  const transferSourceIds = new Set(matchingTransfers.map((transfer) => transfer.sourceSimulationId).filter(Boolean));
  const linkedSimulationIds = new Set(
    wheelCycles
      .filter((cycle) => normalizeSaxoStockSettlementTicker(cycle.ticker) === ticker || (cycle.id && transferWheelIds.has(cycle.id)))
      .flatMap((cycle) => cycle.linkedSimulationIds),
  );

  const scored = simulations
    .filter((simulation) => normalizeSaxoStockSettlementTicker(simulation.ticker) === ticker)
    .map((simulation) => {
      let score = 0;
      const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" || simulation.accountCode === "N";
      if (isN) score += 4;
      if (simulation.strategyType === "covered_call") score += 4;
      if (linkedSimulationIds.has(simulation.id)) score += 5;
      if (transferSourceIds.has(simulation.id)) score += 2;
      if (matchingTransfers.length > 0) score += 3;
      const currentShares = simulation.stockSettlement?.enabled ? simulation.stockSettlement.shares : simulation.stockPosition?.shares;
      if (currentShares !== undefined && Number.isFinite(currentShares) && currentShares > 0) {
        if (Math.abs(currentShares - shares) <= 0.0001) score += 2;
        else score -= 10;
      }
      if (simulation.stockSettlement?.enabled) score -= 4;
      return { simulation, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const bestScore = scored[0]?.score;
  const matches = scored.filter((item) => item.score === bestScore).map((item) => item.simulation);
  const selectedMatch = selectedSimulationId ? matches.find((simulation) => simulation.id === selectedSimulationId) : undefined;
  if (selectedMatch) return { simulation: selectedMatch };
  if (matches.length === 1) return { simulation: matches[0] };
  if (matches.length === 0) {
    return { errorMessage: `株式売却履歴に対応するN口座の移管済み株式または関連建玉が見つかりません（銘柄 ${ticker} / 株数 ${shares}）。` };
  }
  return { errorMessage: `株式売却履歴に対応する候補が複数あります（銘柄 ${ticker} / 株数 ${shares}）。対象建玉を選択してから再実行してください。` };
}

export function buildSaxoStockSettlementDraft({
  item,
  target,
  stockTransfers,
  fallbackDate,
}: {
  item: SaxoHistoryDiscoveryItem;
  target: TradeSimulation;
  stockTransfers: StockTransferEvent[];
  fallbackDate: string;
}): SaxoStockSettlementDraftResult {
  const shares = item.quantity !== undefined ? Math.abs(item.quantity) : 0;
  const sellPriceUSD = item.price ?? 0;
  const transferCostBasis = stockTransfers
    .filter((transfer) => normalizeSaxoStockSettlementTicker(transfer.ticker) === normalizeSaxoStockSettlementTicker(target.ticker))
    .filter((transfer) => transfer.toAccountCode === "N")
    .filter((transfer) => Math.abs(transfer.shares - shares) <= 0.0001)
    .sort((a, b) => b.transferDate.localeCompare(a.transferDate))[0]?.costBasisUSD;
  const costBasisUSD = transferCostBasis ?? target.stockPosition?.averageCostUSD ?? 0;
  const commissionUSD = roundUsdCents(Math.abs(item.transactionCost ?? item.feeAmount ?? 0));
  if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(sellPriceUSD) || sellPriceUSD <= 0 || !Number.isFinite(costBasisUSD) || costBasisUSD <= 0) {
    return { errorMessage: "株式譲渡候補を作成できませんでした。株数、売却単価、または取得単価が未取得です。Saxo履歴とP→N移管記録を確認してください。" };
  }
  const sourceKey = getSaxoHistoryStableKey(item);
  const existing = normalizeStockSettlement(target.stockSettlement);
  const alreadyLinked =
    existing?.enabled &&
    [sourceKey, item.id].some((key) => key && getStockSettlementHistoryKeys(existing).includes(key));
  return {
    settlement: normalizeStockSettlement({
      enabled: true,
      kind: "manual_sale",
      settlementDate: item.tradeDate ?? fallbackDate,
      shares,
      sellPriceUSD,
      costBasisUSD,
      fxRateJPY: existing?.fxRateJPY,
      commissionUSD,
      commissionJPY: existing?.commissionJPY,
      source: "saxo_history",
      sourceCandidateId: sourceKey,
      sourceTradeId: item.id,
      confirmationStatus: existing?.confirmationStatus ?? "confirmed",
      completionStatus: "complete",
      confirmedAt: existing?.confirmedAt,
      memo: [
        `Saxo N口座 Stock売却履歴から作成。取引ID ${item.sourceIdMasked ?? item.id}。`,
        alreadyLinked ? "既存の株式譲渡記録を更新。" : "株式譲渡記録として取り込み。",
      ].join(""),
    }),
  };
}

export function applySaxoStockSettlementToSimulation(
  target: TradeSimulation,
  settlement: StockSettlement,
): TradeSimulation {
  return {
    ...target,
    status: target.status === "open" ? "closed" : target.status,
    stockSettlement: settlement,
    stockPosition: {
      shares: 0,
      averageCostUSD: settlement.costBasisUSD,
      denominatorPriceMode: target.stockPosition?.denominatorPriceMode ?? "average_cost",
      customDenominatorPriceUSD: target.stockPosition?.customDenominatorPriceUSD,
      canSellAtStrike: target.stockPosition?.canSellAtStrike,
    },
  };
}
