import type { StockHoldingEvaluation } from "@/domain/stockHoldingEvaluation";
import { formatJPY, formatPct, formatUSD } from "@/lib/format";

function formatMaybeUSD(value: number | undefined): string {
  return value === undefined ? "未計算" : formatUSD(value);
}

function formatMaybeJPY(value: number | undefined): string {
  return value === undefined ? "参考JPY未計算" : `参考 ${formatJPY(value, { signed: value > 0 })}`;
}

function formatMaybeSignedUSD(value: number | undefined): string {
  if (value === undefined) return "未計算";
  return `${value > 0 ? "+" : ""}${formatUSD(value)}`;
}

function EvaluationMetric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="numeric-input mt-1 text-lg font-bold text-slate-950">{value}</div>
      {note ? <p className="mt-1 text-xs leading-5 text-slate-600">{note}</p> : null}
    </div>
  );
}

export function StockHoldingEvaluationCard({ evaluation, compact = false }: { evaluation?: StockHoldingEvaluation; compact?: boolean }) {
  if (!evaluation) return null;
  const pnlTone =
    evaluation.unrealizedPnlUSD === undefined
      ? "text-slate-950"
      : evaluation.unrealizedPnlUSD >= 0
        ? "text-emerald-700"
        : "text-red-700";
  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-sky-700">N口座保有株の現在評価</p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">
            {evaluation.ticker} / {evaluation.shares}株
          </h2>
          <p className="mt-1 text-sm leading-6 text-sky-950">
            このカードは現在保有中のN口座株式の時価評価です。未売却のため実現損益ではありません。オプション実績・当年成績には含めません。
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-sky-800 ring-1 ring-sky-200">
          取得元: {evaluation.sourceLabel}
        </span>
      </div>
      <div className={`mt-4 grid gap-3 ${compact ? "sm:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-4"}`}>
        <EvaluationMetric label="平均取得単価" value={formatUSD(evaluation.averageCostUSD)} />
        <EvaluationMetric label="現在株価" value={formatMaybeUSD(evaluation.currentPriceUSD)} note={evaluation.updatedAt ? `最終更新: ${evaluation.updatedAt}` : "最終更新: 未取得"} />
        <EvaluationMetric label="取得原価" value={formatUSD(evaluation.costBasisUSD)} note={formatMaybeJPY(evaluation.costBasisJPY)} />
        <EvaluationMetric label="現在評価額" value={formatMaybeUSD(evaluation.marketValueUSD)} note={formatMaybeJPY(evaluation.marketValueJPY)} />
        <EvaluationMetric
          label="含み損益"
          value={formatMaybeSignedUSD(evaluation.unrealizedPnlUSD)}
          note={formatMaybeJPY(evaluation.unrealizedPnlJPY)}
        />
        <EvaluationMetric
          label="含み損益率"
          value={evaluation.unrealizedPnlPct === undefined ? "未計算" : formatPct(evaluation.unrealizedPnlPct)}
        />
        <EvaluationMetric label="銘柄" value={evaluation.ticker} />
        <EvaluationMetric label="株数" value={`${evaluation.shares}株`} />
      </div>
      {evaluation.saxoUnrealizedPnlUSD !== undefined && evaluation.appCalculatedUnrealizedPnlUSD !== undefined && Math.abs(evaluation.pnlDifferenceUSD ?? 0) > 0.01 ? (
        <div className="mt-3 rounded-md border border-sky-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700">
          <span className="font-bold">Saxo評価損益:</span> <span className={pnlTone}>{formatMaybeSignedUSD(evaluation.saxoUnrealizedPnlUSD)}</span>
          <span className="mx-2 text-slate-400">/</span>
          <span className="font-bold">アプリ計算:</span> {formatMaybeSignedUSD(evaluation.appCalculatedUnrealizedPnlUSD)}
          <span className="mx-2 text-slate-400">/</span>
          <span className="font-bold">差分:</span> {formatMaybeSignedUSD(evaluation.pnlDifferenceUSD)}
        </div>
      ) : null}
    </section>
  );
}
