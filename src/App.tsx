import { useRef, useState } from "react";
import { BarChart3, ChevronUp, Database, Download, FileJson, HelpCircle, JapaneseYen, ListChecks, Plus, TrendingUp, Upload } from "lucide-react";
import { calculatePendingAccountCashEffects, createAccountCashAdjustment } from "@/domain/accountCashEffects";
import type { PendingAccountCashEffect } from "@/domain/accountCashEffects";
import { calculateCoveredCallAssignmentPreview } from "@/domain/coveredCallAssignment";
import { calculateHistoryPerformance } from "@/domain/historyPerformance";
import { createOptionCloseExecutionDraft, sanitizeSaxoHistoryCloseExecutions } from "@/domain/optionCloseExecutions";
import { createOptionEntryExecutionDraft } from "@/domain/optionEntryExecutions";
import { getWorkflowTargetAnchorId } from "@/domain/workflowTasks";
import { calculatePayoffSeries } from "@/domain/payoff";
import { generateChecklist, generateRiskWarnings } from "@/domain/riskRules";
import { calculateScenarioResults } from "@/domain/scenarios";
import { calculateNisaComparison, calculateStockSettlementTaxResult, taxProfiles } from "@/domain/tax";
import { calculateTaxBucketSummary } from "@/domain/taxBucketSummary";
import { createSimulationFromCandidate } from "@/domain/candidateConversion";
import { calculateYearlyPerformanceSummary } from "@/domain/yearlyPerformance";
import { getStatusLabel } from "@/domain/strategyLabels";
import { CandidatePanel } from "@/components/candidates/CandidatePanel";
import { AccountOverview } from "@/components/dashboard/AccountOverview";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { YearlyPerformanceSummaryCard } from "@/components/dashboard/YearlyPerformanceSummaryCard";
import { DataPanel } from "@/components/data/DataPanel";
import { FirstRunNotice } from "@/components/help/FirstRunNotice";
import { UserGuide } from "@/components/help/UserGuide";
import { SaxoReadOnlyPanel } from "@/features/saxo/SaxoReadOnlyPanel";
import {
  findEntryHistoryMatches,
  findSaxoAssignmentStockAcquisitionItem,
  getSaxoHistoryCandidateKeys,
  getSaxoHistoryCandidateTarget,
  getSaxoHistoryStableKey,
  isSaxoHistoryMatchingCloseExecution,
  isSaxoHistoryMatchingEntryExecution,
  isSaxoHistoryMatchingOptionLeg,
  isSaxoHistoryMatchingStockAcquisition,
  resolveSaxoPositionSymbol,
  type SaxoApiOrderSnapshot,
  type SaxoApiPositionSnapshot,
  type SaxoHistoryDiscoveryItem,
} from "@/features/saxo/saxoAccountSync";
import { AnnualReturnFormula } from "@/components/results/AnnualReturnFormula";
import { CloseDecisionCard } from "@/components/results/CloseDecisionCard";
import { DenominatorChart, PayoffChart } from "@/components/results/Charts";
import { DenominatorTable } from "@/components/results/DenominatorTable";
import { RiskPanel } from "@/components/results/RiskPanel";
import { ScenarioCards } from "@/components/results/ScenarioCards";
import { SummaryCards } from "@/components/results/SummaryCards";
import { TaxComparisonCard } from "@/components/results/TaxComparisonCard";
import { SimulationEditor } from "@/components/wizard/SimulationEditor";
import { WheelPanel } from "@/components/wheel/WheelPanel";
import { exportSimulationsCsv, exportWorkspaceJson, parseWorkspaceJson } from "@/lib/export";
import { fetchStooqQuote, fetchUsdJpyRate, normalizeTicker } from "@/lib/marketData";
import { formatLocalDate } from "@/lib/date";
import { formatJPY, formatNumber, formatUSD } from "@/lib/format";
import { useCandidatesStore } from "@/store/useCandidatesStore";
import { DEFAULT_BROKER_COMMISSION_USD, DEFAULT_NISA_EXPECTED_ANNUAL_RETURN_PCT, useOptionsStore } from "@/store/useOptionsStore";
import type { CandidateSymbol } from "@/types/candidates";
import type { OptionCloseExecution, RiskWarning, StockTransferEvent, TradeSimulation, WorkflowTask } from "@/types/domain";
import type { YearlyPerformanceIssue } from "@/domain/yearlyPerformance";

