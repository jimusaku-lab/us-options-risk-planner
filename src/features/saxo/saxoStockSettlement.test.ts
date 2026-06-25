import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import { calculateYearlyPerformanceSummary } from "@/domain/yearlyPerformance";
import type { StockTransferEvent, TradeSimulation, WheelCycle } from "@/types/domain";
import { getSaxoHistoryCandidateTarget, type SaxoHistoryDiscoveryItem } from "./saxoAccountSync";
import {
  applySaxoStockSettlementToSimulation,
  buildSaxoStockSettlementDraft,
  resolveSaxoStockSettlementTargetSimulation,
} from "./saxoStockSettlement";

const baseLeg = sampleAmznSimulation.optionLegs[0];

function createNvdaCoveredCall(patch: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    ...sampleAmznSimulation,
    id: "nvda-c225-covered-call",
    name: "NVDA C225 covered call",
    ticker: "NVDA",
    status: "closed",
    strategyType: "covered_call",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    accountCode: "N",
    accountCurrency: "USD",
    entryDate: "2026-06-12",
    expiryDate: "2026-07-10",
    currentPriceUSD: 202.76,
    fxRateJPY: 0,
    referenceFxRateJPY: undefined,
    stockPosition: {
      shares: 0,
      averageCostUSD: 207.5,
      denominatorPriceMode: "average_cost",
    },
    optionLegs: [
      {
        ...baseLeg,
        id: "call-225",
        type: "call",
        side: "sell",
        strikeUSD: 225,
        premiumUSD: 1.8075,
        quantity: 1,
        expiryDate: "2026-07-10",
      },
    ],
    optionCloseExecutions: [
      {
        id: "n-c225-close",
        legId: "call-225",
        closeKind: "buyback",
        confirmed: true,
        closeDate: "2026-06-23",
        contracts: 1,
        closePriceUSD: 0.79,
        commissionUSD: 2.25,
        settlementCurrency: "USD",
        realizedPnlUSD: 99.5,
        source: "saxo_history",
      },
    ],
    stockSettlement: undefined,
    ...patch,
  };
}

describe("Saxo N account stock settlement reflection", () => {
  it("routes the real NVIDIA stock sale history into 6-B stockSettlement and yearly performance", () => {
    const coveredCall = createNvdaCoveredCall();
    const assignmentSource = createNvdaCoveredCall({
      id: "nvda-p2075-assignment",
      strategyType: "short_put",
      status: "assigned",
      accountEnvironment: "PROD_P_JPY_SETTLEMENT",
      accountCode: "P",
      accountCurrency: "JPY",
      optionCloseExecutions: [],
      stockPosition: {
        shares: 100,
        averageCostUSD: 207.5,
        denominatorPriceMode: "average_cost",
      },
    });
    const transfer: StockTransferEvent = {
      id: "transfer-nvda-p-to-n",
      ticker: "NVDA",
      fromAccountCode: "P",
      toAccountCode: "N",
      shares: 100,
      transferDate: "2026-06-15",
      costBasisUSD: 207.5,
      sourceSimulationId: assignmentSource.id,
      destinationWheelCycleId: "wheel-nvda",
    };
    const wheelCycle: WheelCycle = {
      id: "wheel-nvda",
      ticker: "NVDA",
      primaryAccountCode: "N",
      currentPhase: "n_cash",
      currentAccountCode: "N",
      currentShares: 0,
      averageCostUSD: 207.5,
      usdCashImpact: 0,
      cumulativePremiumUSD: 99.5,
      cumulativeStockRealizedPnlUSD: 0,
      cumulativeFeesUSD: 0,
      cumulativeTotalPnlUSD: 99.5,
      eventIds: [],
      linkedSimulationIds: [assignmentSource.id, coveredCall.id],
      openedAt: "2026-06-02",
    };
    const saxoStockSale: SaxoHistoryDiscoveryItem = {
      id: "saxo-nvda-stock-sale-2026-06-23",
      kind: "trade",
      sourceIdMasked: "stock-sale",
      symbol: "NVIDIA Corp.",
      assetType: "Stock",
      buySell: "sell",
      quantity: 100,
      price: 202.76,
      bookedAmount: 20_257.74,
      transactionCost: -18.2599999999984,
      currency: "USD",
      tradeDate: "2026-06-23",
    };

    expect(getSaxoHistoryCandidateTarget(saxoStockSale)).toBe("stock_settlement");

    const target = resolveSaxoStockSettlementTargetSimulation({
      item: saxoStockSale,
      simulations: [assignmentSource, coveredCall],
      stockTransfers: [transfer],
      wheelCycles: [wheelCycle],
    }).simulation;
    expect(target?.id).toBe(coveredCall.id);

    const draft = buildSaxoStockSettlementDraft({
      item: saxoStockSale,
      target: target!,
      stockTransfers: [transfer],
      fallbackDate: "2026-06-24",
    });
    expect(draft.settlement).toMatchObject({
      enabled: true,
      kind: "manual_sale",
      settlementDate: "2026-06-23",
      shares: 100,
      sellPriceUSD: 202.76,
      costBasisUSD: 207.5,
      commissionUSD: 18.26,
    });

    const saved = applySaxoStockSettlementToSimulation(target!, draft.settlement!);
    const summary = calculateYearlyPerformanceSummary([saved], 2026);

    expect(saved.stockSettlement?.enabled).toBe(true);
    expect(saved.stockPosition?.shares).toBe(0);
    expect(summary.nOptionPnlUSD).toBeCloseTo(99.5, 8);
    expect(summary.nStockPnlUSD).toBeCloseTo(-492.26, 8);
    expect(summary.nTotalPnlUSD).toBeCloseTo(-392.76, 8);
    expect(summary.nStockSettlementCount).toBe(1);
    expect(summary.taxBuckets.find((bucket) => bucket.id === "n_stock")?.amountUSD).toBeCloseTo(-492.26, 8);
    expect(summary.taxBuckets.find((bucket) => bucket.id === "n_stock")?.count).toBe(1);
    expect(summary.tickerSummaries.find((item) => item.ticker === "NVDA")?.nStockUSD).toBeCloseTo(-492.26, 8);
  });
});
