import type { OptionLeg, TradeSimulation } from "@/types/domain";
import type { FxQuote } from "@/lib/marketData";
import { resolveCurrentEstimateFx } from "./currentEstimateFx";
import { resolveEvaluationQuote, type EvaluationQuote } from "./midpointEvaluation";
import { getOptionLegOperationalCloseProgress, getOptionLegCloseProgress } from "./optionCloseExecutions";
import { activeSpreadEntries, activeSpreadCloses, spreadCloseMoney, moneySum, moneyProduct } from "./spreadCashflows";
import { resolveCloseCommissionUSD } from "./closeCommissionStandard";
import { calculateVerticalSpreadEstimate, isVerticalSpreadType } from "./verticalSpread";
import { formatLocalDate } from "@/lib/date";
import { storedSaxoValuation } from "./saxoValuation";

export type PriceBasis = "reference" | "conservative-close";
export type BasisResult = {
  basis: PriceBasis;
  kind: "available" | "missing";
  currency: "USD" | "JPY";
  amount?: number;
  referenceJPY?: number;
  denominator?: number;
  periodReturnPct?: number;
  annualizedReturnPct?: number;
  reason?: string;
  rateReason?: string;
  evaluatedLegIds: string[];
  valuationSource?: "saxo-position";
};
export type PositionBasisEvaluation = {
  reference: BasisResult;
  conservative: BasisResult;
  legs: Array<{ leg: OptionLeg; remaining: number; quote: EvaluationQuote }>;
  hint: string;
  needsPricePreview?: boolean;
};
const finite = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);
const positive = (v: number | undefined): v is number => finite(v) && v > 0;

export function quoteForLeg(leg: OptionLeg): EvaluationQuote {
  const q = leg.referenceQuote;
  if (!q) return { kind: "unavailable", quality: "unknown", source: "", fetchedAt: "", reason: "中間値未取得" };
  const resolved = resolveEvaluationQuote({ bid: q.bidUSD, ask: q.askUSD, priceTypeBid: q.priceTypeBid, priceTypeAsk: q.priceTypeAsk,
    source: q.source, fetchedAt: q.fetchedAt, sourceTimestamp: q.sourceTimestamp, delayedByMinutes: q.delayedByMinutes, batchId: q.batchId });
  if (resolved.kind === "confirmable_reference" && !q.referenceConfirmedAt) return { ...resolved, kind: "unavailable", reason: "OldIndicativeの使用確認が必要" };
  return resolved;
}

