import { useEffect, useId, useRef, useState } from "react";
import { calculateAccountExpiryPayoff, getExpiryBreakevenMoves } from "@/domain/accountExpiryPayoff";
import { getStrategyLabel } from "@/domain/strategyLabels";
import { formatJPY, formatUSD } from "@/lib/format";
import type { TradeSimulation } from "@/types/domain";

type Payoff = Extract<ReturnType<typeof calculateAccountExpiryPayoff>, { kind: "available" }>;

function formatBreakevenMove(delta: number, percent: number) {
  if (delta === 0) return "到達済み（値動き不要）";
  const dollars = Math.abs(delta);
  const ratio = Math.abs(percent);
  return `${dollars < 0.01 ? "$0.01未満" : formatUSD(dollars)}（${ratio < 0.01 ? "0.01%未満" : `${ratio.toFixed(2)}%`}）${delta > 0 ? "上昇" : "下落"}`;
}

export function AccountExpiryPayoffDialog({ initial, positions, account, onClose }: {
  initial: TradeSimulation;
  positions: TradeSimulation[];
  account: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [id, setId] = useState(initial.id);
  const selected = positions.find((position) => position.id === id) ?? initial;
  const result = calculateAccountExpiryPayoff(selected);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={title}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="max-h-[90vh] w-[calc(100%-2rem)] max-w-5xl overflow-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
        <div>
          <div className="text-xs font-semibold tracking-wide text-slate-500">{account}口座 · 建玉別</div>
          <h2 id={title} className="text-xl font-bold">満期損益チャート</h2>
        </div>
        <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm font-semibold hover:bg-slate-100">閉じる</button>
      </div>
      <div className="space-y-3 p-4 sm:p-5">
        <label className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          表示する建玉
          <select value={selected.id} onChange={(event) => setId(event.target.value)}
            className="max-w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
            {positions.map((position) => <option value={position.id} key={position.id}>
              {position.ticker} · {getStrategyLabel(position.strategyType)} · {position.optionLegs.map((leg) => `${leg.type === "call" ? "C" : "P"}${leg.strikeUSD}`).join("/")} · {position.expiryDate}
            </option>)}
          </select>
        </label>
        {result.kind === "available"
          ? <PayoffPlot payoff={result} />
          : <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{result.reason} 満期損益は未計算です。</p>}
      </div>
    </dialog>
  );
}

