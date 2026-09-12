import type { OptionEntryExecution, OptionLeg, TradeSimulation } from "@/types/domain";
import { formatLocalDate } from "@/lib/date";
import { getCanonicalOptionEntryExecutions } from "./optionEntryExecutions";
import { calculateOptionCloseExecutionResult, getOptionLegCloseProgress } from "./optionCloseExecutions";

const EPSILON = 0.0001;

export type BearPutSpreadValidation =
  | { valid: true; longPut: OptionLeg; shortPut: OptionLeg; contractSize: number; contracts: number }
  | { valid: false; reasons: string[] };

export type BearPutSpreadLifecycle = {
  state: "entry_incomplete" | "open" | "partial_pairs" | "one_leg_remaining" | "imbalanced" | "closed" | "invalid";
  longRemaining?: number;
  shortRemaining?: number;
  label: string;
};

export type BearPutSpreadEstimate =
  | { kind: "missing"; lifecycle: BearPutSpreadLifecycle; reasons: string[] }
  | {
      kind: "available";
      lifecycle: BearPutSpreadLifecycle;
      currency: "USD";
      entryAllInDebitUSD: number;
      remainingEntryBasisUSD: number;
      closeNetProceedsUSD: number;
      remainingEstimatedPnlUSD: number;
      realizedPnlUSD: number;
      totalEstimatedPnlUSD: number;
      periodReturnPct: number;
      annualizedReturnPct?: number;
      holdingDays?: number;
      evaluatedLegs: Array<{ legId: string; label: "高ストライクP買い" | "低ストライクP売り"; remainingContracts: number; closePriceUSD: number; closeFeeUSD: number }>;
    };

function positiveInteger(value: number | undefined): value is number {
  return Number.isInteger(value) && (value ?? 0) > 0;
}

export function validateBearPutSpread(simulation: TradeSimulation): BearPutSpreadValidation {
  const reasons: string[] = [];
  if (simulation.strategyType !== "bear_put_spread") reasons.push("戦略種別がBear Put Spreadではありません");
  const puts = simulation.optionLegs.filter((leg) => leg.type === "put");
  const longPuts = puts.filter((leg) => leg.side === "buy");
  const shortPuts = puts.filter((leg) => leg.side === "sell");
  if (simulation.optionLegs.length !== 2 || longPuts.length !== 1 || shortPuts.length !== 1) reasons.push("P買い1脚とP売り1脚が必要です");
  const longPut = longPuts[0];
  const shortPut = shortPuts[0];
  if (!longPut || !shortPut) return { valid: false, reasons };
  if (!(longPut.strikeUSD > shortPut.strikeUSD)) reasons.push("P買いの行使価格はP売りより高い必要があります");
  if (longPut.expiryDate !== shortPut.expiryDate || longPut.expiryDate !== simulation.expiryDate) reasons.push("両脚の満期が一致していません");
  if (!positiveInteger(longPut.quantity) || !positiveInteger(shortPut.quantity) || longPut.quantity !== shortPut.quantity) reasons.push("両脚は同じ正の整数契約数である必要があります");
  if (!positiveInteger(longPut.contractSize) || !positiveInteger(shortPut.contractSize) || longPut.contractSize !== shortPut.contractSize) reasons.push("両脚の明示的な契約倍率が必要です");
  if (simulation.accountCurrency !== "USD") reasons.push("現時点のBear Put Spread実績計算はUSD口座だけに対応します");
  return reasons.length > 0
    ? { valid: false, reasons }
    : { valid: true, longPut, shortPut, contractSize: longPut.contractSize!, contracts: longPut.quantity };
}

function confirmedEntriesForLeg(simulation: TradeSimulation, leg: OptionLeg): OptionEntryExecution[] {
  return getCanonicalOptionEntryExecutions(simulation).filter((entry) => entry.confirmed && entry.legId === leg.id);
}

