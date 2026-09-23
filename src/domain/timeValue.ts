import type { OptionCloseExecution, OptionEntryExecution, OptionLeg, OptionSide, OptionType, OptionValueObservation, OptionValueSnapshotSource } from "@/types/domain";

export type OptionValueDecomposition = {
  state: OptionValueObservation["decompositionState"];
  intrinsicValueUSD?: number;
  rawTimeValueUSD?: number;
  timeValueUSD?: number;
  timeValueRatio?: number;
  reason?: string;
};

export function resolveOptionValueEvidenceRevision(params: { legId: string; entryExecutions?: OptionEntryExecution[]; closeExecutions?: OptionCloseExecution[] }): string | undefined {
  const entries = (params.entryExecutions ?? []).filter((item) => item.legId === params.legId && !item.voided).sort((a, b) => a.id.localeCompare(b.id)).map((item) => ({ id: item.id, supersedesId: item.supersedesId, tradeDate: item.tradeDate, contracts: item.contracts, fillPriceUSD: item.fillPriceUSD, settlementCurrency: item.settlementCurrency, bookedJPY: item.brokerBookedAmountJPY, premiumJPY: item.brokerPremiumJPY, transactionCostJPY: item.brokerTransactionCostJPY, commissionUSD: item.commissionUSD, commissionJPY: item.commissionJPY, brokerExchangeRateJPY: item.brokerExchangeRateJPY, confirmed: item.confirmed, source: item.source }));
  const closes = (params.closeExecutions ?? []).filter((item) => item.legId === params.legId && !item.voided).sort((a, b) => a.id.localeCompare(b.id)).map((item) => ({ id: item.id, supersedesId: item.supersedesId, closeDate: item.closeDate, closeTime: item.closeTime, contracts: item.contracts, closePriceUSD: item.closePriceUSD, commissionUSD: item.commissionUSD, commissionJPY: item.commissionJPY, settlementCurrency: item.settlementCurrency, bookedJPY: item.brokerBookedAmountJPY, realizedPnlUSD: item.realizedPnlUSD, realizedPnlJPY: item.brokerRealizedPnlJPY, confirmed: item.confirmed, source: item.source, confirmationStatus: item.confirmationStatus, accountingStatus: item.accountingStatus }));
  if (entries.length === 0 && closes.length === 0) return undefined;
  return JSON.stringify({ version: "r14-evidence-1", legId: params.legId, entries, closes });
}

export function calculateOptionValueDecomposition(params: { optionType: OptionType; optionPriceUSD: number; underlyingPriceUSD?: number; strikeUSD: number }): OptionValueDecomposition {
  const { optionType, optionPriceUSD, underlyingPriceUSD, strikeUSD } = params;
  if (!Number.isFinite(optionPriceUSD) || optionPriceUSD < 0) return { state: "missing", reason: "現在価格が未取得または不正です" };
  if (!Number.isFinite(strikeUSD) || strikeUSD <= 0) return { state: "missing", reason: "行使価格が未取得または不正です" };
  if (!Number.isFinite(underlyingPriceUSD) || (underlyingPriceUSD ?? 0) <= 0) return { state: "price_only", reason: "株価が未取得のため時間価値を分解できません" };
  const intrinsicValueUSD = optionType === "call" ? Math.max(0, underlyingPriceUSD! - strikeUSD) : Math.max(0, strikeUSD - underlyingPriceUSD!);
  const rawTimeValueUSD = optionPriceUSD - intrinsicValueUSD;
  if (optionPriceUSD === 0) return { state: "zero_price", intrinsicValueUSD, rawTimeValueUSD, reason: "価格0は明示値として保持しますが、時間価値比率は計算しません" };
  if (rawTimeValueUSD < 0) return { state: "inconsistent", intrinsicValueUSD, rawTimeValueUSD, reason: "価格と株価の整合を確認" };
  return { state: "available", intrinsicValueUSD, rawTimeValueUSD, timeValueUSD: rawTimeValueUSD, timeValueRatio: rawTimeValueUSD / optionPriceUSD };
}

