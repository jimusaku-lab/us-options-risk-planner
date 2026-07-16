import type { DenominatorResult, OptionLeg, TaxResult, TradeSimulation } from "@/types/domain";
import { calculateNetInitialPremiumJPY } from "./calculations";
import { calculateDenominators, getPrimaryDenominator } from "./denominators";
import {
  calculateOptionCloseExecutionResults,
  sanitizeSaxoHistoryCloseExecutions,
  type OptionCloseExecutionResult,
} from "./optionCloseExecutions";
import { calculateTaxResult, taxProfiles } from "./tax";
import { shouldIncludeCompositeCloseResultsInPerformance } from "./compositeOptionPosition";

export type HistoryPerformanceResult = {
  simulation: TradeSimulation;
  taxSimulation: TradeSimulation;
  historyResultMode: boolean;
  assignedPutStockHoldingMode: boolean;
  assignedShortPutLeg?: OptionLeg;
  assignedPutDenominatorJPY?: number;
  assignedPutDenominatorShares?: number;
  assignedPutDenominatorFx?: number;
  premiumJPY: number;
  realizedOptionProfitJPY: number;
  realizedOptionProfitUSD: number;
  realizedOptionDays: number;
  taxGrossProfitJPY: number;
  grossDenominators: DenominatorResult[];
  denominators: DenominatorResult[];
  primaryGrossDenominator: DenominatorResult;
  primaryDenominator: DenominatorResult;
  taxResult: TaxResult;
  optionCloseExecutionResults: OptionCloseExecutionResult[];
};

const endedStatuses = new Set<TradeSimulation["status"]>(["closed", "assigned", "expired"]);

export function calculateHistoryPerformance(simulation: TradeSimulation): HistoryPerformanceResult {
  const sanitized = sanitizeSaxoHistoryCloseExecutions(simulation);
  const historyResultMode = endedStatuses.has(sanitized.status);
  const assignedShortPutLeg = sanitized.optionLegs.find((leg) => leg.type === "put" && leg.side === "sell");
  const assignedStockAcquisition = sanitized.stockAcquisition;
  const assignedPutStockHoldingMode =
    sanitized.status === "assigned" &&
    Boolean(assignedShortPutLeg) &&
    Boolean(
      assignedStockAcquisition?.enabled &&
        Number.isFinite(assignedStockAcquisition.shares) &&
        assignedStockAcquisition.shares > 0 &&
        Number.isFinite(assignedStockAcquisition.priceUSD) &&
        assignedStockAcquisition.priceUSD > 0,
    );
  const optionPerformanceSimulation = assignedPutStockHoldingMode
    ? {
        ...sanitized,
        stockPosition: sanitized.stockPosition ? { ...sanitized.stockPosition, shares: 0 } : sanitized.stockPosition,
        denominatorMode: "cash_secured" as const,
      }
    : sanitized;
  const assignedPutDenominatorFx = sanitized.referenceFxRateJPY ?? sanitized.fxRateJPY;
  const assignedPutDenominatorShares = assignedShortPutLeg
    ? Math.abs(assignedShortPutLeg.quantity) * 100
    : assignedStockAcquisition?.shares ?? 0;
  const assignedPutDenominatorJPY =
    assignedPutStockHoldingMode && assignedShortPutLeg && assignedPutDenominatorFx > 0
      ? assignedShortPutLeg.strikeUSD * assignedPutDenominatorShares * assignedPutDenominatorFx
      : undefined;
  const premiumJPY = calculateNetInitialPremiumJPY(sanitized);
  const optionCloseExecutionResults = shouldIncludeCompositeCloseResultsInPerformance(sanitized)
    ? calculateOptionCloseExecutionResults(sanitized)
    : [];
  const hasCloseExecutionResults = optionCloseExecutionResults.length > 0;
  const requiresExecutionRecord = sanitized.status === "closed" || sanitized.status === "expired";
  const realizedOptionProfitJPY = optionCloseExecutionResults.reduce((sum, result) => sum + result.realizedPnlJPY, 0);
  const realizedOptionProfitUSD = optionCloseExecutionResults.reduce((sum, result) => sum + result.realizedPnlUSD, 0);
  const realizedOptionDays = hasCloseExecutionResults
    ? Math.max(
        1,
        Math.round(
          optionCloseExecutionResults.reduce((sum, result) => sum + result.holdingDays, 0) /
            optionCloseExecutionResults.length,
        ),
      )
    : sanitized.dte;
  const taxGrossProfitJPY = requiresExecutionRecord
    ? hasCloseExecutionResults
      ? realizedOptionProfitJPY
      : 0
    : premiumJPY;
  const taxSimulation = {
    ...optionPerformanceSimulation,
    dte: requiresExecutionRecord ? realizedOptionDays : sanitized.dte,
    ...(requiresExecutionRecord
      ? {
          brokerCommissionUSD: 0,
          brokerCommissionJPY: 0,
          exchangeFeesJPY: 0,
          fxConversionCostJPY: 0,
          carryingCostJPY: 0,
        }
      : {}),
  };
  const useUsdHistoryReturns =
    sanitized.accountEnvironment === "PROD_N_USD_SETTLEMENT" &&
    requiresExecutionRecord &&
    hasCloseExecutionResults &&
    Math.abs(realizedOptionProfitUSD) > 0.0001;
  const applyUsdHistoryReturns = (rows: DenominatorResult[]) =>
    useUsdHistoryReturns
      ? rows.map((row) => {
          const denominatorUSD = row.amountUSD ?? 0;
          const annualReturnPct = denominatorUSD > 0 && taxSimulation.dte > 0
            ? (realizedOptionProfitUSD / denominatorUSD / taxSimulation.dte) * 365 * 100
            : 0;
          return {
            ...row,
            annualReturnPct,
            netAnnualReturnPct: annualReturnPct,
          };
        })
      : rows;
  const grossDenominators = applyUsdHistoryReturns(calculateDenominators(taxSimulation, taxGrossProfitJPY));
  const primaryGrossDenominator = getPrimaryDenominator(grossDenominators);
  const taxProfile = taxProfiles[sanitized.taxProfileId];
  const taxResult = calculateTaxResult({
    simulation: taxSimulation,
    grossProfitJPY: taxGrossProfitJPY,
    denominatorJPY: primaryGrossDenominator.amountJPY,
    taxProfile,
  });
  const denominators = applyUsdHistoryReturns(calculateDenominators(taxSimulation, taxGrossProfitJPY, taxResult.netProfitJPY));
  const primaryDenominator = getPrimaryDenominator(denominators);

  return {
    simulation: sanitized,
    taxSimulation,
    historyResultMode,
    assignedPutStockHoldingMode,
    assignedShortPutLeg,
    assignedPutDenominatorJPY,
    assignedPutDenominatorShares,
    assignedPutDenominatorFx,
    premiumJPY,
    realizedOptionProfitJPY,
    realizedOptionProfitUSD,
    realizedOptionDays,
    taxGrossProfitJPY,
    grossDenominators,
    denominators,
    primaryGrossDenominator,
    primaryDenominator,
    taxResult,
    optionCloseExecutionResults,
  };
}
