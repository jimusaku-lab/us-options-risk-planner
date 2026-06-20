import type { StockPosition, StockTransferEvent, TradeSimulation, WheelCycle } from "@/types/domain";
import { getShortCallLegs } from "./calculations";

const CONTRACT_SIZE = 100;
const N_COVER_PHASES = new Set(["n_stock_holding", "n_covered_call"]);

export type CoveredCallCoverageSource =
  | "simulation_stock_position"
  | "linked_wheel_cycle"
  | "transferred_wheel_cycle"
  | "n_wheel_cycle"
  | "none";

export type CoveredCallCoverageResolution = {
  requiredShares: number;
  coveredShares: number;
  missingShares: number;
  averageCostUSD?: number;
  currentPriceUSD?: number;
  source: CoveredCallCoverageSource;
  wheelCycleId?: string;
  linkedToSimulation: boolean;
  linkNeeded: boolean;
};

export function getCoveredCallRequiredShares(simulation: TradeSimulation): number {
  return getShortCallLegs(simulation).reduce((sum, leg) => sum + leg.quantity * CONTRACT_SIZE, 0);
}

function isNAccountCoveredCall(simulation: TradeSimulation): boolean {
  return (
    simulation.strategyType === "covered_call" &&
    (simulation.accountCode === "N" || simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT")
  );
}

function toCoverageFromStockPosition(
  requiredShares: number,
  stockPosition: StockPosition,
): CoveredCallCoverageResolution {
  const coveredShares = Math.max(0, stockPosition.shares);
  return {
    requiredShares,
    coveredShares,
    missingShares: Math.max(0, requiredShares - coveredShares),
    averageCostUSD: stockPosition.averageCostUSD,
    source: "simulation_stock_position",
    linkedToSimulation: true,
    linkNeeded: false,
  };
}

function isTransferRecordedForCycle(cycle: WheelCycle, stockTransfers: StockTransferEvent[]): boolean {
  return stockTransfers.some(
    (transfer) =>
      transfer.toAccountCode === "N" &&
      transfer.destinationWheelCycleId === cycle.id &&
      transfer.shares > 0,
  );
}

function toCoverageFromWheelCycle(params: {
  requiredShares: number;
  cycle: WheelCycle;
  source: CoveredCallCoverageSource;
  linkedToSimulation: boolean;
}): CoveredCallCoverageResolution {
  const coveredShares = Math.max(0, params.cycle.currentShares);
  return {
    requiredShares: params.requiredShares,
    coveredShares,
    missingShares: Math.max(0, params.requiredShares - coveredShares),
    averageCostUSD: params.cycle.averageCostUSD,
    source: params.source,
    wheelCycleId: params.cycle.id,
    linkedToSimulation: params.linkedToSimulation,
    linkNeeded: !params.linkedToSimulation,
  };
}

export function resolveCoveredCallCoverage(
  simulation: TradeSimulation,
  options: {
    wheelCycles?: WheelCycle[];
    stockTransfers?: StockTransferEvent[];
  } = {},
): CoveredCallCoverageResolution {
  const requiredShares = getCoveredCallRequiredShares(simulation);
  if (requiredShares <= 0) {
    return {
      requiredShares: 0,
      coveredShares: 0,
      missingShares: 0,
      source: "none",
      linkedToSimulation: false,
      linkNeeded: false,
    };
  }

  if ((simulation.stockPosition?.shares ?? 0) > 0) {
    return toCoverageFromStockPosition(requiredShares, simulation.stockPosition!);
  }

  if (!isNAccountCoveredCall(simulation)) {
    return {
      requiredShares,
      coveredShares: 0,
      missingShares: requiredShares,
      source: "none",
      linkedToSimulation: false,
      linkNeeded: false,
    };
  }

  const normalizedTicker = simulation.ticker.trim().toUpperCase();
  const candidateCycles = (options.wheelCycles ?? [])
    .filter(
      (cycle) =>
        cycle.ticker.trim().toUpperCase() === normalizedTicker &&
        N_COVER_PHASES.has(cycle.currentPhase) &&
        cycle.currentShares > 0,
    )
    .sort((a, b) => {
      const aLinked = a.linkedSimulationIds.includes(simulation.id) ? 1 : 0;
      const bLinked = b.linkedSimulationIds.includes(simulation.id) ? 1 : 0;
      return bLinked - aLinked;
    });

  const linkedCycle = candidateCycles.find((cycle) => cycle.linkedSimulationIds.includes(simulation.id));
  if (linkedCycle) {
    return toCoverageFromWheelCycle({
      requiredShares,
      cycle: linkedCycle,
      source: "linked_wheel_cycle",
      linkedToSimulation: true,
    });
  }

  const transferredCycle = candidateCycles.find((cycle) => isTransferRecordedForCycle(cycle, options.stockTransfers ?? []));
  if (transferredCycle) {
    return toCoverageFromWheelCycle({
      requiredShares,
      cycle: transferredCycle,
      source: "transferred_wheel_cycle",
      linkedToSimulation: false,
    });
  }

  const nCycle = candidateCycles[0];
  if (nCycle) {
    return toCoverageFromWheelCycle({
      requiredShares,
      cycle: nCycle,
      source: "n_wheel_cycle",
      linkedToSimulation: false,
    });
  }

  return {
    requiredShares,
    coveredShares: 0,
    missingShares: requiredShares,
    source: "none",
    linkedToSimulation: false,
    linkNeeded: false,
  };
}

export function applyCoveredCallCoverageToSimulation(
  simulation: TradeSimulation,
  coverage: CoveredCallCoverageResolution,
): TradeSimulation {
  if (coverage.coveredShares <= 0 || !coverage.averageCostUSD || coverage.averageCostUSD <= 0) return simulation;
  if ((simulation.stockPosition?.shares ?? 0) >= coverage.coveredShares) return simulation;
  return {
    ...simulation,
    stockPosition: {
      shares: coverage.coveredShares,
      averageCostUSD: coverage.averageCostUSD,
      denominatorPriceMode: simulation.stockPosition?.denominatorPriceMode ?? "average_cost",
      customDenominatorPriceUSD: simulation.stockPosition?.customDenominatorPriceUSD,
      canSellAtStrike: simulation.stockPosition?.canSellAtStrike,
    },
  };
}
