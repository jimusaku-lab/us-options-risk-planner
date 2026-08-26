import type { OptionLeg, TradeSimulation } from "@/types/domain";
import { calculatePutAssignmentCapitalTotalUSD } from "./calculations";
import { resolveCloseCommissionUSD } from "./closeCommissionStandard";
import { resolveCurrentEstimateFx, type ResolvedCurrentEstimateFx } from "./currentEstimateFx";
import { getOptionCloseCompletion, getRemainingOptionLegs } from "./optionCloseExecutions";
import type { FxQuote } from "@/lib/marketData";

export type PutAssignmentPolicy = "accept" | "avoid" | "unknown";
export type CurrentPositionEstimateRequirement = { legId?: string; field: "exit_price" | "entry_execution" | "close_fee" | "denominator" };
export type CurrentPositionEstimate =
  | { kind: "not_applicable" }
  | { kind: "missing"; primaryLabel: "現在決済年率"; reason: string; missingRequirements: CurrentPositionEstimateRequirement[] }
  | { kind: "available"; primaryLabel: "現在決済年率"; annualizedReturnPct: number; profitUSD: number; profitPct: number; currency?: "USD"; evaluationScope?: "synthetic_combined" | "remaining_leg"; evaluatedLegId?: string; evaluatedLegLabel?: "C買い" | "P売り" }
  | { kind: "available"; primaryLabel: "現在決済年率"; annualizedReturnPct: number; profitJPY: number; profitPct: number; currency: "JPY"; fx: ResolvedCurrentEstimateFx; evaluationScope?: "synthetic_combined" | "remaining_leg"; evaluatedLegId?: string; evaluatedLegLabel?: "C買い" | "P売り" };

function isPositiveFinite(value: number | undefined): value is number { return value !== undefined && Number.isFinite(value) && value > 0; }
function currentExitPrice(leg: OptionLeg): number | undefined { return isPositiveFinite(leg.closeCostUSD) ? leg.closeCostUSD : undefined; }
function isExplicitFee(value: number | undefined): value is number { return value !== undefined && Number.isFinite(value) && value >= 0; }
function missing(reason: string, missingRequirements: CurrentPositionEstimateRequirement[]): CurrentPositionEstimate { return { kind: "missing", primaryLabel: "現在決済年率", reason, missingRequirements }; }
/** USD current estimates require confirmed USD entry executions; P/JPY report values are never converted here. */
function getConfirmedEntryNetCashflowUSD(simulation: TradeSimulation, legs: OptionLeg[]): number | undefined { const executions=simulation.optionEntryExecutions??[]; let net=0; for (const leg of legs) { const entry=executions.find((item)=>item.legId===leg.id&&item.confirmed); if (!entry || entry.settlementCurrency!=="USD" || !Number.isFinite(entry.fillPriceUSD) || entry.fillPriceUSD<=0 || !Number.isFinite(entry.contracts) || entry.contracts<=0 || !isExplicitFee(entry.commissionUSD)) return undefined; const premium=entry.fillPriceUSD*entry.contracts*100; net+=(leg.side==="sell"?premium:-premium)-entry.commissionUSD; } return net; }

function calculateRemainingLegEstimate(simulation: TradeSimulation, leg: OptionLeg, remaining: number, elapsedDays: number): CurrentPositionEstimate {
  const exit=currentExitPrice(leg); const label=leg.type === "call" ? "C買い" : "P売り";
  if (!exit) return missing(leg.side === "buy" ? "現在売却価格 未取得" : "買戻し価格 未取得", [{ legId: leg.id, field: "exit_price" }]);
  const entry=(simulation.optionEntryExecutions??[]).find((item)=>item.legId===leg.id&&item.confirmed);
  if (!entry || entry.settlementCurrency!=="USD" || !Number.isFinite(entry.fillPriceUSD) || entry.fillPriceUSD<=0 || !Number.isFinite(entry.contracts) || entry.contracts<=0 || entry.contracts<remaining || !isExplicitFee(entry.commissionUSD)) return missing("建玉時実績 未確認", [{ legId: leg.id, field: "entry_execution" }]);
  const close=resolveCloseCommissionUSD(simulation,leg); if (close.kind==="missing") return missing("決済想定手数料 未確認", [{ legId: leg.id, field: "close_fee" }]);
  const ratio=remaining/entry.contracts; const entryCashflow=(leg.side === "sell" ? entry.fillPriceUSD * remaining * 100 : -entry.fillPriceUSD * remaining * 100) - entry.commissionUSD * ratio;
  const profitUSD=(leg.side === "buy" ? exit : -exit)*remaining*100 + entryCashflow - close.amountUSD*(remaining/leg.quantity);
  const denominatorUSD=leg.side === "buy" ? Math.max(0,-entryCashflow) : leg.strikeUSD*100*remaining;
  if (!isPositiveFinite(denominatorUSD)) return missing("正本分母 未確認", [{field:"denominator"}]);
  return {kind:"available",primaryLabel:"現在決済年率",annualizedReturnPct:(profitUSD/denominatorUSD)*(365/elapsedDays)*100,profitUSD,profitPct:(profitUSD/denominatorUSD)*100,evaluationScope:"remaining_leg",evaluatedLegId:leg.id,evaluatedLegLabel:label};
}

