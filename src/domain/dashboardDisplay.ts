import type { TradeSimulation } from "@/types/domain";
import {
  calculateAnnualReturnPercentByCurrency,
  calculateDte,
  calculateNetInitialPremiumJPY,
  calculateNetInitialPremiumUSD,
  calculateTotalPremiumPaidJPY,
  calculateTotalPremiumPaidUSD,
  calculateTotalPremiumReceivedJPY,
  calculateTotalPremiumReceivedUSD,
} from "./calculations";

const HISTORY_STATUSES = new Set(["closed", "assigned", "expired"]);

export type CoveredCallAssignmentEstimate = {
  shares: number;
  costBasisDenominatorUSD: number;
  currentPriceDenominatorUSD?: number;
  stockSaleGainUSD: number;
  totalWithPremiumUSD: number;
  totalAfterFeesUSD: number;
  annualReturnPct?: number;
  netAnnualReturnPct?: number;
};

export type DashboardPremiumDisplay = {
  basis: "planned" | "open_unconfirmed" | "confirmed" | "history";
  label: string;
  hasPremiumInput: boolean;
  effectiveFxRateJPY: number | null;
  dte: number;
  premiumJPY: number;
  premiumUSD: number;
  annualReturnPct?: number;
  netAnnualReturnPct?: number;
  netAfterFeesJPY?: number;
  netAfterFeesUSD?: number;
  coveredCallAssignmentEstimate?: CoveredCallAssignmentEstimate;
};

export function getEffectiveFxRateJPY(simulation: TradeSimulation): number | null {
  if (simulation.referenceFxRateJPY !== undefined && simulation.referenceFxRateJPY > 0) return simulation.referenceFxRateJPY;
  if (simulation.fxRateJPY > 0) return simulation.fxRateJPY;
  return null;
}

function getFxRateOrZero(simulation: TradeSimulation): number {
  return getEffectiveFxRateJPY(simulation) ?? 0;
}

function getDisplayDte(simulation: TradeSimulation): number {
  const calculatedDte = calculateDte(simulation.entryDate, simulation.expiryDate);
  if (Number.isFinite(calculatedDte) && calculatedDte > 0) return calculatedDte;
  return Math.max(0, simulation.dte);
}

function hasConfirmedEntryExecution(simulation: TradeSimulation): boolean {
  return (simulation.optionEntryExecutions ?? []).some((execution) => execution.confirmed);
}

function calculateManualFeeJPY(simulation: TradeSimulation): number {
  const fxRate = getEffectiveFxRateJPY(simulation) ?? 0;
  return (
    (simulation.brokerCommissionUSD ?? 0) * fxRate +
    (simulation.brokerCommissionJPY ?? 0) +
    (simulation.exchangeFeesJPY ?? 0) +
    (simulation.fxConversionCostJPY ?? 0) +
    (simulation.carryingCostJPY ?? 0)
  );
}

function calculateManualFeeUSD(simulation: TradeSimulation): number {
  const fxRate = getEffectiveFxRateJPY(simulation);
  return (
    (simulation.brokerCommissionUSD ?? 0) +
    (fxRate && fxRate > 0
      ? ((simulation.brokerCommissionJPY ?? 0) +
          (simulation.exchangeFeesJPY ?? 0) +
          (simulation.fxConversionCostJPY ?? 0) +
          (simulation.carryingCostJPY ?? 0)) /
        fxRate
      : 0)
  );
}

function hasLegPremiumInput(simulation: TradeSimulation): boolean {
  return simulation.optionLegs.some(
    (leg) => leg.quantity > 0 && Number.isFinite(leg.premiumUSD) && leg.premiumUSD > 0,
  );
}

function calculateCoveredCallAssignmentEstimate(params: {
  simulation: TradeSimulation;
  premiumUSD: number;
  netAfterFeesUSD: number;
  denominatorUSD?: number;
  dte: number;
}): CoveredCallAssignmentEstimate | undefined {
  const callLeg = params.simulation.optionLegs.find((leg) => leg.type === "call" && leg.side === "sell");
  const stockPosition = params.simulation.stockPosition;
  if (!callLeg || !stockPosition || params.simulation.strategyType !== "covered_call") return undefined;
  const coveredShares = Math.min(stockPosition.shares, callLeg.quantity * 100);
  if (coveredShares <= 0 || callLeg.strikeUSD <= 0 || stockPosition.averageCostUSD <= 0) return undefined;
  const costBasisDenominatorUSD = stockPosition.averageCostUSD * coveredShares;
  const currentPriceDenominatorUSD =
    params.simulation.currentPriceUSD > 0 ? params.simulation.currentPriceUSD * coveredShares : undefined;
  const stockSaleGainUSD = (callLeg.strikeUSD - stockPosition.averageCostUSD) * coveredShares;
  const totalWithPremiumUSD = stockSaleGainUSD + params.premiumUSD;
  const totalAfterFeesUSD = stockSaleGainUSD + params.netAfterFeesUSD;
  return {
    shares: coveredShares,
    costBasisDenominatorUSD,
    currentPriceDenominatorUSD,
    stockSaleGainUSD,
    totalWithPremiumUSD,
    totalAfterFeesUSD,
    annualReturnPct:
      params.denominatorUSD && params.denominatorUSD > 0
        ? calculateAnnualReturnPercentByCurrency({
            netProfit: totalWithPremiumUSD,
            denominator: params.denominatorUSD,
            dte: params.dte,
          })
        : undefined,
    netAnnualReturnPct:
      params.denominatorUSD && params.denominatorUSD > 0
        ? calculateAnnualReturnPercentByCurrency({
            netProfit: totalAfterFeesUSD,
            denominator: params.denominatorUSD,
            dte: params.dte,
          })
        : undefined,
  };
}

