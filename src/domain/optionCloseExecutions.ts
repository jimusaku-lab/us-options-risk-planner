import type { Currency, OptionCloseExecution, OptionLeg, TradeSimulation } from "@/types/domain";
import { formatLocalDate } from "@/lib/date";
import { calculateAnnualReturnPercentByCurrency } from "./calculations";
import { calculateDenominators, getPrimaryDenominator } from "./denominators";
import { getEntryExecutionCostForLegJPY, getEntryExecutionCostForLegUSD } from "./optionEntryExecutions";

const CONTRACT_SIZE = 100;

export type OptionCloseExecutionResult = {
  execution: OptionCloseExecution;
  leg: OptionLeg;
  entryPremiumUSD: number;
  closeCostUSD: number;
  openCommissionUSD: number;
  openCommissionJPY: number;
  closeCommissionUSD: number;
  closeCommissionJPY: number;
  realizedPnlUSD: number;
  realizedPnlJPY: number;
  holdingDays: number;
  annualReturnPct: number;
  denominatorUSD?: number;
  denominatorJPY: number;
  currency: Currency;
  basis: "saxo_broker_statement" | "estimated";
};

export type SaxoHistoryRealizedPnlAutofill =
  | {
      available: true;
      realizedPnlUSD: number;
      derivation: NonNullable<OptionCloseExecution["realizedPnlDerivation"]>;
    }
  | {
      available: false;
      missingFields: string[];
    };

export function getOptionCloseExecutions(simulation: TradeSimulation): OptionCloseExecution[] {
  return simulation.optionCloseExecutions ?? [];
}

export function normalizeOptionCloseExecutionsForStatus(
  executions: OptionCloseExecution[] | undefined,
  status: TradeSimulation["status"],
): OptionCloseExecution[] {
  return (executions ?? []).map((execution) => ({
    ...execution,
    confirmed: execution.confirmed ?? ["closed", "expired"].includes(status),
  }));
}

export type SaxoHistoryCloseExecutionValidation = {
  valid: boolean;
  remove: boolean;
  reason?: string;
};

export function validateSaxoHistoryCloseExecution(
  simulation: TradeSimulation,
  execution: OptionCloseExecution,
): SaxoHistoryCloseExecutionValidation {
  if (execution.source !== "saxo_history" || execution.confirmed) return { valid: true, remove: false };
  if (execution.confirmationStatus === "ignored") return { valid: true, remove: false };
  if (isStaleSaxoHistoryPlaceholderCloseExecution(execution)) {
    return {
      valid: false,
      remove: true,
      reason: "Saxo履歴候補由来の古いプレースホルダ値が残っているため破棄しました。",
    };
  }
  if (!execution.sourceCandidateId && !execution.sourceTradeId) {
    return {
      valid: false,
      remove: false,
      reason: "元になったSaxo履歴IDがないため、対象履歴を再検証できません。",
    };
  }
  if (execution.targetPositionId && execution.targetPositionId !== simulation.id) {
    return {
      valid: false,
      remove: false,
      reason: "この決済実績候補は別の建玉に紐づいているため、この建玉では正式保存できません。",
    };
  }
  const leg = simulation.optionLegs.find((item) => item.id === execution.legId);
  if (!leg) {
    return {
      valid: false,
      remove: false,
      reason: "対象脚が見つからないため、決済実績候補を再検証できません。",
    };
  }
  if ((execution.closeKind ?? "buyback") === "buyback" && execution.closePriceUSD === undefined) {
    return {
      valid: false,
      remove: false,
      reason: "買戻し決済の約定価格が未取得です。Saxo履歴を選び直すか、手入力で確認してください。",
    };
  }
  return { valid: true, remove: false };
}

export function sanitizeSaxoHistoryCloseExecutions(simulation: TradeSimulation): TradeSimulation {
  const executions = simulation.optionCloseExecutions ?? [];
  if (executions.length === 0) return simulation;
  let changed = false;
  const next = executions.flatMap((execution) => {
    const validation = validateSaxoHistoryCloseExecution(simulation, execution);
    if (validation.remove) {
      changed = true;
      return [];
    }
    if (!validation.valid && execution.confirmationStatus !== "invalid") {
      changed = true;
      return [
        {
          ...execution,
          confirmationStatus: "invalid" as const,
          invalidReason: validation.reason,
        },
      ];
    }
    return [execution];
  });
  return changed ? { ...simulation, optionCloseExecutions: next } : simulation;
}

