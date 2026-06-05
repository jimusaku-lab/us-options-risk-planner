import type {
  NisaComparison,
  StockSettlementTaxResult,
  TaxProfile,
  TaxProfileId,
  TaxResult,
  TradeSimulation,
} from "@/types/domain";
import { calculateAnnualReturnPercent, calculateTotalFeesJPY } from "./calculations";

export const taxProfiles: Record<TaxProfileId, TaxProfile> = {
  none_nisa_or_tax_free_comparison: {
    id: "none_nisa_or_tax_free_comparison",
    name: "税額なし・非課税比較用",
    description: "税額を控除せず、NISA等の非課税運用との比較だけに使います。",
    enabled: false,
    taxRatePct: 0,
    applyTo: [],
    allowLossOffset: false,
    allowCarryForward: false,
    notes: "税額を0円として扱う比較用プロファイルです。",
    requiresUserConfirmation: false,
  },
  japan_listed_stock_default_20_315: {
    id: "japan_listed_stock_default_20_315",
    name: "上場株式等の譲渡所得等 20.315% 参考",
    description: "株式売却損益側の参考税率です。オプション損益とは別区分で扱います。",
    enabled: true,
    taxRatePct: 20.315,
    applyTo: ["stock_capital_gain"],
    allowLossOffset: true,
    allowCarryForward: true,
    carryForwardYears: 3,
    notes: "上場株式等の譲渡損益側の参考プロファイルです。オプション損益との自動相殺には使いません。",
    requiresUserConfirmation: true,
  },
  japan_derivative_separate_tax_user_confirm: {
    id: "japan_derivative_separate_tax_user_confirm",
    name: "先物取引に係る雑所得等 20.315% 確認要",
    description: "米国株式オプション損益を、先物取引に係る雑所得等の枠として分離して概算します。",
    enabled: true,
    taxRatePct: 20.315,
    applyTo: ["option_premium", "option_close"],
    allowLossOffset: true,
    allowCarryForward: true,
    carryForwardYears: 3,
    notes: "同じ税務バケット内のオプション損益通算候補として扱います。株式譲渡損益とは自動相殺しません。証券会社、国税庁資料、税理士確認を優先してください。",
    requiresUserConfirmation: true,
  },
  custom: {
    id: "custom",
    name: "カスタム",
    description: "ユーザーが税率と対象を編集するプロファイルです。",
    enabled: true,
    taxRatePct: 20.315,
    applyTo: ["option_premium", "option_close", "stock_capital_gain"],
    allowLossOffset: false,
    allowCarryForward: false,
    notes: "カスタム税率による概算です。",
    requiresUserConfirmation: true,
  },
};

export function calculateTaxResult(params: {
  simulation: TradeSimulation;
  grossProfitJPY: number;
  denominatorJPY: number;
  taxProfile?: TaxProfile;
  appliedLossCarryForwardJPY?: number;
}): TaxResult {
  const profile = params.taxProfile ?? taxProfiles[params.simulation.taxProfileId];
  const totalFees = calculateTotalFeesJPY(params.simulation);
  const feeAdjustedProfitJPY = params.grossProfitJPY - totalFees;
  const taxableProfitJPY = Math.max(
    0,
    feeAdjustedProfitJPY - (params.appliedLossCarryForwardJPY ?? 0),
  );
  const taxJPY = profile.enabled ? Math.floor((taxableProfitJPY * profile.taxRatePct) / 100) : 0;
  const netProfitJPY = feeAdjustedProfitJPY - taxJPY;

  return {
    grossProfitJPY: params.grossProfitJPY,
    feeAdjustedProfitJPY,
    taxableProfitJPY,
    taxJPY,
    netProfitJPY,
    grossAnnualReturnPct: calculateAnnualReturnPercent({
      netProfitJPY: params.grossProfitJPY,
      denominatorJPY: params.denominatorJPY,
      dte: params.simulation.dte,
    }),
    netAnnualReturnPct: calculateAnnualReturnPercent({
      netProfitJPY,
      denominatorJPY: params.denominatorJPY,
      dte: params.simulation.dte,
    }),
    netMonthlyReturnPct:
      params.denominatorJPY > 0 ? (netProfitJPY / params.denominatorJPY) * 100 * (30 / params.simulation.dte) : 0,
    requiresUserConfirmation: profile.requiresUserConfirmation,
  };
}

export function calculateStockSettlementTaxResult(
  simulation: TradeSimulation,
): StockSettlementTaxResult {
  const settlement = simulation.stockSettlement;
  const profile = taxProfiles.japan_listed_stock_default_20_315;
  if (!settlement?.enabled) {
    return {
      enabled: false,
      grossProceedsJPY: 0,
      costBasisJPY: 0,
      feesJPY: 0,
      realizedGainJPY: 0,
      taxableProfitJPY: 0,
      estimatedTaxJPY: 0,
      afterTaxGainJPY: 0,
      holdingDays: 0,
      annualReturnPct: 0,
      taxRatePct: profile.taxRatePct,
    };
  }

  const fxRateJPY = settlement.fxRateJPY && settlement.fxRateJPY > 0 ? settlement.fxRateJPY : simulation.fxRateJPY;
  const grossProceedsJPY = settlement.sellPriceUSD * settlement.shares * fxRateJPY;
  const costBasisJPY = settlement.costBasisUSD * settlement.shares * fxRateJPY;
  const feesJPY = (settlement.commissionUSD ?? 0) * fxRateJPY + (settlement.commissionJPY ?? 0);
  const realizedGainJPY = grossProceedsJPY - costBasisJPY - feesJPY;
  const taxableProfitJPY = Math.max(0, realizedGainJPY);
  const estimatedTaxJPY = Math.floor((taxableProfitJPY * profile.taxRatePct) / 100);
  const holdingDays = Math.max(
    1,
    Math.ceil(
      (new Date(`${settlement.settlementDate}T00:00:00Z`).getTime() -
        new Date(`${simulation.entryDate}T00:00:00Z`).getTime()) /
        86_400_000,
    ),
  );

  return {
    enabled: true,
    grossProceedsJPY,
    costBasisJPY,
    feesJPY,
    realizedGainJPY,
    taxableProfitJPY,
    estimatedTaxJPY,
    afterTaxGainJPY: realizedGainJPY - estimatedTaxJPY,
    holdingDays,
    annualReturnPct: calculateAnnualReturnPercent({
      netProfitJPY: realizedGainJPY,
      denominatorJPY: costBasisJPY,
      dte: holdingDays,
    }),
    taxRatePct: profile.taxRatePct,
  };
}

export function calculateNisaComparison(params: {
  netProfitJPY: number;
  denominatorJPY: number;
  days: number;
  expectedAnnualReturnPct: number;
  taxRatePct: number;
}): NisaComparison {
  const comparisonProfitJPY =
    params.denominatorJPY * (params.expectedAnnualReturnPct / 100) * (params.days / 365);
  const requiredGrossProfitToBeatJPY =
    params.taxRatePct >= 100 ? Infinity : comparisonProfitJPY / (1 - params.taxRatePct / 100);
  return {
    expectedAnnualReturnPct: params.expectedAnnualReturnPct,
    comparisonProfitJPY,
    netAdvantageJPY: params.netProfitJPY - comparisonProfitJPY,
    requiredGrossProfitToBeatJPY,
    requiredGrossAnnualReturnPct: calculateAnnualReturnPercent({
      netProfitJPY: requiredGrossProfitToBeatJPY,
      denominatorJPY: params.denominatorJPY,
      dte: params.days,
    }),
  };
}
