import type { OptionLeg, StrategyType, TradeSimulation } from "@/types/domain";
import { resolveCloseCommissionUSD } from "./closeCommissionStandard";
import { getOptionLegCloseProgress } from "./optionCloseExecutions";
import { activeSpreadCloses, activeSpreadEntries, moneyProduct, moneySum } from "./spreadCashflows";
import { formatLocalDate } from "@/lib/date";

export type VerticalSpreadType = "bull_call_spread" | "bear_call_spread" | "bull_put_spread" | "bear_put_spread";
export type VerticalSpreadDefinition = { strategyType: VerticalSpreadType; label: string; optionType: "call" | "put"; debit: boolean; buyStrike: "higher" | "lower" };
export const verticalSpreadDefinitions: Record<VerticalSpreadType, VerticalSpreadDefinition> = {
  bull_call_spread: { strategyType: "bull_call_spread", label: "ブル・コール", optionType: "call", debit: true, buyStrike: "lower" },
  bear_call_spread: { strategyType: "bear_call_spread", label: "ベア・コール", optionType: "call", debit: false, buyStrike: "higher" },
  bull_put_spread: { strategyType: "bull_put_spread", label: "ブル・プット", optionType: "put", debit: false, buyStrike: "lower" },
  bear_put_spread: { strategyType: "bear_put_spread", label: "ベア・プット", optionType: "put", debit: true, buyStrike: "higher" },
};
export function isVerticalSpreadType(value: StrategyType | string | undefined): value is VerticalSpreadType { return Boolean(value && value in verticalSpreadDefinitions); }
export function getVerticalSpreadDefinition(value: StrategyType | string | undefined): VerticalSpreadDefinition | undefined { return isVerticalSpreadType(value) ? verticalSpreadDefinitions[value] : undefined; }
export type VerticalSpreadLegs = { definition: VerticalSpreadDefinition; buy: OptionLeg; sell: OptionLeg; contractSize: number; contracts: number };
const positiveInteger = (value: number | undefined): value is number => value !== undefined && Number.isInteger(value) && value > 0;
export function validateVerticalSpread(simulation: TradeSimulation): { valid: true; value: VerticalSpreadLegs } | { valid: false; reasons: string[] } {
  const definition = getVerticalSpreadDefinition(simulation.strategyType); const reasons: string[] = [];
  if (!definition) return { valid: false, reasons: ["vertical strategy type is not selected"] };
  const legs = simulation.optionLegs.filter((leg) => leg.type === definition.optionType); const buy = legs.find((leg) => leg.side === "buy"); const sell = legs.find((leg) => leg.side === "sell");
  if (simulation.optionLegs.length !== 2 || !buy || !sell || legs.length !== 2) reasons.push(`${definition.optionType === "call" ? "C" : "P"}買い1脚と${definition.optionType === "call" ? "C" : "P"}売り1脚が必要です`);
  if (!buy || !sell) return { valid: false, reasons };
  if ((definition.buyStrike === "higher" ? buy.strikeUSD > sell.strikeUSD : buy.strikeUSD < sell.strikeUSD) === false) reasons.push("買い脚と売り脚の行使価格の関係が戦略定義と一致しません");
  if (!buy.expiryDate || buy.expiryDate !== sell.expiryDate || buy.expiryDate !== simulation.expiryDate) reasons.push("両脚の満期が一致していません");
  if (!positiveInteger(buy.quantity) || !positiveInteger(sell.quantity) || buy.quantity !== sell.quantity) reasons.push("両脚は同じ正の整数契約数である必要があります");
  if (!positiveInteger(buy.contractSize) || !positiveInteger(sell.contractSize) || buy.contractSize !== sell.contractSize) reasons.push("両脚の明示的な契約倍率が必要です");
  if (buy.saxoAccountKey && sell.saxoAccountKey && buy.saxoAccountKey !== sell.saxoAccountKey) reasons.push("両脚の口座が一致していません");
  if (simulation.accountCurrency !== "USD") reasons.push("このverticalの実績計算は明示USD約定だけに対応します");
  return reasons.length ? { valid: false, reasons } : { valid: true, value: { definition, buy, sell, contractSize: buy.contractSize!, contracts: buy.quantity } };
}
export function classifyVerticalSpreadLegs(legs: Array<Pick<OptionLeg, "type" | "side" | "strikeUSD" | "expiryDate" | "quantity" | "contractSize">>): VerticalSpreadType | undefined {
  if (legs.length !== 2) return undefined; const buy = legs.find((leg) => leg.side === "buy"); const sell = legs.find((leg) => leg.side === "sell");
  if (!buy || !sell || buy.type !== sell.type || !Number.isFinite(buy.strikeUSD) || !Number.isFinite(sell.strikeUSD) || buy.strikeUSD <= 0 || sell.strikeUSD <= 0 || buy.strikeUSD === sell.strikeUSD || !buy.expiryDate || buy.expiryDate !== sell.expiryDate || !positiveInteger(buy.quantity) || !positiveInteger(sell.quantity) || buy.quantity !== sell.quantity || !positiveInteger(buy.contractSize) || !positiveInteger(sell.contractSize) || buy.contractSize !== sell.contractSize) return undefined;
  if (buy.type === "call") return buy.strikeUSD < sell.strikeUSD ? "bull_call_spread" : "bear_call_spread";
  return buy.strikeUSD < sell.strikeUSD ? "bull_put_spread" : "bear_put_spread";
}
export function isManagedTwoLegStrategy(simulation: TradeSimulation): boolean { return isVerticalSpreadType(simulation.strategyType) || (["synthetic_forward", "combo", "short_strangle", "custom"].includes(simulation.strategyType) && simulation.optionLegs.length === 2); }
export type VerticalSpreadEstimate = { kind: "missing"; reasons: string[] } | { kind: "available"; entryCashflowUSD: number; denominatorUSD?: number; estimatedPnlUSD: number; periodReturnPct?: number; annualizedReturnPct?: number; rateMissingReason?: string; evaluatedLegIds: string[] };
function confirmedCloseCashflowUSD(leg: OptionLeg, execution: NonNullable<TradeSimulation["optionCloseExecutions"]>[number]): number | undefined {
  if (execution.legId !== leg.id || execution.settlementCurrency !== "USD" || !positiveInteger(execution.contracts) || execution.commissionUSD === undefined || !Number.isFinite(execution.commissionUSD)) return undefined;
  const price = execution.closeKind === "expired" ? 0 : execution.closePriceUSD;
  if (price === undefined || !Number.isFinite(price) || price < 0 || !positiveInteger(leg.contractSize)) return undefined;
  return moneySum(moneyProduct(leg.side === "buy" ? 1 : -1, price, execution.contracts, leg.contractSize), -execution.commissionUSD);
}
function annualizedDays(entryDate: string | undefined, asOfDate: string | undefined): number | undefined {
  if (!entryDate || !asOfDate) return undefined;
  const start = new Date(`${entryDate}T00:00:00Z`).getTime(), end = new Date(`${asOfDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
  const days = Math.ceil((end - start) / 86_400_000); return days > 0 ? days : undefined;
}
export function calculateVerticalSpreadEstimate(simulation: TradeSimulation, asOfDate = formatLocalDate()): VerticalSpreadEstimate {
  const validated = validateVerticalSpread(simulation); if (!validated.valid) return { kind: "missing", reasons: validated.reasons };
  const { definition, buy, sell, contractSize, contracts } = validated.value; const entryCash: number[] = [];
  for (const leg of [buy, sell]) { const entries = activeSpreadEntries(simulation, leg); if (!entries.length || entries.reduce((sum, entry) => sum + entry.contracts, 0) !== leg.quantity) return { kind: "missing", reasons: ["建玉開始数量・約定参照 未確認"] }; for (const entry of entries) { if (entry.settlementCurrency !== "USD" || !Number.isFinite(entry.fillPriceUSD) || entry.commissionUSD === undefined || !Number.isFinite(entry.commissionUSD)) return { kind: "missing", reasons: ["建玉時実績・開始費用 未確認"] }; entryCash.push(moneyProduct(leg.side === "buy" ? -1 : 1, entry.fillPriceUSD, entry.contracts, contractSize), -entry.commissionUSD); } }
  const progress = getOptionLegCloseProgress(simulation); if (progress.invalidReason) return { kind: "missing", reasons: [progress.invalidReason] }; const confirmedCash: number[] = [];
  for (const execution of activeSpreadCloses(simulation)) { const leg = [buy, sell].find((item) => item.id === execution.legId); const cashflow = leg ? confirmedCloseCashflowUSD(leg, execution) : undefined; if (cashflow === undefined) return { kind: "missing", reasons: ["確認済み決済実績の価格・費用・契約参照 未確認"] }; confirmedCash.push(cashflow); }
  const currentCash: number[] = [], reasons: string[] = [], evaluatedLegIds: string[] = [];
  for (const leg of [buy, sell]) { const remaining = progress.legs.find((item) => item.legId === leg.id)?.remainingContracts; if (remaining === undefined) return { kind: "missing", reasons: ["脚別残数量 未確認"] }; if (remaining === 0) continue; const price = leg.closePlan?.closePriceUSD ?? leg.closeCostUSD; if (!(price !== undefined && Number.isFinite(price) && price > 0)) { reasons.push((leg.type === "call" ? "C" : "P") + (leg.side === "buy" ? "買い売却価格 未確認" : "売り買戻し価格 未確認")); continue; } const fee = resolveCloseCommissionUSD(simulation, leg, remaining); if (fee.kind !== "resolved") { reasons.push(fee.reason ?? "決済想定手数料 未確認"); continue; } currentCash.push(moneyProduct(leg.side === "buy" ? 1 : -1, price, remaining, contractSize), -fee.amountUSD); evaluatedLegIds.push(leg.id); }
  if (reasons.length) return { kind: "missing", reasons: [...new Set(reasons)] }; const entryCashflowUSD = moneySum(...entryCash); const width = moneyProduct(Math.abs(buy.strikeUSD - sell.strikeUSD), contractSize, contracts); const estimatedPnlUSD = moneySum(entryCashflowUSD, ...confirmedCash, ...currentCash); const creditVerified = definition.debit || simulation.strategyContractVerification?.state === "verified";
  if (!creditVerified) return { kind: "available", entryCashflowUSD, estimatedPnlUSD, rateMissingReason: "契約仕様 未照合のため最大損失基準・率は未計算", evaluatedLegIds };
  const denominatorUSD = definition.debit ? entryCashflowUSD < 0 ? -entryCashflowUSD : undefined : entryCashflowUSD > 0 && width > 0 ? moneySum(width, -entryCashflowUSD) : undefined;
  if (!(denominatorUSD !== undefined && denominatorUSD > 0)) return { kind: "available", entryCashflowUSD, estimatedPnlUSD, rateMissingReason: definition.debit ? "開始ネット支払額 未確認" : "開始最大損失基準 未確認", evaluatedLegIds }; const periodReturnPct = moneyProduct(estimatedPnlUSD, 100) / denominatorUSD; const dates = [buy, sell].flatMap((leg) => activeSpreadEntries(simulation, leg).map((entry) => entry.tradeDate)); const entryDate = dates.length === 2 && dates.every((date) => date === dates[0]) ? dates[0] : undefined; const fullyClosed = progress.legs.every((item) => item.remainingContracts === 0); const terminalDates = fullyClosed ? activeSpreadCloses(simulation).map((item) => item.closeDate) : []; const terminalDatesValid = terminalDates.length > 0 && terminalDates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(new Date(`${date}T00:00:00Z`).getTime())); const terminalDate = terminalDatesValid ? [...terminalDates].sort().at(-1) : undefined; const days = annualizedDays(entryDate, fullyClosed ? terminalDate : asOfDate); return { kind: "available", entryCashflowUSD, denominatorUSD, estimatedPnlUSD, periodReturnPct, annualizedReturnPct: days ? periodReturnPct * 365 / days : undefined, evaluatedLegIds };
}
