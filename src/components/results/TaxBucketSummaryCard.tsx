import type { TaxBucketSummary } from "@/types/domain";
import { formatJPY, formatPct } from "@/lib/format";

export function TaxBucketSummaryCard({ summary }: { summary: TaxBucketSummary }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">税務区分別の履歴集計</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            決済済み・権利行使済み・満期終了にした建玉だけを集計します。年率は、各取引の資金量と日数を合算して概算します。
          </p>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-3">税務区分</th>
              <th className="py-2 pr-3 text-right">集計件数</th>
              <th className="py-2 pr-3 text-right">損益</th>
              <th className="py-2 pr-3 text-right">年率</th>
              <th className="py-2 pr-3">見方</th>
            </tr>
          </thead>
          <tbody>
            <SummaryRow
              label="先物取引に係る雑所得等"
              count={summary.optionCount}
              profitJPY={summary.optionProfitJPY}
              annualReturnPct={summary.optionAnnualReturnPct}
              note="オプションの受取プレミアム、買戻し、手数料を反映した履歴側の概算です。"
            />
            <SummaryRow
              label="上場株式等の譲渡所得等"
              count={summary.stockSettlementCount}
              profitJPY={summary.stockRealizedGainJPY}
              annualReturnPct={summary.stockAnnualReturnPct}
              note="現物株の譲渡記録をONにした履歴だけを集計します。オプション損益とは相殺しません。"
            />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryRow({
  label,
  count,
  profitJPY,
  annualReturnPct,
  note,
}: {
  label: string;
  count: number;
  profitJPY: number;
  annualReturnPct: number;
  note: string;
}) {
  const toneClass = profitJPY > 0 ? "text-emerald-700" : profitJPY < 0 ? "text-red-700" : "text-slate-700";
  return (
    <tr className="border-b border-slate-100">
      <td className="py-3 pr-3 font-bold text-slate-900">{label}</td>
      <td className="numeric-input py-3 pr-3 text-right font-semibold">{count}件</td>
      <td className={`numeric-input py-3 pr-3 text-right font-bold ${toneClass}`}>{formatJPY(profitJPY, { signed: true })}</td>
      <td className={`numeric-input py-3 pr-3 text-right font-bold ${toneClass}`}>{count > 0 ? formatPct(annualReturnPct) : "-"}</td>
      <td className="py-3 pr-3 text-slate-600">{note}</td>
    </tr>
  );
}
