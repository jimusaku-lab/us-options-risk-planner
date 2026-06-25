import { useState, type ReactNode } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import type {
  YearlyPerformanceIssue,
  YearlyPerformanceMonthlyRow,
  YearlyPerformanceOptionBreakdown,
  YearlyPerformanceSummary,
  YearlyPerformanceTaxBucket,
} from "@/domain/yearlyPerformance";
import { formatJPY, formatNumber, formatPct, formatUSD } from "@/lib/format";

export function YearlyPerformanceSummaryCard({
  summary,
  selectedYear,
  onYearChange,
  onIssueAction,
  workspace = "live",
  detailsMode = "toggle",
}: {
  summary: YearlyPerformanceSummary;
  selectedYear: number;
  onYearChange: (year: number) => void;
  onIssueAction: (issue: YearlyPerformanceIssue) => void;
  workspace?: "demo" | "live";
  detailsMode?: "toggle" | "always";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const showDetails = detailsMode === "always" || isOpen;
  const jpyAccountLabel = workspace === "live" ? "P口座" : "DEMO";
  const hasNUsd = Math.abs(summary.nTotalPnlUSD) > 0.0001 || summary.nOptionCount > 0 || summary.nStockSettlementCount > 0;
  const nReferenceLabel = Math.abs(summary.nReferencePnlJPY) > 0.5
    ? `参考 ${formatJPY(summary.nReferencePnlJPY, { signed: true })}`
    : "参考JPY未計算";
  const optionAnnualReturnTargetLabel = `年率計算対象 ${summary.optionAnnualReturnIncludedCount}/${summary.optionCount}件`;
  const nOptionAnnualReturnTargetLabel = `年率計算対象 ${summary.nOptionAnnualReturnIncludedCount}/${summary.nOptionCount}件`;
  const jpyOptionBreakdowns = summary.optionBreakdowns.filter((item) => item.currency === "JPY");
  const nOptionBreakdowns = summary.optionBreakdowns.filter((item) => item.currency === "USD");
  const transactionIssues = summary.issues.filter((issue) => issue.label !== "年率未計算");
  const annualReturnIssues = summary.issues.filter((issue) => issue.label === "年率未計算");

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

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          label={`${jpyAccountLabel}JPY実現損益`}
          value={formatJPY(summary.realizedPnlJPY, { signed: true })}
          subLabel={`${jpyAccountLabel}オプション + 株式譲渡。N口座USDは別表示`}
          tone={summary.realizedPnlJPY >= 0 ? "green" : "red"}
        />
        <MetricCard
          label={`${jpyAccountLabel}オプション損益（JPY）`}
          value={formatJPY(summary.optionPnlJPY, { signed: true })}
          subLabel={`${selectedYear}年累計 / 確認済み${summary.optionCount}件の合計`}
          tone={summary.optionPnlJPY >= 0 ? "green" : "red"}
        />
        <MetricCard
          label="実績年率（年利換算）"
          value={summary.optionAnnualReturnPct !== undefined ? formatPct(summary.optionAnnualReturnPct) : "年率未計算"}
          subLabel={
            summary.optionAnnualReturnPct !== undefined
              ? `${optionAnnualReturnTargetLabel} / 資金日数加重`
              : summary.annualReturnMissingCount > 0
                ? `年率未計算 ${summary.annualReturnMissingCount}件。内訳で不足項目を確認してください。`
                : "年率計算対象なし"
          }
          tone={summary.optionAnnualReturnPct === undefined ? "amber" : summary.optionAnnualReturnPct >= 0 ? "green" : "red"}
        />
        <MetricCard
          label={`${jpyAccountLabel}株式譲渡損益（JPY）`}
          value={formatJPY(summary.stockPnlJPY, { signed: true })}
          subLabel={`${summary.stockSettlementCount}件`}
          tone={Math.abs(summary.stockPnlJPY) < 0.5 ? "slate" : summary.stockPnlJPY > 0 ? "green" : "red"}
        />
        <MetricCard
          label="N口座（USD主帳簿）実現損益"
          value={formatUSD(summary.nTotalPnlUSD)}
          subLabel={
            hasNUsd
              ? `オプション ${formatUSD(summary.nOptionPnlUSD)} / 現物株 ${formatUSD(summary.nStockPnlUSD)} / ${nReferenceLabel}`
              : "USD主帳簿 / JPYは参考"
          }
          tone={summary.nTotalPnlUSD >= 0 ? "green" : "red"}
        />
        <MetricCard
          label="取引確認"
          value={`${summary.transactionUnconfirmedCount}件`}
          subLabel={`年率未計算 ${summary.annualReturnMissingCount}件（任意確認）`}
          tone={summary.transactionUnconfirmedCount > 0 ? "amber" : "slate"}
        />
      </div>

      <CombinedReferenceOverview
        optionJPY={summary.combinedReferenceOptionJPY}
        stockJPY={summary.combinedReferenceStockJPY}
        totalJPY={summary.combinedReferenceTotalJPY}
        rows={summary.monthly}
      />

      {summary.optionBreakdowns.length > 0 ? (
        <section className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-bold text-slate-500">当年オプション損益の内訳</div>
          <p className="mt-1 text-sm leading-6 text-slate-700">
            {jpyAccountLabel}JPY実績とN口座USD実績を分けて表示します。N口座USDの参考JPYは換算参考で、JPY口座実績には混ぜません。
          </p>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <OptionBreakdownList
              title={`${jpyAccountLabel}オプション損益（JPY）`}
              total={`${formatJPY(summary.optionPnlJPY, { signed: true })} / ${summary.optionCount}件`}
              items={jpyOptionBreakdowns}
              currency="JPY"
            />
            <OptionBreakdownList
              title="N口座オプション損益（USD）"
              total={`${formatUSD(summary.nOptionPnlUSD)} / ${summary.nOptionCount}件`}
              items={nOptionBreakdowns}
              currency="USD"
            />
          </div>
        </section>
      ) : null}

      {showDetails ? (
        <div className="mt-5 grid gap-4">
          <section className="rounded-md border border-slate-200 p-3">
            <h3 className="text-sm font-bold text-slate-950">月別実現損益</h3>
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              <MonthlyJpyChart rows={summary.monthly} accountLabel={jpyAccountLabel} />
              <MonthlyUsdChart rows={summary.monthly} />
            </div>
            <NUsdBridge optionUSD={summary.nOptionPnlUSD} stockUSD={summary.nStockPnlUSD} totalUSD={summary.nTotalPnlUSD} />
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              <MonthlyJpyTable rows={summary.monthly} accountLabel={jpyAccountLabel} />
              <MonthlyUsdTable rows={summary.monthly} />
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-3">
            <section className="rounded-md border border-slate-200 p-3">
              <h3 className="text-sm font-bold text-slate-950">税区分別内訳</h3>
              <div className="mt-3 grid gap-2">
                {summary.taxBuckets.map((bucket) => (
                  <div key={bucket.id} className="rounded-md bg-slate-50 p-3">
                    <div className="text-xs font-semibold text-slate-500">{formatTaxBucketLabel(bucket.id, jpyAccountLabel, bucket.label)}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{formatTaxBucketSubLabel(bucket.id, jpyAccountLabel, bucket.subLabel)}</div>
                    <div className="mt-1 text-base font-bold text-slate-950">
                      {bucket.amountUSD !== undefined ? formatUSD(bucket.amountUSD) : formatJPY(bucket.amountJPY, { signed: true })}
                    </div>
                    {bucket.referenceJPY !== undefined && Math.abs(bucket.referenceJPY) > 0.5 ? (
                      <div className="text-xs text-slate-500">参考 {formatJPY(bucket.referenceJPY, { signed: true })}</div>
                    ) : bucket.amountUSD !== undefined ? (
                      <div className="text-xs text-slate-500">参考JPY未計算</div>
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
                        <th className="py-2 pr-3 text-right">{jpyAccountLabel}オプションJPY</th>
                        <th className="py-2 pr-3 text-right">{jpyAccountLabel}株式譲渡JPY</th>
                        <th className="py-2 pr-3 text-right">{jpyAccountLabel}合計JPY</th>
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
                            {formatUSD(ticker.nOptionUSD + ticker.nStockUSD)}
                            {Math.abs(ticker.nOptionUSD) > 0.0001 ? (
                              <span className="block text-xs text-slate-500">オプション {formatUSD(ticker.nOptionUSD)}</span>
                            ) : null}
                            {Math.abs(ticker.nStockUSD) > 0.0001 ? (
                              <span className="block text-xs text-slate-500">現物株 {formatUSD(ticker.nStockUSD)}</span>
                            ) : null}
                            {Math.abs(ticker.nReferenceJPY) > 0.5 ? (
                              <span className="block text-xs text-slate-500">参考 {formatJPY(ticker.nReferenceJPY, { signed: true })}</span>
                            ) : Math.abs(ticker.nOptionUSD + ticker.nStockUSD) > 0.0001 ? (
                              <span className="block text-xs text-slate-500">参考JPY未計算</span>
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
            <h3 className="text-sm font-bold text-slate-950">確認が必要な項目</h3>
            {transactionIssues.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {transactionIssues.map((issue) => (
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
                取引未確認はありません。
              </p>
            )}
            {annualReturnIssues.length > 0 ? (
              <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-bold text-slate-900">年率だけ未計算の実績があります</div>
                <div className="mt-2 grid gap-2">
                  {annualReturnIssues.map((issue) => (
                    <button
                      key={issue.id}
                      className="rounded-md border border-slate-200 bg-white p-3 text-left text-slate-700 hover:bg-slate-50"
                      onClick={() => onIssueAction(issue)}
                    >
                      <span className="block text-sm font-bold">{issue.ticker} / 任意確認</span>
                      <span className="mt-1 block text-xs leading-5">{issue.detail}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function OptionBreakdownList({
  title,
  total,
  items,
  currency,
}: {
  title: string;
  total: string;
  items: YearlyPerformanceOptionBreakdown[];
  currency: "JPY" | "USD";
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-950">{title}</h3>
        <span className="numeric-input text-sm font-bold text-slate-900">{total}</span>
      </div>
      {items.length > 0 ? (
        <div className="mt-2 grid gap-2">
          {items.map((item) => {
            const mainValue = currency === "USD" ? formatUSD(item.amountUSD ?? 0) : formatJPY(item.amountJPY, { signed: true });
            const denominator =
              currency === "USD"
                ? item.denominatorUSD !== undefined && item.denominatorUSD > 0
                  ? formatUSD(item.denominatorUSD)
                  : "未入力"
                : item.denominatorJPY !== undefined && item.denominatorJPY > 0
                  ? formatJPY(item.denominatorJPY)
                  : "未入力";
            return (
              <div key={item.id} className="rounded bg-slate-50 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">{item.ticker} / {item.label}</span>
                  <span className={`numeric-input font-bold ${mainValue.includes("-") ? "text-red-700" : "text-emerald-700"}`}>{mainValue}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">{item.date}</div>
                <div className="mt-2 rounded-md bg-white px-2 py-1 text-xs leading-5 text-slate-600">
                  実現損益: {mainValue}
                  {currency === "USD"
                    ? item.referenceJPY !== undefined && Math.abs(item.referenceJPY) > 0.5
                      ? ` / 参考 ${formatJPY(item.referenceJPY, { signed: true })}`
                      : " / 参考JPY未計算"
                    : ""}
                  <br />
                  使用分母: {denominator} / 日数: {item.days ? `${formatNumber(item.days)}日` : "未入力"} / 実績年率:{" "}
                  {item.annualReturnPct !== undefined ? formatPct(item.annualReturnPct) : "年率未計算"}
                  {item.annualReturnMissingReason ? (
                    <div className="mt-1 font-semibold text-amber-700">
                      実績年率だけ未計算: {item.annualReturnMissingReason}。損益額には影響しません。
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 rounded bg-slate-50 px-3 py-2 text-sm text-slate-500">この年の対象実績はありません。</p>
      )}
    </section>
  );
}

function CombinedReferenceOverview({
  optionJPY,
  stockJPY,
  totalJPY,
  rows,
}: {
  optionJPY: number;
  stockJPY: number;
  totalJPY: number;
  rows: YearlyPerformanceMonthlyRow[];
}) {
  const maxAbs = Math.max(Math.abs(optionJPY), Math.abs(stockJPY), Math.abs(totalJPY), 1);
  return (
    <section className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-950">参考JPY換算の全体像</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            P口座JPY実績とN口座USD実績を参考為替で円換算して合計した管理用の目安です。税務上の正式損益ではありません。
          </p>
        </div>
        <div className={`numeric-input text-xl font-bold ${totalJPY < 0 ? "text-red-700" : "text-emerald-700"}`}>
          参考合計 {formatJPY(totalJPY, { signed: true })}
        </div>
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(360px,1.2fr)]">
        <div className="rounded-md bg-white p-3">
          <div className="text-sm font-bold text-slate-900">全体損益の内訳（参考JPY）</div>
          <div className="mt-3 grid gap-2">
            <ReferenceJpyBridgeRow label="オプション" value={optionJPY} maxAbs={maxAbs} />
            <ReferenceJpyBridgeRow label="現物株" value={stockJPY} maxAbs={maxAbs} />
          </div>
        </div>
        <div className="rounded-md bg-white p-3">
          <div className="text-sm font-bold text-slate-900">全体参考JPY推移（月別）</div>
          <div className="mt-2 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 10000)}万円`} width={48} />
                <Tooltip
                  formatter={(value, name) => [formatJPY(Number(value), { signed: true }), name]}
                  labelFormatter={(label) => `${label}`}
                />
                <Legend />
                <ReferenceLine y={0} stroke="#475569" strokeWidth={1.5} />
                <Bar dataKey="combinedReferenceOptionJPY" name="オプション参考JPY" fill="#059669" radius={[4, 4, 0, 0]} />
                <Bar dataKey="combinedReferenceStockJPY" name="現物株参考JPY" fill="#dc2626" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="combinedReferenceCumulativeJPY" name="参考JPY累計" stroke="#111827" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <MiniMetric label="オプション" value={formatJPY(optionJPY, { signed: true })} tone={optionJPY < 0 ? "red" : "green"} />
        <MiniMetric label="現物株" value={formatJPY(stockJPY, { signed: true })} tone={stockJPY < 0 ? "red" : "green"} />
        <MiniMetric label="参考合計" value={formatJPY(totalJPY, { signed: true })} tone={totalJPY < 0 ? "red" : "green"} />
      </div>
    </section>
  );
}

function ReferenceJpyBridgeRow({ label, value, maxAbs }: { label: string; value: number; maxAbs: number }) {
  const isNegative = value < 0;
  const width = `${Math.max(4, (Math.abs(value) / maxAbs) * 100)}%`;
  return (
    <div className="grid gap-2 md:grid-cols-[88px_1fr_104px] md:items-center">
      <div className="text-sm font-semibold text-slate-700">{label}</div>
      <div className="grid grid-cols-2 gap-1">
        <div className="flex justify-end">
          {isNegative ? <div className="h-5 rounded-l bg-red-600" style={{ width }} /> : null}
        </div>
        <div>{!isNegative ? <div className="h-5 rounded-r bg-emerald-600" style={{ width }} /> : null}</div>
      </div>
      <div className={`numeric-input text-right text-sm font-bold ${isNegative ? "text-red-700" : "text-emerald-700"}`}>
        {formatJPY(value, { signed: true })}
      </div>
    </div>
  );
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone: "green" | "red" }) {
  return (
    <div className="rounded-md bg-white px-3 py-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={`numeric-input mt-1 text-base font-bold ${tone === "green" ? "text-emerald-700" : "text-red-700"}`}>{value}</div>
    </div>
  );
}

function MonthlyJpyChart({ rows, accountLabel }: { rows: YearlyPerformanceMonthlyRow[]; accountLabel: string }) {
  return (
    <section className="rounded-md bg-slate-50 p-3">
      <h4 className="text-sm font-bold text-slate-900">{accountLabel}JPY実績（月別）</h4>
      <div className="mt-2 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 10000)}万円`} width={48} />
            <Tooltip
              formatter={(value, name) => [formatJPY(Number(value), { signed: true }), name]}
              labelFormatter={(label) => `${label}`}
            />
            <Legend />
            <ReferenceLine y={0} stroke="#475569" strokeWidth={1.5} />
            <Bar dataKey="optionJPY" name="オプション損益" fill="#059669" radius={[4, 4, 0, 0]} />
            <Bar dataKey="stockJPY" name="株式譲渡損益" fill="#dc2626" radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="cumulativeJPY" name="累計" stroke="#111827" strokeWidth={2} dot={{ r: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function MonthlyUsdChart({ rows }: { rows: YearlyPerformanceMonthlyRow[] }) {
  return (
    <section className="rounded-md bg-slate-50 p-3">
      <h4 className="text-sm font-bold text-slate-900">N口座USD実績（月別）</h4>
      <div className="mt-2 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(value) => `$${Math.round(Number(value))}`} width={54} />
            <Tooltip
              formatter={(value, name) => [formatUSD(Number(value)), name]}
              labelFormatter={(label) => `${label}`}
            />
            <Legend />
            <ReferenceLine y={0} stroke="#475569" strokeWidth={1.5} />
            <Bar dataKey="nOptionUSD" name="オプション" fill="#059669" radius={[4, 4, 0, 0]} />
            <Bar dataKey="nStockUSD" name="現物株" fill="#dc2626" radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="cumulativeNUsd" name="累計" stroke="#111827" strokeWidth={2} dot={{ r: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function NUsdBridge({ optionUSD, stockUSD, totalUSD }: { optionUSD: number; stockUSD: number; totalUSD: number }) {
  const maxAbs = Math.max(Math.abs(optionUSD), Math.abs(stockUSD), Math.abs(totalUSD), 1);
  return (
    <section className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-slate-900">N口座USD損益の内訳</h4>
        <span className={`numeric-input text-sm font-bold ${totalUSD < 0 ? "text-red-700" : "text-emerald-700"}`}>合計 {formatUSD(totalUSD)}</span>
      </div>
      <div className="mt-3 grid gap-2">
        <BridgeRow label="オプション" value={optionUSD} maxAbs={maxAbs} />
        <BridgeRow label="現物株" value={stockUSD} maxAbs={maxAbs} />
      </div>
    </section>
  );
}

function BridgeRow({ label, value, maxAbs }: { label: string; value: number; maxAbs: number }) {
  const isNegative = value < 0;
  const width = `${Math.max(4, (Math.abs(value) / maxAbs) * 100)}%`;
  return (
    <div className="grid gap-2 md:grid-cols-[88px_1fr_96px] md:items-center">
      <div className="text-sm font-semibold text-slate-700">{label}</div>
      <div className="grid grid-cols-2 gap-1">
        <div className="flex justify-end">
          {isNegative ? <div className="h-5 rounded-l bg-red-600" style={{ width }} /> : null}
        </div>
        <div>{!isNegative ? <div className="h-5 rounded-r bg-emerald-600" style={{ width }} /> : null}</div>
      </div>
      <div className={`numeric-input text-right text-sm font-bold ${isNegative ? "text-red-700" : "text-emerald-700"}`}>{formatUSD(value)}</div>
    </div>
  );
}

function MonthlyJpyTable({ rows, accountLabel }: { rows: YearlyPerformanceMonthlyRow[]; accountLabel: string }) {
  const visibleRows = rows.filter((row) => Math.abs(row.optionJPY) > 0.5 || Math.abs(row.stockJPY) > 0.5 || Math.abs(row.cumulativeJPY) > 0.5);
  return (
    <MonthlyTableShell title={`${accountLabel}JPY実績（月別）`}>
      <thead>
        <tr className="border-b border-slate-200 text-xs text-slate-500">
          <th className="py-2 pr-3 text-left">月</th>
          <th className="py-2 pr-3 text-right">オプション</th>
          <th className="py-2 pr-3 text-right">株式譲渡</th>
          <th className="py-2 pr-3 text-right">累計</th>
        </tr>
      </thead>
      <tbody>
        {(visibleRows.length > 0 ? visibleRows : rows.slice(0, 1)).map((row) => (
          <tr key={row.month} className="border-b border-slate-100">
            <td className="py-2 pr-3 font-semibold">{row.label}</td>
            <td className="numeric-input py-2 pr-3 text-right">{formatJPY(row.optionJPY, { signed: true })}</td>
            <td className="numeric-input py-2 pr-3 text-right">{formatJPY(row.stockJPY, { signed: true })}</td>
            <td className="numeric-input py-2 pr-3 text-right font-bold">{formatJPY(row.cumulativeJPY, { signed: true })}</td>
          </tr>
        ))}
      </tbody>
    </MonthlyTableShell>
  );
}

function MonthlyUsdTable({ rows }: { rows: YearlyPerformanceMonthlyRow[] }) {
  const visibleRows = rows.filter((row) => Math.abs(row.nOptionUSD) > 0.0001 || Math.abs(row.nStockUSD) > 0.0001 || Math.abs(row.cumulativeNUsd) > 0.0001);
  return (
    <MonthlyTableShell title="N口座USD実績（月別）">
      <thead>
        <tr className="border-b border-slate-200 text-xs text-slate-500">
          <th className="py-2 pr-3 text-left">月</th>
          <th className="py-2 pr-3 text-right">オプション</th>
          <th className="py-2 pr-3 text-right">現物株</th>
          <th className="py-2 pr-3 text-right">累計</th>
        </tr>
      </thead>
      <tbody>
        {(visibleRows.length > 0 ? visibleRows : rows.slice(0, 1)).map((row) => (
          <tr key={row.month} className="border-b border-slate-100">
            <td className="py-2 pr-3 font-semibold">{row.label}</td>
            <td className="numeric-input py-2 pr-3 text-right">{formatUSD(row.nOptionUSD)}</td>
            <td className="numeric-input py-2 pr-3 text-right">{formatUSD(row.nStockUSD)}</td>
            <td className="numeric-input py-2 pr-3 text-right font-bold">{formatUSD(row.cumulativeNUsd)}</td>
          </tr>
        ))}
      </tbody>
    </MonthlyTableShell>
  );
}

function MonthlyTableShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md bg-slate-50 p-3">
      <h4 className="text-sm font-bold text-slate-900">{title}</h4>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">{children}</table>
      </div>
    </section>
  );
}

function formatTaxBucketLabel(id: YearlyPerformanceTaxBucket["id"], accountLabel: string, fallback: string): string {
  if (id === "option") return `${accountLabel}オプション損益（JPY）`;
  if (id === "stock") return `${accountLabel}株式譲渡損益（JPY）`;
  return fallback;
}

function formatTaxBucketSubLabel(id: YearlyPerformanceTaxBucket["id"], accountLabel: string, fallback?: string): string {
  if (id === "option") return `${accountLabel}のJPY実績。N口座USDオプションは別表示です。`;
  if (id === "stock") return `${accountLabel}のJPY集計。N口座USDの株式譲渡は下段に別表示。`;
  return fallback ?? "";
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
