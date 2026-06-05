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
  const openCommissionUSD =
    getEntryExecutionCostForLegUSD(simulation, leg, contracts) ??
    (simulation.brokerCommissionUSD ?? 0) / Math.max(1, shortLegs.length) * (contracts / Math.max(1, leg.quantity));
  const openCommissionJPY =
    getEntryExecutionCostForLegJPY(simulation, leg, contracts) ??
    (simulation.brokerCommissionJPY ?? 0) / Math.max(1, shortLegs.length) * (contracts / Math.max(1, leg.quantity));
  const entryPremiumUSD = leg.premiumUSD * CONTRACT_SIZE * contracts;
  const closeCostUSD = closeKind === "expired" ? 0 : (execution.closePriceUSD ?? 0) * CONTRACT_SIZE * contracts;
  const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
  const closeCommissionUSD = execution.commissionUSD ?? 0;
  const closeCommissionJPY =
    !isN && execution.brokerTransactionCostJPY !== undefined
      ? asCost(execution.brokerTransactionCostJPY)
      : !isN
        ? asCost(execution.commissionJPY) + asCost(execution.brokerFeeJPY) + asCost(execution.brokerExchangeFeeJPY) + asCost(execution.brokerExchangeTradeFeeJPY) + asCost(execution.brokerTaxIncludedFeeJPY)
        : 0;
  const calculatedRealizedPnlUSD = entryPremiumUSD - closeCostUSD - openCommissionUSD - closeCommissionUSD;
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
      : estimatedRealizedPnlJPY;
  const basis =
    !isN && execution.brokerRealizedPnlJPY !== undefined
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
