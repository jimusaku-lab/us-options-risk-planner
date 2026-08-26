import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import type { ExitBrokerOrderType, ExitOrderPlanMode, OptionLeg, OptionType, OptionValueSnapshot, OptionValueSnapshotSource, TradeSimulation } from "@/types/domain";
import type { AccountInputs } from "@/store/useOptionsStore";
import { calculateCloseCostJPY, calculatePremiumJPY, calculatePremiumUSD } from "@/domain/calculations";
import { calculateLongOptionExitProceedsPreview, type LongOptionExitProceedsPreview } from "@/domain/dashboardDisplay";
import { calculateDenominators, getPrimaryDenominator } from "@/domain/denominators";
import { createJournalForSimulation } from "@/domain/entryRationaleJournal";
import { calculateProfitTakeBuybackPriceUSD, getExitDeadlineInfo, getExitOrderPlanForLeg } from "@/domain/exitOrderPlan";
import { createOptionCloseExecutionDraft, getOptionLegCloseProgress } from "@/domain/optionCloseExecutions";
import { fetchSaxoOptionPremiumCandidate, isSaxoLocalApiAvailable } from "@/features/saxo/saxoApiClient";
import { findOrderCandidatesForLeg, type SaxoApiOrderSnapshot, type SaxoOptionPremiumCandidate } from "@/features/saxo/saxoAccountSync";
import { EntryRationaleJournalPanel } from "@/components/journal/EntryRationaleJournalPanel";
import { NumberInput } from "@/components/ui/NumberInput";
import { resolveCloseCommissionUSD } from "@/domain/closeCommissionStandard";
import { resolveSaxoOptionLegIdentifiers } from "@/domain/bulkOptionPrice";
import { calculateCurrentPositionEstimate } from "@/domain/currentPositionEstimate";
import { formatCurrentEstimateFxEvidence } from "@/domain/currentEstimateFx";
import type { FxQuote } from "@/lib/marketData";
import { formatJPY, formatPct, formatUSD } from "@/lib/format";

export function CloseDecisionCard({
  simulation,
  saxoOrderCandidates = [],
  onChange,
  focusRequest,
  onExecutionDraft,
  defaultOpen = false,
  accountInputs,
  currentEstimateFxQuote,
}: {
  simulation: TradeSimulation;
  saxoOrderCandidates?: SaxoApiOrderSnapshot[];
  onChange: (simulation: TradeSimulation) => void;
  focusRequest?: { anchorId: string; requestId: number } | null;
  onExecutionDraft?: () => void;
  defaultOpen?: boolean;
  accountInputs?: AccountInputs;
  currentEstimateFxQuote?: FxQuote | null;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const closeProgress = getOptionLegCloseProgress(simulation);
  const progressByLegId = new Map(closeProgress.legs.map((progress) => [progress.legId, progress]));
  const remainingLegs = simulation.optionLegs.flatMap((leg) => { const progress = progressByLegId.get(leg.id); return progress && (progress.state === "open" || progress.state === "partial") && progress.remainingContracts ? [{ ...leg, quantity: progress.remainingContracts }] : []; });
  const closedLegs = simulation.optionLegs.filter((leg) => progressByLegId.get(leg.id)?.state === "closed");
  const shortLegs = remainingLegs.filter((leg) => leg.side === "sell");
  const longLegs = remainingLegs.filter((leg) => leg.side === "buy");
  const closeDecisionLegs = [...shortLegs, ...longLegs];
  const confirmedOpeningCommissionUSD = (leg: OptionLeg) => { const execution=(simulation.optionEntryExecutions??[]).find((item)=>item.legId===leg.id&&item.confirmed&&item.settlementCurrency==="USD"); return execution?.commissionUSD!==undefined&&Number.isFinite(execution.commissionUSD)?execution.commissionUSD:undefined; };
  const entryRationaleJournal = simulation.entryRationaleJournal ?? createJournalForSimulation(simulation);
  const updateLeg = (id: string, patch: Partial<OptionLeg>) => {
    onChange({
      ...simulation,
      optionLegs: simulation.optionLegs.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)),
    });
  };
  const updateLongOptionClosePrice = (leg: OptionLeg, closePriceUSD: number, source: OptionValueSnapshotSource) => {
    const snapshot = buildLongOptionValueSnapshot({
      snapshotDate: todayIsoDate(),
      underlyingPrice: simulation.currentPriceUSD,
      optionExitPrice: closePriceUSD,
      strike: leg.strikeUSD,
      expiry: leg.expiryDate,
      dte: calculateRemainingDaysUntilExpiry(leg.expiryDate),
      optionType: leg.type,
      source,
      capturedAt: new Date().toISOString(),
    });
    updateLeg(leg.id, {
      closeCostUSD: closePriceUSD,
      closePlan: { enabled: true, ...(leg.closePlan ?? {}), closePriceUSD },
      valueSnapshots: snapshot ? upsertOptionValueSnapshot(leg.valueSnapshots, snapshot) : leg.valueSnapshots,
    });
  };
  const updateCloseFee = (leg: OptionLeg, commissionUSD: number, commissionSource: "manual" | "user_confirmed_standard") => updateLeg(leg.id, { closePlan: { enabled: true, ...(leg.closePlan ?? {}), commissionUSD, commissionSource, commissionConfirmedAt: new Date().toISOString() } });
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
      const target = document.getElementById(focusRequest.anchorId) ?? document.getElementById("close-decision");
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = target?.querySelector<HTMLInputElement>("input");
      input?.focus();
    }, 60);
  }, [focusRequest?.requestId, focusRequest?.anchorId]);

  return (
    <section id="close-decision" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-950">反対売買判断</h2>
        <button
          type="button"
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
            {longLegs.length > 0 && shortLegs.length === 0
              ? "買いオプションは原則として満期前に反対売買で決済します。ITMでも権利行使ではなく、まず売却決済・利確/損切りライン・残存日数を確認します。"
              : "Saxoの決済チケットに表示される現在の買戻し価格を入力し、出口ルールに到達しているか確認します。"}
          </p>
          <CurrentEstimateCompletion simulation={simulation} legs={closeDecisionLegs} currentEstimateFxQuote={currentEstimateFxQuote} onPriceChange={(leg, value) => updateLongOptionClosePrice(leg, value, "manual")} onFeeChange={updateCloseFee} />
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {closedLegs.map((leg) => <ClosedLegSummary key={leg.id} leg={leg} contracts={progressByLegId.get(leg.id)?.confirmedClosedContracts} />)}
            {shortLegs.map((leg) => (
              <LegCloseCard
                key={leg.id}
                leg={leg}
                simulation={simulation}
                fxRateJPY={simulation.fxRateJPY}
                openCommissionUSD={confirmedOpeningCommissionUSD(leg)}
                saxoOrderCandidates={saxoOrderCandidates}
                onCloseCostChange={(closeCostUSD) => updateLeg(leg.id, { closeCostUSD })}
                onExecutionDraft={() => addExecutionDraft(leg)}
              />
            ))}
            {longLegs.map((leg) => (
              <LongOptionCloseCard
                key={leg.id}
                leg={leg}
                simulation={simulation}
                fxRateJPY={simulation.fxRateJPY}
                openCommissionUSD={confirmedOpeningCommissionUSD(leg)}
                saxoOrderCandidates={saxoOrderCandidates}
                onClosePriceChange={(closeCostUSD, source) => updateLongOptionClosePrice(leg, closeCostUSD, source)}
                onClosePlanChange={(closePlanPatch) => updateLeg(leg.id, { closePlan: { enabled: true, ...(leg.closePlan ?? {}), ...closePlanPatch } })}
                onExecutionDraft={() => addExecutionDraft(leg)}
                accountInputs={accountInputs}
              />
            ))}
          </div>
          <details className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer text-sm font-bold text-slate-900">エントリー根拠・決済後レビュー</summary>
            <div className="mt-3">
              <EntryRationaleJournalPanel
                title="エントリー根拠と出口判断の記録"
                subtitle="決済判断時点の見立てと、決済後の振り返りを同じジャーナルに追記します。"
                journal={entryRationaleJournal}
                onChange={(entryRationaleJournal) => onChange({ ...simulation, entryRationaleJournal })}
                reviewMode={["closed", "assigned", "expired"].includes(simulation.status)}
              />
            </div>
          </details>
        </>
      ) : (
        <p className="mt-2 text-sm leading-6 text-slate-600">
          通常は閉じています。途中決済を検討する時だけ開き、Saxoの決済チケット価格を確認します。
        </p>
      )}
    </section>
  );
}

