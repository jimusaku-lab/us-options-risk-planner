import type { TradeSimulation } from "@/types/domain";
import { resolveCloseCommissionUSD } from "./closeCommissionStandard";
import {
  calculateAnnualReturnPercentByCurrency,
  calculateDte,
  calculateNetInitialPremiumJPY,
  calculateNetInitialPremiumUSD,
  calculateTotalFeesJPY,
  calculateTotalFeesUSD,
  calculateTotalPremiumPaidJPY,
  calculateTotalPremiumPaidUSD,
  calculateTotalPremiumReceivedJPY,
  calculateTotalPremiumReceivedUSD,
} from "./calculations";
import { calculateDenominators, getPrimaryDenominator } from "./denominators";

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
  annualReturnApplicability?: "not_applicable_synthetic";
  label: string;
  premiumDirection: "received" | "paid";
  primaryAmountLabel: string;
  denominatorLabel: string;
  annualReturnLabel?: string;
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
  longOptionOrderDisplay?: LongOptionOrderDisplay;
};

export type LongOptionOrderDisplay = {
  optionType: "call" | "put";
  paidPremiumUSD: number;
  paidPremiumJPY: number;
  feeUSD: number;
  feeJPY: number;
  /** Undefined means the future close fee has not been explicitly confirmed. */
  closeCommissionUSD?: number;
  closePriceUSD?: number;
  currentOptionValueUSD?: number;
  estimatedProfitUSD?: number;
  estimatedProfitJPY?: number;
  profitPct?: number;
  currentCloseAnnualizedReturnPct?: number;
  exitBreakevenPriceUSD?: number;
  exitBreakevenBufferUSD?: number;
  profitTargetPriceUSD: number;
  stopLossPriceUSD: number;
  remainingDays: number;
  elapsedDays: number;
  totalCostUSD: number;
  totalCostJPY: number;
  maximumLossUSD: number;
  maximumLossJPY: number;
  breakevenUSD: number;
  strikeUSD: number;
  currentPriceUSD?: number;
  quantity: number;
  exitProceedsPreview?: LongOptionExitProceedsPreview;
};

