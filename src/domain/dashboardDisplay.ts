import type { TradeSimulation } from "@/types/domain";
import {
  calculateNetInitialPremiumJPY,
  calculateNetInitialPremiumUSD,
  calculateTotalPremiumPaidJPY,
  calculateTotalPremiumPaidUSD,
  calculateTotalPremiumReceivedJPY,
  calculateTotalPremiumReceivedUSD,
} from "./calculations";

const HISTORY_STATUSES = new Set(["closed", "assigned", "expired"]);

export type DashboardPremiumDisplay = {
  basis: "planned" | "open_unconfirmed" | "confirmed" | "history";
  label: string;
  hasPremiumInput: boolean;
  premiumJPY: number;
  premiumUSD: number;
  netAfterFeesJPY?: number;
  netAfterFeesUSD?: number;
};

function getFxRate(simulation: TradeSimulation): number {
  return simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
    ? simulation.referenceFxRateJPY ?? simulation.fxRateJPY
    : simulation.fxRateJPY;
}

function hasConfirmedEntryExecution(simulation: TradeSimulation): boolean {
  return (simulation.optionEntryExecutions ?? []).some((execution) => execution.confirmed);
}

function calculateManualFeeJPY(simulation: TradeSimulation): number {
  const fxRate = getFxRate(simulation) || 1;
  return (
    (simulation.brokerCommissionUSD ?? 0) * fxRate +
    (simulation.brokerCommissionJPY ?? 0) +
    (simulation.exchangeFeesJPY ?? 0) +
    (simulation.fxConversionCostJPY ?? 0) +
    (simulation.carryingCostJPY ?? 0)
  );
}

function calculateManualFeeUSD(simulation: TradeSimulation): number {
  const fxRate = getFxRate(simulation) || 1;
  return (
    (simulation.brokerCommissionUSD ?? 0) +
    ((simulation.brokerCommissionJPY ?? 0) +
      (simulation.exchangeFeesJPY ?? 0) +
      (simulation.fxConversionCostJPY ?? 0) +
      (simulation.carryingCostJPY ?? 0)) /
      fxRate
  );
}

function hasLegPremiumInput(simulation: TradeSimulation): boolean {
  return simulation.optionLegs.some(
    (leg) => leg.quantity > 0 && Number.isFinite(leg.premiumUSD) && leg.premiumUSD > 0,
  );
}

function calculatePlannedPremiumDisplay(
  simulation: TradeSimulation,
  basis: "planned" | "open_unconfirmed",
): DashboardPremiumDisplay {
  const premiumUSD = calculateTotalPremiumReceivedUSD(simulation) - calculateTotalPremiumPaidUSD(simulation);
  const premiumJPY =
    simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
      ? premiumUSD * getFxRate(simulation)
      : calculateTotalPremiumReceivedJPY(simulation) - calculateTotalPremiumPaidJPY(simulation);
  const feeUSD = calculateManualFeeUSD(simulation);
  const feeJPY = calculateManualFeeJPY(simulation);

  return {
    basis,
    label: basis === "planned" ? "予定プレミアム" : "約定未確認プレミアム",
    hasPremiumInput: hasLegPremiumInput(simulation),
    premiumJPY,
    premiumUSD,
    netAfterFeesJPY: premiumJPY - feeJPY,
    netAfterFeesUSD: premiumUSD - feeUSD,
  };
}

export function calculateDashboardPremiumDisplay(simulation: TradeSimulation): DashboardPremiumDisplay {
  if (HISTORY_STATUSES.has(simulation.status)) {
    const premiumJPY = calculateNetInitialPremiumJPY(simulation);
    const premiumUSD =
      simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
        ? calculateNetInitialPremiumUSD(simulation)
        : premiumJPY / (getFxRate(simulation) || 1);
    return {
      basis: "history",
      label: "確定プレミアム",
      hasPremiumInput: true,
      premiumJPY,
      premiumUSD,
    };
  }

  if (simulation.status === "planned") {
    return calculatePlannedPremiumDisplay(simulation, "planned");
  }

  if (!hasConfirmedEntryExecution(simulation)) {
    return calculatePlannedPremiumDisplay(simulation, "open_unconfirmed");
  }

  const premiumJPY = calculateNetInitialPremiumJPY(simulation);
  const premiumUSD =
    simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
      ? calculateNetInitialPremiumUSD(simulation)
      : premiumJPY / (getFxRate(simulation) || 1);
  return {
    basis: "confirmed",
    label: "建玉時プレミアム",
    hasPremiumInput: true,
    premiumJPY,
    premiumUSD,
  };
}