function ClosedLegSummary({ leg, contracts }: { leg: OptionLeg; contracts?: number }) {
  const label = `${leg.type === "call" ? "C" : "P"}${leg.side === "buy" ? "買い" : "売り"} ${leg.strikeUSD} ${leg.expiryDate}`;
  return <div id={`close-decision-${leg.type}-${leg.id}`} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm"><div className="font-bold text-slate-900">{label}</div><p className="mt-1 text-slate-600">決済済み{contracts ? `: ${contracts}枚` : ""}。現在価格の取得・決済下書き・出口ルール操作は行いません。</p></div>;
}

export function buildSaxoOptionPremiumCandidateInput(
  simulation: TradeSimulation,
  leg: OptionLeg,
): Parameters<typeof fetchSaxoOptionPremiumCandidate>[0] {
  const identifiers = resolveSaxoOptionLegIdentifiers(simulation, leg);
  return {
    symbol: simulation.ticker,
    expiry: leg.expiryDate,
    strike: leg.strikeUSD,
    optionType: leg.type,
    accountKey: identifiers.accountKey,
    uic: identifiers.uic,
    assetType: identifiers.uic || identifiers.instrumentCode ? "StockOption" : undefined,
    positionId: identifiers.positionId,
    instrumentCode: identifiers.instrumentCode,
  };
}

function CurrentEstimateCompletion({ simulation, legs, onPriceChange, onFeeChange, currentEstimateFxQuote }: { simulation: TradeSimulation; legs: OptionLeg[]; onPriceChange: (leg: OptionLeg, value: number) => void; onFeeChange: (leg: OptionLeg, value: number, source: "manual" | "user_confirmed_standard") => void; currentEstimateFxQuote?: FxQuote | null; }) {
  const currentEstimate = calculateCurrentPositionEstimate(simulation, new Date(), currentEstimateFxQuote);
  return <section id="current-estimate-completion" className="mt-4 rounded-md border border-teal-200 bg-teal-50/50 p-3"><h3 className="text-sm font-bold text-slate-950">現在決済見込みを完成</h3><p className="mt-1 text-xs leading-5 text-slate-600">現在価格と決済想定手数料を確認して保存すると、この場で見込み表示を再計算します。決済実績・建玉状態・Saxo側には変更を加えません。</p>{currentEstimate.kind === "available" && currentEstimate.currency === "JPY" ? <p className="mt-1 text-xs text-slate-500">{formatCurrentEstimateFxEvidence(currentEstimate.fx)}</p> : null}<div className="mt-3 grid gap-3 lg:grid-cols-2">{legs.map((leg) => { const fee=resolveCloseCommissionUSD(simulation,leg); const source=fee.kind==="resolved"?(fee.source==="saxo_ticket_confirmed_standard"?`Saxo決済チケット確認済み標準 / ${leg.quantity}契約 / ${fee.confirmedAt}確認`:fee.source):"未確認"; return <div key={leg.id} className="rounded border border-teal-100 bg-white p-3"><div className="text-sm font-bold text-slate-900">{leg.type === "call" ? "C" : "P"} {leg.strikeUSD} {leg.side === "buy" ? "売却" : "買戻し"}</div><div id={`current-estimate-price-${leg.id}`} className="mt-2"><NumberInput label="現在価格" value={leg.closeCostUSD ?? leg.closePlan?.closePriceUSD ?? Number.NaN} suffix="USD/株" placeholder="明示的な決済候補価格" min={0} onChange={(value) => onPriceChange(leg, value)} /></div><div id={`current-estimate-fee-${leg.id}`} className="mt-2"><div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">{fee.kind==="resolved"?`${formatUSD(fee.amountUSD)} USD`:"未確認"}</div></div><p className="mt-1 text-[11px] text-slate-500">手数料出所: {source}。Saxo決済チケットの取引手数料（数量合計）。スプレッドコストは含めません。</p><details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-teal-800">個別に変更</summary><div className="mt-2"><NumberInput label="個別の決済想定手数料" value={leg.closePlan?.commissionUSD??Number.NaN} suffix="USD" placeholder="明示0も入力可能" min={0} onChange={(value)=>onFeeChange(leg,value,"manual")} /></div></details></div>; })}</div></section>;
}

