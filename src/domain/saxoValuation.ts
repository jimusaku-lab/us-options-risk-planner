import type { SavedSaxoValuation, TradeSimulation } from "@/types/domain";
import type { SaxoApiPositionSnapshot } from "@/features/saxo/saxoAccountSync";
import { getCurrentOptionPriceTargets, type CurrentOptionPricePreviewRow, type CurrentOptionPriceTarget } from "./bulkOptionPrice";
import { moneySum } from "./spreadCashflows";

const finite = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const ticker = (s: string | undefined) => s?.trim().toUpperCase();
export function previewNeedsReferenceConsent(row:CurrentOptionPricePreviewRow):boolean {
  return row.status==="confirmable_reference" || (!valuationProblem(row.saxoValuation,true) && valuationNeedsConsent(row.saxoValuation!) && row.referenceQuote?.kind!=="available");
}
export function valuationNeedsConsent(v: SavedSaxoValuation): boolean {
  return v.calculationReliability !== "Ok" || v.currentPriceType !== "Tradable" || (v.delayedByMinutes !== undefined && v.delayedByMinutes > 0);
}
export function valuationProblem(v: SavedSaxoValuation | undefined, confirmed = false): string | undefined {
  if (!v) return "Saxo評価証拠が未取得";
  if (v.source !== "Saxo.PositionView" || !Number.isFinite(Date.parse(v.fetchedAt)) || !v.batchId) return "Saxo評価の取得根拠が未確認";
  if (v.quoteCurrency !== "USD" || v.quoteCurrencySource !== "InstrumentDetails.CurrencyCode") return "Saxo評価の取引通貨が未確認・未対応";
  if (!finite(v.currentPrice) || v.currentPrice < 0) return "Saxo評価価格が未取得・無効";
  if (!finite(v.profitLossOnTrade) || !finite(v.tradeCostsTotal)) return "Saxo評価損益・符号付き費用が未取得";
  if (!["Ok", "OkWithConditions", "ApproximatedPrice"].includes(v.calculationReliability ?? "")) return "Saxo評価の計算信頼性が未確認・使用不可";
  if (!["Tradable", "Indicative", "OldIndicative"].includes(v.currentPriceType ?? "")) return "Saxo評価の価格品質が未確認・使用不可";
  if (v.delayedByMinutes !== undefined && (!finite(v.delayedByMinutes) || v.delayedByMinutes < 0)) return "Saxo評価の遅延情報が無効";
  if (valuationNeedsConsent(v) && !confirmed && !v.confirmedAt) return "Saxo参考評価の使用確認が必要";
  return undefined;
}

function sameTarget(v: SavedSaxoValuation, t: CurrentOptionPriceTarget, simulation: TradeSimulation) {
  const i = v.identity;
  if (!i) return false;
  return !!t.accountKey && i.accountKey === t.accountKey && i.environment === "live" &&
    ["PROD_N_USD_SETTLEMENT", "PROD_P_JPY_SETTLEMENT"].includes(simulation.accountEnvironment) &&
    (!t.positionId || t.positionId === i.positionId) && (!t.uic || t.uic === i.uic) &&
    ticker(i.ticker) === ticker(t.ticker) && i.optionType === t.optionType && i.strike === t.strike && i.expiry === t.expiry && i.side === t.side && i.quantity === t.quantity;
}

export function samePriceTarget(a: CurrentOptionPriceTarget, b: CurrentOptionPriceTarget): boolean {
  return a.targetId === b.targetId && a.simulationId === b.simulationId && a.legId === b.legId &&
    a.accountKey === b.accountKey && a.uic === b.uic && a.positionId === b.positionId && a.instrumentCode === b.instrumentCode &&
    a.accountEnvironment === b.accountEnvironment && a.accountCurrency === b.accountCurrency && a.contractSize === b.contractSize &&
    ticker(a.ticker) === ticker(b.ticker) && a.strategyType === b.strategyType && a.quantity === b.quantity && a.side === b.side &&
    a.optionType === b.optionType && a.strike === b.strike && a.expiry === b.expiry && a.savedPriceUSD === b.savedPriceUSD;
}

