import type { OptionLeg, StockPosition, TradeSimulation } from "@/types/domain";

const CONTRACT_SIZE = 100;

export function calculateDte(entryDate: string, expiryDate: string): number {
  const start = new Date(`${entryDate}T00:00:00Z`);
  const end = new Date(`${expiryDate}T00:00:00Z`);
  return Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
}

export function calculatePremiumJPY(params: {
  premiumUSD: number;
  quantity: number;
  fxRateJPY: number;
}): number {
  return params.premiumUSD * CONTRACT_SIZE * params.quantity * params.fxRateJPY;
}

export function calculatePremiumUSD(params: {
  premiumUSD: number;
  quantity: number;
}): number {
  return params.premiumUSD * CONTRACT_SIZE * params.quantity;
}

export function calculateStockDenominatorJPY(params: {
  shares: number;
  priceUSD: number;
  fxRateJPY: number;
}): number {
  return params.shares * params.priceUSD * params.fxRateJPY;
}

export function calculateUsedMarginJPY(params: {
  brokerMarginJPY: number;
  marginBufferMultiplier: number;
}): number {
  return params.brokerMarginJPY * params.marginBufferMultiplier;
}

export function calculatePutAssignmentCapitalJPY(params: {
  putStrikeUSD: number;
  quantity: number;
  fxRateJPY: number;
}): number {
  return params.putStrikeUSD * CONTRACT_SIZE * params.quantity * params.fxRateJPY;
}

export function calculateAnnualReturnPercent(params: {
  netProfitJPY: number;
  denominatorJPY: number;
  dte: number;
}): number {
  if (params.denominatorJPY <= 0 || params.dte <= 0) return 0;
  return (params.netProfitJPY / params.denominatorJPY) * (365 / params.dte) * 100;
}

export function calculateAnnualReturnPercentByCurrency(params: {
  netProfit: number;
  denominator: number;
  dte: number;
}): number {
  if (params.denominator <= 0 || params.dte <= 0) return 0;
  return (params.netProfit / params.denominator) * (365 / params.dte) * 100;
}

export function getSelectedStockDenominatorPriceUSD(
  stockPosition: StockPosition | null,
  currentPriceUSD: number,
): number {
  if (!stockPosition) return 0;
  if (stockPosition.denominatorPriceMode === "average_cost") return stockPosition.averageCostUSD;
  if (stockPosition.denominatorPriceMode === "custom") {
    return stockPosition.customDenominatorPriceUSD ?? currentPriceUSD;
  }
  return currentPriceUSD;
}

export function getShortOptionLegs(simulation: TradeSimulation): OptionLeg[] {
  return simulation.optionLegs.filter((leg) => leg.side === "sell");
}

export function getShortPutLegs(simulation: TradeSimulation): OptionLeg[] {
  return getShortOptionLegs(simulation).filter((leg) => leg.type === "put");
}

export function getShortCallLegs(simulation: TradeSimulation): OptionLeg[] {
  return getShortOptionLegs(simulation).filter((leg) => leg.type === "call");
}

export function calculateTotalPremiumReceivedJPY(simulation: TradeSimulation): number {
  return simulation.optionLegs
    .filter((leg) => leg.side === "sell")
    .reduce(
      (sum, leg) =>
        sum +
        calculatePremiumJPY({
          premiumUSD: leg.premiumUSD,
          quantity: leg.quantity,
          fxRateJPY: simulation.fxRateJPY,
        }),
      0,
    );
}

export function calculateTotalPremiumReceivedUSD(simulation: TradeSimulation): number {
  return simulation.optionLegs
    .filter((leg) => leg.side === "sell")
    .reduce(
      (sum, leg) =>
        sum +
        calculatePremiumUSD({
          premiumUSD: leg.premiumUSD,
          quantity: leg.quantity,
        }),
      0,
    );
}

export function calculateTotalPremiumPaidJPY(simulation: TradeSimulation): number {
  return simulation.optionLegs
    .filter((leg) => leg.side === "buy")
    .reduce(
      (sum, leg) =>
        sum +
        calculatePremiumJPY({
          premiumUSD: leg.premiumUSD,
          quantity: leg.quantity,
          fxRateJPY: simulation.fxRateJPY,
        }),
      0,
    );
}

export function calculateTotalPremiumPaidUSD(simulation: TradeSimulation): number {
  return simulation.optionLegs
    .filter((leg) => leg.side === "buy")
    .reduce(
      (sum, leg) =>
        sum +
        calculatePremiumUSD({
          premiumUSD: leg.premiumUSD,
          quantity: leg.quantity,
        }),
      0,
    );
}

export function calculateNetInitialPremiumJPY(simulation: TradeSimulation): number {
  if (simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT") {
    return calculateNetInitialPremiumUSD(simulation) * (simulation.referenceFxRateJPY ?? simulation.fxRateJPY);
  }
  if (simulation.brokerSettlement?.netCashflowJPY !== undefined) return simulation.brokerSettlement.netCashflowJPY;
  return calculateTotalPremiumReceivedJPY(simulation) - calculateTotalPremiumPaidJPY(simulation);
}

export function calculateNetInitialPremiumUSD(simulation: TradeSimulation): number {
  if (simulation.brokerSettlement?.netCashflowUSD !== undefined) return simulation.brokerSettlement.netCashflowUSD;
  return calculateTotalPremiumReceivedUSD(simulation) - calculateTotalPremiumPaidUSD(simulation);
}