function isStaleSaxoHistoryPlaceholderCloseExecution(execution: OptionCloseExecution): boolean {
  if (execution.source !== "saxo_history" || execution.confirmed) return false;
  const hasOneYenPlaceholder = execution.brokerRealizedPnlJPY === 1 || execution.brokerBookedAmountJPY === 1;
  const hasKnownWrongClosePrice = execution.closePriceUSD === 0.13;
  const hasBothOneYenFields = execution.brokerRealizedPnlJPY === 1 && execution.brokerBookedAmountJPY === 1;
  return hasOneYenPlaceholder && (hasKnownWrongClosePrice || hasBothOneYenFields);
}

export function hasOptionCloseExecutions(simulation: TradeSimulation): boolean {
  return getOptionCloseExecutions(simulation).length > 0;
}

export function hasConfirmedBuybackCloseExecution(simulation: TradeSimulation): boolean {
  return getOptionCloseExecutions(simulation).some(
    (execution) => execution.confirmed && (execution.closeKind ?? "buyback") === "buyback",
  );
}

export function hasConfirmedExpiredCloseExecution(simulation: TradeSimulation): boolean {
  return getOptionCloseExecutions(simulation).some(
    (execution) => execution.confirmed && execution.closeKind === "expired",
  );
}

export function hasUnconfirmedCloseExecutionDraft(simulation: TradeSimulation): boolean {
  return getOptionCloseExecutions(simulation).some((execution) => !execution.confirmed);
}

export function calculateHoldingDays(entryDate: string, closeDate: string): number {
  const entry = new Date(`${entryDate}T00:00:00Z`);
  const close = new Date(`${closeDate}T00:00:00Z`);
  if (Number.isNaN(entry.getTime()) || Number.isNaN(close.getTime())) return 1;
  return Math.max(1, Math.ceil((close.getTime() - entry.getTime()) / 86_400_000));
}

