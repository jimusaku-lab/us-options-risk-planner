import type { ChangeEvent } from "react";
import { useEffect, useState } from "react";
import { JapaneseYen, RotateCw } from "lucide-react";
import type { DenominatorMode, ExitBrokerOrderType, ExitOrderPlan, ExitOrderPlanMode, ExitStopLossType, OptionCloseExecution, OptionEntryExecution, OptionLeg, PutIntent, SimulationStatus, StrategyType, TradeSimulation } from "@/types/domain";
import { DEFAULT_NISA_EXPECTED_ANNUAL_RETURN_PCT, type WorkspaceMode } from "@/store/useOptionsStore";
import { calculateDte, getShortOptionLegs } from "@/domain/calculations";
import { calculateProfitTakeBuybackPriceUSD, getDefaultExitOrderPlanForLeg, getExitOrderPlanForLeg, normalizeExitOrderPlans } from "@/domain/exitOrderPlan";
import { calculateOptionEntryExecutionSummary, createOptionEntryExecutionDraft } from "@/domain/optionEntryExecutions";
import { calculateOptionCloseExecutionResults, createOptionCloseExecutionDraft } from "@/domain/optionCloseExecutions";
import { getStatusLabel } from "@/domain/strategyLabels";
import { NumberInput } from "@/components/ui/NumberInput";
import { formatJPY, formatPct, formatUSD } from "@/lib/format";
import { fetchStooqQuote, fetchUsdJpyRate, normalizeTicker } from "@/lib/marketData";

type SimulationEditorProps = {
  simulation: TradeSimulation;
  workspace: WorkspaceMode;
  canUseExternalQuotes: boolean;
  externalQuoteModeLabel: string;
  onChange: (simulation: TradeSimulation) => void;
  onCloseDecisionAction?: (anchorId: string) => void;
  focusRequest?: { anchorId: string; requestId: number } | null;
};

