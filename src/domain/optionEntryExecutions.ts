import type { Currency, OptionEntryExecution, OptionLeg, TradeSimulation } from "@/types/domain";
import { formatLocalDate } from "@/lib/date";

const CONTRACT_SIZE = 100;
/** Confirmed N Stock Option entry-ticket total; intentionally separate from close-fee resolver. */
export const DEFAULT_N_OPTION_STANDARD_COMMISSION_USD = 2.24;
export const N_OPTION_ENTRY_STANDARD_COMMISSION_CONFIRMED_AT = "2026-08-14";
const LEGACY_N_OPTION_STANDARD_COMMISSION_USD = 2.25;

export function getNOptionStandardCommissionUSD(
  contracts: number,
  standardCommissionUSD = DEFAULT_N_OPTION_STANDARD_COMMISSION_USD,
): number {
  return Math.round(Math.abs(contracts) * standardCommissionUSD * 100) / 100;
}

export function applySaxoActualEntryCommission(
  execution: OptionEntryExecution,
  transactionCostUSD: number | undefined,
): OptionEntryExecution {
  if (
    transactionCostUSD === undefined ||
    !Number.isFinite(transactionCostUSD) ||
    execution.commissionSource === "manual" ||
    execution.commissionSource === "saxo_actual"
  ) {
    return execution;
  }
  if (execution.commissionUSD !== undefined && execution.commissionSource !== "standard_default" && execution.commissionSource !== "saxo_ticket_confirmed_standard" && execution.commissionSource !== "saxo_derived_same_currency_booked_difference") return execution;
  return {
    ...execution,
    commissionUSD: Math.abs(transactionCostUSD),
    commissionSource: "saxo_actual",
  };
}

export function updateStandardEntryCommissionForContracts(
  execution: OptionEntryExecution,
  contracts: number,
  standardCommissionUSD = DEFAULT_N_OPTION_STANDARD_COMMISSION_USD,
): OptionEntryExecution {
  return {
    ...execution,
    contracts,
    ...((execution.commissionSource === "standard_default" || execution.commissionSource === "saxo_ticket_confirmed_standard")
      ? { commissionUSD: getNOptionStandardCommissionUSD(contracts, standardCommissionUSD), commissionSource: "saxo_ticket_confirmed_standard" as const }
      : {}),
  };
}

export function ensureNOptionEntryStandardCommission(
  simulation: TradeSimulation,
  execution: OptionEntryExecution,
  standardCommissionUSD = DEFAULT_N_OPTION_STANDARD_COMMISSION_USD,
): OptionEntryExecution {
  if (
    simulation.accountEnvironment !== "PROD_N_USD_SETTLEMENT" ||
    execution.commissionUSD !== undefined ||
    execution.commissionSource === "manual" ||
    execution.commissionSource === "saxo_actual" ||
    execution.commissionSource === "saxo_derived_same_currency_booked_difference"
  ) {
    return execution;
  }
  return {
    ...execution,
    commissionUSD: getNOptionStandardCommissionUSD(execution.contracts, standardCommissionUSD),
    commissionSource: "saxo_ticket_confirmed_standard",
  };
}

export type OptionEntryExecutionSummary = {
  executions: OptionEntryExecution[];
  basis: "saxo_broker_statement" | "estimated";
  grossPremiumJPY?: number;
  grossPremiumUSD?: number;
  cashBookedAmountJPY?: number;
  cashTransactionCostJPY?: number;
  currencyConversionCostJPY?: number;
  transactionCostJPY?: number;
  commissionUSD?: number;
  netPremiumJPY?: number;
  netPremiumUSD?: number;
};