export type LongOptionExitProceedsPreview = {
  grossUSD: number;
  netUSD: number;
  grossJPY?: number;
  netJPY?: number;
  closeCommissionUSD: number;
  fxRateJPY?: number;
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
  const confirmedEntryDate = (simulation.optionEntryExecutions ?? [])
    .filter((execution) => execution.confirmed && execution.tradeDate)
    .map((execution) => execution.tradeDate)
    .sort()[0];
  const calculatedDte = calculateDte(confirmedEntryDate ?? simulation.entryDate, simulation.expiryDate);
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

function getSingleLongOptionLeg(simulation: TradeSimulation) {
  const longLegs = simulation.optionLegs.filter((leg) => leg.side === "buy");
  const shortLegs = simulation.optionLegs.filter((leg) => leg.side === "sell");
  if (shortLegs.length > 0 || longLegs.length !== 1) return undefined;
  const leg = longLegs[0];
  if (simulation.strategyType === "long_call" && leg.type !== "call") return undefined;
  if (simulation.strategyType === "long_put" && leg.type !== "put") return undefined;
  return leg;
}

export function calculateLongOptionExitProceedsPreview({
  closePriceUSD,
  quantity,
  closeCommissionUSD,
  fxRateJPY,
}: {
  closePriceUSD?: number;
  quantity: number;
  closeCommissionUSD: number;
  fxRateJPY?: number | null;
}): LongOptionExitProceedsPreview | undefined {
  if (closePriceUSD === undefined || !Number.isFinite(closePriceUSD) || closePriceUSD <= 0) return undefined;
  const grossUSD = closePriceUSD * 100 * Math.max(1, quantity);
  const netUSD = grossUSD - closeCommissionUSD;
  const hasFxRate = fxRateJPY !== undefined && fxRateJPY !== null && Number.isFinite(fxRateJPY) && fxRateJPY > 0;
  return {
    grossUSD,
    netUSD,
    grossJPY: hasFxRate ? grossUSD * fxRateJPY : undefined,
    netJPY: hasFxRate ? netUSD * fxRateJPY : undefined,
    closeCommissionUSD,
    fxRateJPY: hasFxRate ? fxRateJPY : undefined,
  };
}

function calculateLongOptionOrderDisplay(params: {
  simulation: TradeSimulation;
  feeUSD: number;
  feeJPY: number;
}): LongOptionOrderDisplay | undefined {
  const leg = getSingleLongOptionLeg(params.simulation);
  if (!leg || leg.quantity <= 0) return undefined;
  const effectiveFxRateJPY = getEffectiveFxRateJPY(params.simulation) ?? 0;
  const paidPremiumUSD = calculateTotalPremiumPaidUSD(params.simulation);
  const paidPremiumJPY =
    params.simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
      ? paidPremiumUSD * effectiveFxRateJPY
      : calculateTotalPremiumPaidJPY(params.simulation);
  const totalCostUSD = paidPremiumUSD + params.feeUSD;
  const totalCostJPY = paidPremiumJPY + params.feeJPY;
  const feePerShareUSD = params.feeUSD / Math.max(1, leg.quantity * 100);
  const breakevenUSD =
    leg.type === "call"
      ? leg.strikeUSD + leg.premiumUSD + feePerShareUSD
      : Math.max(0, leg.strikeUSD - leg.premiumUSD - feePerShareUSD);
  const closePriceUSD =
    leg.closeCostUSD !== undefined && leg.closeCostUSD > 0
      ? leg.closeCostUSD
      : leg.closePlan?.closePriceUSD !== undefined && leg.closePlan.closePriceUSD > 0
        ? leg.closePlan.closePriceUSD
        : undefined;
  const currentOptionValueUSD = closePriceUSD !== undefined ? closePriceUSD * 100 * leg.quantity : undefined;
  const closeCommission=resolveCloseCommissionUSD(params.simulation,leg);
  const closeCommissionUSD=closeCommission.kind==="resolved"?closeCommission.amountUSD:undefined;
  const exitProceedsPreview = closeCommissionUSD === undefined ? undefined : calculateLongOptionExitProceedsPreview({
    closePriceUSD,
    quantity: leg.quantity,
    closeCommissionUSD,
    fxRateJPY: effectiveFxRateJPY,
  });
  const estimatedProfitUSD =
    currentOptionValueUSD !== undefined && closeCommissionUSD !== undefined ? currentOptionValueUSD - paidPremiumUSD - params.feeUSD - closeCommissionUSD : undefined;
  const estimatedProfitJPY = estimatedProfitUSD !== undefined ? estimatedProfitUSD * effectiveFxRateJPY : undefined;
  const profitPct = estimatedProfitUSD !== undefined && paidPremiumUSD > 0 ? (estimatedProfitUSD / paidPremiumUSD) * 100 : undefined;
  const contractShares = Math.max(1, leg.quantity * 100);
  const exitBreakevenPriceUSD = closeCommissionUSD === undefined ? undefined : (totalCostUSD + closeCommissionUSD) / contractShares;
  const exitBreakevenBufferUSD = closePriceUSD !== undefined && exitBreakevenPriceUSD !== undefined ? closePriceUSD - exitBreakevenPriceUSD : undefined;
  const elapsedDays = calculateElapsedDaysSinceEntry(params.simulation.entryDate);
  const currentCloseAnnualizedReturnPct =
    estimatedProfitUSD !== undefined && totalCostUSD > 0
      ? (estimatedProfitUSD / totalCostUSD) * (365 / Math.max(1, elapsedDays)) * 100
      : undefined;
  const profitTargetPriceUSD = leg.closePlan?.profitTargetPriceUSD ?? roundOptionPrice(leg.premiumUSD * 1.3);
  const stopLossPriceUSD = leg.closePlan?.stopLossPriceUSD ?? roundOptionPrice(leg.premiumUSD * 0.7);
  const remainingDays = calculateRemainingDaysUntilExpiry(leg.expiryDate);
  const currentPriceUSD =
    Number.isFinite(params.simulation.currentPriceUSD) && params.simulation.currentPriceUSD > 0
      ? params.simulation.currentPriceUSD
      : undefined;
  return {
    optionType: leg.type,
    paidPremiumUSD,
    paidPremiumJPY,
    feeUSD: params.feeUSD,
    feeJPY: params.feeJPY,
    closeCommissionUSD,
    closePriceUSD,
    currentOptionValueUSD,
    estimatedProfitUSD,
    estimatedProfitJPY,
    profitPct,
    currentCloseAnnualizedReturnPct,
    exitBreakevenPriceUSD,
    exitBreakevenBufferUSD,
    profitTargetPriceUSD,
    stopLossPriceUSD,
    remainingDays,
    elapsedDays,
    totalCostUSD,
    totalCostJPY,
    maximumLossUSD: totalCostUSD,
    maximumLossJPY: totalCostJPY,
    breakevenUSD,
    strikeUSD: leg.strikeUSD,
    currentPriceUSD,
    quantity: leg.quantity,
    exitProceedsPreview,
  };
}

function roundOptionPrice(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100) / 100;
}

