import { evaluateChartFinalGate } from "@/domain/chartAnalysis";
import { evaluateCapitalReadiness } from "@/domain/capitalReadiness";
import { evaluateOptionLiquidity, getConservativeEntryPrice, type OptionSide } from "@/domain/optionLiquidity";
import type {
  AdvancedStrategyReview,
  ChartAnalysisSnapshot,
  OptionLegDraft,
  PositionDraft,
  PublicOptionCandidateInput,
  PublicScreeningCandidateInput,
  PublicStrategyFitLevel,
  StrategyCandidateInput,
  StrategyCandidateKind,
  StrategyPrecisionReview,
  StrategyPrecisionReviewLevel,
  StrategyPrecisionSubReview,
  StrategySuitability,
} from "@/types/screening";

type StrategyPrecisionInput = PublicScreeningCandidateInput & {
  strategySuitability?: StrategySuitability[];
  positionDrafts?: PublicScreeningCandidateInput["positionDrafts"];
  advancedStrategyReviews?: AdvancedStrategyReview[];
};

type StrategyRule = {
  optionType: "call" | "put";
  side: OptionSide;
  dteRange: [number, number];
  preferredDteRange?: [number, number];
  strikeRatioRange: [number, number];
  chartDirection: "bullish" | "neutral";
  chartHorizon: "short" | "medium" | "long";
};

const coreStrategies: StrategyCandidateKind[] = [
  "long_call",
  "cash_secured_put_buy_to_own",
  "cash_secured_put_avoid_assignment",
  "covered_call",
];

const advancedStrategies: StrategyCandidateKind[] = [
  "wheel",
  "short_strangle",
  "short_strangle_covered",
  "short_strangle_advanced_review",
  "synthetic_forward",
  "combo",
  "itm_short_put_buy_to_own",
  "long_straddle_event",
  "protective_collar",
];

const rules: Record<StrategyCandidateKind, StrategyRule | undefined> = {
  long_call: {
    optionType: "call",
    side: "buy",
    dteRange: [150, 9999],
    preferredDteRange: [150, 210],
    strikeRatioRange: [1, 1.05],
    chartDirection: "bullish",
    chartHorizon: "long",
  },
  cash_secured_put_buy_to_own: {
    optionType: "put",
    side: "sell",
    dteRange: [30, 90],
    strikeRatioRange: [0.9, 0.97],
    chartDirection: "bullish",
    chartHorizon: "medium",
  },
  cash_secured_put_avoid_assignment: {
    optionType: "put",
    side: "sell",
    dteRange: [30, 90],
    strikeRatioRange: [0.6, 0.8],
    chartDirection: "neutral",
    chartHorizon: "medium",
  },
  covered_call: {
    optionType: "call",
    side: "sell",
    dteRange: [30, 90],
    strikeRatioRange: [1.03, 1.3],
    chartDirection: "neutral",
    chartHorizon: "medium",
  },
  wheel: undefined,
  short_strangle: undefined,
  short_strangle_covered: undefined,
  short_strangle_advanced_review: undefined,
  synthetic_forward: undefined,
  combo: undefined,
  itm_short_put_buy_to_own: undefined,
  long_straddle_event: undefined,
  protective_collar: undefined,
};

export function buildStrategyPrecisionReviewsForCandidate(input: StrategyPrecisionInput): StrategyPrecisionReview[] {
  const strategies = orderedStrategies(input);
  const reviews = strategies.map((strategy) => (
    coreStrategies.includes(strategy)
      ? buildCoreStrategyPrecisionReview(input, strategy)
      : buildAdvancedStrategyPrecisionReview(input, strategy)
  ));
  return reviews.filter((review): review is StrategyPrecisionReview => Boolean(review));
}

