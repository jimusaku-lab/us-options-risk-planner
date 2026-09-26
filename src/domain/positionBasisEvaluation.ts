import type { TradeSimulation } from "@/types/domain";
import type { FxQuote } from "@/lib/marketData";
import { resolveCurrentEstimateFx } from "./currentEstimateFx";
import { activeSpreadEntries } from "./spreadCashflows";
import { formatLocalDate } from "@/lib/date";
import { storedSaxoValuation } from "./saxoValuation";
import { calculateQuoteBasisEvaluation, type PositionBasisEvaluation } from "./quoteBasisEvaluation";
export { quoteForLeg } from "./quoteBasisEvaluation";
export type { PriceBasis, BasisResult, PositionBasisEvaluation } from "./quoteBasisEvaluation";
const positive = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v) && v > 0;

export function calculatePositionBasisEvaluation(simulation: TradeSimulation, currentFx?: FxQuote | null, asOf = formatLocalDate()): PositionBasisEvaluation {
  const result = calculateQuoteBasisEvaluation(simulation,currentFx,asOf);
  if (simulation.currentValuationBasis?.kind !== "saxo-position") return result;
  const stored = storedSaxoValuation(simulation);
  const fx = resolveCurrentEstimateFx(simulation,currentFx);
  const denominator = result.conservative.currency === "USD" ? result.conservative.denominator : undefined;
  const pct = stored.amount !== undefined && positive(denominator) ? stored.amount / denominator * 100 : undefined;
  const entries = result.legs.flatMap(({leg})=>activeSpreadEntries(simulation,leg));
  const dates = new Set(entries.map(e=>e.tradeDate));
  const validDate = (d:string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d+"T00:00:00Z")) && new Date(d+"T00:00:00Z").toISOString().slice(0,10) === d;
  const days = dates.size === 1 && validDate(asOf) && entries.every(e=>validDate(e.tradeDate)) ? (Date.parse(asOf+"T00:00:00Z") - Date.parse(entries[0].tradeDate+"T00:00:00Z"))/86400000 : undefined;
  return { ...result, reference: {
    basis:"reference", valuationSource:"saxo-position", currency:"USD", kind:stored.amount === undefined ? "missing" : "available",
    amount:stored.amount, reason:stored.reason, denominator, periodReturnPct:pct,
    annualizedReturnPct:pct !== undefined && positive(days) ? pct*365/days : undefined,
    rateReason:!positive(denominator)?"同一通貨の分母 未確認":!positive(days)?"保有日数 未確認":undefined,
    referenceJPY:stored.amount !== undefined && fx.kind === "resolved" ? Math.round(stored.amount*fx.rateJPYPerUSD):undefined,
    evaluatedLegIds:result.legs.map(({leg})=>leg.id),
  }, hint:"Saxo評価（取引通貨USD）。取引損益＋符号付き取引費用。アプリ手数料の再控除なし。", needsPricePreview:stored.amount === undefined };
}
