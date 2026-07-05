import type { OptionLegDraft, PublicScreeningCandidateInput, StrategyCandidateKind } from "@/types/screening";

export type CapitalAssumptions = NonNullable<PublicScreeningCandidateInput["capital"]> & {
  stockCostBasisUSD?: number;
};

export type CapitalReadinessLevel = "ok" | "manual_review_required" | "not_ready" | "insufficient_data";

export type CapitalReadinessInput = {
  strategy: StrategyCandidateKind;
  legs: OptionLegDraft[];
  capital?: CapitalAssumptions;
  underlyingPrice?: number;
};

export type CapitalReadinessResult = {
  level: CapitalReadinessLevel;
  requiredCapitalUSD?: number;
  maxLossUSD?: number;
  availableCashUSD?: number;
  warnings: string[];
  missingFields: string[];
};

export function resolveAvailableCapital(capital?: CapitalAssumptions, preferAssignmentCapital = false): number | undefined {
  if (!capital) return undefined;
  const assignment = finitePositive(capital.assignmentCapitalAvailableUSD);
  if (preferAssignmentCapital && assignment !== undefined) return assignment;
  return finitePositive(capital.availableCashUSD) ?? finitePositive(capital.buyingPowerUSD) ?? assignment;
}

export function calculateLongCallCapital(leg?: OptionLegDraft): Pick<CapitalReadinessResult, "requiredCapitalUSD" | "maxLossUSD" | "missingFields"> {
  const missingFields: string[] = [];
  if (!leg) missingFields.push("legs.long_call");
  if (leg && !isFiniteNumber(leg.conservativePrice)) missingFields.push("legs.conservativePrice");
  if (missingFields.length > 0 || !leg || !isFiniteNumber(leg.conservativePrice)) return { missingFields };
  const amount = leg.conservativePrice * 100 * quantity(leg);
  return { requiredCapitalUSD: amount, maxLossUSD: amount, missingFields: [] };
}

export function calculateShortPutCapital(leg?: OptionLegDraft): Pick<CapitalReadinessResult, "requiredCapitalUSD" | "maxLossUSD" | "missingFields"> {
  const missingFields: string[] = [];
  if (!leg) missingFields.push("legs.short_put");
  if (leg && !isFiniteNumber(leg.strikePrice)) missingFields.push("legs.strikePrice");
  if (leg && !isFiniteNumber(leg.conservativePrice)) missingFields.push("legs.conservativePrice");
  if (missingFields.length > 0 || !leg || !isFiniteNumber(leg.strikePrice) || !isFiniteNumber(leg.conservativePrice)) return { missingFields };
  const contracts = quantity(leg);
  const requiredCapitalUSD = leg.strikePrice * 100 * contracts;
  const maxLossUSD = Math.max(0, requiredCapitalUSD - leg.conservativePrice * 100 * contracts);
  return { requiredCapitalUSD, maxLossUSD, missingFields: [] };
}

export function calculateCoveredCallCapital(
  leg: OptionLegDraft | undefined,
  capital?: CapitalAssumptions,
): Pick<CapitalReadinessResult, "requiredCapitalUSD" | "maxLossUSD" | "missingFields" | "warnings"> {
  const missingFields: string[] = [];
  const warnings: string[] = [];
  if (!leg) missingFields.push("legs.covered_call");
  if (leg && !isFiniteNumber(leg.conservativePrice)) missingFields.push("legs.conservativePrice");
  const requiredShares = leg ? 100 * quantity(leg) : 100;
  if (!isFiniteNumber(capital?.stockShares)) {
    missingFields.push("capital.stockShares");
  } else if ((capital?.stockShares ?? 0) < requiredShares) {
    warnings.push("カバードコールに必要な100株カバーが不足しています。");
  }
  if (!isFiniteNumber(capital?.stockCostBasisUSD)) warnings.push("取得単価が未入力のため、strike < cost basisを確認できません。");
  if (leg && isFiniteNumber(leg.strikePrice) && isFiniteNumber(capital?.stockCostBasisUSD) && leg.strikePrice < capital.stockCostBasisUSD) {
    warnings.push("権利行使価格が取得単価を下回っています。");
  }
  return { requiredCapitalUSD: 0, maxLossUSD: undefined, missingFields: unique(missingFields), warnings: unique(warnings) };
}

export function evaluateCapitalReadiness(input: CapitalReadinessInput): CapitalReadinessResult {
  switch (input.strategy) {
    case "long_call":
      return evaluateLongCallReadiness(input);
    case "cash_secured_put_buy_to_own":
      return evaluateShortPutReadiness(input, true);
    case "cash_secured_put_avoid_assignment":
      return evaluateShortPutReadiness(input, false);
    case "covered_call":
      return evaluateCoveredCallReadiness(input);
    default:
      return {
        level: "manual_review_required",
        warnings: ["この工程では初期4戦略以外の資金判定は行いません。"],
        missingFields: ["strategy"],
      };
  }
}

