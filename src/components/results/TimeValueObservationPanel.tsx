import type { OptionLeg, OptionValueObservation, OptionValueParentObservation } from "@/types/domain";
import { calculateOptionValueDecomposition, getTimeValueObservationTimeline } from "@/domain/timeValue";
import { formatUSD } from "@/lib/format";

type Props = {
  legs: OptionLeg[];
  title?: string;
  compact?: boolean;
  remainingContractsByLeg?: Record<string, number | undefined>;
  currentUnderlyingPriceUSD?: number;
  parentHistory?: OptionValueParentObservation[];
  parentUpdateReason?: string;
};

const DECOMPOSITION_TOLERANCE_USD = 0.005;
const legLabel = (leg: OptionLeg) => `${leg.type === "call" ? "C" : "P"}${leg.side === "buy" ? "買い" : "売り"}`;
const signed = (value: number | undefined) => value === undefined || !Number.isFinite(value) ? "未確認" : `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatUSD(Math.abs(value))}`;
const sourceLabel = (source: OptionValueObservation["source"] | undefined) => source === "saxo" ? "Saxo取得" : source === "manual" ? "手入力" : source === "moomoo" ? "moomoo参考" : source === "derived" ? "アプリ算出" : source === "legacy" ? "旧保存値" : "取得元未確認";
const fieldLabel = (field: string | undefined) => field === "bid" ? "Bid" : field === "ask" ? "Ask" : field === "mid" ? "Mid" : field === "last" ? "Last" : field === "manual" ? "手入力" : "価格種別未確認";
const qualityLabel = (quality: string | undefined) => quality === "old_indicative" ? "古い参考気配" : quality === "current" ? "現在値" : quality === "manual" ? "手入力値" : quality === "reference" ? "参考値" : quality === "unknown" ? "品質未確認" : "取得時点";
const nonnegativeMoneyLabel = (value: number | undefined) => Number.isFinite(value) && value! >= 0 ? formatUSD(value!) : "未確認";
const finiteMoneyLabel = (value: number | undefined) => Number.isFinite(value) ? formatUSD(value!) : "未確認";

type ValidBarDecomposition = { intrinsicPct: number; timePct: number };

function resolveBarDecomposition(input: {
  state?: OptionValueObservation["decompositionState"];
  decompositionState?: OptionValueObservation["decompositionState"];
  optionPriceUSD: number;
  intrinsicValueUSD?: number;
  timeValueUSD?: number;
}): ValidBarDecomposition | undefined {
  const { optionPriceUSD, intrinsicValueUSD, timeValueUSD } = input;
  const state = input.state ?? input.decompositionState;
  if (state !== "available" || !Number.isFinite(optionPriceUSD) || optionPriceUSD <= 0
    || !Number.isFinite(intrinsicValueUSD) || !Number.isFinite(timeValueUSD)
    || intrinsicValueUSD! < 0 || timeValueUSD! < 0
    || Math.abs(intrinsicValueUSD! + timeValueUSD! - optionPriceUSD) > DECOMPOSITION_TOLERANCE_USD) return undefined;
  return { intrinsicPct: intrinsicValueUSD! / optionPriceUSD * 100, timePct: timeValueUSD! / optionPriceUSD * 100 };
}

