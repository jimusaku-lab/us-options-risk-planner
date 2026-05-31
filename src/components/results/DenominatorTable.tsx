import type { DenominatorResult } from "@/types/domain";
import { formatJPY, formatPct, formatUSD } from "@/lib/format";

function formatComponent(component: DenominatorResult["components"][number]): string {
  if (component.label === "現物株時価" && component.amountJPY === 0) {
    return "現物株なし";
  }
  if (component.amountUSD !== undefined) {
    return `${component.label}: ${formatUSD(component.amountUSD)} / 参考 ${formatJPY(component.amountJPY)}`;
  }
  return `${component.label}: ${formatJPY(component.amountJPY)}`;
}

export function DenominatorTable({ denominators }: { denominators: DenominatorResult[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-950">分母比較</h2>
        <span className="text-sm text-slate-500">どの資金を分母にした利回りかを必ず確認</span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-3">分母モード</th>
              <th className="py-2 pr-3 text-right">分母</th>
              <th className="py-2 pr-3 text-right">税前年率</th>
              <th className="py-2 pr-3">構成</th>
            </tr>
          </thead>
          <tbody>
            {denominators.map((row) => (
              <tr key={row.mode} className={row.isPrimary ? "bg-teal-50" : "border-b border-slate-100"}>
                <td className="py-3 pr-3 font-semibold text-slate-900">
                  {row.label}
                  {row.isPrimary ? <span className="ml-2 rounded bg-teal-700 px-2 py-0.5 text-xs text-white">主分母</span> : null}
                </td>
                <td className="numeric-input py-3 pr-3 text-right font-semibold">
                  {row.currency === "USD" ? (
                    <>
                      <span className="block">{formatUSD(row.amountUSD ?? 0)}</span>
                      <span className="block text-xs text-slate-500">参考 {formatJPY(row.amountJPY)}</span>
                    </>
                  ) : (
                    formatJPY(row.amountJPY)
                  )}
                </td>
                <td className="numeric-input py-3 pr-3 text-right font-semibold">{formatPct(row.annualReturnPct)}</td>
                <td className="py-3 pr-3 text-slate-600">
                  {row.components.map(formatComponent).join(" / ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
