import type { TaxBucketSummary, TradeSimulation } from "@/types/domain";
import { calculateDenominators, getPrimaryDenominator } from "./denominators";
import { calculateNetInitialPremiumJPY } from "./calculations";
import { calculateOptionCloseExecutionResults } from "./optionCloseExecutions";
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
        const closeExecutionResults = calculateOptionCloseExecutionResults(simulation);
        const hasCloseExecutions = closeExecutionResults.length > 0;
        const requiresExecutionRecord = simulation.status === "closed" || simulation.status === "expired";
        const missingExecutionRecord = requiresExecutionRecord && !hasCloseExecutions;
        const premiumJPY = calculateNetInitialPremiumJPY(simulation);
        const primary = getPrimaryDenominator(calculateDenominators(simulation, premiumJPY));
        const taxResult =
          requiresExecutionRecord && hasCloseExecutions
            ? null
            : missingExecutionRecord
              ? null
              : calculateTaxResult({
                  simulation,
                  grossProfitJPY: premiumJPY,
                  denominatorJPY: primary.amountJPY,
                  taxProfile: taxProfiles[simulation.taxProfileId],
                });
        const closeRealizedPnlJPY = closeExecutionResults.reduce((sum, result) => sum + result.realizedPnlJPY, 0);
        const closeCapitalDaysJPY = closeExecutionResults.reduce((sum, result) => sum + result.denominatorJPY * result.holdingDays / 365, 0);
        const optionCapitalDaysJPY =
          requiresExecutionRecord && hasCloseExecutions
            ? closeCapitalDaysJPY
            : taxResult
              ? primary.amountJPY * Math.max(0, simulation.dte) / 365
              : 0;
        const stockTax = calculateStockSettlementTaxResult(simulation);
        const stockCapitalDaysJPY = stockTax.costBasisJPY * Math.max(0, stockTax.holdingDays) / 365;

        const optionProfitJPY = summary.optionProfitJPY + (requiresExecutionRecord && hasCloseExecutions ? closeRealizedPnlJPY : taxResult?.feeAdjustedProfitJPY ?? 0);
        const nextOptionCapitalDaysJPY = summary.optionCapitalDaysJPY + optionCapitalDaysJPY;
        const stockRealizedGainJPY = summary.stockRealizedGainJPY + stockTax.realizedGainJPY;
        const nextStockCapitalDaysJPY = summary.stockCapitalDaysJPY + stockCapitalDaysJPY;

        return {
          optionProfitJPY,
          optionCapitalDaysJPY: nextOptionCapitalDaysJPY,
          optionAnnualReturnPct: annualizeFromCapitalDays(optionProfitJPY, nextOptionCapitalDaysJPY),
          optionCloseMissingCount: summary.optionCloseMissingCount + (missingExecutionRecord ? 1 : 0),
          stockRealizedGainJPY,
          stockCapitalDaysJPY: nextStockCapitalDaysJPY,
          stockAnnualReturnPct: annualizeFromCapitalDays(stockRealizedGainJPY, nextStockCapitalDaysJPY),
          optionCount: summary.optionCount + (missingExecutionRecord ? 0 : 1),
          stockSettlementCount: summary.stockSettlementCount + (stockTax.enabled ? 1 : 0),
        };
      },
      {
        optionProfitJPY: 0,
        optionCapitalDaysJPY: 0,
        optionAnnualReturnPct: 0,
        optionCloseMissingCount: 0,
        stockRealizedGainJPY: 0,
        stockCapitalDaysJPY: 0,
        stockAnnualReturnPct: 0,
        optionCount: 0,
        stockSettlementCount: 0,
      },
    );
}