function calculateQuoteBasisEvaluation(simulation: TradeSimulation, currentFx?: FxQuote | null, asOf = formatLocalDate()): PositionBasisEvaluation {
  const currency = simulation.accountCurrency === "JPY" ? "JPY" : "USD";
  const operational = getOptionLegOperationalCloseProgress(simulation);
  const formal = getOptionLegCloseProgress(simulation);
  const fx = resolveCurrentEstimateFx(simulation, currentFx);
  const missing = (basis: PriceBasis, reason: string): BasisResult => ({ basis, kind: "missing", currency, reason, evaluatedLegIds: [] });
  const invalid = operational.invalidReason ?? formal.invalidReason;
  const legs = operational.legs.flatMap(p => {
    const leg = simulation.optionLegs.find(l => l.id === p.legId);
    return leg && positive(p.remainingContracts) ? [{ leg, remaining: p.remainingContracts, quote: quoteForLeg(leg) }] : [];
  });
  const fail = (reason: string): PositionBasisEvaluation => ({ reference: missing("reference", reason), conservative: missing("conservative-close", reason), legs, hint: reason });
  if (invalid) return fail(invalid);
  if (operational.legs.some(p => p.remainingContracts === undefined || !Number.isInteger(p.remainingContracts) || p.remainingContracts < 0)) return fail("残数量 未確認");
  if (!legs.length) return fail("評価対象の残存脚なし");
  if (legs.some(({leg}) => !Number.isInteger(leg.contractSize) || !positive(leg.contractSize))) return fail("契約倍率 未確認");
  const ids = legs.map(({leg}) => leg.id);
  const batches = new Set(legs.map(({leg}) => leg.referenceQuote?.batchId));
  const coherent = legs.length === 1 || (batches.size === 1 && !batches.has(undefined) && !batches.has(""));
  const absent = legs.filter(({leg}) => !leg.referenceQuote).length;
  const quoteProblem = legs.find(({quote}) => quote.kind === "unavailable")?.quote;
  const referencePriceReason = absent === legs.length ? "中間値の価格をまだ取得していません"
    : absent > 0 ? "一部の脚の中間値が未取得です。両脚の価格をまとめて更新してください"
    : quoteProblem ? quoteProblem.reason ?? "Bid/Askの価格品質を確認してください"
    : !coherent ? "価格の取得タイミングが揃っていません。両脚の価格をまとめて更新してください"
    : undefined;
  const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d+"T00:00:00Z")) && new Date(d+"T00:00:00Z").toISOString().slice(0,10) === d;
  const dates = legs.flatMap(({leg}) => activeSpreadEntries(simulation, leg).map(e => e.tradeDate));
  const dateValid = dates.length > 0 && validDate(asOf) && dates.every(d => validDate(d) && d === dates[0]);
  const days = dateValid ? (Date.parse(asOf+"T00:00:00Z") - Date.parse(dates[0]+"T00:00:00Z")) / 86400000 : undefined;
  function complete(basis: PriceBasis, amount: number, denominator?: number, annual?: number, rateReason?: string): BasisResult {
    if (!Number.isFinite(amount)) return missing(basis, "評価金額が有限ではありません");
    const pct = positive(denominator) ? amount / denominator * 100 : undefined;
    return { basis, kind: "available", currency, amount, denominator, periodReturnPct: pct,
      annualizedReturnPct: dateValid && positive(days) ? annual ?? (finite(pct) ? pct * 365 / days : undefined) : undefined,
      rateReason: rateReason ?? (!positive(denominator) ? "分母 未確認" : !positive(days) ? "保有日数 未確認" : undefined),
      referenceJPY: currency === "USD" && fx.kind === "resolved" ? Math.round(amount * fx.rateJPYPerUSD) : undefined,
      evaluatedLegIds: ids };
  }
  function evaluate(basis: PriceBasis): BasisResult {
    if (basis === "reference" && referencePriceReason) return missing(basis, referencePriceReason);
    const prices = new Map<string, number>();
    for (const {leg, quote} of legs) {
      const price = basis === "reference" ? quote.kind !== "unavailable" ? quote.mid : undefined
        : quote.kind !== "unavailable" ? leg.side === "buy" ? quote.bid : quote.ask : leg.closePlan?.closePriceUSD ?? leg.closeCostUSD;
      if (!positive(price)) return missing(basis, basis === "reference" ? "中間値未取得 / "+(quote.reason ?? "Bid/Ask 未確認") : "保守的な決済価格 未取得");
      prices.set(leg.id, price);
    }
    if (isVerticalSpreadType(simulation.strategyType)) {
      if (operational.legs.some(p => p.remainingContracts !== formal.legs.find(f => f.legId === p.legId)?.remainingContracts)) return missing(basis, "決済約定済み・精算情報待ち");
      const result = calculateVerticalSpreadEstimate(simulation, asOf, leg => prices.get(leg.id));
      return result.kind === "available" ? complete(basis, result.estimatedPnlUSD, result.denominatorUSD, result.annualizedReturnPct, result.rateMissingReason) : missing(basis, result.reasons.join(" / "));
    }
    const cash: number[] = [];
    const entryCash: number[] = [];
    for (const {leg, remaining} of legs) {
      const entries = activeSpreadEntries(simulation, leg);
      if (!entries.length || new Set(entries.map(e => e.id)).size !== entries.length || entries.some(e => !Number.isInteger(e.contracts) || e.contracts <= 0) || entries.reduce((s,e) => s+e.contracts,0) !== leg.quantity) return missing(basis, "建玉時実績・開始数量 未確認");
      const closeFee = resolveCloseCommissionUSD(simulation, leg, remaining);
      if (closeFee.kind !== "resolved") return missing(basis, closeFee.reason ?? "決済想定手数料 未確認");
      let entryAmount: number;
      if (currency === "JPY") {
        if (entries.some(e => e.settlementCurrency !== "JPY" || !finite(e.brokerBookedAmountJPY)) || remaining !== leg.quantity) return missing(basis, "確認済みJPY開始記帳額 未確認");
        entryAmount = moneySum(...entries.map(e => e.brokerBookedAmountJPY!));
        if (fx.kind !== "resolved") return missing(basis, "現在換算為替 未確認");
        cash.push(Math.round(moneySum(moneyProduct(leg.side === "buy" ? 1 : -1, prices.get(leg.id)!, remaining, leg.contractSize!), -closeFee.amountUSD) * fx.rateJPYPerUSD));
      } else {
        if (entries.some(e => e.settlementCurrency !== "USD" || !finite(e.fillPriceUSD) || e.fillPriceUSD < 0 || !finite(e.commissionUSD))) return missing(basis, "建玉時実績・開始費用 未確認");
        entryAmount = moneySum(...entries.flatMap(e => [moneyProduct(leg.side === "buy" ? -1 : 1, e.fillPriceUSD, e.contracts, leg.contractSize!), -e.commissionUSD!]));
        // Remove only explicitly allocated closed lots. No guessed lot order or fee proration.
        for (const close of activeSpreadCloses(simulation).filter(e => e.legId === leg.id)) {
          const allocation = spreadCloseMoney(simulation, close);
          if (!allocation) return missing(basis, "残存開始約定の配賦 未確認");
          entryAmount = moneySum(entryAmount, allocation.entryDebitUSD);
        }
        if (remaining !== formal.legs.find(p => p.legId === leg.id)?.remainingContracts) return missing(basis, "決済約定済み・精算情報待ち");
        cash.push(moneyProduct(leg.side === "buy" ? 1 : -1, prices.get(leg.id)!, remaining, leg.contractSize!), -closeFee.amountUSD);
      }
      entryCash.push(entryAmount);
    }
    const entry = moneySum(...entryCash);
    const pnl = moneySum(entry, ...cash);
    let denominator: number | undefined;
    if (currency === "JPY" || legs.every(({leg}) => leg.side === "buy")) denominator = entry < 0 ? -entry : undefined;
    else if (legs.every(({leg}) => leg.side === "sell" && leg.type === "put")) denominator = moneySum(...legs.map(({leg,remaining}) => moneyProduct(leg.strikeUSD, leg.contractSize!, remaining)));
    else if (simulation.strategyType === "synthetic_forward") denominator = moneySum(...legs.filter(({leg})=>leg.type==="put" && leg.side==="sell").map(({leg,remaining})=>moneyProduct(leg.strikeUSD, leg.contractSize!, remaining)), Math.max(0,-entry));
    return complete(basis, pnl, denominator);
  }
  const hints = [legs.some(l=>l.quote.quality==="old_indicative") ? "OldIndicative・参考値" : "", legs.some(l=>positive(l.quote.delayedByMinutes)) ? "遅延気配" : legs.some(l=>l.quote.delayedByMinutes===undefined) ? "遅延時間未確認" : "", legs.some(l=>!l.quote.sourceTimestamp) ? "元気配時刻未確認" : ""].filter(Boolean);
  function safeEvaluate(basis: PriceBasis): BasisResult {
    try { return evaluate(basis); }
    catch (error) {
      if (error instanceof Error && /finite money evidence|invalid money allocation|cannot be converted to a BigInt/.test(error.message)) return missing(basis, "評価金額または配賦が有効範囲外");
      throw error;
    }
  }
  const reference = safeEvaluate("reference"), conservative = safeEvaluate("conservative-close");
  if (reference.kind === "missing" && conservative.denominator !== undefined) reference.denominator = conservative.denominator;
  return { reference, conservative, legs, hint: hints.join(" / "), needsPricePreview: referencePriceReason !== undefined };
}

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