function DecompositionBar({ optionPriceUSD, intrinsicValueUSD, timeValueUSD, state, label = "現在値" }: {
  optionPriceUSD: number;
  intrinsicValueUSD?: number;
  timeValueUSD?: number;
  state: OptionValueObservation["decompositionState"];
  label?: string;
}) {
  const decomposition = resolveBarDecomposition({ state, optionPriceUSD, intrinsicValueUSD, timeValueUSD });
  if (!decomposition) return <p className="mt-1 text-[11px] text-slate-500">{optionPriceUSD === 0 ? "価格0・分解バーなし" : "分解未確認"}</p>;
  return <div className="mt-2" aria-label={`${label}の本質価値と時間価値の分解バー`}>
    <div className="flex h-2 overflow-hidden rounded bg-slate-200" role="img" aria-label={`${label}: 本質的価値 ${formatUSD(intrinsicValueUSD!)}、時間価値 ${formatUSD(timeValueUSD!)}`}>
      {decomposition.intrinsicPct > 0 ? <span className="bg-emerald-500" style={{ width: `${decomposition.intrinsicPct}%` }} /> : null}
      {decomposition.timePct > 0 ? <span className="bg-rose-400" style={{ width: `${decomposition.timePct}%` }} /> : null}
    </div>
    <p className="mt-1 text-[11px] text-slate-600">本質 {formatUSD(intrinsicValueUSD!)} / 時間 {formatUSD(timeValueUSD!)}（緑 / 赤）</p>
  </div>;
}

function HistoryPriceBar({ observation, maxPriceUSD }: { observation: OptionValueObservation; maxPriceUSD?: number }) {
  if (!Number.isFinite(observation.optionPriceUSD) || observation.optionPriceUSD < 0) return <span className="text-[10px] text-amber-800">価格未確認</span>;
  if (observation.optionPriceUSD === 0) return <span className="text-[10px] text-slate-500">価格0・バーなし</span>;
  if (!Number.isFinite(maxPriceUSD) || maxPriceUSD! <= 0) return <span className="text-[10px] text-slate-500">尺度未確認</span>;
  const priceWidthPct = Math.min(100, Math.max(0, observation.optionPriceUSD / maxPriceUSD! * 100));
  const decomposition = resolveBarDecomposition(observation);
  return <div className="h-3 w-full rounded bg-slate-100" role="img" aria-label={`${observation.snapshotDate} 価格 ${formatUSD(observation.optionPriceUSD)}、${decomposition ? `本質 ${formatUSD(observation.intrinsicValueUSD!)}、時間 ${formatUSD(observation.timeValueUSD!)}` : "未分解"}`}>
    <div className={`flex h-3 overflow-hidden rounded ${decomposition ? "" : "bg-slate-400"}`} style={{ width: `${priceWidthPct}%` }}>
      {decomposition ? <>
        {decomposition.intrinsicPct > 0 ? <span className="bg-emerald-500" style={{ width: `${decomposition.intrinsicPct}%` }} /> : null}
        {decomposition.timePct > 0 ? <span className="bg-rose-400" style={{ width: `${decomposition.timePct}%` }} /> : null}
      </> : null}
    </div>
  </div>;
}

function ObservationEvidence({ item }: { item: OptionValueObservation }) {
  const validDecomposition = resolveBarDecomposition(item);
  const validRatio = validDecomposition && Number.isFinite(item.timeValueRatio) && item.timeValueRatio! >= 0 ? item.timeValueRatio : undefined;
  return <details className="mt-1 text-[10px] text-slate-600">
    <summary className="cursor-pointer font-semibold">計算根拠</summary>
    <div className="mt-1 grid gap-0.5 pl-2">
      <span>株価 {nonnegativeMoneyLabel(item.underlyingPriceUSD)} / 株価時点 {item.underlyingSourceTimestamp ?? "未確認"} / 株価出所 {item.underlyingSource ?? "未確認"}</span>
      <span>本質 {validDecomposition ? formatUSD(item.intrinsicValueUSD!) : "未確認"} / 時間 {validDecomposition ? formatUSD(item.timeValueUSD!) : "未確認"}{validRatio === undefined ? "" : ` / 時間価値比率 ${(validRatio * 100).toFixed(1)}%`}</span>
      <span>分解状態 {validDecomposition ? "整合確認済み" : item.reason ?? "未分解・整合確認待ち"}</span>
      <span>数量 {Number.isInteger(item.quantity) && item.quantity! > 0 ? `${item.quantity}枚` : "未確認"}{item.quantityChanged ? ` / 数量変更（前回 ${item.previousQuantity ?? "未確認"}枚）` : ""} / 契約倍率 {Number.isInteger(item.contractSize) && item.contractSize! > 0 ? item.contractSize : "未確認"}</span>
      <span>取得元 {sourceLabel(item.source)} / 品質 {qualityLabel(item.quality)} / 価格種別 {fieldLabel(item.selectedField)}</span>
      <span>価格時点 {item.sourceTimestamp ?? "未確認"} / 取得日時 {item.capturedAt ?? "未確認"}</span>
      <span>費用 {finiteMoneyLabel(item.feeUSD)} / 費用出所 {item.feeSource ?? "未確認"}</span>
    </div>
  </details>;
}