export function buildCoreStrategyPrecisionReview(
  input: StrategyPrecisionInput,
  strategy: StrategyCandidateKind,
): StrategyPrecisionReview | undefined {
  const rule = rules[strategy];
  if (!rule) return undefined;
  const suitability = input.strategySuitability?.find((item) => item.strategy === strategy);
  const strategyInput = input.candidateStrategies?.find((item) => item.strategy === strategy);
  const draft = input.positionDrafts?.find((item) => item.strategy === strategy);
  const leg = draft?.legs[0] ?? findBestOptionLeg(input, strategy, rule);
  const option = findSourceOption(input.optionCandidates ?? [], leg, rule);
  const chartGate = reviewChartGate(input.chartAnalysis, rule, strategy);
  const expiryReview = reviewExpiry(strategy, rule, leg?.dte ?? strategyInput?.dte);
  const strikeReview = reviewStrike(input, strategy, rule, leg?.strikePrice ?? strategyInput?.strikePrice);
  const liquidityReview = reviewLiquidity(option, leg, rule);
  const capitalReview = reviewCapital(input, strategy, draft, leg);
  const manualReviewReasons = unique([
    ...(suitability?.manualReviewReasons ?? []),
    ...manualReasonsFrom("チャート", chartGate),
    ...manualReasonsFrom("満期", expiryReview),
    ...manualReasonsFrom("strike", strikeReview),
    ...manualReasonsFrom("流動性", liquidityReview),
    ...manualReasonsFrom("資金", capitalReview),
    ...strategyManualReasons(input, strategy, strategyInput),
  ]);
  const avoidReasons = unique([
    ...blockedReasonsFrom("チャート", chartGate),
    ...blockedReasonsFrom("満期", expiryReview),
    ...blockedReasonsFrom("strike", strikeReview),
    ...blockedReasonsFrom("流動性", liquidityReview),
    ...blockedReasonsFrom("資金", capitalReview),
    ...strategyAvoidReasons(input, strategy, strategyInput, leg),
  ]);
  const level = resolvePrecisionLevel(suitability?.level, [chartGate, expiryReview, strikeReview, liquidityReview, capitalReview], manualReviewReasons, avoidReasons);

  return {
    strategy,
    level,
    chartGate,
    expiryReview,
    strikeReview,
    liquidityReview,
    capitalReview,
    manualReviewReasons,
    avoidReasons,
    nextChecks: precisionNextChecks(strategy),
    checklist: reviewChecklist(strategy),
  };
}

function buildAdvancedStrategyPrecisionReview(
  input: StrategyPrecisionInput,
  strategy: StrategyCandidateKind,
): StrategyPrecisionReview | undefined {
  const advancedReview = input.advancedStrategyReviews?.find((item) => item.strategy === strategy);
  if (!advancedReview && !advancedStrategies.includes(strategy)) return undefined;
  const chartGate = reviewAdvancedChartGate(input.chartAnalysis, strategy);
  const liquidityWarnings = advancedReview?.legs.flatMap((leg) => leg.liquidityWarnings) ?? [];
  const missingLegFields = advancedReview?.legs.flatMap((leg) => leg.missingFields) ?? [];
  const capitalWarnings = [
    ...(advancedReview?.warnings ?? []).filter((warning) => warning.includes("資金") || warning.includes("裸コール") || warning.includes("不足")),
  ];
  return {
    strategy,
    level: advancedReview?.level === "avoid" ? "avoid" : advancedReview?.level === "insufficient_data" ? "insufficient_data" : "manual_review_required",
    chartGate,
    expiryReview: {
      level: "watch",
      reasons: ["上級戦略は満期同一性とイベント日を手動確認します。"],
      warnings: advancedReview?.legs.length ? [] : ["対象レッグが不足しています。"],
    },
    strikeReview: {
      level: "watch",
      reasons: ["上級戦略はレッグ間のstrike関係を手動確認します。"],
      warnings: advancedReview?.missingFields ?? [],
    },
    liquidityReview: {
      level: liquidityWarnings.length || missingLegFields.length ? "watch" : "pass",
      reasons: liquidityWarnings.length ? [] : ["各レッグの保守価格を確認します。"],
      warnings: unique([...liquidityWarnings, ...missingLegFields]),
    },
    capitalReview: {
      level: capitalWarnings.length ? "blocked" : "watch",
      reasons: capitalWarnings.length ? [] : ["複合損失と割当資金を手動確認します。"],
      warnings: capitalWarnings,
    },
    manualReviewReasons: unique([
      ...(advancedReview?.manualReviewReasons ?? []),
      "上級戦略は原則として手動確認です。",
      ...advancedChecklistReasons(strategy),
    ]),
    avoidReasons: advancedReview?.level === "avoid" ? unique(advancedReview.warnings) : [],
    nextChecks: precisionNextChecks(strategy),
    checklist: reviewChecklist(strategy),
  };
}

