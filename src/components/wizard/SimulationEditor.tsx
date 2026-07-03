import type { ChangeEvent } from "react";
import { useEffect, useState } from "react";
import { JapaneseYen, RotateCw } from "lucide-react";
import type { DenominatorMode, ExitBrokerOrderType, ExitOrderPlan, ExitOrderPlanMode, ExitStopLossType, OptionCloseExecution, OptionEntryExecution, OptionLeg, PutIntent, SimulationStatus, StockTransferEvent, StrategyType, TradeSimulation } from "@/types/domain";
import { DEFAULT_NISA_EXPECTED_ANNUAL_RETURN_PCT, type WorkspaceMode } from "@/store/useOptionsStore";
import { calculateDte, getShortOptionLegs } from "@/domain/calculations";
import { calculateProfitTakeBuybackPriceUSD, getDefaultExitOrderPlanForLeg, getExitOrderPlanForLeg, normalizeExitOrderPlans } from "@/domain/exitOrderPlan";
import { calculateOptionEntryExecutionSummary, createOptionEntryExecutionDraft } from "@/domain/optionEntryExecutions";
import {
  calculateOptionCloseExecutionResults,
  createOptionCloseExecutionDraft,
  hasConfirmedBuybackCloseExecution,
  hasConfirmedExpiredCloseExecution,
  hasUnconfirmedCloseExecutionDraft,
  validateSaxoHistoryCloseExecution,
} from "@/domain/optionCloseExecutions";
import { calculateStockSettlementTaxResult } from "@/domain/tax";
import { createJournalForSimulation } from "@/domain/entryRationaleJournal";
import { getStatusLabel } from "@/domain/strategyLabels";
import { EntryRationaleJournalPanel } from "@/components/journal/EntryRationaleJournalPanel";
import { NumberInput } from "@/components/ui/NumberInput";
import { isSaxoHistoryMatchingOptionLeg, parseSaxoOptionContract, type SaxoHistoryDiscoveryItem } from "@/features/saxo/saxoAccountSync";
import { formatLocalDate } from "@/lib/date";
import { formatJPY, formatPct, formatUSD } from "@/lib/format";
import { fetchStooqQuote, fetchUsdJpyRate, normalizeTicker } from "@/lib/marketData";

type SimulationEditorProps = {
  simulation: TradeSimulation;
  workspace: WorkspaceMode;
  canUseExternalQuotes: boolean;
  externalQuoteModeLabel: string;
  onChange: (simulation: TradeSimulation) => void;
  saxoHistoryCandidates?: SaxoHistoryDiscoveryItem[];
  onDiscardDraft?: (simulationId: string) => void;
  onCloseDecisionAction?: (anchorId: string) => void;
  onCloseEditor?: () => void;
  onStockAcquisitionCompleteClose?: () => void;
  onOpenPerformance?: () => void;
  onReturnToSaxoHistory?: () => void;
  onRecreateSaxoHistoryCandidate?: (sourceTradeId?: string) => void;
  stockTransfer?: StockTransferEvent;
  focusRequest?: { anchorId: string; requestId: number; saxoHistoryIssue?: "missing-close-candidate"; sourceTradeId?: string } | null;
};

