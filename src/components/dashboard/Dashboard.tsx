import type { RiskWarning, StockTransferEvent, TradeSimulation, WheelCycle, WorkflowTask } from "@/types/domain";
import type { AccountInputs, WorkspaceMode } from "@/store/useOptionsStore";
import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import { calculateDenominators, getPrimaryDenominator } from "@/domain/denominators";
import { calculateDashboardPremiumDisplay } from "@/domain/dashboardDisplay";
import { calculateCurrentPositionEstimate, getSyntheticPutAssignmentPolicy } from "@/domain/currentPositionEstimate";
import { getCompositeAssignmentFunding, getCompositeOptionLifecycle, getSyntheticForwardMarginCheck, isCompositeOptionStrategy } from "@/domain/compositeOptionPosition";
import { resolveEffectiveCoveredCallSimulation } from "@/domain/coveredCallCoverage";
import { getJournalStatusLabel, getJournalStatusTone } from "@/domain/entryRationaleJournal";
import { calculateHistoryPerformance } from "@/domain/historyPerformance";
import { generateRiskWarnings } from "@/domain/riskRules";
import { getStatusLabel, getStrategyLabel } from "@/domain/strategyLabels";
import { getPrimaryWorkflowTask, getWorkflowTasks } from "@/domain/workflowTasks";
import { getClosedSyntheticLegHistoryItems, getOptionCloseCompletion, getOptionLegCloseProgress, type ClosedSyntheticLegHistoryItem } from "@/domain/optionCloseExecutions";
import { formatJPY, formatPct, formatUSD } from "@/lib/format";
import type { FxQuote } from "@/lib/marketData";
import { formatCurrentEstimateFxEvidence } from "@/domain/currentEstimateFx";
import { formatCurrentPriceStrikeDifference, formatCurrentPriceStrikePercent, getCurrentPriceStrikeDisplay } from "@/domain/currentPriceStrikeDisplay";
import { getBulkApplicableTargetIds, getBulkOptionPricePreviewCounts, type CurrentOptionPricePreviewRow } from "@/domain/bulkOptionPrice";
import { getSaxoExitOrderReviews, type SaxoApiOrderSnapshot } from "@/features/saxo/saxoAccountSync";

const statusClassName = {
  planned: "bg-sky-100 text-sky-800",
  entry_confirmation: "bg-amber-100 text-amber-800",
  open: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-200 text-slate-700",
  assigned: "bg-violet-100 text-violet-800",
  expired: "bg-amber-100 text-amber-800",
};

const endedStatuses = new Set(["closed", "assigned", "expired"]);

function formatSignedUSD(value: number): string {
  return `${value > 0 ? "+" : ""}${formatUSD(value)}`;
}

/** Rows for confirmed legs of a still-open synthetic parent.  These are history
 * rows, deliberately rendered in the normal history tbody rather than as a
 * second dashboard card. */
function ClosedLegHistoryRows({ items, onOpen }: { items: ClosedSyntheticLegHistoryItem[]; onOpen?: (simulationId: string, executionId: string) => void }) {
  return <>{items.map((item) => {
      const isN = item.simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
      const parentRemaining = getOptionLegCloseProgress(item.simulation).legs.filter((leg) => leg.legId !== item.legId).reduce((sum, leg) => sum + (leg.remainingContracts ?? 0), 0);
      const primaryResults = item.closeResults.filter((result) => isN ? Number.isFinite(result.execution.realizedPnlUSD) : Number.isFinite(result.execution.brokerRealizedPnlJPY));
      const primaryComplete = primaryResults.length === item.executions.length;
      const totalPrimary = primaryResults.reduce((sum, result) => sum + (isN ? result.realizedPnlUSD : result.realizedPnlJPY), 0);
      const referenceComplete = isN && item.closeResults.length === item.executions.length && item.executions.every((execution) => Number.isFinite(execution.brokerExchangeRateJPY ?? execution.fxRateJPY) && (execution.brokerExchangeRateJPY ?? execution.fxRateJPY)! > 0);
      const label = item.leg.type === "call" ? "C買い" : "P売り";
      const firstResult = item.closeResults[0];
      const action = () => onOpen?.(item.simulationId, item.executionIds[0]);
      return <tr
        key={item.id}
        data-history-kind="closed_leg"
        className="cursor-pointer border-b border-slate-100 bg-slate-50 text-slate-600 hover:bg-slate-100"
        onClick={action}
      >
        <td className="py-3 pr-3 font-bold text-slate-950">{getSimulationTickerDisplayLabel(item.simulation)}</td>
        <td className="py-3 pr-3"><span className="rounded bg-slate-200 px-2 py-1 text-xs font-bold text-slate-700">決済済み・親戦略継続中</span></td>
        <td className="py-3 pr-3">{item.simulation.accountCode} / {item.simulation.accountCurrency}</td>
        <td className="py-3 pr-3 font-semibold">Synthetic Forward内 {label}</td>
        <td className="numeric-input py-3 pr-3 text-right">{item.leg.type === "call" ? "C" : "P"} {formatUSD(item.leg.strikeUSD)}</td>
        <td className="py-3 pr-3">{item.leg.expiryDate}</td>
        <td className="numeric-input py-3 pr-3 text-right">
          {primaryComplete ? <><span className="block">{isN ? formatSignedUSD(totalPrimary) : formatJPY(totalPrimary)}</span><span className="block text-[11px] text-slate-500">建玉時/決済時 {firstResult ? `${formatUSD(firstResult.entryPremiumUSD / (100 * Math.max(1, item.executions[0].contracts)))} / ${item.executions[0].closeKind === "expired" ? "満期" : item.executions[0].closePriceUSD === undefined ? "未確認" : formatUSD(item.executions[0].closePriceUSD)}` : "未確認"}</span></> : <span>実現損益 未確認</span>}
          {isN ? <span className="block text-[11px] text-slate-500">{referenceComplete ? `参考 ${formatJPY(item.closeResults.reduce((sum, result) => sum + result.realizedPnlJPY, 0))}` : "参考JPY未確認"}</span> : null}
        </td>
        <td className="numeric-input py-3 pr-3 text-right">{firstResult ? (isN ? formatUSD(firstResult.denominatorUSD ?? 0) : formatJPY(firstResult.denominatorJPY)) : "未確認"}</td>
        <td className="numeric-input py-3 pr-3 text-right">{primaryComplete && firstResult ? formatPct(firstResult.annualReturnPct) : "未確認"}</td>
        <td className="py-3 pr-3 text-right text-xs font-bold text-emerald-700">{primaryComplete ? "警告なし" : `${isN ? "USD" : "JPY"}実現損益 未確認`}</td>
        <td className="py-3 pr-3 text-xs">親戦略は継続中（{item.leg.type === "call" ? "P売り" : "C買い"}{parentRemaining}枚残存）<span className="block text-slate-500">決済日 {item.closeDate}</span></td>
        <td className="py-3 pr-3 text-right"><button type="button" className="rounded-md border border-teal-300 bg-white px-2 py-1 text-xs font-bold text-teal-800 hover:bg-teal-50" onClick={(event) => { event.stopPropagation(); action(); }}>決済実績を確認</button></td>
      </tr>;
    })}</>;
}