function orderedStrategies(input: StrategyPrecisionInput): StrategyCandidateKind[] {
  return unique([
    ...(input.strategySuitability ?? []).map((item) => item.strategy),
    ...(input.positionDrafts ?? []).map((item) => item.strategy),
    ...(input.candidateStrategies ?? []).map((item) => item.strategy),
    ...(input.advancedStrategyReviews ?? []).map((item) => item.strategy),
  ]);
}

function reviewChartGate(
  chartAnalysis: ChartAnalysisSnapshot | undefined,
  rule: StrategyRule,
  strategy: StrategyCandidateKind,
): StrategyPrecisionSubReview {
  if (!chartAnalysis) {
    return {
      level: "insufficient_data",
      reasons: [],
      warnings: ["チャート分析がありません。"],
    };
  }
  const gate = evaluateChartFinalGate(chartAnalysis, {
    direction: rule.chartDirection,
    horizon: rule.chartHorizon,
    maxChaseDistancePct: strategy === "long_call" ? 10 : 12,
  });
  const blockedByRegime =
    (strategy === "long_call" || strategy === "cash_secured_put_avoid_assignment") &&
    (chartAnalysis.regime === "downtrend" || chartAnalysis.regime === "bearish_breakdown");
  const weakConfidence = chartAnalysis.confidence === "low" || chartAnalysis.confidence === "insufficient";
  return {
    level: blockedByRegime ? "blocked" : weakConfidence ? "watch" : gate.level,
    reasons: unique([...gate.reasons, `${chartAnalysis.regime} / ${chartAnalysis.confidence}`]),
    warnings: unique([
      ...gate.warnings,
      ...gate.manualReviewReasons,
      weakConfidence ? "チャート信頼度が弱いためfitにはしません。" : undefined,
      blockedByRegime ? "戦略方向とチャート局面が矛盾しています。" : undefined,
    ]),
  };
}

function reviewAdvancedChartGate(chartAnalysis: ChartAnalysisSnapshot | undefined, strategy: StrategyCandidateKind): StrategyPrecisionSubReview {
  if (!chartAnalysis) return { level: "insufficient_data", reasons: [], warnings: ["チャート分析がありません。"] };
  if (strategy === "long_straddle_event") {
    return {
      level: chartAnalysis.regime === "event_large_move_unknown" ? "watch" : "blocked",
      reasons: [chartAnalysis.regime === "event_large_move_unknown" ? "イベント大変動候補です。" : "ストラドルはイベント大変動候補のみ確認します。"],
      warnings: chartAnalysis.regime === "event_large_move_unknown" ? ["IVとイベント日を手動確認します。"] : ["イベント大変動局面ではありません。"],
    };
  }
  return {
    level: chartAnalysis.confidence === "insufficient" ? "insufficient_data" : "watch",
    reasons: [`${chartAnalysis.regime} / ${chartAnalysis.confidence}`],
    warnings: ["上級戦略はチャート目視を手動確認します。"],
  };
}

