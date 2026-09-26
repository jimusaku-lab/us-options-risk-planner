export type EvaluationQuoteInput = {
  bid?: number;
  ask?: number;
  priceTypeBid?: string;
  priceTypeAsk?: string;
  fetchedAt: string;
  source: string;
  sourceTimestamp?: string;
  delayedByMinutes?: number;
  batchId?: string;
};

export type EvaluationQuote = {
  priceTypeBid?: string;
  priceTypeAsk?: string;
  kind: "available" | "confirmable_reference" | "unavailable";
  bid?: number;
  ask?: number;
  mid?: number;
  spread?: number;
  spreadRate?: number;
  quality: "current" | "old_indicative" | "unknown";
  fetchedAt: string;
  source: string;
  sourceTimestamp?: string;
  delayedByMinutes?: number;
  batchId?: string;
  reason?: string;
};

const finite = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);

export function resolveEvaluationQuote(input: EvaluationQuoteInput): EvaluationQuote {
  const base = { priceTypeBid: input.priceTypeBid, priceTypeAsk: input.priceTypeAsk, fetchedAt: input.fetchedAt, source: input.source, sourceTimestamp: input.sourceTimestamp, delayedByMinutes: input.delayedByMinutes, batchId: input.batchId };
  const forbidden = new Set(["NoAccess", "NoMarket", "None", "Pending", "Theor"]);
  if (forbidden.has(input.priceTypeBid ?? "") || forbidden.has(input.priceTypeAsk ?? "")) return { ...base, kind: "unavailable", quality: "unknown", bid: input.bid, ask: input.ask, reason: "許可されない価格品質" };
  if (!finite(input.bid) || !finite(input.ask) || input.bid! < 0 || input.ask! <= 0 || input.bid! > input.ask!) {
    return { ...base, kind: "unavailable", quality: "unknown", bid: input.bid, ask: input.ask, reason: "Bid/Askが両方そろっていないか無効" };
  }
  const mid = (input.bid! + input.ask!) / 2;
  if (!Number.isFinite(mid)) return { ...base, kind: "unavailable", quality: "unknown", bid: input.bid, ask: input.ask, reason: "Bid/Askの合計が有限ではありません" };
  const spread = input.ask! - input.bid!;
  const recognized = ["Indicative", "Tradable", "OldIndicative"];
  if (!recognized.includes(input.priceTypeBid ?? "") || !recognized.includes(input.priceTypeAsk ?? "")) return { ...base, kind: "unavailable", quality: "unknown", bid: input.bid, ask: input.ask, reason: "価格品質が未確認" };
  const old = input.priceTypeBid === "OldIndicative" || input.priceTypeAsk === "OldIndicative";
  const quality = old ? "old_indicative" : "current";
  return { ...base, kind: old ? "confirmable_reference" : "available", quality, bid: input.bid, ask: input.ask, mid, spread, spreadRate: mid > 0 ? spread / mid : undefined, reason: old ? "OldIndicative（参考値・確認が必要）" : undefined };
}

export function calculateReferencePnl(input: { side: "buy" | "sell"; startPrice: number; quote: { bid: number; ask: number }; contracts: number; contractSize: number; entryFee: number; closeFee: number }): { referencePnl: number; conservativePnl: number } {
  const multiplier = input.contracts * input.contractSize;
  const sign = input.side === "buy" ? 1 : -1;
  const mid = (input.quote.bid + input.quote.ask) / 2;
  const fees = input.entryFee + input.closeFee;
  const referencePnl = sign * (mid - input.startPrice) * multiplier - fees;
  const close = input.side === "buy" ? input.quote.bid : input.quote.ask;
  const conservativePnl = sign * (close - input.startPrice) * multiplier - fees;
  return { referencePnl, conservativePnl };
}

export type ReferenceLegEvaluation = { legId: string; side: "buy" | "sell"; startPrice: number; contractSize?: number; quantity: number; quote?: EvaluationQuote; entryFee?: number; closeFee?: number };

/** Persist only after explicit adoption; the provider Mid is deliberately ignored. */
export function captureReferenceQuote(quote: EvaluationQuote | undefined, batchId: string, confirmedAt?: string) {
  if (!quote || quote.kind === "unavailable" || (quote.kind === "confirmable_reference" && !confirmedAt)) return undefined;
  return { bidUSD: quote.bid, askUSD: quote.ask, midUSD: quote.mid, spreadUSD: quote.spread, spreadRate: quote.spreadRate,
    quality: quote.quality, priceTypeBid: quote.priceTypeBid, priceTypeAsk: quote.priceTypeAsk,
    fetchedAt: quote.fetchedAt, source: quote.source, sourceTimestamp: quote.sourceTimestamp,
    delayedByMinutes: quote.delayedByMinutes, batchId, referenceConfirmedAt: quote.kind === "confirmable_reference" ? confirmedAt : undefined,
    basisVersion: "r15-midpoint-v1" as const };
}
export function calculateReferencePositionPnl(legs: ReferenceLegEvaluation[]): { kind: "available" | "missing"; pnlUSD?: number; reason?: string } {
  let pnl = 0;
  for (const leg of legs) {
    if (!leg.quote || (leg.quote.kind !== "available" && leg.quote.kind !== "confirmable_reference") || leg.quote.mid === undefined) return { kind: "missing", reason: `${leg.legId}の中間値未取得` };
    if (!Number.isInteger(leg.contractSize) || leg.contractSize! <= 0 || !Number.isFinite(leg.quantity) || leg.quantity <= 0) return { kind: "missing", reason: `${leg.legId}の契約倍率または残数量未確認` };
    if (!Number.isFinite(leg.startPrice) || !Number.isFinite(leg.entryFee) || !Number.isFinite(leg.closeFee)) return { kind: "missing", reason: `${leg.legId}の開始/決済費用未確認` };
    const sign = leg.side === "buy" ? 1 : -1;
    pnl += sign * (leg.quote.mid - leg.startPrice) * leg.contractSize! * leg.quantity - leg.entryFee! - leg.closeFee!;
  }
  return { kind: "available", pnlUSD: pnl };
}