export default function App() {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isDataOpen, setIsDataOpen] = useState(false);
  const [isCandidatesOpen, setIsCandidatesOpen] = useState(false);
  const [hasAcceptedNotice, setHasAcceptedNotice] = useState(() =>
    typeof window === "undefined" ? true : window.localStorage.getItem("us-options-first-run-notice-accepted") === "true",
  );
  const [quoteStatus, setQuoteStatus] = useState("");
  const [closeDecisionFocusRequest, setCloseDecisionFocusRequest] = useState<{ anchorId: string; requestId: number } | null>(null);
  const [editorFocusRequest, setEditorFocusRequest] = useState<{ anchorId: string; requestId: number; saxoHistoryIssue?: "missing-close-candidate"; sourceTradeId?: string } | null>(null);
  const [performanceYear, setPerformanceYear] = useState(() => Number(formatLocalDate().slice(0, 4)));
  const [activeView, setActiveView] = useState<"positions" | "performance">("positions");
  const [dashboardHistoryOpen, setDashboardHistoryOpen] = useState(false);
  const [saxoOrderCandidates, setSaxoOrderCandidates] = useState<SaxoApiOrderSnapshot[]>([]);
  const [saxoHistoryCandidates, setSaxoHistoryCandidates] = useState<SaxoHistoryDiscoveryItem[]>([]);
  const [wheelFocusRequest, setWheelFocusRequest] = useState<{ ticker?: string; requestId: number } | null>(null);
  const {
    activeWorkspace,
    accountInputs,
    simulations,
    wheelCycles,
    wheelEvents,
    stockTransfers,
    selectedSimulationId,
    switchWorkspace,
    updateAccountState,
    applyAccountCashAdjustment,
    createSimulationFromTemplate,
    selectSimulation,
    deleteSimulation,
    upsertSimulation,
    replaceWorkspaceData,
    createWheelCycleFromSimulation,
    createStockTransferFromSimulation,
    settings,
  } = useOptionsStore();
  const {
    candidates,
    importWarnings,
    importCandidateSymbols,
    clearCandidates,
    markCandidateWatchOnly,
  } = useCandidatesStore();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const selected = simulations.find((simulation) => simulation.id === selectedSimulationId) ?? simulations[0];
  const selectedStockTransfer = selected ? getStockTransferForSimulation(selected, stockTransfers) : undefined;
  const selectedStockTransferRecorded = Boolean(selectedStockTransfer);
  const selectedLinkedWheelCycle = selected
    ? wheelCycles.find((cycle) => cycle.currentPhase !== "cycle_closed" && cycle.linkedSimulationIds.includes(selected.id))
    : undefined;
  const selectedWheelAlreadyAdvanced = Boolean(
    selectedLinkedWheelCycle &&
      ["n_stock_holding", "n_covered_call", "n_called_away"].includes(selectedLinkedWheelCycle.currentPhase),
  );
  const canCreateStockTransferFromSelected = Boolean(
    selected &&
      selected.accountEnvironment === "PROD_P_JPY_SETTLEMENT" &&
      selected.status === "assigned" &&
      !selectedStockTransferRecorded &&
      !selectedWheelAlreadyAdvanced,
  );
  const pendingCashEffects = calculatePendingAccountCashEffects(simulations, accountInputs);
  const yearlyPerformanceSummary = calculateYearlyPerformanceSummary(simulations, performanceYear);
  const canUseExternalQuotes = true;
  const externalQuoteModeLabel = "株価更新では銘柄ティッカー、為替更新ではUSD/JPY取得リクエストだけを外部サービスへ送信します。";
  const refreshAllQuotes = async () => {
    const tickers = Array.from(new Set(simulations.map((simulation) => normalizeTicker(simulation.ticker)).filter(Boolean)));
    if (tickers.length === 0) {
      setQuoteStatus("先に建玉の銘柄を入力してください。");
      return;
    }
    setQuoteStatus(`株価を一括取得中... ${tickers.length}銘柄`);
    try {
      const results = await Promise.allSettled(tickers.map(async (ticker) => [ticker, await fetchStooqQuote(ticker)] as const));
      const quoteByTicker = new Map(
        results
          .filter((result): result is PromiseFulfilledResult<readonly [string, Awaited<ReturnType<typeof fetchStooqQuote>>]> => result.status === "fulfilled")
          .map((result) => result.value),
      );
      const failures = results
        .map((result, index) => ({ result, ticker: tickers[index] }))
        .filter((item): item is { result: PromiseRejectedResult; ticker: string } => item.result.status === "rejected")
        .map(({ result, ticker }) => `${ticker}: ${result.reason instanceof Error ? result.reason.message : "取得理由不明"}`);

      if (quoteByTicker.size === 0) {
        setQuoteStatus(`株価取得に失敗しました。既存の株価は変更していません。失敗: ${failures.join(" / ")}`);
        return;
      }

      simulations.forEach((simulation) => {
        const ticker = normalizeTicker(simulation.ticker);
        const quote = quoteByTicker.get(ticker);
        if (quote) {
          upsertSimulation({ ...simulation, ticker, currentPriceUSD: quote.price });
        }
      });
      if (selectedSimulationId) selectSimulation(selectedSimulationId);
      const latestQuote = quoteByTicker.values().next().value;
      setQuoteStatus(
        failures.length > 0
          ? `株価を${quoteByTicker.size}銘柄に反映しました。取得失敗: ${failures.join(" / ")}`
          : `株価を${quoteByTicker.size}銘柄すべてに反映しました。${latestQuote?.date ?? ""} ${latestQuote?.time ?? ""}`,
      );
    } catch (error) {
      setQuoteStatus(error instanceof Error ? `${error.message} 既存の株価は変更していません。` : "株価を取得できませんでした。既存の株価は変更していません。");
    }
  };
  const refreshAllFx = async () => {
    if (simulations.length === 0) {
      setQuoteStatus("先に建玉を登録してください。");
      return;
    }
    setQuoteStatus("USD/JPYを一括更新中...");
    try {
      const quote = await fetchUsdJpyRate();
      simulations.forEach((simulation) => {
        upsertSimulation({ ...simulation, fxRateJPY: quote.rate });
      });
      if (selectedSimulationId) selectSimulation(selectedSimulationId);
      setQuoteStatus(
        `USD/JPY ${quote.rate.toLocaleString("en-US", {
          maximumFractionDigits: 3,
        })} を全建玉に反映しました。${quote.date ?? ""} ${quote.time ?? ""}`,
      );
    } catch (error) {
      setQuoteStatus(
        error instanceof Error
          ? `${error.message} 既存の為替レートは変更していません。`
          : "為替を取得できませんでした。既存の為替レートは変更していません。",
      );
    }
  };

  const downloadCsv = () => {
    const blob = new Blob([exportSimulationsCsv(simulations)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `us-options-${activeWorkspace}-positions.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const downloadJson = () => {
    const accountStatesForExport =
      activeWorkspace === "demo"
        ? [{ ...accountInputs.P, accountEnvironment: "DEMO_JPY_BASE" as const, accountCode: "P" as const, currency: "JPY" as const }]
        : Object.values(accountInputs);
    const blob = new Blob(
      [
        exportWorkspaceJson({
          workspace: activeWorkspace,
          simulations,
          accountStates: accountStatesForExport,
          wheelCycles,
          wheelEvents,
          stockTransfers,
          exportedAt: new Date().toISOString(),
        }),
      ],
      { type: "application/json;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `us-options-${activeWorkspace}-positions.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const importJson = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const imported = parseWorkspaceJson(text);
      replaceWorkspaceData(imported);
      setQuoteStatus(`${imported.simulations.length}件の建玉をJSONから復元しました。`);
      setIsEditorOpen(false);
    } catch (error) {
      setQuoteStatus(error instanceof Error ? error.message : "JSONを読み込めませんでした。");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };
  const createAndOpenEditor = () => {
    createSimulationFromTemplate();
    setIsEditorOpen(true);
  };
  const openWheelManagement = (ticker?: string) => {
    setActiveView("positions");
    setIsEditorOpen(false);
    setWheelFocusRequest({ ticker: ticker ? normalizeTicker(ticker) : undefined, requestId: Date.now() + Math.random() });
  };
  const createCandidateSimulation = (candidate: CandidateSymbol, strategyType: "covered_call" | "short_put") => {
    const simulation = createSimulationFromCandidate({
      candidate,
      workspace: activeWorkspace,
      settings,
      strategyType,
      fxRateJPY: selected?.fxRateJPY,
    });
    upsertSimulation(simulation);
    setIsEditorOpen(true);
    setQuoteStatus(`${candidate.symbol} の${strategyType === "covered_call" ? "カバードコール" : "P売り"}建玉案を作成しました。`);
  };
  const createSimulationFromSaxoPosition = (position: SaxoApiPositionSnapshot, historyItems: SaxoHistoryDiscoveryItem[] = saxoHistoryCandidates) => {
    if (position.accountAssignment !== "P" && position.accountAssignment !== "N") {
      setQuoteStatus("P/N未割当のSaxo建玉は建玉入力へ反映できません。先にP口座 / N口座 / 使わないを確認してください。");
      return;
    }
    if (position.kind !== "option" || (position.optionType !== "put" && position.optionType !== "call")) {
      setQuoteStatus("現在は米国株オプション建玉だけを建玉入力へ反映できます。株式や種別不明の建玉は手入力で確認してください。");
      return;
    }
    const today = formatLocalDate(new Date());
    const expiryDate = position.expiry ?? today;
    const entryDate = today;
    const dte = Math.max(0, Math.ceil((Date.parse(expiryDate) - Date.parse(entryDate)) / 86400000));
    const accountCode = position.accountAssignment;
    const isNAccount = accountCode === "N";
    const legId = `saxo-${position.id}-leg`;
    const quantity = position.quantity !== undefined ? Math.max(1, Math.abs(position.quantity)) : 1;
    const historyMatches = findEntryHistoryMatches(position, historyItems);
    const bestHistory = historyMatches.length === 1 ? historyMatches[0].item : undefined;
    const historyTicker = normalizeTicker(bestHistory?.symbol ?? "");
    const ticker = resolveSaxoPositionSymbol(position, simulations) ?? historyTicker;
    const fillPriceUSD = bestHistory?.price ?? position.premiumOpenPrice ?? position.currentOptionPrice ?? 0;
    const contracts = bestHistory?.quantity !== undefined ? Math.max(1, Math.abs(bestHistory.quantity)) : quantity;
    const entryTradeDate = bestHistory?.tradeDate ?? entryDate;
    const historyMissingItems =
      bestHistory === undefined
        ? []
        : isNAccount
          ? [
              fillPriceUSD > 0 ? undefined : "プレミアムUSD",
              bestHistory.transactionCost !== undefined ? undefined : "取引費用USD",
            ].filter((item): item is string => Boolean(item))
          : [
              bestHistory.bookedAmount !== undefined || bestHistory.profitLossBase !== undefined ? undefined : "記帳額JPY",
              bestHistory.premiumAmount !== undefined ? undefined : "プレミアムJPY",
              bestHistory.transactionCost !== undefined ? undefined : "取引費用JPY",
              bestHistory.exchangeRate !== undefined ? undefined : "為替レート",
            ].filter((item): item is string => Boolean(item));
    const historyCompletionStatus = historyMatches.length === 1
      ? historyMissingItems.length > 0
        ? "manual"
        : "matched"
      : historyMatches.length > 1
        ? "multiple"
        : "unmatched";
    const simulation: TradeSimulation = {
      id: `saxo-position-draft-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      status: "open",
      name: `${ticker || "Saxo建玉候補"} / API取込下書き`,
      ticker,
      underlyingName: position.underlyingName ?? "",
      strategyType: position.optionType === "put" ? "short_put" : "covered_call",
      currentPriceUSD: position.currentPrice ?? position.currentStockPrice ?? 0,
      fxRateJPY: selected?.fxRateJPY ?? 0,
      accountCode,
      accountEnvironment: isNAccount ? "PROD_N_USD_SETTLEMENT" : activeWorkspace === "demo" ? "DEMO_JPY_BASE" : "PROD_P_JPY_SETTLEMENT",
      entryDate,
      expiryDate,
      dte,
      accountCurrency: isNAccount ? "USD" : "JPY",
      referenceFxRateJPY: selected?.referenceFxRateJPY ?? selected?.fxRateJPY ?? 0,
      stockPosition: {
        shares: 0,
        averageCostUSD: position.averageOpenPrice ?? 0,
        denominatorPriceMode: "current_price",
      },
      optionLegs: [
        {
          id: legId,
          type: position.optionType,
          side: position.side === "long" ? "buy" : "sell",
          strikeUSD: position.strike ?? 0,
          premiumUSD: position.premiumOpenPrice ?? position.currentOptionPrice ?? 0,
          quantity,
          expiryDate,
          isCovered: position.optionType === "call",
          putIntent: position.optionType === "put" ? "accept_assignment" : undefined,
          assignmentPolicy: "unknown",
          marketPriceUSD: position.currentOptionPrice,
          brokerSymbol: position.instrumentCode,
        },
      ],
      optionEntryExecutions: [
        {
          id: `saxo-entry-${position.id}-${Date.now()}`,
          legId,
          tradeDate: entryTradeDate,
          contracts,
          fillPriceUSD,
          settlementCurrency: isNAccount ? "USD" : "JPY",
          brokerBookedAmountJPY: !isNAccount ? bestHistory?.bookedAmount ?? bestHistory?.profitLossBase : undefined,
          brokerPremiumJPY: !isNAccount ? bestHistory?.premiumAmount : undefined,
          brokerTransactionCostJPY: !isNAccount ? bestHistory?.transactionCost : undefined,
          brokerFeeJPY: !isNAccount ? bestHistory?.feeAmount : undefined,
          brokerExchangeFeeJPY: !isNAccount ? bestHistory?.exchangeFee : undefined,
          brokerExchangeRateJPY: !isNAccount ? bestHistory?.exchangeRate : undefined,
          brokerTaxIncludedFeeJPY: !isNAccount ? bestHistory?.taxIncludedFee : undefined,
          commissionUSD: isNAccount ? Math.abs(bestHistory?.transactionCost ?? DEFAULT_BROKER_COMMISSION_USD) : undefined,
          referenceFxRateJPY: bestHistory?.exchangeRate ?? selected?.referenceFxRateJPY ?? selected?.fxRateJPY,
          inputMode: isNAccount ? "USD_EXECUTION_CALC" : "P_JPY_BROKER_STATEMENT",
          source: "saxo_api_estimate",
          saxoSourceType: "current_position",
          historyCompletionStatus,
          historyCandidateIds: historyMatches.map((match) => match.item.id),
          confirmed: false,
          memo:
            historyCompletionStatus === "matched"
              ? "入力元: Saxo現在建玉 + Saxo取引履歴 / 履歴補完: 補完済み。正式保存前にSaxo履歴と照合してください。"
              : historyCompletionStatus === "manual"
                ? `入力元: Saxo現在建玉 + Saxo取引履歴 / 履歴補完: 要手入力。不足項目: ${historyMissingItems.join("、")}`
              : historyCompletionStatus === "multiple"
                ? "入力元: Saxo現在建玉 / 履歴補完: 要確認。Saxo取引履歴に複数候補があります。"
                : "入力元: Saxo現在建玉 / 履歴補完: 未照合。Saxo取引履歴から補完するか、不足項目を手入力してください。",
        },
      ],
      optionCloseExecutions: [],
      brokerMarginJPY: 0,
      brokerMarginUSD: 0,
      marginBufferMultiplier: settings.defaultMarginBufferMultiplier,
      marginUsagePercent: 0,
      availableCashJPY: 0,
      denominatorMode: position.optionType === "put" ? "cash_secured" : "stock_plus_margin",
      taxProfileId: "japan_derivative_separate_tax_user_confirm",
      nisaExpectedAnnualReturnPct: settings.defaultNisaExpectedAnnualReturnPct,
      brokerCommissionUSD: DEFAULT_BROKER_COMMISSION_USD,
      beginnerMode: settings.beginnerMode,
      fixtureMeta: {
        source: activeWorkspace === "demo" ? "demo" : "live",
        isRealMoney: activeWorkspace !== "demo",
        broker: "SaxoBank",
        purpose: "development-fixture",
        createdAt: entryDate,
        notes: "Saxo API read-onlyの現在建玉候補から作成した下書きです。API取得値だけで正式確認済み扱いにはしません。",
        saxoAccountKey: position.accountKey,
        saxoPositionId: position.positionId ?? position.id,
        saxoInstrumentCode: position.instrumentCode,
        saxoUic: position.uic,
      },
    };
    upsertSimulation(simulation);
    selectSimulation(simulation.id);
    setIsEditorOpen(true);
    setEditorFocusRequest({ anchorId: "option-entry-executions", requestId: Date.now() });
    setQuoteStatus(
      historyCompletionStatus === "matched"
        ? "Saxo現在建玉から下書きを作成し、Saxo取引履歴1件で建玉開始確認を補完しました。正式保存前に確認してください。"
        : historyCompletionStatus === "manual"
          ? `Saxo現在建玉から下書きを作成し、Saxo取引履歴1件から一部補完しました。不足項目: ${historyMissingItems.join("、")}。`
        : historyCompletionStatus === "multiple"
          ? "Saxo現在建玉から下書きを作成しました。Saxo取引履歴に複数候補があります。3-Aで履歴候補を選んでください。"
          : "Saxo現在建玉から下書きを作成しました。Saxo取引履歴から補完できませんでした。履歴を再取得するか、不足項目だけ手入力してください。",
    );
  };
  const getSaxoStockTransferShares = (position: SaxoApiPositionSnapshot) => {
    const value = position.shareQuantity ?? position.quantity;
    return value !== undefined && Number.isFinite(value) ? Math.abs(value) : 0;
  };
  const getSaxoStockTransferAveragePrice = (position: SaxoApiPositionSnapshot) => {
    const value = position.averageOpenPrice ?? position.currentStockPrice ?? position.currentPrice;
    return value !== undefined && Number.isFinite(value) ? value : undefined;
  };
  const normalizeStockTransferTicker = (value?: string) => {
    if (!value) return "";
    const normalized = value.trim().toUpperCase();
    const saxoOptionMatch = normalized.match(/^([A-Z.]+)\//);
    if (saxoOptionMatch?.[1]) return saxoOptionMatch[1];
    return normalizeTicker(normalized);
  };
  const findPnStockTransferSourceSimulation = (position: SaxoApiPositionSnapshot, sourceSimulationId?: string) => {
    const latestState = useOptionsStore.getState();
    const latestSimulations = latestState.simulations;
    if (sourceSimulationId) {
      const byId = latestSimulations.find((simulation) => simulation.id === sourceSimulationId);
      if (byId) return byId;
    }
    const shares = getSaxoStockTransferShares(position);
    const averagePrice = getSaxoStockTransferAveragePrice(position);
    const positionTicker = normalizeStockTransferTicker(position.symbol ?? position.underlyingName ?? position.instrumentCode);
    const matches = latestSimulations.filter((simulation) => {
      const acquisition = simulation.stockAcquisition;
      if (simulation.status !== "assigned") return false;
      if (simulation.accountEnvironment !== "PROD_P_JPY_SETTLEMENT") return false;
      if (!acquisition?.enabled) return false;
      if (acquisition.accountEnvironment !== "PROD_P_JPY_SETTLEMENT") return false;
      if (!Number.isFinite(acquisition.shares) || Math.abs(acquisition.shares - shares) > 0.0001) return false;
      if (averagePrice !== undefined && Math.abs(acquisition.priceUSD - averagePrice) > 0.05) return false;
      const simulationTicker = normalizeStockTransferTicker(simulation.ticker);
      if (positionTicker && simulationTicker && positionTicker !== simulationTicker) return false;
      return true;
    });
    return matches.length === 1 ? matches[0] : undefined;
  };
  const createStockTransferFromSaxoPosition = (position: SaxoApiPositionSnapshot, sourceSimulationId?: string): boolean => {
    if (position.kind !== "stock" || position.accountAssignment !== "N") {
      setQuoteStatus("このSaxo建玉はN口座現物株ではないため、P→N株式移管として記録できません。");
      return false;
    }
    const sourceSimulation = findPnStockTransferSourceSimulation(position, sourceSimulationId);
    if (!sourceSimulation?.stockAcquisition?.enabled) {
      setQuoteStatus("対応するP口座の権利行使済み建玉が見つかりません。6-A現物株取得を確認してから移管記録を作成してください。");
      return false;
    }
    const shares = getSaxoStockTransferShares(position);
    const averagePrice = getSaxoStockTransferAveragePrice(position) ?? sourceSimulation.stockAcquisition.priceUSD;
    const existingTransfer = useOptionsStore
      .getState()
      .stockTransfers.some((transfer) =>
        transfer.sourceSimulationId === sourceSimulation.id &&
        transfer.toAccountCode === "N" &&
        Math.abs(transfer.shares - shares) <= 0.0001,
      );
    selectSimulation(sourceSimulation.id);
    setActiveView("positions");
    if (existingTransfer) {
      setIsEditorOpen(false);
      setQuoteStatus("このP→N株式移管はすでに記録済みです。N口座ホイールで株式保有を確認してください。");
      return false;
    }
    const sourceForTransfer: TradeSimulation = {
      ...sourceSimulation,
      stockPosition: {
        shares,
        averageCostUSD: averagePrice,
        denominatorPriceMode: sourceSimulation.stockPosition?.denominatorPriceMode ?? "average_cost",
        customDenominatorPriceUSD: sourceSimulation.stockPosition?.customDenominatorPriceUSD,
        canSellAtStrike: sourceSimulation.stockPosition?.canSellAtStrike,
      },
    };
    upsertSimulation(sourceForTransfer);
    createStockTransferFromSimulation(sourceForTransfer);
    setIsEditorOpen(false);
    openWheelManagement(sourceForTransfer.ticker);
    setQuoteStatus("P→N株式移管を記録しました。次は「N口座ホイールを確認」で、N株式保有になっていることを確認してください。確認後、JSONバックアップを保存してください。");
    return true;
  };
  const selectAndOpenEditor = (id: string) => {
    selectSimulation(id);
    setIsEditorOpen(true);
  };
  const openSimulationEditorAt = (id: string, anchorId = "simulation-editor") => {
    const targetSimulation = simulations.find((simulation) => simulation.id === id);
    if (targetSimulation && anchorId === "option-entry-executions" && (targetSimulation.optionEntryExecutions ?? []).length === 0) {
      const entryDrafts = targetSimulation.optionLegs
        .filter((leg) => leg.side === "sell")
        .map((leg) => createOptionEntryExecutionDraft({ simulation: targetSimulation, leg }));
      if (entryDrafts.length > 0) {
        upsertSimulation({
          ...targetSimulation,
          optionEntryExecutions: entryDrafts,
        });
      }
    }
    selectSimulation(id);
    setIsEditorOpen(true);
    setEditorFocusRequest({ anchorId, requestId: Date.now() + Math.random() });
  };
  const findSaxoHistoryTargetSimulation = (item: SaxoHistoryDiscoveryItem, historyTarget: ReturnType<typeof getSaxoHistoryCandidateTarget>) => {
    if (historyTarget === "unknown") return undefined;
    const latestState = useOptionsStore.getState();
    const latestSimulations = latestState.simulations;
    const latestSelected = latestSimulations.find((simulation) => simulation.id === latestState.selectedSimulationId);
    const matches = latestSimulations.flatMap((simulation) =>
      simulation.optionLegs
        .filter((leg) => isSaxoHistoryMatchingOptionLeg(simulation, leg, item, historyTarget))
        .map((leg) => ({ simulation, leg })),
    );
    const selectedMatch = latestSelected ? matches.find((match) => match.simulation.id === latestSelected.id) : undefined;
    if (selectedMatch) return selectedMatch;
    return matches.length === 1 ? matches[0] : undefined;
  };

  const applySaxoAssignmentDraftToSelectedSimulation = (
    item: SaxoHistoryDiscoveryItem,
    stockItem?: SaxoHistoryDiscoveryItem,
  ): { simulationId?: string } => {
    const historyKeys = getSaxoHistoryCandidateKeys(item);
    const stockKeys = stockItem ? getSaxoHistoryCandidateKeys(stockItem) : [];
    const primaryHistoryKey = getSaxoHistoryStableKey(item);
    const resolvedTarget = findSaxoHistoryTargetSimulation(item, "assignment");
    if (!resolvedTarget) {
      setQuoteStatus("この権利行使履歴に厳密一致するP売り建玉が見つかりません。P/N口座、銘柄、Put/Call、権利行使価格、満期、数量を確認してください。");
      return {};
    }
    if (!stockItem) {
      setQuoteStatus("権利行使に対応する現物株100株の買付履歴が見つかりません。Saxo履歴を再取得するか、6-Aへ手入力してください。");
      return {};
    }
    const target = resolvedTarget.simulation;
    const leg = resolvedTarget.leg;
    const existingAcquisition = target.stockAcquisition;
    const alreadyLinked =
      existingAcquisition?.enabled &&
      (historyKeys.includes(existingAcquisition.sourceCandidateId ?? "") ||
        historyKeys.includes(existingAcquisition.sourceTradeId ?? "") ||
        stockKeys.includes(existingAcquisition.sourceStockCandidateId ?? ""));
    const shares = stockItem.quantity !== undefined ? Math.abs(stockItem.quantity) : Math.abs(item.quantity ?? leg.quantity) * 100;
    const priceUSD = stockItem.price ?? item.strike ?? leg.strikeUSD;
    const acquisitionDate = stockItem.tradeDate ?? item.tradeDate ?? formatLocalDate();
    const accountEnvironment: TradeSimulation["accountEnvironment"] =
      target.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "PROD_N_USD_SETTLEMENT" : "PROD_P_JPY_SETTLEMENT";
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(priceUSD) || priceUSD <= 0) {
      setQuoteStatus("権利行使候補を作成できませんでした。現物株の株数または取得単価が未取得です。Saxo履歴を確認してください。");
      return {};
    }
    const nextStockAcquisition = {
      enabled: true,
      acquisitionDate,
      shares,
      priceUSD,
      accountEnvironment,
      commissionUSD: existingAcquisition?.commissionUSD,
      commissionJPY: existingAcquisition?.commissionJPY,
      source: "saxo_history" as const,
      sourceCandidateId: primaryHistoryKey,
      sourceTradeId: item.id,
      sourceStockCandidateId: stockKeys[0] ?? stockItem.id,
      confirmationStatus: existingAcquisition?.confirmationStatus === "confirmed" ? "confirmed" as const : "pending" as const,
      memo: [
        "入力元: Saxo履歴候補（P売り権利行使）。通常の買戻し決済としては保存していません。",
        item.sourceIdMasked ? `オプション消滅履歴ID: ${item.sourceIdMasked}。` : "",
        stockItem.sourceIdMasked ? `現物株取得履歴ID: ${stockItem.sourceIdMasked}。` : "",
        "P口座取得株はP→N株式移管を記録するまでN口座ホイールには混ぜません。",
      ].filter(Boolean).join(""),
    };
    const nextSimulation: TradeSimulation = {
      ...target,
      status: "assigned",
      stockPosition: {
        shares,
        averageCostUSD: priceUSD,
        denominatorPriceMode: target.stockPosition?.denominatorPriceMode ?? "current_price",
        customDenominatorPriceUSD: target.stockPosition?.customDenominatorPriceUSD,
        canSellAtStrike: target.stockPosition?.canSellAtStrike,
      },
      stockAcquisition: alreadyLinked ? { ...existingAcquisition, ...nextStockAcquisition } : nextStockAcquisition,
    };
    upsertSimulation(nextSimulation);
    setQuoteStatus("Saxo履歴から権利行使候補を作成しました。6-A. 現物株の取得記録で株数と取得単価を確認してください。");
    setActiveView("positions");
    selectSimulation(target.id);
    setIsEditorOpen(true);
    setEditorFocusRequest({ anchorId: "stock-acquisition-record", requestId: Date.now() + Math.random(), sourceTradeId: item.id });
    return { simulationId: target.id };
  };

  const applySaxoHistoryDraftToSelectedSimulation = (item: SaxoHistoryDiscoveryItem): { simulationId?: string; closeExecutionId?: string } => {
    const historyTarget = getSaxoHistoryCandidateTarget(item);
    const historyKeys = getSaxoHistoryCandidateKeys(item);
    const primaryHistoryKey = getSaxoHistoryStableKey(item);
    if (historyTarget === "unknown") {
      setQuoteStatus("この履歴候補は建玉開始か決済かを判定できません。売買区分と新規/決済区分をSaxo画面で確認し、必要な場合は手入力してください。");
      return {};
    }
    const resolvedTarget = findSaxoHistoryTargetSimulation(item, historyTarget);
    if (!resolvedTarget) {
      setQuoteStatus("この履歴候補に厳密一致する建玉が見つかりません。P/N口座、銘柄、Put/Call、権利行使価格、満期、数量を確認してください。");
      return {};
    }
    const target = resolvedTarget.simulation;
    const shortLeg = resolvedTarget.leg;
    if (!shortLeg) {
      setQuoteStatus("履歴候補を反映できるオプション脚がありません。対象建玉を確認してください。");
      return {};
    }
    if (historyTarget === "assignment") {
      const stockItem = findSaxoAssignmentStockAcquisitionItem(item, saxoHistoryCandidates);
      return applySaxoAssignmentDraftToSelectedSimulation(item, stockItem);
    }
    if (historyTarget === "close") {
      const existingExecution = (target.optionCloseExecutions ?? []).find(
        (execution) =>
          historyKeys.includes(execution.sourceCandidateId ?? "") ||
          historyKeys.includes(execution.sourceTradeId ?? "") ||
          isSaxoHistoryMatchingCloseExecution(target, shortLeg, execution, item),
      );
      if (!existingExecution) {
        const isN = target.accountEnvironment === "PROD_N_USD_SETTLEMENT";
        const draft = createOptionCloseExecutionDraft({
          simulation: target,
          leg: shortLeg,
          closePriceUSD: item.price,
          closeKind: "buyback",
        });
        const nextExecution: OptionCloseExecution = {
          ...draft,
          closeDate: item.tradeDate ?? draft.closeDate,
          contracts: item.quantity !== undefined ? Math.max(1, Math.abs(item.quantity)) : draft.contracts,
          closePriceUSD: item.price ?? draft.closePriceUSD,
          settlementCurrency: target.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "USD" : "JPY",
          brokerBookedAmountJPY: !isN ? item.bookedAmount ?? item.profitLossBase : undefined,
          brokerRealizedPnlJPY: !isN ? item.profitLoss ?? item.profitLossBase : undefined,
          brokerTransactionCostJPY: !isN ? item.transactionCost : undefined,
          brokerPremiumJPY: !isN ? item.premiumAmount : undefined,
          brokerFeeJPY: !isN ? item.feeAmount : undefined,
          brokerExchangeFeeJPY: !isN ? item.exchangeFee : undefined,
          brokerExchangeRateJPY: !isN ? item.exchangeRate : undefined,
          brokerTaxIncludedFeeJPY: !isN ? item.taxIncludedFee : undefined,
          realizedPnlUSD: isN ? item.profitLoss : undefined,
          commissionUSD: isN ? Math.abs(item.transactionCost ?? draft.commissionUSD ?? DEFAULT_BROKER_COMMISSION_USD) : draft.commissionUSD,
          fxRateJPY: item.exchangeRate ?? draft.fxRateJPY,
          source: "saxo_history" as const,
          sourceCandidateId: primaryHistoryKey,
          sourceTradeId: item.id,
          targetPositionId: target.id,
          confirmationStatus: "pending" as const,
          memo: `入力元: Saxo履歴候補。${item.sourceIdMasked ? `履歴ID: ${item.sourceIdMasked}。` : ""}正式保存前にSaxo履歴と照合してください。`,
          confirmed: false,
        };
        upsertSimulation({
          ...target,
          optionCloseExecutions: [
            ...(target.optionCloseExecutions ?? []),
            nextExecution,
          ],
        });
        setQuoteStatus("履歴候補から作成された決済実績があります。7. 決済実績で内容を確認してください。");
        return { simulationId: target.id, closeExecutionId: nextExecution.id };
      }
      setQuoteStatus("履歴候補から作成された決済実績があります。7. 決済実績で内容を確認してください。");
      return { simulationId: target.id, closeExecutionId: existingExecution.id };
    }
    const existingEntry = (target.optionEntryExecutions ?? []).some(
      (execution) =>
        (execution.historyCandidateIds ?? []).some((candidateId) => historyKeys.includes(candidateId)) ||
        isSaxoHistoryMatchingEntryExecution(target, shortLeg, execution, item),
    );
    if (!existingEntry) {
      const isN = target.accountEnvironment === "PROD_N_USD_SETTLEMENT";
      const draft = createOptionEntryExecutionDraft({ simulation: target, leg: shortLeg });
      upsertSimulation({
        ...target,
        optionEntryExecutions: [
          ...(target.optionEntryExecutions ?? []),
          {
            ...draft,
            tradeDate: item.tradeDate ?? draft.tradeDate,
            contracts: item.quantity !== undefined ? Math.max(1, Math.abs(item.quantity)) : draft.contracts,
            fillPriceUSD: item.price ?? draft.fillPriceUSD,
            brokerBookedAmountJPY: !isN ? item.bookedAmount ?? item.profitLossBase : undefined,
            brokerPremiumJPY: !isN ? item.premiumAmount : undefined,
            brokerTransactionCostJPY: !isN ? item.transactionCost : undefined,
            brokerFeeJPY: !isN ? item.feeAmount : undefined,
            brokerExchangeFeeJPY: !isN ? item.exchangeFee : undefined,
            brokerExchangeRateJPY: !isN ? item.exchangeRate : undefined,
            brokerTaxIncludedFeeJPY: !isN ? item.taxIncludedFee : undefined,
            commissionUSD: isN ? Math.abs(item.transactionCost ?? draft.commissionUSD ?? DEFAULT_BROKER_COMMISSION_USD) : draft.commissionUSD,
            referenceFxRateJPY: item.exchangeRate ?? draft.referenceFxRateJPY,
            source: "saxo_api_estimate",
            saxoSourceType: "history",
            historyCandidateIds: historyKeys,
            historyCompletionStatus: "manual",
            memo: `入力元: Saxo取引履歴 / 履歴補完: 要確認。${item.sourceIdMasked ? `履歴ID: ${item.sourceIdMasked}。` : ""}正式保存前にSaxo履歴と照合してください。`,
            confirmed: false,
          },
        ],
      });
    }
    setQuoteStatus("履歴候補から作成された建玉開始確認があります。3-Aで内容を確認してください。");
    return { simulationId: target.id };
  };
  const openSelectedSimulationHistoryTarget = (anchorId: "option-entry-executions" | "option-close-executions" | "stock-acquisition-record", sourceTradeId?: string) => {
    const latestState = useOptionsStore.getState();
    const latestSimulations = latestState.simulations;
    const latestSelected =
      latestSimulations.find((simulation) => simulation.id === latestState.selectedSimulationId) ??
      latestSimulations.find((simulation) => simulation.id === selected?.id);
    const sourceCandidate = sourceTradeId ? saxoHistoryCandidates.find((candidate) => candidate.id === sourceTradeId) : undefined;
    const sourceKeys = sourceCandidate ? getSaxoHistoryCandidateKeys(sourceCandidate) : sourceTradeId ? [sourceTradeId] : [];
    const closeTarget = anchorId === "option-close-executions" && sourceTradeId
      ? latestSimulations
          .map((simulation) => ({
            simulation,
            execution: (simulation.optionCloseExecutions ?? []).find(
              (execution) =>
                sourceKeys.includes(execution.sourceCandidateId ?? "") ||
                sourceKeys.includes(execution.sourceTradeId ?? "") ||
                Boolean(sourceCandidate && simulation.optionLegs.some((leg) => isSaxoHistoryMatchingCloseExecution(simulation, leg, execution, sourceCandidate))),
            ),
          }))
          .find((item) => item.execution)
      : undefined;
    const entryTarget = anchorId === "option-entry-executions" && sourceTradeId
      ? latestSimulations
          .map((simulation) => ({
            simulation,
            execution: (simulation.optionEntryExecutions ?? []).find(
              (execution) =>
                (execution.historyCandidateIds ?? []).some((candidateId) => sourceKeys.includes(candidateId)) ||
                Boolean(sourceCandidate && simulation.optionLegs.some((leg) => isSaxoHistoryMatchingEntryExecution(simulation, leg, execution, sourceCandidate))),
            ),
          }))
          .find((item) => item.execution)
      : undefined;
    const stockTarget = anchorId === "stock-acquisition-record" && sourceTradeId
      ? latestSimulations.find((simulation) => {
          const acquisition = simulation.stockAcquisition;
          if (!acquisition?.enabled) return false;
          return (
            sourceKeys.includes(acquisition.sourceCandidateId ?? "") ||
            sourceKeys.includes(acquisition.sourceTradeId ?? "") ||
            sourceKeys.includes(acquisition.sourceStockCandidateId ?? "") ||
            Boolean(sourceCandidate && isSaxoHistoryMatchingStockAcquisition(simulation, acquisition, sourceCandidate))
          );
        })
      : undefined;
    const target = closeTarget?.simulation ?? entryTarget?.simulation ?? stockTarget ?? latestSelected ?? latestSimulations[0];
    if (!target) {
      setQuoteStatus("建玉入力へ移動できません。先に建玉を作成または選択してください。");
      return;
    }
    setActiveView("positions");
    selectSimulation(target.id);
    setIsEditorOpen(true);
    if (anchorId === "option-close-executions" && sourceTradeId) {
      const matchedExecution = closeTarget?.execution ?? (target.optionCloseExecutions ?? []).find(
        (execution) =>
          sourceKeys.includes(execution.sourceCandidateId ?? "") ||
          sourceKeys.includes(execution.sourceTradeId ?? "") ||
          Boolean(sourceCandidate && target.optionLegs.some((leg) => isSaxoHistoryMatchingCloseExecution(target, leg, execution, sourceCandidate))),
      );
      setEditorFocusRequest({
        anchorId: matchedExecution ? `option-close-execution-${matchedExecution.id}` : "option-close-executions",
        requestId: Date.now() + Math.random(),
        saxoHistoryIssue: matchedExecution ? undefined : "missing-close-candidate",
        sourceTradeId,
      });
    } else if (anchorId === "option-entry-executions" && sourceTradeId) {
      setEditorFocusRequest({
        anchorId: "option-entry-executions",
        requestId: Date.now() + Math.random(),
        sourceTradeId,
      });
    } else if (anchorId === "stock-acquisition-record" && sourceTradeId) {
      setEditorFocusRequest({
        anchorId: "stock-acquisition-record",
        requestId: Date.now() + Math.random(),
        sourceTradeId,
      });
    } else {
      setEditorFocusRequest({ anchorId, requestId: Date.now() + Math.random() });
    }
    setQuoteStatus(
      anchorId === "stock-acquisition-record"
        ? "履歴候補から作成された権利行使・現物株取得候補があります。6-Aで内容を確認してください。"
      : anchorId === "option-entry-executions"
        ? "履歴候補から作成された建玉開始確認があります。3-Aで内容を確認してください。"
      : "履歴候補から作成された決済実績があります。7. 決済実績で内容を確認してください。",
    );
  };
  const returnToSaxoHistoryCandidates = () => {
    setIsEditorOpen(false);
    setQuoteStatus("Saxo APIパネルの履歴候補へ戻り、反映候補を作り直してください。");
  };
  const recreateSaxoHistoryCandidate = (sourceTradeId?: string) => {
    const item = sourceTradeId ? saxoHistoryCandidates.find((candidate) => candidate.id === sourceTradeId) : undefined;
    if (!item) {
      setQuoteStatus("対応するSaxo履歴候補が見つかりません。Saxo APIパネルで履歴候補を再取得してください。");
      setIsEditorOpen(false);
      return;
    }
    const created = applySaxoHistoryDraftToSelectedSimulation(item);
    const targetId = created.simulationId ?? selected?.id ?? simulations[0]?.id;
    if (!targetId) return;
    setActiveView("positions");
    selectSimulation(targetId);
    setIsEditorOpen(true);
    setEditorFocusRequest({
      anchorId: created.closeExecutionId ? `option-close-execution-${created.closeExecutionId}` : "option-close-executions",
      requestId: Date.now() + Math.random(),
      saxoHistoryIssue: created.closeExecutionId ? undefined : "missing-close-candidate",
      sourceTradeId: item.id,
    });
  };
  const selectOnly = (id: string) => {
    selectSimulation(id);
    setIsEditorOpen(false);
  };
  const goToCloseDecision = (simulationId: string, warning: RiskWarning) => {
    if (!warning.actionAnchorId) return;
    selectSimulation(simulationId);
    if (["option-entry-executions", "option-close-executions", "stock-acquisition-record", "stock-settlement-record"].includes(warning.actionAnchorId)) {
      setIsEditorOpen(true);
      setEditorFocusRequest({ anchorId: warning.actionAnchorId, requestId: Date.now() });
      return;
    }
    setIsEditorOpen(false);
    setCloseDecisionFocusRequest({ anchorId: warning.actionAnchorId, requestId: Date.now() });
  };
  const goToWorkflowTask = (simulationId: string, task: WorkflowTask) => {
    selectSimulation(simulationId);
    const anchorId = getWorkflowTargetAnchorId(task);
    if (task.targetAnchor === "close-decision") {
      setIsEditorOpen(false);
      setCloseDecisionFocusRequest({ anchorId: task.focusField ?? anchorId, requestId: Date.now() });
      return;
    }
    setIsEditorOpen(true);
    setEditorFocusRequest({ anchorId, requestId: Date.now() });
  };
  const goToPendingCashEffectSource = (effect: PendingAccountCashEffect) => {
    selectSimulation(effect.sourceSimulationId);
    setIsEditorOpen(true);
    setEditorFocusRequest({ anchorId: `option-close-execution-${effect.sourceExecutionId}`, requestId: Date.now() });
  };
  const goToYearlyPerformanceIssue = (issue: YearlyPerformanceIssue) => {
    setActiveView("positions");
    selectSimulation(issue.simulationId);
    setIsEditorOpen(true);
    setEditorFocusRequest({ anchorId: issue.targetAnchor, requestId: Date.now() });
  };
  const acceptFirstRunNotice = () => {
    window.localStorage.setItem("us-options-first-run-notice-accepted", "true");
    setHasAcceptedNotice(true);
  };

  if (!selected) {
    return (
      <main className="min-h-screen bg-slate-100 text-slate-950">
        {!hasAcceptedNotice ? <FirstRunNotice onAccept={acceptFirstRunNotice} /> : null}
        <AppHeader
          activeWorkspace={activeWorkspace}
          switchWorkspace={switchWorkspace}
          createSimulationFromTemplate={createAndOpenEditor}
          onCsv={downloadCsv}
          onJson={downloadJson}
          onImportJson={() => importInputRef.current?.click()}
          onToggleGuide={() => setIsGuideOpen((current) => !current)}
          onToggleData={() => setIsDataOpen((current) => !current)}
          onToggleCandidates={() => setIsCandidatesOpen((current) => !current)}
          activeView={activeView}
          onViewChange={setActiveView}
          onRefreshQuote={refreshAllQuotes}
          onRefreshFx={refreshAllFx}
          externalQuoteModeLabel={externalQuoteModeLabel}
          quoteStatus=""
        />
        <input ref={importInputRef} className="hidden" type="file" accept="application/json,.json" onChange={(event) => void importJson(event.target.files?.[0] ?? null)} />
        <div className="mx-auto grid max-w-[1440px] gap-5 px-4 py-5">
          {isGuideOpen ? <UserGuide onClose={() => setIsGuideOpen(false)} /> : null}
          {isDataOpen ? <DataPanel externalQuoteModeLabel={externalQuoteModeLabel} onClose={() => setIsDataOpen(false)} /> : null}
          {activeView === "performance" ? (
            <PerformanceView
              summary={yearlyPerformanceSummary}
              selectedYear={performanceYear}
              onYearChange={setPerformanceYear}
              onIssueAction={goToYearlyPerformanceIssue}
            />
          ) : (
            <>
              <Dashboard
                simulations={simulations}
                stockTransfers={stockTransfers}
                selectedId=""
                onSelect={selectOnly}
                onEdit={selectAndOpenEditor}
                onDelete={deleteSimulation}
                workspace={activeWorkspace}
                accountInputs={accountInputs}
                historyOpen={dashboardHistoryOpen}
                onHistoryOpenChange={setDashboardHistoryOpen}
                onWarningAction={goToCloseDecision}
                onWorkflowTaskAction={goToWorkflowTask}
              />
              <SaxoReadOnlyPanel
                workspace={activeWorkspace}
                accountInputs={accountInputs}
                simulations={simulations}
                onApplyAccountState={updateAccountState}
                onOrdersChange={setSaxoOrderCandidates}
                onHistoryCandidatesChange={setSaxoHistoryCandidates}
                onCreateHistoryDraft={applySaxoHistoryDraftToSelectedSimulation}
                onCreateAssignmentDraft={applySaxoAssignmentDraftToSelectedSimulation}
                onCreatePositionDraft={createSimulationFromSaxoPosition}
                onCreateStockTransferFromPosition={createStockTransferFromSaxoPosition}
                stockTransfers={stockTransfers}
                onOpenLinkedSimulation={openSimulationEditorAt}
                onOpenHistoryTarget={openSelectedSimulationHistoryTarget}
                onOpenWheelManagement={openWheelManagement}
                onDownloadJson={downloadJson}
              />
              {isCandidatesOpen ? (
                <CandidatePanel
                  candidates={candidates}
                  importWarnings={importWarnings}
                  simulations={simulations}
                  onImport={importCandidateSymbols}
                  onClear={clearCandidates}
                  onWatchOnly={markCandidateWatchOnly}
                  onCreateSimulation={createCandidateSimulation}
                />
              ) : null}
              <AccountOverview
                workspace={activeWorkspace}
                accountInputs={accountInputs}
                pendingCashEffects={pendingCashEffects}
                onApplyCashEffect={(effect) => applyAccountCashAdjustment(createAccountCashAdjustment(effect))}
                onResolveCashEffect={goToPendingCashEffectSource}
                onChange={updateAccountState}
              />
              <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-bold text-slate-950">
                  {activeWorkspace === "demo" ? "デモ口座の建玉がありません" : "リアル口座の建玉がありません"}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  デモ口座とリアル口座は別々に保存されます。リアル口座側にはデモサンプルを自動投入しないため、実口座画面を見ながら建玉を新規登録してください。
                </p>
                <button
                  className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                  onClick={createAndOpenEditor}
                >
                  <Plus size={16} />
                  新規建玉
                </button>
              </section>
              {activeWorkspace === "live" ? (
                <WheelPanel cycles={wheelCycles} events={wheelEvents} stockTransfers={stockTransfers} focusRequest={wheelFocusRequest} />
              ) : (
                <DemoWheelNotice />
              )}
            </>
          )}
        </div>
      </main>
    );
  }

  const selectedSanitized = sanitizeSaxoHistoryCloseExecutions(selected);
  const selectedWithAccount = {
    ...selectedSanitized,
    availableCashJPY:
      selectedSanitized.accountEnvironment === "PROD_N_USD_SETTLEMENT"
        ? accountInputs.N.cashBalance * (selectedSanitized.referenceFxRateJPY ?? selectedSanitized.fxRateJPY)
        : accountInputs.P.cashBalance,
    marginUsagePercent:
      selectedSanitized.accountEnvironment === "PROD_N_USD_SETTLEMENT"
        ? accountInputs.N.marginUsagePercent
        : accountInputs.P.marginUsagePercent,
  };
  const historyPerformance = calculateHistoryPerformance(selectedWithAccount);
  const historyResultMode = historyPerformance.historyResultMode;
  const showSelectedHistoryDetails = historyResultMode && dashboardHistoryOpen;
  const assignedShortPutLeg = historyPerformance.assignedShortPutLeg;
  const assignedPutStockHoldingMode = historyPerformance.assignedPutStockHoldingMode;
  const assignedDenominatorFx = historyPerformance.assignedPutDenominatorFx ?? 0;
  const assignedDenominatorShares = historyPerformance.assignedPutDenominatorShares ?? 0;
  const assignedPutDenominatorJPY = historyPerformance.assignedPutDenominatorJPY;
  const assignedPutDenominatorFormula =
    assignedPutDenominatorJPY !== undefined && assignedShortPutLeg
      ? `計算式: ${formatNumber(assignedShortPutLeg.strikeUSD)} USD × ${assignedDenominatorShares}株 × ${formatNumber(assignedDenominatorFx)} = ${formatJPY(assignedPutDenominatorJPY)}`
      : undefined;
  const taxSimulation = historyPerformance.taxSimulation;
  const primary = historyPerformance.primaryGrossDenominator;
  const taxResult = historyPerformance.taxResult;
  const taxProfile = taxProfiles[selected.taxProfileId];
  const stockSettlementTax = calculateStockSettlementTaxResult(selectedWithAccount);
  const taxBucketSummary = calculateTaxBucketSummary(simulations);
  const denominators = historyPerformance.denominators;
  const primaryWithNet = historyPerformance.primaryDenominator;
  const nisaComparison = calculateNisaComparison({
    netProfitJPY: taxResult.netProfitJPY,
    denominatorJPY: primary.amountJPY,
    days: taxSimulation.dte,
    expectedAnnualReturnPct: selected.nisaExpectedAnnualReturnPct ?? DEFAULT_NISA_EXPECTED_ANNUAL_RETURN_PCT,
    taxRatePct: taxProfile.taxRatePct,
  });
  const warnings = generateRiskWarnings(selectedWithAccount, { stockTransferRecorded: selectedStockTransferRecorded });
  const countableWarnings = warnings.filter((warning) => warning.severity !== "info");
  const checklist = generateChecklist(selectedWithAccount).map((item) => ({
    ...item,
    passed: selected.preOrderChecklist?.[item.id] ?? false,
  }));
  const updateChecklist = (id: string, checked: boolean) => {
    upsertSimulation({
      ...selected,
      preOrderChecklist: {
        ...(selected.preOrderChecklist ?? {}),
        [id]: checked,
      },
    });
  };
  const scenarios = calculateScenarioResults(selectedWithAccount);
  const payoff = calculatePayoffSeries(selectedWithAccount);
  const coveredCallAssignmentPreview = calculateCoveredCallAssignmentPreview(
    selectedWithAccount,
    taxResult,
    primaryWithNet,
  );

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      {!hasAcceptedNotice ? <FirstRunNotice onAccept={acceptFirstRunNotice} /> : null}
      <AppHeader
        activeWorkspace={activeWorkspace}
        switchWorkspace={switchWorkspace}
        createSimulationFromTemplate={createAndOpenEditor}
        onCsv={downloadCsv}
        onJson={downloadJson}
        onImportJson={() => importInputRef.current?.click()}
        onToggleGuide={() => setIsGuideOpen((current) => !current)}
        onToggleData={() => setIsDataOpen((current) => !current)}
        onToggleCandidates={() => setIsCandidatesOpen((current) => !current)}
        activeView={activeView}
        onViewChange={setActiveView}
        onRefreshQuote={refreshAllQuotes}
        onRefreshFx={refreshAllFx}
        externalQuoteModeLabel={externalQuoteModeLabel}
        quoteStatus={quoteStatus}
      />
      <input ref={importInputRef} className="hidden" type="file" accept="application/json,.json" onChange={(event) => void importJson(event.target.files?.[0] ?? null)} />
      <div className="mx-auto grid max-w-[1440px] gap-5 px-4 py-5">
        {isGuideOpen ? <UserGuide onClose={() => setIsGuideOpen(false)} /> : null}
        {isDataOpen ? <DataPanel externalQuoteModeLabel={externalQuoteModeLabel} onClose={() => setIsDataOpen(false)} /> : null}
        {activeView === "performance" ? (
          <PerformanceView
            summary={yearlyPerformanceSummary}
            selectedYear={performanceYear}
            onYearChange={setPerformanceYear}
            onIssueAction={goToYearlyPerformanceIssue}
          />
        ) : (
          <>
            <Dashboard
              simulations={simulations}
              stockTransfers={stockTransfers}
              selectedId={selected.id}
              onSelect={selectOnly}
              onEdit={selectAndOpenEditor}
              onDelete={deleteSimulation}
              workspace={activeWorkspace}
              accountInputs={accountInputs}
              historyOpen={dashboardHistoryOpen}
              onHistoryOpenChange={setDashboardHistoryOpen}
              onWarningAction={goToCloseDecision}
              onWorkflowTaskAction={goToWorkflowTask}
            />
            <SaxoReadOnlyPanel
              workspace={activeWorkspace}
              accountInputs={accountInputs}
              simulations={simulations}
              onApplyAccountState={updateAccountState}
              onOrdersChange={setSaxoOrderCandidates}
              onHistoryCandidatesChange={setSaxoHistoryCandidates}
              onCreateHistoryDraft={applySaxoHistoryDraftToSelectedSimulation}
              onCreateAssignmentDraft={applySaxoAssignmentDraftToSelectedSimulation}
              onCreatePositionDraft={createSimulationFromSaxoPosition}
              onCreateStockTransferFromPosition={createStockTransferFromSaxoPosition}
              stockTransfers={stockTransfers}
              onOpenLinkedSimulation={openSimulationEditorAt}
              onOpenHistoryTarget={openSelectedSimulationHistoryTarget}
              onOpenWheelManagement={openWheelManagement}
              onDownloadJson={downloadJson}
            />
            {isCandidatesOpen ? (
              <CandidatePanel
                candidates={candidates}
                importWarnings={importWarnings}
                simulations={simulations}
                onImport={importCandidateSymbols}
                onClear={clearCandidates}
                onWatchOnly={markCandidateWatchOnly}
                onCreateSimulation={createCandidateSimulation}
              />
            ) : null}
            <AccountOverview
              workspace={activeWorkspace}
              accountInputs={accountInputs}
              referenceFxRateJPY={selected.referenceFxRateJPY ?? selected.fxRateJPY}
              pendingCashEffects={pendingCashEffects}
              onApplyCashEffect={(effect) => applyAccountCashAdjustment(createAccountCashAdjustment(effect))}
              onResolveCashEffect={goToPendingCashEffectSource}
              onChange={updateAccountState}
            />
            {isEditorOpen ? (
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <button
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  onClick={() => setIsEditorOpen(false)}
                >
                  <span>
                    <span className="block text-lg font-bold text-slate-950">建玉入力</span>
                    <span className="mt-1 block text-sm text-slate-600">
                      Saxo画面の数値を入力・修正します。閉じると俯瞰画面に戻ります。
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
                    <ChevronUp size={16} />
                    閉じる
                  </span>
                </button>
                <div className="border-t border-slate-200 p-4">
                  <SimulationEditor
                    simulation={selected}
                    workspace={activeWorkspace}
                    canUseExternalQuotes={canUseExternalQuotes}
                    externalQuoteModeLabel={externalQuoteModeLabel}
                    onChange={upsertSimulation}
                    saxoHistoryCandidates={saxoHistoryCandidates}
                    onDiscardDraft={(id) => {
                      deleteSimulation(id);
                      setIsEditorOpen(false);
                      setQuoteStatus("API取込下書きを破棄しました。正式建玉や口座残高は変更していません。");
                    }}
                    focusRequest={editorFocusRequest}
                    onCloseEditor={() => setIsEditorOpen(false)}
                    stockTransfer={selectedStockTransfer}
                    onStockAcquisitionCompleteClose={() => {
                      setIsEditorOpen(false);
                      if (selectedStockTransfer) {
                        openWheelManagement(selected.ticker);
                        setQuoteStatus("P→N株式移管は記録済みです。現在はN口座で株式保有中です。N口座ホイールを確認し、JSONバックアップを保存してください。");
                      }
                    }}
                    onReturnToSaxoHistory={returnToSaxoHistoryCandidates}
                    onRecreateSaxoHistoryCandidate={recreateSaxoHistoryCandidate}
                    onCloseDecisionAction={(anchorId) => {
                      setIsEditorOpen(false);
                      setCloseDecisionFocusRequest({ anchorId, requestId: Date.now() });
                    }}
                  />
                </div>
              </section>
            ) : null}
            {historyResultMode ? (
              <HistoryStatusCard
                simulation={selectedWithAccount}
                stockHoldingMode={assignedPutStockHoldingMode}
                assignedPutLeg={assignedShortPutLeg}
                denominatorFormula={assignedPutDenominatorFormula}
                stockTransfer={selectedStockTransfer}
              />
            ) : null}
            {!historyResultMode || showSelectedHistoryDetails ? (
              <SummaryCards
                simulation={taxSimulation}
                primaryDenominator={primaryWithNet}
                taxResult={taxResult}
                blockingCount={countableWarnings.filter((warning) => warning.blocking).length}
                coveredCallAssignmentPreview={historyResultMode ? null : coveredCallAssignmentPreview}
                primaryWarning={countableWarnings.find((warning) => warning.blocking) ?? countableWarnings[0]}
                onWarningAction={(warning) => goToCloseDecision(selected.id, warning)}
                historyMode={showSelectedHistoryDetails}
                stockHoldingMode={assignedPutStockHoldingMode}
                denominatorFormula={assignedPutDenominatorFormula}
                stockTransfer={selectedStockTransfer}
              />
            ) : null}
            {historyResultMode && !showSelectedHistoryDetails ? (
              <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600 shadow-sm">
                履歴一覧を畳んでいるため、終了済みプット売り1件の実績カードは非表示です。履歴1件の確定オプション収入・年率を確認する場合は、上の建玉ダッシュボードで履歴を表示して対象行を選んでください。
              </section>
            ) : null}
            {showSelectedHistoryDetails ? (
              <DenominatorTable
                denominators={denominators}
                collapsible
                defaultOpen={false}
                title="分母の参考比較"
                subtitle="終了済み履歴では参考表示です。主な確認は実績分母を見ます。"
              />
            ) : !historyResultMode ? (
              <>
                <DenominatorTable denominators={denominators} />
                <AnnualReturnFormula
                  simulation={selectedWithAccount}
                  primaryDenominator={primaryWithNet}
                  taxResult={taxResult}
                />
                <TaxComparisonCard
                  taxResult={taxResult}
                  nisaComparison={nisaComparison}
                  stockSettlementTax={stockSettlementTax}
                  taxBucketSummary={taxBucketSummary}
                />
                <ScenarioCards scenarios={scenarios} />
                <CloseDecisionCard
                  simulation={selected}
                  saxoOrderCandidates={saxoOrderCandidates}
                  onChange={upsertSimulation}
                  focusRequest={closeDecisionFocusRequest}
                  onExecutionDraft={() => {
                    setIsEditorOpen(true);
                    setEditorFocusRequest({ anchorId: "option-close-executions", requestId: Date.now() });
                  }}
                />
                <section className="grid gap-4 xl:grid-cols-2">
                  <PayoffChart simulation={selectedWithAccount} points={payoff} />
                  <DenominatorChart denominators={denominators} />
                </section>
                <RiskPanel warnings={warnings} checklist={checklist} onChecklistChange={updateChecklist} onWarningAction={(warning) => goToCloseDecision(selected.id, warning)} />
              </>
            ) : null}
            {activeWorkspace === "live" ? (
              <WheelPanel
                cycles={wheelCycles}
                events={wheelEvents}
                stockTransfers={stockTransfers}
                focusRequest={wheelFocusRequest}
                onCreateFromSelected={() => createWheelCycleFromSimulation(selected)}
                selectedTransferRecorded={selectedStockTransferRecorded}
                onCreateTransferFromSelected={canCreateStockTransferFromSelected ? () => createStockTransferFromSimulation(selected) : undefined}
              />
            ) : (
              <DemoWheelNotice />
            )}
          </>
        )}
      </div>
    </main>
  );
}

function HistoryStatusCard({
  simulation,
  stockHoldingMode,
  assignedPutLeg,
  denominatorFormula,
  stockTransfer,
}: {
  simulation: TradeSimulation;
  stockHoldingMode: boolean;
  assignedPutLeg?: TradeSimulation["optionLegs"][number];
  denominatorFormula?: string;
  stockTransfer?: StockTransferEvent;
}) {
  const acquisition = simulation.stockAcquisition;
  const ticker = simulation.ticker || simulation.underlyingName || "対象銘柄";
  const isTransferredToN = Boolean(stockTransfer);
  const accountLabel =
    acquisition?.accountEnvironment === "PROD_N_USD_SETTLEMENT"
      ? "N口座 / USD"
      : acquisition?.accountEnvironment === "DEMO_JPY_BASE"
        ? "DEMO / JPY"
        : "P口座 / JPY";
  const currentHoldingLabel = isTransferredToN ? "N口座 / USD" : accountLabel;
  const sourceText =
    stockHoldingMode && acquisition && assignedPutLeg
      ? `${acquisition.acquisitionDate} ${ticker} ${formatNumber(assignedPutLeg.strikeUSD)}P 権利行使`
      : `${getStatusLabel(simulation.status)}の実績履歴`;

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-amber-700">現在の状態</p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">
            {stockHoldingMode && acquisition
              ? `オプション建玉はありません。${currentHoldingLabel}で${ticker} ${stockTransfer?.shares ?? acquisition.shares}株を保有しています。`
              : `${getStatusLabel(simulation.status)}の履歴実績を確認しています。`}
          </h2>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-amber-800 ring-1 ring-amber-200">
          履歴実績モード
        </span>
      </div>
      <div className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-3">
        <div>
          <div className="font-bold text-slate-900">取得元</div>
          <p className="mt-1">{sourceText}</p>
        </div>
        <div>
          <div className="font-bold text-slate-900">次にやること</div>
          <p className="mt-1">
            {stockHoldingMode
              ? isTransferredToN
                ? "JSONバックアップを保存してください。カバードコールを始める場合はC売り候補を確認します。"
                : "JSONバックアップを保存。P→N移管した場合のみ移管記録へ進みます。"
              : "実績入力を確認し、必要ならJSONバックアップを保存します。"}
          </p>
        </div>
        <div>
          <div className="font-bold text-slate-900">実績分母</div>
          <p className="mt-1">
            {denominatorFormula ?? "現物株の現在時価は、終了済みオプションの実績年率には混ぜません。"}
          </p>
        </div>
      </div>
      {stockHoldingMode && acquisition ? (
        <div className="mt-3 rounded-md bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-amber-100">
          <div>取得履歴: {acquisition.acquisitionDate} {accountLabel}で{acquisition.shares}株 @ {formatUSD(acquisition.priceUSD)}を取得</div>
          {stockTransfer ? (
            <>
              <div>移管履歴: {stockTransfer.transferDate} P口座からN口座へ{stockTransfer.shares}株を移管</div>
              <div>現在保有: N口座 / USD / {stockTransfer.shares}株 / 平均取得単価 {formatUSD(stockTransfer.costBasisUSD)}</div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function getStockTransferForSimulation(simulation: TradeSimulation, stockTransfers: StockTransferEvent[]): StockTransferEvent | undefined {
  const shares = simulation.stockPosition?.shares ?? simulation.stockAcquisition?.shares ?? 0;
  if (shares <= 0) return undefined;
  return stockTransfers.find(
    (transfer) =>
      transfer.sourceSimulationId === simulation.id &&
      transfer.toAccountCode === "N" &&
      Math.abs(transfer.shares - shares) <= 0.0001,
  );
}

function DemoWheelNotice() {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-slate-950">DEMO / JPYベース検証</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        DEMOはJPYベースの検証用です。本番USD決済口座の残高管理、JPY→USD資金振替、移管後のUSDホイール台帳を検証済みデータとして扱いません。
      </p>
    </section>
  );
}

function PerformanceView({
  summary,
  selectedYear,
  onYearChange,
  onIssueAction,
}: {
  summary: ReturnType<typeof calculateYearlyPerformanceSummary>;
  selectedYear: number;
  onYearChange: (year: number) => void;
  onIssueAction: (issue: YearlyPerformanceIssue) => void;
}) {
  return (
    <section className="grid gap-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <BarChart3 className="text-teal-700" size={20} />
          <h2 className="text-lg font-bold text-slate-950">成績</h2>
        </div>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          確認済みの決済実績と入力済みの株式譲渡記録だけを、対象年ごとに集計します。注文前・建玉中・反対売買判断の見積もりは含めません。
        </p>
      </div>
      <YearlyPerformanceSummaryCard
        summary={summary}
        selectedYear={selectedYear}
        onYearChange={onYearChange}
        onIssueAction={onIssueAction}
        detailsMode="always"
      />
    </section>
  );
}

function formatSaxoHistoryMismatchMessage(
  simulation: TradeSimulation,
  item: SaxoHistoryDiscoveryItem,
  target: "entry" | "close",
): string {
  const selectedLeg = simulation.optionLegs[0];
  const selectedLabel = selectedLeg
    ? `${normalizeTicker(simulation.ticker) || simulation.ticker || "銘柄未入力"} ${selectedLeg.type.toUpperCase()} ${selectedLeg.strikeUSD} ${selectedLeg.expiryDate}`
    : `${normalizeTicker(simulation.ticker) || simulation.ticker || "銘柄未入力"} / 脚未入力`;
  const historyLabel = [
    item.symbol ?? "銘柄未取得",
    item.optionType && item.optionType !== "unknown" ? item.optionType.toUpperCase() : "Put/Call未取得",
    item.strike === undefined ? "権利行使価格未取得" : item.strike,
    item.expiry ?? "満期未取得",
    item.buySell === "buy" ? "買" : item.buySell === "sell" ? "売" : "売買未取得",
    item.openClose === "open" ? "建玉" : item.openClose === "close" ? "決済" : "新規/決済未取得",
  ].join(" ");
  const destination = target === "close" ? "決済実績" : "建玉開始確認";
  return `この履歴は ${historyLabel} の履歴で、選択中の ${selectedLabel} とは銘柄、Put/Call、権利行使価格、満期、数量、口座区分のいずれかが一致しません。${selectedLabel} の${destination}には使えません。`;
}

function AppHeader({
  activeWorkspace,
  switchWorkspace,
  createSimulationFromTemplate,
  onCsv,
  onJson,
  onImportJson,
  onToggleGuide,
  onToggleData,
  onToggleCandidates,
  activeView,
  onViewChange,
  onRefreshQuote,
  onRefreshFx,
  externalQuoteModeLabel,
  quoteStatus,
}: {
  activeWorkspace: "demo" | "live";
  switchWorkspace: (workspace: "demo" | "live") => void;
  createSimulationFromTemplate: () => void;
  onCsv: () => void;
  onJson: () => void;
  onImportJson: () => void;
  onToggleGuide: () => void;
  onToggleData: () => void;
  onToggleCandidates: () => void;
  activeView: "positions" | "performance";
  onViewChange: (view: "positions" | "performance") => void;
  onRefreshQuote?: () => void;
  onRefreshFx?: () => void;
  externalQuoteModeLabel: string;
  quoteStatus: string;
}) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-normal">米国株オプション建玉管理・リスク確認</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <div className="flex rounded-md border border-slate-300 bg-slate-50 p-0.5">
            <button
              className={`rounded px-3 py-1.5 text-sm font-bold ${
                activeWorkspace === "demo" ? "bg-sky-600 text-white" : "text-slate-700"
              }`}
              onClick={() => switchWorkspace("demo")}
            >
              DEMO
            </button>
            <button
              className={`rounded px-3 py-1.5 text-sm font-bold ${
                activeWorkspace === "live" ? "bg-red-600 text-white" : "text-slate-700"
              }`}
              onClick={() => switchWorkspace("live")}
            >
              REAL
            </button>
          </div>
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-sm font-semibold text-slate-900"
            onClick={() => {
              onViewChange("positions");
              createSimulationFromTemplate();
            }}
          >
            <Plus size={16} />
            新規建玉
          </button>
          <button
            className={`inline-flex h-9 items-center gap-1 rounded-md border px-2 text-sm font-semibold ${
              activeView === "performance"
                ? "border-teal-300 bg-teal-50 text-teal-900"
                : "border-slate-300 bg-white text-slate-900"
            }`}
            onClick={() => onViewChange(activeView === "performance" ? "positions" : "performance")}
            title={activeView === "performance" ? "建玉管理へ戻る" : "成績画面を表示"}
          >
            <BarChart3 size={16} />
            成績
          </button>
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-900"
            onClick={onToggleGuide}
            title="このアプリの使い方とデータ保存方針を表示"
            aria-label="使い方"
          >
            <HelpCircle size={16} />
          </button>
          <button
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900"
            onClick={onToggleCandidates}
            title="候補リストを表示"
          >
            <ListChecks size={16} />
            候補
          </button>
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-900"
            onClick={onToggleData}
            title="データ管理: この端末に保存された入力データの説明と削除"
            aria-label="データ管理"
          >
            <Database size={16} />
          </button>
          <button
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900 disabled:opacity-40"
            onClick={onRefreshQuote}
            disabled={!onRefreshQuote}
            title="登録済み建玉の全銘柄について、現在株価を公開クオートから一括取得"
          >
            <TrendingUp size={16} />
            株価
          </button>
          <button
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900 disabled:opacity-40"
            onClick={onRefreshFx}
            disabled={!onRefreshFx}
            title="USD/JPY為替レートを取得し、登録済み建玉すべてに一括反映"
          >
            <JapaneseYen size={16} />
            為替
          </button>
          <button
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900"
            onClick={onCsv}
          >
            <Download size={16} />
            CSV
          </button>
          <button
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900"
            onClick={onJson}
            title="このワークスペースの建玉をJSONでバックアップ"
          >
            <FileJson size={16} />
            JSON
          </button>
          <button
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900"
            onClick={onImportJson}
            title="JSONバックアップからこのワークスペースへ復元"
          >
            <Upload size={16} />
            復元
          </button>
        </div>
      </div>
      <div className={activeWorkspace === "demo" ? "bg-sky-50 text-sky-900" : "bg-red-50 text-red-900"}>
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm font-semibold">
          <span>
            {activeWorkspace === "demo"
              ? "DEMO口座ワークスペース: 開発・練習用です。実取引データとは分けて保存します。"
              : "REAL口座ワークスペース: 実資金を前提にした管理用です。DEMOとは別保存です。"}
          </span>
          <span className="font-normal">{quoteStatus || externalQuoteModeLabel}</span>
        </div>
      </div>
    </header>
  );
}