function reviewExpiry(strategy: StrategyCandidateKind, rule: StrategyRule, actualDte?: number) {
  if (!isFiniteNumber(actualDte)) {
    return {
      level: "insufficient_data" as const,
      targetDteRange: rule.dteRange,
      reasons: [],
      warnings: ["DTEがありません。"],
    };
  }
  const [min, max] = rule.dteRange;
  const inRange = actualDte >= min && actualDte <= max;
  if (inRange) {
    const preferred = rule.preferredDteRange;
    const preferredText = preferred && actualDte >= preferred[0] && actualDte <= preferred[1] ? "標準レンジ" : "許容レンジ";
    return {
      level: "pass" as const,
      targetDteRange: rule.dteRange,
      actualDte,
      reasons: [`DTE ${actualDte}日: ${strategyLabel(strategy)}の${preferredText}です。`],
      warnings: [],
    };
  }
  return {
    level: "watch" as const,
    targetDteRange: rule.dteRange,
    actualDte,
    reasons: [],
    warnings: [`DTE ${actualDte}日: ${strategyLabel(strategy)}の満期レンジ外です。`],
  };
}

function reviewStrike(input: StrategyPrecisionInput, strategy: StrategyCandidateKind, rule: StrategyRule, strikePrice?: number) {
  if (!isFiniteNumber(input.underlyingPrice) || input.underlyingPrice <= 0) {
    return {
      level: "insufficient_data" as const,
      targetStrikeRatioRange: rule.strikeRatioRange,
      reasons: [],
      warnings: ["株価がないためstrike/株価比を確認できません。"],
    };
  }
  if (!isFiniteNumber(strikePrice)) {
    return {
      level: "insufficient_data" as const,
      targetStrikeRatioRange: rule.strikeRatioRange,
      reasons: [],
      warnings: ["権利行使価格がありません。"],
    };
  }
  const ratio = strikePrice / input.underlyingPrice;
  const [min, max] = rule.strikeRatioRange;
  const inRange = ratio >= min && ratio <= max;
  const costBasis = input.capital?.stockCostBasisUSD ?? input.existingPosition?.stockCostBasisUSD;
  const coveredBelowCost = strategy === "covered_call" && isFiniteNumber(costBasis) && strikePrice < costBasis;
  if (coveredBelowCost) {
    return {
      level: "blocked" as const,
      targetStrikeRatioRange: rule.strikeRatioRange,
      actualStrikeRatio: ratio,
      reasons: [],
      warnings: [`strike ${strikePrice}: 取得単価 ${costBasis} を下回るカバードコールは候補にしません。`],
    };
  }
  if (inRange) {
    return {
      level: "pass" as const,
      targetStrikeRatioRange: rule.strikeRatioRange,
      actualStrikeRatio: ratio,
      reasons: [`strike/株価比 ${ratio.toFixed(2)}: ${strategyLabel(strategy)}レンジ内です。`],
      warnings: [],
    };
  }
  return {
    level: strikeTooCloseForAvoidPut(strategy, ratio) ? "blocked" as const : "watch" as const,
    targetStrikeRatioRange: rule.strikeRatioRange,
    actualStrikeRatio: ratio,
    reasons: [],
    warnings: [`strike/株価比 ${ratio.toFixed(2)}: ${strategyLabel(strategy)}の権利行使価格レンジ外です。`],
  };
}

function reviewLiquidity(option: PublicOptionCandidateInput | undefined, leg: OptionLegDraft | undefined, rule: StrategyRule): StrategyPrecisionSubReview {
  if (!option && !leg) {
    return { level: "insufficient_data", reasons: [], warnings: ["オプション候補がありません。"] };
  }
  if (option) {
    const conservative = getConservativeEntryPrice(option, rule.side);
    const liquidity = evaluateOptionLiquidity(option);
    const field = rule.side === "buy" ? "Ask" : "Bid";
    const spread = liquidity.spreadRate === undefined ? undefined : `${(liquidity.spreadRate * 100).toFixed(1)}%`;
    if (!isFiniteNumber(conservative.price)) {
      return {
        level: "blocked",
        reasons: [],
        warnings: unique([...conservative.warnings, ...liquidity.warnings, `${field}がないため保守価格なし。`]),
      };
    }
    return {
      level: liquidity.level === "ok" ? "pass" : liquidity.level === "watch" ? "watch" : liquidity.level === "avoid" ? "blocked" : "insufficient_data",
      reasons: unique([`${field}を保守価格に使用します。`, spread ? `Bid/Askあり、spread ${spread}` : undefined]),
      warnings: liquidity.warnings,
    };
  }
  if (!isFiniteNumber(leg?.conservativePrice)) return { level: "blocked", reasons: [], warnings: ["保守価格がありません。"] };
  return {
    level: leg.liquidityWarnings.length ? "watch" : "pass",
    reasons: [`${leg.conservativePriceField === "ask" ? "Ask" : "Bid"}を保守価格に使用します。`],
    warnings: leg.liquidityWarnings,
  };
}