export function TimeValueObservationPanel({ legs, title = "時間価値・反対売買判断", compact = false, remainingContractsByLeg, currentUnderlyingPriceUSD, parentHistory, parentUpdateReason }: Props) {
  const rows = legs.map((leg) => ({
    leg,
    observations: getTimeValueObservationTimeline(leg),
    savedPriceUSD: leg.closeCostUSD ?? leg.closePlan?.closePriceUSD,
    fallbackDecomposition: (leg.closeCostUSD ?? leg.closePlan?.closePriceUSD) !== undefined && Number.isFinite(currentUnderlyingPriceUSD)
      ? calculateOptionValueDecomposition({ optionType: leg.type, optionPriceUSD: leg.closeCostUSD ?? leg.closePlan?.closePriceUSD as number, underlyingPriceUSD: currentUnderlyingPriceUSD, strikeUSD: leg.strikeUSD })
      : undefined,
    remainingContracts: remainingContractsByLeg?.[leg.id] ?? leg.quantity,
  }));
  const current = rows.map((row) => ({ ...row, observation: row.observations.at(-1) }));
  const anyObservation = current.some((row) => row.observation);
  const batchIds = current.map((row) => row.observation?.batchId).filter((value): value is string => Boolean(value));
  const canAggregate = batchIds.length === current.length && new Set(batchIds).size === 1
    && new Set(current.map((row) => row.observation?.snapshotDate)).size === 1
    && current.every((row) => row.observation?.decompositionState === "available" && Number.isFinite(row.observation.quantity) && Number.isFinite(row.observation.contractSize));
  const net = canAggregate ? current.reduce((sum, row) => { const observation = row.observation!; return sum + (observation.side === "buy" ? 1 : -1) * observation.optionPriceUSD * observation.contractSize! * observation.quantity!; }, 0) : undefined;
  const netIntrinsic = canAggregate ? current.reduce((sum, row) => { const observation = row.observation!; return sum + (observation.side === "buy" ? 1 : -1) * (observation.intrinsicValueUSD ?? 0) * observation.contractSize! * observation.quantity!; }, 0) : undefined;
  const netTimeValue = canAggregate && current.every((row) => row.observation?.timeValueUSD !== undefined) ? current.reduce((sum, row) => { const observation = row.observation!; return sum + (observation.side === "buy" ? 1 : -1) * observation.timeValueUSD! * observation.contractSize! * observation.quantity!; }, 0) : undefined;

  return <section className={`mt-3 rounded border border-indigo-200 bg-indigo-50/60 p-3 ${compact ? "text-xs" : "text-sm"}`} aria-label={title}>
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="font-bold text-indigo-950">{title}</h4><span className="text-xs text-slate-600">決済候補基準・中間値評価とは別</span><span className="text-xs text-slate-600">保存済み価格の観測だけを使用</span></div>
    {!anyObservation && current.some((row) => row.savedPriceUSD !== undefined) ? <p className="mt-2 text-xs text-slate-700">現在価格 {formatUSD(current.find((row) => row.savedPriceUSD !== undefined)!.savedPriceUSD!)} / 取得元・時点未確認。現在株価が有効な場合は時点未確認の参考分解です。履歴観測は価格反映時に作成されます。</p> : null}
    {!anyObservation && !current.some((row) => row.savedPriceUSD !== undefined) ? <p className="mt-2 text-xs text-slate-600">現在価格 未取得</p> : null}
    <p className="mt-2 text-[11px] text-slate-600" aria-label="バーの色の凡例">緑: 本質価値 / 赤: 時間価値</p>
    <div className="mt-2 grid gap-2 md:grid-cols-2">
      {current.map(({ leg, observation, observations, savedPriceUSD, remainingContracts, fallbackDecomposition }) => {
        const validHistoryPrices = observations.map((item) => item.optionPriceUSD).filter((price) => Number.isFinite(price) && price >= 0);
        const maxHistoryPrice = validHistoryPrices.length > 0 ? Math.max(...validHistoryPrices) : undefined;
        return <div key={leg.id} className="rounded border border-indigo-100 bg-white p-2">
          <p className="font-bold">{legLabel(leg)} / 残り{Number.isInteger(remainingContracts) && remainingContracts >= 0 ? remainingContracts : "未確認"}枚</p>
          {!observation && savedPriceUSD === undefined ? <p className="mt-1 text-xs text-slate-600">現在価格 未取得</p> : !observation ? <><p className="mt-1 text-xs text-slate-700">価格 {nonnegativeMoneyLabel(savedPriceUSD)} / 保存済み価格・取得元/時点未確認</p><p className="text-xs text-slate-700">本質的価値 {fallbackDecomposition?.state === "available" && Number.isFinite(fallbackDecomposition.intrinsicValueUSD) ? formatUSD(fallbackDecomposition.intrinsicValueUSD!) : "未計算"} / 時間価値 {fallbackDecomposition?.state === "available" && Number.isFinite(fallbackDecomposition.timeValueUSD) ? signed(fallbackDecomposition.timeValueUSD) : "未計算"}</p><DecompositionBar optionPriceUSD={savedPriceUSD!} intrinsicValueUSD={fallbackDecomposition?.intrinsicValueUSD} timeValueUSD={fallbackDecomposition?.timeValueUSD} state={fallbackDecomposition?.state ?? "missing"} /><p className="mt-1 text-xs font-semibold text-amber-800">{fallbackDecomposition?.reason ?? "時点未確認の参考分解"}</p></> : <>
            <p className="mt-1 text-xs text-slate-700">価格 {nonnegativeMoneyLabel(observation.optionPriceUSD)} / {fieldLabel(observation.selectedField)}・{qualityLabel(observation.quality)}</p>
            <p className="text-xs text-slate-700">本質的価値 {resolveBarDecomposition(observation) ? formatUSD(observation.intrinsicValueUSD!) : "未計算"} / 時間価値 {resolveBarDecomposition(observation) ? signed(observation.timeValueUSD) : "未計算"}{resolveBarDecomposition(observation) && Number.isFinite(observation.timeValueRatio) && observation.timeValueRatio! >= 0 ? ` (${(observation.timeValueRatio! * 100).toFixed(1)}%)` : ""}</p>
            <DecompositionBar optionPriceUSD={observation.optionPriceUSD} intrinsicValueUSD={observation.intrinsicValueUSD} timeValueUSD={observation.timeValueUSD} state={observation.decompositionState} />
            {observation.decompositionState !== "available" || !resolveBarDecomposition(observation) ? <p className="mt-1 text-xs font-semibold text-amber-800">{observation.reason ?? "時間価値を分解できません"}</p> : null}
            {observation.quantityChanged ? <p className="mt-1 text-xs font-semibold text-amber-800">数量変更/部分決済（前回 {observation.previousQuantity ?? "未確認"}枚）</p> : null}
            <p className="text-[11px] text-slate-500">価格の時点 {observation.sourceTimestamp ?? "未確認"} / 取得 {observation.capturedAt ?? "未確認"} / {sourceLabel(observation.source)}</p>
            <p className="text-[11px] text-slate-500">株価 {nonnegativeMoneyLabel(observation.underlyingPriceUSD)} / 株価時点 {observation.underlyingSourceTimestamp ?? "未確認"} / 費用 {finiteMoneyLabel(observation.feeUSD)}</p>
          </>}
          <details className="mt-2 rounded border border-slate-200 bg-slate-50 p-1"><summary className="cursor-pointer text-xs font-semibold">価格推移・計算履歴 {observations.length}件</summary>
            {observations.length === 0 ? <p className="mt-1 text-xs">記録は次回の価格反映から</p> : <div className="mt-1 max-h-40 overflow-auto">{observations.map((item) => <div key={item.observationId} className="grid grid-cols-[minmax(78px,92px)_minmax(0,1fr)_64px] items-center gap-x-2 gap-y-1 border-b border-slate-200 py-1 text-[11px]">
              <div className="min-w-0"><div>{item.snapshotDate}{item.quantityChanged ? " / 数量変更" : ""}</div><div className="text-[10px] text-slate-500">{sourceLabel(item.source)}</div></div>
              <HistoryPriceBar observation={item} maxPriceUSD={maxHistoryPrice} />
              <span className="text-right font-semibold tabular-nums">{Number.isFinite(item.optionPriceUSD) && item.optionPriceUSD >= 0 ? formatUSD(item.optionPriceUSD) : "未確認"}</span>
              <div className="col-span-3 pl-1"><ObservationEvidence item={item} /></div>
            </div>)}</div>}
          </details>
        </div>;
      })}
    </div>
    {rows.length > 1 ? <div className="mt-2 text-xs font-semibold text-indigo-950"><p>両脚の差引評価額（手数料前） {net === undefined ? "未計算（全脚の分解・数量・倍率・同一反映が必要）" : signed(net)}</p><p className="font-normal">本質的価値 {netIntrinsic === undefined ? "未計算" : signed(netIntrinsic)} / 時間価値 {netTimeValue === undefined ? "未計算" : signed(netTimeValue)}</p></div> : null}
    {parentHistory?.length ? <details className="mt-2 rounded border border-indigo-200 bg-white/70 p-2"><summary className="cursor-pointer text-xs font-semibold">スプレッド全体の履歴 {parentHistory.length}件</summary><div className="mt-1 max-h-32 overflow-auto">{parentHistory.map(item => <div key={item.observationId} className="border-b border-indigo-100 py-1 text-[11px]"><div className="flex justify-between gap-2"><span>{item.snapshotDate} / {item.legs.length}脚</span><span>{signed(item.positionValueUSD)}</span></div><div>本質 {item.intrinsicValueUSD === undefined ? "未計算" : signed(item.intrinsicValueUSD)} / 時間 {item.timeValueUSD === undefined ? "未計算" : signed(item.timeValueUSD)} / 決済受払（手数料後） {item.closeCashflowUSD === undefined ? "未確認" : signed(item.closeCashflowUSD)} / 概算損益 {item.estimatedPnlUSD === undefined ? "未確認" : signed(item.estimatedPnlUSD)}{item.periodReturnPct === undefined ? "" : ` / 期間損益率 ${item.periodReturnPct.toFixed(1)}%`}{item.closeFeeUSD === undefined ? " / 費用未確認" : ` / 費用 ${formatUSD(item.closeFeeUSD)}`}{item.quantityChanged ? " / 数量変更" : ""}</div>{item.superseded?.length ? <div className="text-amber-800">訂正前の根拠 {item.superseded.length}件を保持</div> : null}</div>)}</div></details> : null}
    {parentUpdateReason ? <p className="mt-1 text-[11px] text-amber-800">親の組み合わせ履歴は更新していません: {parentUpdateReason}</p> : null}
  </section>;
}