function evaluateLongCallReadiness(input: CapitalReadinessInput): CapitalReadinessResult {
  const capital = calculateLongCallCapital(input.legs[0]);
  if (capital.missingFields.length > 0) return { level: "insufficient_data", warnings: [], ...capital };
  const availableCashUSD = resolveAvailableCapital(input.capital);
  const warnings = ["出口目安: 利確は支払プレミアムx1.30以上、損切りはx0.60を後続工程で確認します。"];
  const missingFields: string[] = [];
  if (!isFiniteNumber(availableCashUSD)) missingFields.push("capital.availableCashUSD");
  if (!isFiniteNumber(input.capital?.maxLossToleranceUSD)) missingFields.push("capital.maxLossToleranceUSD");
  if (!isFiniteNumber(availableCashUSD) || !isFiniteNumber(input.capital?.maxLossToleranceUSD)) {
    return withCapitalFields({ level: "manual_review_required", availableCashUSD, warnings, missingFields }, capital);
  }
  if (availableCashUSD < (capital.requiredCapitalUSD ?? 0)) {
    return withCapitalFields({ level: "not_ready", availableCashUSD, warnings: [...warnings, "支払プレミアムに対して利用可能資金が不足しています。"], missingFields }, capital);
  }
  if ((capital.maxLossUSD ?? 0) > input.capital.maxLossToleranceUSD) {
    return withCapitalFields({ level: "not_ready", availableCashUSD, warnings: [...warnings, "最大損失が許容損失額を超えています。"], missingFields }, capital);
  }
  return withCapitalFields({ level: "ok", availableCashUSD, warnings, missingFields }, capital);
}

function evaluateShortPutReadiness(input: CapitalReadinessInput, buyToOwn: boolean): CapitalReadinessResult {
  const capital = calculateShortPutCapital(input.legs[0]);
  if (capital.missingFields.length > 0) return { level: "insufficient_data", warnings: [], ...capital };
  const availableCashUSD = resolveAvailableCapital(input.capital, true);
  const warnings = buyToOwn
    ? ["100株買ってよい銘柄・価格かを確認してください。"]
    : ["買いたくないP売りは出口ルール、損切り、満期前撤退期限の手動確認が必要です。"];
  const missingFields: string[] = [];
  if (!isFiniteNumber(availableCashUSD)) {
    missingFields.push("capital.assignmentCapitalAvailableUSD");
    return withCapitalFields({ level: "manual_review_required", availableCashUSD, warnings, missingFields }, capital);
  }
  if (availableCashUSD < (capital.requiredCapitalUSD ?? 0)) {
    return withCapitalFields({ level: "not_ready", availableCashUSD, warnings: [...warnings, "権利行使時の必要資金が不足しています。"], missingFields }, capital);
  }
  return withCapitalFields({ level: buyToOwn ? "ok" : "manual_review_required", availableCashUSD, warnings, missingFields }, capital);
}

function withCapitalFields(
  base: Pick<CapitalReadinessResult, "level" | "availableCashUSD" | "warnings" | "missingFields">,
  capital: Pick<CapitalReadinessResult, "requiredCapitalUSD" | "maxLossUSD">,
): CapitalReadinessResult {
  return {
    ...base,
    requiredCapitalUSD: capital.requiredCapitalUSD,
    maxLossUSD: capital.maxLossUSD,
  };
}

function evaluateCoveredCallReadiness(input: CapitalReadinessInput): CapitalReadinessResult {
  const capital = calculateCoveredCallCapital(input.legs[0], input.capital);
  if (capital.missingFields.includes("legs.covered_call") || capital.missingFields.includes("legs.conservativePrice")) {
    return { level: "insufficient_data", availableCashUSD: resolveAvailableCapital(input.capital), ...capital };
  }
  const requiredShares = input.legs[0] ? 100 * quantity(input.legs[0]) : 100;
  if (!isFiniteNumber(input.capital?.stockShares)) {
    return {
      level: "manual_review_required",
      availableCashUSD: resolveAvailableCapital(input.capital),
      warnings: capital.warnings,
      missingFields: capital.missingFields,
      requiredCapitalUSD: 0,
    };
  }
  if ((input.capital?.stockShares ?? 0) < requiredShares) {
    return {
      level: "not_ready",
      availableCashUSD: resolveAvailableCapital(input.capital),
      warnings: capital.warnings,
      missingFields: capital.missingFields,
      requiredCapitalUSD: 0,
    };
  }
  return {
    level: capital.warnings.some((warning) => warning.includes("取得単価") || warning.includes("下回っています")) ? "manual_review_required" : "ok",
    availableCashUSD: resolveAvailableCapital(input.capital),
    warnings: ["株を売ってよい価格か手動確認してください。", ...capital.warnings],
    missingFields: capital.missingFields,
    requiredCapitalUSD: 0,
  };
}

function quantity(leg: OptionLegDraft): number {
  return isFiniteNumber(leg.quantity) && leg.quantity > 0 ? leg.quantity : 1;
}

function finitePositive(value: unknown): number | undefined {
  return isFiniteNumber(value) && value >= 0 ? value : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
