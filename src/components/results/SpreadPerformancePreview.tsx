import type { OptionLeg, TradeSimulation } from "@/types/domain";
import { calculateBearPutSpreadEstimate } from "@/domain/bearPutSpread";
import { getOptionLegCloseProgress } from "@/domain/optionCloseExecutions";
import { formatPct, formatUSD } from "@/lib/format";

const amount = (value: number | undefined) => value !== undefined && Number.isFinite(value) ? formatUSD(value) : "未確認";
export function spreadPriceEvidenceLabel(leg: OptionLeg): string {
  const plan = leg.closePlan;
  if (!plan?.priceSource || plan.priceSource === "manual") return `手入力参考・${plan?.priceFetchedAt ? `記録 ${plan.priceFetchedAt}` : "時点未記録"}`;
  return `${plan.priceSource} ${plan.priceSelectedField ?? "価格種別未記録"} / ${plan.priceType ?? "気配種別未記録"} / 受信 ${plan.priceFetchedAt ?? "時点未記録"} / 取得価格ベースの参考`;
}
export function SpreadPerformancePreview({ simulation, editable = false, onChange, onDraft, onUngroup, anchor = false }: { simulation: TradeSimulation; editable?: boolean; onChange?: (simulation: TradeSimulation) => void; onDraft?: (leg: OptionLeg) => void; onUngroup?: () => void; anchor?: boolean }) {
  const estimate = calculateBearPutSpreadEstimate(simulation);
  const progress = getOptionLegCloseProgress(simulation);
  const available = estimate.kind === "available" ? estimate : undefined;
  const partial = ["partial_pairs", "one_leg_remaining", "imbalanced"].includes(estimate.lifecycle.state);
  const patch = (leg: OptionLeg, field: "price" | "fee", text: string, remaining: number) => {
    const value = text.trim() === "" ? undefined : Number(text);
    if (value !== undefined && (!Number.isFinite(value) || field === "price" && value < 0)) return;
    const at = new Date().toISOString();
    onChange?.({ ...simulation, optionLegs: simulation.optionLegs.map(item => item.id !== leg.id ? item : {
      ...item, ...(field === "price" ? { closeCostUSD: value } : {}), closePlan: { ...item.closePlan, enabled: true,
        ...(field === "price" ? { closePriceUSD: value, priceSource: "manual", priceSelectedField: "manual", priceFetchedAt: at } : { commissionUSD: value, commissionContracts: remaining, commissionSource: "manual", commissionConfirmedAt: at }) },
    }) });
  };
  return <section id={anchor ? `spread-close-preview-${simulation.id}` : undefined} tabIndex={anchor ? -1 : undefined} aria-label="戦略の決済プレビュー" className="min-w-0 rounded border border-indigo-200 bg-indigo-50 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-600">
    <p className="text-sm font-bold">{estimate.lifecycle.label} / {estimate.lifecycle.state === "closed" ? "確定した取引実績" : "取得価格ベースの決済参考"}</p>
    {simulation.strategyContractVerification?.state !== "verified" ? <p className="text-xs text-slate-600">2脚の組み合わせ／ベア・プットとして管理・契約仕様未照合。満期相殺・最大損益は未表示。</p> : null}
    <p className="text-xs text-slate-600">注文は行いません。決済済み実績と残存見込みを分離します。</p>
    <div className="mt-2 grid gap-2 sm:grid-cols-3">
      <div className="rounded bg-white p-2"><div className="text-xs">建玉時の手数料込み支払額</div><strong>{amount(estimate.entryAllInDebitUSD)}</strong></div>
      <div className="rounded bg-white p-2"><div className="text-xs">{available && available.closeNetProceedsUSD < 0 ? "残りを閉じる手数料込み追加支払" : "残りを閉じる手数料後受取額"}</div><strong>{amount(available && Math.abs(available.closeNetProceedsUSD))}</strong></div>
      <div className="rounded bg-white p-2"><div className="text-xs">{estimate.lifecycle.state === "closed" ? "最終実現損益" : "戦略累計見込損益"}</div><strong>{amount(available?.totalEstimatedPnlUSD)}</strong><span className="block text-xs">期間損益率 {available && Number.isFinite(available.periodReturnPct) ? formatPct(available.periodReturnPct) : "算出対象外・未確認"}</span></div>
    </div>
    {partial ? <p className="mt-2 text-sm">確定損益 {amount(estimate.realizedPnlUSD)} / 残り見込み {amount(available?.remainingEstimatedPnlUSD)} / 累計見込み {amount(available?.totalEstimatedPnlUSD)}</p> : null}
    {estimate.kind === "missing" ? <p className="mt-2 text-sm text-amber-800">{estimate.reasons.join(" / ")}</p> : null}
    <details className="mt-2" open={editable}><summary className="cursor-pointer text-xs font-bold">2本の明細・費用対象数量</summary>
      <div className="mt-2 grid gap-2 md:grid-cols-2">{simulation.optionLegs.map(leg => {
        const remaining = progress.legs.find(item => item.legId === leg.id)?.remainingContracts;
        const price = leg.closePlan?.closePriceUSD ?? leg.closeCostUSD;
        return <div key={leg.id} className="min-w-0 rounded bg-white p-2 text-xs"><p className="font-bold">{leg.side === "buy" ? "高ストライクP買い" : "低ストライクP売り"} {leg.strikeUSD} / {leg.expiryDate}</p><p>残り{remaining ?? "未確認"}枚 / 開始価格 {amount(leg.premiumUSD)}</p>
          {remaining === 0 ? <p>決済済み（現値は再評価しません）</p> : <><p>決済参考価格 {amount(price)} / 費用対象{remaining ?? "未確認"}枚・合計 {amount(leg.closePlan?.commissionUSD)}</p><p className="break-words text-slate-500">{spreadPriceEvidenceLabel(leg)}{price === 0 ? " / 明示ゼロ参考・売却可能の保証なし" : ""}</p>
            {editable && remaining !== undefined && remaining > 0 ? <div className="mt-2 grid gap-2"><label>決済参考価格 USD<input aria-label={`${leg.side === "buy" ? "P買い" : "P売り"} 決済参考価格 USD`} type="number" step="any" min="0" className="ml-2 w-24 rounded border p-1" value={price ?? ""} onChange={event => patch(leg, "price", event.target.value, remaining)} /></label><label>残り{remaining}枚の決済費用合計 USD<input aria-label={`${leg.side === "buy" ? "P買い" : "P売り"} 決済費用合計 USD`} type="number" step="any" className="ml-2 w-24 rounded border p-1" value={leg.closePlan?.commissionUSD ?? ""} onChange={event => patch(leg, "fee", event.target.value, remaining)} /></label>{onDraft ? <button type="button" disabled={price === undefined} onClick={() => onDraft({ ...leg, quantity: remaining })} className="rounded border p-1">この脚の決済実績下書きを作成</button> : null}</div> : null}</>}
        </div>;
      })}</div>
      <p className="mt-2 text-xs">参考年率 {available?.annualizedReturnPct !== undefined && Number.isFinite(available.annualizedReturnPct) ? formatPct(available.annualizedReturnPct) : partial || estimate.lifecycle.state === "closed" ? "対象外（分割取引・日付未確認）" : "未計算"}。開始原価は部分決済で縮めません。価格履歴: 記録がある場合は各脚の保存証拠を参照します。</p>
      {onUngroup ? <button type="button" disabled={Boolean(simulation.optionCloseExecutions?.length)} className="mt-2 rounded border px-2 py-1 text-xs disabled:opacity-50" onClick={onUngroup}>組み合わせを解除（約定は残す）</button> : null}
    </details>
  </section>;
}
