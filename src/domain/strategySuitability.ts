import { evaluateChartFinalGate } from "@/domain/chartAnalysis";
import { evaluateStrategyFit } from "@/domain/screeningRules";
import type {
  ChartAnalysisSnapshot,
  ChartRegime,
  PublicStrategyFitLevel,
  PublicScreeningCandidateInput,
  ScreeningCandidate,
  StrategyCandidateInput,
  StrategyCandidateKind,
  StrategyFitResult,
  StrategySuitability,
} from "@/types/screening";

export type StrategySuitabilityInput = {
  candidate: ScreeningCandidate;
  chartAnalysis?: ChartAnalysisSnapshot;
  strategies?: StrategyCandidateInput[];
  capital?: PublicScreeningCandidateInput["capital"];
  existingPosition?: PublicScreeningCandidateInput["existingPosition"];
};

const initialStrategyOrder: StrategyCandidateKind[] = [
  "long_call",
  "cash_secured_put_buy_to_own",
  "covered_call",
  "cash_secured_put_avoid_assignment",
];

const levelRank: Record<PublicStrategyFitLevel, number> = {
  fit: 5,
  watch: 4,
  manual_review_required: 3,
  insufficient_data: 2,
  avoid: 1,
};

const confidenceRank = {
  high: 4,
  medium: 3,
  low: 2,
  insufficient: 1,
};

export function evaluateStrategySuitability(input: StrategySuitabilityInput): StrategySuitability[] {
  return evaluateCandidateStrategySuitabilities(input);
}

export function evaluateCandidateStrategySuitabilities(input: StrategySuitabilityInput): StrategySuitability[] {
  const strategies = (input.strategies ?? input.candidate.candidateStrategies).filter(isInitialStrategy);
  return rankStrategySuitabilities(
    strategies.map((strategy) => {
      const enrichedStrategy = enrichStrategyWithOperationalInputs(strategy, input.capital, input.existingPosition);
      const baseFit = evaluateStrategyFit(input.candidate, enrichedStrategy);
      const chartGated = applyChartGateToStrategyFit(enrichedStrategy, baseFit, input.chartAnalysis);
      return applyCapitalAndPositionGate(enrichedStrategy, chartGated, input.capital, input.existingPosition);
    }),
  );
}

export function applyChartGateToStrategyFit(
  strategy: StrategyCandidateInput,
  baseFit: StrategyFitResult,
  chartAnalysis?: ChartAnalysisSnapshot,
): StrategySuitability {
  const baseLevel = baseFit.fitLevel;
  const baseReasons = baseFit.reasons;
  const baseWarnings = baseFit.warnings;
  const baseMissing = baseFit.missingFields;
  const nextChecks = buildNextChecks(strategy.strategy);

  if (baseLevel === "avoid") {
    return {
      strategy: strategy.strategy,
      level: "avoid",
      chartRegime: chartAnalysis?.regime,
      confidence: chartAnalysis?.confidence,
      reasons: baseReasons,
      warnings: baseWarnings,
      missingFields: baseMissing,
      manualReviewReasons: [],
      nextChecks,
    };
  }

  if (baseLevel === "insufficient_data") {
    return {
      strategy: strategy.strategy,
      level: "insufficient_data",
      chartRegime: chartAnalysis?.regime,
      confidence: chartAnalysis?.confidence,
      reasons: baseReasons,
      warnings: baseWarnings,
      missingFields: baseMissing,
      manualReviewReasons: [],
      nextChecks,
    };
  }

  if (!chartAnalysis) {
    return {
      strategy: strategy.strategy,
      level: "watch",
      reasons: baseReasons,
      warnings: [...baseWarnings, "チャート分析が未実施のためfitにはしません。"],
      missingFields: unique([...baseMissing, "chartAnalysis"]),
      manualReviewReasons: ["チャート局面を確認してください。"],
      nextChecks,
    };
  }

  if (chartAnalysis.regime === "insufficient_data" || chartAnalysis.confidence === "insufficient") {
    return {
      strategy: strategy.strategy,
      level: "insufficient_data",
      chartRegime: chartAnalysis.regime,
      confidence: chartAnalysis.confidence,
      reasons: baseReasons,
      warnings: unique([...baseWarnings, ...chartAnalysis.warnings]),
      missingFields: unique([...baseMissing, ...chartAnalysis.missingFields, "chartAnalysis"]),
      manualReviewReasons: ["チャート分析に必要なデータが不足しています。"],
      nextChecks,
    };
  }

  const rule = evaluateRegimeForStrategy(strategy, chartAnalysis);
  const gate = evaluateChartFinalGate(chartAnalysis, {
    direction: strategy.strategy === "covered_call" || strategy.strategy === "cash_secured_put_avoid_assignment" ? "neutral" : "bullish",
    horizon: strategy.strategy === "long_call" ? "long" : "medium",
  });
  const chartGateLevel = gateLevelForStrategy(strategy.strategy, gate.level);
  const level = minLevel(baseLevel, rule.level, chartGateLevel);

  return {
    strategy: strategy.strategy,
    level,
    chartRegime: chartAnalysis.regime,
    confidence: chartAnalysis.confidence,
    reasons: unique([...baseReasons, ...chartAnalysis.reasons, ...gate.reasons, ...rule.reasons]),
    warnings: unique([...baseWarnings, ...chartAnalysis.warnings, ...gate.warnings, ...rule.warnings]),
    missingFields: unique([...baseMissing, ...chartAnalysis.missingFields, ...rule.missingFields]),
    manualReviewReasons: unique([...gate.manualReviewReasons, ...(rule.manualReviewReasons ?? [])]),
    nextChecks,
  };
}

