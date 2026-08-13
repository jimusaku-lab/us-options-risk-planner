import type { StockSettlement } from "@/types/domain";

const LEGACY_SOURCE_CANDIDATE_PATTERN = /sourceCandidateId\s+([^。\s]+)\s*。?/u;
const LEGACY_SOURCE_TRADE_PATTERN = /(?:取引ID|履歴ID[:：])\s*([^。\s]+)\s*。?/u;

export function getStockSettlementMissingFields(settlement?: StockSettlement | null): string[] {
  if (!settlement?.enabled) return [];
  const missing: string[] = [];
  if (!settlement.settlementDate) missing.push("譲渡日");
  if (!Number.isFinite(settlement.shares) || settlement.shares <= 0) missing.push("株数");
  if (!Number.isFinite(settlement.sellPriceUSD) || settlement.sellPriceUSD <= 0) missing.push("売却単価");
  if (!Number.isFinite(settlement.costBasisUSD) || settlement.costBasisUSD <= 0) missing.push("取得単価");
  return missing;
}

export function isStockSettlementRequiredFieldsComplete(settlement?: StockSettlement | null): boolean {
  return getStockSettlementMissingFields(settlement).length === 0;
}

function parseLegacySettlementSourceCandidateId(memo?: string): string | undefined {
  if (!memo) return undefined;
  return memo.match(LEGACY_SOURCE_CANDIDATE_PATTERN)?.[1];
}

function parseLegacySettlementSourceTradeId(memo?: string): string | undefined {
  if (!memo) return undefined;
  return memo.match(LEGACY_SOURCE_TRADE_PATTERN)?.[1];
}

export function normalizeStockSettlement(settlement?: StockSettlement | null): StockSettlement | undefined {
  if (!settlement) return undefined;
  const sourceCandidateId = settlement.sourceCandidateId ?? parseLegacySettlementSourceCandidateId(settlement.memo);
  const sourceTradeId = settlement.sourceTradeId ?? parseLegacySettlementSourceTradeId(settlement.memo);
  const source = settlement.source ?? (sourceCandidateId || sourceTradeId ? "saxo_history" : "manual");
  const completionStatus =
    !settlement.enabled
      ? settlement.completionStatus
      : settlement.completionStatus ??
        (settlement.invalidReason
          ? "conflict"
          : isStockSettlementRequiredFieldsComplete(settlement)
            ? "complete"
            : "incomplete");
  const confirmationStatus =
    !settlement.enabled
      ? settlement.confirmationStatus
      : settlement.confirmationStatus ??
        (completionStatus === "complete" ? "confirmed" : "pending");
  return {
    ...settlement,
    source,
    sourceCandidateId,
    sourceTradeId,
    completionStatus,
    confirmationStatus,
  };
}

export function getStockSettlementHistoryKeys(settlement?: StockSettlement | null): string[] {
  const normalized = normalizeStockSettlement(settlement);
  if (!normalized) return [];
  return Array.from(new Set([normalized.sourceCandidateId, normalized.sourceTradeId].filter((value): value is string => Boolean(value))));
}

export function isConfirmedStockSettlement(settlement?: StockSettlement | null): boolean {
  const normalized = normalizeStockSettlement(settlement);
  return Boolean(
    normalized?.enabled &&
      normalized.confirmationStatus === "confirmed" &&
      normalized.completionStatus === "complete",
  );
}

export function describeStockSettlementPendingReason(settlement?: StockSettlement | null): string | undefined {
  const normalized = normalizeStockSettlement(settlement);
  if (!normalized?.enabled) return undefined;
  if (normalized.completionStatus === "conflict") {
    return normalized.invalidReason ?? "競合: 株式譲渡候補と保存済み記録の照合に失敗しています。";
  }
  const missing = getStockSettlementMissingFields(normalized);
  return missing.length > 0 ? `不足項目: ${missing.join("、")}` : undefined;
}