function reviewCapital(
  input: StrategyPrecisionInput,
  strategy: StrategyCandidateKind,
  draft: PositionDraft | undefined,
  leg?: OptionLegDraft,
): StrategyPrecisionSubReview {
  if (draft) {
    return {
      level: draft.status === "draft_ready" ? "pass" : draft.status === "manual_review_required" ? "watch" : "blocked",
      reasons: unique([
        draft.status === "draft_ready" ? "建玉案レビューに必要な資金項目が揃っています。" : undefined,
        isFiniteNumber(draft.requiredCapitalUSD) ? `必要資金 ${formatUSD(draft.requiredCapitalUSD)}` : undefined,
        isFiniteNumber(draft.maxLossUSD) ? `最大損失 ${formatUSD(draft.maxLossUSD)}` : undefined,
        isFiniteNumber(draft.availableCashUSD) ? `利用可能資金 ${formatUSD(draft.availableCashUSD)}` : undefined,
      ]),
      warnings: unique([...draft.warnings, ...draft.missingFields]),
    };
  }
  if (!leg) return { level: "insufficient_data", reasons: [], warnings: ["資金判定に必要なレッグがありません。"] };
  const readiness = evaluateCapitalReadiness({
    strategy,
    legs: [leg],
    capital: input.capital,
    underlyingPrice: input.underlyingPrice,
  });
  return {
    level: readiness.level === "ok" ? "pass" : readiness.level === "manual_review_required" ? "watch" : readiness.level === "not_ready" ? "blocked" : "insufficient_data",
    reasons: unique([
      isFiniteNumber(readiness.requiredCapitalUSD) ? `必要資金 ${formatUSD(readiness.requiredCapitalUSD)}` : undefined,
      isFiniteNumber(readiness.maxLossUSD) ? `最大損失 ${formatUSD(readiness.maxLossUSD)}` : undefined,
      isFiniteNumber(readiness.availableCashUSD) ? `利用可能資金 ${formatUSD(readiness.availableCashUSD)}` : undefined,
    ]),
    warnings: unique([...readiness.warnings, ...readiness.missingFields]),
  };
}

function findBestOptionLeg(input: StrategyPrecisionInput, strategy: StrategyCandidateKind, rule: StrategyRule): OptionLegDraft | undefined {
  const option = (input.optionCandidates ?? [])
    .filter((candidate) => candidate.optionType === rule.optionType)
    .map((candidate) => ({ candidate, score: optionScore(input, candidate, rule) }))
    .sort((a, b) => b.score - a.score)[0]?.candidate;
  if (!option) return undefined;
  const conservative = getConservativeEntryPrice(option, rule.side);
  const strikePrice = option.strikePrice ?? option.strike;
  return {
    id: option.id ?? `${input.symbol}-${strategy}-${option.expiry ?? "unknown"}-${strikePrice ?? "unknown"}`,
    optionType: rule.optionType,
    side: rule.side,
    expiry: option.expiry,
    dte: option.dte,
    strikePrice,
    conservativePrice: conservative.price,
    conservativePriceField: conservative.field,
    mid: conservative.mid,
    last: conservative.last,
    quantity: 1,
    liquidityWarnings: conservative.warnings,
    missingFields: conservative.missingFields,
  };
}