function LegCloseCard({
  leg,
  simulation,
  fxRateJPY,
  openCommissionUSD,
  saxoOrderCandidates,
  onCloseCostChange,
  onExecutionDraft,
}: {
  leg: OptionLeg;
  simulation: TradeSimulation;
  fxRateJPY: number;
  openCommissionUSD?: number;
  saxoOrderCandidates: SaxoApiOrderSnapshot[];
  onCloseCostChange: (closeCostUSD: number) => void;
  onExecutionDraft: () => void;
}) {
  const [apiCandidate, setApiCandidate] = useState<SaxoOptionPremiumCandidate | null>(null);
  const [apiCandidateMessage, setApiCandidateMessage] = useState("");
  const [isLoadingApiCandidate, setIsLoadingApiCandidate] = useState(false);
  const openingFeeKnown = openCommissionUSD !== undefined;
  const openingFeeUSD = openCommissionUSD ?? 0;
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
  const resolvedCloseCommission=resolveCloseCommissionUSD(simulation,leg);
  const closeCommissionUSD=resolvedCloseCommission.kind==="resolved"?resolvedCloseCommission.amountUSD:undefined;
  const totalCommissionUSD = !openingFeeKnown || closeCostUSD === null || closeCommissionUSD === undefined ? null : openingFeeUSD + closeCommissionUSD;
  const totalCommissionJPY = !openingFeeKnown || closeCostJPY === null || closeCommissionUSD === undefined ? null : (openingFeeUSD + closeCommissionUSD) * fxRateJPY;
  const estimatedProfitJPY = closeCostJPY === null || totalCommissionJPY === null ? null : receivedJPY - closeCostJPY - totalCommissionJPY;
  const estimatedProfitUSD = closeCostUSD === null || totalCommissionUSD === null ? null : receivedUSD - closeCostUSD - totalCommissionUSD;
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
  const orderCandidates = findOrderCandidatesForLeg(simulation, leg, saxoOrderCandidates).filter((order) => order.isExitCandidate);
  const candidatePriceUSD = getPremiumCandidatePrice(apiCandidate, leg.side);
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

  async function loadApiCandidate() {
    setIsLoadingApiCandidate(true);
    setApiCandidateMessage("");
    try {
      const candidate = await fetchSaxoOptionPremiumCandidate(buildSaxoOptionPremiumCandidateInput(simulation, leg));
      setApiCandidate(candidate);
      setApiCandidateMessage(candidate.message);
    } catch (error) {
      setApiCandidate(null);
      setApiCandidateMessage(
        error instanceof Error
          ? `${error.message} 既存の買戻し価格は変更していません。`
          : "API候補価格を取得できませんでした。既存の買戻し価格は変更していません。",
      );
    } finally {
      setIsLoadingApiCandidate(false);
    }
  }

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
        <ApiPremiumCandidatePanel
          candidate={apiCandidate}
          candidatePriceUSD={candidatePriceUSD}
          message={apiCandidateMessage}
          isLoading={isLoadingApiCandidate}
          onLoad={loadApiCandidate}
          onAdopt={onCloseCostChange}
        />
        <SaxoExitOrderStatus candidates={orderCandidates} totalFetched={saxoOrderCandidates.length} />
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
      <OptionPriceComparison entryPriceUSD={leg.premiumUSD} currentPriceUSD={closePriceUSD} positionSide="short" />
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
      <ApiPremiumCandidatePanel
        candidate={apiCandidate}
        candidatePriceUSD={candidatePriceUSD}
        message={apiCandidateMessage}
        isLoading={isLoadingApiCandidate}
        onLoad={loadApiCandidate}
        onAdopt={onCloseCostChange}
      />
      <SaxoExitOrderStatus candidates={orderCandidates} totalFetched={saxoOrderCandidates.length} />
      {(leg.closeCostUSD ?? leg.closePlan?.closePriceUSD ?? 0) > 0 ? (
        <button
          className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          onClick={onExecutionDraft}
        >
          この価格で決済実績に反映
        </button>
      ) : null}
      <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
        <summary className="cursor-pointer font-bold text-slate-700">計算内訳</summary>
        <dl className="mt-3 grid gap-2">
          <Row label="建玉時の受取総額" value={isN ? `${formatUSD(receivedUSD)} / 参考 ${formatJPY(receivedJPY)}` : formatJPY(receivedJPY)} />
          <Row label="現在の買戻し総額" value={closeCostJPY === null || closeCostUSD === null ? "未取得" : isN ? `${formatUSD(closeCostUSD)} / 参考 ${formatJPY(closeCostJPY)}` : formatJPY(closeCostJPY)} />
          <Row label="手数料控除" value={totalCommissionUSD === null || totalCommissionJPY === null ? "未計算（決済想定手数料 未確認）" : isN ? `${formatUSD(totalCommissionUSD)} / 参考 ${formatJPY(totalCommissionJPY)}` : formatJPY(totalCommissionJPY)} />
          <Row label="建玉時の手数料" value={!openingFeeKnown ? "未確認" : isN ? `${formatUSD(openingFeeUSD)} / 参考 ${formatJPY(openingFeeUSD * fxRateJPY)}` : formatJPY(openingFeeUSD * fxRateJPY)} />
          <Row label="買戻し時の想定手数料" value={closeCommissionUSD === undefined ? "未確認" : isN ? `${formatUSD(closeCommissionUSD)} / 参考 ${formatJPY(closeCommissionUSD * fxRateJPY)}` : formatJPY(closeCommissionUSD * fxRateJPY)} />
          {callKeepStock ? null : <Row label="プレミアム確保率" value={keepPercent === null ? "未計算" : `${keepPercent.toFixed(1)}%`} tone={keepPercent === null ? undefined : keepPercent >= 50 ? "green" : undefined} />}
        </dl>
      </details>
      <dl className="mt-3 grid gap-2 text-sm">
        <Row
          label={callKeepStock ? "株を残すための買戻しコスト（手数料後）" : "今閉じた場合の概算損益（手数料後）"}
          value={
            callKeepStock
              ? closeCostUSD === null || closeCostJPY === null
                ? "未計算"
                : closeCommissionUSD === undefined ? "未計算（決済想定手数料 未確認）" : isN ? `${formatUSD(closeCostUSD + closeCommissionUSD)} / 参考 ${formatJPY(closeCostJPY + closeCommissionUSD * fxRateJPY)}` : formatJPY(closeCostJPY + closeCommissionUSD * fxRateJPY)
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

export type OptionPriceComparisonResult = {
  entryPriceUSD: number | null;
  currentPriceUSD: number | null;
  differenceUSD: number | null;
  changePct: number | null;
  isFavorable: boolean | null;
};

export function buildOptionPriceComparison(entryPriceUSD: number, currentPriceUSD: number | undefined, positionSide: "long" | "short"): OptionPriceComparisonResult {
  const hasEntry = Number.isFinite(entryPriceUSD) && entryPriceUSD > 0;
  const hasCurrent = currentPriceUSD !== undefined && Number.isFinite(currentPriceUSD) && currentPriceUSD > 0;
  if (!hasEntry || !hasCurrent) return { entryPriceUSD: hasEntry ? entryPriceUSD : null, currentPriceUSD: null, differenceUSD: null, changePct: null, isFavorable: null };
  const differenceUSD = currentPriceUSD - entryPriceUSD;
  return {
    entryPriceUSD,
    currentPriceUSD,
    differenceUSD,
    changePct: (differenceUSD / entryPriceUSD) * 100,
    isFavorable: positionSide === "long" ? differenceUSD >= 0 : differenceUSD <= 0,
  };
}

function OptionPriceComparison({ entryPriceUSD, currentPriceUSD, positionSide }: { entryPriceUSD: number; currentPriceUSD?: number; positionSide: "long" | "short" }) {
  const comparison = buildOptionPriceComparison(entryPriceUSD, currentPriceUSD, positionSide);
  const differenceTone = comparison.isFavorable === null ? "text-slate-500" : comparison.isFavorable ? "text-emerald-700" : "text-red-700";
  return (
    <section aria-label="オプション価格比較" className="mt-3 rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-2 text-xs font-bold text-slate-600">{positionSide === "long" ? "売却価格の比較" : "買戻し価格の比較"}</div>
      <div className="grid grid-cols-3 divide-x divide-slate-200 text-center">
        <div className="px-2"><div className="text-xs text-slate-500">建玉時</div><div className="mt-1 font-bold text-slate-950">{comparison.entryPriceUSD === null ? "未取得" : `${formatUSD(comparison.entryPriceUSD)} / 株`}</div></div>
        <div className="px-2"><div className="text-xs text-slate-500">現在</div><div className="mt-1 font-bold text-slate-950">{comparison.currentPriceUSD === null ? "未取得" : `${formatUSD(comparison.currentPriceUSD)} / 株`}</div></div>
        <div className="px-2"><div className="text-xs text-slate-500">価格差</div><div className={`mt-1 font-bold ${differenceTone}`}>{comparison.differenceUSD === null || comparison.changePct === null ? "未計算" : `${formatSignedOptionPriceUSD(comparison.differenceUSD)} / 株（${comparison.changePct > 0 ? "+" : ""}${formatPct(comparison.changePct)}）`}</div></div>
      </div>
    </section>
  );
}

function formatSignedOptionPriceUSD(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatUSD(Math.abs(value))}`;
}

function ApiPremiumCandidatePanel({
  candidate,
  candidatePriceUSD,
  message,
  isLoading,
  onLoad,
  onAdopt,
}: {
  candidate: SaxoOptionPremiumCandidate | null;
  candidatePriceUSD: number | null;
  message: string;
  isLoading: boolean;
  onLoad: () => void;
  onAdopt: (price: number) => void;
}) {
  const noAccess = isSaxoPriceFeedNoAccess(candidate);
  const manualInputGuidance = getPremiumCandidateManualInputGuidance(candidate);
  if (!isSaxoLocalApiAvailable) {
    return (
      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
        <div className="font-bold text-slate-950">価格確認</div>
        <p className="mt-1">
          公開版では自動価格取得を使いません。証券会社画面のBid/Ask/Lastを確認し、現在オプション価格へ手入力してください。
          入力値はこのカード内の判定にだけ使われ、発注や決済保存は自動実行されません。
        </p>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-bold text-slate-950">API候補価格</div>
        <button
          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 font-bold text-slate-700 disabled:opacity-40"
          onClick={onLoad}
          disabled={isLoading}
        >
          <RefreshCw size={13} />
          候補価格を取得
        </button>
      </div>
      {candidate ? (
        <>
          <dl className="mt-2 grid gap-1 sm:grid-cols-4">
            <MiniRow label="Bid" value={noAccess ? "未取得" : formatOptionalUSD(candidate.bid)} />
            <MiniRow label="Ask" value={noAccess ? "未取得" : formatOptionalUSD(candidate.ask)} />
            <MiniRow label="Last" value={noAccess ? "未取得" : formatOptionalUSD(candidate.last)} />
            <MiniRow label="Mid" value={noAccess ? "未取得" : formatOptionalUSD(candidate.mid)} />
          </dl>
          <div className={`mt-2 rounded border bg-white px-2 py-1 ${noAccess ? "border-indigo-300" : "border-slate-200"}`}>
            <div className={`font-bold ${noAccess ? "text-indigo-900" : "text-slate-800"}`}>
              {noAccess ? "Saxo API価格フィード権限なし" : candidate.classification}
            </div>
            <div className="mt-1 leading-5 text-slate-600">
              {noAccess
                ? "Saxo APIではこのオプションのBid/Ask/Last/Midを取得できません。市場外や取得失敗ではなく、価格フィード権限の問題として扱います。"
                : candidate.message}
            </div>
            {noAccess ? (
              <div className="mt-2 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 font-semibold text-indigo-900">
                {manualInputGuidance}
              </div>
            ) : null}
            <div className="mt-1 text-slate-500">取得元: {candidate.source}</div>
            {candidate.quoteDiagnostics ? (
              <div className="mt-2 grid gap-1 text-slate-600 sm:grid-cols-2">
                <MiniRow label="価格理由" value={candidate.quoteDiagnostics.reasonLabel ?? "未取得"} />
                <MiniRow label="InfoPrice経路" value={candidate.quoteDiagnostics.selectedSource ?? "未取得"} />
                <MiniRow label="Bid種別" value={candidate.quoteDiagnostics.priceTypeBid ?? "未取得"} />
                <MiniRow label="Ask種別" value={candidate.quoteDiagnostics.priceTypeAsk ?? "未取得"} />
                <MiniRow label="ErrorCode" value={candidate.quoteDiagnostics.errorCode ?? "なし"} />
                <MiniRow
                  label="市場状態"
                  value={candidate.quoteDiagnostics.isMarketOpen === undefined ? "未取得" : candidate.quoteDiagnostics.isMarketOpen ? "Open" : "Closed"}
                />
              </div>
            ) : null}
            {candidate.quoteDiagnostics?.attemptedSources?.length ? (
              <div className="mt-1 text-slate-500">試行: {candidate.quoteDiagnostics.attemptedSources.join(" -> ")}</div>
            ) : null}
            {!noAccess && candidate.referencePriceUSD !== undefined ? (
              <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
                参考価格: {formatUSD(candidate.referencePriceUSD)}（{candidate.referencePriceLabel ?? "参考"}）。現在オプション価格へは自動入力しません。
              </div>
            ) : null}
            {!noAccess && candidatePriceUSD === null && manualInputGuidance ? (
              <div className="mt-2 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 font-semibold text-indigo-900">
                {manualInputGuidance}
              </div>
            ) : null}
          </div>
          {candidatePriceUSD !== null ? (
            <button
              className="mt-2 rounded border border-slate-300 bg-white px-2 py-1 font-bold text-slate-700 hover:bg-slate-50"
              onClick={() => onAdopt(candidatePriceUSD)}
            >
              {formatUSD(candidatePriceUSD)}を候補として採用
            </button>
          ) : null}
        </>
      ) : message ? (
        <p className="mt-2 leading-5 text-slate-600">{message}</p>
      ) : (
        <p className="mt-2 leading-5 text-slate-500">
          Options Chain / 現在プレミアムは候補表示だけです。採用しても自動で決済済みにはしません。
        </p>
      )}
    </div>
  );
}

type LongOptionExitOrderLineCandidate = {
  profitTargetPriceUSD?: number;
  stopLossPriceUSD?: number;
};

export function getLongOptionExitOrderLineCandidate(candidates: SaxoApiOrderSnapshot[]): LongOptionExitOrderLineCandidate {
  const profitTargetPriceUSD = candidates.find(
    (candidate) => candidate.price !== undefined && Number.isFinite(candidate.price) && candidate.price > 0,
  )?.price;
  const stopLossPriceUSD = candidates.find(
    (candidate) => candidate.stopPrice !== undefined && Number.isFinite(candidate.stopPrice) && candidate.stopPrice > 0,
  )?.stopPrice;
  return { profitTargetPriceUSD, stopLossPriceUSD };
}

function SaxoExitOrderStatus({
  candidates,
  totalFetched,
  longOptionLines,
  onAdoptLongOptionLines,
}: {
  candidates: SaxoApiOrderSnapshot[];
  totalFetched: number;
  longOptionLines?: LongOptionExitOrderLineCandidate;
  onAdoptLongOptionLines?: () => void;
}) {
  const hasFetched = totalFetched > 0;
  const hasLongOptionLines = Boolean(longOptionLines?.profitTargetPriceUSD || longOptionLines?.stopLossPriceUSD);
  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs">
      <div className="font-bold text-slate-950">Saxo側出口注文</div>
      <p className="mt-1 leading-5 text-slate-600">
        {!hasFetched
          ? "未約定注文は未取得です。Saxo API Read-onlyパネルで取得すると、決済指値・逆指値・OCO/IFD系の候補を照合します。"
          : candidates.length > 0
            ? `Saxo側に設定あり: ${candidates.length}件。アプリ側の利確/損切りルールとは別物として扱います。`
            : "取得済みの未約定注文内に、この脚へ紐づく出口注文候補はありません。"}
      </p>
      {candidates.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-slate-700">
          {candidates.slice(0, 3).map((candidate) => (
            <li key={candidate.id} className="rounded bg-slate-50 px-2 py-1">
              {candidate.orderType ?? "注文種別未取得"} /{" "}
              {candidate.price !== undefined
                ? formatUSD(candidate.price)
                : candidate.stopPrice !== undefined
                  ? `Stop ${formatUSD(candidate.stopPrice)}`
                  : "価格未取得"}{" "}
              / {candidate.status ?? "状態未取得"}
            </li>
          ))}
        </ul>
      ) : null}
      {hasLongOptionLines ? (
        <div className="mt-2 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-indigo-900">
          <div className="font-bold">Saxo側の反対売買ライン候補</div>
          {longOptionLines?.profitTargetPriceUSD ? (
            <div className="mt-1">決済指値: {formatUSD(longOptionLines.profitTargetPriceUSD)}</div>
          ) : null}
          {longOptionLines?.stopLossPriceUSD ? (
            <div className="mt-1">決済逆指値: {formatUSD(longOptionLines.stopLossPriceUSD)}</div>
          ) : null}
          {onAdoptLongOptionLines ? (
            <button
              className="mt-2 rounded border border-indigo-300 bg-white px-2 py-1 font-bold text-indigo-800 hover:bg-indigo-50"
              onClick={onAdoptLongOptionLines}
            >
              アプリの利確/損切りラインへ反映
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function getPremiumCandidatePrice(candidate: SaxoOptionPremiumCandidate | null, side?: OptionLeg["side"]): number | null {
  if (!candidate) return null;
  if (isSaxoPriceFeedNoAccess(candidate)) return null;
  const price = side === "buy" ? candidate.bid : side === "sell" ? candidate.ask : undefined;
  return price !== undefined && Number.isFinite(price) && price > 0 ? price : null;
}

export function isSaxoPriceFeedNoAccess(candidate: SaxoOptionPremiumCandidate | null): boolean {
  if (!candidate) return false;
  const diagnostics = candidate.quoteDiagnostics;
  const text = [
    candidate.classification,
    candidate.message,
    diagnostics?.reasonLabel,
    diagnostics?.errorCode,
    diagnostics?.priceTypeBid,
    diagnostics?.priceTypeAsk,
    ...(diagnostics?.details ?? []),
  ].filter(Boolean).join(" ");
  return /NoAccess|価格フィード権限なし/i.test(text);
}

export function getPremiumCandidateManualInputGuidance(candidate: SaxoOptionPremiumCandidate | null): string | undefined {
  if (isSaxoPriceFeedNoAccess(candidate)) {
    return "SaxoTraderGOのBid、または実際に使う売却指値を「現在オプション価格」に手入力してください。既存の手入力値は自動で上書きしません。";
  }
  return candidate?.manualInputGuidance;
}

function LongOptionCloseCard({
  leg,
  simulation,
  fxRateJPY,
  openCommissionUSD,
  saxoOrderCandidates,
  onClosePriceChange,
  onClosePlanChange,
  onExecutionDraft,
  accountInputs,
}: {
  leg: OptionLeg;
  simulation: TradeSimulation;
  fxRateJPY: number;
  openCommissionUSD?: number;
  saxoOrderCandidates: SaxoApiOrderSnapshot[];
  onClosePriceChange: (closePriceUSD: number, source: OptionValueSnapshotSource) => void;
  onClosePlanChange: (closePlanPatch: Partial<NonNullable<OptionLeg["closePlan"]>>) => void;
  onExecutionDraft: () => void;
  accountInputs?: AccountInputs;
}) {
  const openingFeeKnown = openCommissionUSD !== undefined;
  const openingFeeUSD = openCommissionUSD ?? 0;
  const [apiCandidate, setApiCandidate] = useState<SaxoOptionPremiumCandidate | null>(null);
  const [apiCandidateMessage, setApiCandidateMessage] = useState("");
  const [isLoadingApiCandidate, setIsLoadingApiCandidate] = useState(false);
  const closePriceUSD = leg.closeCostUSD ?? leg.closePlan?.closePriceUSD;
  const paidPremiumUSD = calculatePremiumUSD({ premiumUSD: leg.premiumUSD, quantity: leg.quantity });
  const paidPremiumJPY = calculatePremiumJPY({ premiumUSD: leg.premiumUSD, quantity: leg.quantity, fxRateJPY });
  const currentOptionValueUSD = closePriceUSD !== undefined && closePriceUSD > 0 ? closePriceUSD * 100 * leg.quantity : null;
  const resolvedCloseCommission=resolveCloseCommissionUSD(simulation,leg);
  const closeCommissionUSD=resolvedCloseCommission.kind==="resolved"?resolvedCloseCommission.amountUSD:undefined;
  const effectiveFxRateJPY =
    simulation.referenceFxRateJPY !== undefined && simulation.referenceFxRateJPY > 0
      ? simulation.referenceFxRateJPY
      : fxRateJPY > 0
        ? fxRateJPY
        : undefined;
  const exitProceedsPreview = closeCommissionUSD === undefined ? undefined : calculateLongOptionExitProceedsPreview({
    closePriceUSD,
    quantity: leg.quantity,
    closeCommissionUSD,
    fxRateJPY: effectiveFxRateJPY,
  });
  const accountCashLabel = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "N口座USD現金残高" : "P口座現金残高";
  const estimatedProfitUSD = !openingFeeKnown || currentOptionValueUSD === null || closeCommissionUSD === undefined ? null : currentOptionValueUSD - paidPremiumUSD - openingFeeUSD - closeCommissionUSD;
  const estimatedProfitJPY = estimatedProfitUSD === null ? null : estimatedProfitUSD * (effectiveFxRateJPY ?? 0);
  const profitPct = estimatedProfitUSD === null || paidPremiumUSD <= 0 ? null : (estimatedProfitUSD / paidPremiumUSD) * 100;
  const elapsedDays = calculateElapsedDaysSinceEntry(simulation.entryDate);
  const entryCostUSD = paidPremiumUSD + openingFeeUSD;
  const exitBreakevenPriceUSD = closeCommissionUSD === undefined ? undefined : calculateLongOptionExitBreakevenPriceUSD({
    paidPremiumUSD,
    openCommissionUSD: openingFeeUSD,
    closeCommissionUSD,
    quantity: leg.quantity,
  });
  const exitBreakevenBufferUSD =
    closePriceUSD !== undefined && closePriceUSD > 0 && exitBreakevenPriceUSD !== undefined ? closePriceUSD - exitBreakevenPriceUSD : null;
  const currentCloseAnnualizedReturnPct = calculateLongOptionCloseAnnualizedReturnPercent({
    profit: estimatedProfitUSD,
    entryCost: entryCostUSD,
    elapsedDays,
  });
  const profitTargetPriceUSD = leg.closePlan?.profitTargetPriceUSD ?? roundOptionPrice(leg.premiumUSD * 1.3);
  const stopLossPriceUSD = leg.closePlan?.stopLossPriceUSD ?? roundOptionPrice(leg.premiumUSD * 0.7);
  const hasUnderlyingPrice = Number.isFinite(simulation.currentPriceUSD) && simulation.currentPriceUSD > 0;
  const intrinsicValueUSD =
    closePriceUSD === undefined || closePriceUSD <= 0 || !hasUnderlyingPrice
      ? null
      : leg.type === "call"
        ? Math.max(0, simulation.currentPriceUSD - leg.strikeUSD)
        : Math.max(0, leg.strikeUSD - simulation.currentPriceUSD);
  const timeValueUSD = closePriceUSD === undefined || closePriceUSD <= 0 || intrinsicValueUSD === null
    ? null
    : Math.max(0, closePriceUSD - intrinsicValueUSD);
  const dte = calculateRemainingDaysUntilExpiry(leg.expiryDate);
  const currentSnapshotDate = todayIsoDate();
  const storedCurrentSnapshot = leg.valueSnapshots?.find(
    (snapshot) =>
      snapshot.snapshotDate === currentSnapshotDate &&
      closePriceUSD !== undefined &&
      Math.abs(snapshot.optionExitPrice - closePriceUSD) < 0.0001,
  );
  const currentValueSnapshot = buildLongOptionValueSnapshot({
    snapshotDate: currentSnapshotDate,
    underlyingPrice: simulation.currentPriceUSD,
    optionExitPrice: closePriceUSD ?? 0,
    strike: leg.strikeUSD,
    expiry: leg.expiryDate,
    dte,
    optionType: leg.type,
    source: storedCurrentSnapshot?.source ?? "manual",
    capturedAt: storedCurrentSnapshot?.capturedAt ?? new Date().toISOString(),
  });
  const valueTimeline = buildOptionValueTimeline(leg.valueSnapshots, currentValueSnapshot);
  const valueProgress = calculateOptionValueProgress(valueTimeline);
  const orderCandidates = findOrderCandidatesForLeg(simulation, leg, saxoOrderCandidates).filter((order) => order.isExitCandidate);
  const exitOrderLineCandidate = getLongOptionExitOrderLineCandidate(orderCandidates);
  const candidatePriceUSD = getPremiumCandidatePrice(apiCandidate, leg.side);
  const label = `${leg.type === "call" ? "C" : "P"} ${leg.strikeUSD} ${leg.expiryDate}`;

  async function loadApiCandidate() {
    setIsLoadingApiCandidate(true);
    setApiCandidateMessage("");
    try {
      const candidate = await fetchSaxoOptionPremiumCandidate(buildSaxoOptionPremiumCandidateInput(simulation, leg));
      setApiCandidate(candidate);
      setApiCandidateMessage(candidate.message);
    } catch (error) {
      setApiCandidate(null);
      setApiCandidateMessage(
        error instanceof Error
          ? `${error.message} 既存の現在オプション価格は変更していません。`
          : "API候補価格を取得できませんでした。既存の現在オプション価格は変更していません。",
      );
    } finally {
      setIsLoadingApiCandidate(false);
    }
  }

  return (
    <div id={`close-decision-${leg.type}-${leg.id}`} className="rounded-md border border-indigo-200 bg-indigo-50/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-bold text-slate-950">{label}</div>
          <p className="mt-1 text-xs font-semibold text-indigo-800">主アクション: 反対売買で決済</p>
        </div>
        <span className="rounded-full bg-indigo-100 px-2 py-1 text-xs font-bold text-indigo-800">
          {leg.type === "call" ? "コール買い" : "プット買い"}
        </span>
      </div>
      <OptionPriceComparison entryPriceUSD={leg.premiumUSD} currentPriceUSD={closePriceUSD} positionSide="long" />
      <p className="mt-2 text-sm leading-6 text-slate-700">
        買いオプションは、満期前ならITMでも売却決済を優先して確認します。権利行使は例外処理です。
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <NumberInput
          label="現在オプション価格"
          value={closePriceUSD ?? Number.NaN}
          suffix="USD/株"
          placeholder="Saxo決済チケットの売却価格"
          min={0}
          onChange={(value) => {
            onClosePriceChange(value, "manual");
          }}
        />
        <NumberInput
          label="利確ライン"
          value={profitTargetPriceUSD}
          suffix="USD/株"
          min={0}
          onChange={(profitTargetPriceUSD) => onClosePlanChange({ profitTargetPriceUSD })}
        />
        <NumberInput
          label="損切りライン"
          value={stopLossPriceUSD}
          suffix="USD/株"
          min={0}
          onChange={(stopLossPriceUSD) => onClosePlanChange({ stopLossPriceUSD })}
        />
      </div>
      <ApiPremiumCandidatePanel
        candidate={apiCandidate}
        candidatePriceUSD={candidatePriceUSD}
        message={apiCandidateMessage}
        isLoading={isLoadingApiCandidate}
        onLoad={loadApiCandidate}
        onAdopt={(price) => {
          onClosePriceChange(price, "saxo");
        }}
      />
      <SaxoExitOrderStatus
        candidates={orderCandidates}
        totalFetched={saxoOrderCandidates.length}
        longOptionLines={exitOrderLineCandidate}
        onAdoptLongOptionLines={
          exitOrderLineCandidate.profitTargetPriceUSD || exitOrderLineCandidate.stopLossPriceUSD
            ? () => onClosePlanChange(exitOrderLineCandidate)
            : undefined
        }
      />
      {closePriceUSD !== undefined && closePriceUSD > 0 ? (
        <button
          className="mt-3 rounded-md bg-slate-950 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800"
          onClick={onExecutionDraft}
        >
          反対売買の決済実績を作成
        </button>
      ) : null}
      <dl className="mt-3 grid gap-2 text-sm">
        <Row label="今閉じた場合の概算損益（手数料後）" value={estimatedProfitUSD === null ? "未計算" : `${formatSignedUSD(estimatedProfitUSD)} / 参考 ${formatJPY(estimatedProfitJPY ?? 0, { signed: true })}`} tone={estimatedProfitUSD === null ? undefined : estimatedProfitUSD >= 0 ? "green" : "red"} />
        <Row label="概算損益率" value={profitPct === null ? "未計算" : `${profitPct > 0 ? "+" : ""}${formatPct(profitPct)}`} tone={profitPct === null ? undefined : profitPct >= 0 ? "green" : "red"} />
        <Row label="今閉じた場合の年率" value={currentCloseAnnualizedReturnPct === null ? "未計算" : `${currentCloseAnnualizedReturnPct > 0 ? "+" : ""}${formatPct(currentCloseAnnualizedReturnPct)}（保有${elapsedDays}日）`} tone={currentCloseAnnualizedReturnPct === null ? undefined : currentCloseAnnualizedReturnPct >= 0 ? "green" : "red"} />
      </dl>
      <details className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-sm">
        <summary className="cursor-pointer font-bold text-slate-800">判断の詳細・計算内訳</summary>
        <LongOptionTimeValueDecayView
        currentSnapshot={currentValueSnapshot}
        timeline={valueTimeline}
        progress={valueProgress}
        exitBreakevenPriceUSD={exitBreakevenPriceUSD}
        exitBreakevenBufferUSD={exitBreakevenBufferUSD}
        profitTargetPriceUSD={profitTargetPriceUSD}
        stopLossPriceUSD={stopLossPriceUSD}
        dte={dte}
        theoreticalThetaUSD={leg.theta}
        exitProceedsValue={formatLongOptionExitProceedsValue(simulation, exitProceedsPreview)}
        accountCashLabel={accountCashLabel}
        accountCashValue={formatLongOptionAccountCashPreview(simulation, accountInputs, exitProceedsPreview)}
        />
        <dl className="mt-3 grid gap-2 text-sm">
        <Row label="支払プレミアム" value={`${formatUSD(paidPremiumUSD)} / 参考 ${formatJPY(paidPremiumJPY)}`} />
        <Row
          label="反対売買損益分岐価格"
          value={exitBreakevenPriceUSD === undefined ? "未計算（決済想定手数料 未確認）" : `${formatUSD(exitBreakevenPriceUSD)} / 株`}
          tone="green"
        />
        <Row
          label="現在オプション価格"
          value={closePriceUSD === undefined || closePriceUSD <= 0 ? "未入力" : `${formatUSD(closePriceUSD)} / 株`}
        />
        <Row
          label="損益分岐までの余裕"
          value={exitBreakevenBufferUSD === null ? "未計算" : `${formatSignedUSD(exitBreakevenBufferUSD)} / 株`}
          tone={exitBreakevenBufferUSD === null ? undefined : exitBreakevenBufferUSD >= 0 ? "green" : "red"}
        />
        <Row
          label="現在評価額"
          value={
            currentOptionValueUSD === null
              ? "未計算"
              : `${formatUSD(currentOptionValueUSD)} / ${
                  effectiveFxRateJPY ? `参考 ${formatJPY(currentOptionValueUSD * effectiveFxRateJPY)}` : "参考JPY未計算"
                }`
          }
        />
        <Row
          label="反対売買時の参考受取額"
          value={formatLongOptionExitProceedsValue(simulation, exitProceedsPreview)}
          tone={exitProceedsPreview ? "green" : undefined}
        />
        <Row
          label="受取額内訳"
          value={formatLongOptionExitProceedsBreakdown(exitProceedsPreview)}
        />
        <Row
          label={accountCashLabel}
          value={formatLongOptionAccountCashPreview(simulation, accountInputs, exitProceedsPreview)}
        />
        <Row
          label="利確/損切りライン"
          value={`${formatUSD(profitTargetPriceUSD)} / ${formatUSD(stopLossPriceUSD)}${
            exitOrderLineCandidate.profitTargetPriceUSD || exitOrderLineCandidate.stopLossPriceUSD
              ? "（Saxo候補あり）"
              : "（初期候補 +30% / -30%）"
          }`}
        />
        <Row label="残存日数" value={`${dte}日`} tone={dte <= 7 ? "amber" : undefined} />
        <Row label="本質的価値" value={intrinsicValueUSD === null ? "未計算" : `${formatUSD(intrinsicValueUSD)} / 株`} />
        <Row label="時間的価値" value={timeValueUSD === null ? "未計算" : `${formatUSD(timeValueUSD)} / 株`} tone={timeValueUSD !== null && timeValueUSD <= 0.05 ? "amber" : undefined} />
        </dl>
      </details>
      <details className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-sm">
        <summary className="cursor-pointer font-bold text-slate-800">例外的な権利行使として確認</summary>
        <p className="mt-2 leading-6 text-slate-600">
          権利行使は通常ルートではありません。現物株を長期保有したい場合だけ、100株分の資金と失う時間的価値を確認してから例外処理として扱います。反対売買で終えた場合、株式取得カードや株式譲渡カードは使いません。
        </p>
      </details>
    </div>
  );
}

export type OptionValueProgress = {
  previous: OptionValueSnapshot;
  current: OptionValueSnapshot;
  elapsedDays: number;
  intrinsicGain: number;
  timeValueChange: number;
  timeValueDecay: number;
  netOptionMove: number;
  decayPerDay: number;
  intrinsicGainPerDay: number;
  timeValueDirection: "increase" | "decrease" | "unchanged";
  sourcesMixed: boolean;
};

export function buildLongOptionValueSnapshot({
  snapshotDate,
  underlyingPrice,
  optionExitPrice,
  strike,
  expiry,
  dte,
  optionType,
  source,
  capturedAt,
}: {
  snapshotDate: string;
  underlyingPrice: number;
  optionExitPrice: number;
  strike: number;
  expiry: string;
  dte: number;
  optionType: OptionType;
  source: OptionValueSnapshotSource;
  capturedAt?: string;
}): OptionValueSnapshot | null {
  if (!Number.isFinite(underlyingPrice) || underlyingPrice <= 0) return null;
  if (!Number.isFinite(optionExitPrice) || optionExitPrice <= 0) return null;
  if (!Number.isFinite(strike) || strike <= 0) return null;
  const intrinsicValue =
    optionType === "call" ? Math.max(0, underlyingPrice - strike) : Math.max(0, strike - underlyingPrice);
  const timeValue = Math.max(0, optionExitPrice - intrinsicValue);
  return {
    snapshotDate,
    capturedAt,
    underlyingPrice,
    optionExitPrice,
    strike,
    expiry,
    dte,
    intrinsicValue,
    timeValue,
    timeValueRatio: optionExitPrice > 0 ? timeValue / optionExitPrice : 0,
    source,
  };
}

export function upsertOptionValueSnapshot(
  snapshots: OptionValueSnapshot[] | undefined,
  nextSnapshot: OptionValueSnapshot,
): OptionValueSnapshot[] {
  const byDate = new Map<string, OptionValueSnapshot>();
  for (const snapshot of snapshots ?? []) {
    if (snapshot.snapshotDate) byDate.set(snapshot.snapshotDate, snapshot);
  }
  byDate.set(nextSnapshot.snapshotDate, nextSnapshot);
  return [...byDate.values()]
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))
    .slice(-20);
}

export function buildOptionValueTimeline(
  snapshots: OptionValueSnapshot[] | undefined,
  currentSnapshot: OptionValueSnapshot | null,
): OptionValueSnapshot[] {
  const timeline = currentSnapshot ? upsertOptionValueSnapshot(snapshots, currentSnapshot) : [...(snapshots ?? [])];
  return timeline
    .filter((snapshot) => Number.isFinite(snapshot.optionExitPrice) && snapshot.optionExitPrice > 0)
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
}

export function calculateOptionValueProgress(timeline: OptionValueSnapshot[]): OptionValueProgress | null {
  if (timeline.length < 2) return null;
  const previous = timeline[timeline.length - 2];
  const current = timeline[timeline.length - 1];
  if (!isComparableOptionValueSnapshot(previous) || !isComparableOptionValueSnapshot(current)) return null;
  const elapsedDays = daysBetweenOptionValueSnapshots(previous, current);
  if (elapsedDays === null) return null;
  const intrinsicGain = current.intrinsicValue - previous.intrinsicValue;
  const timeValueChange = current.timeValue - previous.timeValue;
  const timeValueDecay = Math.max(0, previous.timeValue - current.timeValue);
  const netOptionMove = current.optionExitPrice - previous.optionExitPrice;
  const timeValueDirection = getTimeValueDirection(timeValueChange);
  return {
    previous,
    current,
    elapsedDays,
    intrinsicGain,
    timeValueChange,
    timeValueDecay,
    netOptionMove,
    decayPerDay: timeValueDecay / elapsedDays,
    intrinsicGainPerDay: intrinsicGain / elapsedDays,
    timeValueDirection,
    sourcesMixed: previous.source !== current.source,
  };
}

export function getOptionValueProgressMessage(progress: OptionValueProgress | null): string {
  if (!progress) return "比較データ不足";
  if (progress.timeValueDirection === "increase") return "前回観測比で時間価値は増加しています。";
  if (progress.timeValueDirection === "decrease") {
    return "時間価値は減少しています。利確ライン、損切りライン、残存日数を確認してください。";
  }
  return "前回観測比で時間価値に大きな変化はありません。";
}

function getTimeValueDirection(change: number): OptionValueProgress["timeValueDirection"] {
  if (change > 0.005) return "increase";
  if (change < -0.005) return "decrease";
  return "unchanged";
}

function isComparableOptionValueSnapshot(snapshot: OptionValueSnapshot): boolean {
  return (
    ["manual", "saxo", "moomoo"].includes(snapshot.source) &&
    Number.isFinite(snapshot.underlyingPrice) &&
    Number.isFinite(snapshot.optionExitPrice) &&
    Number.isFinite(snapshot.intrinsicValue) &&
    Number.isFinite(snapshot.timeValue) &&
    Boolean(getOptionValueSnapshotTimestamp(snapshot))
  );
}

function daysBetweenOptionValueSnapshots(previous: OptionValueSnapshot, current: OptionValueSnapshot): number | null {
  const previousTimestamp = getOptionValueSnapshotTimestamp(previous);
  const currentTimestamp = getOptionValueSnapshotTimestamp(current);
  if (!previousTimestamp || !currentTimestamp) return null;
  const previousTime = new Date(previousTimestamp).getTime();
  const currentTime = new Date(currentTimestamp).getTime();
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime) || currentTime <= previousTime) return null;
  return Math.max(1, Math.ceil((currentTime - previousTime) / 86_400_000));
}

function getOptionValueSnapshotTimestamp(snapshot: OptionValueSnapshot): string | null {
  const value = snapshot.capturedAt || snapshot.snapshotDate;
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

function LongOptionTimeValueDecayView({
  currentSnapshot,
  timeline,
  progress,
  exitBreakevenPriceUSD,
  exitBreakevenBufferUSD,
  profitTargetPriceUSD,
  stopLossPriceUSD,
  dte,
  theoreticalThetaUSD,
  exitProceedsValue,
  accountCashLabel,
  accountCashValue,
}: {
  currentSnapshot: OptionValueSnapshot | null;
  timeline: OptionValueSnapshot[];
  progress: OptionValueProgress | null;
  exitBreakevenPriceUSD?: number;
  exitBreakevenBufferUSD: number | null;
  profitTargetPriceUSD: number;
  stopLossPriceUSD: number;
  dte: number;
  theoreticalThetaUSD?: number;
  exitProceedsValue: string;
  accountCashLabel: string;
  accountCashValue: string;
}) {
  if (!currentSnapshot) {
    return (
      <section className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-sm">
        <div className="font-bold text-slate-950">時間価値減衰ビュー</div>
        <p className="mt-2 leading-6 text-slate-600">
          現在株価と現在オプション価格を入れると、本質的価値・時間的価値・時間的価値比率を表示します。
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <MiniMetric label="反対売買時の参考受取額" value={exitProceedsValue} />
          <MiniMetric label={accountCashLabel} value={accountCashValue} />
        </div>
      </section>
    );
  }

  const intrinsicPct = Math.min(100, Math.max(0, (currentSnapshot.intrinsicValue / currentSnapshot.optionExitPrice) * 100));
  const timePct = Math.max(0, 100 - intrinsicPct);
  const latestTimeline = timeline.slice(-6);
  const maxTimelineValue = Math.max(...latestTimeline.map((snapshot) => snapshot.optionExitPrice), currentSnapshot.optionExitPrice, 1);
  const progressMessage = getOptionValueProgressMessage(progress);

  return (
    <section className="mt-3 rounded-md border border-indigo-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-bold text-slate-950">時間価値減衰ビュー</div>
          <p className="mt-1 text-xs font-semibold text-indigo-800">
            現在オプション価格を本質的価値と時間的価値に分解します。
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
          {sourceLabel(currentSnapshot.source)}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <MiniMetric label="現在オプション価格" value={`${formatUSD(currentSnapshot.optionExitPrice)} / 株`} />
        <MiniMetric label="本質的価値" value={`${formatUSD(currentSnapshot.intrinsicValue)} / 株`} />
        <MiniMetric label="時間的価値" value={`${formatUSD(currentSnapshot.timeValue)} / 株`} tone={currentSnapshot.timeValue <= 0.05 ? "amber" : undefined} />
        <MiniMetric label="時間的価値比率" value={formatPct(currentSnapshot.timeValueRatio * 100)} />
      </div>

      <div className="mt-3 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
        <div className="flex h-5 w-full">
          <div className="bg-emerald-500" style={{ width: `${intrinsicPct}%` }} title="本質的価値" />
          <div className="bg-rose-400" style={{ width: `${timePct}%` }} title="時間的価値" />
        </div>
        <div className="flex justify-between px-2 py-1 text-[11px] font-semibold text-slate-600">
          <span>本質 {formatUSD(currentSnapshot.intrinsicValue)}</span>
          <span>時間 {formatUSD(currentSnapshot.timeValue)}</span>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <MiniMetric label="反対売買損益分岐価格" value={exitBreakevenPriceUSD === undefined ? "未計算" : `${formatUSD(exitBreakevenPriceUSD)} / 株`} />
        <MiniMetric
          label="損益分岐までの余裕"
          value={exitBreakevenBufferUSD === null ? "未計算" : `${formatSignedUSD(exitBreakevenBufferUSD)} / 株`}
          tone={exitBreakevenBufferUSD === null ? undefined : exitBreakevenBufferUSD >= 0 ? "green" : "red"}
        />
        <MiniMetric label="利確/損切りライン" value={`${formatUSD(profitTargetPriceUSD)} / ${formatUSD(stopLossPriceUSD)}`} />
        <MiniMetric label="残存日数" value={`${dte}日`} tone={dte <= 7 ? "amber" : undefined} />
        <MiniMetric label="反対売買時の参考受取額" value={exitProceedsValue} />
        <MiniMetric label={accountCashLabel} value={accountCashValue} />
      </div>

      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="font-bold text-slate-800">価値分解タイムライン</div>
        <div className="mt-2 grid gap-2">
          {latestTimeline.map((snapshot) => {
            const widthPct = Math.max(4, (snapshot.optionExitPrice / maxTimelineValue) * 100);
            const snapshotIntrinsicPct = snapshot.optionExitPrice > 0
              ? Math.min(100, Math.max(0, (snapshot.intrinsicValue / snapshot.optionExitPrice) * 100))
              : 0;
            return (
              <div key={`${snapshot.snapshotDate}-${snapshot.optionExitPrice}`} className="grid grid-cols-[88px_1fr_72px] items-center gap-2 text-xs">
                <div className="font-semibold text-slate-600">
                  <div>{snapshot.snapshotDate}</div>
                  <div className="text-[10px] font-medium">{sourceLabel(snapshot.source)}</div>
                </div>
                <div className="h-4 rounded bg-white">
                  <div className="flex h-4 overflow-hidden rounded" style={{ width: `${widthPct}%` }}>
                    <div className="bg-emerald-500" style={{ width: `${snapshotIntrinsicPct}%` }} />
                    <div className="flex-1 bg-rose-400" />
                  </div>
                </div>
                <div className="numeric-input text-right font-bold text-slate-800">{formatUSD(snapshot.optionExitPrice)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {progress ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="font-bold text-slate-800">価値変化バランス</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <MiniMetric label="本質的価値増減" value={`${formatSignedUSD(progress.intrinsicGain)} / 株`} tone={progress.intrinsicGain >= 0 ? "green" : "red"} />
            <MiniMetric label="時間的価値増減" value={`${formatSignedUSD(progress.timeValueChange)} / 株`} tone={progress.timeValueChange >= 0 ? "green" : "red"} />
            <MiniMetric label="差し引き変化" value={`${formatSignedUSD(progress.netOptionMove)} / 株`} tone={progress.netOptionMove >= 0 ? "green" : "red"} />
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            比較対象: {progress.previous.snapshotDate} → {progress.current.snapshotDate}（{progress.elapsedDays}日差分）。時間的価値は {formatSignedUSD(progress.timeValueChange)} / 株、本質的価値は {formatSignedUSD(progress.intrinsicGain)} / 株。
          </p>
          {progress.sourcesMixed ? (
            <p className="mt-2 text-xs leading-5 text-slate-600">
              取得元が混在しています: {sourceLabel(progress.previous.source)} → {sourceLabel(progress.current.source)}。
            </p>
          ) : null}
          <p className={`mt-2 rounded-md px-2 py-1.5 text-xs font-semibold leading-5 ${
            progress.timeValueDirection === "decrease"
              ? "border border-amber-300 bg-amber-50 text-amber-950"
              : "border border-indigo-200 bg-indigo-50 text-indigo-900"
          }`}>
            {progressMessage}
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-600">
          比較データ不足。取得元と記録時刻を含む直近2件の価格がそろうと、観測差分を比較します。
        </p>
      )}
      {Number.isFinite(theoreticalThetaUSD) ? (
        <p className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
          <span className="font-bold text-slate-800">理論上の時間減価に関する注意:</span> モデルtheta {formatSignedUSD(theoreticalThetaUSD ?? 0)} / 株・日。上の観測差分とは別の参考値です。
        </p>
      ) : null}
    </section>
  );
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  const toneClass = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-rose-700" : tone === "amber" ? "text-amber-700" : "text-slate-950";
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div className={`numeric-input mt-1 font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}

function roundOptionPrice(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100) / 100;
}

