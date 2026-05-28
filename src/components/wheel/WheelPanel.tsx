import type { WheelCycle } from "@/types/domain";
import { formatJPY, formatUSD } from "@/lib/format";

export function WheelPanel({ cycles, onCreateFromSelected }: { cycles: WheelCycle[]; onCreateFromSelected?: () => void }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-950">ホイール管理</h2>
        {onCreateFromSelected ? (
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={onCreateFromSelected}
          >
            選択建玉からサイクル作成
          </button>
        ) : null}
      </div>
      {cycles.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-slate-600">
          まだホイールサイクルはありません。P売り、株取得、カバードコール、株売却をサイクル単位で記録する領域です。
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {cycles.map((cycle) => (
            <div key={cycle.id} className="rounded-md border border-slate-200 p-3 text-sm">
              <div className="font-bold text-slate-950">
                {cycle.ticker} / {cycle.phase}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                <Metric label="累積プレミアム" value={formatJPY(cycle.cumulativePremiumJPY)} />
                <Metric label="累積実現損益" value={formatJPY(cycle.cumulativeRealizedPnlJPY)} />
                <Metric label="現在株数" value={`${cycle.currentShares}株`} />
                <Metric label="取得単価" value={formatUSD(cycle.currentCostBasisUSD)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="numeric-input font-bold text-slate-950">{value}</div>
    </div>
  );
}