export function getSyntheticPutAssignmentPolicy(simulation: TradeSimulation): PutAssignmentPolicy {
  if (simulation.strategyType !== "synthetic_forward") return "unknown";
  const put = simulation.optionLegs.find((leg) => leg.type === "put" && leg.side === "sell");
  return put?.assignmentPolicy === "accept" || put?.assignmentPolicy === "avoid" ? put.assignmentPolicy : "unknown";
}

export function applySyntheticPutAssignmentPolicy(simulation: TradeSimulation, policy: Exclude<PutAssignmentPolicy, "unknown">): TradeSimulation {
  if (simulation.strategyType !== "synthetic_forward") return simulation;
  return { ...simulation, optionLegs: simulation.optionLegs.map((leg) => leg.type === "put" && leg.side === "sell" ? { ...leg, assignmentPolicy: policy, putIntent: policy === "accept" ? "accept_assignment" : "avoid_assignment" } : leg) };
}

export function calculateCurrentPositionEstimate(simulation: TradeSimulation, now = new Date(), currentFxQuote?: FxQuote | null): CurrentPositionEstimate {
  if (simulation.status !== "open") return { kind: "not_applicable" };
  const isPJPY = simulation.accountEnvironment === "PROD_P_JPY_SETTLEMENT";
  const elapsedDays = Math.max(1, Math.floor((now.getTime() - new Date(`${simulation.entryDate}T00:00:00`).getTime()) / 86_400_000));
  if (!Number.isFinite(elapsedDays)) return missing("建玉日 未取得", [{ field: "denominator" }]);
  if (simulation.strategyType === "synthetic_forward") {
    const completion=getOptionCloseCompletion(simulation);
    if (completion.state === "invalid" || completion.state === "complete") return { kind: "not_applicable" };
    if (completion.state === "partial") { const remaining=getRemainingOptionLegs(simulation); return remaining.length === 1 ? calculateRemainingLegEstimate(simulation,remaining[0].leg,remaining[0].progress.remainingContracts??0,elapsedDays) : {kind:"not_applicable"}; }
    const call = simulation.optionLegs.find((leg) => leg.type === "call" && leg.side === "buy");
    const put = simulation.optionLegs.find((leg) => leg.type === "put" && leg.side === "sell");
    const callExit = call && currentExitPrice(call); const putExit = put && currentExitPrice(put);
    if (!callExit || !putExit) return missing(!callExit && !putExit ? "C売却価格・P買戻し価格 未取得" : !callExit ? "C売却価格 未取得" : "P買戻し価格 未取得", [!callExit ? { legId: call?.id, field: "exit_price" as const } : null, !putExit ? { legId: put?.id, field: "exit_price" as const } : null].filter(Boolean) as CurrentPositionEstimateRequirement[]);
    const entryCashflow = getConfirmedEntryNetCashflowUSD(simulation,[call,put]); const callClose=resolveCloseCommissionUSD(simulation,call); const putClose=resolveCloseCommissionUSD(simulation,put);
    if (entryCashflow===undefined) return missing("建玉時実績 未確認", [{ legId: call.id, field: "entry_execution" }, { legId: put.id, field: "entry_execution" }]);
    if (callClose.kind==="missing" || putClose.kind==="missing") return missing("決済想定手数料 未確認", [callClose.kind==="missing" ? { legId: call.id, field: "close_fee" as const } : null, putClose.kind==="missing" ? { legId: put.id, field: "close_fee" as const } : null].filter(Boolean) as CurrentPositionEstimateRequirement[]);
    const closeFees=callClose.amountUSD+putClose.amountUSD;
    const profitUSD = callExit * call.quantity * 100 - putExit * put.quantity * 100 + entryCashflow - closeFees;
    const denominatorUSD = calculatePutAssignmentCapitalTotalUSD(simulation) + Math.max(0, -entryCashflow);
    if (!isPositiveFinite(denominatorUSD)) return missing("正本分母 未確認", [{ field: "denominator" }]);
    return { kind: "available", primaryLabel: "現在決済年率", annualizedReturnPct: (profitUSD / denominatorUSD) * (365 / elapsedDays) * 100, profitUSD, profitPct: (profitUSD / denominatorUSD) * 100, evaluationScope: "synthetic_combined" };
  }
  const long = simulation.optionLegs.find((leg) => leg.side === "buy" && (leg.type === "call" || leg.type === "put"));
  const put = simulation.optionLegs.find((leg) => leg.side === "sell" && leg.type === "put");
  if (!long && !put) return { kind: "not_applicable" };
  const leg = long ?? put!; const exit = currentExitPrice(leg);
  if (!exit) return missing(long ? "現在売却価格 未取得" : "買戻し価格 未取得", [{ legId: leg.id, field: "exit_price" }]);
  if (isPJPY) {
    if (!long) return { kind: "not_applicable" };
    const entry=(simulation.optionEntryExecutions??[]).find((item)=>item.legId===leg.id&&item.confirmed&&item.settlementCurrency==="JPY");
    if (!entry || entry.brokerBookedAmountJPY===undefined || !Number.isFinite(entry.brokerBookedAmountJPY)) return missing("建玉時実績 未確認", [{ legId: leg.id, field: "entry_execution" }]);
    const close=resolveCloseCommissionUSD(simulation,leg);
    if (close.kind==="missing") return missing("決済想定手数料 未確認", [{ legId: leg.id, field: "close_fee" }]);
    const fx=resolveCurrentEstimateFx(simulation,currentFxQuote);
    if (fx.kind === "missing") return missing("為替レート 未確認", [{ field: "denominator" }]);
    const closeProceedsJPY=(exit*leg.quantity*100-close.amountUSD)*fx.rateJPYPerUSD; const denominatorJPY=Math.abs(entry.brokerBookedAmountJPY);
    if (!isPositiveFinite(denominatorJPY)) return missing("正本分母 未確認", [{ field: "denominator" }]);
    const profitJPY=closeProceedsJPY+entry.brokerBookedAmountJPY;
    return {kind:"available",primaryLabel:"現在決済年率",annualizedReturnPct:(profitJPY/denominatorJPY)*(365/elapsedDays)*100,profitJPY,profitPct:(profitJPY/denominatorJPY)*100,currency:"JPY",fx};
  }
  if (simulation.accountEnvironment !== "PROD_N_USD_SETTLEMENT") return { kind: "not_applicable" };
  const entryCashflow = getConfirmedEntryNetCashflowUSD(simulation,[leg]); if (entryCashflow===undefined) return missing("建玉時実績 未確認", [{ legId: leg.id, field: "entry_execution" }]);
  const close=resolveCloseCommissionUSD(simulation,leg);
  if (close.kind==="missing") return missing("決済想定手数料 未確認", [{ legId: leg.id, field: "close_fee" }]);
  const profitUSD = (long ? exit : -exit) * leg.quantity * 100 + entryCashflow - close.amountUSD;
  const denominatorUSD = long ? Math.max(0, -entryCashflow) : calculatePutAssignmentCapitalTotalUSD(simulation);
  if (!isPositiveFinite(denominatorUSD)) return missing("正本分母 未確認", [{ field: "denominator" }]);
  return { kind: "available", primaryLabel: "現在決済年率", annualizedReturnPct: (profitUSD / denominatorUSD) * (365 / elapsedDays) * 100, profitUSD, profitPct: (profitUSD / denominatorUSD) * 100 };
}
