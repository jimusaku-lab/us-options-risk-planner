import { useState } from "react";
import type { TradeSimulation } from "@/types/domain";
import { prepareStrategyImport, resolveStrategyFillExecution, strategyContractState, type PreparedStrategyImport, type StrategyCandidate, type StrategyLedger } from "@/domain/strategyLedger";

export function SpreadStrategyCandidates({ candidates, ledger, simulations, onCommit }: { candidates: StrategyCandidate[]; ledger: StrategyLedger; simulations: TradeSimulation[]; onCommit: (prepared: PreparedStrategyImport, requestRevision: number) => Promise<{ reasons?: string[] }> }) {
  const [prepared, setPrepared] = useState<PreparedStrategyImport>();
  const [reasons, setReasons] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  if (!candidates.length) return null;
  return <section aria-label="スプレッドの組み合わせ確認" className="rounded border border-indigo-200 p-3">
    <h3 className="text-sm font-bold">スプレッドの組み合わせ確認</h3>
    <p className="text-xs text-slate-600">既存約定への参照をまとめます。注文・現金反映は行いません。</p>
    {candidates.map(candidate => <div key={candidate.id} className="mt-2 rounded border p-2">
      <p className="text-sm font-bold">{candidate.fills[0].contract.ticker} / {strategyContractState(candidate) === "unknown" ? "2脚の組み合わせ" : "Bear Put Spread"} / {candidate.contracts}組</p>
      {strategyContractState(candidate) === "unknown" ? <p className="text-xs">ベア・プットとして管理／契約仕様未照合</p> : null}
      <dl className="grid gap-2 text-xs sm:grid-cols-2">{candidate.fills.map(fill => { const execution = resolveStrategyFillExecution(fill, simulations); return <div key={fill.key}><dt>{fill.contract.side === "buy" ? "P買い" : "P売り"} {fill.contract.strike} / {fill.contract.expiry}</dt><dd>{execution?.tradeDate ?? "約定日未取得"} / {execution?.contracts ?? "数量未取得"}枚 / 単価 {execution?.fillPriceUSD ?? "未取得"} USD / 実費 {execution?.commissionUSD ?? "未取得"} USD / {fill.existing ? "既存記録を参照" : "取得済み約定"}</dd></div>; })}</dl>
      <button type="button" className="mt-2 rounded bg-indigo-700 px-3 py-2 text-xs font-bold text-white" disabled={saving} onClick={() => { const result = prepareStrategyImport(candidate, ledger, simulations); if ("reasons" in result) { setPrepared(undefined); setReasons(result.reasons); } else { setPrepared(result); setReasons([]); } }}>組み合わせを確認</button>
    </div>)}
    {reasons.length ? <p role="alert" className="mt-2 text-sm text-amber-800">{reasons.join(" / ")}</p> : null}
    {prepared ? <div className="mt-2 rounded bg-indigo-50 p-3"><p className="text-sm">この2本を1つの戦略として管理します。開始実績は上記の明示値を使い、欠損は補いません。</p><button type="button" disabled={saving} className="mt-2 rounded bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={async () => {
      const current = candidates.find(candidate => candidate.id === prepared.candidate.id);
      if (!current) { setPrepared(undefined); setReasons(["取得状態が変わりました。組み合わせを再確認してください"]); return; }
      setSaving(true);
      try { const result = await onCommit(prepared, current.requestRevision); if (result.reasons) setReasons(result.reasons); else { setPrepared(undefined); setReasons([]); } }
      finally { setSaving(false); }
    }}>このスプレッドを反映</button></div> : null}
  </section>;
}