function findSourceOption(options: PublicOptionCandidateInput[], leg: OptionLegDraft | undefined, rule: StrategyRule): PublicOptionCandidateInput | undefined {
  if (!leg) return options.find((option) => option.optionType === rule.optionType);
  return options.find((option) =>
    option.optionType === rule.optionType &&
    (option.id === leg.id || ((option.strikePrice ?? option.strike) === leg.strikePrice && option.expiry === leg.expiry)),
  ) ?? options.find((option) => option.optionType === rule.optionType);
}

function optionScore(input: StrategyPrecisionInput, option: PublicOptionCandidateInput, rule: StrategyRule): number {
  const strike = option.strikePrice ?? option.strike;
  const ratio = isFiniteNumber(input.underlyingPrice) && input.underlyingPrice > 0 && isFiniteNumber(strike) ? strike / input.underlyingPrice : undefined;
  const dte = option.dte;
  const dteInRange = isFiniteNumber(dte) && dte >= rule.dteRange[0] && dte <= rule.dteRange[1];
  const strikeInRange = isFiniteNumber(ratio) && ratio >= rule.strikeRatioRange[0] && ratio <= rule.strikeRatioRange[1];
  const conservative = getConservativeEntryPrice(option, rule.side);
  return (dteInRange ? 30 : -10) + (strikeInRange ? 35 : -10) + (isFiniteNumber(conservative.price) ? 30 : -100) + ((option.volume ?? 0) / 100) + ((option.openInterest ?? 0) / 500);
}

function resolvePrecisionLevel(
  suitabilityLevel: PublicStrategyFitLevel | undefined,
  reviews: StrategyPrecisionSubReview[],
  manualReviewReasons: string[],
  avoidReasons: string[],
): PublicStrategyFitLevel {
  if (avoidReasons.length > 0 || reviews.some((review) => review.level === "blocked")) return "avoid";
  if (reviews.some((review) => review.level === "insufficient_data")) return "insufficient_data";
  if (suitabilityLevel === "avoid" || suitabilityLevel === "insufficient_data") return suitabilityLevel;
  if (suitabilityLevel === "manual_review_required" || manualReviewReasons.length > 0 || reviews.some((review) => review.level === "watch")) return "manual_review_required";
  if (suitabilityLevel === "watch") return "watch";
  return "fit";
}

function strategyManualReasons(input: StrategyPrecisionInput, strategy: StrategyCandidateKind, strategyInput?: StrategyCandidateInput): string[] {
  const reasons: string[] = [];
  if (strategy === "cash_secured_put_avoid_assignment") {
    if (!strategyInput?.profitTakeRuleSet) reasons.push("利確ルールを確認してください。");
    if (!strategyInput?.stopLossRuleSet) reasons.push("損切りルールを確認してください。");
    if (!strategyInput?.latestCloseDateSet) reasons.push("満期前決済期限を確認してください。");
  }
  if (strategy === "covered_call") {
    if (!isFiniteNumber(input.capital?.stockShares ?? input.existingPosition?.stockShares)) reasons.push("100株保有を確認してください。");
    reasons.push("売却されてもよい価格か確認してください。");
  }
  if (strategy === "long_call") reasons.push("反対売買前提、時間価値減少、損益分岐点を確認してください。");
  if (strategy === "cash_secured_put_buy_to_own") reasons.push("その価格で100株取得してよいか確認してください。");
  return reasons;
}

function strategyAvoidReasons(
  input: StrategyPrecisionInput,
  strategy: StrategyCandidateKind,
  strategyInput?: StrategyCandidateInput,
  leg?: OptionLegDraft,
): string[] {
  const reasons: string[] = [];
  if (strategy === "cash_secured_put_buy_to_own" && strategyInput?.longTermHoldEligible === false) reasons.push("100株取得したくない銘柄です。");
  if (strategy === "covered_call") {
    const shares = input.capital?.stockShares ?? input.existingPosition?.stockShares;
    const costBasis = input.capital?.stockCostBasisUSD ?? input.existingPosition?.stockCostBasisUSD;
    if (isFiniteNumber(shares) && shares < 100) reasons.push("100株未満のためカバードコールにできません。");
    if (isFiniteNumber(costBasis) && isFiniteNumber(leg?.strikePrice) && leg.strikePrice < costBasis) reasons.push("取得単価未満strikeです。");
  }
  return reasons;
}