export function rankStrategySuitabilities(results: StrategySuitability[]): StrategySuitability[] {
  return [...results].sort((a, b) => {
    const levelDiff = levelRank[b.level] - levelRank[a.level];
    if (levelDiff !== 0) return levelDiff;
    const confidenceDiff = confidenceRank[b.confidence ?? "insufficient"] - confidenceRank[a.confidence ?? "insufficient"];
    if (confidenceDiff !== 0) return confidenceDiff;
    const missingDiff = a.missingFields.length - b.missingFields.length;
    if (missingDiff !== 0) return missingDiff;
    const warningDiff = a.warnings.length - b.warnings.length;
    if (warningDiff !== 0) return warningDiff;
    return initialStrategyOrder.indexOf(a.strategy) - initialStrategyOrder.indexOf(b.strategy);
  });
}

function evaluateRegimeForStrategy(
  strategy: StrategyCandidateInput,
  chartAnalysis: ChartAnalysisSnapshot,
): Pick<StrategySuitability, "level" | "reasons" | "warnings" | "missingFields" | "manualReviewReasons"> {
  const regime = chartAnalysis.regime;
  switch (strategy.strategy) {
    case "long_call":
      return evaluateLongCallRegime(regime);
    case "cash_secured_put_buy_to_own":
      return evaluateBuyToOwnPutRegime(strategy, regime);
    case "covered_call":
      return evaluateCoveredCallRegime(regime);
    case "cash_secured_put_avoid_assignment":
      return evaluateAvoidAssignmentPutRegime(regime);
    default:
      return {
        level: "manual_review_required",
        reasons: [],
        warnings: ["初期4戦略以外は後続工程で詳細判定します。"],
        missingFields: [],
        manualReviewReasons: ["戦略別ルールが未実装です。"],
      };
  }
}

function evaluateLongCallRegime(regime: ChartRegime): Pick<StrategySuitability, "level" | "reasons" | "warnings" | "missingFields" | "manualReviewReasons"> {
  if (regime === "downtrend" || regime === "bearish_breakdown") {
    return {
      level: "avoid",
      reasons: [],
      warnings: ["下落局面ではコール買い候補にしません。"],
      missingFields: [],
      manualReviewReasons: [],
    };
  }
  if (regime === "range_neutral") {
    return {
      level: "watch",
      reasons: ["レンジ局面のため方向確認が必要です。"],
      warnings: ["コール買いは上抜け確認待ちです。"],
      missingFields: [],
      manualReviewReasons: [],
    };
  }
  if (regime === "event_large_move_unknown") return manualReview("イベント局面ではコール買いの方向判定を手動確認します。");
  if (regime === "bullish_pullback") {
    return {
      level: "watch",
      reasons: ["押し目局面では反発確認後のコール買い候補として監視します。"],
      warnings: ["押し目がサポート割れに変わらないか確認してください。"],
      missingFields: [],
      manualReviewReasons: [],
    };
  }
  return {
    level: "fit",
    reasons: ["上昇系のチャート局面です。"],
    warnings: [],
    missingFields: [],
    manualReviewReasons: [],
  };
}

