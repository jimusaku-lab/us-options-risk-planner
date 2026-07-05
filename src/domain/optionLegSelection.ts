import {
  calculateOptionSpreadRate,
  evaluateOptionLiquidity,
  getConservativeEntryPrice,
  type OptionLiquidityLevel,
  type OptionSide,
} from "@/domain/optionLiquidity";
import type {
  OptionLegDraft,
  PublicOptionCandidateInput,
  StrategyCandidateKind,
  StrategySuitability,
} from "@/types/screening";

export type OptionLegSelectionInput = {
  symbol: string;
  underlyingPrice?: number;
  strategy: StrategyCandidateKind;
  strategySuitability?: StrategySuitability;
  options: PublicOptionCandidateInput[];
  stockCostBasis?: number;
  maxCandidates?: number;
};

export type OptionLegSelectionResult = {
  strategy: StrategyCandidateKind;
  legs: OptionLegDraft[];
  warnings: string[];
  missingFields: string[];
};

type StrategyRule = {
  optionType: "call" | "put";
  side: OptionSide;
  dteMin: number;
  dteMax: number;
  strikeRatioMin: number;
  strikeRatioMax: number;
  preferredDteMin?: number;
  preferredDteMax?: number;
  costBasisRatioMin?: number;
  costBasisRatioMax?: number;
};

type ScoredOption = {
  option: PublicOptionCandidateInput;
  leg: OptionLegDraft;
  liquidityLevel: OptionLiquidityLevel;
  score: number;
};

const liquidityScore: Record<OptionLiquidityLevel, number> = {
  ok: 30,
  watch: 15,
  avoid: -30,
  insufficient_data: -100,
};

export function selectOptionLegCandidates(input: OptionLegSelectionInput): OptionLegSelectionResult {
  switch (input.strategy) {
    case "long_call":
      return selectLongCallLegs(input);
    case "cash_secured_put_buy_to_own":
      return selectBuyToOwnPutLegs(input);
    case "cash_secured_put_avoid_assignment":
      return selectAvoidAssignmentPutLegs(input);
    case "covered_call":
      return selectCoveredCallLegs(input);
    default:
      return {
        strategy: input.strategy,
        legs: [],
        warnings: ["この工程では初期4戦略以外のレッグ候補は選定しません。"],
        missingFields: ["strategy"],
      };
  }
}

export function selectLongCallLegs(input: OptionLegSelectionInput): OptionLegSelectionResult {
  return selectWithRule(input, {
    optionType: "call",
    side: "buy",
    dteMin: 150,
    dteMax: Number.POSITIVE_INFINITY,
    preferredDteMin: 150,
    preferredDteMax: 210,
    strikeRatioMin: 1,
    strikeRatioMax: 1.05,
  });
}

export function selectBuyToOwnPutLegs(input: OptionLegSelectionInput): OptionLegSelectionResult {
  return selectWithRule(input, {
    optionType: "put",
    side: "sell",
    dteMin: 30,
    dteMax: 90,
    strikeRatioMin: 0.9,
    strikeRatioMax: 0.97,
  });
}

export function selectAvoidAssignmentPutLegs(input: OptionLegSelectionInput): OptionLegSelectionResult {
  return selectWithRule(input, {
    optionType: "put",
    side: "sell",
    dteMin: 30,
    dteMax: 90,
    strikeRatioMin: 0.6,
    strikeRatioMax: 0.8,
  });
}

export function selectCoveredCallLegs(input: OptionLegSelectionInput): OptionLegSelectionResult {
  return selectWithRule(input, {
    optionType: "call",
    side: "sell",
    dteMin: 30,
    dteMax: 90,
    strikeRatioMin: 1.03,
    strikeRatioMax: 1.3,
    costBasisRatioMin: 1.03,
    costBasisRatioMax: 1.3,
  });
}

function selectWithRule(input: OptionLegSelectionInput, rule: StrategyRule): OptionLegSelectionResult {
  const warnings: string[] = [];
  const missingFields: string[] = [];
  if (!isFiniteNumber(input.underlyingPrice) || input.underlyingPrice <= 0) missingFields.push("underlyingPrice");
  if (input.strategySuitability?.level === "avoid" || input.strategySuitability?.level === "insufficient_data") {
    warnings.push(`strategySuitability is ${input.strategySuitability.level}; レッグ候補は参考表示に留めます。`);
  }

  const candidates = input.options.filter((option) => option.optionType === rule.optionType);
  if (candidates.length === 0) missingFields.push(`optionCandidates.${rule.optionType}`);

  const scored = candidates
    .map((option) => scoreOption(input, rule, option))
    .filter((item): item is ScoredOption => Boolean(item))
    .sort((a, b) => b.score - a.score);
  const maxCandidates = input.maxCandidates ?? 5;
  const legs = scored.slice(0, maxCandidates).map((item) => item.leg);

  if (legs.length === 0) {
    missingFields.push("optionCandidates.usableBidAsk");
    warnings.push("Bid/Askを使える代表レッグ候補がありません。");
  }

  const topWarnings = legs.flatMap((leg) => leg.liquidityWarnings);
  return {
    strategy: input.strategy,
    legs,
    warnings: unique([...warnings, ...topWarnings]),
    missingFields: unique([...missingFields, ...legs.flatMap((leg) => leg.missingFields)]),
  };
}