function BulkOptionPricePreview({ rows, simulations, referenceConfirmed, onReferenceConfirmedChange, onApply }: { rows: CurrentOptionPricePreviewRow[]; simulations: TradeSimulation[]; referenceConfirmed: boolean; onReferenceConfirmedChange: (checked: boolean) => void; onApply?: () => void }) {
  const counts = getBulkOptionPricePreviewCounts(rows);
  const applicable = getBulkApplicableTargetIds(rows, simulations, referenceConfirmed);
  const ready = applicable.size;
  const applyLabel = counts.ready === 0 && referenceConfirmed
    ? `確認済み参考価格 ${ready}脚を一括反映`
    : referenceConfirmed && counts.confirmableReference > 0
      ? `通常${counts.ready}脚 + 確認済み参考価格${counts.confirmableReference}脚を一括反映`
      : `取得成功分${ready}脚を一括反映`;
  return <div className="mt-3 overflow-x-auto">
    <table className="w-full min-w-[760px] text-xs">
      <thead><tr className="border-b text-left text-slate-500"><th className="py-1">銘柄 / 脚</th><th>方向</th><th className="text-right">保存中</th><th className="text-right">Bid / Ask / Mid / Last</th><th className="text-right">採用候補</th><th>状態</th></tr></thead>
      <tbody>{rows.map((row) => <tr className="border-b border-slate-100" key={row.target.targetId}>
        <td className="py-1.5">{row.target.ticker} / {row.target.optionType === "call" ? "C" : "P"} {row.target.strike} {row.target.expiry}</td>
        <td>{row.target.side === "buy" ? "売却候補" : "買戻し候補"}</td>
        <td className="text-right">{row.target.savedPriceUSD ?? "—"}</td>
        <td className="text-right">{[row.candidate?.bid, row.candidate?.ask, row.candidate?.mid, row.candidate?.last].map((v) => v ?? "—").join(" / ")}</td>
        <td className="text-right">{row.selectedPriceUSD ?? "—"}{row.selectedField ? ` (${row.selectedField})` : ""}</td>
        <td>{row.reason}{row.selectedField ? ` / ${row.selectedField} ${row.selectedField === "bid" ? row.candidate?.quoteDiagnostics?.priceTypeBid ?? "種別未取得" : row.candidate?.quoteDiagnostics?.priceTypeAsk ?? "種別未取得"}` : ""}{row.candidate?.fetchedAt ? ` / ${row.candidate.fetchedAt}` : ""}</td>
      </tr>)}</tbody>
    </table>
    <p className="mt-2 text-xs text-slate-600">取得成功 {counts.successful}脚 / 通常 {counts.ready}脚 / 参考値・要確認 {counts.confirmableReference}脚 / 反映不可 {counts.unavailable}脚</p>
    {counts.confirmableReference > 0 ? <label className="mt-2 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950"><input type="checkbox" checked={referenceConfirmed} onChange={(event) => onReferenceConfirmedChange(event.target.checked)} /><span>表示中のOldIndicative {counts.confirmableReference}脚を取得時点の参考価格として使用することを確認しました</span></label> : null}
    <div className="mt-2 flex items-center gap-3"><button type="button" disabled={ready === 0} className="rounded bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" onClick={onApply}>{applyLabel}</button><span className="text-xs text-slate-500">合成建玉は二脚がそろう場合だけ同時に反映します。</span></div>
  </div>;
}

export function getSimulationTickerDisplayLabel(simulation: TradeSimulation): string {
  const direct = simulation.ticker.trim();
  if (direct) return direct.toUpperCase();
  const saxoSymbol = simulation.fixtureMeta?.saxoInstrumentCode ?? simulation.optionLegs.find((leg) => leg.brokerSymbol)?.brokerSymbol ?? "";
  const optionSymbolTicker = saxoSymbol.match(/^([A-Z][A-Z0-9.]{0,9})(?:[/:\s_-]|$)/i)?.[1]?.toUpperCase();
  if (optionSymbolTicker && !["PUT", "CALL", "STOCKOPTION", "OPTION"].includes(optionSymbolTicker)) return optionSymbolTicker;
  const underlying = simulation.underlyingName?.trim();
  return underlying || "銘柄未設定";
}

