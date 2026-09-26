import type { TradeSimulation } from "@/types/domain";
import { getCurrentOptionPriceTargets, type CurrentOptionPricePreviewRow } from "./bulkOptionPrice";
import { resolveEvaluationQuote } from "./midpointEvaluation";
import { parentPriceBasis, valuationProblem } from "./saxoValuation";

export type PriceUpdateAdoption = { simulationIds: string[]; referenceConfirmed: boolean };
export type PriceLegDiagnostic = {
  legId: string; label: string; bid?: number; ask?: number; priceTypeBid?: string; priceTypeAsk?: string; fetchedAt?: string; source?: string;
  acquisition: "received" | "failed" | "unmatched";
  evaluation: "ready" | "confirmation_required" | "unavailable";
  reason: string;
};
export type PriceUpdateDiagnostic = {
  simulationId: string; ticker: string; legs: PriceLegDiagnostic[];
  acquisition: "received" | "partial" | "failed";
  evaluation: "ready" | "confirmation_required" | "unavailable";
  adoption: "eligible" | "blocked" | "confirmation_required";
  storage: "updated" | "previous" | "none" | "not_applied";
  reason: string; summary: string; hasSavedMid: boolean;
};

function diagnoseMidpointUpdate(simulation: TradeSimulation, rows: CurrentOptionPricePreviewRow[], confirmed = false, adoption?: PriceUpdateAdoption): PriceUpdateDiagnostic | undefined {
  const relevant = rows.filter(row => row.target.simulationId === simulation.id);
  if (!relevant.length) return undefined;
  const targets = getCurrentOptionPriceTargets([simulation]);
  if (!targets.length) return undefined;
  const attempted = adoption?.simulationIds.includes(simulation.id) ?? false;
  const accepted = attempted ? adoption!.referenceConfirmed : confirmed;
  const legs = targets.map(target => {
    const matches = relevant.filter(row => row.target.targetId === target.targetId);
    const row = matches.length === 1 ? matches[0] : undefined;
    const identity = row && row.target.quantity === target.quantity && row.target.side === target.side && row.target.optionType === target.optionType && row.target.strike === target.strike && row.target.expiry === target.expiry;
    const candidate = identity ? row.candidate : undefined;
    const quote = candidate?.status === "available" ? resolveEvaluationQuote({ bid: candidate.bid, ask: candidate.ask, priceTypeBid: candidate.quoteDiagnostics?.priceTypeBid, priceTypeAsk: candidate.quoteDiagnostics?.priceTypeAsk, source: candidate.source, fetchedAt: candidate.fetchedAt }) : undefined;
    const acquisition: PriceLegDiagnostic["acquisition"] = !identity ? "unmatched" : candidate ? "received" : "failed";
    const evaluation: PriceLegDiagnostic["evaluation"] = !quote || quote.kind === "unavailable" ? "unavailable" : quote.kind === "confirmable_reference" && !accepted ? "confirmation_required" : "ready";
    return { legId: target.legId, label: `${target.optionType === "call" ? "C" : "P"}${target.side === "buy" ? "買い" : "売り"}`,
      bid: candidate?.bid, ask: candidate?.ask, priceTypeBid: candidate?.quoteDiagnostics?.priceTypeBid, priceTypeAsk: candidate?.quoteDiagnostics?.priceTypeAsk, fetchedAt: candidate?.fetchedAt, source: candidate?.source,
      acquisition, evaluation, reason: !identity ? "対象脚と取得応答が一致しません" : !quote ? row?.reason ?? "API取得失敗" : quote.reason ?? "Bid/Askから中間値を評価可能" };
  });
  const stored = targets.map(target => simulation.optionLegs.find(leg => leg.id === target.legId)?.referenceQuote);
  const valid = stored.every(q => {
    if (!q || !Number.isFinite(q.midUSD)) return false;
    const evaluated = resolveEvaluationQuote({ bid: q.bidUSD, ask: q.askUSD, priceTypeBid: q.priceTypeBid, priceTypeAsk: q.priceTypeAsk, source: q.source, fetchedAt: q.fetchedAt });
    return evaluated.kind !== "unavailable" && evaluated.mid === q.midUSD && (evaluated.kind !== "confirmable_reference" || !!q.referenceConfirmedAt);
  });
  const batches = new Set(stored.map(q => q?.batchId));
  const hasSavedMid = valid && (targets.length === 1 || batches.size === 1 && !!stored[0]?.batchId);
  const unavailable = legs.some(leg => leg.evaluation === "unavailable");
  const waiting = legs.some(leg => leg.evaluation === "confirmation_required");
  const evaluation = unavailable ? "unavailable" : waiting ? "confirmation_required" : "ready";
  const updated = attempted && hasSavedMid && evaluation === "ready" && targets.every((target, index) => {
    const row = relevant.find(value => value.target.targetId === target.targetId);
    return stored[index]?.fetchedAt === row?.candidate?.fetchedAt && stored[index]?.bidUSD === row?.candidate?.bid && stored[index]?.askUSD === row?.candidate?.ask;
  });
  const storage = updated ? "updated" : hasSavedMid ? "previous" : evaluation === "ready" ? "not_applied" : "none";
  const reason = unavailable ? legs.filter(leg => leg.evaluation === "unavailable").map(leg => `${leg.label}: ${leg.reason}`).join(" / ")
    : waiting ? "OldIndicativeの参考価格使用を確認してください" : attempted && !updated ? "取得後に価格・数量等が変わったため採用できませんでした" : "全残存脚の中間値候補が揃っています";
  const summary = updated ? "中間値を更新しました" : waiting ? "参考価格の使用確認待ち"
    : evaluation === "ready" && !attempted ? "取得済み・中間値は未反映"
    : hasSavedMid ? "今回未更新・保存済み参考値" : "中間値を取得できませんでした";
  return { simulationId: simulation.id, ticker: simulation.ticker, legs,
    acquisition: legs.every(leg => leg.acquisition === "received") ? "received" : legs.some(leg => leg.acquisition === "received") ? "partial" : "failed",
    evaluation, adoption: unavailable || attempted && !updated ? "blocked" : waiting ? "confirmation_required" : "eligible",
    storage, reason: targets.length > 1 && unavailable ? `${reason}。残存全脚が揃うまで親の中間値を更新しません` : reason, summary, hasSavedMid };
}