function PayoffPlot({ payoff }: { payoff: Payoff }) {
  const clip = useId();
  const money = payoff.currency === "JPY" ? formatJPY : formatUSD;
  const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value))}`;
  const breakeven = [
    ...payoff.breakevens.map((price) => formatUSD(price)),
    ...payoff.zeroRanges.map(({ start, end }) => `${formatUSD(start)}${end === Infinity ? "以上" : `〜${formatUSD(end)}`}`),
  ].join(" / ") || "なし";
  const levels = [...payoff.strikes, ...payoff.breakevens,
    ...payoff.zeroRanges.flatMap(({ start, end }) => end === Infinity ? [start] : [start, end]),
    ...(payoff.spot === undefined ? [] : [payoff.spot])];
  const min = Math.min(...levels), max = Math.max(...levels);
  const pad = Math.max(1, max * 0.05, (max - min) * 0.16);
  const lo = Math.max(0, min - pad), hi = max + pad;
  const points = [lo, ...payoff.strikes, hi].map((price) => ({ price, pnl: payoff.atPrice(price) }));
  const bottom = Math.min(0, ...points.map(({ pnl }) => pnl));
  const top = Math.max(0, ...points.map(({ pnl }) => pnl));
  const margin = Math.max(1, (top - bottom) * 0.12);
  const x0 = 93, x1 = 861, y0 = 36, y1 = 242;
  const x = (price: number) => x0 + (price - lo) / (hi - lo) * (x1 - x0);
  const y = (pnl: number) => y1 - (pnl - bottom + margin) / (top - bottom + 2 * margin) * (y1 - y0);
  const curve = points.map(({ price, pnl }, index) => `${index ? "L" : "M"}${x(price)} ${y(pnl)}`).join(" ");
  const area = `${curve} L${x1} ${y(0)} L${x0} ${y(0)} Z`;
  const spot = payoff.spot;
  const spotPnl = spot === undefined ? undefined : payoff.atPrice(spot);
  const distance = getExpiryBreakevenMoves(spot, payoff.breakevens, payoff.zeroRanges);
  const nearest = distance.kind === "moves" ? distance.moves[0] : undefined;
  const ticks = [...new Set([bottom, bottom / 2, 0, top / 2, top])];
  const stats = [
    ["損益分岐株価", breakeven, "text-sky-200"],
    ["最大損失", payoff.maxLoss === -Infinity ? "無制限" : signed(payoff.maxLoss), "text-rose-300"],
    ["最大利益", payoff.maxProfit === Infinity ? "無制限" : signed(payoff.maxProfit), "text-emerald-300"],
  ];
  return <section aria-label="建玉の満期損益" className="rounded-xl bg-slate-950 p-3 text-white sm:p-4">
    <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {stats.map(([label, value, tone]) => <div key={label} className="rounded-md bg-slate-800 px-3 py-2">
        <div className="text-xs font-semibold text-slate-300">{label}</div>
        <strong className={`text-lg tabular-nums ${tone}`}>{value}</strong>
      </div>)}
    </div>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-300">
      <span>満期 {payoff.expiry} · 損益 {payoff.currency}</span>
      <span className="font-bold text-amber-300">現在株価（保存値） {spot === undefined ? "未取得" : formatUSD(spot)}</span>
      {spotPnl !== undefined ? <span>この株価で満期を迎えた場合 {signed(spotPnl)}</span> : null}
    </div>
    <div aria-label="現在株価から損益分岐点まで" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-sky-800 bg-sky-950 px-3 py-2 text-sm">
      <span className="font-semibold text-slate-200">現在株価から損益分岐点まで</span>
      {distance.kind === "moves" ? distance.moves.map(({ target, delta, percent }) =>
        <span key={target} className="whitespace-nowrap tabular-nums text-sky-200">
          <span className="text-xs">{formatUSD(target)}まで </span>
          <strong>{formatBreakevenMove(delta, percent)}</strong>
        </span>
      ) : <strong className="text-sky-200">{
        distance.kind === "no-spot" ? "現在株価が未取得のため未計算"
          : distance.kind === "in-range" ? "損益分岐の範囲内（値動き不要）"
          : "損益分岐点なし"
      }</strong>}
    </div>
    <svg viewBox="0 0 884 302" className="mt-2 block w-full" role="img"
      aria-label="満期損益チャート。横軸は株価、縦軸は満期損益。緑は利益、赤は損失、橙色は現在株価。">
      <defs>
        <clipPath id={`${clip}-gain`}><rect x={x0} y={y0} width={x1 - x0} height={y(0) - y0} /></clipPath>
        <clipPath id={`${clip}-loss`}><rect x={x0} y={y(0)} width={x1 - x0} height={y1 - y(0)} /></clipPath>
      </defs>
      <path d={area} fill="#059669" fillOpacity={0.48} clipPath={`url(#${clip}-gain)`} />
      <path d={area} fill="#e11d48" fillOpacity={0.49} clipPath={`url(#${clip}-loss)`} />
      {ticks.map((tick) => <g key={tick}>
        <line x1={x0} x2={x1} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "#cbd5e1" : "#334155"} />
        <text x={x0 - 7} y={y(tick) + 4} textAnchor="end" fill="#cbd5e1" fontSize={12}>{new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2, notation: "compact" }).format(tick)}</text>
      </g>)}
      {payoff.strikes.map((price) => <line key={price} x1={x(price)} x2={x(price)} y1={y0} y2={y1} stroke="#94a3b8" strokeDasharray="3 5" />)}
      <path d={curve} fill="none" stroke="#60a5fa" strokeWidth={3} />
      {payoff.zeroRanges.map(({ start, end }) => <line key={start} x1={x(start)} x2={x(Math.min(end, hi))} y1={y(0)} y2={y(0)} stroke="#7dd3fc" strokeWidth={4} />)}
      {payoff.breakevens.map((price) => <circle key={price} cx={x(price)} cy={y(0)} r={4.5} fill="#7dd3fc" stroke="#0f172a" strokeWidth={1.5} />)}
      {spot !== undefined && nearest && nearest.delta !== 0 ? <g aria-hidden="true">
        <path d={`M${x(spot)} 26v8 M${x(spot)} 30H${x(nearest.target)} M${x(nearest.target)} 26v8`} fill="none" stroke="#7dd3fc" strokeWidth={2} />
      </g> : null}
      {spot !== undefined && spotPnl !== undefined ? <g data-testid="expiry-payoff-current-price">
        <line x1={x(spot)} x2={x(spot)} y1={y0} y2={y1} stroke="#fbbf24" strokeWidth={2} strokeDasharray="6 4" />
        <circle cx={x(spot)} cy={y(spotPnl)} r={5.5} fill="#fbbf24" stroke="#0f172a" strokeWidth={1.5} />
        <text x={Math.max(x0 + 72, Math.min(x1 - 72, x(spot)))} y={21} textAnchor="middle" fill="#fcd34d" fontSize={15} fontWeight="bold">現在 {formatUSD(spot)}</text>
      </g> : null}
      {Array.from({ length: 6 }, (_, i) => lo + (hi - lo) * i / 5).map((price) =>
        <text key={price} x={x(price)} y={261} textAnchor="middle" fill="#cbd5e1" fontSize={13}>{formatUSD(price)}</text>)}
      <text x={(x0 + x1) / 2} y={290} textAnchor="middle" fill="#cbd5e1" fontSize={14}>満期時の株価（USD）</text>
      <text x={15} y={(y0 + y1) / 2} textAnchor="middle" transform={`rotate(-90 15 ${(y0 + y1) / 2})`} fill="#cbd5e1" fontSize={13}>満期損益（{payoff.currency}）</text>
    </svg>
    <div className="flex flex-wrap gap-2 text-xs text-slate-200">
      {payoff.legs.map(({ leg, remaining }) => <span key={leg.id} className="rounded bg-slate-800 px-2 py-1">
        {leg.type === "call" ? "コール" : "プット"}{leg.side === "buy" ? "買い" : "売り"} {formatUSD(leg.strikeUSD)} × {remaining}枚
      </span>)}
      {payoff.shares > 0 ? <span className="rounded bg-slate-800 px-2 py-1">登録現物 {payoff.shares}株を含む</span> : null}
      <span className="px-1 py-1 text-sky-200">水色の丸・線：損益ゼロ</span>
    </div>
    <p className="mt-3 text-xs leading-relaxed text-slate-400">
      この建玉を満期まで保有した場合の試算です。最大損失・最大利益は表示範囲外も含めて計算し、満期時の追加費用・税・配当は含みません。
      {payoff.fxRate !== undefined ? ` 円損益は開始記帳額と保存為替（1 USD = ${payoff.fxRate}円）で試算しています。` : " 保存済みの開始費用を含みます。"}
      {payoff.partial ? " 残っている脚・枚数のみを対象とし、決済済み分の実現損益は含みません。" : ""}
      {payoff.estimated ? " 開始約定の記録に推定値を含みます。" : ""}
    </p>
  </section>;
}