function calculateRemainingDaysUntilExpiry(expiryDate: string, now = new Date()): number {
  const expiry = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return 0;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const expiryDay = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
  return Math.max(0, Math.ceil((expiryDay.getTime() - today.getTime()) / 86_400_000));
}

function formatOptionalUSD(value?: number): string {
  return value !== undefined && Number.isFinite(value) ? formatUSD(value) : "未取得";
}

function formatLongOptionExitProceedsValue(
  simulation: TradeSimulation,
  preview: LongOptionExitProceedsPreview | undefined,
): string {
  if (!preview) return "現在価格未入力";
  if (simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT") {
    return preview.netJPY !== undefined
      ? `手数料後 ${formatUSD(preview.netUSD)} / 参考 ${formatJPY(preview.netJPY)}`
      : `手数料後 ${formatUSD(preview.netUSD)} / 参考JPY未計算`;
  }
  return preview.netJPY !== undefined
    ? `手数料後 ${formatJPY(preview.netJPY)} / ${formatUSD(preview.netUSD)}`
    : `手数料後 参考JPY未計算 / ${formatUSD(preview.netUSD)}`;
}

function formatLongOptionExitProceedsBreakdown(preview: LongOptionExitProceedsPreview | undefined): string {
  if (!preview) return "現在オプション価格を入れると、手数料前後の参考受取額を表示します。";
  const grossJPY = preview.grossJPY !== undefined ? formatJPY(preview.grossJPY) : "参考JPY未計算";
  const netJPY = preview.netJPY !== undefined ? formatJPY(preview.netJPY) : "参考JPY未計算";
  return `手数料前 ${formatUSD(preview.grossUSD)} / ${grossJPY}、手数料後 ${formatUSD(preview.netUSD)} / ${netJPY}`;
}

