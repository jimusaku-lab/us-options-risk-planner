import type { TaxBucketSummary, TradeSimulation } from "@/types/domain";
import { calculateDenominators, getPrimaryDenominator } from "./denominators";
import { calculateNetInitialPremiumJPY } from "./calculations";
import { calculateStockSettlementTaxResult, calculateTaxResult, taxProfiles } from "./tax";

const endedStatuses = new Set(["closed", "assigned", "expired"]);

function annualizeFromCapitalDays(profitJPY: number, capitalDaysJPY: number): number {
  if (capitalDaysJPY <= 0) return 0;
  return (profitJPY / capitalDaysJPY) * 365 * 100;
}

export function calculateTaxBucketSummary(simulations: TradeSimulation[]): TaxBucketSummary {
  return simulations
    .filter((simulation) => endedStatuses.has(simulation.status))
    .reduce<TaxBucketSummary>(
      (summary, simulation) => {
        const premiumJPY = calculateNetInitialPremiumJPY(simulation);
        const primary = getPrimaryDenominator(calculateDenominators(simulation, premiumJPY));
        const taxResult = calculateTaxResult({
          simulation,
          grossProfitJPY: premiumJPY,
          denominatorJPY: primary.amountJPY,
          taxProfile: taxProfiles[simulation.taxProfileId],
        });
        const optionCapitalDaysJPY = primary.amountJPY * Math.max(0, simulation.dte) / 365;
        const stockTax = calculateStockSettlementTaxResult(simulation);
        const stockCapitalDaysJPY = stockTax.costBasisJPY * Math.max(0, stockTax.holdingDays) / 365;

        const optionProfitJPY = summary.optionProfitJPY + taxResult.feeAdjustedProfitJPY;
        const nextOptionCapitalDaysJPY = summary.optionCapitalDaysJPY + optionCapitalDaysJPY;
        const stockRealizedGainJPY = summary.stockRealizedGainJPY + stockTax.realizedGainJPY;
        const nextStockCapitalDaysJPY = summary.stockCapitalDaysJPY + stockCapitalDaysJPY;

        return {
          optionProfitJPY,
          optionCapitalDaysJPY: nextOptionCapitalDaysJPY,
          optionAnnualReturnPct: annualizeFromCapitalDays(optionProfitJPY, nextOptionCapitalDaysJPY),
          stockRealizedGainJPY,
          stockCapitalDaysJPY: nextStockCapitalDaysJPY,
          stockAnnualReturnPct: annualizeFromCapitalDays(stockRealizedGainJPY, nextStockCapitalDaysJPY),
          optionCount: summary.optionCount + 1,
          stockSettlementCount: summary.stockSettlementCount + (stockTax.enabled ? 1 : 0),
        };
      },
      {
        optionProfitJPY: 0,
        optionCapitalDaysJPY: 0,
        optionAnnualReturnPct: 0,
        stockRealizedGainJPY: 0,
        stockCapitalDaysJPY: 0,
        stockAnnualReturnPct: 0,
        optionCount: 0,
        stockSettlementCount: 0,
      },
    );
}