function scoreOption(input: OptionLegSelectionInput, rule: StrategyRule, option: PublicOptionCandidateInput): ScoredOption | undefined {
  const conservativePrice = getConservativeEntryPrice(option, rule.side);
  const liquidity = evaluateOptionLiquidity(option);
  if (!isFiniteNumber(conservativePrice.price) || !conservativePrice.field) return undefined;
  const strikePrice = option.strikePrice ?? option.strike;
  const ratio = isFiniteNumber(input.underlyingPrice) && input.underlyingPrice > 0 && isFiniteNumber(strikePrice) ? strikePrice / input.underlyingPrice : undefined;
  const dte = option.dte;
  const dteInRange = isFiniteNumber(dte) && dte >= rule.dteMin && dte <= rule.dteMax;
  const dtePreferred =
    isFiniteNumber(dte) &&
    (rule.preferredDteMin === undefined || dte >= rule.preferredDteMin) &&
    (rule.preferredDteMax === undefined || dte <= rule.preferredDteMax);
  const strikeInRange = isFiniteNumber(ratio) && ratio >= rule.strikeRatioMin && ratio <= rule.strikeRatioMax;
  const costBasisRatio =
    isFiniteNumber(input.stockCostBasis) && input.stockCostBasis > 0 && isFiniteNumber(strikePrice) ? strikePrice / input.stockCostBasis : undefined;
  const costBasisInRange =
    rule.costBasisRatioMin === undefined ||
    (isFiniteNumber(costBasisRatio) && costBasisRatio >= rule.costBasisRatioMin && costBasisRatio <= (rule.costBasisRatioMax ?? Number.POSITIVE_INFINITY));
  const spreadRate = calculateOptionSpreadRate(option);
  const volume = option.volume ?? 0;
  const openInterest = option.openInterest ?? 0;
  const greekCount = [option.iv, option.delta, option.gamma, option.theta, option.vega].filter(isFiniteNumber).length;
  const score =
    (dteInRange ? 30 : -20) +
    (dtePreferred ? 10 : 0) +
    (strikeInRange ? 35 : -15) +
    (costBasisInRange ? 8 : -12) +
    liquidityScore[liquidity.level] +
    (isFiniteNumber(spreadRate) ? Math.max(0, 12 - spreadRate * 40) : 0) +
    Math.min(10, volume / 50) +
    Math.min(10, openInterest / 100) +
    greekCount;

  const missingFields = unique([...conservativePrice.missingFields, ...liquidity.missingFields]);
  if (!isFiniteNumber(dte)) missingFields.push("option.dte");
  if (!isFiniteNumber(strikePrice)) missingFields.push("option.strikePrice");

  const liquidityWarnings = unique([
    ...conservativePrice.warnings,
    ...liquidity.warnings,
    liquidity.level === "avoid" ? "流動性が低すぎます。" : undefined,
    liquidity.level === "watch" ? "流動性は要確認です。" : undefined,
    !dteInRange ? "DTEが戦略レンジ外です。" : undefined,
    !strikeInRange ? "権利行使価格が戦略レンジ外です。" : undefined,
    input.strategy === "covered_call" && isFiniteNumber(input.stockCostBasis) && isFiniteNumber(strikePrice) && strikePrice < input.stockCostBasis
      ? "権利行使価格が取得単価を下回っています。"
      : undefined,
  ].filter((value): value is string => Boolean(value)));

  return {
    option,
    liquidityLevel: liquidity.level,
    score,
    leg: {
      id: option.id ?? `${input.symbol}-${input.strategy}-${rule.optionType}-${rule.side}-${option.expiry ?? "unknown"}-${strikePrice ?? "unknown"}`,
      optionType: rule.optionType,
      side: rule.side,
      expiry: option.expiry,
      dte,
      strikePrice,
      conservativePrice: conservativePrice.price,
      conservativePriceField: conservativePrice.field,
      mid: conservativePrice.mid,
      last: conservativePrice.last,
      quantity: 1,
      liquidityWarnings,
      missingFields,
    },
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