function evaluateBuyToOwnPutRegime(
  strategy: StrategyCandidateInput,
  regime: ChartRegime,
): Pick<StrategySuitability, "level" | "reasons" | "warnings" | "missingFields" | "manualReviewReasons"> {
  if (regime === "downtrend" || regime === "bearish_breakdown") {
    const willingToOwn = strategy.longTermHoldEligible === true;
    return {
      level: willingToOwn ? "watch" : "avoid",
      reasons: willingToOwn ? ["下落中でも100株取得前提なら監視候補に留めます。"] : [],
      warnings: ["下落局面では割当リスクを優先確認します。"],
      missingFields: willingToOwn ? [] : ["longTermHoldEligible"],
      manualReviewReasons: ["本当に100株買ってよい銘柄・価格か確認してください。"],
    };
  }
  if (regime === "event_large_move_unknown") return manualReview("イベント局面ではP売り割当リスクを手動確認します。");
  if (regime === "bullish_pullback") {
    return {
      level: "fit",
      reasons: ["上昇基調中の押し目は買いたいP売り候補です。"],
      warnings: [],
      missingFields: [],
      manualReviewReasons: [],
    };
  }
  return {
    level: "fit",
    reasons: ["買いたいP売りと矛盾しにくいチャート局面です。"],
    warnings: [],
    missingFields: [],
    manualReviewReasons: [],
  };
}

function evaluateCoveredCallRegime(regime: ChartRegime): Pick<StrategySuitability, "level" | "reasons" | "warnings" | "missingFields" | "manualReviewReasons"> {
  if (regime === "range_neutral") {
    return {
      level: "fit",
      reasons: ["横ばいレンジはカバードコール候補として確認できます。"],
      warnings: [],
      missingFields: [],
      manualReviewReasons: [],
    };
  }
  if (regime === "downtrend" || regime === "bearish_breakdown") {
    return {
      level: "watch",
      reasons: [],
      warnings: ["下落局面では通常のカバードコールより保有継続・撤退判断を優先します。"],
      missingFields: [],
      manualReviewReasons: ["下落保険や撤退判断を確認してください。"],
    };
  }
  if (regime === "event_large_move_unknown") return manualReview("イベント局面では売却されてよい価格か手動確認します。");
  return {
    level: "watch",
    reasons: ["上昇局面でも売却されてよい価格なら監視候補です。"],
    warnings: ["強い上昇局面では早すぎるコール売りに注意します。"],
    missingFields: [],
    manualReviewReasons: [],
  };
}

function evaluateAvoidAssignmentPutRegime(regime: ChartRegime): Pick<StrategySuitability, "level" | "reasons" | "warnings" | "missingFields" | "manualReviewReasons"> {
  if (regime === "downtrend" || regime === "bearish_breakdown") {
    return {
      level: "avoid",
      reasons: [],
      warnings: ["下落局面では買いたくないP売り候補にしません。"],
      missingFields: [],
      manualReviewReasons: [],
    };
  }
  if (regime === "event_large_move_unknown") return manualReview("イベント局面では買いたくないP売りの撤退条件を手動確認します。");
  if (regime === "range_neutral" || regime === "bullish_continuation") {
    return {
      level: "fit",
      reasons: ["横ばいまたは上昇継続で、遠いP売り候補として確認できます。"],
      warnings: [],
      missingFields: [],
      manualReviewReasons: [],
    };
  }
  return {
    level: "watch",
    reasons: ["上昇転換または押し目では出口ルールを確認して監視候補に留めます。"],
    warnings: [],
    missingFields: [],
    manualReviewReasons: [],
  };
}

function gateLevelForStrategy(strategy: StrategyCandidateKind, gateLevel: "pass" | "watch" | "blocked" | "insufficient_data"): PublicStrategyFitLevel {
  if (gateLevel === "pass") return "fit";
  if (gateLevel === "watch") return "watch";
  if (gateLevel === "insufficient_data") return "insufficient_data";
  return strategy === "cash_secured_put_buy_to_own" || strategy === "covered_call" ? "watch" : "avoid";
}

function applyCapitalAndPositionGate(
  strategy: StrategyCandidateInput,
  suitability: StrategySuitability,
  capital?: PublicScreeningCandidateInput["capital"],
  existingPosition?: PublicScreeningCandidateInput["existingPosition"],
): StrategySuitability {
  if (suitability.level === "avoid" || suitability.level === "insufficient_data") return suitability;
  switch (strategy.strategy) {
    case "cash_secured_put_buy_to_own":
      return gateBuyToOwnPut(strategy, suitability, capital);
    case "covered_call":
      return gateCoveredCall(strategy, suitability, capital, existingPosition);
    case "cash_secured_put_avoid_assignment":
      return gateAvoidAssignmentPut(suitability, capital);
    default:
      return suitability;
  }
}

