import type { BasisResult } from "@/domain/positionBasisEvaluation";
import { calculatePositionBasisEvaluation } from "@/domain/positionBasisEvaluation";
import type { TradeSimulation } from "@/types/domain";
import type { FxQuote } from "@/lib/marketData";

export function formatBasisAmount(result: BasisResult): string {
  if (result.amount === undefined) return "未計算";
  return result.currency === "JPY" ? (result.amount >= 0 ? "+" : "-")+Math.abs(result.amount).toLocaleString("ja-JP",{maximumFractionDigits:0})+"円"
    : (result.amount >= 0 ? "+" : "-")+"$"+Math.abs(result.amount).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
}
export function BasisMetric({result,label,compact=false}:{result:BasisResult;label?:string;compact?:boolean}) {
  const tone=(value:number|undefined)=>value===undefined||value===0?"text-slate-700":value>0?"text-emerald-700":"text-rose-700";
  return <div className="text-sm"><span className="block text-xs font-semibold">{label ?? (result.valuationSource === "saxo-position" ? "Saxo評価（USD）" : "参考損益（中間値）")}</span>
    <span className={`block font-bold ${tone(result.amount)}`}>{formatBasisAmount(result)}</span>
    {result.kind==="missing" ? compact ? null : <span className="block text-xs text-amber-800">{result.reason}</span> : <>
      <span className={`block text-xs ${tone(result.periodReturnPct)}`}>参考損益率 {result.periodReturnPct===undefined?"未計算":result.periodReturnPct.toFixed(1)+"%"}</span>
      {!compact && result.rateReason ? <span className="block text-xs text-slate-500">{result.rateReason}</span>:null}
    </>}
  </div>;
}
export function PositionBasisCard({simulation,fx}:{simulation:TradeSimulation;fx?:FxQuote|null}) {
  const estimate=calculatePositionBasisEvaluation(simulation,fx);
  return <section aria-label="現在評価の価格基準" className="mt-3 min-w-0 rounded border border-indigo-200 bg-white p-3">
    <div className="grid gap-3 md:grid-cols-2">{[estimate.reference,estimate.conservative].map(result=><div key={result.basis} className="min-w-0 rounded bg-slate-50 p-3">
      <h3 className="font-bold">{result.basis==="reference"?result.valuationSource==="saxo-position"?"Saxo評価（USD）":"中間値の参考評価":"保守的な決済目安"}</h3>
      <BasisMetric result={result} label={result.basis==="reference"?"参考損益":"決済目安損益"}/>
      <p className="text-xs">分母 {result.denominator===undefined?"未確認":(result.currency==="JPY"?"¥":"$")+result.denominator.toLocaleString("en-US",{minimumFractionDigits:result.currency==="USD"?2:0})}</p>
      <p className="text-xs">年率換算 {result.annualizedReturnPct===undefined?"未計算":result.annualizedReturnPct.toFixed(1)+"%"}</p>
      {result.currency==="USD"?<p className="text-xs">参考JPY {result.referenceJPY===undefined?"為替未取得":result.referenceJPY.toLocaleString("ja-JP")+"円"}</p>:null}
    </div>)}</div>
    <p className="text-xs text-slate-500">保守評価は気配がある脚では買いBid / 売りAsk、気配未取得の脚では保存済み決済候補（手入力を含む）を使用。</p>
    <p className="mt-2 text-xs text-slate-600">Midは約定保証のない参考値です。{estimate.hint}</p>
    <details className="mt-2 text-xs"><summary>脚別価格・取得根拠 {estimate.legs.length}脚</summary>
      {simulation.currentValuationBasis?.kind === "saxo-position" ? <div>採用基準: Saxo評価 / 採用日時 {simulation.currentValuationBasis.capturedAt}
        {estimate.legs.map(({leg})=>leg.saxoValuation ? <p key={leg.id} className="mt-2 break-words">{leg.type==="call"?"C":"P"} {leg.side==="buy"?"買い":"売り"}: 評価価格 {leg.saxoValuation.currentPrice??"未取得"} / 取引損益USD {leg.saxoValuation.profitLossOnTrade??"未取得"} / 符号付き費用USD {leg.saxoValuation.tradeCostsTotal??"未取得"} / 品質 {leg.saxoValuation.currentPriceType} / 信頼性 {leg.saxoValuation.calculationReliability} / 遅延 {leg.saxoValuation.delayedByMinutes===undefined?"未確認":leg.saxoValuation.delayedByMinutes+"分"} / 取得日時 {leg.saxoValuation.fetchedAt} / 元評価時刻 {leg.saxoValuation.sourceTimestamp??"未確認"}</p>:null)}
        <p>以下は以前に取得した中間値の証拠です。今回のSaxo評価とは別の基準・取得時点です。</p>
      </div>:null}
      {estimate.legs.map(({leg,remaining,quote})=><p key={leg.id} className="mt-2 break-words">{leg.type==="call"?"C":"P"} {leg.side==="buy"?"買い":"売り"} {remaining}枚:
        Bid {quote.bid??"未取得"} / Ask {quote.ask??"未取得"} / Mid {quote.mid??"未取得"} / スプレッド {quote.spread??"未取得"} / スプレッド率 {quote.spreadRate===undefined?"未確認":(quote.spreadRate*100).toFixed(1)+"%"}
        {" / "}品質 {quote.priceTypeBid??"未確認"} / {quote.priceTypeAsk??"未確認"} / 取得元 {quote.source||"未確認"}
        {" / "}取得日時 {quote.fetchedAt||"未取得"} / 元気配時刻 {quote.sourceTimestamp??"未確認"} / 遅延 {quote.delayedByMinutes===undefined?"未確認":quote.delayedByMinutes+"分"}
      </p>)}
    </details>
  </section>;
}
