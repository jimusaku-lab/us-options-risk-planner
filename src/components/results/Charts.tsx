import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import type { DenominatorResult, PayoffDisplayMode, PayoffPoint, TradeSimulation } from "@/types/domain";
import { calculatePayoffSeries, calculatePayoffSummary, getPayoffDisplayModeFromLabel } from "@/domain/payoff";
import { formatJPY, formatPct, formatUSD } from "@/lib/format";

export function PayoffChart({ simulation, points }: { simulation: TradeSimulation; points: PayoffPoint[] }) {
  const isCoveredCall = simulation.strategyType === "covered_call";
  const [displayMode, setDisplayMode] = useState<PayoffDisplayMode>("practical");
  const summary = calculatePayoffSummary(simulation, isCoveredCall ? displayMode : "theoretical");
  const chartPoints = isCoveredCall ? calculatePayoffSeries(simulation, displayMode) : points;
  const calls = simulation.optionLegs.filter((leg) => leg.type === "call");
  const puts = simulation.optionLegs.filter((leg) => leg.type === "put");
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">満期時の損益図</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        横軸は満期時の株価、縦軸はその株価で満期を迎えた場合の概算損益です。
        0円ラインより上が利益、下が損失です。現在株価、権利行使価格、損益分岐点を線で表示します。
      </p>
      {summary.displayModeOptions ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="text-slate-600">表示モード:</span>
          {summary.displayModeOptions.map((mode) => (
            <button
              type="button"
              key={mode}
              onClick={() => setDisplayMode(getPayoffDisplayModeFromLabel(mode))}
              className={`rounded-full px-3 py-1 ${
                mode === summary.displayModeLabel ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      ) : null}
      {summary.hasLongOption ? (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
          買いオプションでは、満期まで持つことを推奨する図ではありません。実際は満期前の反対売買決済を前提に確認します。
        </p>
      ) : null}
      <div className="mt-4 h-80">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartPoints} margin={{ top: 10, right: 24, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="stockPriceUSD" tickFormatter={(value) => `$${value}`} />
            <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 10000)}万`} />
            <Tooltip formatter={(value) => formatJPY(Number(value))} labelFormatter={(label) => `株価 $${label}`} />
            <ReferenceLine y={0} stroke="#334155" />
            <ReferenceLine x={simulation.currentPriceUSD} stroke="#2563eb" label="現在株価" />
            {calls.map((call) => (
              <ReferenceLine key={call.id} x={call.strikeUSD} stroke="#dc2626" label={`C ${call.strikeUSD}`} />
            ))}
            {puts.map((put) => (
              <ReferenceLine key={put.id} x={put.strikeUSD} stroke="#d97706" label={`P ${put.strikeUSD}`} />
            ))}
            {summary.breakevens.map((breakeven, index) => (
              <ReferenceLine key={`${breakeven.label}-${index}`} x={breakeven.priceUSD} stroke="#7c3aed" label={`損益分岐点 ${breakeven.priceUSD.toFixed(2)}`} />
            ))}
            {summary.secondaryBreakevens?.map((breakeven, index) => (
              <ReferenceLine key={`${breakeven.label}-${index}`} x={breakeven.priceUSD} stroke="#94a3b8" strokeDasharray="5 5" label={`参考 ${breakeven.priceUSD.toFixed(2)}`} />
            ))}
            <Area type="monotone" dataKey="profitJPY" stroke="#0f766e" fill="#10b981" fillOpacity={0.22} strokeWidth={0} dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="lossJPY" stroke="#dc2626" fill="#ef4444" fillOpacity={0.18} strokeWidth={0} dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="pnlJPY" stroke="#0f766e" fill="none" strokeWidth={2} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
        <PayoffStat label={summary.maxLossTitle ?? "最大損失"} value={summary.maxLossLabel} tone="red" note={summary.maxLossNote} />
        <PayoffStat label="最大利益" value={summary.maxProfitLabel} tone="green" />
        <PayoffStat
          label="損益分岐点"
          value={summary.breakevens.length > 0 ? summary.breakevens.map((item) => formatUSD(item.priceUSD)).join(" / ") : "未計算"}
        />
      </div>
      {summary.secondaryBreakevens && summary.secondaryBreakevens.length > 0 ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          <span className="font-bold text-slate-800">参考: </span>
          {summary.secondaryBreakevens.map((item) => `${item.label} ${formatUSD(item.priceUSD)}`).join(" / ")}
          <span className="ml-1">保有株込みの損益分岐点ではありません。</span>
        </div>
      ) : null}
      {summary.formulas.length > 0 ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          <div className="font-bold text-slate-800">損益分岐点の計算</div>
          <ul className="mt-1 grid gap-1">
            {summary.formulas.map((formula) => (
              <li key={formula}>{formula}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function PayoffStat({ label, value, tone, note }: { label: string; value: string; tone?: "green" | "red"; note?: string }) {
  const toneClass = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "text-slate-950";
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={`numeric-input mt-1 text-lg font-bold ${toneClass}`}>{value}</div>
      {note ? <p className="mt-1 text-xs leading-5 text-slate-600">{note}</p> : null}
    </div>
  );
}

export function DenominatorChart({ denominators }: { denominators: DenominatorResult[] }) {
  const data = denominators.map((row) => ({
    name: row.label.replace("ベース", ""),
    amountJPY: Math.round(row.amountJPY),
    annualReturnPct: row.annualReturnPct,
  }));

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">分母別の大きさ</h2>
      <div className="mt-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 18, bottom: 44, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" angle={-18} textAnchor="end" interval={0} height={70} tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 10000)}万`} />
            <Tooltip
              formatter={(value, name, item) =>
                name === "amountJPY"
                  ? [formatJPY(Number(value)), `年率 ${formatPct(item.payload.annualReturnPct)}`]
                  : value
              }
            />
            <Bar dataKey="amountJPY" fill="#0f766e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
