import type { NisaComparison, TaxProfile, TaxProfileId, TaxResult, TradeSimulation } from "@/types/domain";
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
    notes: "税額を0円として扱う試算プロファイルです。",
    requiresUserConfirmation: false,
  },
  japan_listed_stock_default_20_315: {
    id: "japan_listed_stock_default_20_315",
    name: "日本上場株式等 20.315% 参考",
    description: "一般的な20.315%を参考税率として使う試算です。",
    enabled: true,
    taxRatePct: 20.315,
    applyTo: ["option_premium", "option_close", "stock_capital_gain"],
    allowLossOffset: true,
    allowCarryForward: true,
    carryForwardYears: 3,
    notes: "米国株オプションの税区分を断定するものではありません。",
    requiresUserConfirmation: true,
  },
  japan_derivative_separate_tax_user_confirm: {
    id: "japan_derivative_separate_tax_user_confirm",
    name: "デリバティブ分離課税 確認要",
    description: "デリバティブ取引として扱う可能性をユーザー確認前提で試算します。",
    enabled: true,
    taxRatePct: 20.315,
    applyTo: ["option_premium", "option_close"],
    allowLossOffset: false,
    allowCarryForward: false,
    notes: "証券会社、国税庁資料、税理士確認を優先してください。",
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