/** Same acquisition only; no raw payload or account-level currency is copied. */
export function attachPositionValuations(simulations: TradeSimulation[], rows: CurrentOptionPricePreviewRow[], positions: SaxoApiPositionSnapshot[], environment: "live" | "sim", batchId: string): CurrentOptionPricePreviewRow[] {
  const targets = getCurrentOptionPriceTargets(simulations);
  const matches = new Map(targets.map(t => [t.targetId, positions.filter(p =>
    !!t.accountKey && p.accountKey === t.accountKey && environment === "live" && p.kind === "option" && p.assetType === "StockOption" &&
    (!t.positionId || p.positionId === t.positionId) && (!t.uic || p.uic === t.uic) &&
    ticker(p.underlyingSymbol ?? p.symbol) === ticker(t.ticker) && p.optionType === t.optionType && p.strike === t.strike && p.expiry === t.expiry &&
    p.side === (t.side === "buy" ? "long" : "short") && finite(p.quantity) && Math.abs(p.quantity) === t.quantity &&
    (p.quantity > 0 ? "buy" : "sell") === t.side
  )]));
  return rows.map(row => {
    const simulation = simulations.find(s => s.id === row.target.simulationId);
    const found = matches.get(row.target.targetId) ?? [];
    const p = found.length === 1 ? found[0] : undefined;
    const shared = p && Array.from(matches.values()).filter(values => values.includes(p)).length !== 1;
    if (!simulation || !p || shared) return { ...row, valuationReason: "Saxo評価対象が一意に一致しません" };
    if (p.specificationConflicts?.length) return { ...row, adoptionBlocked: "Saxo契約仕様が競合しています", valuationReason: "Saxo契約仕様が競合しています" };
    const raw = p.valuation;
    if (!raw) return { ...row, valuationReason: "Saxo評価証拠が未取得" };
    const leg = simulation.optionLegs.find(l => l.id === row.target.legId);
    if (leg?.contractSize !== undefined && raw.contractSize !== undefined && leg.contractSize !== raw.contractSize) return { ...row, adoptionBlocked: "契約倍率が競合しています", valuationReason: "契約倍率が競合しています" };
    const v: SavedSaxoValuation = {
      source: "Saxo.PositionView", fetchedAt: raw.fetchedAt, batchId,
      currentPrice: raw.currentPrice, currentPriceType: raw.currentPriceType, calculationReliability: raw.calculationReliability,
      profitLossOnTrade: raw.profitLossOnTrade, tradeCostsTotal: raw.tradeCostsTotal,
      quoteCurrency: raw.quoteCurrency, quoteCurrencySource: raw.quoteCurrencySource,
      delayedByMinutes: raw.delayedByMinutes, sourceTimestamp: raw.sourceTimestamp,
      contractSize: raw.contractSize, contractSizeSource: raw.contractSizeSource,
      identity: { accountKey: p.accountKey, environment, positionId: p.positionId, uic: p.uic, ticker: row.target.ticker, optionType: row.target.optionType, strike: row.target.strike, expiry: row.target.expiry, side: row.target.side, quantity: row.target.quantity },
    };
    if (!sameTarget(v,row.target,simulation)) return { ...row, valuationReason: "Saxo評価の口座・契約が一致しません" };
    return { ...row, saxoValuation: v, valuationReason: valuationProblem(v, true) };
  });
}

export function parentPriceBasis(simulation: TradeSimulation, rows: CurrentOptionPricePreviewRow[], confirmed: boolean): "midpoint" | "saxo-position" | undefined {
  const targets = getCurrentOptionPriceTargets([simulation]);
  if (!targets.length) return undefined;
  const picked = targets.map(t => {
    const found = rows.filter(r => r.target.targetId === t.targetId);
    const row = found.length === 1 ? found[0] : undefined;
    return row && !row.adoptionBlocked && samePriceTarget(row.target,t) ? row : undefined;
  });
  if (picked.some(r => !r)) return undefined;
  if (picked.every(r => r!.referenceQuote?.kind === "available" || confirmed && r!.referenceQuote?.kind === "confirmable_reference")) return "midpoint";
  if (picked.some((r,index) => valuationProblem(r!.saxoValuation,confirmed) || !sameTarget(r!.saxoValuation!,targets[index],simulation))) return undefined;
  const batchIds = new Set(picked.map(r => r!.saxoValuation!.batchId));
  return batchIds.size === 1 ? "saxo-position" : undefined;
}

export function storedSaxoValuation(simulation: TradeSimulation): { amount?: number; reason?: string; evidence: SavedSaxoValuation[] } {
  const targets = getCurrentOptionPriceTargets([simulation]);
  const evidence = targets.map(t => simulation.optionLegs.find(l => l.id === t.legId)?.saxoValuation);
  if (!targets.length || evidence.some((v,index) => !v || valuationProblem(v) || !sameTarget(v,targets[index],simulation) || v.batchId !== simulation.currentValuationBasis?.batchId)) return { reason: "Saxo評価の残数量・契約・品質・取得時点が未確認", evidence: [] };
  try { return { amount: moneySum(...evidence.flatMap(v => [v!.profitLossOnTrade!,v!.tradeCostsTotal!])), evidence: evidence as SavedSaxoValuation[] }; }
  catch { return { reason: "Saxo評価金額が有効範囲外", evidence: [] }; }
}
