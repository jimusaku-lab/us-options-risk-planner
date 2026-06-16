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
import type { DenominatorResult, PayoffPoint, TradeSimulation } from "@/types/domain";
import { getShortCallLegs, getShortPutLegs } from "@/domain/calculations";
import { formatJPY, formatPct } from "@/lib/format";

export function PayoffChart({ simulation, points }: { simulation: TradeSimulation; points: PayoffPoint[] }) {
  const call = getShortCallLegs(simulation)[0];
  const put = getShortPutLegs(simulation)[0];
  const isShortPutOnly = simulation.strategyType === "short_put" && put;
  const putBreakeven = put ? Math.max(0, put.strikeUSD - put.premiumUSD) : null;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">満期ペイオフチャート</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        横軸は満期時の株価、縦軸はその株価で満期を迎えた場合の概算損益です。
        {isShortPutOnly
          ? ` プット売りでは、株価が${put.strikeUSD} USD以上なら利益はプレミアム付近で頭打ちになり、${putBreakeven?.toFixed(2)} USDを下回ると満期時点の評価損・含み損を抱える水準になります。`
          : " 0円ラインより上が利益、下は満期時点の評価損・含み損を示します。"}
      </p>
      <div className="mt-4 h-80">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 10, right: 24, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="payoff" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0f766e" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.15} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="stockPriceUSD" tickFormatter={(value) => `$${value}`} />
            <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 10000)}万`} />
            <Tooltip formatter={(value) => formatJPY(Number(value))} labelFormatter={(label) => `株価 $${label}`} />
            <ReferenceLine y={0} stroke="#334155" />
            <ReferenceLine x={simulation.currentPriceUSD} stroke="#2563eb" label="現在株価" />
            {call ? <ReferenceLine x={call.strikeUSD} stroke="#dc2626" label="C権利行使価格" /> : null}
            {put ? <ReferenceLine x={put.strikeUSD} stroke="#d97706" label="P権利行使価格" /> : null}
            {isShortPutOnly && putBreakeven ? (
              <ReferenceLine x={putBreakeven} stroke="#7c3aed" label="損益分岐点" />
            ) : null}
            <Area type="monotone" dataKey="pnlJPY" stroke="#0f766e" fill="url(#payoff)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
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