export function createOptionCloseExecutionDraft(params: {
  simulation: TradeSimulation;
  leg: OptionLeg;
  closePriceUSD?: number;
  closeDate?: string;
  closeKind?: "buyback" | "expired";
}): OptionCloseExecution {
  const closeKind = params.closeKind ?? "buyback";
  const closeDate = params.closeDate ?? formatLocalDate();
  return {
    id: `close-${params.leg.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    legId: params.leg.id,
    closeKind,
    confirmed: false,
    closeDate,
    contracts: params.leg.quantity,
    closePriceUSD: params.closePriceUSD,
    commissionUSD: closeKind === "expired" ? 0 : 2.25,
    commissionJPY: undefined,
    fxRateJPY: params.simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
      ? params.simulation.referenceFxRateJPY ?? params.simulation.fxRateJPY
      : params.simulation.fxRateJPY,
    settlementCurrency: params.simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "USD" : "JPY",
    inputMode: params.simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "USD_EXECUTION_CALC" : "P_JPY_BROKER_STATEMENT",
    brokerExchangeRateJPY: params.simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? undefined : params.simulation.fxRateJPY,
    source: "manual",
    memo: closeKind === "expired" ? "満期終了。買戻しなし。" : "",
  };
}

function asCost(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0;
  return Math.abs(value);
}

function calculateDirectionalRealizedPnlUSD({
  leg,
  entryPremiumUSD,
  closeCostUSD,
  openCommissionUSD,
  closeCommissionUSD,
}: {
  leg: OptionLeg;
  entryPremiumUSD: number;
  closeCostUSD: number;
  openCommissionUSD: number;
  closeCommissionUSD: number;
}): number {
  const premiumDifference = leg.side === "sell"
    ? entryPremiumUSD - closeCostUSD
    : closeCostUSD - entryPremiumUSD;
  return premiumDifference - openCommissionUSD - closeCommissionUSD;
}

/**
 * Produces the deterministic N/USD close P/L used by the draft, validation
 * display, and performance calculation. Partial or multi-leg allocations are
 * intentionally left for manual confirmation.
 */
export function deriveSaxoHistoryRealizedPnlAutofill(
  simulation: TradeSimulation,
  execution: OptionCloseExecution,
): SaxoHistoryRealizedPnlAutofill {
  const missingFields: string[] = [];
  const leg = simulation.optionLegs.find((item) => item.id === execution.legId);
  if (!leg) missingFields.push("対象脚");
  if (simulation.accountEnvironment !== "PROD_N_USD_SETTLEMENT") missingFields.push("N/USD口座");
  if ((execution.closeKind ?? "buyback") !== "buyback") missingFields.push("買戻し決済");
  if (!Number.isFinite(execution.contracts) || execution.contracts <= 0) missingFields.push("約定数量");
  if (leg && execution.contracts !== leg.quantity) missingFields.push("一部決済または数量配賦");
  if (execution.closePriceUSD === undefined || !Number.isFinite(execution.closePriceUSD)) missingFields.push("決済価格USD");
  if (execution.commissionUSD === undefined || !Number.isFinite(execution.commissionUSD)) missingFields.push("決済時手数料USD");
  const entryExecution = leg ? simulation.optionEntryExecutions?.find((item) => item.legId === leg.id) : undefined;
  if (!entryExecution) {
    missingFields.push("建玉時約定");
  } else {
    if (!Number.isFinite(entryExecution.fillPriceUSD)) missingFields.push("建玉時プレミアムUSD");
    if (!Number.isFinite(entryExecution.contracts) || entryExecution.contracts !== execution.contracts) missingFields.push("建玉時数量");
    if (entryExecution.commissionUSD === undefined || !Number.isFinite(entryExecution.commissionUSD)) missingFields.push("建玉時手数料USD");
  }
  if (missingFields.length > 0 || !leg || !entryExecution || execution.closePriceUSD === undefined || execution.commissionUSD === undefined) {
    return { available: false, missingFields: Array.from(new Set(missingFields)) };
  }

  const contracts = execution.contracts;
  const entryPremiumUSD = entryExecution.fillPriceUSD * CONTRACT_SIZE * contracts;
  const closeCostUSD = execution.closePriceUSD * CONTRACT_SIZE * contracts;
  const openCommissionUSD = Math.abs(entryExecution.commissionUSD ?? 0);
  const closeCommissionUSD = Math.abs(execution.commissionUSD);
  const realizedPnlUSD = calculateDirectionalRealizedPnlUSD({
    leg,
    entryPremiumUSD,
    closeCostUSD,
    openCommissionUSD,
    closeCommissionUSD,
  });
  return {
    available: true,
    realizedPnlUSD,
    derivation: {
      sourceTradeId: execution.sourceTradeId,
      targetPositionId: execution.targetPositionId,
      entryPremiumUSD,
      closePriceUSD: execution.closePriceUSD,
      contracts,
      openCommissionUSD,
      closeCommissionUSD,
      calculatedRealizedPnlUSD: realizedPnlUSD,
    },
  };
}

export function calculateOptionCloseExecutionResult(
  simulation: TradeSimulation,
  execution: OptionCloseExecution,
): OptionCloseExecutionResult | null {
  const leg = simulation.optionLegs.find((item) => item.id === execution.legId);
  if (!leg) return null;
  const contracts = Math.max(0, Math.min(execution.contracts, leg.quantity));
  if (contracts <= 0) return null;
  const shortLegs = simulation.optionLegs.filter((item) => item.side === "sell");
  const closeKind = execution.closeKind ?? "buyback";
  if (closeKind === "buyback" && (execution.closePriceUSD === undefined || Number.isNaN(execution.closePriceUSD))) return null;
  const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
  const entryExecution = simulation.optionEntryExecutions?.find((item) => item.legId === execution.legId);
  const entryExecutionProportion = entryExecution ? contracts / Math.max(1, entryExecution.contracts || leg.quantity) : 1;
  const entryBookedAmountJPY =
    entryExecution?.brokerBookedAmountJPY !== undefined
      ? entryExecution.brokerBookedAmountJPY * entryExecutionProportion
      : undefined;
  const cashflowRealizedPnlJPY =
    !isN && entryBookedAmountJPY !== undefined && execution.brokerBookedAmountJPY !== undefined
      ? entryBookedAmountJPY + execution.brokerBookedAmountJPY
      : undefined;
  const openCommissionUSD =
    getEntryExecutionCostForLegUSD(simulation, leg, contracts) ??
    (simulation.brokerCommissionUSD ?? 0) / Math.max(1, shortLegs.length) * (contracts / Math.max(1, leg.quantity));
  const openCommissionJPY =
    getEntryExecutionCostForLegJPY(simulation, leg, contracts) ??
    (simulation.brokerCommissionJPY ?? 0) / Math.max(1, shortLegs.length) * (contracts / Math.max(1, leg.quantity));
  const entryPremiumUSD = leg.premiumUSD * CONTRACT_SIZE * contracts;
  const closeCostUSD = closeKind === "expired" ? 0 : (execution.closePriceUSD ?? 0) * CONTRACT_SIZE * contracts;
  const closeCommissionUSD = execution.commissionUSD ?? 0;
  const closeCommissionJPY =
    !isN && execution.brokerTransactionCostJPY !== undefined
      ? asCost(execution.brokerTransactionCostJPY)
      : !isN
        ? asCost(execution.commissionJPY) + asCost(execution.brokerFeeJPY) + asCost(execution.brokerExchangeFeeJPY) + asCost(execution.brokerExchangeTradeFeeJPY) + asCost(execution.brokerTaxIncludedFeeJPY)
        : 0;
  const calculatedRealizedPnlUSD = calculateDirectionalRealizedPnlUSD({
    leg,
    entryPremiumUSD,
    closeCostUSD,
    openCommissionUSD,
    closeCommissionUSD,
  });
  const realizedPnlUSD = isN && execution.realizedPnlUSD !== undefined ? execution.realizedPnlUSD : calculatedRealizedPnlUSD;
  const fxRateJPY =
    (execution.brokerExchangeRateJPY ?? execution.fxRateJPY) && (execution.brokerExchangeRateJPY ?? execution.fxRateJPY)! > 0
      ? (execution.brokerExchangeRateJPY ?? execution.fxRateJPY)!
      : execution.fxRateJPY && execution.fxRateJPY > 0
      ? execution.fxRateJPY
      : simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
        ? simulation.referenceFxRateJPY ?? simulation.fxRateJPY
        : simulation.fxRateJPY;
  const estimatedRealizedPnlJPY =
    simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
      ? realizedPnlUSD * fxRateJPY
      : calculatedRealizedPnlUSD * fxRateJPY - openCommissionJPY - closeCommissionJPY;
  const realizedPnlJPY =
    !isN && execution.brokerRealizedPnlJPY !== undefined
      ? execution.brokerRealizedPnlJPY
      : !isN && cashflowRealizedPnlJPY !== undefined
        ? cashflowRealizedPnlJPY
      : estimatedRealizedPnlJPY;
  const basis =
    !isN && (execution.brokerRealizedPnlJPY !== undefined || cashflowRealizedPnlJPY !== undefined)
      ? "saxo_broker_statement"
      : "estimated";
  const holdingDays = calculateHoldingDays(simulation.entryDate, execution.closeDate);
  const primary = getPrimaryDenominator(calculateDenominators(simulation, realizedPnlJPY));
  const annualReturnPct = calculateAnnualReturnPercentByCurrency({
    netProfit: isN ? realizedPnlUSD : realizedPnlJPY,
    denominator: isN ? primary.amountUSD ?? 0 : primary.amountJPY,
    dte: holdingDays,
  });
  return {
    execution,
    leg,
    entryPremiumUSD,
    closeCostUSD,
    openCommissionUSD,
    openCommissionJPY,
    closeCommissionUSD,
    closeCommissionJPY,
    realizedPnlUSD,
    realizedPnlJPY,
    holdingDays,
    annualReturnPct,
    denominatorUSD: primary.amountUSD,
    denominatorJPY: primary.amountJPY,
    currency: isN ? "USD" : "JPY",
    basis,
  };
}

export function calculateOptionCloseExecutionResults(simulation: TradeSimulation): OptionCloseExecutionResult[] {
  return getOptionCloseExecutions(simulation)
    .map((execution) => calculateOptionCloseExecutionResult(simulation, execution))
    .filter((result): result is OptionCloseExecutionResult => Boolean(result));
}

export function calculateTotalOptionCloseRealizedPnlJPY(simulation: TradeSimulation): number {
  return calculateOptionCloseExecutionResults(simulation).reduce((sum, result) => sum + result.realizedPnlJPY, 0);
}