function enrichStrategyWithOperationalInputs(
  strategy: StrategyCandidateInput,
  capital?: PublicScreeningCandidateInput["capital"],
  existingPosition?: PublicScreeningCandidateInput["existingPosition"],
): StrategyCandidateInput {
  if (strategy.strategy === "cash_secured_put_buy_to_own") {
    const assignmentCapitalRequired = finitePositive(strategy.assignmentCapitalRequired) ?? (isFiniteNumber(strategy.strikePrice) ? strategy.strikePrice * 100 : undefined);
    const availableCash = finitePositive(strategy.availableCash) ?? finitePositive(capital?.assignmentCapitalAvailableUSD) ?? finitePositive(capital?.availableCashUSD);
    return { ...strategy, assignmentCapitalRequired, availableCash };
  }
  if (strategy.strategy === "covered_call") {
    const stockShares = finitePositive(strategy.stockShares) ?? finitePositive(capital?.stockShares) ?? finitePositive(existingPosition?.stockShares);
    const stockCostBasis = finitePositive(strategy.stockCostBasis) ?? finitePositive(capital?.stockCostBasisUSD) ?? finitePositive(existingPosition?.stockCostBasisUSD);
    return { ...strategy, stockShares, stockCostBasis };
  }
  return strategy;
}

function gateBuyToOwnPut(
  strategy: StrategyCandidateInput,
  suitability: StrategySuitability,
  capital?: PublicScreeningCandidateInput["capital"],
): StrategySuitability {
  const requiredCapital = finitePositive(strategy.assignmentCapitalRequired) ?? (isFiniteNumber(strategy.strikePrice) ? strategy.strikePrice * 100 : undefined);
  const availableCapital = finitePositive(capital?.assignmentCapitalAvailableUSD) ?? finitePositive(capital?.availableCashUSD) ?? finitePositive(strategy.availableCash);
  const warnings = ["買いたいP売りはN口座/P口座の現物株購入代金確認を必須ゲートにします。"];
  if (!isFiniteNumber(requiredCapital)) {
    return downgradeSuitability(suitability, "manual_review_required", {
      warnings,
      missingFields: ["capital.assignmentCapitalRequiredUSD"],
      manualReviewReasons: ["strike x 100 x 枚数の現物株購入代金を確認してください。"],
    });
  }
  if (!isFiniteNumber(availableCapital)) {
    return downgradeSuitability(suitability, "manual_review_required", {
      warnings: [...warnings, "現物株購入代金確認待ちです。"],
      missingFields: ["capital.assignmentCapitalAvailableUSD"],
      manualReviewReasons: ["対象N口座/P口座に現物株購入代金があるか確認してください。"],
    });
  }
  if (availableCapital < requiredCapital) {
    return downgradeSuitability(suitability, "avoid", {
      warnings: [...warnings, "strike x 100 x 枚数の現物株購入代金の必要資金が不足しています。"],
      missingFields: ["capital.assignmentCapitalAvailableUSD"],
      manualReviewReasons: [],
    });
  }
  return {
    ...suitability,
    reasons: unique([...suitability.reasons, "現物株購入代金ゲートを確認済みです。"]),
    warnings: unique([...suitability.warnings, ...warnings]),
  };
}

function gateCoveredCall(
  strategy: StrategyCandidateInput,
  suitability: StrategySuitability,
  capital?: PublicScreeningCandidateInput["capital"],
  existingPosition?: PublicScreeningCandidateInput["existingPosition"],
): StrategySuitability {
  const shares = finitePositive(capital?.stockShares) ?? finitePositive(existingPosition?.stockShares) ?? finitePositive(strategy.stockShares);
  const requiredShares = 100;
  if (!isFiniteNumber(shares)) {
    return downgradeSuitability(suitability, "manual_review_required", {
      warnings: ["カバードコールは同一口座100株以上の現物株確認を必須ゲートにします。", "現物株確認待ちです。"],
      missingFields: ["capital.stockShares"],
      manualReviewReasons: ["同一口座に100株以上あるか確認してください。"],
    });
  }
  if (shares < requiredShares) {
    return downgradeSuitability(suitability, "avoid", {
      warnings: ["同一口座の現物株が100株未満のためカバードコール候補にしません。"],
      missingFields: ["capital.stockShares"],
      manualReviewReasons: [],
    });
  }
  return {
    ...suitability,
    reasons: unique([...suitability.reasons, "同一口座100株以上の現物株ゲートを確認済みです。"]),
  };
}