function formatLongOptionAccountCashPreview(
  simulation: TradeSimulation,
  accountInputs: AccountInputs | undefined,
  preview: LongOptionExitProceedsPreview | undefined,
): string {
  const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
  const account = accountInputs?.[isN ? "N" : "P"];
  if (!account) return isN ? "N口座USD現金 未取得" : "P口座現金残高 未取得";
  if (!preview) return isN ? `現在 ${formatUSD(account.cashBalance)}` : `現在 ${formatJPY(account.cashBalance)}`;
  if (isN) {
    return `現在 ${formatUSD(account.cashBalance)} / 決済後見込み ${formatUSD(account.cashBalance + preview.netUSD)}`;
  }
  if (preview.netJPY === undefined) {
    return `現在 ${formatJPY(account.cashBalance)} / 決済後見込み 参考JPY未計算`;
  }
  return `現在 ${formatJPY(account.cashBalance)} / 決済後見込み ${formatJPY(account.cashBalance + preview.netJPY)}`;
}

function formatSignedUSD(value: number): string {
  return `${value > 0 ? "+" : ""}${formatUSD(value)}`;
}

function todayIsoDate(now = new Date()): string {
  return [
    now.getFullYear(),
    `${now.getMonth() + 1}`.padStart(2, "0"),
    `${now.getDate()}`.padStart(2, "0"),
  ].join("-");
}

