import type { OptionCloseExecution, OptionLeg, TradeSimulation } from "@/types/domain";
import { calculateOptionCloseExecutionResult, getOptionCloseCompletion, getOptionCloseExecutions, previewOptionCloseExecutionConfirmation } from "@/domain/optionCloseExecutions";
import { moneyProduct, moneySum, spreadEntryBasis } from "@/domain/spreadCashflows";

export type SpreadCloseBatchLegState = "already_saved" | "ready" | "not_acquired" | "accounting_pending" | "conflict";
export type SpreadCloseBatchLegReview = { leg: OptionLeg; state: SpreadCloseBatchLegState; reason: string; confirmedContracts: number; pendingContracts: number; remainingContracts: number; executions: OptionCloseExecution[] };
export type SpreadCloseBatchPreview = { applies: boolean; ready: boolean; reason?: string; rows: SpreadCloseBatchLegReview[]; pendingExecutionIds: string[]; newlyConfirmedCount: number; entryCashflowUSD?: number; closeCashflowUSD?: number; combinedRealizedPnlUSD?: number; totalCostsUSD?: number; nextSimulation?: TradeSimulation };

const activeLegExecutions = (simulation: TradeSimulation, legId: string) => getOptionCloseExecutions(simulation).filter((execution) => execution.legId === legId);
const isPendingBatchExecution = (execution: OptionCloseExecution) => !execution.confirmed && execution.confirmationStatus !== "ignored" && !execution.voided;
function rowForLeg(simulation: TradeSimulation, leg: OptionLeg): SpreadCloseBatchLegReview {
  const executions = activeLegExecutions(simulation, leg.id), confirmed = executions.filter((item) => item.confirmed), pending = executions.filter(isPendingBatchExecution);
  const confirmedContracts = confirmed.reduce((sum, item) => sum + item.contracts, 0), pendingContracts = pending.reduce((sum, item) => sum + item.contracts, 0), remainingContracts = Math.max(0, leg.quantity - confirmedContracts);
  if (!Number.isInteger(leg.quantity) || leg.quantity <= 0 || confirmedContracts > leg.quantity || confirmedContracts + pendingContracts > leg.quantity) return { leg, state: "conflict", reason: "決済数量が建玉数量と一致しません。", confirmedContracts, pendingContracts, remainingContracts, executions };
  if (confirmedContracts === leg.quantity) return { leg, state: "already_saved", reason: "この脚は正式保存済みです。", confirmedContracts, pendingContracts, remainingContracts: 0, executions };
  if (!pending.length) return { leg, state: "not_acquired", reason: "この脚の決済証跡は未取得、未照合、または未反映です。Saxo上で未決済という意味ではありません。", confirmedContracts, pendingContracts, remainingContracts, executions };
  if (pending.some((item) => item.accountingStatus === "pending" || item.executionEvidenceStatus === "detected" || item.executionEvidenceStatus === "user_confirmed_pending_accounting")) return { leg, state: "accounting_pending", reason: "決済約定は取得済みですが、損益・手数料などの精算情報待ちです。", confirmedContracts, pendingContracts, remainingContracts, executions };
  if (confirmedContracts + pendingContracts !== leg.quantity) return { leg, state: "conflict", reason: `決済数量が不足しています（残り${remainingContracts}枚）。`, confirmedContracts, pendingContracts, remainingContracts, executions };
  const invalid = pending.map((item) => previewOptionCloseExecutionConfirmation(simulation, item)).find((item) => !item.valid);
  if (invalid && !invalid.valid) return { leg, state: "conflict", reason: invalid.reason, confirmedContracts, pendingContracts, remainingContracts, executions };
  return { leg, state: "ready", reason: "決済日・数量・価格・費用を一意に確認できます。", confirmedContracts, pendingContracts, remainingContracts, executions };
}

export function previewBearPutSpreadCloseBatch(simulation: TradeSimulation): SpreadCloseBatchPreview {
  if (simulation.strategyType !== "bear_put_spread") return { applies: false, ready: false, rows: [], pendingExecutionIds: [], newlyConfirmedCount: 0 };
  const legs = simulation.optionLegs.filter((leg) => leg.type === "put").sort((a, b) => b.strikeUSD - a.strikeUSD || a.id.localeCompare(b.id));
  if (legs.length !== 2 || !legs.some((leg) => activeLegExecutions(simulation, leg.id).some((item) => item.source === "saxo_history"))) return { applies: false, ready: false, rows: [], pendingExecutionIds: [], newlyConfirmedCount: 0 };
  const rows = legs.map((leg) => rowForLeg(simulation, leg));
  const pendingExecutionIds = rows.flatMap((row) => row.state === "ready" ? row.executions.filter(isPendingBatchExecution).map((item) => item.id) : []);
  const ready = rows.every((row) => row.state === "ready" || row.state === "already_saved") && pendingExecutionIds.length > 0;
  if (!ready) return { applies: true, ready: false, reason: rows.find((row) => row.state !== "ready" && row.state !== "already_saved")?.reason ?? "新たに保存する決済実績がありません。", rows, pendingExecutionIds, newlyConfirmedCount: 0 };
  const nextExecutions = (simulation.optionCloseExecutions ?? []).map((item) => pendingExecutionIds.includes(item.id) ? { ...item, confirmed: true, confirmationStatus: "confirmed" as const, invalidReason: undefined } : item);
  const interim: TradeSimulation = { ...simulation, optionCloseExecutions: nextExecutions }, completion = getOptionCloseCompletion(interim);
  if (completion.state !== "complete" || !completion.terminalStatus) return { applies: true, ready: false, reason: completion.reason ?? "2脚の全数量を確認できません。", rows, pendingExecutionIds, newlyConfirmedCount: 0 };
  const nextSimulation: TradeSimulation = { ...interim, status: completion.terminalStatus };
  const activeNextExecutions = getOptionCloseExecutions(nextSimulation).filter((item) => item.confirmed);
  const results = activeNextExecutions.map((item) => calculateOptionCloseExecutionResult(nextSimulation, item));
  if (results.some((item) => !item)) return { applies: true, ready: false, reason: "建玉時実績または決済実績の対応を確定できません。", rows, pendingExecutionIds, newlyConfirmedCount: 0 };
  const confirmedResults = results.filter((item): item is NonNullable<typeof item> => Boolean(item)), basis = spreadEntryBasis(nextSimulation);
  const closeCashflowUSD = moneySum(...activeNextExecutions.flatMap((item) => { const leg = nextSimulation.optionLegs.find((candidate) => candidate.id === item.legId)!; const price = item.closeKind === "expired" ? 0 : item.closePriceUSD!; return [moneyProduct(leg.side === "buy" ? 1 : -1, price, item.contracts, leg.contractSize!), -(item.commissionUSD ?? Number.NaN)]; }));
  return { applies: true, ready: true, rows, pendingExecutionIds, newlyConfirmedCount: pendingExecutionIds.length, entryCashflowUSD: basis.state === "known" ? -basis.value : undefined, closeCashflowUSD, combinedRealizedPnlUSD: moneySum(...confirmedResults.map((item) => item.realizedPnlUSD)), totalCostsUSD: moneySum(...confirmedResults.map((item) => item.openCommissionUSD + item.closeCommissionUSD)), nextSimulation };
}
