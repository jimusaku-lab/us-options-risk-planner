import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ExitBrokerOrderType, ExitOrderPlanMode, OptionLeg, TradeSimulation } from "@/types/domain";
import { calculateCloseCostJPY, calculatePremiumJPY, calculatePremiumUSD } from "@/domain/calculations";
import { calculateDenominators, getPrimaryDenominator } from "@/domain/denominators";
import { calculateProfitTakeBuybackPriceUSD, getExitDeadlineInfo, getExitOrderPlanForLeg } from "@/domain/exitOrderPlan";
import { createOptionCloseExecutionDraft } from "@/domain/optionCloseExecutions";
import { NumberInput } from "@/components/ui/NumberInput";
import { formatJPY, formatPct, formatUSD } from "@/lib/format";

export function CloseDecisionCard({
  simulation,
  onChange,
  focusRequest,
  onExecutionDraft,
}: {
  simulation: TradeSimulation;
  onChange: (simulation: TradeSimulation) => void;
  focusRequest?: { anchorId: string; requestId: number } | null;
  onExecutionDraft?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const shortLegs = simulation.optionLegs.filter((leg) => leg.side === "sell");
  const updateLeg = (id: string, patch: Partial<OptionLeg>) => {
    onChange({
      ...simulation,
      optionLegs: simulation.optionLegs.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)),
    });
  };
  const addExecutionDraft = (leg: OptionLeg) => {
    const closePriceUSD = leg.closeCostUSD ?? leg.closePlan?.closePriceUSD;
    if (closePriceUSD === undefined || closePriceUSD <= 0) return;
    onChange({
      ...simulation,
      optionCloseExecutions: [
        ...(simulation.optionCloseExecutions ?? []),
        createOptionCloseExecutionDraft({ simulation, leg, closePriceUSD }),
      ],
    });
    onExecutionDraft?.();
  };
  useEffect(() => {
    if (!focusRequest?.anchorId) return;
    setIsOpen(true);
    window.setTimeout(() => {
      const target = document.getElementById(focusRequest.anchorId);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = target?.querySelector<HTMLInputElement>("input");
      input?.focus();
    }, 60);
  }, [focusRequest?.requestId, focusRequest?.anchorId]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-950">反対売買判断</h2>
        <button
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {isOpen ? "畳む" : "開く"}
        </button>
      </div>
      {isOpen ? (
        <>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Saxoの決済チケットに表示される現在の買戻し価格を入力し、出口ルールに到達しているか確認します。
          </p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {shortLegs.map((leg) => (
              <LegCloseCard
                key={leg.id}
                leg={leg}
                simulation={simulation}
                fxRateJPY={simulation.fxRateJPY}
                openCommissionUSD={(simulation.brokerCommissionUSD ?? 0) / Math.max(1, shortLegs.length)}
                onCloseCostChange={(closeCostUSD) => updateLeg(leg.id, { closeCostUSD })}
                onExecutionDraft={() => addExecutionDraft(leg)}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm leading-6 text-slate-600">
          通常は閉じています。途中決済を検討する時だけ開き、Saxoの決済チケット価格を確認します。
        </p>
      )}
    </section>
  );
}

function LegCloseCard({
  leg,
  simulation,
  fxRateJPY,
  openCommissionUSD,
  onCloseCostChange,
  onExecutionDraft,
}: {
  leg: OptionLeg;
  simulation: TradeSimulation;
  fxRateJPY: number;
  openCommissionUSD: number;
  onCloseCostChange: (closeCostUSD: number) => void;
  onExecutionDraft: () => void;
}) {
  const receivedJPY = calculatePremiumJPY({
    premiumUSD: leg.premiumUSD,
    quantity: leg.quantity,
    fxRateJPY,
  });
  const receivedUSD = calculatePremiumUSD({
    premiumUSD: leg.premiumUSD,
    quantity: leg.quantity,
  });
  const closeCostJPY = calculateCloseCostJPY(leg, fxRateJPY);
  const closePriceUSD = leg.closeCostUSD ?? leg.closePlan?.closePriceUSD;
  const closeCostUSD = closePriceUSD === undefined || closePriceUSD <= 0 ? null : closePriceUSD * 100 * leg.quantity;
  const closeCommissionUSD = leg.closePlan?.commissionUSD ?? openCommissionUSD;
  const totalCommissionUSD = openCommissionUSD + (closeCostUSD === null ? 0 : closeCommissionUSD);
  const totalCommissionJPY = (openCommissionUSD + (closeCostJPY === null ? 0 : closeCommissionUSD)) * fxRateJPY;
  const estimatedProfitJPY = closeCostJPY === null ? null : receivedJPY - closeCostJPY - totalCommissionJPY;
  const estimatedProfitUSD = closeCostUSD === null ? null : receivedUSD - closeCostUSD - totalCommissionUSD;
  const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
  const primaryDenominator = getPrimaryDenominator(calculateDenominators(simulation, 0));
  const elapsedDays = calculateElapsedDaysSinceEntry(simulation.entryDate);
  const closeAnnualReturnPct =
    (isN ? estimatedProfitUSD : estimatedProfitJPY) === null
      ? null
      : calculateCloseAnnualReturnPercent({
          profit: isN ? estimatedProfitUSD ?? 0 : estimatedProfitJPY ?? 0,
          denominator: isN ? primaryDenominator.amountUSD ?? 0 : primaryDenominator.amountJPY,
          elapsedDays,
        });
  const exitOrderPlan = getExitOrderPlanForLeg(simulation, leg);
  const callRequiredShares = simulation.optionLegs
    .filter((item) => item.type === "call" && item.side === "sell")
    .reduce((sum, item) => sum + item.quantity * 100, 0);
  const hasUncoveredCall = callRequiredShares > (simulation.stockPosition?.shares ?? 0);
  const nakedCall =
    leg.type === "call" &&
    (leg.callExitIntent === "naked_buyback" ||
      (hasUncoveredCall && leg.callExitIntent !== "covered_keep_stock" && simulation.stockPosition?.canSellAtStrike !== false));
  const callCanSell = leg.type === "call" && !nakedCall && simulation.stockPosition?.canSellAtStrike !== false;
  const callKeepStock = leg.type === "call" && !nakedCall && simulation.stockPosition?.canSellAtStrike === false;
  const exitDeadline = getExitDeadlineInfo(simulation, exitOrderPlan);
  const stopLossAmount = isN ? exitOrderPlan.stopLossAmountUSD ?? 0 : exitOrderPlan.stopLossAmountJPY ?? 0;
  const keepPercent =
    (isN ? estimatedProfitUSD : estimatedProfitJPY) === null || (isN ? receivedUSD : receivedJPY) === 0
      ? null
      : Math.max(0, (((isN ? estimatedProfitUSD : estimatedProfitJPY) ?? 0) / (isN ? receivedUSD : receivedJPY)) * 100);
  const profitTarget = exitOrderPlan.profitTakePremiumKeepPercent ?? simulation.profitTakeRule?.targetPremiumKeepPercent ?? 60;
  const profitBuybackTarget =
    exitOrderPlan.profitTakeBuybackPriceUSD && exitOrderPlan.profitTakeBuybackPriceUSD > 0
      ? exitOrderPlan.profitTakeBuybackPriceUSD
      : calculateProfitTakeBuybackPriceUSD(leg.premiumUSD, profitTarget);
  const profitRuleStatus =
    !exitOrderPlan.profitTakeEnabled
      ? { label: "利確ルールは未使用", tone: undefined as Tone, detail: "必要な場合は建玉入力のルール設定でONにします。" }
      : closePriceUSD === undefined || closePriceUSD <= 0
        ? { label: "買戻し価格を入れると判定", tone: undefined as Tone, detail: `決済指値目安: ${formatUSD(profitBuybackTarget)}以下（${profitTarget}%確保）` }
        : closePriceUSD <= profitBuybackTarget
          ? { label: "利確ライン到達", tone: "green" as Tone, detail: `現在 ${formatUSD(closePriceUSD)} / 目安 ${formatUSD(profitBuybackTarget)}以下` }
          : { label: "利確ライン未到達", tone: undefined as Tone, detail: `現在 ${formatUSD(closePriceUSD)} / 目安 ${formatUSD(profitBuybackTarget)}以下` };
  const stopRuleStatus = getStopRuleStatus({ simulation, leg, estimatedProfitJPY, estimatedProfitUSD, exitOrderPlan });
  const label = `${leg.type === "call" ? "C" : "P"} ${leg.strikeUSD} ${leg.expiryDate}`;

  if (callCanSell) {
    return (
      <div id={`close-decision-call-${leg.id}`} className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="font-bold text-slate-950">{label}</div>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          株を渡してよい方針のため、通常はC買戻し判断は不要です。株を残したくなった場合だけ、現在の買戻し価格を入力して買戻しコストを確認してください。
        </p>
        <div className="mt-3">
          <NumberInput
            label="任意: C買戻し価格"
            value={leg.closeCostUSD ?? Number.NaN}
            suffix="USD/株"
            placeholder="必要な時だけ入力"
            min={0}
            onChange={onCloseCostChange}
          />
        </div>
        {(leg.closeCostUSD ?? leg.closePlan?.closePriceUSD ?? 0) > 0 ? (
          <button
            className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            onClick={onExecutionDraft}
          >
            この価格で決済実績に反映
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div id={`close-decision-${leg.type}-${leg.id}`} className="rounded-md border border-slate-200 p-3">
      <div className="font-bold text-slate-950">{label}</div>
      <div className="mt-3">
        <NumberInput
          label="現在の買戻し価格"
          value={leg.closeCostUSD ?? Number.NaN}
          suffix="USD/株"
          placeholder="Saxo決済チケットの価格"
          min={0}
          onChange={onCloseCostChange}
        />
      </div>
      {(leg.closeCostUSD ?? leg.closePlan?.closePriceUSD ?? 0) > 0 ? (
        <button
          className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          onClick={onExecutionDraft}
        >
          この価格で決済実績に反映
        </button>
      ) : null}
      <dl className="mt-3 grid gap-2 text-sm">
        <Row
          label="建てた時のプレミアム"
          value={isN ? `${formatUSD(receivedUSD)} / 参考 ${formatJPY(receivedJPY)}` : formatJPY(receivedJPY)}
        />
        <Row
          label="現在の買戻し価格"
          value={
            closeCostJPY === null || closeCostUSD === null
              ? "未入力"
              : isN
                ? `${formatUSD(closeCostUSD)} / 参考 ${formatJPY(closeCostJPY)}`
                : formatJPY(closeCostJPY)
          }
        />
        <Row
          label="手数料控除"
          value={
            isN
              ? `${formatUSD(totalCommissionUSD)} / 参考 ${formatJPY(totalCommissionJPY)}`
              : formatJPY(totalCommissionJPY)
          }
        />
        <Row
          label="建てた時の手数料"
          value={isN ? `${formatUSD(openCommissionUSD)} / 参考 ${formatJPY(openCommissionUSD * fxRateJPY)}` : formatJPY(openCommissionUSD * fxRateJPY)}
        />
        <Row
          label="買戻し時の想定手数料"
          value={isN ? `${formatUSD(closeCommissionUSD)} / 参考 ${formatJPY(closeCommissionUSD * fxRateJPY)}` : formatJPY(closeCommissionUSD * fxRateJPY)}
        />
        <Row
          label={callKeepStock ? "株を残すための買戻しコスト（手数料後）" : "今閉じた場合の概算損益（手数料後）"}
          value={
            callKeepStock
              ? closeCostUSD === null || closeCostJPY === null
                ? "未計算"
                : isN
                  ? `${formatUSD(closeCostUSD + closeCommissionUSD)} / 参考 ${formatJPY(closeCostJPY + closeCommissionUSD * fxRateJPY)}`
                  : formatJPY(closeCostJPY + closeCommissionUSD * fxRateJPY)
              : (isN ? estimatedProfitUSD : estimatedProfitJPY) === null
              ? "未計算"
              : isN
                ? `${formatUSD(estimatedProfitUSD ?? 0)} / 参考 ${formatJPY(estimatedProfitJPY ?? 0, { signed: true })}`
                : formatJPY(estimatedProfitJPY ?? 0, { signed: true })
          }
          tone={(isN ? estimatedProfitUSD : estimatedProfitJPY) === null ? undefined : ((isN ? estimatedProfitUSD : estimatedProfitJPY) ?? 0) >= 0 ? "green" : "red"}
        />
        {callKeepStock ? null : (
          <Row
            label="今閉じた場合の年率"
            value={
              closeAnnualReturnPct === null
                ? "未計算"
                : `${formatPct(closeAnnualReturnPct)}（${elapsedDays}日換算 / 分母 ${
                    isN
                      ? `${formatUSD(primaryDenominator.amountUSD ?? 0)}`
                      : formatJPY(primaryDenominator.amountJPY)
                  }）`
            }
            tone={closeAnnualReturnPct === null ? undefined : closeAnnualReturnPct >= 0 ? "green" : "red"}
          />
        )}
        {callKeepStock ? null : (
          <Row
            label="プレミアム確保率"
            value={keepPercent === null ? "未計算" : `${keepPercent.toFixed(1)}%`}
            tone={keepPercent === null ? undefined : keepPercent >= 50 ? "green" : undefined}
          />
        )}
        {nakedCall ? (
          <>
            <RuleRow
              label="上抜けライン判定"
              status={
                !leg.hedgeBuyStopUSD
                  ? "逆指値ライン未入力"
                  : simulation.currentPriceUSD >= leg.hedgeBuyStopUSD
                    ? "上抜けライン到達"
                    : "上抜けライン未到達"
              }
              detail={
                !leg.hedgeBuyStopUSD
                  ? "出口ルールで逆指値ラインを入力します。"
                  : `現在株価 ${formatUSD(simulation.currentPriceUSD)} / 目安 ${formatUSD(leg.hedgeBuyStopUSD)}`
              }
              tone={!leg.hedgeBuyStopUSD ? "amber" : simulation.currentPriceUSD >= leg.hedgeBuyStopUSD ? "red" : undefined}
            />
            <RuleRow
              label="買戻し価格ライン判定"
              status={
                !exitOrderPlan.stopLossBuybackPriceUSD
                  ? "買戻し価格ライン未入力"
                  : closePriceUSD === undefined || closePriceUSD <= 0
                    ? "C買戻し価格を入れると判定"
                    : closePriceUSD >= exitOrderPlan.stopLossBuybackPriceUSD
                      ? "買戻し価格ライン到達"
                      : "買戻し価格ライン未到達"
              }
              detail={
                !exitOrderPlan.stopLossBuybackPriceUSD
                  ? "出口ルールで買戻し価格ラインを入力します。"
                  : `現在 ${closePriceUSD && closePriceUSD > 0 ? formatUSD(closePriceUSD) : "未入力"} / 目安 ${formatUSD(exitOrderPlan.stopLossBuybackPriceUSD)}以上`
              }
              tone={!exitOrderPlan.stopLossBuybackPriceUSD ? "amber" : closePriceUSD !== undefined && closePriceUSD >= exitOrderPlan.stopLossBuybackPriceUSD ? "red" : undefined}
            />
            <RuleRow
              label="許容損失額判定"
              status={
                !stopLossAmount
                  ? "許容損失額未入力"
                  : (isN ? estimatedProfitUSD : estimatedProfitJPY) === null
                    ? "C買戻し価格を入れると判定"
                    : ((isN ? estimatedProfitUSD : estimatedProfitJPY) ?? 0) <= -stopLossAmount
                      ? "許容損失額に到達"
                      : "許容損失額未到達"
              }
              detail={
                !stopLossAmount
                  ? "出口ルールで許容損失額を入力します。"
                  : `現在 ${isN ? formatUSD(estimatedProfitUSD ?? 0) : formatJPY(estimatedProfitJPY ?? 0, { signed: true })} / 目安 -${isN ? `${formatUSD(stopLossAmount)} / 参考 ${formatJPY(stopLossAmount * fxRateJPY)}` : formatJPY(stopLossAmount)}`
              }
              tone={!stopLossAmount ? "amber" : (isN ? estimatedProfitUSD : estimatedProfitJPY) !== null && ((isN ? estimatedProfitUSD : estimatedProfitJPY) ?? 0) <= -stopLossAmount ? "red" : undefined}
            />
            <RuleRow
              label="ギャップ・流動性リスク"
              status={leg.nakedCallRiskAcknowledged ? "確認済み" : "未確認"}
              detail="逆指値を置いても、急騰時や時間外の値飛びでは想定より不利な価格で約定する可能性があります。"
              tone={leg.nakedCallRiskAcknowledged ? "amber" : "red"}
            />
            <RuleRow
              label="満期前タイムリミット"
              status={
                exitDeadline.remainingDays === null
                  ? "未設定"
                  : exitDeadline.isPast
                    ? "期限到達"
                    : `残り${exitDeadline.remainingDays}日`
              }
              detail={
                exitDeadline.deadlineDate
                  ? `満期${exitOrderPlan.latestCloseDaysBeforeExpiry}日前の決済判断日: ${exitDeadline.deadlineDate}`
                  : "出口ルールで、満期何日前までに判断するかを設定します。"
              }
              tone={exitDeadline.isPast ? "red" : exitDeadline.remainingDays !== null && exitDeadline.remainingDays <= 3 ? "amber" : undefined}
            />
          </>
        ) : callKeepStock ? (
          <RuleRow
            label="C買戻し判断"
            status="株を残すためのコスト確認"
            detail="このC売りでは、利確・損切りではなく、株を残すためにいくら払って買い戻すかを確認します。P売り用の出口ルールは使いません。"
            tone="amber"
          />
        ) : (
          <>
            <RuleRow label="利確ルール判定" status={profitRuleStatus.label} detail={profitRuleStatus.detail} tone={profitRuleStatus.tone} />
            <RuleRow label="損切りルール判定" status={stopRuleStatus.label} detail={stopRuleStatus.detail} tone={stopRuleStatus.tone} />
            <RuleRow
              label="満期前タイムリミット"
              status={
                exitDeadline.remainingDays === null
                  ? "未設定"
                  : exitDeadline.isPast
                    ? "期限到達"
                    : `残り${exitDeadline.remainingDays}日`
              }
              detail={
                exitDeadline.deadlineDate
                  ? `満期${exitOrderPlan.latestCloseDaysBeforeExpiry}日前の決済判断日: ${exitDeadline.deadlineDate}`
                  : "建玉入力の出口ルールで、満期何日前までに判断するかを設定します。"
              }
              tone={exitDeadline.isPast ? "red" : exitDeadline.remainingDays !== null && exitDeadline.remainingDays <= 3 ? "amber" : undefined}
            />
            <RuleRow
              label="Saxo決済注文目安"
              status={getExitModeLabel(exitOrderPlan.mode)}
              detail={getOrderPlanGuideline({ plan: exitOrderPlan, profitBuybackTarget })}
              tone={exitOrderPlan.mode === "manual_only" ? "amber" : undefined}
            />
          </>
        )}
      </dl>
    </div>
  );
}

type Tone = "green" | "red" | "amber" | undefined;

function calculateElapsedDaysSinceEntry(entryDate: string, now = new Date()): number {
  const entry = new Date(`${entryDate}T00:00:00`);
  if (Number.isNaN(entry.getTime())) return 1;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const entryDay = new Date(entry.getFullYear(), entry.getMonth(), entry.getDate());
  return Math.max(1, Math.ceil((today.getTime() - entryDay.getTime()) / 86_400_000));
}

function calculateCloseAnnualReturnPercent({
  profit,
  denominator,
  elapsedDays,
}: {
  profit: number;
  denominator: number;
  elapsedDays: number;
}): number {
  if (denominator <= 0 || elapsedDays <= 0) return 0;
  return (profit / denominator) * (365 / elapsedDays) * 100;
}

function getStopRuleStatus({
  simulation,
  leg,
  estimatedProfitJPY,
  estimatedProfitUSD,
  exitOrderPlan,
}: {
  simulation: TradeSimulation;
  leg: OptionLeg;
  estimatedProfitJPY: number | null;
  estimatedProfitUSD: number | null;
  exitOrderPlan: ReturnType<typeof getExitOrderPlanForLeg>;
}): { label: string; detail: string; tone: Tone } {
  const rule = simulation.stopLossRule;
  if (!exitOrderPlan.stopLossEnabled && !rule?.enabled) {
    return { label: "損切りルールは未使用", detail: "必要な場合は建玉入力のルール設定でONにします。", tone: undefined };
  }
  const stopType =
    exitOrderPlan.stopLossEnabled
      ? exitOrderPlan.stopLossType ?? "buyback_price"
      : rule?.type === "stock_price_line"
        ? "stock_price_line"
        : rule?.type === "loss_amount_jpy"
          ? "loss_amount"
          : "buyback_price";
  const stopValue =
    stopType === "stock_price_line"
      ? exitOrderPlan.stopLossStockPriceUSD ?? rule?.value ?? 0
      : stopType === "loss_amount"
        ? simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
          ? exitOrderPlan.stopLossAmountUSD ?? 0
          : exitOrderPlan.stopLossAmountJPY ?? rule?.value ?? 0
        : exitOrderPlan.stopLossBuybackPriceUSD ?? rule?.value ?? 0;
  if (stopValue <= 0) {
    return { label: "損切りルール値が未入力", detail: "ルールをONにした場合は基準値を入力します。", tone: "red" };
  }
  if (stopType === "buyback_price") {
    const closePrice = leg.closeCostUSD ?? leg.closePlan?.closePriceUSD;
    if (closePrice === undefined || Number.isNaN(closePrice)) {
      return { label: "買戻し価格を入れると判定", detail: `決済逆指値目安: ${formatUSD(stopValue)}以上`, tone: undefined };
    }
    return closePrice >= stopValue
      ? { label: "損切りライン到達", detail: `現在 ${formatUSD(closePrice)} / 目安 ${formatUSD(stopValue)}以上`, tone: "red" }
      : { label: "損切りライン未到達", detail: `現在 ${formatUSD(closePrice)} / 目安 ${formatUSD(stopValue)}以上`, tone: undefined };
  }
  if (stopType === "stock_price_line") {
    const crossed = leg.type === "put" ? simulation.currentPriceUSD <= stopValue : simulation.currentPriceUSD >= stopValue;
    return crossed
      ? { label: "株価ライン到達", detail: `現在 ${formatUSD(simulation.currentPriceUSD)} / 目安 ${formatUSD(stopValue)}`, tone: "red" }
      : { label: "株価ライン未到達", detail: `現在 ${formatUSD(simulation.currentPriceUSD)} / 目安 ${formatUSD(stopValue)}`, tone: undefined };
  }
  const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
  if ((isN ? estimatedProfitUSD : estimatedProfitJPY) === null) {
    return { label: "買戻し価格を入れると判定", detail: `目安: ${isN ? formatUSD(stopValue) : formatJPY(stopValue)}の損失`, tone: undefined };
  }
  const estimatedProfit = isN ? estimatedProfitUSD ?? 0 : estimatedProfitJPY ?? 0;
  const currentLabel = isN ? formatUSD(estimatedProfit) : formatJPY(estimatedProfit, { signed: true });
  const thresholdLabel = isN ? `-${formatUSD(stopValue)}` : `-${formatJPY(stopValue)}`;
  return estimatedProfit <= -stopValue
    ? { label: "損失額ルール到達", detail: `現在 ${currentLabel} / 目安 ${thresholdLabel}`, tone: "red" }
    : { label: "損失額ルール未到達", detail: `現在 ${currentLabel} / 目安 ${thresholdLabel}`, tone: undefined };
}

function getExitModeLabel(mode: ExitOrderPlanMode): string {
  const labels: Record<ExitOrderPlanMode, string> = {
    manual_only: "使わない（手動判断）",
    after_entry_closing_order: "建玉後に決済注文",
    attached_entry_exit_order: "新規注文と同時にIFD/OCO",
  };
  return labels[mode] ?? "使わない（手動判断）";
}

function getBrokerOrderTypeLabel(brokerOrderType: ExitBrokerOrderType): string {
  const labels: Record<ExitBrokerOrderType, string> = {
    none: "設定しない",
    closing_limit: "決済指値",
    closing_stop: "決済逆指値",
    oco: "OCO",
    ifd: "IFD",
    ifd_oco: "IFD-OCO",
  };
  return labels[brokerOrderType] ?? "設定しない";
}

function getOrderPlanGuideline({ plan, profitBuybackTarget }: { plan: ReturnType<typeof getExitOrderPlanForLeg>; profitBuybackTarget: number }): string {
  const profitLine = plan.profitTakeEnabled ? `利確の決済指値目安 ${formatUSD(profitBuybackTarget)}以下` : "利確指値は未設定";
  const stopLine =
    plan.stopLossEnabled && (plan.stopLossType ?? "buyback_price") === "buyback_price" && (plan.stopLossBuybackPriceUSD ?? 0) > 0
      ? `損切りの決済逆指値目安 ${formatUSD(plan.stopLossBuybackPriceUSD ?? 0)}以上`
      : plan.stopLossEnabled
        ? "損切りは株価ラインまたは損失額で監視"
        : "損切り逆指値は未設定";
  const brokerOrder = plan.brokerOrderType && plan.brokerOrderType !== "none" ? `Saxo注文タイプ: ${getBrokerOrderTypeLabel(plan.brokerOrderType)}` : "Saxoには出口注文を置かない";
  return `${brokerOrder} / ${profitLine} / ${stopLine}`;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  const toneClass = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "text-slate-950";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
      <dt className="text-slate-600">{label}</dt>
      <dd className={`numeric-input text-right font-bold ${toneClass}`}>{value}</dd>
    </div>
  );
}

function RuleRow({ label, status, detail, tone }: { label: string; status: string; detail: string; tone?: Tone }) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "red"
        ? "border-red-200 bg-red-50 text-red-900"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <dt className="text-xs font-semibold">{label}</dt>
      <dd className="mt-1 font-bold">{status}</dd>
      <dd className="mt-1 text-xs leading-5">{detail}</dd>
    </div>
  );
}
