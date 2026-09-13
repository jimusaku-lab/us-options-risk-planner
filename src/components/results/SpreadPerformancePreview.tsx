import type { OptionLeg, TradeSimulation } from "@/types/domain";
import { calculateBearPutSpreadEstimate } from "@/domain/bearPutSpread";
import { getOptionLegCloseProgress } from "@/domain/optionCloseExecutions";
import { resolveCloseCommissionUSD, SAXO_CLOSE_COMMISSION_CONFIRMED_AT, SAXO_CLOSE_COMMISSION_SOURCE } from "@/domain/closeCommissionStandard";
import { formatPct, formatUSD } from "@/lib/format";

const amount = (value: number | undefined) => value !== undefined && Number.isFinite(value) ? formatUSD(value) : "未確認";
const signedAmount = (value: number | undefined) => value !== undefined && Number.isFinite(value)
  ? `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatUSD(Math.abs(value))}`
  : "未確認";

export function spreadPriceEvidenceLabel(leg: OptionLeg): string {
  const plan = leg.closePlan;
  if (!plan?.priceSource || plan.priceSource === "manual") return `手入力参考・${plan?.priceFetchedAt ? `記録 ${plan.priceFetchedAt}` : "時点未記録"}`;
  return `${plan.priceSource} ${plan.priceSelectedField ?? "価格種別未記録"} / ${plan.priceType ?? "気配種別未記録"} / 受信 ${plan.priceFetchedAt ?? "時点未記録"}`;
}