function hasCompleteEntry(simulation: TradeSimulation, leg: OptionLeg): boolean {
  const entries = confirmedEntriesForLeg(simulation, leg);
  return entries.length > 0 &&
    entries.reduce((sum, entry) => sum + entry.contracts, 0) === leg.quantity &&
    entries.every((entry) => entry.settlementCurrency === "USD" && Number.isFinite(entry.fillPriceUSD) && entry.fillPriceUSD > 0 && entry.commissionUSD !== undefined && Number.isFinite(entry.commissionUSD));
}

export function getBearPutSpreadLifecycle(simulation: TradeSimulation): BearPutSpreadLifecycle {
  const validation = validateBearPutSpread(simulation);
  if (!validation.valid) return { state: "invalid", label: validation.reasons.join(" / ") };
  if (!hasCompleteEntry(simulation, validation.longPut) || !hasCompleteEntry(simulation, validation.shortPut)) return { state: "entry_incomplete", label: "建玉開始実績 未確認" };
  const progress = getOptionLegCloseProgress(simulation);
  if (progress.invalidReason) return { state: "invalid", label: progress.invalidReason };
  const longRemaining = progress.legs.find((item) => item.legId === validation.longPut.id)?.remainingContracts;
  const shortRemaining = progress.legs.find((item) => item.legId === validation.shortPut.id)?.remainingContracts;
  if (longRemaining === undefined || shortRemaining === undefined) return { state: "invalid", label: "脚別決済数量を確認できません" };
  if (longRemaining === 0 && shortRemaining === 0) return { state: "closed", longRemaining, shortRemaining, label: "両脚決済済み" };
  if (longRemaining === 0 || shortRemaining === 0) return { state: "one_leg_remaining", longRemaining, shortRemaining, label: `${longRemaining > 0 ? "P買い" : "P売り"}${Math.max(longRemaining, shortRemaining)}枚残存` };
  if (longRemaining !== shortRemaining) return { state: "imbalanced", longRemaining, shortRemaining, label: `脚数量不均衡（P買い${longRemaining} / P売り${shortRemaining}）` };
  if (longRemaining < validation.contracts) return { state: "partial_pairs", longRemaining, shortRemaining, label: `${longRemaining}組残存` };
  return { state: "open", longRemaining, shortRemaining, label: `${longRemaining}組建玉中` };
}

function entryEconomics(simulation: TradeSimulation, leg: OptionLeg, multiplier: number) {
  const entries = confirmedEntriesForLeg(simulation, leg);
  if (!hasCompleteEntry(simulation, leg)) return undefined;
  const premium = entries.reduce((sum, entry) => sum + entry.fillPriceUSD * entry.contracts * multiplier, 0);
  const fees = entries.reduce((sum, entry) => sum + Math.abs(entry.commissionUSD!), 0);
  return { total: leg.side === "buy" ? premium + fees : premium - fees, perContract: (leg.side === "buy" ? premium + fees : premium - fees) / leg.quantity };
}

function explicitRealizedPnlUSD(simulation: TradeSimulation): number | undefined {
  const confirmed = (simulation.optionCloseExecutions ?? []).filter((execution) => execution.confirmed);
  let total = 0;
  for (const execution of confirmed) {
    if (execution.realizedPnlUSD !== undefined && Number.isFinite(execution.realizedPnlUSD)) {
      total += execution.realizedPnlUSD;
      continue;
    }
    const result = calculateOptionCloseExecutionResult(simulation, execution);
    if (!result || result.currency !== "USD" || !Number.isFinite(result.realizedPnlUSD)) return undefined;
    total += result.realizedPnlUSD;
  }
  return total;
}