export function SimulationEditor({ simulation, workspace, canUseExternalQuotes, externalQuoteModeLabel, onChange, onCloseDecisionAction, focusRequest }: SimulationEditorProps) {
  const [quoteStatus, setQuoteStatus] = useState<string>("");
  const [workflowNotice, setWorkflowNotice] = useState<{ message: string; actionLabel: string; anchorId: string } | null>(null);
  const [highlightedAnchorId, setHighlightedAnchorId] = useState<string | null>(null);
  const callLeg = simulation.optionLegs.find((leg) => leg.type === "call");
  const putLeg = simulation.optionLegs.find((leg) => leg.type === "put");
  const needsCall = ["covered_call", "covered_call_plus_short_put", "short_strangle", "wheel"].includes(
    simulation.strategyType,
  );
  const needsPut = ["short_put", "covered_call_plus_short_put", "short_strangle", "wheel"].includes(
    simulation.strategyType,
  );
  const needsStock = ["covered_call", "covered_call_plus_short_put", "short_strangle", "wheel"].includes(
    simulation.strategyType,
  );
  const needsBrokerMarginInput = ["short_put", "covered_call_plus_short_put", "short_strangle", "wheel", "custom"].includes(
    simulation.strategyType,
  );
  const defaultStockSettlement = {
    enabled: false,
    kind: "manual_sale" as const,
    settlementDate: simulation.expiryDate,
    shares: simulation.stockPosition?.shares ?? 100,
    sellPriceUSD: callLeg?.strikeUSD || simulation.currentPriceUSD,
    costBasisUSD: simulation.stockPosition?.averageCostUSD ?? simulation.currentPriceUSD,
    fxRateJPY: simulation.fxRateJPY,
    commissionUSD: 0,
    commissionJPY: 0,
  };
  const stockSettlement = simulation.stockSettlement ?? defaultStockSettlement;
  const defaultStockAcquisition = {
    enabled: false,
    acquisitionDate: simulation.expiryDate,
    shares: (putLeg?.quantity ?? 1) * 100,
    priceUSD: putLeg?.strikeUSD ?? simulation.currentPriceUSD,
    accountEnvironment: simulation.accountEnvironment,
    commissionUSD: undefined,
    commissionJPY: undefined,
    source: "manual" as const,
    memo: "",
  };
  const stockAcquisition = simulation.stockAcquisition ?? defaultStockAcquisition;

  const update = (patch: Partial<TradeSimulation>) => onChange({ ...simulation, ...patch });
  const updateAccountEnvironment = (accountEnvironment: TradeSimulation["accountEnvironment"]) => {
    const accountCode = accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "N" : "P";
    onChange({
      ...simulation,
      accountCode,
      accountEnvironment,
      accountCurrency: accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "USD" : "JPY",
      referenceFxRateJPY: simulation.referenceFxRateJPY ?? simulation.fxRateJPY,
      brokerMarginUSD: accountEnvironment === "PROD_N_USD_SETTLEMENT" ? simulation.brokerMarginUSD ?? (simulation.fxRateJPY > 0 ? simulation.brokerMarginJPY / simulation.fxRateJPY : 0) : simulation.brokerMarginUSD,
    });
  };
  const updateStockSettlement = (patch: Partial<NonNullable<TradeSimulation["stockSettlement"]>>) => {
    update({
      stockSettlement: {
        ...defaultStockSettlement,
        ...stockSettlement,
        ...patch,
      },
    });
  };
  const updateStockAcquisition = (patch: Partial<NonNullable<TradeSimulation["stockAcquisition"]>>) => {
    update({
      stockAcquisition: {
        ...defaultStockAcquisition,
        ...stockAcquisition,
        ...patch,
      },
    });
  };
  const updateStrategy = (strategyType: StrategyType) => {
    const nextNeedsCall = ["covered_call", "covered_call_plus_short_put", "short_strangle", "wheel"].includes(
      strategyType,
    );
    const nextNeedsPut = ["short_put", "covered_call_plus_short_put", "short_strangle", "wheel"].includes(
      strategyType,
    );
    const nextNeedsStock = ["covered_call", "covered_call_plus_short_put", "short_strangle", "wheel"].includes(
      strategyType,
    );
    const nextLegs = [
      ...(nextNeedsCall
        ? [
            callLeg ?? {
              id: `${simulation.id}-call`,
              type: "call" as const,
              side: "sell" as const,
              strikeUSD: 0,
              premiumUSD: 0,
              quantity: 1,
              expiryDate: simulation.expiryDate,
              isCovered: nextNeedsStock,
              assignmentPolicy: "unknown" as const,
            },
          ]
        : []),
      ...(nextNeedsPut
        ? [
            putLeg ?? {
              id: `${simulation.id}-put`,
              type: "put" as const,
              side: "sell" as const,
              strikeUSD: 0,
              premiumUSD: 0,
              quantity: 1,
              expiryDate: simulation.expiryDate,
              putIntent: "can_buy" as const,
              assignmentPolicy: "unknown" as const,
            },
          ]
        : []),
    ];
    onChange({
      ...simulation,
      strategyType,
      optionLegs: nextLegs,
      stockPosition: nextNeedsStock
        ? simulation.stockPosition ?? {
            shares: 0,
            averageCostUSD: 0,
            denominatorPriceMode: "current_price",
          }
        : null,
      brokerMarginJPY: nextNeedsPut ? simulation.brokerMarginJPY : 0,
      denominatorMode: strategyType === "short_put" ? "cash_secured" : simulation.denominatorMode,
    });
  };
  const updateLeg = (id: string, patch: Partial<TradeSimulation["optionLegs"][number]>) => {
    update({
      optionLegs: simulation.optionLegs.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)),
    });
  };
  const putIntentValue =
    putLeg?.putIntent === "do_not_want_to_buy" || putLeg?.putIntent === "cannot_buy" || putLeg?.putIntent === "avoid_assignment"
      ? "avoid_assignment"
      : "accept_assignment";
  const callRequiredShares = callLeg ? callLeg.quantity * 100 : 0;
  const stockShares = simulation.stockPosition?.shares ?? 0;
  const uncoveredCallShares = Math.max(0, callRequiredShares - stockShares);
  const coveredCallShares = Math.min(stockShares, callRequiredShares);
  const hasUncoveredCall = uncoveredCallShares > 0;
  const callPolicyValue =
    callLeg?.callExitIntent === "naked_buyback"
      ? "naked_buyback"
      : hasUncoveredCall && callLeg?.callExitIntent !== "covered_keep_stock" && simulation.stockPosition?.canSellAtStrike !== false
        ? "naked_buyback"
      : simulation.stockPosition?.canSellAtStrike === false || callLeg?.callExitIntent === "covered_keep_stock"
        ? "keep_stock"
        : "can_sell";
  const shortExitLegs = getShortOptionLegs(simulation);
  const optionEntryExecutions = simulation.optionEntryExecutions ?? [];
  const optionEntrySummary = calculateOptionEntryExecutionSummary(simulation);
  const showOptionEntryExecutions = simulation.status === "open" || optionEntryExecutions.length > 0;
  const optionCloseExecutions = simulation.optionCloseExecutions ?? [];
  const optionCloseResults = calculateOptionCloseExecutionResults(simulation);
  const showOptionCloseExecutions = ["closed", "expired"].includes(simulation.status) || optionCloseExecutions.length > 0;
  const exitOrderPlans = normalizeExitOrderPlans(simulation);
  const updateExitOrderPlan = (legId: string, patch: Partial<ExitOrderPlan>) => {
    const leg = shortExitLegs.find((item) => item.id === legId);
    if (!leg) return;
    const exitOrderPlan = exitOrderPlans.find((plan) => plan.legId === legId) ?? getDefaultExitOrderPlanForLeg(leg);
    const nextPlan = {
      ...exitOrderPlan,
      ...patch,
      scope: "leg" as const,
      legId,
    };
    const stopLossType = nextPlan.stopLossType ?? "buyback_price";
    const stopLossValue =
      stopLossType === "stock_price_line"
        ? nextPlan.stopLossStockPriceUSD ?? 0
        : stopLossType === "loss_amount"
          ? simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
            ? nextPlan.stopLossAmountUSD ?? 0
            : nextPlan.stopLossAmountJPY ?? 0
          : nextPlan.stopLossBuybackPriceUSD ?? 0;
    const targetPremiumKeepPercent = nextPlan.profitTakePremiumKeepPercent ?? 60;
    onChange({
      ...simulation,
      exitOrderPlan: leg.type === "put" ? nextPlan : simulation.exitOrderPlan,
      exitOrderPlans: [
        ...exitOrderPlans.filter((plan) => plan.legId !== legId),
        {
          ...nextPlan,
          profitTakeBuybackPriceUSD: calculateProfitTakeBuybackPriceUSD(leg.premiumUSD, targetPremiumKeepPercent),
        },
      ],
      profitTakeRule:
        leg.type === "put"
          ? {
              enabled: nextPlan.profitTakeEnabled,
              targetPremiumKeepPercent,
              latestCloseDaysBeforeExpiry: nextPlan.latestCloseDaysBeforeExpiry,
            }
          : simulation.profitTakeRule,
      stopLossRule:
        leg.type === "put"
          ? {
              enabled: nextPlan.stopLossEnabled,
              type:
                stopLossType === "stock_price_line"
                  ? "stock_price_line"
                  : stopLossType === "loss_amount"
                    ? "loss_amount_jpy"
                    : "option_buyback_price",
              value: stopLossValue,
            }
          : simulation.stopLossRule,
    });
  };
  const updateExitMode = (legId: string, mode: ExitOrderPlanMode) => {
    const legPlan = exitOrderPlans.find((plan) => plan.legId === legId) ?? getDefaultExitOrderPlanForLeg(shortExitLegs.find((leg) => leg.id === legId));
    const exitBrokerOrderType = legPlan.brokerOrderType ?? "none";
    const brokerOrderType: ExitBrokerOrderType =
      mode === "manual_only"
        ? "none"
        : mode === "attached_entry_exit_order"
          ? ["ifd", "ifd_oco"].includes(exitBrokerOrderType)
            ? exitBrokerOrderType
            : "ifd_oco"
          : ["closing_limit", "closing_stop", "oco"].includes(exitBrokerOrderType)
            ? exitBrokerOrderType
            : "closing_limit";
    const profitTakeEnabled = mode === "manual_only" ? legPlan.profitTakeEnabled : ["closing_limit", "oco", "ifd", "ifd_oco"].includes(brokerOrderType);
    const stopLossEnabled = mode === "manual_only" ? legPlan.stopLossEnabled : ["closing_stop", "oco", "ifd_oco"].includes(brokerOrderType);
    updateExitOrderPlan(legId, { mode, brokerOrderType, profitTakeEnabled, stopLossEnabled });
  };
  const updateBrokerOrderType = (legId: string, brokerOrderType: ExitBrokerOrderType) => {
    const legPlan = exitOrderPlans.find((plan) => plan.legId === legId) ?? getDefaultExitOrderPlanForLeg(shortExitLegs.find((leg) => leg.id === legId));
    const isManualExitMode = legPlan.mode === "manual_only";
    updateExitOrderPlan(legId, {
      brokerOrderType,
      profitTakeEnabled: isManualExitMode ? legPlan.profitTakeEnabled : ["closing_limit", "oco", "ifd", "ifd_oco"].includes(brokerOrderType),
      stopLossEnabled: isManualExitMode ? legPlan.stopLossEnabled : ["closing_stop", "oco", "ifd_oco"].includes(brokerOrderType),
    });
  };
  const scrollToEditorAnchor = (anchorId: string) => {
    setHighlightedAnchorId(anchorId);
    window.setTimeout(() => {
      const target = document.getElementById(anchorId);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      const input =
        anchorId === "option-close-executions"
          ? target?.querySelector<HTMLInputElement>("#broker-realized-pnl-jpy") ?? target?.querySelector<HTMLInputElement>("input")
          : target?.querySelector<HTMLInputElement>("input");
      input?.focus();
    }, 80);
    window.setTimeout(() => setHighlightedAnchorId((current) => (current === anchorId ? null : current)), 4500);
  };
  const applyStatusTransitionDrafts = (nextStatus: SimulationStatus): Partial<TradeSimulation> => {
    if (simulation.status === "planned" && nextStatus === "open") {
      const existingLegIds = new Set(optionEntryExecutions.map((execution) => execution.legId));
      const drafts = shortExitLegs
        .filter((leg) => !existingLegIds.has(leg.id))
        .map((leg) => createOptionEntryExecutionDraft({ simulation, leg }));
      if (drafts.length > 0 || optionEntryExecutions.length > 0) scrollToEditorAnchor("option-entry-executions");
      return drafts.length > 0 ? { optionEntryExecutions: [...optionEntryExecutions, ...drafts] } : {};
    }
    if (simulation.status !== "open" || !["closed", "assigned", "expired"].includes(nextStatus)) return {};
    if (nextStatus === "closed") {
      const existingLegIds = new Set(optionCloseExecutions.filter((execution) => (execution.closeKind ?? "buyback") === "buyback").map((execution) => execution.legId));
      const drafts = shortExitLegs
        .filter((leg) => !existingLegIds.has(leg.id))
        .map((leg) =>
          createOptionCloseExecutionDraft({
            simulation,
            leg,
            closePriceUSD: leg.closeCostUSD ?? leg.closePlan?.closePriceUSD,
            closeKind: "buyback",
          }),
        );
      if (drafts.length > 0) scrollToEditorAnchor("option-close-executions");
      return drafts.length > 0 ? { optionCloseExecutions: [...optionCloseExecutions, ...drafts] } : {};
    }
    if (nextStatus === "expired") {
      const existingLegIds = new Set(optionCloseExecutions.filter((execution) => execution.closeKind === "expired").map((execution) => execution.legId));
      const drafts = shortExitLegs
        .filter((leg) => !existingLegIds.has(leg.id))
        .map((leg) =>
          createOptionCloseExecutionDraft({
            simulation,
            leg,
            closeKind: "expired",
            closeDate: simulation.expiryDate,
          }),
        );
      if (drafts.length > 0) scrollToEditorAnchor("option-close-executions");
      return drafts.length > 0 ? { optionCloseExecutions: [...optionCloseExecutions, ...drafts] } : {};
    }
    const putShares = getShortOptionLegs(simulation)
      .filter((leg) => leg.type === "put")
      .reduce((sum, leg) => sum + leg.quantity * 100, 0);
    const putStrike = getShortOptionLegs(simulation).find((leg) => leg.type === "put")?.strikeUSD ?? 0;
    const callShares = getShortOptionLegs(simulation)
      .filter((leg) => leg.type === "call")
      .reduce((sum, leg) => sum + leg.quantity * 100, 0);
    const callStrike = getShortOptionLegs(simulation).find((leg) => leg.type === "call")?.strikeUSD ?? 0;
    const patch: Partial<TradeSimulation> = {};
    if (putShares > 0 && !stockAcquisition.enabled) {
      patch.stockAcquisition = {
        ...defaultStockAcquisition,
        enabled: true,
        acquisitionDate: simulation.expiryDate,
        shares: putShares,
        priceUSD: putStrike,
        accountEnvironment: simulation.accountEnvironment,
        source: "manual",
        memo: "P売り権利行使による株式取得。株式取得自体は譲渡損益ではありません。",
      };
    }
    if (callShares > 0 && !stockSettlement.enabled) {
      patch.stockSettlement = {
        ...defaultStockSettlement,
        enabled: true,
        kind: "covered_call_assignment",
        settlementDate: simulation.expiryDate,
        shares: callShares,
        sellPriceUSD: callStrike,
        costBasisUSD: simulation.stockPosition?.averageCostUSD ?? simulation.currentPriceUSD,
        memo: "C売り権利行使による株式譲渡。オプション損益とは自動相殺しません。",
      };
    }
    if (patch.stockAcquisition) scrollToEditorAnchor("stock-acquisition-record");
    else if (patch.stockSettlement) scrollToEditorAnchor("stock-settlement-record");
    return patch;
  };
  const updateStatus = (nextStatus: SimulationStatus) => {
    const transitionPatch = applyStatusTransitionDrafts(nextStatus);
    let notice = getStatusWorkflowNotice(simulation.status, nextStatus);
    if (notice && nextStatus === "assigned" && getShortOptionLegs(simulation).every((leg) => leg.type === "call")) {
      notice = { ...notice, anchorId: "stock-settlement-record", actionLabel: "譲渡記録へ進む" };
    }
    if (notice) setWorkflowNotice(notice);
    onChange({
      ...simulation,
      ...transitionPatch,
      status: nextStatus,
    });
  };
  const updateOptionCloseExecution = (id: string, patch: Partial<OptionCloseExecution>) => {
    update({
      optionCloseExecutions: optionCloseExecutions.map((execution) =>
        execution.id === id ? { ...execution, ...patch } : execution,
      ),
    });
  };
  const updateOptionEntryExecution = (id: string, patch: Partial<OptionEntryExecution>) => {
    update({
      optionEntryExecutions: optionEntryExecutions.map((execution) =>
        execution.id === id ? { ...execution, ...patch } : execution,
      ),
    });
  };
  const confirmOptionEntryExecutions = () => {
    update({
      optionEntryExecutions: optionEntryExecutions.map((execution) => ({ ...execution, confirmed: true })),
    });
  };
  const addOptionEntryExecution = (leg: OptionLeg) => {
    update({
      optionEntryExecutions: [
        ...optionEntryExecutions,
        createOptionEntryExecutionDraft({ simulation, leg }),
      ],
    });
  };
  const removeOptionEntryExecution = (id: string) => {
    update({ optionEntryExecutions: optionEntryExecutions.filter((execution) => execution.id !== id) });
  };
  const addOptionCloseExecution = (leg: OptionLeg) => {
    update({
      optionCloseExecutions: [
        ...optionCloseExecutions,
        createOptionCloseExecutionDraft({
          simulation,
          leg,
          closePriceUSD: leg.closeCostUSD ?? leg.closePlan?.closePriceUSD ?? 0,
          closeKind: simulation.status === "expired" ? "expired" : "buyback",
          closeDate: simulation.status === "expired" ? simulation.expiryDate : undefined,
        }),
      ],
    });
  };
  const removeOptionCloseExecution = (id: string) => {
    update({ optionCloseExecutions: optionCloseExecutions.filter((execution) => execution.id !== id) });
  };

  useEffect(() => {
    if (!focusRequest?.anchorId) return;
    window.setTimeout(() => {
      const target = document.getElementById(focusRequest.anchorId);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      const input =
        focusRequest.anchorId === "option-close-executions"
          ? target?.querySelector<HTMLInputElement>("#broker-realized-pnl-jpy") ?? target?.querySelector<HTMLInputElement>("input")
          : target?.querySelector<HTMLInputElement>("input");
      input?.focus();
      setHighlightedAnchorId(focusRequest.anchorId);
      window.setTimeout(() => setHighlightedAnchorId((current) => (current === focusRequest.anchorId ? null : current)), 4500);
    }, 80);
  }, [focusRequest?.requestId, focusRequest?.anchorId]);
  const hasMultipleAssignedRecords =
    simulation.status === "assigned" && Boolean(stockAcquisition.enabled && stockSettlement.enabled);

  return (
    <section>
      <div id="simulation-editor" className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-950">建玉状態ワークフロー</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">状態を変更すると、次に必要な実績入力カードへ移動します。</p>
          </div>
          <span className="rounded-md bg-white px-2 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
            現在: {getStatusLabel(simulation.status)}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["planned", "open", "closed", "assigned", "expired"] as SimulationStatus[]).map((status) => (
            <button
              key={status}
              type="button"
              className={`rounded-md border px-3 py-2 text-xs font-bold ${
                simulation.status === status
                  ? "border-teal-500 bg-teal-600 text-white"
                  : isLikelyNextStatus(simulation.status, status)
                    ? "border-teal-200 bg-white text-teal-800 hover:bg-teal-50"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              }`}
              onClick={() => updateStatus(status)}
            >
              {getStatusLabel(status)}
            </button>
          ))}
        </div>
        {workflowNotice ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
            <span className="font-semibold">{workflowNotice.message}</span>
            <button
              type="button"
              className="rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-bold text-sky-800 hover:bg-sky-100"
              onClick={() => scrollToEditorAnchor(workflowNotice.anchorId)}
            >
              {workflowNotice.actionLabel}
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="sr-only">建玉入力欄</h2>
          <p className="text-sm text-slate-600">Saxo TraderGOのチケット表示を見ながら入力します。API接続は使いません。</p>
        </div>
        <label className="flex max-w-xl items-start gap-2 text-sm font-semibold text-slate-700">
          <input
            className="mt-1"
            type="checkbox"
            checked={simulation.beginnerMode ?? true}
            onChange={(event) => update({ beginnerMode: event.target.checked })}
          />
          <span>
            <span className="block">初心者モード</span>
            <span className="block text-xs font-normal leading-5 text-slate-500">
              ONの場合、裸コールなど初心者には避けたい構成を注文前NGとして扱います。
            </span>
          </span>
        </label>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-bold text-slate-950">1. 銘柄・価格</h3>
          <div className="mt-3 grid gap-3">
          <Select
            label="Saxo口座"
            value={simulation.accountEnvironment}
            onChange={(accountEnvironment) => updateAccountEnvironment(accountEnvironment as TradeSimulation["accountEnvironment"])}
            options={
              workspace === "demo"
                ? [["DEMO_JPY_BASE", "DEMO / JPYベース"]]
                : [
                    ["PROD_P_JPY_SETTLEMENT", "本番P口座: JPY決済"],
                    ["PROD_N_USD_SETTLEMENT", "本番N口座: USD決済"],
                  ]
            }
          />
          <Select
            label="建玉状態"
            value={simulation.status}
            onChange={(status) => updateStatus(status as SimulationStatus)}
            options={[
              ["planned", "注文前"],
              ["open", "建玉中"],
              ["closed", "決済済み"],
              ["assigned", "権利行使済み"],
              ["expired", "満期終了"],
            ]}
          />
          <Select
            label="戦略"
            value={simulation.strategyType}
            onChange={(value) => updateStrategy(value as StrategyType)}
            options={[
              ["covered_call", "カバードコール"],
              ["short_put", "プット売り"],
              ["covered_call_plus_short_put", "カバードコール＋追加P売り"],
              ["short_strangle", "ショートストラングル"],
              ["wheel", "ホイール戦略"],
            ]}
          />
          <TextInput
            label="銘柄ティッカー"
            value={simulation.ticker}
            placeholder="例: NVDA, AMZN, NFLX"
            onChange={(ticker) => update({ ticker })}
          />
          <p className="-mt-2 text-xs leading-5 text-slate-500">
            株価取得には米国株ティッカーを使います。NVIDIA、Amazon、アマゾン等は代表ティッカーへ自動変換します。
          </p>
          <div className="grid gap-1.5 text-sm font-medium text-slate-700">
            <div className="flex items-center justify-between gap-2">
              <span>現在株価</span>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                title={canUseExternalQuotes ? "公開クオートから現在株価を取得" : externalQuoteModeLabel}
                disabled={!canUseExternalQuotes}
                onClick={async () => {
                  if (!canUseExternalQuotes) return;
                  const ticker = normalizeTicker(simulation.ticker);
                  if (!ticker) {
                    setQuoteStatus("先に銘柄ティッカーを入力してください。");
                    return;
                  }
                  setQuoteStatus("株価を取得中...");
                  try {
                    const quote = await fetchStooqQuote(ticker);
                    update({ ticker, currentPriceUSD: quote.price });
                    setQuoteStatus(
                      `${ticker}: ${quote.price.toLocaleString("en-US", {
                        maximumFractionDigits: 2,
                      })} USDを反映しました。${quote.date ?? ""} ${quote.time ?? ""}`,
                    );
                  } catch (error) {
                    setQuoteStatus(error instanceof Error ? error.message : "株価を取得できませんでした。");
                  }
                }}
              >
                <RotateCw size={13} />
                取得
              </button>
            </div>
            <NumberInput label="" value={simulation.currentPriceUSD} suffix="USD" onChange={(currentPriceUSD) => update({ currentPriceUSD })} />
            {quoteStatus ? <p className="text-xs leading-5 text-slate-500">{quoteStatus}</p> : null}
          </div>
          <div className="grid gap-1.5 text-sm font-medium text-slate-700">
            <div className="flex items-center justify-between gap-2">
              <span>為替</span>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                title={canUseExternalQuotes ? "公開クオートからUSD/JPYを取得" : externalQuoteModeLabel}
                disabled={!canUseExternalQuotes}
                onClick={async () => {
                  if (!canUseExternalQuotes) return;
                  setQuoteStatus("USD/JPYを取得中...");
                  try {
                    const quote = await fetchUsdJpyRate();
                    update({ fxRateJPY: quote.rate });
                    setQuoteStatus(
                      `USD/JPY: ${quote.rate.toLocaleString("en-US", {
                        maximumFractionDigits: 3,
                      })} を反映しました。${quote.date ?? ""} ${quote.time ?? ""}`,
                    );
                  } catch (error) {
                    setQuoteStatus(error instanceof Error ? error.message : "為替を取得できませんでした。");
                  }
                }}
              >
                <JapaneseYen size={13} />
                取得
              </button>
            </div>
            <NumberInput
              label=""
              value={simulation.fxRateJPY}
              suffix="JPY/USD"
              onChange={(fxRateJPY) => update({ fxRateJPY, referenceFxRateJPY: simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? simulation.referenceFxRateJPY ?? fxRateJPY : fxRateJPY })}
            />
            {simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? (
              <p className="-mt-2 text-xs leading-5 text-slate-500">
                N口座ではUSD損益・USD年率を主計算にします。JPYは参考換算で、税務上の確定値ではありません。
              </p>
            ) : workspace === "demo" ? (
              <p className="-mt-2 text-xs leading-5 text-slate-500">
                DEMOはJPYベース検証用です。名称としてP口座とは扱わず、本番USD決済口座の残高管理の完全検証には使いません。
              </p>
            ) : null}
          </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-bold text-slate-950">2. 保有株・取引資金</h3>
          <div className="mt-3 grid gap-3">
          {needsStock ? (
            <>
              <NumberInput
                label="保有株数"
                value={simulation.stockPosition?.shares ?? 0}
                suffix="株"
                onChange={(shares) =>
                  update({
                    stockPosition: {
                      shares,
                      averageCostUSD: simulation.stockPosition?.averageCostUSD ?? simulation.currentPriceUSD,
                      denominatorPriceMode: simulation.stockPosition?.denominatorPriceMode ?? "current_price",
                    },
                  })
                }
              />
              <NumberInput
                label="現物取得単価"
                value={simulation.stockPosition?.averageCostUSD ?? 0}
                suffix="USD"
                onChange={(averageCostUSD) =>
                  update({
                    stockPosition: {
                      shares: simulation.stockPosition?.shares ?? 0,
                      averageCostUSD,
                      denominatorPriceMode: simulation.stockPosition?.denominatorPriceMode ?? "current_price",
                    },
                  })
                }
              />
            </>
          ) : (
            <div className="rounded-md border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-600">
              プット売り単体では、現物株の保有入力は使いません。P権利行使時に買う資金は分母比較で確認します。
            </div>
          )}
          {needsBrokerMarginInput ? (
            <>
              <NumberInput
                label="チケット表示証拠金"
                value={simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? simulation.brokerMarginUSD ?? 0 : simulation.brokerMarginJPY}
                suffix={simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "USD" : "JPY"}
                onChange={(value) =>
                  update(
                    simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
                      ? { brokerMarginUSD: value, brokerMarginJPY: value * simulation.fxRateJPY }
                      : { brokerMarginJPY: value },
                  )
                }
              />
              <NumberInput
                label="証拠金バッファ"
                value={simulation.marginBufferMultiplier}
                suffix="倍"
                min={1}
                onChange={(marginBufferMultiplier) => update({ marginBufferMultiplier })}
              />
            </>
          ) : (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">
              カバードコールは保有株でカバーするため、この建玉ではチケット表示証拠金を0として扱います。Saxoの決済チケットでも必要証拠金が0なら入力不要です。
            </div>
          )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-bold text-slate-950">3. オプション脚</h3>
          <div className="mt-3 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="建玉日"
              value={simulation.entryDate}
              type="date"
              onChange={(entryDate) => update({ entryDate, dte: calculateDte(entryDate, simulation.expiryDate) })}
            />
            <TextInput
              label="満期日"
              value={simulation.expiryDate}
              type="date"
              onChange={(expiryDate) =>
                update({
                  expiryDate,
                  dte: calculateDte(simulation.entryDate, expiryDate),
                  optionLegs: simulation.optionLegs.map((leg) => ({ ...leg, expiryDate })),
                })
              }
            />
          </div>
          {needsCall && callLeg ? (
            <>
              <NumberInput label="C権利行使価格" value={callLeg.strikeUSD} suffix="USD" onChange={(strikeUSD) => updateLeg(callLeg.id, { strikeUSD })} />
              <NumberInput label="Cプレミアム" value={callLeg.premiumUSD} suffix="USD/株" onChange={(premiumUSD) => updateLeg(callLeg.id, { premiumUSD })} />
              {needsStock ? (
                <>
                  <Select
                    label="C売りの方針"
                    value={callPolicyValue}
                    onChange={(value) => {
                      const nextIntent = value === "naked_buyback" ? "naked_buyback" : value === "keep_stock" ? "covered_keep_stock" : "covered_can_sell";
                      update({
                        stockPosition: {
                          shares: simulation.stockPosition?.shares ?? 0,
                          averageCostUSD: simulation.stockPosition?.averageCostUSD ?? simulation.currentPriceUSD,
                          denominatorPriceMode: simulation.stockPosition?.denominatorPriceMode ?? "current_price",
                          canSellAtStrike: value === "can_sell",
                        },
                        optionLegs: simulation.optionLegs.map((leg) =>
                          leg.id === callLeg.id
                            ? {
                                ...leg,
                                callExitIntent: nextIntent as OptionLeg["callExitIntent"],
                                assignmentPolicy: value === "can_sell" ? "accept" : "avoid",
                              }
                            : leg,
                        ),
                      });
                    }}
                    options={([
                      ...(hasUncoveredCall
                        ? [
                            ["naked_buyback", "現物なし・上抜け時は買戻し"],
                            ["keep_stock", "株を残したい"],
                            ...(coveredCallShares > 0 ? [["can_sell", "カバー済み株は売却可・不足分は買戻し確認"]] : []),
                          ]
                        : [
                            ["can_sell", "株を売却されてもよい"],
                            ["keep_stock", "株を残したい"],
                          ]),
                    ] as [string, string][])}
                  />
                  {hasUncoveredCall ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
                      C売り対象株数 {callRequiredShares}株 / 保有株数 {stockShares}株 / 未カバー {uncoveredCallShares}株。
                      {coveredCallShares > 0
                        ? ` カバー済み${coveredCallShares}株と未カバー${uncoveredCallShares}株を分けて確認します。`
                        : " 現物株を保有しないC売りとして、上抜け時の買戻し方針を確認します。"}
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          {needsPut && putLeg ? (
            <>
              <NumberInput label="P権利行使価格" value={putLeg.strikeUSD} suffix="USD" onChange={(strikeUSD) => updateLeg(putLeg.id, { strikeUSD })} />
              <NumberInput label="Pプレミアム" value={putLeg.premiumUSD} suffix="USD/株" onChange={(premiumUSD) => updateLeg(putLeg.id, { premiumUSD })} />
              <Select
                label="P売りの方針"
                value={putIntentValue}
                onChange={(putIntent) =>
                  updateLeg(putLeg.id, {
                    putIntent: putIntent as PutIntent,
                    assignmentPolicy: putIntent === "accept_assignment" ? "accept" : "avoid",
                  })
                }
                options={[
                  ["accept_assignment", "株を取得してもよい"],
                  ["avoid_assignment", "株を取得したくない"],
                ]}
              />
            </>
          ) : null}
          {simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? (
            <NumberInput
              label="取引手数料（USD）"
              value={simulation.brokerCommissionUSD ?? 0}
              suffix="USD"
              min={0}
              onChange={(brokerCommissionUSD) => update({ brokerCommissionUSD })}
            />
          ) : (
            <>
              <NumberInput
                label="取引手数料・諸費用（JPY）"
                value={simulation.brokerCommissionJPY ?? Number.NaN}
                suffix="JPY"
                min={0}
                onChange={(brokerCommissionJPY) => update({ brokerCommissionJPY })}
              />
              <NumberInput
                label="取引手数料（USD）"
                value={simulation.brokerCommissionUSD ?? 0}
                suffix="USD"
                min={0}
                onChange={(brokerCommissionUSD) => update({ brokerCommissionUSD })}
              />
            </>
          )}
          <p className="-mt-2 text-xs leading-5 text-slate-500">
            Saxoの取引チケットに表示される取引手数料をUSDで入力します。JPY欄は、画面上でJPY手数料が確認できる場合だけ入力します。
          </p>
          </div>
        </div>
      </div>

      {showOptionEntryExecutions ? (
        <div id="option-entry-executions" className={`mt-4 rounded-lg border bg-white p-3 ${highlightedAnchorId === "option-entry-executions" ? "border-amber-400 ring-2 ring-amber-200" : "border-slate-200"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-950">3-A. 建玉約定確認</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                注文前の予定値を、Saxoで実際に約定した建玉実績に確認・修正します。注文ID、ポジションID、約定時刻は通常入力に使わず、必要な場合だけメモへ残します。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {shortExitLegs.length > 0 ? (
                <button
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  type="button"
                  onClick={() => addOptionEntryExecution(shortExitLegs[0])}
                >
                  約定確認を追加
                </button>
              ) : null}
              {optionEntryExecutions.length > 0 ? (
                <button
                  className="rounded-md border border-emerald-300 bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                  type="button"
                  onClick={confirmOptionEntryExecutions}
                >
                  約定情報を確認済みにする
                </button>
              ) : null}
            </div>
          </div>
          {simulation.status === "open" && optionEntryExecutions.some((execution) => !execution.confirmed) ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-950">
              約定情報未確認です。P口座ではSaxo取引履歴のプレミアムJPYと取引費用JPYを確認してください。
            </div>
          ) : null}
          <div className="mt-3 grid gap-3">
            {optionEntryExecutions.map((execution) => {
              const selectedLeg = shortExitLegs.find((leg) => leg.id === execution.legId) ?? shortExitLegs[0];
              const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
              const usdPremium = execution.fillPriceUSD * 100 * execution.contracts;
              const referenceFxRate = execution.referenceFxRateJPY ?? execution.brokerExchangeRateJPY ?? simulation.referenceFxRateJPY ?? simulation.fxRateJPY;
              const referenceJpy = usdPremium * referenceFxRate - (execution.commissionUSD ?? 0) * referenceFxRate;
              return (
                <div key={execution.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-slate-950">{selectedLeg ? getOptionLegLabel(selectedLeg) : "対象脚未選択"}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {execution.confirmed ? "確認済み" : "約定情報未確認"}
                      </div>
                    </div>
                    <button
                      className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                      type="button"
                      onClick={() => removeOptionEntryExecution(execution.id)}
                    >
                      削除
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3 xl:grid-cols-4">
                    <Select
                      label="対象脚"
                      value={execution.legId}
                      onChange={(legId) => {
                        const leg = shortExitLegs.find((item) => item.id === legId);
                        updateOptionEntryExecution(execution.id, {
                          legId,
                          contracts: leg?.quantity ?? execution.contracts,
                          fillPriceUSD: leg?.premiumUSD ?? execution.fillPriceUSD,
                        });
                      }}
                      options={shortExitLegs.map((leg) => [leg.id, getOptionLegLabel(leg)])}
                    />
                    <TextInput
                      label="取引日"
                      value={execution.tradeDate}
                      type="date"
                      onChange={(tradeDate) => updateOptionEntryExecution(execution.id, { tradeDate })}
                    />
                    <NumberInput
                      label="約定価格 USD"
                      value={execution.fillPriceUSD}
                      suffix="USD/株"
                      min={0}
                      onChange={(fillPriceUSD) => updateOptionEntryExecution(execution.id, { fillPriceUSD })}
                    />
                    <NumberInput
                      label="数量"
                      value={execution.contracts}
                      suffix="枚"
                      min={0}
                      onChange={(contracts) => updateOptionEntryExecution(execution.id, { contracts })}
                    />
                    {isN ? (
                      <>
                        <NumberInput
                          label="USD手数料"
                          value={execution.commissionUSD ?? 0}
                          suffix="USD"
                          min={0}
                          onChange={(commissionUSD) => updateOptionEntryExecution(execution.id, { commissionUSD })}
                        />
                        <NumberInput
                          label="USDプレミアム"
                          value={usdPremium}
                          suffix="USD"
                          min={0}
                          onChange={(grossPremiumUSD) =>
                            updateOptionEntryExecution(execution.id, {
                              fillPriceUSD: execution.contracts > 0 ? grossPremiumUSD / (100 * execution.contracts) : execution.fillPriceUSD,
                            })
                          }
                        />
                        <NumberInput
                          label="参考為替"
                          value={referenceFxRate}
                          suffix="JPY/USD"
                          min={0}
                          onChange={(referenceFxRateJPY) => updateOptionEntryExecution(execution.id, { referenceFxRateJPY })}
                        />
                        <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                          <div className="text-xs font-semibold text-slate-500">参考JPY換算</div>
                          <div className="numeric-input mt-1 font-bold text-slate-950">{formatJPY(referenceJpy)}</div>
                          <div className="mt-1 text-xs leading-5 text-slate-500">N口座の本体損益はUSDです。</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <NumberInput
                          label="記帳額 JPY"
                          value={execution.brokerBookedAmountJPY ?? Number.NaN}
                          suffix="JPY"
                          onChange={(brokerBookedAmountJPY) => updateOptionEntryExecution(execution.id, { brokerBookedAmountJPY })}
                        />
                        <NumberInput
                          label="プレミアム JPY"
                          value={execution.brokerPremiumJPY ?? Number.NaN}
                          suffix="JPY"
                          onChange={(brokerPremiumJPY) => updateOptionEntryExecution(execution.id, { brokerPremiumJPY })}
                        />
                        <NumberInput
                          label="取引費用 JPY"
                          value={execution.brokerTransactionCostJPY ?? Number.NaN}
                          suffix="JPY"
                          onChange={(brokerTransactionCostJPY) => updateOptionEntryExecution(execution.id, { brokerTransactionCostJPY })}
                        />
                      </>
                    )}
                    <Select
                      label="入力元"
                      value={execution.source}
                      onChange={(source) => updateOptionEntryExecution(execution.id, { source: source as OptionEntryExecution["source"] })}
                      options={[
                        ["manual", "手入力"],
                        ["broker_statement", "取引報告書"],
                        ["saxo_api_estimate", "Saxo API推定"],
                      ]}
                    />
                    <label className="xl:col-span-3">
                      <span className="text-xs font-semibold text-slate-600">メモ</span>
                      <textarea
                        className="mt-1 h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-inner focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        value={execution.memo ?? ""}
                        placeholder="注文ID、ポジションID、約定時刻などを残す場合はここに記録します。"
                        onChange={(event) => updateOptionEntryExecution(execution.id, { memo: event.target.value })}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
            {optionEntryExecutions.length === 0 ? (
              <p className="rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-600">
                注文前の建玉では未入力で問題ありません。建玉状態を「建玉中」に変更すると、売り脚ごとの約定確認下書きを作成します。
              </p>
            ) : null}
          </div>
          {optionEntrySummary ? (
            <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
              <div className="font-bold">{optionEntrySummary.basis === "saxo_broker_statement" ? "Saxo実績ベース" : "概算"}</div>
              <div className="mt-1 grid gap-2 md:grid-cols-3">
                <div>
                  {simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "建玉時プレミアム" : "現金反映額 JPY"}:{" "}
                  <span className="numeric-input font-bold">{simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? formatUSD(optionEntrySummary.netPremiumUSD ?? 0) : formatJPY(optionEntrySummary.netPremiumJPY ?? 0)}</span>
                </div>
                <div>取引費用: <span className="numeric-input font-bold">{simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? formatUSD(optionEntrySummary.commissionUSD ?? 0) : formatJPY(optionEntrySummary.transactionCostJPY ?? 0)}</span></div>
                <div>{optionEntryExecutions.every((execution) => execution.confirmed) ? "確認済み" : "約定情報未確認"}</div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="text-sm font-bold text-slate-950">4. 出口ルール</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          ここでは、Saxoに置く出口注文、または手動判断用の利確・損切り基準を決めます。途中決済時の現在価格は、下の反対売買判断に入力します。
        </p>
        <div className="mt-3 grid gap-3">
          {shortExitLegs.map((exitLeg) => {
            const plan = exitOrderPlans.find((item) => item.legId === exitLeg.id) ?? getDefaultExitOrderPlanForLeg(exitLeg);
            const keepPercent = plan.profitTakePremiumKeepPercent ?? 60;
            const brokerOrderType = plan.brokerOrderType ?? "none";
            const manualMode = plan.mode === "manual_only";
            const nakedCall = exitLeg.type === "call" && (exitLeg.callExitIntent === "naked_buyback" || (hasUncoveredCall && callPolicyValue === "naked_buyback"));
            const callCanSell = exitLeg.type === "call" && !nakedCall && simulation.stockPosition?.canSellAtStrike !== false;
            const callKeepStock = exitLeg.type === "call" && !nakedCall && simulation.stockPosition?.canSellAtStrike === false;
            const putAvoidAssignment =
              exitLeg.type === "put" &&
              (exitLeg.putIntent === "avoid_assignment" ||
                exitLeg.putIntent === "do_not_want_to_buy" ||
                exitLeg.putIntent === "cannot_buy");
            const showProfit = !callKeepStock && !nakedCall && (manualMode ? plan.profitTakeEnabled : ["closing_limit", "oco", "ifd", "ifd_oco"].includes(brokerOrderType));
            const showStop = !callKeepStock && !nakedCall && (manualMode ? plan.stopLossEnabled : ["closing_stop", "oco", "ifd_oco"].includes(brokerOrderType));
            const legLabel = `${exitLeg.type === "call" ? "C売り" : "P売り"} ${exitLeg.strikeUSD} ${exitLeg.expiryDate}`;
            if (callCanSell) {
              return (
                <div key={exitLeg.id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="font-bold text-slate-950">{legLabel}</div>
                  <p className="mt-2 leading-6 text-slate-600">
                    株を渡してよい方針のため、通常はC買戻し判断は不要です。株を残したくなった場合だけ、反対売買判断でC買戻し価格を入力してください。
                  </p>
                </div>
              );
            }
            return (
              <div
                key={exitLeg.id}
                className={`rounded-md border bg-white p-3 ${
                  putAvoidAssignment || nakedCall ? "border-amber-300 bg-amber-50/40" : "border-slate-200"
                }`}
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold text-slate-950">{legLabel}</div>
                  <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-slate-500">
                    <span>
                    {nakedCall
                      ? "現物なし・上抜け時は買戻し方針です。逆指値ライン、買戻し価格ライン、許容損失額、判断期限を確認します。"
                      : callKeepStock
                      ? "株を残したい方針のため、C買戻し価格を確認して、株を残すコストを判断します。"
                      : putAvoidAssignment
                        ? "株を取得したくない方針のため、満期放置せず、利確・損切り・満期前判断期限を決めてください。"
                        : "株を取得してもよい方針のため、出口ルール未設定でも注文前NGにはしません。途中で閉じたい場合だけ設定します。"}
                    </span>
                    {putAvoidAssignment || callKeepStock || nakedCall ? (
                      <button
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        type="button"
                        onClick={() => onCloseDecisionAction?.(`close-decision-${exitLeg.type}-${exitLeg.id}`)}
                      >
                        反対売買判断へ
                      </button>
                    ) : null}
                  </div>
                </div>
                {callKeepStock ? (
                  <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm leading-6 text-sky-950">
                    このC売りでは、利確ではなく「株を残すための買戻しコスト確認」として反対売買判断を使います。P売り用の損切りルールや満期前タイムリミットは流用しません。
                  </div>
                ) : null}
                {nakedCall ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
                    現物株を保有せずにコールを売る前提です。株価が想定ラインを上抜けた場合は、逆指値などで買い戻して撤退する方針を確認します。急騰時や時間外の値飛びでは、想定より不利な価格で約定する可能性があります。
                  </div>
                ) : null}
                <div className="grid gap-3 xl:grid-cols-4">
                  {callKeepStock || nakedCall ? null : (
                    <>
                      <Select
                        label="Saxo出口注文の使い方"
                        value={plan.mode}
                        onChange={(mode) => updateExitMode(exitLeg.id, mode as ExitOrderPlanMode)}
                        options={[
                          ["manual_only", "使わない（手動判断）"],
                          ["after_entry_closing_order", "建玉後に決済注文を入れる"],
                          ["attached_entry_exit_order", "新規注文と同時にIFD/OCOを入れる"],
                        ]}
                      />
                      <Select
                        label="Saxo側の注文タイプ"
                        value={plan.brokerOrderType ?? "none"}
                        onChange={(nextType) => updateBrokerOrderType(exitLeg.id, nextType as ExitBrokerOrderType)}
                        options={
                          plan.mode === "attached_entry_exit_order"
                            ? [
                                ["ifd", "IFD"],
                                ["ifd_oco", "IFD-OCO"],
                              ]
                            : plan.mode === "after_entry_closing_order"
                              ? [
                                  ["closing_limit", "決済指値"],
                                  ["closing_stop", "決済逆指値"],
                                  ["oco", "OCO"],
                                ]
                              : [["none", "設定しない"]]
                        }
                      />
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600 xl:col-span-2">
                        {plan.mode === "manual_only"
                          ? "Saxoには出口注文を置かず、この脚のアプリ内判断基準として任意表示します。"
                          : plan.mode === "after_entry_closing_order"
                            ? "この売り脚に対して、あとから決済注文をSaxoに置く想定です。"
                            : "この売り脚の新規注文と同時に、出口注文もSaxoに添付する想定です。"}
                      </div>
                    </>
                  )}
                  {manualMode && !callKeepStock && !nakedCall ? (
                    <>
                      <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                        <input className="mt-1" type="checkbox" checked={plan.profitTakeEnabled} onChange={(event) => updateExitOrderPlan(exitLeg.id, { profitTakeEnabled: event.target.checked })} />
                        <span>
                          <span className="font-semibold text-slate-900">利確ラインを表示する</span>
                          <span className="block text-xs leading-5 text-slate-500">この脚の手動判断基準として使います。</span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                        <input className="mt-1" type="checkbox" checked={plan.stopLossEnabled} onChange={(event) => updateExitOrderPlan(exitLeg.id, { stopLossEnabled: event.target.checked })} />
                        <span>
                          <span className="font-semibold text-slate-900">損切りラインを表示する</span>
                          <span className="block text-xs leading-5 text-slate-500">この脚の手動判断基準として使います。</span>
                        </span>
                      </label>
                    </>
                  ) : null}
                  {showProfit ? (
                    <>
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                        <div className="text-xs font-semibold text-slate-500">利確買戻し価格</div>
                        <div className="numeric-input mt-1 text-lg font-bold text-slate-950">${calculateProfitTakeBuybackPriceUSD(exitLeg.premiumUSD, keepPercent).toFixed(2)}</div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">建てプレミアム {exitLeg.premiumUSD.toFixed(2)} USD × {(100 - keepPercent).toFixed(0)}%</div>
                      </div>
                      <Select
                        label="利確ルール"
                        value={[50, 60, 80].includes(keepPercent) ? String(keepPercent) : "custom"}
                        onChange={(value) => {
                          if (value !== "custom") updateExitOrderPlan(exitLeg.id, { profitTakePremiumKeepPercent: Number(value) });
                        }}
                        options={[
                          ["50", "プレミアム50%確保"],
                          ["60", "プレミアム60%確保"],
                          ["80", "プレミアム80%確保"],
                          ["custom", "任意%"],
                        ]}
                      />
                      <NumberInput label="任意の確保率" value={keepPercent} suffix="%" min={0} onChange={(profitTakePremiumKeepPercent) => updateExitOrderPlan(exitLeg.id, { profitTakePremiumKeepPercent })} />
                    </>
                  ) : null}
                  {callKeepStock || nakedCall ? null : (
                    <NumberInput label="満期何日前までに判断" value={plan.latestCloseDaysBeforeExpiry ?? 7} suffix="日前" min={0} onChange={(latestCloseDaysBeforeExpiry) => updateExitOrderPlan(exitLeg.id, { latestCloseDaysBeforeExpiry, latestCloseDaysBeforeExpiryUserSet: true })} />
                  )}
                  {nakedCall ? (
                    <>
                      <NumberInput
                        label="逆指値ライン"
                        value={exitLeg.hedgeBuyStopUSD ?? 0}
                        suffix="USD"
                        min={0}
                        onChange={(hedgeBuyStopUSD) => updateLeg(exitLeg.id, { hedgeBuyStopUSD })}
                      />
                      <NumberInput
                        label="買戻し価格ライン"
                        value={plan.stopLossBuybackPriceUSD ?? 0}
                        suffix="USD/株"
                        min={0}
                        onChange={(stopLossBuybackPriceUSD) =>
                          updateExitOrderPlan(exitLeg.id, {
                            stopLossEnabled: true,
                            stopLossType: "buyback_price",
                            stopLossBuybackPriceUSD,
                          })
                        }
                      />
                      <NumberInput
                        label="許容損失額"
                        value={simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? plan.stopLossAmountUSD ?? 0 : plan.stopLossAmountJPY ?? 0}
                        suffix={simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "USD" : "JPY"}
                        min={0}
                        onChange={(stopLossAmount) =>
                          updateExitOrderPlan(exitLeg.id, {
                            stopLossEnabled: true,
                            stopLossAmountCurrency: simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "USD" : "JPY",
                            ...(simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
                              ? { stopLossAmountUSD: stopLossAmount }
                              : { stopLossAmountJPY: stopLossAmount }),
                          })
                        }
                      />
                      <NumberInput
                        label="満期何日前までに判断"
                        value={plan.latestCloseDaysBeforeExpiry ?? 7}
                        suffix="日前"
                        min={0}
                        onChange={(latestCloseDaysBeforeExpiry) => updateExitOrderPlan(exitLeg.id, { latestCloseDaysBeforeExpiry, latestCloseDaysBeforeExpiryUserSet: true })}
                      />
                      <label className="xl:col-span-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                        <input
                          className="mt-1"
                          type="checkbox"
                          checked={exitLeg.nakedCallRiskAcknowledged ?? false}
                          onChange={(event) => updateLeg(exitLeg.id, { nakedCallRiskAcknowledged: event.target.checked })}
                        />
                        <span>
                          <span className="font-semibold text-amber-950">ギャップ・流動性不足による不利約定の可能性を確認した</span>
                          <span className="block text-xs leading-5 text-amber-900">逆指値を置いても、急騰時や時間外の値飛びでは想定より不利な価格で約定する可能性があります。</span>
                        </span>
                      </label>
                    </>
                  ) : null}
                  {showStop ? (
                    <>
                      <Select
                        label="損切りルール種別"
                        value={plan.stopLossType ?? "buyback_price"}
                        onChange={(stopLossType) => updateExitOrderPlan(exitLeg.id, { stopLossType: stopLossType as ExitStopLossType })}
                        options={[
                          ["buyback_price", "買戻し価格"],
                          ["stock_price_line", "株価ライン"],
                          ["loss_amount", "損失額"],
                        ]}
                      />
                      <NumberInput
                        label={plan.stopLossType === "stock_price_line" ? "損切り株価ライン" : plan.stopLossType === "loss_amount" ? "損切り損失額" : "損切り買戻し価格"}
                        value={plan.stopLossType === "stock_price_line" ? plan.stopLossStockPriceUSD ?? 0 : plan.stopLossType === "loss_amount" ? (simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? plan.stopLossAmountUSD ?? 0 : plan.stopLossAmountJPY ?? 0) : plan.stopLossBuybackPriceUSD ?? 0}
                        suffix={plan.stopLossType === "loss_amount" ? (simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "USD" : "JPY") : plan.stopLossType === "stock_price_line" ? "USD" : "USD/株"}
                        min={0}
                        onChange={(value) =>
                          updateExitOrderPlan(
                            exitLeg.id,
                            plan.stopLossType === "stock_price_line"
                              ? { stopLossStockPriceUSD: value }
                              : plan.stopLossType === "loss_amount"
                                ? simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
                                  ? { stopLossAmountUSD: value, stopLossAmountCurrency: "USD" }
                                  : { stopLossAmountJPY: value, stopLossAmountCurrency: "JPY" }
                                : { stopLossBuybackPriceUSD: value },
                          )
                        }
                      />
                    </>
                  ) : null}
                  <label className="xl:col-span-2">
                    <span className="text-xs font-semibold text-slate-600">Saxo決済注文メモ</span>
                    <textarea
                      className="mt-1 h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-inner focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      value={plan.memo ?? ""}
                      placeholder="例: この脚だけIFD-OCOで利確0.20 USD、損切り買戻し2.00 USD"
                      onChange={(event) => updateExitOrderPlan(exitLeg.id, { memo: event.target.value })}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="text-sm font-bold text-slate-950">5. 表示・比較設定</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          年率計算の分母と、NISA等の非課税口座と比較するための前提を設定します。
        </p>
        <div className="mt-3 grid gap-3 xl:grid-cols-4">
          <Select
            label="主分母"
            value={simulation.denominatorMode}
            onChange={(denominatorMode) => update({ denominatorMode: denominatorMode as DenominatorMode })}
            options={[
              ["broker_margin_only", "証拠金のみ"],
              ["stock_plus_margin", "現物株＋使用証拠金"],
              ["cash_secured", "キャッシュセキュアード"],
              ["conservative_common", "保守的共通分母"],
            ]}
          />
          <NumberInput
            label="NISA等 比較年率"
            value={simulation.nisaExpectedAnnualReturnPct ?? DEFAULT_NISA_EXPECTED_ANNUAL_RETURN_PCT}
            suffix="%"
            onChange={(nisaExpectedAnnualReturnPct) => update({ nisaExpectedAnnualReturnPct })}
          />
        </div>
      </div>

      <div id="stock-acquisition-record" className={`mt-4 rounded-lg border bg-white p-3 ${highlightedAnchorId === "stock-acquisition-record" ? "border-amber-400 ring-2 ring-amber-200" : "border-slate-200"}`}>
        {hasMultipleAssignedRecords ? (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-950">
            複数の実績入力が必要です。P脚の株式取得記録とC脚の株式譲渡記録をそれぞれ確認してください。
          </div>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-950">6-A. 現物株の取得記録</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              P売りが権利行使された場合に、株式を買い受けた記録を入力します。株式取得は売却ではないため、この時点では上場株式等の譲渡損益を確定しません。
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={stockAcquisition.enabled}
              onChange={(event) => updateStockAcquisition({ enabled: event.target.checked })}
            />
            現物株の取得を記録する
          </label>
        </div>
        {stockAcquisition.enabled ? (
          <div className="mt-3 grid gap-3 xl:grid-cols-4">
            <TextInput
              label="取得日"
              value={stockAcquisition.acquisitionDate}
              type="date"
              onChange={(acquisitionDate) => updateStockAcquisition({ acquisitionDate })}
            />
            <NumberInput
              label="取得株数"
              value={stockAcquisition.shares}
              suffix="株"
              min={0}
              onChange={(shares) => updateStockAcquisition({ shares })}
            />
            <NumberInput
              label="取得単価"
              value={stockAcquisition.priceUSD}
              suffix="USD"
              min={0}
              onChange={(priceUSD) => updateStockAcquisition({ priceUSD })}
            />
            <Select
              label="口座分類"
              value={stockAcquisition.accountEnvironment}
              onChange={(accountEnvironment) => updateStockAcquisition({ accountEnvironment: accountEnvironment as TradeSimulation["accountEnvironment"] })}
              options={[
                ["DEMO_JPY_BASE", "DEMO / JPYベース"],
                ["PROD_P_JPY_SETTLEMENT", "本番P口座 / JPY決済"],
                ["PROD_N_USD_SETTLEMENT", "本番N口座 / USD決済"],
              ]}
            />
            <NumberInput
              label="取得手数料 USD"
              value={stockAcquisition.commissionUSD ?? Number.NaN}
              suffix="USD"
              min={0}
              onChange={(commissionUSD) => updateStockAcquisition({ commissionUSD })}
            />
            <NumberInput
              label="取得手数料 JPY"
              value={stockAcquisition.commissionJPY ?? Number.NaN}
              suffix="JPY"
              min={0}
              onChange={(commissionJPY) => updateStockAcquisition({ commissionJPY })}
            />
            <Select
              label="入力元"
              value={stockAcquisition.source}
              onChange={(source) => updateStockAcquisition({ source: source as NonNullable<TradeSimulation["stockAcquisition"]>["source"] })}
              options={[
                ["manual", "手入力"],
                ["broker_statement", "取引報告書"],
                ["saxo_api_estimate", "Saxo API推定"],
              ]}
            />
            <label className="xl:col-span-4">
              <span className="text-xs font-semibold text-slate-600">メモ</span>
              <textarea
                className="mt-1 h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-inner focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                value={stockAcquisition.memo ?? ""}
                placeholder="P売り権利行使、Saxo履歴との照合メモなど"
                onChange={(event) => updateStockAcquisition({ memo: event.target.value })}
              />
            </label>
          </div>
        ) : (
          <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-600">
            P売りの権利行使で株を買い受けた場合だけONにします。株を売却するまでは譲渡損益として扱いません。
          </p>
        )}
      </div>

      <div id="stock-settlement-record" className={`mt-4 rounded-lg border bg-white p-3 ${highlightedAnchorId === "stock-settlement-record" ? "border-amber-400 ring-2 ring-amber-200" : "border-slate-200"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-950">6-B. 現物株の譲渡記録</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              カバードコールで株を渡した、または現物株を売却した場合だけ入力します。オプション損益とは別に「上場株式等の譲渡所得等」として表示します。
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={stockSettlement.enabled}
              onChange={(event) => updateStockSettlement({ enabled: event.target.checked })}
            />
            現物株の譲渡を記録する
          </label>
        </div>
        {stockSettlement.enabled ? (
          <div className="mt-3 grid gap-3 xl:grid-cols-4">
            <Select
              label="譲渡の種類"
              value={stockSettlement.kind}
              onChange={(kind) => updateStockSettlement({ kind: kind as NonNullable<TradeSimulation["stockSettlement"]>["kind"] })}
              options={[
                ["manual_sale", "通常の現物売却"],
                ["covered_call_assignment", "C権利行使で株を渡した"],
                ["other", "その他"],
              ]}
            />
            <TextInput
              label="譲渡日"
              value={stockSettlement.settlementDate}
              type="date"
              onChange={(settlementDate) => updateStockSettlement({ settlementDate })}
            />
            <NumberInput
              label="譲渡株数"
              value={stockSettlement.shares}
              suffix="株"
              min={0}
              onChange={(shares) => updateStockSettlement({ shares })}
            />
            <NumberInput
              label="売却単価"
              value={stockSettlement.sellPriceUSD}
              suffix="USD"
              min={0}
              onChange={(sellPriceUSD) => updateStockSettlement({ sellPriceUSD })}
            />
            <NumberInput
              label="取得単価"
              value={stockSettlement.costBasisUSD}
              suffix="USD"
              min={0}
              onChange={(costBasisUSD) => updateStockSettlement({ costBasisUSD })}
            />
            <NumberInput
              label="譲渡時為替"
              value={stockSettlement.fxRateJPY ?? simulation.fxRateJPY}
              suffix="JPY/USD"
              min={0}
              onChange={(fxRateJPY) => updateStockSettlement({ fxRateJPY })}
            />
            <NumberInput
              label="売却手数料"
              value={stockSettlement.commissionUSD ?? 0}
              suffix="USD"
              min={0}
              onChange={(commissionUSD) => updateStockSettlement({ commissionUSD })}
            />
            <NumberInput
              label="売却手数料"
              value={stockSettlement.commissionJPY ?? 0}
              suffix="JPY"
              min={0}
              onChange={(commissionJPY) => updateStockSettlement({ commissionJPY })}
            />
          </div>
        ) : (
          <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-600">
            現物株を売却していない建玉ではOFFのままで問題ありません。OFFの場合、税務区分別の「上場株式等の譲渡所得等」は未集計として表示されます。
          </p>
        )}
      </div>

      {showOptionCloseExecutions ? (
        <div id="option-close-executions" className={`mt-4 rounded-lg border bg-white p-3 ${highlightedAnchorId === "option-close-executions" ? "border-amber-400 ring-2 ring-amber-200" : "border-slate-200"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-950">7. 決済実績</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Saxoで買い決済・売り決済が実際に約定した後、注文履歴を見ながら入力します。反対売買判断の見積もり価格は自動では実績扱いしません。
              </p>
            </div>
            {shortExitLegs.length > 0 ? (
              <button
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                onClick={() => addOptionCloseExecution(shortExitLegs[0])}
              >
                決済実績を追加
              </button>
            ) : null}
          </div>
          {simulation.status === "closed" && optionCloseExecutions.length === 0 ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-950">
              決済済みですが、決済実績が未入力です。Saxo注文履歴から約定価格と手数料を入力してください。
            </div>
          ) : null}
          <div className="mt-3 grid gap-3">
            {optionCloseExecutions.map((execution) => {
              const result = optionCloseResults.find((item) => item.execution.id === execution.id);
              const selectedLeg = shortExitLegs.find((leg) => leg.id === execution.legId) ?? shortExitLegs[0];
              const isExpiredExecution = execution.closeKind === "expired";
              const isNCloseExecution = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
              const closeFxRate = execution.fxRateJPY ?? execution.brokerExchangeRateJPY ?? simulation.referenceFxRateJPY ?? simulation.fxRateJPY;
              const closeUsdPnl =
                execution.realizedPnlUSD ??
                (selectedLeg
                  ? selectedLeg.premiumUSD * 100 * execution.contracts - (execution.closePriceUSD ?? 0) * 100 * execution.contracts - (execution.commissionUSD ?? 0)
                  : 0);
              const closeReferenceJpy = closeUsdPnl * closeFxRate;
              const closeDetailCostTotal =
                Math.abs(execution.brokerFeeJPY ?? 0) +
                Math.abs(execution.brokerExchangeFeeJPY ?? 0) +
                Math.abs(execution.brokerExchangeTradeFeeJPY ?? 0) +
                Math.abs(execution.brokerTaxIncludedFeeJPY ?? 0);
              const closeCostMismatch =
                !isNCloseExecution &&
                execution.brokerTransactionCostJPY !== undefined &&
                closeDetailCostTotal > 0 &&
                Math.abs(Math.abs(execution.brokerTransactionCostJPY) - closeDetailCostTotal) > 50;
              return (
                <div key={execution.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-bold text-slate-950">
                      {selectedLeg ? getOptionLegLabel(selectedLeg) : "対象脚未選択"}
                    </div>
                    <button
                      className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                      onClick={() => removeOptionCloseExecution(execution.id)}
                    >
                      削除
                    </button>
                  </div>
                  {isExpiredExecution ? (
                    <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm font-semibold text-sky-950">
                      満期終了モード: 買戻し約定ではないため、約定価格USDは入力しません。受取プレミアムから建て時手数料を引いた実績として扱います。
                    </div>
                  ) : null}
                  {isNCloseExecution ? (
                    <div className="mt-3 grid gap-3 xl:grid-cols-4">
                      <Select
                        label="対象脚"
                        value={execution.legId}
                        onChange={(legId) => {
                          const leg = shortExitLegs.find((item) => item.id === legId);
                          updateOptionCloseExecution(execution.id, {
                            legId,
                            contracts: leg?.quantity ?? execution.contracts,
                          });
                        }}
                        options={shortExitLegs.map((leg) => [leg.id, getOptionLegLabel(leg)])}
                      />
                      <TextInput
                        label="決済日"
                        value={execution.closeDate}
                        type="date"
                        onChange={(closeDate) => updateOptionCloseExecution(execution.id, { closeDate })}
                      />
                      <NumberInput
                        label="約定数量"
                        value={execution.contracts}
                        suffix="枚"
                        min={0}
                        onChange={(contracts) => updateOptionCloseExecution(execution.id, { contracts })}
                      />
                      {isExpiredExecution ? null : (
                        <NumberInput
                          label="約定価格 USD"
                          value={execution.closePriceUSD ?? Number.NaN}
                          suffix="USD/株"
                          min={0}
                          onChange={(closePriceUSD) => updateOptionCloseExecution(execution.id, { closePriceUSD })}
                        />
                      )}
                      <NumberInput
                        label={isExpiredExecution ? "満期終了時手数料 USD" : "USD手数料"}
                        value={execution.commissionUSD ?? 0}
                        suffix="USD"
                        min={0}
                        onChange={(commissionUSD) => updateOptionCloseExecution(execution.id, { commissionUSD })}
                      />
                      <NumberInput
                        label="USD実現損益"
                        value={execution.realizedPnlUSD ?? Number.NaN}
                        suffix="USD"
                        onChange={(realizedPnlUSD) => updateOptionCloseExecution(execution.id, { realizedPnlUSD })}
                      />
                      <NumberInput
                        label="参考為替"
                        value={closeFxRate}
                        suffix="JPY/USD"
                        min={0}
                        onChange={(fxRateJPY) => updateOptionCloseExecution(execution.id, { fxRateJPY })}
                      />
                      <div className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                        <div className="text-xs font-semibold text-slate-500">参考JPY換算</div>
                        <div className="numeric-input mt-1 font-bold text-slate-950">{formatJPY(closeReferenceJpy, { signed: true })}</div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">N口座の本体損益はUSDです。</div>
                      </div>
                      <Select
                        label="入力元"
                        value={execution.source}
                        onChange={(source) => updateOptionCloseExecution(execution.id, { source: source as OptionCloseExecution["source"] })}
                        options={[
                          ["manual", "手入力"],
                          ["broker_statement", "取引報告書"],
                          ["saxo_api_estimate", "Saxo API推定"],
                        ]}
                      />
                      <label className="xl:col-span-4">
                        <span className="text-xs font-semibold text-slate-600">メモ</span>
                        <textarea
                          className="mt-1 h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-inner focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          value={execution.memo ?? ""}
                          placeholder="Saxo注文履歴の補足、部分決済、注文ID、ポジションID、決済時刻など"
                          onChange={(event) => updateOptionCloseExecution(execution.id, { memo: event.target.value })}
                        />
                      </label>
                    </div>
                  ) : (
                    <>
                      <div className="mt-3 grid gap-3 xl:grid-cols-3">
                        <TextInput
                          label="決済日 / 取引日"
                          value={execution.closeDate}
                          type="date"
                          onChange={(closeDate) => updateOptionCloseExecution(execution.id, { closeDate })}
                        />
                        {isExpiredExecution ? null : (
                          <NumberInput
                            label="約定価格 USD"
                            value={execution.closePriceUSD ?? Number.NaN}
                            suffix="USD/株"
                            min={0}
                            onChange={(closePriceUSD) => updateOptionCloseExecution(execution.id, { closePriceUSD })}
                          />
                        )}
                        <NumberInput
                          label="Saxo実現損益 JPY"
                          inputId="broker-realized-pnl-jpy"
                          value={execution.brokerRealizedPnlJPY ?? Number.NaN}
                          suffix="JPY"
                          onChange={(brokerRealizedPnlJPY) => updateOptionCloseExecution(execution.id, { brokerRealizedPnlJPY })}
                        />
                      </div>
                      <details className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-sm">
                        <summary className="cursor-pointer font-bold text-slate-700">照合用の詳細を開く</summary>
                        <div className="mt-3 grid gap-3 xl:grid-cols-4">
                          {shortExitLegs.length > 1 ? (
                            <Select
                              label="対象脚"
                              value={execution.legId}
                              onChange={(legId) => {
                                const leg = shortExitLegs.find((item) => item.id === legId);
                                updateOptionCloseExecution(execution.id, {
                                  legId,
                                  contracts: leg?.quantity ?? execution.contracts,
                                });
                              }}
                              options={shortExitLegs.map((leg) => [leg.id, getOptionLegLabel(leg)])}
                            />
                          ) : null}
                          <NumberInput
                            label="数量変更（部分決済時だけ）"
                            value={execution.contracts}
                            suffix="枚"
                            min={0}
                            onChange={(contracts) => updateOptionCloseExecution(execution.id, { contracts })}
                          />
                          <NumberInput
                            label="記帳額 JPY"
                            value={execution.brokerBookedAmountJPY ?? Number.NaN}
                            suffix="JPY"
                            onChange={(brokerBookedAmountJPY) => updateOptionCloseExecution(execution.id, { brokerBookedAmountJPY })}
                          />
                          <NumberInput
                            label="取引費用 JPY"
                            value={execution.brokerTransactionCostJPY ?? Number.NaN}
                            suffix="JPY"
                            onChange={(brokerTransactionCostJPY) => updateOptionCloseExecution(execution.id, { brokerTransactionCostJPY })}
                          />
                          <NumberInput
                            label="為替レート"
                            value={execution.brokerExchangeRateJPY ?? simulation.fxRateJPY}
                            suffix="JPY/USD"
                            min={0}
                            onChange={(brokerExchangeRateJPY) => updateOptionCloseExecution(execution.id, { brokerExchangeRateJPY })}
                          />
                          <Select
                            label="入力元"
                            value={execution.source}
                            onChange={(source) => updateOptionCloseExecution(execution.id, { source: source as OptionCloseExecution["source"] })}
                            options={[
                              ["manual", "手入力"],
                              ["broker_statement", "取引報告書"],
                              ["saxo_api_estimate", "Saxo API推定"],
                            ]}
                          />
                          <label className="xl:col-span-4">
                            <span className="text-xs font-semibold text-slate-600">メモ</span>
                            <textarea
                              className="mt-1 h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-inner focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                              value={execution.memo ?? ""}
                              placeholder="注文ID、ポジションID、取引番号、決済時刻、部分決済の補足など"
                              onChange={(event) => updateOptionCloseExecution(execution.id, { memo: event.target.value })}
                            />
                          </label>
                          <details className="xl:col-span-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                            <summary className="cursor-pointer font-bold text-slate-700">費用内訳を個別に記録する</summary>
                            <div className="mt-3 grid gap-3 xl:grid-cols-4">
                              <NumberInput
                                label="プレミアム JPY"
                                value={execution.brokerPremiumJPY ?? Number.NaN}
                                suffix="JPY"
                                onChange={(brokerPremiumJPY) => updateOptionCloseExecution(execution.id, { brokerPremiumJPY })}
                              />
                              <NumberInput
                                label="手数料 JPY"
                                value={execution.brokerFeeJPY ?? Number.NaN}
                                suffix="JPY"
                                onChange={(brokerFeeJPY) => updateOptionCloseExecution(execution.id, { brokerFeeJPY })}
                              />
                              <NumberInput
                                label="為替変換手数料 JPY"
                                value={execution.brokerExchangeFeeJPY ?? Number.NaN}
                                suffix="JPY"
                                onChange={(brokerExchangeFeeJPY) => updateOptionCloseExecution(execution.id, { brokerExchangeFeeJPY })}
                              />
                              <NumberInput
                                label="取引所手数料 JPY"
                                value={execution.brokerExchangeTradeFeeJPY ?? Number.NaN}
                                suffix="JPY"
                                onChange={(brokerExchangeTradeFeeJPY) => updateOptionCloseExecution(execution.id, { brokerExchangeTradeFeeJPY })}
                              />
                              <NumberInput
                                label="手数料・消費税額 JPY"
                                value={execution.brokerTaxIncludedFeeJPY ?? Number.NaN}
                                suffix="JPY"
                                onChange={(brokerTaxIncludedFeeJPY) => updateOptionCloseExecution(execution.id, { brokerTaxIncludedFeeJPY })}
                              />
                            </div>
                          </details>
                        </div>
                      </details>
                    </>
                  )}
                  {closeCostMismatch ? (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-950">
                      取引費用JPYと手数料内訳JPYの合計が大きくずれています。集計には取引費用JPYを優先します。
                    </div>
                  ) : null}
                  {result ? (
                    <div className="mt-3 grid gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950 md:grid-cols-3">
                      <div>
                        <div className="text-xs font-semibold">実現損益</div>
                        <div className="numeric-input font-bold">
                          {result.currency === "USD"
                            ? `${formatUSD(result.realizedPnlUSD)} / 参考 ${formatJPY(result.realizedPnlJPY, { signed: true })}`
                            : formatJPY(result.realizedPnlJPY, { signed: true })}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold">実績年率</div>
                        <div className="numeric-input font-bold">{formatPct(result.annualReturnPct)}（{result.holdingDays}日）</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold">計算内訳</div>
                        <div className="text-xs leading-5">
                          {!isNCloseExecution && result.basis === "saxo_broker_statement" ? (
                            <>
                              Saxo実績ベース / 実現損益 {formatJPY(result.realizedPnlJPY, { signed: true })}を採用
                              <br />
                              参考: 記帳額 {execution.brokerBookedAmountJPY === undefined ? "-" : formatJPY(execution.brokerBookedAmountJPY, { signed: true })} / 取引費用{" "}
                              {execution.brokerTransactionCostJPY === undefined ? "-" : formatJPY(execution.brokerTransactionCostJPY, { signed: true })} / 為替{" "}
                              {execution.brokerExchangeRateJPY === undefined ? "-" : execution.brokerExchangeRateJPY.toFixed(6)}
                            </>
                          ) : (
                            <>
                              {result.basis === "saxo_broker_statement" ? "Saxo実績ベース" : "概算"} / プレミアム {formatUSD(result.entryPremiumUSD)} - 買戻し {formatUSD(result.closeCostUSD)} - 手数料 {formatUSD(result.openCommissionUSD + result.closeCommissionUSD)}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                      {isNCloseExecution
                        ? "対象脚、約定数量、約定価格USD、USD手数料を確認してください。"
                        : "決済日、約定価格USD、Saxo実現損益JPYを確認してください。"}
                    </div>
                  )}
                </div>
              );
            })}
            {optionCloseExecutions.length === 0 && simulation.status !== "closed" ? (
              <p className="rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-600">
                決済前の建玉では未入力で問題ありません。Saxoで実際に決済が約定した後に入力します。
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function getOptionLegLabel(leg: OptionLeg): string {
  return `${leg.type === "call" ? "C売り" : "P売り"} ${leg.strikeUSD} / ${leg.expiryDate} / ${leg.quantity}枚`;
}

function isLikelyNextStatus(current: SimulationStatus, next: SimulationStatus): boolean {
  if (current === next) return true;
  if (current === "planned") return next === "open";
  if (current === "open") return ["closed", "assigned", "expired"].includes(next);
  return false;
}

function getStatusWorkflowNotice(previousStatus: SimulationStatus, nextStatus: SimulationStatus): { message: string; actionLabel: string; anchorId: string } | null {
  if (previousStatus === nextStatus) return null;
  if (previousStatus === "planned" && nextStatus === "open") {
    return {
      message: "建玉中に変更しました。次にSaxoの取引履歴を見ながら約定情報を確認してください。",
      actionLabel: "約定確認へ進む",
      anchorId: "option-entry-executions",
    };
  }
  if (previousStatus === "open" && nextStatus === "closed") {
    return {
      message: "決済済みに変更しました。次にSaxoの注文履歴から決済実績を入力してください。",
      actionLabel: "決済実績へ進む",
      anchorId: "option-close-executions",
    };
  }
  if (previousStatus === "open" && nextStatus === "assigned") {
    return {
      message: "権利行使済みに変更しました。必要な株式取得または譲渡の記録を入力してください。",
      actionLabel: "実績記録へ進む",
      anchorId: "stock-acquisition-record",
    };
  }
  if (previousStatus === "open" && nextStatus === "expired") {
    return {
      message: "満期終了に変更しました。買戻しなしでプレミアムが確定した履歴を確認してください。",
      actionLabel: "満期終了履歴へ進む",
      anchorId: "option-close-executions",
    };
  }
  return null;
}

function TextInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <input
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-600"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <select
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-600"
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
      >
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>
            {labelText}
          </option>
        ))}
      </select>
    </label>
  );
}
