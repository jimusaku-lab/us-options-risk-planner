import type { Currency, OptionEntryExecution, OptionLeg, TradeSimulation } from "@/types/domain";

const CONTRACT_SIZE = 100;

export type OptionEntryExecutionSummary = {
  executions: OptionEntryExecution[];
  basis: "saxo_broker_statement" | "estimated";
  grossPremiumJPY?: number;
  grossPremiumUSD?: number;
  transactionCostJPY?: number;
  commissionUSD?: number;
  netPremiumJPY?: number;
  netPremiumUSD?: number;
};

export function createOptionEntryExecutionDraft(params: {
  simulation: TradeSimulation;
  leg: OptionLeg;
}): OptionEntryExecution {
  const isN = params.simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
  const fxRate = isN ? params.simulation.referenceFxRateJPY ?? params.simulation.fxRateJPY : params.simulation.fxRateJPY;
  return {
    id: `entry-${params.leg.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    legId: params.leg.id,
    tradeDate: params.simulation.entryDate,
    contracts: params.leg.quantity,
    fillPriceUSD: params.leg.premiumUSD,
    settlementCurrency: isN ? "USD" : "JPY",
    brokerExchangeRateJPY: isN ? undefined : fxRate,
    commissionUSD: isN ? 2.25 : undefined,
    commissionJPY: undefined,
    referenceFxRateJPY: fxRate,
    inputMode: isN ? "USD_EXECUTION_CALC" : "P_JPY_BROKER_STATEMENT",
    source: "manual",
    confirmed: false,
    memo: "",
  };
}

export function getOptionEntryExecutions(simulation: TradeSimulation): OptionEntryExecution[] {
  return simulation.optionEntryExecutions ?? [];
}

export function hasUnconfirmedOptionEntryExecutions(simulation: TradeSimulation): boolean {
  if (simulation.status !== "open") return false;
  const executions = getOptionEntryExecutions(simulation);
  const shortLegs = simulation.optionLegs.filter((leg) => leg.side === "sell");
  return executions.length < shortLegs.length || executions.some((execution) => !execution.confirmed);
}

function signedLegMultiplier(leg?: OptionLeg): number {
  if (!leg) return 1;
  return leg.side === "sell" ? 1 : -1;
}

function asCost(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0;
  return Math.abs(value);
}

export function calculateOptionEntryExecutionSummary(simulation: TradeSimulation): OptionEntryExecutionSummary | null {
  const executions = getOptionEntryExecutions(simulation);
  if (executions.length === 0) return null;
  const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
  const hasPBrokerValues =
    !isN &&
    executions.some((execution) => execution.brokerPremiumJPY !== undefined || execution.brokerTransactionCostJPY !== undefined || execution.brokerBookedAmountJPY !== undefined);

  if (!isN && !hasPBrokerValues) return null;

  if (hasPBrokerValues) {
    const grossPremiumJPY = executions.reduce((sum, execution) => {
      const leg = simulation.optionLegs.find((item) => item.id === execution.legId);
      if (execution.brokerPremiumJPY !== undefined) return sum + execution.brokerPremiumJPY;
      return sum + signedLegMultiplier(leg) * execution.fillPriceUSD * CONTRACT_SIZE * execution.contracts * (execution.brokerExchangeRateJPY ?? simulation.fxRateJPY);
    }, 0);
    const transactionCostJPY = executions.reduce((sum, execution) => {
      if (execution.brokerTransactionCostJPY !== undefined) return sum + asCost(execution.brokerTransactionCostJPY);
      return (
        sum +
        asCost(execution.commissionJPY) +
        asCost(execution.brokerFeeJPY) +
        asCost(execution.brokerExchangeFeeJPY) +
        asCost(execution.brokerTaxIncludedFeeJPY)
      );
    }, 0);
    return {
      executions,
      basis: "saxo_broker_statement",
      grossPremiumJPY,
      transactionCostJPY,
      netPremiumJPY: executions.some((execution) => execution.brokerBookedAmountJPY !== undefined)
        ? executions.reduce((sum, execution) => sum + (execution.brokerBookedAmountJPY ?? 0), 0)
        : grossPremiumJPY,
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
  if (simulation.accountEnvironment !== "PROD_N_USD_SETTLEMENT" && execution.brokerTransactionCostJPY !== undefined) {
    const fxRate = execution.brokerExchangeRateJPY || simulation.fxRateJPY || 1;
    return asCost(execution.brokerTransactionCostJPY) / fxRate * proportion;
  }
  return asCost(execution.commissionUSD) * proportion;
}

export function getEntryExecutionCostForLegJPY(simulation: TradeSimulation, leg: OptionLeg, contracts: number): number | undefined {
  const execution = getOptionEntryExecutions(simulation).find((item) => item.legId === leg.id);
  if (!execution) return undefined;
  const proportion = contracts / Math.max(1, execution.contracts || leg.quantity);
  if (execution.brokerTransactionCostJPY !== undefined) return asCost(execution.brokerTransactionCostJPY) * proportion;
  if (execution.commissionJPY !== undefined) return asCost(execution.commissionJPY) * proportion;
  if (execution.commissionUSD !== undefined) return asCost(execution.commissionUSD) * (execution.referenceFxRateJPY ?? execution.brokerExchangeRateJPY ?? simulation.fxRateJPY) * proportion;
  return undefined;
}

export function getSettlementCurrencyForAccount(simulation: TradeSimulation): Currency {
  return simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "USD" : "JPY";
}
