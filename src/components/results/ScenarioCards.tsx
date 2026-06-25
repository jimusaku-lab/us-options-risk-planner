import type { ScenarioResult } from "@/types/domain";
import { formatJPY } from "@/lib/format";

export function ScenarioCards({ scenarios, compactUnsettled = false }: { scenarios: ScenarioResult[]; compactUnsettled?: boolean }) {
  return (
    <section className="grid gap-3 lg:grid-cols-3">
      {scenarios.map((scenario) => (
        <div key={scenario.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-bold text-slate-950">{scenario.title}</h3>
          <div className="mt-2 text-sm font-semibold text-slate-700">{scenario.stockPriceCondition}</div>
          <dl className="mt-4 grid gap-2 text-sm">
            <div>
              <dt className="text-slate-500">{compactUnsettled ? "プレミアム参考" : "プレミアム"}</dt>
              <dd className="numeric-input font-bold text-emerald-700">
                {compactUnsettled && Math.abs(scenario.premiumJPY) < 0.5 ? "満期時に確定" : formatJPY(scenario.premiumJPY)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">株数の変化</dt>
              <dd className="font-semibold text-slate-900">{scenario.stockChange}</dd>
            </div>
            <div>
              <dt className="text-slate-500">次のアクション</dt>
              <dd className="font-semibold text-slate-900">{scenario.nextAction}</dd>
            </div>
          </dl>
          <ul className="mt-3 grid gap-1 text-sm leading-6 text-slate-600">
            {scenario.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