export function buildOptionValueObservation(params: {
  observationId: string;
  legId?: string;
  workspaceId?: string;
  batchId?: string;
  evidenceRevision?: string;
  snapshotDate?: string;
  capturedAt?: string;
  sourceTimestamp?: string;
  underlyingSource?: string;
  underlyingSourceTimestamp?: string;
  side: OptionSide;
  optionType: OptionType;
  optionPriceUSD: number;
  underlyingPriceUSD?: number;
  strikeUSD: number;
  expiry: string;
  expiryDate?: string;
  quantity: number;
  contractSize: number;
  selectedField?: "bid" | "ask" | "manual";
  source: OptionValueSnapshotSource;
  quality?: "current" | "old_indicative" | "manual" | "unknown";
  feeUSD?: number;
  feeSource?: string;
}): OptionValueObservation | null {
  if (!params.observationId || !Number.isFinite(params.optionPriceUSD) || params.optionPriceUSD < 0 || !Number.isInteger(params.quantity) || params.quantity <= 0 || !Number.isInteger(params.contractSize) || params.contractSize <= 0) return null;
  const snapshotDate = params.snapshotDate ?? toTokyoDate(params.capturedAt);
  if (!snapshotDate) return null;
  const decomposition = calculateOptionValueDecomposition(params);
  return { observationId: params.observationId, legId: params.legId, workspaceId: params.workspaceId, batchId: params.batchId, evidenceRevision: params.evidenceRevision, snapshotDate, capturedAt: params.capturedAt, sourceTimestamp: params.sourceTimestamp, underlyingSource: params.underlyingSource, underlyingSourceTimestamp: params.underlyingSourceTimestamp, side: params.side, optionType: params.optionType, strikeUSD: params.strikeUSD, expiryDate: params.expiryDate ?? params.expiry, quantity: params.quantity, contractSize: params.contractSize, optionPriceUSD: params.optionPriceUSD, underlyingPriceUSD: params.underlyingPriceUSD, intrinsicValueUSD: decomposition.intrinsicValueUSD, rawTimeValueUSD: decomposition.rawTimeValueUSD, timeValueUSD: decomposition.timeValueUSD, timeValueRatio: decomposition.timeValueRatio, decompositionState: decomposition.state, reason: decomposition.reason, selectedField: params.selectedField, source: params.source, quality: params.quality, feeUSD: params.feeUSD, feeSource: params.feeSource, calculationVersion: "r14" };
}

export function upsertTimeValueObservation(observations: OptionValueObservation[] | undefined, nextObservation: OptionValueObservation): OptionValueObservation[] {
  const byDate = new Map<string, OptionValueObservation>();
  for (const observation of observations ?? []) if (observation.snapshotDate) byDate.set(observation.snapshotDate, observation);
  const priorIdentity = [...byDate.entries()].find(([, observation]) => observation.observationId === nextObservation.observationId && (nextObservation.evidenceRevision === undefined || observation.evidenceRevision === nextObservation.evidenceRevision));
  if (priorIdentity && priorIdentity[0] !== nextObservation.snapshotDate) byDate.delete(priorIdentity[0]);
  const previous = byDate.get(nextObservation.snapshotDate) ?? [...byDate.values()].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate)).at(-1);
  const quantityChanged = previous && ((previous.quantity !== undefined && nextObservation.quantity !== undefined && previous.quantity !== nextObservation.quantity) || (previous.contractSize !== undefined && nextObservation.contractSize !== undefined && previous.contractSize !== nextObservation.contractSize));
  byDate.set(nextObservation.snapshotDate, quantityChanged ? { ...nextObservation, quantityChanged: true, previousQuantity: previous.quantity, previousContractSize: previous.contractSize, reason: nextObservation.reason ?? "数量変更/部分決済" } : nextObservation);
  return [...byDate.values()].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate)).slice(-20);
}

export function getTimeValueObservationTimeline(leg: OptionLeg): OptionValueObservation[] {
  const current = [...(leg.valueObservations ?? [])];
  const existingDates = new Set(current.map((item) => item.snapshotDate));
  for (const snapshot of leg.valueSnapshots ?? []) {
    if (existingDates.has(snapshot.snapshotDate)) continue;
    const legacyRawTimeValueUSD = snapshot.optionExitPrice - snapshot.intrinsicValue;
    const legacyPriceIsZero = snapshot.optionExitPrice === 0;
    current.push({ observationId: `legacy:${leg.id}:${snapshot.snapshotDate}`, snapshotDate: snapshot.snapshotDate, capturedAt: snapshot.capturedAt, side: leg.side, optionType: leg.type, strikeUSD: snapshot.strike, expiryDate: snapshot.expiry, quantity: undefined, contractSize: undefined, optionPriceUSD: snapshot.optionExitPrice, underlyingPriceUSD: snapshot.underlyingPrice, intrinsicValueUSD: snapshot.intrinsicValue, rawTimeValueUSD: legacyRawTimeValueUSD, timeValueUSD: legacyPriceIsZero || legacyRawTimeValueUSD < 0 ? undefined : legacyRawTimeValueUSD, timeValueRatio: legacyPriceIsZero || legacyRawTimeValueUSD < 0 ? undefined : legacyRawTimeValueUSD / snapshot.optionExitPrice, decompositionState: legacyPriceIsZero ? "zero_price" : legacyRawTimeValueUSD < 0 ? "inconsistent" : "available", reason: legacyPriceIsZero ? "価格0は明示値として保持しますが、時間価値比率は計算しません" : legacyRawTimeValueUSD < 0 ? "価格と株価の整合を確認" : undefined, source: snapshot.source, quality: "unknown", calculationVersion: "legacy_adapter" });
  }
  return current.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate)).slice(-20);
}

function toTokyoDate(capturedAt?: string): string | undefined {
  if (!capturedAt) return undefined;
  const parsed = new Date(capturedAt);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(parsed);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : undefined;
}
