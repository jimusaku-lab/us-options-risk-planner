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
  realizedOptionDays?: number;
  historicalAnnualReturnMissingReason?: string;
  taxGrossProfitJPY: number;
  grossDenominators: DenominatorResult[];
  denominators: DenominatorResult[];
  primaryGrossDenominator: DenominatorResult;
  primaryDenominator: DenominatorResult;
  taxResult: TaxResult;
  optionCloseExecutionResults: OptionCloseExecutionResult[];
};

const endedStatuses = new Set<TradeSimulation["status"]>(["closed", "assigned", "expired"]);

function isLongOptionHistory(simulation: TradeSimulation, results: OptionCloseExecutionResult[], requiresExecutionRecord: boolean): boolean {
  return requiresExecutionRecord && results.length > 0 && simulation.optionLegs.length > 0 && simulation.optionLegs.every((leg) => leg.side === "buy");
}

function applyLongOptionHistoryDenominator(params: { rows: DenominatorResult[]; results: OptionCloseExecutionResult[]; isN: boolean; realizedPnl: number; netProfit?: number }): { rows: DenominatorResult[]; missingReason?: string } {
  const missingReason = params.results.find((result) => result.annualReturnMissingReason)?.annualReturnMissingReason;
  if (missingReason || params.results.some((result) => result.annualReturnPct === undefined || result.holdingDays === undefined)) return { rows: params.rows, missingReason: missingReason ?? "購入時支払額または保有日数" };
  const denominator = params.results.reduce((sum, result) => sum + (params.isN ? result.denominatorUSD ?? 0 : result.denominatorJPY), 0);
  const exposure = params.results.reduce((sum, result) => sum + (params.isN ? result.denominatorUSD ?? 0 : result.denominatorJPY) * (result.holdingDays ?? 0), 0);
  if (!(denominator > 0) || !(exposure > 0)) return { rows: params.rows, missingReason: "購入時支払額または保有日数" };
  const annualReturnPct = params.realizedPnl / exposure * 365 * 100;
  const netAnnualReturnPct = params.netProfit === undefined ? undefined : params.netProfit / exposure * 365 * 100;
  return { rows: params.rows.map((row) => row.isPrimary ? { ...row, label: "購入時支払総額", amountUSD: params.isN ? denominator : row.amountUSD, amountJPY: params.isN ? row.amountJPY : denominator, annualReturnPct, netAnnualReturnPct, explanation: "確認済みの買いオプション開始約定の支払額を使用。決済時手数料は実現損益に一度だけ含めます。", components: [{ label: "確認済み購入時支払額", amountJPY: params.isN ? row.amountJPY : denominator, amountUSD: params.isN ? denominator : undefined }] } : row) };
}

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
  const resolvedHoldingDays = optionCloseExecutionResults.map((result) => result.holdingDays).filter((days): days is number => days !== undefined);
  const realizedOptionDays = hasCloseExecutionResults && resolvedHoldingDays.length === optionCloseExecutionResults.length
    ? Math.max(1, Math.round(resolvedHoldingDays.reduce((sum, days) => sum + days, 0) / resolvedHoldingDays.length))
    : undefined;
  const taxGrossProfitJPY = requiresExecutionRecord
    ? hasCloseExecutionResults
      ? realizedOptionProfitJPY
      : 0
    : premiumJPY;
  const taxSimulation = {
    ...optionPerformanceSimulation,
    dte: requiresExecutionRecord ? (realizedOptionDays ?? sanitized.dte) : sanitized.dte,
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
  const longOptionHistory = isLongOptionHistory(sanitized, optionCloseExecutionResults, requiresExecutionRecord);
  const calculatedGrossDenominators = applyUsdHistoryReturns(calculateDenominators(taxSimulation, taxGrossProfitJPY));
  const grossLongReturn = longOptionHistory ? applyLongOptionHistoryDenominator({ rows: calculatedGrossDenominators, results: optionCloseExecutionResults, isN: sanitized.accountEnvironment === "PROD_N_USD_SETTLEMENT", realizedPnl: sanitized.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? realizedOptionProfitUSD : realizedOptionProfitJPY }) : { rows: calculatedGrossDenominators };
  const grossDenominators = grossLongReturn.rows;
  const primaryGrossDenominator = getPrimaryDenominator(grossDenominators);
  const taxProfile = taxProfiles[sanitized.taxProfileId];
  const taxResult = calculateTaxResult({
    simulation: taxSimulation,
    grossProfitJPY: taxGrossProfitJPY,
    denominatorJPY: primaryGrossDenominator.amountJPY,
    taxProfile,
  });
  const calculatedDenominators = applyUsdHistoryReturns(calculateDenominators(taxSimulation, taxGrossProfitJPY, taxResult.netProfitJPY));
  const longReturn = longOptionHistory ? applyLongOptionHistoryDenominator({ rows: calculatedDenominators, results: optionCloseExecutionResults, isN: sanitized.accountEnvironment === "PROD_N_USD_SETTLEMENT", realizedPnl: sanitized.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? realizedOptionProfitUSD : realizedOptionProfitJPY, netProfit: sanitized.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? undefined : taxResult.netProfitJPY }) : { rows: calculatedDenominators };
  const denominators = longReturn.rows;
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
    historicalAnnualReturnMissingReason: longReturn.missingReason ?? grossLongReturn.missingReason,
    taxGrossProfitJPY,
    grossDenominators,
    denominators,
    primaryGrossDenominator,
    primaryDenominator,
    taxResult,
    optionCloseExecutionResults,
  };
}