export function calculateTotalFeesJPY(simulation: TradeSimulation): number {
  if (simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT") {
    return calculateTotalFeesUSD(simulation) * (simulation.referenceFxRateJPY ?? simulation.fxRateJPY);
  }
  return (
    (simulation.brokerCommissionUSD ?? 0) * simulation.fxRateJPY +
    (simulation.brokerCommissionJPY ?? 0) +
    (simulation.exchangeFeesJPY ?? 0) +
    (simulation.fxConversionCostJPY ?? 0) +
    (simulation.carryingCostJPY ?? 0)
  );
}

export function calculateTotalFeesUSD(simulation: TradeSimulation): number {
  if (simulation.brokerSettlement) {
    return (
      (simulation.brokerSettlement.commissionUSD ?? 0) +
      (simulation.brokerSettlement.exchangeFeeUSD ?? 0) +
      ((simulation.brokerSettlement.commissionJPY ?? 0) + (simulation.brokerSettlement.exchangeFeeJPY ?? 0)) /
        (simulation.brokerSettlement.appliedFxRate || simulation.fxRateJPY || 1)
    );
  }
  return (
    (simulation.brokerCommissionUSD ?? 0) +
    ((simulation.brokerCommissionJPY ?? 0) + (simulation.exchangeFeesJPY ?? 0) + (simulation.fxConversionCostJPY ?? 0) + (simulation.carryingCostJPY ?? 0)) /
      (simulation.fxRateJPY || 1)
  );
}

export function calculateNetInitialPremiumAfterFeesJPY(simulation: TradeSimulation): number {
  return calculateNetInitialPremiumJPY(simulation) - calculateTotalFeesJPY(simulation);
}

export function calculatePutAssignmentCapitalTotalJPY(simulation: TradeSimulation): number {
  if (simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT") {
    return calculatePutAssignmentCapitalTotalUSD(simulation) * (simulation.referenceFxRateJPY ?? simulation.fxRateJPY);
  }
  return getShortPutLegs(simulation).reduce(
    (sum, leg) =>
      sum +
      calculatePutAssignmentCapitalJPY({
        putStrikeUSD: leg.strikeUSD,
        quantity: leg.quantity,
        fxRateJPY: simulation.fxRateJPY,
      }),
    0,
  );
}

export function calculatePutAssignmentCapitalTotalUSD(simulation: TradeSimulation): number {
  return getShortPutLegs(simulation).reduce((sum, leg) => sum + leg.strikeUSD * CONTRACT_SIZE * leg.quantity, 0);
}

export function calculateUncoveredCallShares(simulation: TradeSimulation): number {
  const requiredShares = getShortCallLegs(simulation).reduce(
    (sum, leg) => sum + leg.quantity * CONTRACT_SIZE,
    0,
  );
  return Math.max(0, requiredShares - (simulation.stockPosition?.shares ?? 0));
}

export function calculateCallHedgeBuyCapitalJPY(simulation: TradeSimulation): number {
  return getShortCallLegs(simulation).reduce((sum, leg) => {
    const uncoveredShares = calculateUncoveredCallShares(simulation);
    if (uncoveredShares <= 0 || !leg.hedgeBuyStopUSD) return sum;
    return sum + leg.hedgeBuyStopUSD * uncoveredShares * simulation.fxRateJPY;
  }, 0);
}

export function calculateStockDenominatorForSimulationJPY(simulation: TradeSimulation): number {
  const priceUSD = getSelectedStockDenominatorPriceUSD(
    simulation.stockPosition,
    simulation.currentPriceUSD,
  );
  return calculateStockDenominatorJPY({
    shares: simulation.stockPosition?.shares ?? 0,
    priceUSD,
    fxRateJPY: simulation.fxRateJPY,
  });
}

export function calculateStockDenominatorForSimulationUSD(simulation: TradeSimulation): number {
  const priceUSD = getSelectedStockDenominatorPriceUSD(
    simulation.stockPosition,
    simulation.currentPriceUSD,
  );
  return (simulation.stockPosition?.shares ?? 0) * priceUSD;
}

export function calculateUsedMarginUSD(simulation: TradeSimulation): number {
  const marginUSD = simulation.brokerMarginUSD ?? (simulation.fxRateJPY > 0 ? simulation.brokerMarginJPY / simulation.fxRateJPY : 0);
  return marginUSD * simulation.marginBufferMultiplier;
}

export function calculateCallHedgeBuyCapitalUSD(simulation: TradeSimulation): number {
  return getShortCallLegs(simulation).reduce((sum, leg) => {
    const uncoveredShares = calculateUncoveredCallShares(simulation);
    if (uncoveredShares <= 0 || !leg.hedgeBuyStopUSD) return sum;
    return sum + leg.hedgeBuyStopUSD * uncoveredShares;
  }, 0);
}

export function calculateCloseCostJPY(leg: OptionLeg, fxRateJPY: number): number | null {
  const closeCostUSD = leg.closeCostUSD ?? leg.closePlan?.closePriceUSD;
  if (closeCostUSD === undefined || closeCostUSD <= 0) return null;
  return closeCostUSD * CONTRACT_SIZE * leg.quantity * fxRateJPY;
}