function manualReasonsFrom(label: string, review: StrategyPrecisionSubReview): string[] {
  return review.level === "watch" ? review.warnings.map((warning) => `${label}: ${warning}`) : [];
}

function blockedReasonsFrom(label: string, review: StrategyPrecisionSubReview): string[] {
  return review.level === "blocked" ? review.warnings.map((warning) => `${label}: ${warning}`) : [];
}

function strikeTooCloseForAvoidPut(strategy: StrategyCandidateKind, ratio: number): boolean {
  return strategy === "cash_secured_put_avoid_assignment" && ratio > 0.8;
}

function precisionNextChecks(strategy: StrategyCandidateKind): string[] {
  const common = ["チャート根拠", "満期と時間軸", "strikeの意味", "Bid/Ask spread", "決算/重要イベント", "最大損失"];
  if (strategy === "long_call") return [...common, "反対売買前提", "時間価値減少", "利確/損切り候補"];
  if (strategy === "cash_secured_put_buy_to_own") return [...common, "100株取得資金", "取得後のカバードコール移行"];
  if (strategy === "cash_secured_put_avoid_assignment") return [...common, "満期前決済期限", "利確ルール", "損切りルール"];
  if (strategy === "covered_call") return [...common, "100株保有", "取得単価", "売却許容価格"];
  return [...common, "複合損失", "同一満期/分割満期", "割当資金"];
}

function reviewChecklist(strategy: StrategyCandidateKind): string[] {
  const common = [
    "チャート根拠を確認した",
    "満期と時間軸が合っている",
    "strikeの意味を確認した",
    "Bid/Ask spreadを確認した",
    "決算/配当/重要イベントを確認した",
    "最大損失を確認した",
    "証券会社画面の価格を最終確認する",
  ];
  if (strategy === "long_call") return [...common, "反対売買前提、時間価値減少、損益分岐点を確認した"];
  if (strategy === "cash_secured_put_buy_to_own") return [...common, "100株取得資金を確認した"];
  if (strategy === "cash_secured_put_avoid_assignment") return [...common, "満期前決済期限、利確、損切りを確認した"];
  if (strategy === "covered_call") return [...common, "100株保有、売却許容価格、取得単価を確認した"];
  return [...common, "P割当資金、同一満期/分割満期、複合損失を確認した"];
}

function advancedChecklistReasons(strategy: StrategyCandidateKind): string[] {
  if (strategy === "short_strangle" || strategy === "short_strangle_covered" || strategy === "short_strangle_advanced_review") {
    return ["裸コール、片側流動性、同一満期、決算直前を確認してください。"];
  }
  if (strategy === "synthetic_forward" || strategy === "combo") return ["P割当資金、同一満期/分割満期、複合損失を確認してください。"];
  if (strategy === "long_straddle_event") return ["イベント日、IV、上下損益分岐点を確認してください。"];
  return ["戦略固有のリスクを確認してください。"];
}

function strategyLabel(strategy: StrategyCandidateKind): string {
  const labels: Record<StrategyCandidateKind, string> = {
    long_call: "コール買い",
    cash_secured_put_buy_to_own: "買いたいP売り",
    cash_secured_put_avoid_assignment: "買わないプット売り",
    covered_call: "カバードコール",
    wheel: "Wheel",
    short_strangle: "ショートストラングル",
    short_strangle_covered: "カバー付きストラングル",
    short_strangle_advanced_review: "上級ストラングル",
    synthetic_forward: "シンセティック",
    combo: "コンボ",
    itm_short_put_buy_to_own: "ITM P売り",
    long_straddle_event: "イベントストラドル",
    protective_collar: "カラー",
  };
  return labels[strategy] ?? strategy;
}

function formatUSD(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unique<T>(values: Array<T | undefined>): T[] {
  return Array.from(new Set(values.filter((value): value is T => value !== undefined && value !== "")));
}