function holdingDays(entryDate: string, asOfDate: string): number | undefined {
  const start = new Date(`${entryDate}T00:00:00Z`).getTime();
  const end = new Date(`${asOfDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return Math.max(1, Math.ceil((end - start) / 86_400_000));
}

export function calculateBearPutSpreadEstimate(simulation: TradeSimulation, asOfDate = formatLocalDate()): BearPutSpreadEstimate {
  const lifecycle = getBearPutSpreadLifecycle(simulation);
  const validation = validateBearPutSpread(simulation);
  if (!validation.valid) return { kind: "missing", lifecycle, reasons: validation.reasons };
  if (lifecycle.state === "entry_incomplete" || lifecycle.state === "invalid") return { kind: "missing", lifecycle, reasons: [lifecycle.label] };
  const longEntry = entryEconomics(simulation, validation.longPut, validation.contractSize);
  const shortEntry = entryEconomics(simulation, validation.shortPut, validation.contractSize);
  if (!longEntry || !shortEntry) return { kind: "missing", lifecycle, reasons: ["建玉時実績 未確認"] };
  const entryAllInDebitUSD = longEntry.total - shortEntry.total;
  if (!(entryAllInDebitUSD > 0)) return { kind: "missing", lifecycle, reasons: ["建玉時ネット支払額を確認できません"] };
  const realizedPnlUSD = explicitRealizedPnlUSD(simulation);
  if (realizedPnlUSD === undefined) return { kind: "missing", lifecycle, reasons: ["決済済み脚の実現損益 未確認"] };
  const progress = getOptionLegCloseProgress(simulation);
  const remaining = [validation.longPut, validation.shortPut].map((leg) => ({ leg, remainingContracts: progress.legs.find((item) => item.legId === leg.id)?.remainingContracts ?? 0 }));
  const evaluatedLegs: Extract<BearPutSpreadEstimate, { kind: "available" }>["evaluatedLegs"] = [];
  let closeNetProceedsUSD = 0;
  let remainingEntryBasisUSD = 0;
  const reasons: string[] = [];
  for (const item of remaining.filter((value) => value.remainingContracts > 0)) {
    const price = item.leg.closePlan?.closePriceUSD ?? item.leg.closeCostUSD;
    const fee = item.leg.closePlan?.commissionUSD;
    if (!(price !== undefined && Number.isFinite(price) && price > 0)) reasons.push(`${item.leg.side === "buy" ? "P買い売却" : "P売り買戻し"}価格 未確認`);
    if (!(fee !== undefined && Number.isFinite(fee) && fee >= 0)) reasons.push(`${item.leg.side === "buy" ? "P買い" : "P売り"}決済想定手数料 未確認`);
    if (reasons.length > 0) continue;
    const allocatedFee = fee! * item.remainingContracts / item.leg.quantity;
    const gross = price! * validation.contractSize * item.remainingContracts;
    closeNetProceedsUSD += item.leg.side === "buy" ? gross - allocatedFee : -(gross + allocatedFee);
    const entry = item.leg.id === validation.longPut.id ? longEntry : shortEntry;
    remainingEntryBasisUSD += item.leg.side === "buy" ? entry.perContract * item.remainingContracts : -entry.perContract * item.remainingContracts;
    evaluatedLegs.push({ legId: item.leg.id, label: item.leg.side === "buy" ? "高ストライクP買い" : "低ストライクP売り", remainingContracts: item.remainingContracts, closePriceUSD: price!, closeFeeUSD: allocatedFee });
  }
  if (reasons.length > 0) return { kind: "missing", lifecycle, reasons: Array.from(new Set(reasons)) };
  const remainingEstimatedPnlUSD = closeNetProceedsUSD - remainingEntryBasisUSD;
  const totalEstimatedPnlUSD = realizedPnlUSD + remainingEstimatedPnlUSD;
  const periodReturnPct = totalEstimatedPnlUSD / entryAllInDebitUSD * 100;
  const days = holdingDays(simulation.entryDate, asOfDate);
  return { kind: "available", lifecycle, currency: "USD", entryAllInDebitUSD, remainingEntryBasisUSD, closeNetProceedsUSD, remainingEstimatedPnlUSD, realizedPnlUSD, totalEstimatedPnlUSD, periodReturnPct, annualizedReturnPct: days ? periodReturnPct * 365 / days : undefined, holdingDays: days, evaluatedLegs };
}