function calculatePlannedPremiumDisplay(
  simulation: TradeSimulation,
  basis: "planned" | "open_unconfirmed",
): DashboardPremiumDisplay {
  const effectiveFxRateJPY = getEffectiveFxRateJPY(simulation);
  const dte = getDisplayDte(simulation);
  const premiumUSD = calculateTotalPremiumReceivedUSD(simulation) - calculateTotalPremiumPaidUSD(simulation);
  const premiumJPY =
    simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
      ? effectiveFxRateJPY
        ? premiumUSD * effectiveFxRateJPY
        : 0
      : calculateTotalPremiumReceivedJPY(simulation) - calculateTotalPremiumPaidJPY(simulation);
  const feeUSD = calculateManualFeeUSD(simulation);
  const feeJPY = calculateManualFeeJPY(simulation);
  const netAfterFeesUSD = premiumUSD - feeUSD;
  const netAfterFeesJPY = premiumJPY - feeJPY;
  const denominatorUSD = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
    ? simulation.stockPosition?.shares && simulation.stockPosition.averageCostUSD > 0
      ? simulation.stockPosition.shares * simulation.stockPosition.averageCostUSD
      : undefined
    : undefined;
  const denominatorJPY = simulation.accountEnvironment !== "PROD_N_USD_SETTLEMENT"
    ? simulation.customDenominatorJPY ?? 0
    : undefined;

  return {
    basis,
    label: basis === "planned" ? "予定プレミアム" : "約定未確認プレミアム",
    hasPremiumInput: hasLegPremiumInput(simulation),
    effectiveFxRateJPY,
    dte,
    premiumJPY,
    premiumUSD,
    annualReturnPct:
      simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
        ? denominatorUSD && denominatorUSD > 0
          ? calculateAnnualReturnPercentByCurrency({ netProfit: premiumUSD, denominator: denominatorUSD, dte })
          : undefined
        : denominatorJPY && denominatorJPY > 0
          ? calculateAnnualReturnPercentByCurrency({ netProfit: premiumJPY, denominator: denominatorJPY, dte })
          : undefined,
    netAnnualReturnPct:
      simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
        ? denominatorUSD && denominatorUSD > 0
          ? calculateAnnualReturnPercentByCurrency({ netProfit: netAfterFeesUSD, denominator: denominatorUSD, dte })
          : undefined
        : denominatorJPY && denominatorJPY > 0
          ? calculateAnnualReturnPercentByCurrency({ netProfit: netAfterFeesJPY, denominator: denominatorJPY, dte })
          : undefined,
    netAfterFeesJPY,
    netAfterFeesUSD,
    coveredCallAssignmentEstimate: calculateCoveredCallAssignmentEstimate({
      simulation,
      premiumUSD,
      netAfterFeesUSD,
      denominatorUSD,
      dte,
    }),
  };
}

export function calculateDashboardPremiumDisplay(simulation: TradeSimulation): DashboardPremiumDisplay {
  if (HISTORY_STATUSES.has(simulation.status)) {
    const premiumJPY = calculateNetInitialPremiumJPY(simulation);
    const premiumUSD =
      simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
        ? calculateNetInitialPremiumUSD(simulation)
        : premiumJPY / (getFxRateOrZero(simulation) || 1);
    return {
      basis: "history",
      label: "確定プレミアム",
      hasPremiumInput: true,
      effectiveFxRateJPY: getEffectiveFxRateJPY(simulation),
      dte: getDisplayDte(simulation),
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
      : premiumJPY / (getFxRateOrZero(simulation) || 1);
  return {
    basis: "confirmed",
    label: "建玉時プレミアム",
    hasPremiumInput: true,
    effectiveFxRateJPY: getEffectiveFxRateJPY(simulation),
    dte: getDisplayDte(simulation),
    premiumJPY,
    premiumUSD,
  };
}