function strike(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function SpreadPerformancePreview({ simulation, editable = false, onChange, onDraft, onUngroup, anchor = false }: { simulation: TradeSimulation; editable?: boolean; onChange?: (simulation: TradeSimulation) => void; onDraft?: (leg: OptionLeg) => void; onUngroup?: () => void; anchor?: boolean }) {
  const estimate = calculateBearPutSpreadEstimate(simulation);
  const progress = getOptionLegCloseProgress(simulation);
  const available = estimate.kind === "available" ? estimate : undefined;
  const partial = ["partial_pairs", "one_leg_remaining", "imbalanced"].includes(estimate.lifecycle.state);
  const closed = estimate.lifecycle.state === "closed";
  const longPut = simulation.optionLegs.find((leg) => leg.type === "put" && leg.side === "buy");
  const shortPut = simulation.optionLegs.find((leg) => leg.type === "put" && leg.side === "sell");
  const usesOldIndicative = simulation.optionLegs.some((leg) => leg.closePlan?.priceType?.toLowerCase() === "oldindicative");
  const totalCloseFee = available?.evaluatedLegs.reduce((sum, leg) => sum + leg.closeFeeUSD, 0);
  const longExit = available?.evaluatedLegs.find((leg) => leg.legId === longPut?.id);
  const shortExit = available?.evaluatedLegs.find((leg) => leg.legId === shortPut?.id);
  const patch = (leg: OptionLeg, field: "price" | "fee", text: string, remaining: number) => {
    const value = text.trim() === "" ? undefined : Number(text);
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) return;
    const at = new Date().toISOString();
    onChange?.({ ...simulation, optionLegs: simulation.optionLegs.map(item => item.id !== leg.id ? item : {
      ...item, ...(field === "price" ? { closeCostUSD: value } : {}), closePlan: { ...item.closePlan, enabled: true,
        ...(field === "price" ? { closePriceUSD: value, priceSource: "manual", priceSelectedField: "manual", priceFetchedAt: at } : { commissionUSD: value, commissionContracts: remaining, commissionSource: "manual", commissionConfirmedAt: at }) },
    }) });
  };
  return <section id={anchor ? `spread-close-preview-${simulation.id}` : undefined} tabIndex={anchor ? -1 : undefined} aria-label="戦略の決済プレビュー" className="min-w-0 rounded border border-indigo-200 bg-indigo-50 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-600">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm font-bold">ベア・プットの内訳</h3>
      <span className="text-xs font-semibold text-indigo-700">{estimate.lifecycle.label}</span>
    </div>
    <p className="mt-1 text-xs text-slate-700">
      {longPut ? `P${strike(longPut.strikeUSD)}買い ${longPut.quantity}枚` : "P買い 未確認"} ／ {shortPut ? `P${strike(shortPut.strikeUSD)}売り ${shortPut.quantity}枚` : "P売り 未確認"} ／ 満期 {simulation.expiryDate}
    </p>
    {!closed && available ? <p className="mt-1 text-xs text-slate-600">{usesOldIndicative ? "古い参考気配で計算" : "参考価格・想定手数料で計算"}</p> : null}
    {simulation.strategyContractVerification?.state === "incompatible" ? <p className="mt-2 text-sm text-amber-800">契約情報に不一致があります。現在評価へ使えない項目を確認してください。</p> : null}
    {estimate.kind === "missing" ? <p className="mt-2 text-sm text-amber-800">{estimate.reasons.join(" / ")}</p> : null}
    {partial && available ? <p className="mt-2 text-xs text-slate-700">決済済みの損益 {signedAmount(estimate.realizedPnlUSD)} ／ 残っている分を決済した場合 {signedAmount(available.remainingEstimatedPnlUSD)} ／ 合計 {signedAmount(available.totalEstimatedPnlUSD)}</p> : null}
    {closed && available ? <p className="mt-2 text-xs text-slate-700">実現損益 {signedAmount(available.realizedPnlUSD)}</p> : null}

    {!closed ? <details className="mt-3 rounded border border-indigo-100 bg-white/70 px-3 py-2">
      <summary className="cursor-pointer text-xs font-bold">今決済した場合の計算内訳</summary>
      <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-xs">
        <dt>開始時の支払額（手数料込）</dt><dd className="text-right font-semibold">{amount(estimate.entryAllInDebitUSD)}</dd>
        <dt>買いプットの売却代金</dt><dd className="text-right font-semibold">{amount(longExit?.grossAmountUSD)}</dd>
        <dt>売りプットの買戻代金</dt><dd className="text-right font-semibold">{shortExit ? `-${formatUSD(shortExit.grossAmountUSD)}` : "未確認"}</dd>
        <dt>想定決済手数料</dt><dd className="text-right font-semibold">{totalCloseFee !== undefined ? `-${formatUSD(totalCloseFee)}` : "未確認"}</dd>
        <dt>{available && available.closeNetProceedsUSD < 0 ? "決済時の追加支払額" : "決済時の受取額（手数料差引後）"}</dt><dd className="text-right font-semibold">{available ? amount(Math.abs(available.closeNetProceedsUSD)) : "未確認"}</dd>
      </dl>
      {available ? <p className="mt-2 border-t border-indigo-100 pt-2 text-xs font-semibold">{available.closeNetProceedsUSD >= 0 ? amount(available.closeNetProceedsUSD) : signedAmount(available.closeNetProceedsUSD)} − {amount(available.entryAllInDebitUSD)} = {signedAmount(available.remainingEstimatedPnlUSD)}</p> : null}
    </details> : null}

    <details className="mt-2 rounded border border-indigo-100 bg-white/70 px-3 py-2">
      <summary className="cursor-pointer text-xs font-bold">詳細情報</summary>
      {simulation.strategyContractVerification?.state === "unknown" ? <p className="mt-2 text-xs text-slate-600">満期の決済方法・引渡対象の情報が一部未取得です。満期時の最大損益は算出していません。</p> : null}
      {available?.evaluatedLegs.some((leg) => leg.closeFeeSource === SAXO_CLOSE_COMMISSION_SOURCE) ? <p className="mt-2 text-xs text-slate-600">想定手数料（登録料金表） / 根拠日 {SAXO_CLOSE_COMMISSION_CONFIRMED_AT}。実際の決済費用ではありません。</p> : null}
      <div className="mt-2 grid gap-2 md:grid-cols-2">{simulation.optionLegs.map(leg => {
        const remaining = progress.legs.find(item => item.legId === leg.id)?.remainingContracts;
        const price = leg.closePlan?.closePriceUSD ?? leg.closeCostUSD;
        const resolvedFee = remaining !== undefined && remaining > 0 ? resolveCloseCommissionUSD(simulation, leg, remaining) : undefined;
        return <div key={leg.id} className="min-w-0 rounded bg-white p-2 text-xs"><p className="font-bold">{leg.side === "buy" ? "高ストライクP買い" : "低ストライクP売り"} {leg.strikeUSD} / {leg.expiryDate}</p><p>残り{remaining ?? "未確認"}枚 / 開始価格 {amount(leg.premiumUSD)}</p>
          {remaining === 0 ? <p>決済済み（現値は再評価しません）</p> : <><p>決済参考価格 {amount(price)} / 費用対象{remaining ?? "未確認"}枚・合計 {resolvedFee?.kind === "resolved" ? amount(resolvedFee.amountUSD) : "未確認"}</p><p className="break-words text-slate-500">{spreadPriceEvidenceLabel(leg)}{price === 0 ? " / 明示ゼロ参考・売却可能の保証なし" : ""}</p>
            {editable && remaining !== undefined && remaining > 0 ? <div className="mt-2 grid gap-2"><label>決済参考価格 USD<input aria-label={`${leg.side === "buy" ? "P買い" : "P売り"} 決済参考価格 USD`} type="number" step="any" min="0" className="ml-2 w-24 rounded border p-1" value={price ?? ""} onChange={event => patch(leg, "price", event.target.value, remaining)} /></label><label>残り{remaining}枚の決済費用合計 USD<input aria-label={`${leg.side === "buy" ? "P買い" : "P売り"} 決済費用合計 USD`} type="number" step="any" className="ml-2 w-24 rounded border p-1" value={leg.closePlan?.commissionUSD ?? ""} onChange={event => patch(leg, "fee", event.target.value, remaining)} /></label>{onDraft ? <button type="button" disabled={price === undefined} onClick={() => onDraft({ ...leg, quantity: remaining })} className="rounded border p-1">この脚の決済実績下書きを作成</button> : null}</div> : null}</>}
        </div>;
      })}</div>
      <p className="mt-2 text-xs">参考年率 {available?.annualizedReturnPct !== undefined && Number.isFinite(available.annualizedReturnPct) ? formatPct(available.annualizedReturnPct) : partial || closed ? "対象外（分割取引・日付未確認）" : "未計算"}。取得元・記録時点は各脚の明細に表示しています。</p>
      {onUngroup ? <button type="button" disabled={Boolean(simulation.optionCloseExecutions?.length)} className="mt-2 rounded border px-2 py-1 text-xs disabled:opacity-50" onClick={onUngroup}>組み合わせを解除（約定は残す）</button> : null}
    </details>
  </section>;
}