function calculateElapsedDaysSinceEntry(entryDate: string, now = new Date()): number {
  const entry = new Date(`${entryDate}T00:00:00`);
  if (Number.isNaN(entry.getTime())) return 1;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const entryDay = new Date(entry.getFullYear(), entry.getMonth(), entry.getDate());
  return Math.max(1, Math.ceil((today.getTime() - entryDay.getTime()) / 86_400_000));
}

function calculateRemainingDaysUntilExpiry(expiryDate: string, now = new Date()): number {
  const expiry = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return 0;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const expiryDay = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
  return Math.max(0, Math.ceil((expiryDay.getTime() - today.getTime()) / 86_400_000));
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

function calculateNAccountStockDenominatorUSD(simulation: TradeSimulation): number | undefined {
  if (simulation.accountEnvironment !== "PROD_N_USD_SETTLEMENT") return undefined;
  if (!simulation.stockPosition?.shares || simulation.stockPosition.averageCostUSD <= 0) return undefined;
  return simulation.stockPosition.shares * simulation.stockPosition.averageCostUSD;
}

function calculateNAccountPrimaryDenominatorUSD(simulation: TradeSimulation): number | undefined {
  if (simulation.accountEnvironment !== "PROD_N_USD_SETTLEMENT") return undefined;
  const primary = getPrimaryDenominator(calculateDenominators(simulation, 0));
  if (primary.amountUSD !== undefined && primary.amountUSD > 0) return primary.amountUSD;
  return calculateNAccountStockDenominatorUSD(simulation);
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
  const longOptionOrderDisplay = calculateLongOptionOrderDisplay({ simulation, feeUSD, feeJPY });
  const netAfterFeesUSD = premiumUSD - feeUSD;
  const netAfterFeesJPY = premiumJPY - feeJPY;
  const denominatorUSD = calculateNAccountPrimaryDenominatorUSD(simulation);
  const denominatorJPY = simulation.accountEnvironment !== "PROD_N_USD_SETTLEMENT"
    ? simulation.customDenominatorJPY ?? 0
    : undefined;
  const isSyntheticForward = simulation.strategyType === "synthetic_forward";
  const syntheticCashflowLabel = basis === "planned"
    ? premiumUSD < 0 ? "予定ネット支払額" : "予定ネット受取額"
    : premiumUSD < 0 ? "約定未確認のネット支払額" : "約定未確認のネット受取額";

  return {
    basis,
    annualReturnApplicability: isSyntheticForward ? "not_applicable_synthetic" : undefined,
    label: isSyntheticForward
      ? syntheticCashflowLabel
      : longOptionOrderDisplay
      ? basis === "planned"
        ? "支払予定プレミアム"
        : "約定未確認の支払プレミアム"
      : basis === "planned"
        ? "予定プレミアム"
        : "約定未確認プレミアム",
    premiumDirection: longOptionOrderDisplay ? "paid" : "received",
    primaryAmountLabel: isSyntheticForward
      ? syntheticCashflowLabel
      : longOptionOrderDisplay
      ? basis === "planned"
        ? "支払予定額"
        : "約定未確認の支払額"
      : "受取プレミアム",
    denominatorLabel: longOptionOrderDisplay ? "建玉時支払額" : "使用分母",
    annualReturnLabel: longOptionOrderDisplay ? "出口ライン確認" : undefined,
    hasPremiumInput: hasLegPremiumInput(simulation),
    effectiveFxRateJPY,
    dte,
    premiumJPY,
    premiumUSD,
    annualReturnPct: longOptionOrderDisplay || isSyntheticForward
      ? undefined
      : simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
        ? denominatorUSD && denominatorUSD > 0
          ? calculateAnnualReturnPercentByCurrency({ netProfit: premiumUSD, denominator: denominatorUSD, dte })
          : undefined
        : denominatorJPY && denominatorJPY > 0
          ? calculateAnnualReturnPercentByCurrency({ netProfit: premiumJPY, denominator: denominatorJPY, dte })
          : undefined,
    netAnnualReturnPct: longOptionOrderDisplay || isSyntheticForward
      ? undefined
      : simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
        ? denominatorUSD && denominatorUSD > 0
          ? calculateAnnualReturnPercentByCurrency({ netProfit: netAfterFeesUSD, denominator: denominatorUSD, dte })
          : undefined
        : denominatorJPY && denominatorJPY > 0
          ? calculateAnnualReturnPercentByCurrency({ netProfit: netAfterFeesJPY, denominator: denominatorJPY, dte })
          : undefined,
    netAfterFeesJPY,
    netAfterFeesUSD,
    longOptionOrderDisplay,
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
      annualReturnApplicability: simulation.strategyType === "synthetic_forward" ? "not_applicable_synthetic" : undefined,
      label: simulation.strategyType === "synthetic_forward"
        ? premiumUSD < 0 ? "確定ネット支払額" : "確定ネット受取額"
        : "確定プレミアム",
      premiumDirection: premiumUSD < 0 ? "paid" : "received",
      primaryAmountLabel: simulation.strategyType === "synthetic_forward"
        ? premiumUSD < 0 ? "確定ネット支払額" : "確定ネット受取額"
        : premiumUSD < 0 ? "支払済みプレミアム" : "受取プレミアム",
      denominatorLabel: "実績分母",
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
  const dte = getDisplayDte(simulation);
  const denominatorUSD = calculateNAccountPrimaryDenominatorUSD(simulation);
  const feeUSD = calculateTotalFeesUSD(simulation);
  const feeJPY = calculateTotalFeesJPY(simulation);
  const longOptionOrderDisplay = calculateLongOptionOrderDisplay({ simulation, feeUSD, feeJPY });
  const isSyntheticForward = simulation.strategyType === "synthetic_forward";
  const annualReturnPct =
    !longOptionOrderDisplay && !isSyntheticForward && simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" && denominatorUSD && denominatorUSD > 0
      ? calculateAnnualReturnPercentByCurrency({ netProfit: premiumUSD, denominator: denominatorUSD, dte })
      : undefined;
  return {
    basis: "confirmed",
    annualReturnApplicability: isSyntheticForward ? "not_applicable_synthetic" : undefined,
    label: isSyntheticForward
      ? premiumUSD < 0 ? "建玉時ネット支払額" : "建玉時ネット受取額"
      : longOptionOrderDisplay ? "建玉時支払プレミアム" : "建玉時プレミアム",
    premiumDirection: longOptionOrderDisplay ? "paid" : "received",
    primaryAmountLabel: isSyntheticForward
      ? premiumUSD < 0 ? "建玉時ネット支払額" : "建玉時ネット受取額"
      : longOptionOrderDisplay ? "建玉時支払額" : "受取プレミアム",
    denominatorLabel: longOptionOrderDisplay ? "建玉時支払額" : "使用分母",
    annualReturnLabel: longOptionOrderDisplay ? "反対売買で決済" : undefined,
    hasPremiumInput: true,
    effectiveFxRateJPY: getEffectiveFxRateJPY(simulation),
    dte,
    premiumJPY,
    premiumUSD,
    annualReturnPct,
    netAfterFeesJPY: longOptionOrderDisplay ? -longOptionOrderDisplay.totalCostJPY : undefined,
    netAfterFeesUSD: longOptionOrderDisplay ? -longOptionOrderDisplay.totalCostUSD : undefined,
    longOptionOrderDisplay,
    coveredCallAssignmentEstimate: calculateCoveredCallAssignmentEstimate({
      simulation,
      premiumUSD,
      netAfterFeesUSD: premiumUSD,
      denominatorUSD,
      dte,
    }),
  };
}
