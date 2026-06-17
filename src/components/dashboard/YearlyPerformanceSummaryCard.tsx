import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import type { YearlyPerformanceIssue, YearlyPerformanceSummary } from "@/domain/yearlyPerformance";
import { formatJPY, formatUSD } from "@/lib/format";

export function YearlyPerformanceSummaryCard({
  summary,
  selectedYear,
  onYearChange,
  onIssueAction,
  detailsMode = "toggle",
}: {
  summary: YearlyPerformanceSummary;
  selectedYear: number;
  onYearChange: (year: number) => void;
  onIssueAction: (issue: YearlyPerformanceIssue) => void;
  detailsMode?: "toggle" | "always";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const showDetails = detailsMode === "always" || isOpen;
  const hasNUsd = Math.abs(summary.nOptionPnlUSD) > 0.0001 || summary.nOptionCount > 0;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-slate-950">当年成績サマリー</h2>
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700"
              value={selectedYear}
              onChange={(event) => onYearChange(Number(event.target.value))}
            >
              {summary.availableYears.map((year) => (
                <option key={year} value={year}>
                  {year}年
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            確認済みの反対売買決済、満期終了、P売り権利行使で確定したオプション損益を集計します。
            株式取得後の現物株時価は混ぜず、株式譲渡損益は売却・譲渡記録が入力された時点で別集計します。
            表示額は{selectedYear}年累計で、個別履歴1件の実績カードとは別の合計です。
          </p>
        </div>
        {detailsMode === "toggle" ? (
          <button
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => setIsOpen((current) => !current)}
          >
            {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            詳細を{isOpen ? "閉じる" : "開く"}
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="当年実現損益合計"
          value={formatJPY(summary.realizedPnlJPY, { signed: true })}
          subLabel="P/DEMOオプション + 株式譲渡"
          tone={summary.realizedPnlJPY >= 0 ? "green" : "red"}
        />
        <MetricCard
          label="オプション損益"
          value={formatJPY(summary.optionPnlJPY, { signed: true })}
          subLabel={`${selectedYear}年累計 / 確認済み${summary.optionCount}件の合計`}
          tone={summary.optionPnlJPY >= 0 ? "green" : "red"}
        />
        <MetricCard
          label="株式譲渡損益"
          value={formatJPY(summary.stockPnlJPY, { signed: true })}
          subLabel={`${summary.stockSettlementCount}件`}
          tone={summary.stockPnlJPY >= 0 ? "green" : "red"}
        />
        <MetricCard
          label="N口座USD損益"
          value={formatUSD(summary.nOptionPnlUSD)}
          subLabel={hasNUsd ? `参考 ${formatJPY(summary.nReferencePnlJPY, { signed: true })}` : "USD主帳簿 / JPYは参考"}
          tone={summary.nOptionPnlUSD >= 0 ? "green" : "red"}
        />
        <MetricCard
          label="未確認・未入力"
          value={`${summary.unconfirmedCount}件`}
          subLabel="下書き・結果状態の不足"
          tone={summary.unconfirmedCount > 0 ? "amber" : "slate"}
        />
      </div>

      {summary.optionBreakdowns.length > 0 ? (
        <section className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-bold text-slate-500">当年オプション損益の内訳</div>
          <p className="mt-1 text-sm leading-6 text-slate-700">
            {formatJPY(summary.optionPnlJPY, { signed: true })} は、確認済み{summary.optionCount}件の合計です。履歴1件の実績額とは分けて確認します。
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {summary.optionBreakdowns.map((item) => (
              <div key={item.id} className="rounded bg-white px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">{item.ticker} / {item.label}</span>
                  <span className="numeric-input font-bold text-emerald-700">{formatJPY(item.amountJPY, { signed: true })}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">{item.date}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {showDetails ? (
        <div className="mt-5 grid gap-4">
          <section className="rounded-md border border-slate-200 p-3">
            <h3 className="text-sm font-bold text-slate-950">月別実現損益 / 年初来累計</h3>
            <div className="mt-3 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={summary.monthly} margin={{ top: 12, right: 18, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="jpy" tickFormatter={(value) => `${Math.round(Number(value) / 10000)}万`} />
                  <YAxis yAxisId="usd" orientation="right" tickFormatter={(value) => `$${Math.round(Number(value))}`} />
                  <Tooltip
                    formatter={(value, name) => {
                      const numeric = Number(value);
                      if (String(name).includes("USD")) return [formatUSD(numeric), name];
                      return [formatJPY(numeric, { signed: true }), name];
                    }}
                  />
                  <Legend />
                  <Bar yAxisId="jpy" dataKey="optionJPY" name="オプションJPY" fill="#0f766e" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="jpy" dataKey="stockJPY" name="株式譲渡JPY" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="jpy" type="monotone" dataKey="cumulativeJPY" name="年初来累計JPY" stroke="#111827" strokeWidth={2} dot={false} />
                  <Line yAxisId="usd" type="monotone" dataKey="cumulativeNOptionUSD" name="N口座累計USD" stroke="#ea580c" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-3">
            <section className="rounded-md border border-slate-200 p-3">
              <h3 className="text-sm font-bold text-slate-950">税区分別内訳</h3>
              <div className="mt-3 grid gap-2">
                {summary.taxBuckets.map((bucket) => (
                  <div key={bucket.id} className="rounded-md bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-500">{bucket.label}</div>
                    <div className="mt-1 text-base font-bold text-slate-950">
                      {bucket.amountUSD !== undefined ? formatUSD(bucket.amountUSD) : formatJPY(bucket.amountJPY, { signed: true })}
                    </div>
                    {bucket.referenceJPY !== undefined ? (
                      <div className="text-xs text-slate-500">参考 {formatJPY(bucket.referenceJPY, { signed: true })}</div>
                    ) : null}
                    <div className="text-xs text-slate-500">{bucket.count}件</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-md border border-slate-200 p-3 xl:col-span-2">
              <h3 className="text-sm font-bold text-slate-950">銘柄別サマリー</h3>
              {summary.tickerSummaries.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                        <th className="py-2 pr-3">銘柄</th>
                        <th className="py-2 pr-3 text-right">オプションJPY</th>
                        <th className="py-2 pr-3 text-right">株式譲渡JPY</th>
                        <th className="py-2 pr-3 text-right">JPY合計</th>
                        <th className="py-2 pr-3 text-right">N口座USD</th>
                        <th className="py-2 pr-3 text-right">件数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.tickerSummaries.map((ticker) => (
                        <tr key={ticker.ticker} className="border-b border-slate-100">
                          <td className="py-2 pr-3 font-bold text-slate-950">{ticker.ticker}</td>
                          <td className="numeric-input py-2 pr-3 text-right">{formatJPY(ticker.optionJPY, { signed: true })}</td>
                          <td className="numeric-input py-2 pr-3 text-right">{formatJPY(ticker.stockJPY, { signed: true })}</td>
                          <td className="numeric-input py-2 pr-3 text-right font-semibold">{formatJPY(ticker.totalJPY, { signed: true })}</td>
                          <td className="numeric-input py-2 pr-3 text-right">
                            {formatUSD(ticker.nOptionUSD)}
                            {Math.abs(ticker.nReferenceJPY) > 0.5 ? (
                              <span className="block text-xs text-slate-500">参考 {formatJPY(ticker.nReferenceJPY, { signed: true })}</span>
                            ) : null}
                          </td>
                          <td className="numeric-input py-2 pr-3 text-right">{ticker.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-600">この年に集計対象の実績はありません。</p>
              )}
            </section>
          </div>

          <section className="rounded-md border border-slate-200 p-3">
            <h3 className="text-sm font-bold text-slate-950">未確認・未入力リスト</h3>
            {summary.issues.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {summary.issues.map((issue) => (
                  <button
                    key={issue.id}
                    className={`flex items-start gap-3 rounded-md border p-3 text-left hover:bg-white ${
                      issue.severity === "danger"
                        ? "border-red-200 bg-red-50 text-red-800"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                    }`}
                    onClick={() => onIssueAction(issue)}
                  >
                    <AlertTriangle className="mt-0.5 shrink-0" size={16} />
                    <span>
                      <span className="block text-sm font-bold">{issue.ticker} / {issue.label}</span>
                      <span className="mt-1 block text-xs leading-5">{issue.detail}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-md bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                未確認・未入力の結果記録はありません。
              </p>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function MetricCard({
  label,
  value,
  subLabel,
  tone,
}: {
  label: string;
  value: string;
  subLabel: string;
  tone: "green" | "red" | "amber" | "slate";
}) {
  const toneClassName = {
    green: "text-emerald-700",
    red: "text-red-700",
    amber: "text-amber-700",
    slate: "text-slate-900",
  }[tone];
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={`numeric-input mt-1 text-xl font-bold ${toneClassName}`}>{value}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500">{subLabel}</div>
    </div>
  );
}