export function SimulationEditor({ simulation, workspace, canUseExternalQuotes, externalQuoteModeLabel, onChange, saxoHistoryCandidates = [], onDiscardDraft, onCloseDecisionAction, onCloseEditor, onStockAcquisitionCompleteClose, onOpenPerformance, onReturnToSaxoHistory, onRecreateSaxoHistoryCandidate, stockTransfer, focusRequest }: SimulationEditorProps) {
  const [quoteStatus, setQuoteStatus] = useState<string>("");
  const [workflowNotice, setWorkflowNotice] = useState<{ message: string; actionLabel: string; anchorId: string } | null>(null);
  const [highlightedAnchorId, setHighlightedAnchorId] = useState<string | null>(null);
  const [entryCandidatePickerId, setEntryCandidatePickerId] = useState<string | null>(null);
  const [isJournalOpen, setIsJournalOpen] = useState(false);
  const callLeg = simulation.optionLegs.find((leg) => leg.type === "call");
  const putLeg = simulation.optionLegs.find((leg) => leg.type === "put");
  const needsCall = ["covered_call", "covered_call_plus_short_put", "short_strangle", "wheel", "long_call"].includes(
    simulation.strategyType,
  );
  const needsPut = ["short_put", "covered_call_plus_short_put", "short_strangle", "wheel", "long_put"].includes(
    simulation.strategyType,
  );
  const needsStock = ["covered_call", "covered_call_plus_short_put", "short_strangle", "wheel"].includes(
    simulation.strategyType,
  );
  const needsBrokerMarginInput = ["short_put", "covered_call_plus_short_put", "short_strangle", "wheel", "custom"].includes(
    simulation.strategyType,
  );
  const defaultEventDate = formatLocalDate();
  const defaultStockSettlement = {
    enabled: false,
    kind: "manual_sale" as const,
    settlementDate: defaultEventDate,
    shares: simulation.stockPosition?.shares ?? 100,
    sellPriceUSD: callLeg?.strikeUSD || simulation.currentPriceUSD,
    costBasisUSD: simulation.stockPosition?.averageCostUSD ?? simulation.currentPriceUSD,
    fxRateJPY: simulation.fxRateJPY,
    commissionUSD: 0,
    commissionJPY: 0,
  };
  const stockSettlement = simulation.stockSettlement ?? defaultStockSettlement;
  const defaultStockAcquisition: NonNullable<TradeSimulation["stockAcquisition"]> = {
    enabled: false,
    acquisitionDate: defaultEventDate,
    shares: (putLeg?.quantity ?? 1) * 100,
    priceUSD: putLeg?.strikeUSD ?? simulation.currentPriceUSD,
    accountEnvironment: simulation.accountEnvironment,
    commissionUSD: undefined,
    commissionJPY: undefined,
    source: "manual" as const,
    memo: "",
  };
  const stockAcquisition = simulation.stockAcquisition ?? defaultStockAcquisition;
  const stockAcquisitionComplete =
    simulation.status === "assigned" &&
    stockAcquisition.enabled &&
    Number.isFinite(stockAcquisition.shares) &&
    stockAcquisition.shares > 0 &&
    Number.isFinite(stockAcquisition.priceUSD) &&
    stockAcquisition.priceUSD > 0;
  const stockSettlementComplete =
    stockSettlement.enabled &&
    Boolean(stockSettlement.settlementDate) &&
    Number.isFinite(stockSettlement.shares) &&
    stockSettlement.shares > 0 &&
    Number.isFinite(stockSettlement.sellPriceUSD) &&
    stockSettlement.sellPriceUSD > 0 &&
    Number.isFinite(stockSettlement.costBasisUSD) &&
    stockSettlement.costBasisUSD > 0;
  const stockSettlementRealizedPnlUSD =
    (stockSettlement.sellPriceUSD - stockSettlement.costBasisUSD) * stockSettlement.shares - (stockSettlement.commissionUSD ?? 0);
  const stockSettlementTaxResult = calculateStockSettlementTaxResult({
    ...simulation,
    stockSettlement,
  });

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
    const normalizedPatch =
      patch.commissionUSD === undefined
        ? patch
        : {
            ...patch,
            commissionUSD: Math.round(patch.commissionUSD * 100) / 100,
          };
    update({
      stockSettlement: {
        ...defaultStockSettlement,
        ...stockSettlement,
        ...normalizedPatch,
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
  const closeAfterStockAcquisitionReview = () => {
    if (stockAcquisitionComplete && stockAcquisition.confirmationStatus !== "confirmed") {
      updateStockAcquisition({ confirmationStatus: "confirmed" });
    }
    (stockAcquisitionComplete ? onStockAcquisitionCompleteClose ?? onCloseEditor : onCloseEditor)?.();
  };
  const updateStrategy = (strategyType: StrategyType) => {
    const nextNeedsCall = ["covered_call", "covered_call_plus_short_put", "short_strangle", "wheel", "long_call"].includes(
      strategyType,
    );
    const nextNeedsPut = ["short_put", "covered_call_plus_short_put", "short_strangle", "wheel", "long_put"].includes(
      strategyType,
    );
    const nextNeedsStock = ["covered_call", "covered_call_plus_short_put", "short_strangle", "wheel"].includes(
      strategyType,
    );
    const callSide: OptionLeg["side"] = strategyType === "long_call" ? "buy" : "sell";
    const putSide: OptionLeg["side"] = strategyType === "long_put" ? "buy" : "sell";
    const nextLegs = [
      ...(nextNeedsCall
        ? [
            {
              ...(callLeg ?? {
              id: `${simulation.id}-call`,
              type: "call" as const,
              side: callSide,
              strikeUSD: 0,
              premiumUSD: 0,
              quantity: 1,
              expiryDate: simulation.expiryDate,
              isCovered: nextNeedsStock,
              assignmentPolicy: "unknown" as const,
              }),
              side: callSide,
              isCovered: nextNeedsStock,
            },
          ]
        : []),
      ...(nextNeedsPut
        ? [
            {
              ...(putLeg ?? {
              id: `${simulation.id}-put`,
              type: "put" as const,
              side: putSide,
              strikeUSD: 0,
              premiumUSD: 0,
              quantity: 1,
              expiryDate: simulation.expiryDate,
              putIntent: "can_buy" as const,
              assignmentPolicy: "unknown" as const,
              }),
              side: putSide,
              putIntent: putSide === "sell" ? putLeg?.putIntent ?? "can_buy" : undefined,
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
  const optionEntryExecutions = simulation.optionEntryExecutions ?? [];
  const recoveredEntryOptionLegs = recoverEntryOptionLegsFromSaxoDraft(simulation, optionEntryExecutions, saxoHistoryCandidates);
  const entryOptionLegs = simulation.optionLegs.length > 0 ? simulation.optionLegs : recoveredEntryOptionLegs;
  const shortExitLegs = getShortOptionLegs(simulation);
  const optionEntrySummary = calculateOptionEntryExecutionSummary(simulation);
  const showOptionEntryExecutions = ["planned", "open"].includes(simulation.status) || optionEntryExecutions.length > 0;
  const optionCloseExecutions = simulation.optionCloseExecutions ?? [];
  const optionCloseResults = calculateOptionCloseExecutionResults(simulation);
  const showOptionCloseExecutions = ["open", "closed", "expired"].includes(simulation.status) || optionCloseExecutions.length > 0;
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
  const findEditorFocusInput = (target: HTMLElement | null, anchorId: string): HTMLInputElement | null | undefined => {
    if (!target) return null;
    if (anchorId.startsWith("option-close-execution-")) {
      target.querySelector<HTMLDetailsElement>("details")?.setAttribute("open", "");
      return target.querySelector<HTMLInputElement>("#broker-realized-pnl-jpy") ?? target.querySelector<HTMLInputElement>('input[id^="broker-booked-amount-jpy-"]') ?? target.querySelector<HTMLInputElement>("input");
    }
    if (anchorId === "option-close-executions") {
      return target.querySelector<HTMLInputElement>("#broker-realized-pnl-jpy") ?? target.querySelector<HTMLInputElement>("input");
    }
    return target.querySelector<HTMLInputElement>("input");
  };
  const scrollToEditorAnchor = (anchorId: string) => {
    setHighlightedAnchorId(anchorId);
    window.setTimeout(() => {
      const target = document.getElementById(anchorId);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      findEditorFocusInput(target, anchorId)?.focus();
    }, 80);
    window.setTimeout(() => setHighlightedAnchorId((current) => (current === anchorId ? null : current)), 4500);
  };
  const applyStatusTransitionDrafts = (nextStatus: SimulationStatus): Partial<TradeSimulation> => {
    if (simulation.status === "planned" && nextStatus === "open") {
      const existingLegIds = new Set(optionEntryExecutions.map((execution) => execution.legId));
      const drafts = entryOptionLegs
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
        acquisitionDate: defaultEventDate,
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
        settlementDate: defaultEventDate,
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
    setWorkflowNotice(
      simulation.status === "open"
        ? {
            message: "建玉開始の確認が完了しました。次は反対売買判断または満期管理です。",
            actionLabel: "反対売買判断へ進む",
            anchorId: "close-decision",
          }
        : null,
    );
    update({
      optionEntryExecutions: optionEntryExecutions.map((execution) => ({ ...execution, confirmed: true })),
    });
  };
  const confirmOptionCloseExecution = (id: string) => {
    const execution = optionCloseExecutions.find((item) => item.id === id);
    if (!execution) return;
    const validation = validateSaxoHistoryCloseExecution(simulation, execution);
    if (!validation.valid) {
      updateOptionCloseExecution(id, {
        confirmationStatus: "invalid",
        invalidReason: validation.reason,
      });
      return;
    }
    updateOptionCloseExecution(id, { confirmed: true, confirmationStatus: "confirmed", invalidReason: undefined });
  };
  const applySaxoEntryHistoryCandidate = (executionId: string, item: SaxoHistoryDiscoveryItem) => {
    const execution = optionEntryExecutions.find((entry) => entry.id === executionId);
    if (!execution) return;
    const isNEntry = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
    const nextExecution: OptionEntryExecution = {
      ...execution,
      tradeDate: item.tradeDate ?? execution.tradeDate,
      contracts: item.quantity !== undefined ? Math.max(1, Math.abs(item.quantity)) : execution.contracts,
      fillPriceUSD: item.price ?? execution.fillPriceUSD,
      brokerBookedAmountJPY: !isNEntry ? item.bookedAmount ?? item.profitLossBase ?? execution.brokerBookedAmountJPY : execution.brokerBookedAmountJPY,
      brokerPremiumJPY: !isNEntry ? item.premiumAmount ?? execution.brokerPremiumJPY : execution.brokerPremiumJPY,
      brokerTransactionCostJPY: !isNEntry ? item.transactionCost ?? execution.brokerTransactionCostJPY : execution.brokerTransactionCostJPY,
      brokerFeeJPY: !isNEntry ? item.feeAmount ?? execution.brokerFeeJPY : execution.brokerFeeJPY,
      brokerExchangeFeeJPY: !isNEntry ? item.exchangeFee ?? execution.brokerExchangeFeeJPY : execution.brokerExchangeFeeJPY,
      brokerExchangeRateJPY: !isNEntry ? item.exchangeRate ?? execution.brokerExchangeRateJPY : execution.brokerExchangeRateJPY,
      brokerTaxIncludedFeeJPY: !isNEntry ? item.taxIncludedFee ?? execution.brokerTaxIncludedFeeJPY : execution.brokerTaxIncludedFeeJPY,
      commissionUSD: isNEntry ? Math.abs(item.transactionCost ?? execution.commissionUSD ?? 0) : execution.commissionUSD,
      referenceFxRateJPY: item.exchangeRate ?? execution.referenceFxRateJPY,
      source: "saxo_api_estimate",
      saxoSourceType: "current_position",
      historyCandidateIds: Array.from(new Set([...(execution.historyCandidateIds ?? []), item.id])),
    };
    const missingItems = getEntryExecutionMissingItems(nextExecution, isNEntry);
    updateOptionEntryExecution(executionId, {
      ...nextExecution,
      historyCompletionStatus: missingItems.length > 0 ? "manual" : "matched",
      memo:
        missingItems.length > 0
          ? `入力元: Saxo現在建玉 + Saxo取引履歴 / 履歴補完: 要手入力。不足項目: ${missingItems.join("、")}`
          : "入力元: Saxo現在建玉 + Saxo取引履歴 / 履歴補完: 補完済み。正式保存前にSaxo履歴と照合してください。",
    });
    setEntryCandidatePickerId(null);
    setQuoteStatus(
      missingItems.length > 0
        ? `Saxo取引履歴から一部補完しました。不足項目: ${missingItems.join("、")}。Saxo画面の取引履歴に表示されている値を手入力してください。`
        : "Saxo取引履歴から建玉開始の約定候補を補完しました。内容を確認して正式保存してください。",
    );
  };
  const complementSaxoEntryHistory = (execution: OptionEntryExecution) => {
    const candidates = findSaxoEntryCandidatesForExecution(simulation, execution, saxoHistoryCandidates);
    if (candidates.length === 1) {
      applySaxoEntryHistoryCandidate(execution.id, candidates[0]);
      return;
    }
    if (candidates.length > 1) {
      setEntryCandidatePickerId(execution.id);
      setQuoteStatus("Saxo取引履歴に複数の候補があります。該当する建玉開始履歴を選んでください。");
      return;
    }
    updateOptionEntryExecution(execution.id, {
      historyCompletionStatus: "manual",
      memo: "入力元: Saxo現在建玉 / 履歴補完: 要手入力。Saxo取引履歴から補完できませんでした。履歴を再取得するか、不足項目だけ手入力してください。",
    });
    setQuoteStatus("Saxo取引履歴から補完できませんでした。履歴を再取得するか、不足項目だけ手入力してください。");
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
          closePriceUSD: leg.closeCostUSD ?? leg.closePlan?.closePriceUSD,
          closeKind: simulation.status === "expired" ? "expired" : "buyback",
        }),
      ],
    });
  };
  const removeOptionCloseExecution = (id: string) => {
    update({ optionCloseExecutions: optionCloseExecutions.filter((execution) => execution.id !== id) });
  };

  useEffect(() => {
    if (!focusRequest?.anchorId) return;
    if (focusRequest.anchorId === "entry-rationale-journal") {
      setIsJournalOpen(true);
    }
    const runFocus = () => {
      const target = document.getElementById(focusRequest.anchorId);
      if (!target) return false;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      findEditorFocusInput(target, focusRequest.anchorId)?.focus();
      setHighlightedAnchorId(focusRequest.anchorId);
      return true;
    };
    const timers = [80, 250, 650].map((delay) => window.setTimeout(runFocus, delay));
    window.setTimeout(() => setHighlightedAnchorId((current) => (current === focusRequest.anchorId ? null : current)), 4500);
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [focusRequest?.requestId, focusRequest?.anchorId]);
  useEffect(() => {
    if (simulation.optionLegs.length > 0 || recoveredEntryOptionLegs.length === 0) return;
    update({ optionLegs: recoveredEntryOptionLegs });
  }, [
    simulation.id,
    simulation.optionLegs.length,
    recoveredEntryOptionLegs.map((leg) => `${leg.id}:${leg.type}:${leg.side}:${leg.strikeUSD}:${leg.expiryDate}:${leg.quantity}:${leg.premiumUSD}`).join("|"),
  ]);
  useEffect(() => {
    if (entryOptionLegs.length === 0 || optionEntryExecutions.length === 0) return;
    const nextExecutions = optionEntryExecutions.map((execution) => {
      if (entryOptionLegs.some((leg) => leg.id === execution.legId)) return execution;
      const fallbackLeg = entryOptionLegs[0];
      return {
        ...execution,
        legId: fallbackLeg.id,
        contracts: execution.contracts > 0 ? execution.contracts : fallbackLeg.quantity,
        fillPriceUSD: execution.fillPriceUSD > 0 ? execution.fillPriceUSD : fallbackLeg.premiumUSD,
      };
    });
    if (nextExecutions.some((execution, index) => execution !== optionEntryExecutions[index])) {
      update({ optionEntryExecutions: nextExecutions });
    }
  }, [
    simulation.id,
    entryOptionLegs.map((leg) => `${leg.id}:${leg.quantity}:${leg.premiumUSD}`).join("|"),
    optionEntryExecutions.map((execution) => `${execution.id}:${execution.legId}`).join("|"),
  ]);
  const hasMultipleAssignedRecords =
    simulation.status === "assigned" && Boolean(stockAcquisition.enabled && stockSettlement.enabled);
  const entryExecutionsConfirmed = optionEntryExecutions.length > 0 && optionEntryExecutions.every((execution) => execution.confirmed);
  const hasConfirmedBuybackClose = hasConfirmedBuybackCloseExecution(simulation);
  const hasConfirmedExpiredClose = hasConfirmedExpiredCloseExecution(simulation);
  const hasUnconfirmedCloseDraft = hasUnconfirmedCloseExecutionDraft(simulation);
  const pendingSaxoHistoryCloseExecutions = optionCloseExecutions.filter(
    (execution) =>
      !execution.confirmed &&
      execution.source === "saxo_history" &&
      execution.confirmationStatus !== "ignored" &&
      validateSaxoHistoryCloseExecution(simulation, execution).valid,
  );
  const firstPendingSaxoHistoryCloseExecution = pendingSaxoHistoryCloseExecutions[0];
  const allCloseExecutionsConfirmed = optionCloseExecutions.length > 0 && optionCloseExecutions.every((execution) => execution.confirmed);
  const missingSaxoHistoryCloseCandidate =
    focusRequest?.anchorId === "option-close-executions" && focusRequest.saxoHistoryIssue === "missing-close-candidate";
  const isSaxoApiDraft = isSaxoApiPositionDraft(simulation);
  const saxoDraftMissingItems = getSaxoDraftMissingItems(simulation);
  const entryRationaleJournal = simulation.entryRationaleJournal ?? createJournalForSimulation(simulation);
  const confirmSaxoApiDraft = () => {
    onChange({
      ...simulation,
      status: "open",
      name: simulation.name.replace(/\s*\/\s*API取込下書き/g, ""),
      fixtureMeta: {
        source: simulation.fixtureMeta?.source ?? (workspace === "demo" ? "demo" : "live"),
        isRealMoney: simulation.fixtureMeta?.isRealMoney ?? workspace !== "demo",
        broker: simulation.fixtureMeta?.broker ?? "SaxoBank",
        purpose: simulation.fixtureMeta?.purpose ?? "development-fixture",
        createdAt: simulation.fixtureMeta?.createdAt ?? formatLocalDate(),
        ...simulation.fixtureMeta,
        notes: "Saxo API read-onlyの現在建玉候補から、ユーザー確認後に正式保存しました。API取得値だけで確認済み扱いにはしていません。",
      },
    });
    setWorkflowNotice({
      message: "建玉入力へ正式保存しました。ダッシュボードに建玉中として表示しています。",
      actionLabel: "建玉開始の約定確認へ",
      anchorId: "option-entry-executions",
    });
  };
  const confirmEntryExecutionAndMaybeDraft = (executionId: string) => {
    const nextExecutions = optionEntryExecutions.map((execution) =>
      execution.id === executionId ? { ...execution, confirmed: true } : execution,
    );
    if (isSaxoApiDraft) {
      onChange({
        ...simulation,
        status: "open",
        name: simulation.name.replace(/\s*\/\s*API取込下書き/g, ""),
        optionEntryExecutions: nextExecutions,
        fixtureMeta: {
          source: simulation.fixtureMeta?.source ?? (workspace === "demo" ? "demo" : "live"),
          isRealMoney: simulation.fixtureMeta?.isRealMoney ?? workspace !== "demo",
          broker: simulation.fixtureMeta?.broker ?? "SaxoBank",
          purpose: simulation.fixtureMeta?.purpose ?? "development-fixture",
          createdAt: simulation.fixtureMeta?.createdAt ?? formatLocalDate(),
          ...simulation.fixtureMeta,
          notes: "Saxo API read-onlyの現在建玉候補から、ユーザー確認後に正式保存しました。API取得値だけで確認済み扱いにはしていません。",
        },
      });
      setWorkflowNotice({
        message: "建玉入力へ正式保存しました。ダッシュボードに建玉中として表示しています。",
        actionLabel: "建玉開始の約定確認へ",
        anchorId: "option-entry-executions",
      });
      return;
    }
    update({ optionEntryExecutions: nextExecutions });
    setQuoteStatus("建玉開始の約定確認を正式保存しました。");
  };

  return (
    <section>
      {isSaxoApiDraft ? (
        <div className="mb-4 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold">Saxo API建玉候補の下書き</h3>
                <span className="rounded bg-white px-2 py-1 text-xs font-bold text-teal-800">正式保存前 - 内容確認が必要です</span>
              </div>
              <p className="mt-2 text-xs leading-5">
                これはAPI取得値から作成した下書きです。銘柄、口座、売買方向、数量、権利行使価格、満期、建て価格を確認し、必要な不足項目を入力してから正式保存してください。
              </p>
              <p className="mt-1 text-xs leading-5">
                必須確認: 口座区分P/N、戦略、P/C方針、手数料、主分母、NISA等比較年率、出口ルール。
              </p>
              {saxoDraftMissingItems.length > 0 ? (
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
                  不足・要確認: {saxoDraftMissingItems.join(" / ")}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white"
                onClick={confirmSaxoApiDraft}
              >
                確認して正式保存する
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                onClick={() => onDiscardDraft?.(simulation.id)}
              >
                下書きを破棄
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div id="simulation-editor" className="mb-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-950">建玉入力</h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
          {(["planned", "open", "closed", "assigned", "expired"] as SimulationStatus[]).map((status) => (
            <button
              key={status}
              type="button"
              className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
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
            <label className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                checked={simulation.beginnerMode ?? true}
                onChange={(event) => update({ beginnerMode: event.target.checked })}
              />
              初心者
            </label>
          </div>
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

      <details
        id="entry-rationale-journal"
        className="mt-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        open={isJournalOpen}
        onToggle={(event) => setIsJournalOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm font-bold text-slate-950">エントリー根拠</summary>
        <div className="mt-3">
          <EntryRationaleJournalPanel
            title=""
            journal={entryRationaleJournal}
            onChange={(entryRationaleJournal) => update({ entryRationaleJournal })}
            reviewMode={["closed", "assigned", "expired"].includes(simulation.status)}
          />
        </div>
      </details>

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
              ["long_call", "コール買い"],
              ["long_put", "プット買い"],
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
              <h3 className="text-sm font-bold text-slate-950">3-A. 建玉開始の約定確認</h3>
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
              {optionEntryExecutions.some((execution) => !execution.confirmed) ? (
                <button
                  className="rounded-md border border-emerald-300 bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                  type="button"
                  onClick={confirmOptionEntryExecutions}
                >
                  建玉開始を確認済みにする
                </button>
              ) : null}
            </div>
          </div>
          {simulation.status === "open" && optionEntryExecutions.some((execution) => !execution.confirmed) ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-950">
              約定情報未確認です。P口座ではSaxo取引履歴のプレミアムJPYと取引費用JPYを確認してください。
            </div>
          ) : null}
          {entryExecutionsConfirmed && simulation.status === "planned" ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">
              <span className="font-semibold">建玉開始を確認しました。建玉状態を建玉中に変更できます。</span>
              <button
                type="button"
                className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                onClick={() => updateStatus("open")}
              >
                建玉中に変更
              </button>
            </div>
          ) : null}
          {entryExecutionsConfirmed && simulation.status === "open" ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm leading-6 text-sky-950">
              <div>
                <div className="font-semibold">建玉開始は確認済みです。</div>
                <div className="mt-1 text-xs text-sky-800">
                  次は、必要に応じて反対売買判断へ進むか、入力欄を閉じて俯瞰へ戻ってください。
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-bold text-sky-800 hover:bg-sky-100"
                  onClick={() => onCloseDecisionAction?.("close-decision")}
                >
                  反対売買判断へ進む
                </button>
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  onClick={onCloseEditor}
                >
                  入力欄を閉じて俯瞰へ戻る
                </button>
              </div>
            </div>
          ) : null}
          <div className="mt-3 grid gap-3">
            {optionEntryExecutions.map((execution) => {
              const selectedLeg = entryOptionLegs.find((leg) => leg.id === execution.legId) ?? entryOptionLegs[0];
              const selectedLegId = selectedLeg?.id ?? "";
              const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
              const entryCandidates = findSaxoEntryCandidatesForExecution(simulation, execution, saxoHistoryCandidates);
              const isSaxoCurrentPositionEntry = execution.saxoSourceType === "current_position";
              const entryMissingItems = getEntryExecutionMissingItems(execution, isN);
              const hasPEntryBookedAmount =
                !isN &&
                execution.brokerBookedAmountJPY !== undefined &&
                Number.isFinite(execution.brokerBookedAmountJPY) &&
                (execution.brokerPremiumJPY === undefined || execution.brokerTransactionCostJPY === undefined || execution.brokerExchangeRateJPY === undefined);
              const diagnosticCandidates = getEntryDiagnosticCandidates(execution, entryCandidates, saxoHistoryCandidates);
              const usdPremium = execution.fillPriceUSD * 100 * execution.contracts;
              const referenceFxRate = execution.referenceFxRateJPY ?? execution.brokerExchangeRateJPY ?? simulation.referenceFxRateJPY ?? simulation.fxRateJPY;
              const referenceJpy = usdPremium * referenceFxRate - (execution.commissionUSD ?? 0) * referenceFxRate;
              return (
                <div
                  key={execution.id}
                  className={`rounded-md border bg-slate-50 p-3 ${
                    isSaxoCurrentPositionEntry && !execution.confirmed ? "border-teal-300 ring-2 ring-teal-100" : "border-slate-200"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-slate-950">{selectedLeg ? getOptionLegLabel(selectedLeg) : "対象脚未選択"}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {execution.confirmed ? "確認済み" : "約定情報未確認"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                        type="button"
                        disabled={execution.confirmed}
                        onClick={() => complementSaxoEntryHistory(execution)}
                      >
                        Saxo取引履歴から補完
                      </button>
                      <button
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                        type="button"
                        disabled={entryCandidates.length === 0 || execution.confirmed}
                        onClick={() => setEntryCandidatePickerId(entryCandidatePickerId === execution.id ? null : execution.id)}
                      >
                        履歴候補を選ぶ
                      </button>
                      {!execution.confirmed ? (
                        <button
                          className="rounded-md border border-emerald-300 bg-emerald-600 px-2 py-1 text-xs font-bold text-white hover:bg-emerald-700"
                          type="button"
                          onClick={() => confirmEntryExecutionAndMaybeDraft(execution.id)}
                        >
                          確認して正式保存する
                        </button>
                      ) : (
                        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800">
                          確認済み
                        </span>
                      )}
                      <button
                        className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                        type="button"
                        onClick={() => (isSaxoApiDraft ? onDiscardDraft?.(simulation.id) : removeOptionEntryExecution(execution.id))}
                      >
                        下書きを破棄
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-700">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span className="font-semibold">入力元: {formatEntryExecutionSource(execution)}</span>
                      <span className="font-semibold">履歴補完: {formatEntryHistoryCompletion(execution)}</span>
                      {entryCandidates.length > 0 ? <span>候補 {entryCandidates.length}件</span> : null}
                    </div>
                    {isSaxoCurrentPositionEntry && execution.historyCompletionStatus === "unmatched" ? (
                      <p className="mt-1 text-amber-700">
                        Saxo取引履歴から補完できませんでした。履歴を再取得するか、不足項目だけ手入力してください。
                      </p>
                    ) : null}
                    {isSaxoCurrentPositionEntry && execution.historyCompletionStatus === "multiple" ? (
                      <p className="mt-1 text-amber-700">Saxo取引履歴に複数候補があります。「履歴候補を選ぶ」から該当履歴を選択してください。</p>
                    ) : null}
                    {isSaxoCurrentPositionEntry && execution.historyCompletionStatus === "manual" ? (
                      <p className="mt-1 text-amber-700">
                        Saxo取引履歴から一部項目を自動補完できませんでした。Saxo画面の取引履歴に表示されている値を手入力してください。
                      </p>
                    ) : null}
                    {isSaxoCurrentPositionEntry && execution.historyCompletionStatus === "matched" ? (
                      <p className="mt-1 text-emerald-700">Saxo現在建玉とSaxo取引履歴で補完済みです。内容を確認して正式保存してください。</p>
                    ) : null}
                    {isSaxoCurrentPositionEntry && entryMissingItems.length > 0 ? (
                      <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
                        <div className="font-bold">不足項目: {entryMissingItems.join("、")}</div>
                        <p className="mt-1">
                          Saxo取引履歴からこの項目を自動補完できませんでした。Saxo画面の取引履歴に表示されている値を手入力してください。
                        </p>
                      </div>
                    ) : null}
                    {hasPEntryBookedAmount ? (
                      <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-900">
                        Saxo口座動向の記帳額を取得済みです。費用内訳は未取得ですが、P口座の現金増減としてはこの金額を使えます。
                      </div>
                    ) : null}
                    {isSaxoCurrentPositionEntry && diagnosticCandidates.length > 0 ? (
                      <details className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                        <summary className="cursor-pointer font-bold text-slate-700">補完診断を表示</summary>
                        <div className="mt-2 grid gap-2">
                          {diagnosticCandidates.map((candidate) => (
                            <div key={candidate.id} className="rounded bg-white p-2">
                              <div className="font-bold text-slate-800">{formatSaxoEntryCandidateLabel(candidate)}</div>
                              <div className="mt-1 text-slate-600">
                                取得できた項目名: {candidate.rawFieldNames && candidate.rawFieldNames.length > 0 ? candidate.rawFieldNames.slice(0, 40).join(" / ") : "未取得"}
                              </div>
                              {(candidate.fieldDiagnostics ?? []).map((diagnostic) => (
                                <div key={diagnostic.target} className="mt-1 text-slate-600">
                                  {diagnostic.target}: 探した項目名 {diagnostic.searched.join(" / ")} /{" "}
                                  {diagnostic.matched ? `一致 ${diagnostic.matched}` : diagnostic.reason ?? "一致なし"}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </div>
                  {entryCandidatePickerId === execution.id ? (
                    <div className="mt-3 rounded-md border border-teal-200 bg-white p-3">
                      <div className="text-xs font-bold text-slate-800">Saxo取引履歴候補</div>
                      {entryCandidates.length > 0 ? (
                        <div className="mt-2 grid gap-2">
                          {entryCandidates.map((candidate) => (
                            <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
                              <div className="leading-5 text-slate-700">{formatSaxoEntryCandidateLabel(candidate)}</div>
                              <button
                                type="button"
                                className="rounded-md border border-teal-300 bg-teal-600 px-2 py-1 font-bold text-white hover:bg-teal-700"
                                onClick={() => applySaxoEntryHistoryCandidate(execution.id, candidate)}
                              >
                                この履歴で補完
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                          Saxo取引履歴から補完できませんでした。履歴を再取得するか、不足項目だけ手入力してください。
                        </p>
                      )}
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-3 xl:grid-cols-4">
                    <Select
                      label="対象脚"
                      value={selectedLegId}
                      onChange={(legId) => {
                        const leg = entryOptionLegs.find((item) => item.id === legId);
                        updateOptionEntryExecution(execution.id, {
                          legId,
                          contracts: leg?.quantity ?? execution.contracts,
                          fillPriceUSD: leg?.premiumUSD ?? execution.fillPriceUSD,
                        });
                      }}
                      options={entryOptionLegs.map((leg) => [leg.id, getOptionLegLabel(leg)])}
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
                        ["saxo_api_estimate", "Saxo現在建玉 / 取引履歴候補"],
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
          <>
            {stockAcquisitionComplete ? (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">
                <div className="font-bold">現物株取得は反映済みです。</div>
                <p className="mt-1">
                  {stockTransfer
                    ? `P→N株式移管は記録済みです。現在はN口座で${stockTransfer.shares}株を保有しています。内容が正しければ、入力欄を閉じてN口座ホイールを確認してください。`
                    : "この画面は自動保存されるため、別の保存ボタンはありません。内容が正しければ、入力欄を閉じてダッシュボードの履歴で完了表示を確認してください。"}
                </p>
              </div>
            ) : null}
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
                  ["saxo_history", "Saxo履歴候補"],
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
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
                onClick={closeAfterStockAcquisitionReview}
              >
                入力欄を閉じて俯瞰へ戻る
              </button>
            </div>
          </>
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
              カバードコールで株を渡した、または現物株を売却した場合だけ入力します。この欄は入力と同時に保存され、チェックがONで必要項目が入っている場合は成績に反映されます。
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
              value={Math.round((stockSettlement.commissionUSD ?? 0) * 100) / 100}
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
            {stockSettlementComplete ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-950 xl:col-span-4">
                <div className="font-bold">現物株の譲渡記録は成績に反映済みです。</div>
                {simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" || simulation.accountCode === "N" ? (
                  <p className="mt-1">
                    N口座株式譲渡損益: {formatUSD(stockSettlementRealizedPnlUSD)}
                    {stockSettlementTaxResult.realizedGainJPY ? ` / 参考 ${formatJPY(stockSettlementTaxResult.realizedGainJPY, { signed: true })}` : ""}
                  </p>
                ) : (
                  <p className="mt-1">株式譲渡損益: {formatJPY(stockSettlementTaxResult.realizedGainJPY, { signed: true })}</p>
                )}
                <p className="mt-1 text-xs text-emerald-800">
                  成績タブの「{simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" || simulation.accountCode === "N" ? "N口座株式譲渡損益（USD主帳簿）" : "P/DEMO株式譲渡損益（JPY集計）"}」で確認できます。
                </p>
                {onOpenPerformance ? (
                  <button
                    type="button"
                    className="mt-3 rounded-md bg-emerald-700 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-800"
                    onClick={onOpenPerformance}
                  >
                    成績タブで確認
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950 xl:col-span-4">
                現物株の譲渡を記録するチェックはONですが、譲渡日、譲渡株数、売却単価、取得単価のいずれかが未入力です。必要項目が揃うまで成績反映済みとは表示しません。
              </div>
            )}
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
            {firstPendingSaxoHistoryCloseExecution ? (
              <button
                className="rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800"
                onClick={() => scrollToEditorAnchor(`option-close-execution-${firstPendingSaxoHistoryCloseExecution.id}`)}
              >
                最初の確認待ちを開く
              </button>
            ) : shortExitLegs.length > 0 && !missingSaxoHistoryCloseCandidate ? (
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
          {missingSaxoHistoryCloseCandidate ? (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-950">
              <div className="font-bold">この履歴候補に対応する決済実績候補が見つかりません。</div>
              <p className="mt-1">履歴候補へ戻って、反映候補を作り直してください。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-red-300 bg-white px-3 py-2 text-xs font-bold text-red-800 hover:bg-red-100"
                  onClick={onReturnToSaxoHistory}
                >
                  履歴候補へ戻る
                </button>
                <button
                  type="button"
                  className="rounded-md bg-red-700 px-3 py-2 text-xs font-bold text-white hover:bg-red-800"
                  onClick={() => onRecreateSaxoHistoryCandidate?.(focusRequest?.sourceTradeId)}
                >
                  反映候補を作り直す
                </button>
              </div>
            </div>
          ) : null}
          {pendingSaxoHistoryCloseExecutions.length > 0 ? (
            <div className="mt-3 rounded-md border border-teal-200 bg-teal-50 p-3 text-sm leading-6 text-teal-950">
              <div className="font-bold">Saxo履歴から作成された決済実績候補があります。</div>
              <p className="mt-1">内容を確認し、不足項目を補ってから正式保存してください。</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded bg-white px-2 py-1 text-xs font-bold text-teal-800">確認待ち {pendingSaxoHistoryCloseExecutions.length}件</span>
                <button
                  type="button"
                  className="rounded-md border border-teal-300 bg-white px-3 py-1.5 text-xs font-bold text-teal-900 hover:bg-teal-100"
                  onClick={() => scrollToEditorAnchor(`option-close-execution-${firstPendingSaxoHistoryCloseExecution?.id}`)}
                >
                  最初の確認待ちを開く
                </button>
              </div>
            </div>
          ) : allCloseExecutionsConfirmed ? (
            <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold leading-6 text-emerald-950">
              決済実績は確認済みです。必要に応じて内容を見直せます。
            </div>
          ) : null}
          {simulation.status === "open" && hasConfirmedBuybackClose ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">
              <span className="font-semibold">確認済みの決済実績があります。建玉状態を決済済みに変更できます。</span>
              <button
                type="button"
                className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                onClick={() => updateStatus("closed")}
              >
                決済済みに変更
              </button>
            </div>
          ) : null}
          {simulation.status === "open" && !hasConfirmedBuybackClose && hasConfirmedExpiredClose ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm leading-6 text-sky-950">
              <span className="font-semibold">確認済みの満期終了記録があります。建玉状態を満期終了に変更できます。</span>
              <button
                type="button"
                className="rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-bold text-sky-800 hover:bg-sky-100"
                onClick={() => updateStatus("expired")}
              >
                満期終了に変更
              </button>
            </div>
          ) : null}
          {simulation.status === "open" && !hasConfirmedBuybackClose && !hasConfirmedExpiredClose && hasUnconfirmedCloseDraft ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-950">
              決済実績の下書きがあります。Saxo注文履歴を見て入力内容を確認し、「決済実績を確認済みにする」を押してください。
            </div>
          ) : null}
          <div className="mt-3 grid gap-3">
            {optionCloseExecutions.map((execution) => {
              const executionAnchorId = `option-close-execution-${execution.id}`;
              const result = optionCloseResults.find((item) => item.execution.id === execution.id);
              const closeValidation = validateSaxoHistoryCloseExecution(simulation, execution);
              const isInvalidSaxoHistoryCloseDraft = execution.source === "saxo_history" && !execution.confirmed && !closeValidation.valid;
              const visibleResult = isInvalidSaxoHistoryCloseDraft ? undefined : result;
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
              const isSaxoHistoryCloseDraft =
                execution.source === "saxo_history" &&
                !execution.confirmed &&
                execution.confirmationStatus !== "ignored" &&
                !isInvalidSaxoHistoryCloseDraft;
              const closeMissingItems = getCloseExecutionMissingItems(execution, isNCloseExecution);
              const hasPCloseBookedAmount =
                !isNCloseExecution &&
                execution.brokerBookedAmountJPY !== undefined &&
                Number.isFinite(execution.brokerBookedAmountJPY) &&
                (execution.brokerRealizedPnlJPY === undefined || execution.brokerTransactionCostJPY === undefined || execution.brokerExchangeRateJPY === undefined);
              return (
                <div
                  key={execution.id}
                  id={executionAnchorId}
                  className={`rounded-md border bg-slate-50 p-3 ${
                    highlightedAnchorId === executionAnchorId ? "border-amber-400 ring-2 ring-amber-200" : "border-slate-200"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-bold text-slate-950">
                      {selectedLeg ? getOptionLegLabel(selectedLeg) : "対象脚未選択"}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-md px-2 py-1 text-xs font-bold ${execution.confirmed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                        {execution.confirmed ? "確認済み" : "下書き"}
                      </span>
                      <button
                        className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                        onClick={() => removeOptionCloseExecution(execution.id)}
                      >
                        削除
                      </button>
                    </div>
                  </div>
                  {isExpiredExecution ? (
                    <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm font-semibold text-sky-950">
                      満期終了モード: 買戻し約定ではないため、約定価格USDは入力しません。受取プレミアムから建て時手数料を引いた実績として扱います。
                    </div>
                  ) : null}
                  {isInvalidSaxoHistoryCloseDraft ? (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-950">
                      <div className="font-bold">この決済実績候補は正式保存できません。</div>
                      <p className="mt-1">
                        {execution.invalidReason ??
                          closeValidation.reason ??
                          "現在のSaxo履歴と対象建玉に一致しないため、候補を破棄するか正しい候補を選び直してください。"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-800 hover:bg-red-100"
                          onClick={() => removeOptionCloseExecution(execution.id)}
                        >
                          誤った下書きを破棄
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-50"
                          onClick={() => onRecreateSaxoHistoryCandidate?.(execution.sourceTradeId)}
                        >
                          正しい候補を選び直す
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {isSaxoHistoryCloseDraft ? (
                    <div className="mt-3 rounded-md border border-teal-200 bg-teal-50 p-3 text-sm leading-6 text-teal-950">
                      <div className="font-bold">Saxo履歴から作成された確認待ちです。</div>
                      <p className="mt-1">この決済実績候補の内容を確認し、不足項目を補ってから正式保存してください。</p>
                      {closeMissingItems.length > 0 ? (
                        <p className="mt-2 rounded bg-white px-2 py-1 text-xs font-bold text-teal-900">未入力: {closeMissingItems.join(", ")}</p>
                      ) : (
                        <p className="mt-2 rounded bg-white px-2 py-1 text-xs font-bold text-teal-900">未入力項目はありません。内容を確認して正式保存できます。</p>
                      )}
                      {hasPCloseBookedAmount ? (
                        <p className="mt-2 rounded bg-white px-2 py-1 text-xs font-bold text-teal-900">
                          Saxo口座動向の記帳額を取得済みです。費用内訳は未取得ですが、P口座の現金増減としてはこの金額を使えます。
                        </p>
                      ) : null}
                      <button
                        type="button"
                        className="mt-2 rounded-md border border-teal-300 bg-white px-3 py-1.5 text-xs font-bold text-teal-900 hover:bg-teal-100"
                        onClick={() => scrollToEditorAnchor(executionAnchorId)}
                      >
                        この決済実績を確認する
                      </button>
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
                          ["saxo_history", "Saxo履歴候補"],
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
                            inputId={`broker-booked-amount-jpy-${execution.id}`}
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
                              ["saxo_history", "Saxo履歴候補"],
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
                  {visibleResult ? (
                    <div className="mt-3 grid gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950 md:grid-cols-3">
                      <div>
                        <div className="text-xs font-semibold">実現損益</div>
                        <div className="numeric-input font-bold">
                          {visibleResult.currency === "USD"
                            ? `${formatUSD(visibleResult.realizedPnlUSD)} / 参考 ${formatJPY(visibleResult.realizedPnlJPY, { signed: true })}`
                            : formatJPY(visibleResult.realizedPnlJPY, { signed: true })}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold">実績年率</div>
                        <div className="numeric-input font-bold">{formatPct(visibleResult.annualReturnPct)}（{visibleResult.holdingDays}日）</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold">計算内訳</div>
                        <div className="text-xs leading-5">
                          {!isNCloseExecution && visibleResult.basis === "saxo_broker_statement" ? (
                            <>
                              Saxo実績ベース / 実現損益 {formatJPY(visibleResult.realizedPnlJPY, { signed: true })}を採用
                              <br />
                              参考: 記帳額 {execution.brokerBookedAmountJPY === undefined ? "-" : formatJPY(execution.brokerBookedAmountJPY, { signed: true })} / 取引費用{" "}
                              {execution.brokerTransactionCostJPY === undefined ? "-" : formatJPY(execution.brokerTransactionCostJPY, { signed: true })} / 為替{" "}
                              {execution.brokerExchangeRateJPY === undefined ? "-" : execution.brokerExchangeRateJPY.toFixed(6)}
                            </>
                          ) : (
                            <>
                              {visibleResult.basis === "saxo_broker_statement" ? "Saxo実績ベース" : "概算"} / プレミアム {formatUSD(visibleResult.entryPremiumUSD)} - 買戻し {formatUSD(visibleResult.closeCostUSD)} - 手数料 {formatUSD(visibleResult.openCommissionUSD + visibleResult.closeCommissionUSD)}
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
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm">
                    <span className="text-slate-600">
                      {execution.confirmed
                        ? "この決済実績は確認済みです。"
                        : isSaxoHistoryCloseDraft
                          ? "Saxo履歴候補から作成された決済実績です。内容を確認してから正式保存してください。"
                          : "Saxo注文履歴で約定日、価格、数量、損益を確認してから確定してください。"}
                    </span>
                    <button
                      type="button"
                      className="rounded-md border border-emerald-300 bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-500"
                      disabled={!visibleResult || execution.confirmed || isInvalidSaxoHistoryCloseDraft}
                      onClick={() => confirmOptionCloseExecution(execution.id)}
                    >
                      {isSaxoHistoryCloseDraft ? "確認して正式保存" : "決済実績を確認済みにする"}
                    </button>
                  </div>
                </div>
              );
            })}
            {optionCloseExecutions.length === 0 && simulation.status !== "closed" && !missingSaxoHistoryCloseCandidate ? (
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
  const typeLabel = leg.type === "call" ? "C" : "P";
  const sideLabel = leg.side === "buy" ? "買い" : "売り";
  return `${typeLabel}${sideLabel} ${leg.strikeUSD} / ${leg.expiryDate} / ${leg.quantity}枚`;
}

function isLikelyNextStatus(current: SimulationStatus, next: SimulationStatus): boolean {
  if (current === next) return true;
  if (current === "planned") return next === "open";
  if (current === "open") return ["closed", "assigned", "expired"].includes(next);
  return false;
}

function isSaxoApiPositionDraft(simulation: TradeSimulation): boolean {
  const notes = simulation.fixtureMeta?.notes ?? "";
  if (notes.includes("正式保存しました")) return false;
  return (
    simulation.id.startsWith("saxo-position-draft-") ||
    simulation.name.includes("API取込下書き") ||
    notes.includes("Saxo API read-onlyの現在建玉候補から作成した下書き")
  );
}

function getSaxoDraftMissingItems(simulation: TradeSimulation): string[] {
  const items: string[] = [];
  const firstLeg = simulation.optionLegs[0];
  if (!simulation.ticker) items.push("銘柄");
  if (!simulation.accountCode) items.push("口座");
  if (!firstLeg?.side) items.push("売買方向");
  if (!firstLeg?.quantity) items.push("数量");
  if (!firstLeg?.strikeUSD) items.push("権利行使価格");
  if (!firstLeg?.expiryDate && !simulation.expiryDate) items.push("満期");
  if (!firstLeg?.premiumUSD) items.push("建て価格");
  if (!simulation.brokerCommissionUSD && simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT") items.push("手数料");
  if (!simulation.denominatorMode) items.push("主分母");
  if (simulation.nisaExpectedAnnualReturnPct === undefined) items.push("NISA等比較年率");
  return items;
}

function recoverEntryOptionLegsFromSaxoDraft(
  simulation: TradeSimulation,
  executions: OptionEntryExecution[],
  candidates: SaxoHistoryDiscoveryItem[],
): OptionLeg[] {
  if (simulation.optionLegs.length > 0 || executions.length === 0) return [];
  const recovered = executions
    .map((execution) => recoverEntryOptionLegFromSaxoDraft(simulation, execution, candidates))
    .filter((leg): leg is OptionLeg => Boolean(leg));
  const seen = new Set<string>();
  return recovered.filter((leg) => {
    if (seen.has(leg.id)) return false;
    seen.add(leg.id);
    return true;
  });
}

function recoverEntryOptionLegFromSaxoDraft(
  simulation: TradeSimulation,
  execution: OptionEntryExecution,
  candidates: SaxoHistoryDiscoveryItem[],
): OptionLeg | undefined {
  const explicitCandidate = candidates.find((candidate) => (execution.historyCandidateIds ?? []).includes(candidate.id));
  const contract =
    parseSaxoOptionContract(simulation.fixtureMeta?.saxoInstrumentCode ?? "") ??
    parseSaxoOptionContract(explicitCandidate?.instrumentCode ?? "") ??
    parseSaxoOptionContract(explicitCandidate?.symbol ?? "");
  const type =
    contract?.optionType ??
    (explicitCandidate?.optionType === "call" || explicitCandidate?.optionType === "put" ? explicitCandidate.optionType : undefined) ??
    inferOptionTypeFromStrategy(simulation.strategyType);
  const side =
    inferOptionSideFromStrategy(simulation.strategyType) ??
    (explicitCandidate?.buySell === "buy" ? "buy" : explicitCandidate?.buySell === "sell" ? "sell" : undefined);
  const strikeUSD = contract?.strike ?? explicitCandidate?.strike;
  const expiryDate = contract?.expiry ?? explicitCandidate?.expiry ?? simulation.expiryDate;
  if (!type || !side || strikeUSD === undefined || !Number.isFinite(strikeUSD) || !expiryDate) return undefined;
  return {
    id: execution.legId || `recovered-entry-leg-${execution.id}`,
    type,
    side,
    strikeUSD,
    premiumUSD: execution.fillPriceUSD > 0 ? execution.fillPriceUSD : 0,
    quantity: execution.contracts > 0 ? execution.contracts : 1,
    expiryDate: normalizeEntryDate(expiryDate),
    isCovered: type === "call" && side === "sell",
    putIntent: type === "put" && side === "sell" ? "accept_assignment" : undefined,
    assignmentPolicy: "unknown",
    brokerSymbol: simulation.fixtureMeta?.saxoInstrumentCode ?? explicitCandidate?.instrumentCode ?? explicitCandidate?.symbol,
  };
}

function inferOptionTypeFromStrategy(strategyType: StrategyType): OptionLeg["type"] | undefined {
  if (strategyType === "long_call" || strategyType === "covered_call") return "call";
  if (strategyType === "long_put" || strategyType === "short_put") return "put";
  return undefined;
}

function inferOptionSideFromStrategy(strategyType: StrategyType): OptionLeg["side"] | undefined {
  if (strategyType === "long_call" || strategyType === "long_put") return "buy";
  if (strategyType === "covered_call" || strategyType === "short_put") return "sell";
  return undefined;
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

function findSaxoEntryCandidatesForExecution(
  simulation: TradeSimulation,
  execution: OptionEntryExecution,
  candidates: SaxoHistoryDiscoveryItem[],
): SaxoHistoryDiscoveryItem[] {
  const leg = simulation.optionLegs.find((item) => item.id === execution.legId) ?? recoverEntryOptionLegFromSaxoDraft(simulation, execution, candidates);
  if (!leg) return [];
  const scored = candidates
    .filter((candidate) => candidate.kind !== "closed_position" && candidate.openClose !== "close")
    .filter((candidate) => isSaxoHistoryMatchingOptionLeg(simulation, leg, candidate, "entry"))
    .map((candidate) => ({ candidate, score: scoreSaxoEntryCandidate(simulation, leg, execution, candidate) }))
    .filter((item) => item.score >= 5)
    .sort((a, b) => b.score - a.score);
  const bestScore = scored[0]?.score;
  if (bestScore === undefined) return [];
  return scored
    .filter((item) => item.score >= Math.max(5, bestScore - 2))
    .slice(0, 5)
    .map((item) => item.candidate);
}

function scoreSaxoEntryCandidate(
  simulation: TradeSimulation,
  leg: OptionLeg,
  execution: OptionEntryExecution,
  candidate: SaxoHistoryDiscoveryItem,
): number {
  let score = 0;
  if (normalizeEntrySymbol(candidate.symbol ?? "") && normalizeEntrySymbol(candidate.symbol ?? "") === normalizeEntrySymbol(simulation.ticker)) score += 4;
  if (candidate.optionType && candidate.optionType !== "unknown" && candidate.optionType === leg.type) score += 3;
  if (candidate.strike !== undefined && Math.abs(candidate.strike - leg.strikeUSD) < 0.001) score += 3;
  if (candidate.expiry && normalizeEntryDate(candidate.expiry) === normalizeEntryDate(leg.expiryDate)) score += 3;
  if (candidate.quantity !== undefined && Math.abs(Math.abs(candidate.quantity) - execution.contracts) < 0.0001) score += 2;
  if (candidate.price !== undefined && Math.abs(candidate.price - execution.fillPriceUSD) < 0.01) score += 2;
  if (candidate.tradeDate && execution.tradeDate && normalizeEntryDate(candidate.tradeDate) === normalizeEntryDate(execution.tradeDate)) score += 1;
  if (candidate.instrumentCode && leg.brokerSymbol && candidate.instrumentCode === leg.brokerSymbol) score += 4;
  if ((execution.historyCandidateIds ?? []).includes(candidate.id)) score += 3;
  return score;
}

function normalizeEntrySymbol(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9.]/g, "");
}

function normalizeEntryDate(value: string): string {
  return value.replace(/\//g, "-").slice(0, 10);
}

function formatEntryExecutionSource(execution: OptionEntryExecution): string {
  if (execution.saxoSourceType === "current_position") return "Saxo現在建玉";
  if (execution.saxoSourceType === "history") return "Saxo取引履歴";
  if (execution.source === "broker_statement") return "取引報告書";
  if (execution.source === "saxo_api_estimate") return "Saxo API候補";
  return "手入力";
}

function formatEntryHistoryCompletion(execution: OptionEntryExecution): string {
  if (execution.historyCompletionStatus === "matched") return "補完済み";
  if (execution.historyCompletionStatus === "multiple") return "要選択";
  if (execution.historyCompletionStatus === "manual") return "要手入力";
  if (execution.saxoSourceType === "current_position") return "未照合";
  return "要手入力";
}

function getEntryExecutionMissingItems(execution: OptionEntryExecution, isN: boolean): string[] {
  const items: string[] = [];
  if (!execution.tradeDate) items.push("取引日");
  if (!Number.isFinite(execution.fillPriceUSD) || execution.fillPriceUSD <= 0) items.push("約定価格USD");
  if (!Number.isFinite(execution.contracts) || execution.contracts <= 0) items.push("数量");
  if (isN) {
    const grossPremiumUSD = execution.fillPriceUSD * 100 * execution.contracts;
    if (!Number.isFinite(grossPremiumUSD) || grossPremiumUSD <= 0) items.push("プレミアムUSD");
    if (execution.commissionUSD === undefined || !Number.isFinite(execution.commissionUSD)) items.push("取引費用USD");
    return items;
  }
  const hasBookedAmount = execution.brokerBookedAmountJPY !== undefined && Number.isFinite(execution.brokerBookedAmountJPY);
  if (!hasBookedAmount) {
    items.push("記帳額JPY");
    if (execution.brokerPremiumJPY === undefined || !Number.isFinite(execution.brokerPremiumJPY)) items.push("プレミアムJPY");
    if (execution.brokerTransactionCostJPY === undefined || !Number.isFinite(execution.brokerTransactionCostJPY)) items.push("取引費用JPY");
    if (execution.brokerExchangeRateJPY === undefined || !Number.isFinite(execution.brokerExchangeRateJPY)) items.push("為替レート");
  }
  return items;
}

function getCloseExecutionMissingItems(execution: OptionCloseExecution, isN: boolean): string[] {
  const items: string[] = [];
  if (!execution.closeDate) items.push("決済日");
  if (!Number.isFinite(execution.contracts) || execution.contracts <= 0) items.push("約定数量");
  if ((execution.closeKind ?? "buyback") === "buyback" && (execution.closePriceUSD === undefined || !Number.isFinite(execution.closePriceUSD))) items.push("約定価格USD");
  if (isN) {
    if (execution.commissionUSD === undefined || !Number.isFinite(execution.commissionUSD)) items.push("USD手数料");
    if (execution.realizedPnlUSD === undefined || !Number.isFinite(execution.realizedPnlUSD)) items.push("USD実現損益");
    return items;
  }
  const hasBookedAmount = execution.brokerBookedAmountJPY !== undefined && Number.isFinite(execution.brokerBookedAmountJPY);
  const hasRealizedPnl = execution.brokerRealizedPnlJPY !== undefined && Number.isFinite(execution.brokerRealizedPnlJPY);
  if (!hasBookedAmount) items.push("記帳額JPY");
  if (!hasBookedAmount && !hasRealizedPnl) items.push("Saxo実現損益JPY");
  return items;
}

function getEntryDiagnosticCandidates(
  execution: OptionEntryExecution,
  entryCandidates: SaxoHistoryDiscoveryItem[],
  allCandidates: SaxoHistoryDiscoveryItem[],
): SaxoHistoryDiscoveryItem[] {
  const idSet = new Set(execution.historyCandidateIds ?? []);
  const selected = allCandidates.filter((candidate) => idSet.has(candidate.id));
  const merged = [...selected, ...entryCandidates];
  const seen = new Set<string>();
  return merged.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return Boolean(candidate.rawFieldNames?.length || candidate.fieldDiagnostics?.length);
  });
}

function formatSaxoEntryCandidateLabel(candidate: SaxoHistoryDiscoveryItem): string {
  const parts = [
    candidate.tradeDate ? `取引日 ${normalizeEntryDate(candidate.tradeDate)}` : "取引日 未取得",
    candidate.symbol ? `銘柄 ${candidate.symbol}` : undefined,
    candidate.optionType && candidate.optionType !== "unknown" ? candidate.optionType.toUpperCase() : undefined,
    candidate.strike !== undefined ? `権利行使 ${candidate.strike}` : undefined,
    candidate.expiry ? `満期 ${normalizeEntryDate(candidate.expiry)}` : undefined,
    candidate.quantity !== undefined ? `数量 ${Math.abs(candidate.quantity)}` : undefined,
    candidate.price !== undefined ? `価格 ${candidate.price}` : undefined,
    candidate.bookedAmount !== undefined ? `記帳額 ${formatJPY(candidate.bookedAmount, { signed: true })}` : undefined,
    candidate.premiumAmount !== undefined ? `プレミアム ${formatJPY(candidate.premiumAmount, { signed: true })}` : undefined,
    candidate.transactionCost !== undefined ? `取引費用 ${formatJPY(candidate.transactionCost, { signed: true })}` : undefined,
  ].filter(Boolean);
  return parts.join(" / ");
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
