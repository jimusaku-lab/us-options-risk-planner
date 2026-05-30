import type { DenominatorResult, TaxResult, TradeSimulation } from "@/types/domain";
import { calculateAnnualReturnPercent, calculateNetInitialPremiumJPY, getShortCallLegs } from "./calculations";
import { taxProfiles } from "./tax";

export type CoveredCallAssignmentPreview = {
  callStrikeUSD: number;
  sharesToSell: number;
  grossProceedsJPY: number;
  costBasisJPY: number;
  stockCapitalGainJPY: number;
  stockEstimatedTaxJPY: number;
  stockAfterTaxGainJPY: number;
  optionPremiumBeforeTaxJPY: number;
  optionAfterTaxJPY: number;
  combinedBeforeTaxJPY: number;
  combinedAfterTaxJPY: number;
  combinedBeforeTaxAnnualReturnPct: number;
  combinedAfterTaxAnnualReturnPct: number;
};

export function calculateCoveredCallAssignmentPreview(
  simulation: TradeSimulation,
  taxResult: TaxResult,
  primaryDenominator: DenominatorResult,
): CoveredCallAssignmentPreview | null {
  const stock = simulation.stockPosition;
  if (!stock || stock.shares <= 0) return null;

  const callLeg = getShortCallLegs(simulation).find((leg) => stock.shares >= leg.quantity * 100 || leg.isCovered === true);
  if (!callLeg || callLeg.strikeUSD <= 0) return null;

  const sharesToSell = Math.min(stock.shares, callLeg.quantity * 100);
  if (sharesToSell <= 0) return null;

  const grossProceedsJPY = callLeg.strikeUSD * sharesToSell * simulation.fxRateJPY;
  const costBasisJPY = stock.averageCostUSD * sharesToSell * simulation.fxRateJPY;
  const stockCapitalGainJPY = grossProceedsJPY - costBasisJPY;
  const stockTaxRatePct = taxProfiles.japan_listed_stock_default_20_315.taxRatePct;
  const stockEstimatedTaxJPY = Math.floor((Math.max(0, stockCapitalGainJPY) * stockTaxRatePct) / 100);
  const stockAfterTaxGainJPY = stockCapitalGainJPY - stockEstimatedTaxJPY;
  const optionPremiumBeforeTaxJPY = calculateNetInitialPremiumJPY(simulation);
  const optionAfterTaxJPY = taxResult.netProfitJPY;
  const combinedBeforeTaxJPY = taxResult.feeAdjustedProfitJPY + stockCapitalGainJPY;
  const combinedAfterTaxJPY = optionAfterTaxJPY + stockAfterTaxGainJPY;

  return {
    callStrikeUSD: callLeg.strikeUSD,
    sharesToSell,
    grossProceedsJPY,
    costBasisJPY,
    stockCapitalGainJPY,
    stockEstimatedTaxJPY,
    stockAfterTaxGainJPY,
    optionPremiumBeforeTaxJPY,
    optionAfterTaxJPY,
    combinedBeforeTaxJPY,
    combinedAfterTaxJPY,
    combinedBeforeTaxAnnualReturnPct: calculateAnnualReturnPercent({
      netProfitJPY: combinedBeforeTaxJPY,
      denominatorJPY: primaryDenominator.amountJPY,
      dte: simulation.dte,
    }),
    combinedAfterTaxAnnualReturnPct: calculateAnnualReturnPercent({
      netProfitJPY: combinedAfterTaxJPY,
      denominatorJPY: primaryDenominator.amountJPY,
      dte: simulation.dte,
    }),
  };
}
