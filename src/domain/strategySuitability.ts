import { evaluateChartFinalGate } from "@/domain/chartAnalysis";
import { evaluateStrategyFit } from "@/domain/screeningRules";
import type {
  ChartAnalysisSnapshot,
  ChartRegime,
  PublicStrategyFitLevel,
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
      const baseFit = evaluateStrategyFit(input.candidate, strategy);
      return applyChartGateToStrategyFit(strategy, baseFit, input.chartAnalysis);
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
