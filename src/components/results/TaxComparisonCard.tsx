import type { NisaComparison, TaxResult } from "@/types/domain";
import { formatJPY, formatPct } from "@/lib/format";

export function TaxComparisonCard({
  taxResult,
  nisaComparison,
}: {
  taxResult: TaxResult;
  nisaComparison: NisaComparison;
}) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">税引後カード</h2>
        <dl className="mt-4 grid gap-3 text-sm">
          <Row label="税前利益" value={formatJPY(taxResult.grossProfitJPY)} />
          <Row label="手数料・費用控除後利益" value={formatJPY(taxResult.feeAdjustedProfitJPY)} />
          <Row label="課税対象利益" value={formatJPY(taxResult.taxableProfitJPY)} />
          <Row label="想定税額" value={formatJPY(taxResult.taxJPY)} tone="red" />
          <Row label="税引後利益" value={formatJPY(taxResult.netProfitJPY)} tone="green" />
          <Row label="税前年率" value={formatPct(taxResult.grossAnnualReturnPct)} />
          <Row label="税引後年率" value={formatPct(taxResult.netAnnualReturnPct)} tone="green" />
        </dl>
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm leading-6 text-amber-950">
          税区分は証券会社、口座種別、商品区分、決済方法により異なる可能性があります。この税額は試算であり、確定申告用の税額ではありません。
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">NISA等の非課税口座比較</h2>
        <dl className="mt-4 grid gap-3 text-sm">
          <Row label="NISA等の比較対象年率" value={formatPct(nisaComparison.expectedAnnualReturnPct)} />
          <Row label="NISA等で同じ分母・同じ日数なら" value={formatJPY(nisaComparison.comparisonProfitJPY)} />
          <Row
            label="オプション税引後利益との差額"
            value={formatJPY(nisaComparison.netAdvantageJPY, { signed: true })}
            tone={nisaComparison.netAdvantageJPY >= 0 ? "green" : "red"}
          />
          <Row label="NISA等を上回るための税前利益" value={formatJPY(nisaComparison.requiredGrossProfitToBeatJPY)} />
          <Row label="必要な税前年率（NISA等を上回る目安）" value={formatPct(nisaComparison.requiredGrossAnnualReturnPct)} />
        </dl>
      </div>
    </section>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const toneClass = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "text-slate-950";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
      <dt className="text-slate-600">{label}</dt>
      <dd className={`numeric-input text-right font-bold ${toneClass}`}>{value}</dd>
    </div>
  );
}