export function diagnosePriceUpdate(simulation:TradeSimulation,rows:CurrentOptionPricePreviewRow[],confirmed=false,adoption?:PriceUpdateAdoption):PriceUpdateDiagnostic|undefined {
  const result=diagnoseMidpointUpdate(simulation,rows,confirmed,adoption);
  if(!result || parentPriceBasis(simulation,rows,true)!=="saxo-position")return result;
  const attempted=adoption?.simulationIds.includes(simulation.id)??false;
  const accepted=attempted?adoption!.referenceConfirmed:confirmed;
  const relevant=rows.filter(r=>r.target.simulationId===simulation.id);
  const waiting=relevant.some(r=>valuationProblem(r.saxoValuation,accepted));
  const updated=attempted && !waiting && simulation.currentValuationBasis?.kind==="saxo-position" && relevant.every(r=>simulation.optionLegs.find(l=>l.id===r.target.legId)?.saxoValuation?.batchId===r.saxoValuation?.batchId);
  return {...result,evaluation:waiting?"confirmation_required":"ready",adoption:waiting?"confirmation_required":"eligible",storage:updated?"updated":simulation.currentValuationBasis?.kind==="saxo-position"?"previous":"not_applied",reason:waiting?"Saxo参考評価の使用確認が必要":"残存全脚をSaxo評価へ揃えます",summary:updated?"Saxo評価を更新しました":waiting?"Saxo参考評価の使用確認待ち":"取得済み・Saxo評価は未反映"};
}