export function createOptionEntryExecutionDraft(params: {
  simulation: TradeSimulation;
  leg: OptionLeg;
  tradeDate?: string;
  standardCommissionUSD?: number;
}): OptionEntryExecution {
  const isN = params.simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
  const fxRate = isN ? params.simulation.referenceFxRateJPY ?? params.simulation.fxRateJPY : params.simulation.fxRateJPY;
  return {
    id: `entry-${params.leg.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    legId: params.leg.id,
    tradeDate: params.tradeDate ?? formatLocalDate(),
    contracts: params.leg.quantity,
    fillPriceUSD: params.leg.premiumUSD,
    settlementCurrency: isN ? "USD" : "JPY",
    brokerExchangeRateJPY: isN ? undefined : fxRate,
    commissionUSD: isN ? getNOptionStandardCommissionUSD(params.leg.quantity, params.standardCommissionUSD) : undefined,
    commissionSource: isN ? "saxo_ticket_confirmed_standard" : undefined,
    commissionJPY: undefined,
    referenceFxRateJPY: isN ? undefined : fxRate,
    inputMode: isN ? "USD_EXECUTION_CALC" : "P_JPY_BROKER_STATEMENT",
    source: "manual",
    confirmed: false,
    memo: "",
  };
}

export function migrateNOptionEntryStandardCommissions(simulation: TradeSimulation): TradeSimulation {
  if (simulation.accountEnvironment !== "PROD_N_USD_SETTLEMENT") return simulation;
  let changed = false;
  const optionEntryExecutions = (simulation.optionEntryExecutions ?? []).map((execution) => {
    if (!execution.confirmed) return execution;
    const next = getNOptionStandardCommissionUSD(execution.contracts);
    const legacy = getNOptionStandardCommissionUSD(execution.contracts, LEGACY_N_OPTION_STANDARD_COMMISSION_USD);
    if (execution.commissionSource === "standard_default" || (execution.commissionSource === undefined && execution.commissionUSD === legacy)) {
      changed = true;
      return { ...execution, commissionUSD: next, commissionSource: "saxo_ticket_confirmed_standard" as const };
    }
    return execution;
  });
  return changed ? { ...simulation, optionEntryExecutions } : simulation;
}

const LEGACY_ENTRY_DUPLICATE_RECONCILIATION_NOTE = "開始約定重複整理v1: Saxo履歴連携済み実績を正本化";

function sameFiniteNumber(left: number | undefined, right: number | undefined, tolerance = 0.0001): boolean {
  return left !== undefined && right !== undefined && Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function calendarDayDistance(left: string, right: string): number | undefined {
  const leftTime = new Date(`${left}T00:00:00Z`).getTime();
  const rightTime = new Date(`${right}T00:00:00Z`).getTime();
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) ? Math.abs(leftTime - rightTime) / 86_400_000 : undefined;
}

function isUnlinkedLegacyManualEntry(execution: OptionEntryExecution): boolean {
  return execution.confirmed === true && execution.source === "manual" &&
    (execution.historyCandidateIds ?? []).length === 0 && !execution.saxoTicketId && !execution.saxoOrderId && !execution.saxoPositionId && !execution.saxoUic &&
    Object.keys(execution.openingFieldSources ?? {}).length === 0 && Object.keys(execution.openingFieldEvidence ?? {}).length === 0 && !(execution.memo ?? "").trim();
}

export function getApprovedLegacyOpeningDuplicateRepairKey(simulationId: string, saxoEntryId: string, manualEntryId: string): string {
  return [simulationId, saxoEntryId, manualEntryId].join(":");
}

/** Reconciles only an explicitly approved history-backed fill and its evidence-free legacy manual duplicate. */
export function reconcileLegacyConfirmedOpeningDuplicates(
  simulation: TradeSimulation,
  approvedRepairKeys: ReadonlySet<string> = new Set(),
): TradeSimulation {
  const executions = simulation.optionEntryExecutions ?? [];
  let changed = false;
  let nextExecutions = executions;
  for (const leg of simulation.optionLegs) {
    const legExecutions = nextExecutions.filter((execution) => execution.legId === leg.id && execution.confirmed);
    if (legExecutions.length !== 2 || !(leg.quantity > 0)) continue;
    const saxoEntries = legExecutions.filter((execution) => execution.source === "saxo_api_estimate" && (execution.historyCandidateIds ?? []).length > 0 && execution.historyCompletionStatus !== "source_conflict");
    const manualEntries = legExecutions.filter(isUnlinkedLegacyManualEntry);
    if (saxoEntries.length !== 1 || manualEntries.length !== 1) continue;
    const saxoEntry = saxoEntries[0]; const manualEntry = manualEntries[0];
    const repairKey = getApprovedLegacyOpeningDuplicateRepairKey(simulation.id, saxoEntry.id, manualEntry.id);
    if (!approvedRepairKeys.has(repairKey)) continue;
    const dayDistance = calendarDayDistance(saxoEntry.tradeDate, manualEntry.tradeDate);
    if (!sameFiniteNumber(saxoEntry.contracts, leg.quantity) || !sameFiniteNumber(saxoEntry.contracts, manualEntry.contracts) ||
      !sameFiniteNumber(saxoEntry.fillPriceUSD, manualEntry.fillPriceUSD) || !sameFiniteNumber(saxoEntry.commissionUSD, manualEntry.commissionUSD, 0.005) ||
      saxoEntry.settlementCurrency !== manualEntry.settlementCurrency || dayDistance === undefined || dayDistance > 1) continue;
    const reconciled = { ...saxoEntry, memo: [saxoEntry.memo?.trim(), LEGACY_ENTRY_DUPLICATE_RECONCILIATION_NOTE].filter(Boolean).join(" / ") };
    nextExecutions = nextExecutions.filter((execution) => execution.id !== manualEntry.id).map((execution) => execution.id === saxoEntry.id ? reconciled : execution);
    changed = true;
  }
  return changed ? { ...simulation, optionEntryExecutions: nextExecutions } : simulation;
}

export function getOptionEntryExecutions(simulation: TradeSimulation): OptionEntryExecution[] {
  return simulation.optionEntryExecutions ?? [];
}

/** Removes only source-linked duplicate confirmations of the same economic fill. */
export function getCanonicalOptionEntryExecutions(simulation: TradeSimulation): OptionEntryExecution[] {
  const seen = new Set<string>();
  return getOptionEntryExecutions(simulation).filter((execution) => {
    if (!execution.confirmed) return true;
    const brokerIdentity = execution.saxoTicketId ?? execution.saxoOrderId;
    if (!brokerIdentity) return true;
    const key = JSON.stringify([
      execution.legId, brokerIdentity, execution.tradeDate, execution.settlementCurrency,
      execution.contracts, execution.fillPriceUSD, execution.commissionUSD,
      execution.brokerBookedAmountJPY, execution.brokerPremiumJPY, execution.brokerTransactionCostJPY,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function hasUnconfirmedOptionEntryExecutions(simulation: TradeSimulation): boolean {
  if (simulation.status !== "open" && simulation.status !== "entry_confirmation") return false;
  return needsOptionEntryConfirmation(simulation);
}

/**
 * A duplicate, unconfirmed Saxo record must not make a leg actionable when a
 * complete confirmed execution already covers that leg's quantity.  This is
 * deliberately quantity based so partial fills still require confirmation.
 */
export function needsOptionEntryConfirmation(simulation: TradeSimulation): boolean {
  const executions = getOptionEntryExecutions(simulation);
  return simulation.optionLegs.some((leg) => {
    const coveredContracts = executions
      .filter((execution) => execution.legId === leg.id && execution.confirmed && isCompleteConfirmedEntryExecution(execution))
      .reduce((sum, execution) => sum + execution.contracts, 0);
    return coveredContracts + 0.0001 < leg.quantity;
  });
}

function isCompleteConfirmedEntryExecution(execution: OptionEntryExecution): boolean {
  if (!execution.tradeDate || !Number.isFinite(execution.fillPriceUSD) || execution.fillPriceUSD <= 0) return false;
  if (!Number.isFinite(execution.contracts) || execution.contracts <= 0) return false;
  // Accounting completeness has its own warning path.  It is not a reason to
  // reopen a user-confirmed entry or to duplicate a history candidate.
  return true;
}

function signedLegMultiplier(leg?: OptionLeg): number {
  if (!leg) return 1;
  return leg.side === "sell" ? 1 : -1;
}

function asCost(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0;
  return Math.abs(value);
}

function isFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function getEntryExecutionCashTransactionCostJPY(execution: OptionEntryExecution): number | undefined {
  if (isFiniteNumber(execution.brokerTransactionCostJPY)) return asCost(execution.brokerTransactionCostJPY);
  const components = [
    execution.commissionJPY,
    execution.brokerFeeJPY,
    execution.brokerExchangeFeeJPY,
    execution.brokerOtherTransactionCostJPY,
    execution.brokerTaxIncludedFeeJPY,
  ].filter(isFiniteNumber);
  if (components.length === 0) return undefined;
  return components.reduce((sum, value) => sum + asCost(value), 0);
}

function getEntryExecutionEconomicTransactionCostJPY(execution: OptionEntryExecution): number | undefined {
  if (isFiniteNumber(execution.brokerTotalTransactionCostJPY)) return asCost(execution.brokerTotalTransactionCostJPY);
  const costs: number[] = [];
  const cashCost = getEntryExecutionCashTransactionCostJPY(execution);
  if (cashCost !== undefined) costs.push(cashCost);
  if (isFiniteNumber(execution.brokerCurrencyConversionCostJPY)) costs.push(asCost(execution.brokerCurrencyConversionCostJPY));
  if (costs.length === 0) return undefined;
  return costs.reduce((sum, value) => sum + value, 0);
}

export function calculateOptionEntryExecutionSummary(simulation: TradeSimulation): OptionEntryExecutionSummary | null {
  const executions = getCanonicalOptionEntryExecutions(simulation);
  if (executions.length === 0) return null;
  const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
  const hasPBrokerValues =
    !isN &&
    executions.some(
      (execution) =>
        execution.brokerPremiumJPY !== undefined ||
        execution.brokerTransactionCostJPY !== undefined ||
        execution.brokerCurrencyConversionCostJPY !== undefined ||
        execution.brokerTotalTransactionCostJPY !== undefined ||
        execution.brokerBookedAmountJPY !== undefined,
    );

  if (!isN && !hasPBrokerValues) return null;

  if (hasPBrokerValues) {
    const hasCashTransactionCostEvidence = executions.some((execution) => getEntryExecutionCashTransactionCostJPY(execution) !== undefined);
    const hasEconomicTransactionCostEvidence = executions.some((execution) => getEntryExecutionEconomicTransactionCostJPY(execution) !== undefined);
    const grossPremiumJPY = executions.reduce((sum, execution) => {
      const leg = simulation.optionLegs.find((item) => item.id === execution.legId);
      if (execution.brokerPremiumJPY !== undefined) return sum + execution.brokerPremiumJPY;
      return sum + signedLegMultiplier(leg) * execution.fillPriceUSD * CONTRACT_SIZE * execution.contracts * (execution.brokerExchangeRateJPY ?? simulation.fxRateJPY);
    }, 0);
    const cashBookedAmountJPY = executions.some((execution) => execution.brokerBookedAmountJPY !== undefined)
      ? executions.reduce((sum, execution) => sum + (execution.brokerBookedAmountJPY ?? 0), 0)
      : undefined;
    const cashTransactionCostJPY = hasCashTransactionCostEvidence
      ? executions.reduce((sum, execution) => sum + (getEntryExecutionCashTransactionCostJPY(execution) ?? 0), 0)
      : undefined;
    const currencyConversionCostJPY = executions.some((execution) => isFiniteNumber(execution.brokerCurrencyConversionCostJPY))
      ? executions.reduce((sum, execution) => sum + asCost(execution.brokerCurrencyConversionCostJPY), 0)
      : undefined;
    const transactionCostJPY = hasEconomicTransactionCostEvidence
      ? executions.reduce((sum, execution) => sum + (getEntryExecutionEconomicTransactionCostJPY(execution) ?? 0), 0)
      : undefined;
    const netPremiumJPY =
      transactionCostJPY !== undefined
        ? grossPremiumJPY - transactionCostJPY
        : cashBookedAmountJPY ?? grossPremiumJPY;
    return {
      executions,
      basis: "saxo_broker_statement",
      grossPremiumJPY,
      cashBookedAmountJPY,
      cashTransactionCostJPY,
      currencyConversionCostJPY,
      transactionCostJPY,
      netPremiumJPY,
    };
  }

  const grossPremiumUSD = executions.reduce((sum, execution) => {
    const leg = simulation.optionLegs.find((item) => item.id === execution.legId);
    return sum + signedLegMultiplier(leg) * execution.fillPriceUSD * CONTRACT_SIZE * execution.contracts;
  }, 0);
  const commissionUSD = executions.reduce((sum, execution) => sum + asCost(execution.commissionUSD), 0);
  const fxRate = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
    ? simulation.referenceFxRateJPY ?? simulation.fxRateJPY
    : simulation.fxRateJPY;
  const netPremiumUSD = grossPremiumUSD - commissionUSD;
  return {
    executions,
    basis: "estimated",
    grossPremiumUSD,
    commissionUSD,
    netPremiumUSD,
    grossPremiumJPY: grossPremiumUSD * fxRate,
    transactionCostJPY: commissionUSD * fxRate + executions.reduce((sum, execution) => sum + asCost(execution.commissionJPY), 0),
    netPremiumJPY: netPremiumUSD * fxRate - executions.reduce((sum, execution) => sum + asCost(execution.commissionJPY), 0),
  };
}

export function getEntryExecutionCostForLegUSD(simulation: TradeSimulation, leg: OptionLeg, contracts: number): number | undefined {
  const execution = getOptionEntryExecutions(simulation).find((item) => item.legId === leg.id);
  if (!execution) return undefined;
  const proportion = contracts / Math.max(1, execution.contracts || leg.quantity);
  const jpyEconomicCost = simulation.accountEnvironment !== "PROD_N_USD_SETTLEMENT"
    ? getEntryExecutionEconomicTransactionCostJPY(execution)
    : undefined;
  if (jpyEconomicCost !== undefined) {
    const fxRate = execution.brokerExchangeRateJPY || simulation.fxRateJPY || 1;
    return jpyEconomicCost / fxRate * proportion;
  }
  return asCost(execution.commissionUSD) * proportion;
}

export function getEntryExecutionCostForLegJPY(simulation: TradeSimulation, leg: OptionLeg, contracts: number): number | undefined {
  const execution = getOptionEntryExecutions(simulation).find((item) => item.legId === leg.id);
  if (!execution) return undefined;
  const proportion = contracts / Math.max(1, execution.contracts || leg.quantity);
  const economicCost = getEntryExecutionEconomicTransactionCostJPY(execution);
  if (economicCost !== undefined) return economicCost * proportion;
  if (execution.commissionJPY !== undefined) return asCost(execution.commissionJPY) * proportion;
  if (execution.commissionUSD !== undefined) return asCost(execution.commissionUSD) * (execution.referenceFxRateJPY ?? execution.brokerExchangeRateJPY ?? simulation.fxRateJPY) * proportion;
  return undefined;
}

export function getSettlementCurrencyForAccount(simulation: TradeSimulation): Currency {
  return simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "USD" : "JPY";
}