export function Dashboard({
  simulations,
  stockTransfers = [],
  wheelCycles = [],
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  workspace,
  accountInputs,
  historyOpen,
  onHistoryOpenChange,
  onWarningAction,
  onWorkflowTaskAction,
  onHistoryLegAction,
  onJournalAction,
  onCurrentEstimateAction,
  journalFocusSimulationId,
  onClearJournalFocus,
  positionFocusSimulationId,
  onPositionFocus,
  onClearPositionFocus,
  currentEstimateFxQuote,
  onRefreshFx,
  bulkOptionPricePreview,
  bulkOptionPriceMessage,
  bulkOptionPriceAvailable = false,
  onFetchBulkOptionPrices,
  onApplyBulkOptionPrices,
  bulkOptionPriceLoading = false,
  bulkOptionPriceProgress = { total: 0, completed: 0 },
  bulkOptionPriceReferenceConfirmed = false,
  onBulkOptionPriceReferenceConfirmedChange,
  onBulkOptionPriceDialogClose,
  saxoOrders = [],
  onSaxoExitOrderAction,
}: {
  simulations: TradeSimulation[];
  stockTransfers?: StockTransferEvent[];
  wheelCycles?: WheelCycle[];
  selectedId: string;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  workspace: WorkspaceMode;
  accountInputs: AccountInputs;
  historyOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
  onWarningAction?: (simulationId: string, warning: RiskWarning) => void;
  onWorkflowTaskAction?: (simulationId: string, task: WorkflowTask) => void;
  onHistoryLegAction?: (simulationId: string, executionId: string) => void;
  onJournalAction?: (simulationId: string) => void;
  onCurrentEstimateAction?: (simulationId: string, legId?: string, field?: string) => void;
  journalFocusSimulationId?: string | null;
  onClearJournalFocus?: () => void;
  /** Ephemeral detail view. It is intentionally not persisted with simulations. */
  positionFocusSimulationId?: string | null;
  onPositionFocus?: (simulationId: string) => void;
  onClearPositionFocus?: () => void;
  currentEstimateFxQuote?: FxQuote | null;
  onRefreshFx?: () => void;
  bulkOptionPricePreview?: CurrentOptionPricePreviewRow[] | null;
  bulkOptionPriceMessage?: string;
  bulkOptionPriceAvailable?: boolean;
  onFetchBulkOptionPrices?: () => void;
  onApplyBulkOptionPrices?: () => void;
  bulkOptionPriceLoading?: boolean;
  bulkOptionPriceProgress?: { total: number; completed: number };
  bulkOptionPriceReferenceConfirmed?: boolean;
  onBulkOptionPriceReferenceConfirmedChange?: (checked: boolean) => void;
  onBulkOptionPriceDialogClose?: () => void;
  saxoOrders?: SaxoApiOrderSnapshot[];
  onSaxoExitOrderAction?: (simulationId: string, legId: string) => void;
}) {
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const bulkDialogCloseRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!isBulkDialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    bulkDialogCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { setIsBulkDialogOpen(false); onBulkOptionPriceDialogClose?.(); } };
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [isBulkDialogOpen, onBulkOptionPriceDialogClose]);
  const showHistory = historyOpen;
  const currentSimulations = simulations.filter((simulation) => simulation.status === "planned" || simulation.status === "entry_confirmation" || simulation.status === "open");
  const historySimulations = simulations.filter((simulation) => endedStatuses.has(simulation.status));
  const closedLegHistoryItems = !journalFocusSimulationId ? getClosedSyntheticLegHistoryItems(simulations) : [];
  const exitOrderReviews = getSaxoExitOrderReviews(simulations, saxoOrders);
  const pendingExitOrderReviews = exitOrderReviews.filter((review) => review.status === "pending");
  const confirmedExitOrderReviews = exitOrderReviews.filter((review) => review.status === "confirmed");
  const focusedSimulation = positionFocusSimulationId
    ? simulations.find((simulation) => simulation.id === positionFocusSimulationId)
    : journalFocusSimulationId
    ? simulations.find((simulation) => simulation.id === journalFocusSimulationId)
    : undefined;
  const isPositionFocusMode = Boolean(positionFocusSimulationId && focusedSimulation);
  const isJournalFocusMode = Boolean(!isPositionFocusMode && focusedSimulation);
  const visibleSimulations = focusedSimulation ? [focusedSimulation] : [...currentSimulations, ...(showHistory ? historySimulations : [])];
  const hiddenByJournalFocusCount = focusedSimulation ? Math.max(0, simulations.length - 1) : 0;

  return (
    <section id="position-dashboard" tabIndex={-1} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm focus:outline-none">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-slate-950">建玉ダッシュボード</h2>
          <span
            className={`rounded px-2 py-0.5 text-xs font-bold ${
              workspace === "demo" ? "bg-sky-100 text-sky-800" : "bg-red-100 text-red-800"
            }`}
          >
            {workspace === "demo" ? "DEMO 実取引ではありません" : "REAL 実資金管理"}
          </span>
        </div>
        <span className="text-sm text-slate-500">登録済み {simulations.length}件</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {isPositionFocusMode && focusedSimulation ? (
            <>
              <span className="font-semibold text-slate-900">{getSimulationTickerDisplayLabel(focusedSimulation)}を確認中</span>
              {hiddenByJournalFocusCount > 0 ? <span className="text-slate-500">他{hiddenByJournalFocusCount}件を非表示</span> : null}
            </>
          ) : isJournalFocusMode && focusedSimulation ? (
            <>
              <span className="font-semibold text-slate-900">根拠入力中: {getJournalFocusLabel(focusedSimulation)}</span>
              {hiddenByJournalFocusCount > 0 ? <span className="text-slate-500">他{hiddenByJournalFocusCount}件は折りたたみ中</span> : null}
            </>
          ) : (
            <>
              <span className="font-semibold text-slate-900">現在管理中 {currentSimulations.length}件</span>
              <span className="text-slate-500">注文前・約定確認待ち・建玉中を優先表示</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {bulkOptionPriceAvailable ? <button type="button" title="取得時点の現在決済候補価格をread-onlyで確認します" aria-description="決済実績・状態・数量は変更しません" disabled={bulkOptionPriceLoading} className="rounded bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white disabled:bg-slate-400" onClick={() => { setIsBulkDialogOpen(true); onFetchBulkOptionPrices?.(); }}>{bulkOptionPriceLoading ? `${bulkOptionPriceProgress.total}脚中 ${bulkOptionPriceProgress.completed}脚` : "価格を一括更新"}</button> : <span className="text-xs text-amber-700">SaxoローカルAPIが旧版です。ローカルAPIを更新して再起動してください。個別取得は利用できます。</span>}
        {isPositionFocusMode ? (
          <button
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={onClearPositionFocus}
          >
            <ChevronDown size={14} />
            全建玉一覧に戻る
          </button>
        ) : isJournalFocusMode ? (
          <button
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={onClearJournalFocus}
          >
            <ChevronDown size={14} />
            他の建玉を表示
          </button>
        ) : (
          <button
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => onHistoryOpenChange(!showHistory)}
          >
            {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            履歴 終了建玉{historySimulations.length}件・継続中戦略の決済済み脚{closedLegHistoryItems.length}件を{showHistory ? "畳む" : "表示"}
          </button>
        )}
        </div>
      </div>
      {bulkOptionPriceMessage && !isBulkDialogOpen ? <p className="mt-2 text-right text-xs text-slate-500">{bulkOptionPriceMessage}</p> : null}
      {isBulkDialogOpen ? <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/40 p-4 pt-12" role="presentation"><div role="dialog" aria-modal="true" aria-labelledby="bulk-option-price-dialog-title" className="w-full max-w-5xl rounded-lg bg-white p-4 shadow-xl"><div className="flex items-start justify-between gap-3"><div><h3 id="bulk-option-price-dialog-title" className="text-base font-bold">現在オプション価格を一括更新</h3><p className="mt-1 text-xs text-slate-600">取得時点の現在決済候補価格。決済実績・状態・数量は変更しません。</p></div><button ref={bulkDialogCloseRef} type="button" aria-label="現在オプション価格の確認を閉じる" className="rounded border px-2 py-1 text-xs" onClick={() => { setIsBulkDialogOpen(false); onBulkOptionPriceDialogClose?.(); }}>閉じる</button></div>{bulkOptionPriceLoading ? <p className="mt-4 text-sm">候補価格を取得中...</p> : null}{bulkOptionPriceMessage ? <p className="mt-3 text-xs text-slate-600">{bulkOptionPriceMessage}</p> : null}{bulkOptionPricePreview?.length ? <BulkOptionPricePreview rows={bulkOptionPricePreview} simulations={simulations} referenceConfirmed={bulkOptionPriceReferenceConfirmed} onReferenceConfirmedChange={onBulkOptionPriceReferenceConfirmedChange ?? (() => {})} onApply={() => { onApplyBulkOptionPrices?.(); setIsBulkDialogOpen(false); onBulkOptionPriceDialogClose?.(); }} /> : null}</div></div> : null}
      {simulations.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
          このワークスペースにはまだ建玉がありません。上部の「新規建玉」から、Saxo画面を見ながら建玉を登録できます。
        </div>
      ) : null}
      {simulations.length > 0 && currentSimulations.length === 0 ? (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          現在の注文前・約定確認待ち・建玉中の建玉はありません。過去の結果は「履歴を表示」から確認できます。
        </div>
      ) : null}
      {visibleSimulations.length > 0 ? <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-3">銘柄</th>
              <th className="py-2 pr-3">状態</th>
              <th className="py-2 pr-3">口座</th>
              <th className="py-2 pr-3">戦略</th>
              <th className="py-2 pr-3 text-right">現在株価 / 権利行使価格</th>
              <th className="py-2 pr-3">満期</th>
              <th className="py-2 pr-3 text-right">プレミアム</th>
              <th className="py-2 pr-3 text-right">使用分母 / 実績分母</th>
              <th className="py-2 pr-3 text-right">年率</th>
              <th className="py-2 pr-3 text-right">警告</th>
              <th className="py-2 pr-3">次にやること</th>
              <th className="py-2 pr-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleSimulations.map((simulation, index) => {
              const simulationWithAccountBase = {
                ...simulation,
                availableCashJPY:
                  simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
                    ? accountInputs.N.cashBalance * (simulation.referenceFxRateJPY ?? simulation.fxRateJPY)
                    : accountInputs.P.cashBalance,
              };
              const { simulation: simulationWithAccount, coverage: coveredCallCoverage } = resolveEffectiveCoveredCallSimulation(
                simulationWithAccountBase,
                { wheelCycles, stockTransfers },
              );
              const isHistoryRow = endedStatuses.has(simulation.status);
              const compositeLifecycle = getCompositeOptionLifecycle(simulation);
              const compositeFunding = getCompositeAssignmentFunding(simulation, accountInputs[simulation.accountCode]);
              const syntheticMarginCheck = getSyntheticForwardMarginCheck(simulation);
              const historyPerformance = isHistoryRow ? calculateHistoryPerformance(simulationWithAccount) : null;
              const premiumDisplay = calculateDashboardPremiumDisplay(simulationWithAccount);
              const currentEstimate = !isHistoryRow ? calculateCurrentPositionEstimate(simulationWithAccount, new Date(), currentEstimateFxQuote) : { kind: "not_applicable" } as const;
              const currentEstimateIsRemainingLeg = currentEstimate.kind === "available" && currentEstimate.evaluationScope === "remaining_leg";
              const longOptionDisplay = !isHistoryRow ? premiumDisplay.longOptionOrderDisplay : undefined;
              const historyCloseResults = historyPerformance?.optionCloseExecutionResults ?? [];
              const historyRealizedUsd = historyCloseResults.reduce((sum, result) => sum + result.realizedPnlUSD, 0);
              const historyRealizedJpy = historyCloseResults.reduce((sum, result) => sum + result.realizedPnlJPY, 0);
              const isNAccountRow = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
              const hasHistoryCloseResults = isHistoryRow && historyCloseResults.length > 0;
              const premium = historyPerformance?.premiumJPY ?? premiumDisplay.premiumJPY;
              const displayPremiumJPY = hasHistoryCloseResults ? historyRealizedJpy : premium;
              const premiumDisplayUSD = hasHistoryCloseResults && isNAccountRow
                ? historyRealizedUsd
                : isHistoryRow
                ? displayPremiumJPY / ((simulation.referenceFxRateJPY ?? simulation.fxRateJPY) || 1)
                : premiumDisplay.premiumUSD;
              const hasEffectiveFx = premiumDisplay.effectiveFxRateJPY !== null;
              const primary =
                historyPerformance?.primaryDenominator ??
                getPrimaryDenominator(calculateDenominators(simulationWithAccount, premium));
              const stockTransfer = getStockTransferForSimulation(simulation, stockTransfers);
              const warnings = generateRiskWarnings(simulationWithAccount, {
                stockTransferRecorded: Boolean(stockTransfer),
                coveredCallCoverage,
              });
              const workflowTasks = getWorkflowTasks(simulationWithAccount);
              const simulationExitOrderReviews = pendingExitOrderReviews.filter((review) => review.simulationId === simulation.id);
              const simulationConfirmedExitOrderReviews = confirmedExitOrderReviews.filter((review) => review.simulationId === simulation.id);
              const primaryTask = getPrimaryWorkflowTask(simulationWithAccount);
              const closeCompletion = getOptionCloseCompletion(simulationWithAccount);
              const partialCloseSummary = closeCompletion.state === "partial"
                ? getOptionLegCloseProgress(simulationWithAccount).legs
                    .map((leg) => {
                      const name = `${leg.type === "call" ? "C買い" : "P売り"}`;
                      return leg.state === "closed"
                        ? `${name}${leg.confirmedClosedContracts}枚決済済み`
                        : `${name}${leg.remainingContracts}枚残り`;
                    })
                    .join(" / ")
                : null;
              const countableWarnings = warnings.filter((warning) => warning.severity !== "info");
              const callLeg = simulation.optionLegs.find((leg) => leg.type === "call");
              const putLeg = simulation.optionLegs.find((leg) => leg.type === "put");
              const currentPriceStrikeDisplay = getCurrentPriceStrikeDisplay(simulation);
              const tickerLabel = getSimulationTickerDisplayLabel(simulation);
              const blockingCount = countableWarnings.filter((warning) => warning.blocking).length;
              const attentionCount = countableWarnings.filter((warning) => !warning.blocking).length;
              const warningLabel =
                countableWarnings.length === 0
                  ? "警告なし"
                  : `${blockingCount > 0 ? `NG${blockingCount}件` : "NGなし"}・注意${attentionCount}件`;
              const actionableWarning = countableWarnings.find((warning) => warning.actionAnchorId);
              const firstVisibleWarning = countableWarnings[0];
              const stockAcquisitionSummary = getStockAcquisitionSummary(simulation);
              const journalStatusLabel = getJournalStatusLabel(simulation.entryRationaleJournal, simulation.status);
              const journalStatusTone = getJournalStatusTone(journalStatusLabel);
              const isFirstHistory = !isJournalFocusMode && !isPositionFocusMode && showHistory && index === currentSimulations.length && historySimulations.length > 0;
              const isSyntheticAnnualRateNotApplicable = premiumDisplay.annualReturnApplicability === "not_applicable_synthetic";
              const isNStandaloneShortPut = simulation.strategyType === "short_put" && isNAccountRow && putLeg?.type === "put" && putLeg.side === "sell";
              const isFocusedPositionRow = isPositionFocusMode && simulation.id === focusedSimulation?.id;
              const togglePositionFocus = () => {
                if (isHistoryRow) {
                  onSelect(simulation.id);
                  return;
                }
                if (isFocusedPositionRow) {
                  onClearPositionFocus?.();
                  return;
                }
                onPositionFocus?.(simulation.id);
              };
              const shortPutPolicy = isNStandaloneShortPut && (putLeg.assignmentPolicy === "accept" || putLeg.assignmentPolicy === "avoid")
                ? putLeg.assignmentPolicy
                : "unknown";
              const shortPutAvoidsAssignment = shortPutPolicy === "avoid";
              const showsShortPutCurrentPnl = isNStandaloneShortPut && shortPutPolicy !== "avoid";
              const usesCurrentEstimate = !isHistoryRow && currentEstimate.kind !== "not_applicable" && (
                simulation.strategyType === "synthetic_forward" || simulation.strategyType === "long_call" || simulation.strategyType === "long_put" || shortPutAvoidsAssignment
              );
              const annualReturnLabel =
                isSyntheticAnnualRateNotApplicable
                  ? "適用外"
                  : !isHistoryRow && !premiumDisplay.hasPremiumInput
                  ? "未入力"
                  : longOptionDisplay
                    ? longOptionDisplay.currentCloseAnnualizedReturnPct !== undefined
                      ? `現在決済 ${longOptionDisplay.currentCloseAnnualizedReturnPct > 0 ? "+" : ""}${formatPct(longOptionDisplay.currentCloseAnnualizedReturnPct)}`
                      : "現在決済 未計算"
                  : isHistoryRow && primary.netAnnualReturnPct !== undefined
                  ? `${formatPct(primary.annualReturnPct)} / ${formatPct(primary.netAnnualReturnPct)}`
                  : premiumDisplay.annualReturnPct !== undefined
                    ? `${premiumDisplay.basis === "planned" ? "予定 " : premiumDisplay.basis === "open_unconfirmed" ? "約定未確認 " : ""}${formatPct(premiumDisplay.annualReturnPct)}${
                        premiumDisplay.netAnnualReturnPct !== undefined ? ` / 手数料後 ${formatPct(premiumDisplay.netAnnualReturnPct)}` : ""
                      }`
                    : `${premiumDisplay.basis === "planned" ? "予定 " : premiumDisplay.basis === "open_unconfirmed" ? "約定未確認 " : ""}${formatPct(primary.annualReturnPct)}`;
              return (
                <Fragment key={simulation.id}>
                {isFirstHistory ? (
                  <>
                    <tr className="bg-slate-100">
                      <td colSpan={12} className="py-2 pr-3 text-xs font-bold text-slate-600">
                        履歴: 決済済み・権利行使済み・満期終了
                      </td>
                    </tr>
                    <ClosedLegHistoryRows items={closedLegHistoryItems} onOpen={onHistoryLegAction} />
                  </>
                ) : null}
                <tr
                  key={simulation.id}
                    tabIndex={!isHistoryRow ? 0 : undefined}
                    aria-selected={!isHistoryRow ? isFocusedPositionRow : undefined}
                    aria-pressed={!isHistoryRow ? isFocusedPositionRow : undefined}
                  aria-label={!isHistoryRow ? `${tickerLabel}の詳細を${isFocusedPositionRow ? "閉じる" : "表示する"}` : undefined}
                  className={`border-b border-slate-100 outline-none transition-colors ${
                    isFocusedPositionRow
                      ? "cursor-pointer bg-emerald-100 ring-2 ring-inset ring-emerald-500"
                      : endedStatuses.has(simulation.status)
                        ? "bg-slate-50 text-slate-500"
                        : !isHistoryRow
                          ? "cursor-pointer bg-white hover:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
                          : "bg-white"
                  }`}
                  onClick={togglePositionFocus}
                  onKeyDown={(event) => {
                    if (!isHistoryRow && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      togglePositionFocus();
                    }
                  }}
                >
                  <td className="py-3 pr-3 font-bold text-slate-950">
                    <span className="block">{tickerLabel}</span>
                    <button
                      type="button"
                      className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[11px] font-bold hover:ring-2 hover:ring-offset-1 ${
                      journalStatusTone === "teal"
                        ? "bg-teal-50 text-teal-800 ring-1 ring-teal-200"
                        : journalStatusTone === "amber"
                          ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
                          : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
                    }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onJournalAction?.(simulation.id);
                      }}
                    >
                      {journalStatusLabel}
                    </button>
                    {stockAcquisitionSummary ? (
                      <div className="mt-2 max-w-[260px] rounded-md border border-violet-200 bg-violet-50 px-2 py-1.5 text-[11px] font-semibold leading-5 text-violet-950">
                        <div>現物株取得: {stockAcquisitionSummary.shares}株 @ {stockAcquisitionSummary.price}</div>
                        <div>取得日: {stockAcquisitionSummary.date}</div>
                        <div>口座: {stockAcquisitionSummary.account}</div>
                        <div>入力状態: 完了</div>
                        {stockTransfer ? (
                          <>
                            <div>移管履歴: {stockTransfer.transferDate} P口座からN口座へ{stockTransfer.shares}株を移管</div>
                            <div>現在: N口座で{stockTransfer.shares}株保有</div>
                          </>
                        ) : null}
                        <div className="mt-1 border-t border-violet-200 pt-1 text-violet-900">
                          {stockTransfer
                            ? "P→N株式移管は記録済みです。現在はN口座で株式保有中です。JSONバックアップを保存し、カバードコールを始める場合はC売り候補を確認します。"
                            : "今回の権利行使反映は完了です。次はJSONバックアップを保存してください。P→N移管を実行した場合のみ、移管記録へ進みます。"}
                        </div>
                      </div>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3">
                    <span className={`rounded px-2 py-1 text-xs font-bold ${statusClassName[simulation.status]}`}>
                      {compositeLifecycle?.label ?? getStatusLabel(simulation.status)}
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    <span className={simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "rounded bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800" : "rounded bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800"}>
                      {getAccountEnvironmentLabel(simulation.accountEnvironment)}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-slate-700">
                    <div>{getStrategyLabel(simulation.strategyType)}</div>
                    {isCompositeOptionStrategy(simulation) ? <div className="mt-1 text-xs font-semibold text-indigo-700">C買い {callLeg?.quantity ?? 0} / P売り {putLeg?.quantity ?? 0}</div> : null}
                    {simulation.strategyType === "synthetic_forward" ? (
                      <div className="mt-1 text-xs text-indigo-700">
                        <div>ネット約定 {simulation.syntheticForwardTicket?.netFillPriceUSD === undefined ? "未入力" : `${formatUSD(simulation.syntheticForwardTicket.netFillPriceUSD)} / 株`}</div>
                        <div>実績総手数料 {simulation.syntheticForwardTicket?.actualTotalCommissionUSD === undefined ? "未入力" : formatUSD(simulation.syntheticForwardTicket.actualTotalCommissionUSD)} / 建玉時支払額 {simulation.syntheticForwardTicket?.entryCostUSD === undefined ? "未入力" : formatUSD(simulation.syntheticForwardTicket.entryCostUSD)}</div>
                        <div>注文時証拠金 {syntheticMarginCheck?.status === "sufficient" ? "充足" : syntheticMarginCheck?.status === "insufficient" ? "不足" : "要確認"}</div>
                        <div>{getSyntheticPutAssignmentPolicy(simulation) === "accept" ? "方針: 株取得可" : getSyntheticPutAssignmentPolicy(simulation) === "avoid" ? "方針: 株取得しない" : "方針未確認"}</div>
                      </div>
                    ) : null}
                    {compositeFunding ? <div className={`mt-1 text-xs ${compositeFunding.status === "sufficient" ? "text-emerald-700" : "text-amber-700"}`}>P割当資金 {formatUSD(compositeFunding.requiredUSD)}: {compositeFunding.status === "sufficient" ? "充足" : compositeFunding.status === "insufficient" ? "不足" : "未確認"}</div> : null}
                  </td>
                  <td className="numeric-input py-3 pr-3 text-right font-semibold text-slate-700">
                    {currentPriceStrikeDisplay.currentPriceUSD === undefined ? (
                      <>
                        <span className="block text-amber-800">現在株価 未取得</span>
                        <span className="block text-[11px] font-normal text-slate-500">上部の「価格を一括更新」で取得</span>
                      </>
                    ) : (
                      <>
                        <span className="block font-bold text-slate-950">現在株価 {formatUSD(currentPriceStrikeDisplay.currentPriceUSD)}</span>
                        {currentPriceStrikeDisplay.legs.map((leg) => (
                          <span key={leg.id} className="block text-xs font-semibold text-slate-700">
                            {leg.strikeUSD === undefined ? `${leg.label} 権利行使価格 未取得` : (
                              <>{leg.label} {formatUSD(leg.strikeUSD)}{formatCurrentPriceStrikeDifference(leg.differenceUSD) && formatCurrentPriceStrikePercent(leg.differencePct) ? ` / ${formatCurrentPriceStrikeDifference(leg.differenceUSD)} / ${formatCurrentPriceStrikePercent(leg.differencePct)}` : ""}</>
                            )}
                          </span>
                        ))}
                      </>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-slate-700">{simulation.expiryDate}</td>
                  <td className="numeric-input py-3 pr-3 text-right font-semibold">
                    {!premiumDisplay.hasPremiumInput && !isHistoryRow ? (
                      <span className="font-bold text-slate-500">未入力</span>
                    ) : simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? (
                      <>
                        <span className="block text-[11px] font-bold text-slate-500">{isHistoryRow ? "実現損益" : premiumDisplay.label}</span>
                        <span className="block">{formatUSD(premiumDisplayUSD)}</span>
                        {hasHistoryCloseResults && isNAccountRow ? (
                          <span className="block text-xs text-slate-500">
                            建玉時 {formatUSD(historyCloseResults[0].entryPremiumUSD - historyCloseResults[0].openCommissionUSD)} / 決済支払 -{formatUSD(historyCloseResults[0].closeCostUSD + historyCloseResults[0].closeCommissionUSD)}
                          </span>
                        ) : null}
                        {!isHistoryRow && premiumDisplay.netAfterFeesUSD !== undefined && Math.abs(premiumDisplay.netAfterFeesUSD - premiumDisplay.premiumUSD) > 0.005 ? (
                          <span className="block text-xs text-slate-500">手数料後 {formatUSD(premiumDisplay.netAfterFeesUSD)}</span>
                        ) : null}
                        <span className="block text-xs text-slate-500">
                          {hasEffectiveFx && Math.abs(displayPremiumJPY) > 0.5 ? `参考 ${formatJPY(displayPremiumJPY)}` : "参考JPY未計算"}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="block text-[11px] font-bold text-slate-500">{isHistoryRow ? "実現損益" : premiumDisplay.label}</span>
                        <span className="block">{formatJPY(displayPremiumJPY)}</span>
                        {!isHistoryRow && premiumDisplay.netAfterFeesJPY !== undefined && Math.abs(premiumDisplay.netAfterFeesJPY - premiumDisplay.premiumJPY) > 0.5 ? (
                          <span className="block text-xs text-slate-500">手数料後 {formatJPY(premiumDisplay.netAfterFeesJPY)}</span>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="numeric-input py-3 pr-3 text-right font-semibold">
                    {longOptionDisplay ? (
                      <>
                        <span className="mb-1 block text-[11px] font-bold text-slate-500">建玉時支払額</span>
                        <span className="block text-slate-950">{formatUSD(longOptionDisplay.totalCostUSD)}</span>
                        <span className="block text-xs text-slate-500">
                          {hasEffectiveFx && Math.abs(longOptionDisplay.totalCostJPY) > 0.5
                            ? `参考 ${formatJPY(longOptionDisplay.totalCostJPY)}`
                            : "参考JPY未計算"}
                        </span>
                      </>
                    ) : primary.currency === "USD" ? (
                      <>
                        {isHistoryRow ? <span className="mb-1 block text-[11px] font-bold text-slate-500">実績分母</span> : null}
                        <span className="block">{formatUSD(primary.amountUSD ?? 0)}</span>
                        <span className="block text-xs text-slate-500">
                          {hasEffectiveFx && Math.abs(primary.amountJPY) > 0.5 ? `参考 ${formatJPY(primary.amountJPY)}` : "参考JPY未計算"}
                        </span>
                      </>
                    ) : (
                      <>
                        {isHistoryRow ? <span className="mb-1 block text-[11px] font-bold text-slate-500">実績分母</span> : null}
                        {formatJPY(primary.amountJPY)}
                      </>
                    )}
                  </td>
                  <td className="numeric-input py-3 pr-3 text-right font-semibold">
                    {usesCurrentEstimate ? (
                      <span className="block text-[11px] font-bold text-slate-500">
                        {currentEstimateIsRemainingLeg && currentEstimate.evaluatedLegLabel
                          ? `${currentEstimate.evaluatedLegLabel}残存の現在決済年率`
                          : "現在決済年率"}
                      </span>
                    ) : !isHistoryRow && premiumDisplay.annualReturnPct !== undefined ? (
                      <span className="block text-[11px] font-bold text-slate-500">プレミアム年率</span>
                    ) : null}
                    {usesCurrentEstimate && currentEstimate.kind === "available" ? (
                      <>
                        <span className={`block ${currentEstimate.annualizedReturnPct >= 0 ? "text-emerald-700" : "text-red-700"}`}>{currentEstimate.annualizedReturnPct >= 0 ? "+" : ""}{formatPct(currentEstimate.annualizedReturnPct)}</span>
                        {currentEstimate.currency === "JPY" ? (
                          <>
                            <span className={`block text-[11px] ${currentEstimate.profitJPY >= 0 ? "text-emerald-700" : "text-red-700"}`}>概算損益 {formatJPY(currentEstimate.profitJPY, { signed: true })} / {currentEstimate.profitPct >= 0 ? "+" : ""}{formatPct(currentEstimate.profitPct)}</span>
                            <span className="block text-[10px] text-slate-500">{formatCurrentEstimateFxEvidence(currentEstimate.fx)}</span>
                          </>
                        ) : (
                          <>
                            <span className={`block text-[11px] ${currentEstimate.profitUSD >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                              {currentEstimateIsRemainingLeg && currentEstimate.evaluatedLegLabel
                                ? `${currentEstimate.evaluatedLegLabel}残存の概算損益`
                                : simulation.strategyType === "synthetic_forward" ? "合算概算損益" : "概算損益"} {formatSignedUSD(currentEstimate.profitUSD)} / {currentEstimate.profitPct >= 0 ? "+" : ""}{formatPct(currentEstimate.profitPct)}
                            </span>
                            {currentEstimateIsRemainingLeg && currentEstimate.evaluatedLegLabel ? (
                              <span className="block text-[10px] text-slate-500">他方の脚は決済済み・残存脚のみ評価中</span>
                            ) : null}
                          </>
                        )}
                      </>
                    ) : usesCurrentEstimate && currentEstimate.kind === "missing" ? (
                      <>
                        <span className="block text-slate-500">未計算</span>
                        <span className="block text-[11px] text-slate-500">{currentEstimate.reason}</span>
                        {currentEstimate.reason === "為替レート 未確認" ? (
                          <button type="button" className="mt-1 rounded border border-teal-300 bg-white px-2 py-1 text-[11px] font-bold text-teal-800 hover:bg-teal-50" onClick={onRefreshFx}>為替を取得</button>
                        ) : currentEstimate.missingRequirements[0]?.field === "exit_price" || currentEstimate.missingRequirements[0]?.field === "close_fee" ? (
                          <button
                            type="button"
                            className="mt-1 rounded border border-teal-300 bg-white px-2 py-1 text-[11px] font-bold text-teal-800 hover:bg-teal-50"
                            onClick={() => onCurrentEstimateAction?.(simulation.id, currentEstimate.missingRequirements[0]?.legId, currentEstimate.missingRequirements[0]?.field)}
                          >
                            不足情報を確認
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {annualReturnLabel}
                        {showsShortPutCurrentPnl && currentEstimate.kind === "available" && currentEstimate.currency !== "JPY" ? (
                          <span className={`mt-1 block text-[11px] ${currentEstimate.profitUSD >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                            現在買戻し概算損益 {formatSignedUSD(currentEstimate.profitUSD)} / {currentEstimate.profitPct >= 0 ? "+" : ""}{formatPct(currentEstimate.profitPct)}
                          </span>
                        ) : showsShortPutCurrentPnl && currentEstimate.kind === "missing" ? (
                          <>
                            <span className="mt-1 block text-[11px] text-slate-500">現在買戻し概算損益 未計算 / {currentEstimate.reason}</span>
                            {currentEstimate.missingRequirements[0]?.field === "exit_price" || currentEstimate.missingRequirements[0]?.field === "close_fee" ? (
                              <button
                                type="button"
                                className="mt-1 rounded border border-teal-300 bg-white px-2 py-1 text-[11px] font-bold text-teal-800 hover:bg-teal-50"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onCurrentEstimateAction?.(simulation.id, currentEstimate.missingRequirements[0]?.legId, currentEstimate.missingRequirements[0]?.field);
                                }}
                              >
                                不足情報を確認
                              </button>
                            ) : null}
                          </>
                        ) : null}
                        {isSyntheticAnnualRateNotApplicable ? <span className="mt-1 block text-left text-[11px] font-medium leading-4 text-slate-500">建玉時ネット額はプレミアム年率として評価しません</span> : null}
                      </>
                    )}
                    {isHistoryRow ? <span className="mt-1 block text-[11px] font-semibold text-slate-500">税前 / 税後</span> : null}
                    {!isHistoryRow && premiumDisplay.coveredCallAssignmentEstimate ? (
                      <span className="mt-2 block rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 text-left text-[11px] font-semibold leading-5 text-sky-950">
                        <span className="block font-bold">権利行使時想定</span>
                        <span className="block text-sky-800">主分母: 取得原価 {formatUSD(premiumDisplay.coveredCallAssignmentEstimate.costBasisDenominatorUSD)}</span>
                        {premiumDisplay.coveredCallAssignmentEstimate.currentPriceDenominatorUSD !== undefined &&
                        Math.abs(premiumDisplay.coveredCallAssignmentEstimate.currentPriceDenominatorUSD - premiumDisplay.coveredCallAssignmentEstimate.costBasisDenominatorUSD) > 0.005 ? (
                          <span className="block text-sky-700">参考: 現在株価ベース {formatUSD(premiumDisplay.coveredCallAssignmentEstimate.currentPriceDenominatorUSD)}</span>
                        ) : null}
                        <span className="block">株式売却益 {formatUSD(premiumDisplay.coveredCallAssignmentEstimate.stockSaleGainUSD)}</span>
                        <span className="block">プレミアム込み想定益 {formatUSD(premiumDisplay.coveredCallAssignmentEstimate.totalWithPremiumUSD)}</span>
                        <span className="block">手数料後想定益 {formatUSD(premiumDisplay.coveredCallAssignmentEstimate.totalAfterFeesUSD)}</span>
                        {premiumDisplay.coveredCallAssignmentEstimate.annualReturnPct !== undefined ? (
                          <span className="block">
                            想定年率 {formatPct(premiumDisplay.coveredCallAssignmentEstimate.annualReturnPct)}
                            {premiumDisplay.coveredCallAssignmentEstimate.netAnnualReturnPct !== undefined
                              ? ` / 手数料後 ${formatPct(premiumDisplay.coveredCallAssignmentEstimate.netAnnualReturnPct)}`
                              : ""}
                          </span>
                        ) : null}
                        <span className="block text-sky-800">
                          満期時に株価が権利行使価格以上となり、株式が売却された場合の想定です。実績には含めません。
                        </span>
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={`py-3 pr-3 text-right text-xs font-bold ${
                      blockingCount > 0 ? "text-red-700" : countableWarnings.length > 0 ? "text-amber-700" : "text-emerald-700"
                    }`}
                    title="NGは注文前に解消すべき重大警告、注意は確認項目です。"
                  >
                    <span className="block">{warningLabel}</span>
                    {firstVisibleWarning ? (
                      <span className="mt-1 block max-w-[220px] text-left text-[11px] font-semibold leading-4 text-slate-600">
                        {firstVisibleWarning.message}
                      </span>
                    ) : null}
                    {actionableWarning ? (
                      <button
                        type="button"
                        className="mt-1 rounded border border-current px-2 py-1 text-[11px] font-bold hover:bg-white"
                        onClick={(event) => {
                          event.stopPropagation();
                          onWarningAction?.(simulation.id, actionableWarning);
                        }}
                      >
                        {actionableWarning.actionLabel ?? "反対売買判断へ"}
                      </button>
                    ) : null}
                    {!isHistoryRow &&
                    simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" &&
                    coveredCallCoverage.coveredShares > 0 &&
                    coveredCallCoverage.requiredShares > 0 ? (
                      <span className="mt-2 block rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-left text-[11px] font-semibold leading-4 text-emerald-800">
                        カバー済み: N口座{coveredCallCoverage.coveredShares}株 / 必要{coveredCallCoverage.requiredShares}株
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3">
                    {partialCloseSummary ? <p className="mb-1 text-[11px] font-semibold leading-4 text-slate-600">一部決済済み: {partialCloseSummary}</p> : null}
                    {simulationExitOrderReviews.map((review) => {
                      const prices = [review.takeProfitOrder?.price, review.upperExitOrder?.stopPrice ?? review.upperExitOrder?.price]
                        .filter((price): price is number => typeof price === "number" && Number.isFinite(price) && price > 0)
                        .map((price) => formatUSD(price));
                      return (
                        <button
                          key={`${review.simulationId}:${review.legId}`}
                          type="button"
                          className="mb-1 w-full rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-left text-xs font-bold text-sky-900 hover:bg-sky-100"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSaxoExitOrderAction?.(review.simulationId, review.legId);
                          }}
                        >
                          Saxo OCO確認待ち / {prices.join(" / ") || "価格未取得"}を確認
                        </button>
                      );
                    })}
                    {simulationConfirmedExitOrderReviews.map((review) => (
                      <span
                        key={`${review.simulationId}:${review.legId}:confirmed`}
                        className="mb-1 inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800"
                      >
                        Saxo OCO照合済み
                      </span>
                    ))}
                    {primaryTask.type === "complete" ? (
                      <span
                        className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800"
                        title={primaryTask.detail}
                      >
                        完了（追加操作なし）
                      </span>
                    ) : (
                      <div className="grid gap-1">
                        {workflowTasks.map((workflowTask) => (
                          <button
                            key={workflowTask.id}
                            type="button"
                            className={`rounded-md border px-2 py-1 text-left text-xs font-bold ${
                              workflowTask.severity === "danger"
                                ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                                : workflowTask.severity === "warning"
                                  ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                                  : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-white"
                            }`}
                            title={workflowTask.detail}
                            onClick={(event) => {
                              event.stopPropagation();
                              onWorkflowTaskAction?.(simulation.id, workflowTask);
                            }}
                          >
                            {workflowTask.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <button
                      className="mr-2 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-2 text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"
                      title="この建玉を編集"
                      onClick={(event) => {
                        event.stopPropagation();
                        onEdit(simulation.id);
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-2 text-slate-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                      title="この建玉を削除"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(simulation.id);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
                </Fragment>
              );
            })}
            {showHistory && historySimulations.length === 0 && closedLegHistoryItems.length > 0 ? <>
              <tr className="bg-slate-100"><td colSpan={12} className="py-2 pr-3 text-xs font-bold text-slate-600">履歴: 決済済み・権利行使済み・満期終了</td></tr>
              <ClosedLegHistoryRows items={closedLegHistoryItems} onOpen={onHistoryLegAction} />
            </> : null}
          </tbody>
        </table>
      </div> : null}
    </section>
  );
}

function getAccountEnvironmentLabel(environment: TradeSimulation["accountEnvironment"]): string {
  if (environment === "DEMO_JPY_BASE") return "DEMO / JPYベース";
  if (environment === "PROD_N_USD_SETTLEMENT") return "N / USD";
  return "P / JPY";
}

function getJournalFocusLabel(simulation: TradeSimulation): string {
  const leg = simulation.optionLegs[0];
  const legLabel = leg
    ? `${leg.type === "call" ? "C" : "P"}${formatUSD(leg.strikeUSD)} ${leg.expiryDate || simulation.expiryDate}`
    : simulation.expiryDate;
  return [getSimulationTickerDisplayLabel(simulation), legLabel].filter(Boolean).join(" ");
}

function getStockAcquisitionSummary(simulation: TradeSimulation): { shares: number; price: string; date: string; account: string } | null {
  const acquisition = simulation.stockAcquisition;
  if (simulation.status !== "assigned" || !acquisition?.enabled) return null;
  if (!Number.isFinite(acquisition.shares) || acquisition.shares <= 0) return null;
  if (!Number.isFinite(acquisition.priceUSD) || acquisition.priceUSD <= 0) return null;
  return {
    shares: acquisition.shares,
    price: formatUSD(acquisition.priceUSD),
    date: acquisition.acquisitionDate || simulation.expiryDate || "未入力",
    account: getAccountEnvironmentLabel(acquisition.accountEnvironment),
  };
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