function daysBetweenIsoDates(from: string, to: string): number {
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 1;
  return Math.ceil((toDate.getTime() - fromDate.getTime()) / 86_400_000);
}

function sourceLabel(source: OptionValueSnapshotSource): string {
  if (source === "saxo") return "Saxo候補/手入力";
  if (source === "moomoo") return "moomoo Bid";
  return "手入力";
}

function MiniRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 rounded bg-white px-2 py-1">
      <dt className="text-slate-500">{label}</dt>
      <dd className="numeric-input font-bold text-slate-950">{value}</dd>
    </div>
  );
}

function calculateElapsedDaysSinceEntry(entryDate: string, now = new Date()): number {
  const entry = new Date(`${entryDate}T00:00:00`);
  if (Number.isNaN(entry.getTime())) return 1;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const entryDay = new Date(entry.getFullYear(), entry.getMonth(), entry.getDate());
  return Math.max(1, Math.ceil((today.getTime() - entryDay.getTime()) / 86_400_000));
}

export function calculateLongOptionCloseAnnualizedReturnPercent({
  profit,
  entryCost,
  elapsedDays,
}: {
  profit: number | null;
  entryCost: number;
  elapsedDays: number;
}): number | null {
  if (profit === null || !Number.isFinite(profit)) return null;
  if (!Number.isFinite(entryCost) || entryCost <= 0) return null;
  const safeElapsedDays = Math.max(1, elapsedDays);
  return (profit / entryCost) * (365 / safeElapsedDays) * 100;
}

export function calculateLongOptionExitBreakevenPriceUSD({
  paidPremiumUSD,
  openCommissionUSD,
  closeCommissionUSD,
  quantity,
}: {
  paidPremiumUSD: number;
  openCommissionUSD: number;
  closeCommissionUSD: number;
  quantity: number;
}): number {
  const contractShares = Math.max(1, quantity * 100);
  return (paidPremiumUSD + openCommissionUSD + closeCommissionUSD) / contractShares;
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
    if (!Number.isFinite(simulation.currentPriceUSD) || simulation.currentPriceUSD <= 0) {
      return { label: "原資産株価未取得", detail: `目安 ${formatUSD(stopValue)}。株価取得後に判定します。`, tone: "amber" };
    }
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