function gateAvoidAssignmentPut(
  suitability: StrategySuitability,
  capital?: PublicScreeningCandidateInput["capital"],
): StrategySuitability {
  const requiredMargin = finitePositive(capital?.saxoRequiredMarginUSD);
  const marginAvailable = finitePositive(capital?.saxoMarginAvailableUSD);
  const cashBalance = finitePositive(capital?.cashBalanceUSD) ?? finitePositive(capital?.availableCashUSD);
  const missingFields = [
    !isFiniteNumber(requiredMargin) ? "capital.saxoRequiredMarginUSD" : undefined,
    !isFiniteNumber(marginAvailable) ? "capital.saxoMarginAvailableUSD" : undefined,
    !isFiniteNumber(cashBalance) ? "capital.cashBalanceUSD" : undefined,
  ].filter((field): field is string => Boolean(field));
  const gateWarnings = ["買わないプット売りはSaxoの必要証拠金、証拠金余力、現金残高2倍以上を必須ゲートにします。"];
  if (missingFields.length > 0) {
    return downgradeSuitability(suitability, "manual_review_required", {
      warnings: [...gateWarnings, "証拠金確認待ちです。"],
      missingFields,
      manualReviewReasons: ["Saxoの必要証拠金、証拠金余力、現金残高を確認してください。"],
    });
  }
  const confirmedRequiredMargin = requiredMargin as number;
  const confirmedMarginAvailable = marginAvailable as number;
  const confirmedCashBalance = cashBalance as number;
  if (confirmedMarginAvailable < confirmedRequiredMargin) {
    return downgradeSuitability(suitability, "avoid", {
      warnings: [...gateWarnings, "Saxoの証拠金余力が必要証拠金を下回っています。"],
      missingFields: [],
      manualReviewReasons: [],
    });
  }
  if (confirmedCashBalance < confirmedRequiredMargin * 2) {
    return downgradeSuitability(suitability, "avoid", {
      warnings: [...gateWarnings, "現金残高が必要証拠金の2倍未満です。"],
      missingFields: [],
      manualReviewReasons: [],
    });
  }
  return {
    ...suitability,
    reasons: unique([...suitability.reasons, "Saxo証拠金・余力・現金2倍ゲートを確認済みです。"]),
    warnings: unique([...suitability.warnings, ...gateWarnings]),
  };
}

function downgradeSuitability(
  suitability: StrategySuitability,
  level: PublicStrategyFitLevel,
  additions: Pick<StrategySuitability, "warnings" | "missingFields"> & { manualReviewReasons: string[] },
): StrategySuitability {
  return {
    ...suitability,
    level: minLevel(suitability.level, level),
    warnings: unique([...suitability.warnings, ...additions.warnings]),
    missingFields: unique([...suitability.missingFields, ...additions.missingFields]),
    manualReviewReasons: unique([...(suitability.manualReviewReasons ?? []), ...additions.manualReviewReasons]),
  };
}

function minLevel(...levels: PublicStrategyFitLevel[]): PublicStrategyFitLevel {
  return levels.reduce((current, next) => (levelRank[next] < levelRank[current] ? next : current));
}

function manualReview(reason: string): Pick<StrategySuitability, "level" | "reasons" | "warnings" | "missingFields" | "manualReviewReasons"> {
  return {
    level: "manual_review_required",
    reasons: [],
    warnings: ["イベントまたは方向不明のため手動確認が必要です。"],
    missingFields: [],
    manualReviewReasons: [reason],
  };
}

function buildNextChecks(strategy: StrategyCandidateKind): string[] {
  switch (strategy) {
    case "long_call":
      return ["DTE 150日以上", "strike / price 1.00-1.05", "反対売買で決済する前提", "高値追いでないか"];
    case "cash_secured_put_buy_to_own":
      return ["100株買ってよい銘柄か", "割当資金", "DTE 30-90日", "strike / price 0.90-0.97", "権利行使後にカバコへ移行できるか"];
    case "covered_call":
      return ["100株保有", "取得単価", "売却されてよい価格", "DTE 30-90日", "strikeが取得単価以上か"];
    case "cash_secured_put_avoid_assignment":
      return ["利確ルール", "損切りルール", "満期1週間前までの撤退期限", "DTE 30-90日", "strike / price 0.60-0.80"];
    default:
      return [];
  }
}

function isInitialStrategy(strategy: StrategyCandidateInput): boolean {
  return initialStrategyOrder.includes(strategy.strategy);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function finitePositive(value: unknown): number | undefined {
  return isFiniteNumber(value) && value >= 0 ? value : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
