import type { CandidateSymbol } from "@/types/candidates";
import type {
  ChartConfidence,
  ChartRegime,
  OptionLegDraft,
  PositionDraft,
  PublicOptionCandidateInput,
  PublicStrategyFitLevel,
  ScreeningCompletenessLevel,
  StrategyCandidateKind,
} from "@/types/screening";

export type ScreeningTargetStrategy =
  | "all"
  | "cash_secured_put_buy_to_own"
  | "cash_secured_put_avoid_assignment"
  | "covered_call"
  | "long_call"
  | "upside_reversal_combo"
  | "synthetic_forward"
  | "wheel_cycle";

export type ScreeningPriorityBand =
  | "primary_watch"
  | "secondary_watch"
  | "manual_review"
  | "avoid"
  | "insufficient_data";

export type ScreeningPriorityReview = {
  candidateId: string;
  symbol: string;
  targetStrategy: ScreeningTargetStrategy;
  band: ScreeningPriorityBand;
  score: number;
  chartScore: number;
  strategyScore: number;
  completenessScore: number;
  stockQualityScore: number;
  optionReadinessScore: number;
  capitalReadinessScore: number;
  reasons: string[];
  blockers: string[];
  nextDataNeeded: string[];
  warnings: string[];
  primaryStrategy?: StrategyCandidateKind;
  primaryStrategyLabel?: string;
  sortKeys: {
    completeness: number;
    chart: number;
    strategy: number;
    liquidity: number;
    capital: number;
    eventRisk: number;
    existingPosition: number;
    stockQuality: number;
  };
  priorityScore: number;
  priorityBand: ScreeningPriorityBand;
  topReasons: string[];
  penaltyReasons: string[];
  missingChecks: string[];
};

export type ScreeningPriorityOptions = {
  existingSymbols?: Set<string>;
  targetStrategy?: ScreeningTargetStrategy;
};

const targetStrategies: ScreeningTargetStrategy[] = [
  "cash_secured_put_buy_to_own",
  "cash_secured_put_avoid_assignment",
  "covered_call",
  "long_call",
  "upside_reversal_combo",
  "synthetic_forward",
  "wheel_cycle",
];

const completenessScoreByLevel: Record<ScreeningCompletenessLevel, number> = {
  insufficient: 0,
  level_1_symbol_price: 4,
  level_2_chart_ready: 10,
  level_3_option_ready: 13,
  level_4_draft_ready: 15,
};

const chartConfidenceScore: Record<ChartConfidence, number> = {
  high: 14,
  medium: 9,
  low: 3,
  insufficient: 0,
};

const strategyLevelScore: Record<PublicStrategyFitLevel, number> = {
  fit: 25,
  watch: 16,
  manual_review_required: 10,
  avoid: -24,
  insufficient_data: -10,
};

export function buildScreeningPriorityReviews(
  candidates: CandidateSymbol[],
  options: ScreeningPriorityOptions = {},
): ScreeningPriorityReview[] {
  return candidates.map((candidate) => evaluateCandidatePriority(candidate, options));
}

export function buildStrategyPriorityReviews(
  candidate: CandidateSymbol,
  options: ScreeningPriorityOptions = {},
): ScreeningPriorityReview[] {
  return targetStrategies.map((targetStrategy) => evaluateCandidatePriority(candidate, { ...options, targetStrategy }));
}

export function buildScreeningPriorityReviewMap(
  candidates: CandidateSymbol[],
  options: ScreeningPriorityOptions = {},
): Record<string, ScreeningPriorityReview[]> {
  return Object.fromEntries(candidates.map((candidate) => [candidate.id, buildStrategyPriorityReviews(candidate, options)]));
}

export function selectPriorityReview(
  reviews: ScreeningPriorityReview[] | undefined,
  targetStrategy: ScreeningTargetStrategy = "all",
): ScreeningPriorityReview | undefined {
  if (!reviews?.length) return undefined;
  if (targetStrategy !== "all") return reviews.find((review) => review.targetStrategy === targetStrategy);
  return [...reviews].sort((a, b) => b.score - a.score)[0];
}

export function evaluateCandidatePriority(
  candidate: CandidateSymbol,
  options: ScreeningPriorityOptions = {},
): ScreeningPriorityReview {
  const targetStrategy = options.targetStrategy ?? "all";
  if (targetStrategy === "all") {
    const reviews = buildStrategyPriorityReviews(candidate, { ...options, targetStrategy: undefined });
    const best = selectPriorityReview(reviews, "all");
    return best ?? evaluateCandidateForTarget(candidate, "long_call", options);
  }
  return evaluateCandidateForTarget(candidate, targetStrategy, options);
}

function evaluateCandidateForTarget(
  candidate: CandidateSymbol,
  targetStrategy: ScreeningTargetStrategy,
  options: ScreeningPriorityOptions,
): ScreeningPriorityReview {
  const reasons: string[] = [];
  const blockers: string[] = [];
  const nextDataNeeded: string[] = [];
  const warnings: string[] = [];
  const publicInput = candidate.publicScreeningInput;
  const chart = publicInput?.chartAnalysis;
  const completenessLevel = candidate.screeningCompleteness?.level ?? (candidate.screeningCandidate ? "level_1_symbol_price" : "insufficient");
  const completenessScore = completenessScoreByLevel[completenessLevel] ?? 0;

  if (completenessLevel === "level_4_draft_ready") reasons.push("データ充足: 建玉案レビューまで確認可能");
  else if (completenessLevel === "level_3_option_ready") reasons.push("データ充足: オプション候補確認可能");
  else if (completenessLevel === "level_2_chart_ready") reasons.push("データ充足: チャート確認可能");
  else nextDataNeeded.push("チャート分析");

  const chartScore = evaluateChartScore(chart?.regime, chart?.confidence, targetStrategy);
  if (chart) {
    reasons.push(`チャート: ${chart.regime} / ${chart.confidence}`);
    warnings.push(...chart.warnings.map((warning) => `チャート: ${warning}`));
    nextDataNeeded.push(...chart.missingFields.map((field) => `チャート: ${field}`));
    if (chart.confidence === "low" || chart.confidence === "insufficient") blockers.push(`チャート根拠が弱い: ${chart.confidence}`);
    if (chart.regime === "downtrend" || chart.regime === "bearish_breakdown") blockers.push(`チャート局面: ${chart.regime}`);
  } else {
    nextDataNeeded.push("チャート分析");
  }

  const strategyResult = findStrategyResult(candidate, targetStrategy);
  const strategyScore = strategyResult ? strategyLevelScore[strategyResult.level] ?? 0 : inferStrategyScore(candidate, targetStrategy);
  if (strategyResult) {
    reasons.push(`戦略: ${targetStrategyLabel(targetStrategy)} ${fitLevelLabel(strategyResult.level)}`);
    warnings.push(...strategyResult.warnings.map((warning) => `戦略: ${warning}`));
    nextDataNeeded.push(...strategyResult.missingFields.map((field) => `戦略: ${field}`));
    nextDataNeeded.push(...(strategyResult.nextChecks ?? []));
    nextDataNeeded.push(...(strategyResult.manualReviewReasons ?? []));
    if (strategyResult.level === "avoid") blockers.push(`戦略判定: ${targetStrategyLabel(targetStrategy)} は候補外`);
    if (strategyResult.level === "insufficient_data") nextDataNeeded.push(`戦略判定: ${targetStrategyLabel(targetStrategy)} の追加データ`);
  } else {
    nextDataNeeded.push(`戦略判定: ${targetStrategyLabel(targetStrategy)}`);
  }

  const stockQuality = evaluateStockQuality(candidate);
  reasons.push(...stockQuality.reasons);
  nextDataNeeded.push(...stockQuality.nextDataNeeded);

  const option = evaluateOptionReadiness(candidate, publicInput?.optionCandidates ?? []);
  reasons.push(...option.reasons);
  blockers.push(...option.blockers);
  nextDataNeeded.push(...option.nextDataNeeded);
  warnings.push(...option.warnings);

  const capital = evaluateCapitalReadiness(candidate, candidate.positionDrafts ?? publicInput?.positionDrafts ?? [], targetStrategy);
  reasons.push(...capital.reasons);
  blockers.push(...capital.blockers);
  nextDataNeeded.push(...capital.nextDataNeeded);
  warnings.push(...capital.warnings);

  const eventRisk = evaluateEventRisk(candidate);
  blockers.push(...eventRisk.blockers);
  nextDataNeeded.push(...eventRisk.nextDataNeeded);

  const existingPositionScore = options.existingSymbols?.has(candidate.symbol.trim().toUpperCase()) || publicInput?.existingPosition?.stockShares ? 3 : 0;
  if (existingPositionScore > 0) reasons.push("既存建玉/保有株との関連確認対象");

  const rawScore =
    chartScore +
    Math.max(0, strategyScore) +
    completenessScore +
    stockQuality.score +
    option.score +
    capital.score +
    existingPositionScore +
    eventRisk.score;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const band = resolvePriorityBand({
    score,
    chartScore,
    strategyScore,
    completenessLevel,
    blockers,
    nextDataNeeded,
    targetStrategy,
    optionHasBidAsk: option.hasBidAsk,
  });
  const primaryStrategy = mapTargetToPrimaryStrategy(targetStrategy, strategyResult?.strategy);
  const review: ScreeningPriorityReview = {
    candidateId: candidate.id,
    symbol: candidate.symbol,
    targetStrategy,
    band,
    score: band === "avoid" || band === "insufficient_data" ? Math.min(score, 45) : score,
    chartScore,
    strategyScore: Math.max(0, strategyScore),
    completenessScore,
    stockQualityScore: stockQuality.score,
    optionReadinessScore: option.score,
    capitalReadinessScore: capital.score,
    reasons: unique(reasons).slice(0, 6),
    blockers: unique(blockers).slice(0, 7),
    nextDataNeeded: unique(nextDataNeeded).slice(0, 8),
    warnings: unique(warnings).slice(0, 6),
    primaryStrategy,
    primaryStrategyLabel: primaryStrategy ? strategyLabel(primaryStrategy) : targetStrategyLabel(targetStrategy),
    sortKeys: {
      completeness: completenessScore,
      chart: chartScore,
      strategy: Math.max(0, strategyScore),
      liquidity: option.score,
      capital: capital.score,
      eventRisk: eventRisk.score,
      existingPosition: existingPositionScore,
      stockQuality: stockQuality.score,
    },
    priorityScore: 0,
    priorityBand: band,
    topReasons: [],
    penaltyReasons: [],
    missingChecks: [],
  };
  review.priorityScore = review.score;
  review.topReasons = review.reasons;
  review.penaltyReasons = [...review.blockers, ...review.warnings];
  review.missingChecks = review.nextDataNeeded;
  if (review.reasons.length === 0) review.reasons.push("確認材料を追加すると確認順を判定しやすくなります");
  return review;
}

function evaluateChartScore(regime: ChartRegime | undefined, confidence: ChartConfidence | undefined, target: ScreeningTargetStrategy): number {
  if (!regime || !confidence || regime === "insufficient_data" || confidence === "insufficient") return 0;
  let base = chartConfidenceScore[confidence] ?? 0;
  const bullishTargets: ScreeningTargetStrategy[] = ["long_call", "upside_reversal_combo", "synthetic_forward", "wheel_cycle"];
  const incomeTargets: ScreeningTargetStrategy[] = ["cash_secured_put_buy_to_own", "cash_secured_put_avoid_assignment", "covered_call", "wheel_cycle"];
  if (regime === "upside_reversal") base += bullishTargets.includes(target) ? 21 : 13;
  else if (regime === "bullish_continuation") base += bullishTargets.includes(target) ? 18 : 12;
  else if (regime === "bullish_pullback") base += incomeTargets.includes(target) ? 18 : 14;
  else if (regime === "range_neutral") base += incomeTargets.includes(target) ? 11 : 4;
  else if (regime === "downtrend_rebound") base += target === "upside_reversal_combo" || target === "long_call" ? 10 : 3;
  else if (regime === "event_large_move_unknown") base += target === "long_call" ? 5 : 1;
  else base -= 18;
  return Math.max(0, Math.min(35, base));
}

function findStrategyResult(candidate: CandidateSymbol, target: ScreeningTargetStrategy) {
  const strategies = candidate.strategySuitability ?? candidate.publicScreeningInput?.strategySuitability ?? [];
  const mapped = targetToStrategyKinds(target);
  return strategies.find((item) => mapped.includes(item.strategy));
}

function inferStrategyScore(candidate: CandidateSymbol, target: ScreeningTargetStrategy): number {
  if (target === "upside_reversal_combo" && candidate.technicalTimingPatterns?.some((item) => item.fitLevel === "fit" || item.fitLevel === "watch")) return 14;
  if (target === "synthetic_forward" && candidate.syntheticForwardCandidates?.some((item) => item.fitLevel === "fit" || item.fitLevel === "watch")) return 12;
  if (target === "wheel_cycle" && candidate.strategySuitability?.some((item) => item.strategy === "covered_call" || item.strategy === "cash_secured_put_buy_to_own")) return 10;
  return 0;
}

function evaluateStockQuality(candidate: CandidateSymbol) {
  const reasons: string[] = [];
  const nextDataNeeded: string[] = [];
  let score = 0;
  if ((candidate.marketCapUSD ?? 0) >= 10_000_000_000) {
    score += 4;
    reasons.push("株式品質: 大型株");
  } else if (candidate.marketCapUSD === undefined) {
    nextDataNeeded.push("時価総額");
  }
  if ((candidate.volume ?? 0) >= 1_000_000) {
    score += 3;
    reasons.push("株式品質: 出来高あり");
  } else if (candidate.volume === undefined) {
    nextDataNeeded.push("出来高");
  }
  if ((candidate.relativeVolume ?? 0) >= 1.2) score += 2;
  if (candidate.per !== undefined) score += 1;
  return { score: Math.min(10, score), reasons, nextDataNeeded };
}

function evaluateOptionReadiness(candidate: CandidateSymbol, options: PublicOptionCandidateInput[]) {
  const reasons: string[] = [];
  const blockers: string[] = [];
  const nextDataNeeded: string[] = [];
  const warnings: string[] = [];
  const quality = candidate.screeningCandidate?.optionChainQuality;
  const hasBidAsk = options.some((option) => isFiniteNumber(option.bid) && isFiniteNumber(option.ask));
  const hasVolumeOi = options.some((option) => (option.volume ?? 0) >= 50 && (option.openInterest ?? 0) >= 300);
  const lastOnly = options.some((option) => !isFiniteNumber(option.bid) && !isFiniteNumber(option.ask) && isFiniteNumber(option.last));
  let score = 0;
  if (hasBidAsk) {
    score += 5;
    reasons.push("オプション: Bid/Askあり");
  } else {
    nextDataNeeded.push("option bid/ask");
  }
  if (hasVolumeOi) {
    score += 3;
    reasons.push("オプション: Volume/Open Interest確認可");
  } else {
    nextDataNeeded.push("open interest");
    nextDataNeeded.push("volume");
  }
  if (options.some((option) => isFiniteNumber(option.iv) || isFiniteNumber(option.delta))) score += 2;
  else nextDataNeeded.push("IV/Greeks");
  if (lastOnly) blockers.push("Lastのみで保守価格なし");
  warnings.push(...(quality?.qualityWarnings ?? []));
  if (quality?.hasOptionChain === false) nextDataNeeded.push("option chain");
  return { score: Math.max(0, Math.min(10, score)), reasons, blockers, nextDataNeeded, warnings, hasBidAsk };
}

function evaluateCapitalReadiness(candidate: CandidateSymbol, drafts: PositionDraft[], target: ScreeningTargetStrategy) {
  const reasons: string[] = [];
  const blockers: string[] = [];
  const nextDataNeeded: string[] = [];
  const warnings: string[] = [];
  const relevantDrafts = drafts.filter((draft) => target === "all" || targetToStrategyKinds(target).includes(draft.strategy));
  const draftPool = relevantDrafts.length ? relevantDrafts : drafts;
  let score = 0;
  if (draftPool.some((draft) => draft.status === "draft_ready")) {
    score += 5;
    reasons.push("資金: 建玉案レビュー可");
  } else if (draftPool.some((draft) => draft.status === "manual_review_required")) {
    score += 2;
    nextDataNeeded.push("capital manual check");
  } else {
    nextDataNeeded.push("capital");
  }
  for (const draft of draftPool) {
    const shortage = isFiniteNumber(draft.requiredCapitalUSD) && isFiniteNumber(draft.availableCashUSD) && draft.availableCashUSD < draft.requiredCapitalUSD;
    if (shortage) blockers.push(`資金不足: 必要 ${formatUSD(draft.requiredCapitalUSD)} / 利用可能 ${formatUSD(draft.availableCashUSD)}`);
    warnings.push(...draft.warnings);
    nextDataNeeded.push(...draft.missingFields.map((field) => `建玉案: ${field}`));
  }
  if (candidate.publicScreeningInput?.capital === undefined) nextDataNeeded.push("available cash");
  return { score: Math.max(0, Math.min(5, score)), reasons, blockers, nextDataNeeded, warnings };
}

function evaluateEventRisk(candidate: CandidateSymbol) {
  const blockers: string[] = [];
  const nextDataNeeded: string[] = [];
  let score = 0;
  const event = candidate.publicScreeningInput?.event;
  if (candidate.earningsWarning) blockers.push(`イベント: ${candidate.earningsWarning}`);
  if (event?.earningsDate || event?.importantEventDate) blockers.push(`イベント日確認: ${event.earningsDate ?? event.importantEventDate}`);
  else nextDataNeeded.push("earnings date");
  if (event?.expectedMovePct !== undefined && event.expectedMovePct >= 8) blockers.push(`イベント変動想定: ${event.expectedMovePct.toFixed(1)}%`);
  if (blockers.length === 0) score += 2;
  return { score, blockers, nextDataNeeded };
}

function resolvePriorityBand(input: {
  score: number;
  chartScore: number;
  strategyScore: number;
  completenessLevel: ScreeningCompletenessLevel;
  blockers: string[];
  nextDataNeeded: string[];
  targetStrategy: ScreeningTargetStrategy;
  optionHasBidAsk: boolean;
}): ScreeningPriorityBand {
  if (input.completenessLevel === "insufficient" || input.chartScore <= 0) return "insufficient_data";
  if (input.strategyScore < 0 || input.blockers.some((item) => /候補外|bearish|downtrend|Lastのみ|資金不足|チャート局面/.test(item))) return "avoid";
  if (input.score >= 70) return "primary_watch";
  if (input.score >= 48) return "secondary_watch";
  if (input.nextDataNeeded.length > 0 || !input.optionHasBidAsk) return "manual_review";
  return "secondary_watch";
}

export function priorityBandLabel(band: ScreeningPriorityBand): string {
  if (band === "primary_watch") return "確認優先";
  if (band === "secondary_watch") return "次点";
  if (band === "manual_review") return "手動確認";
  if (band === "avoid") return "候補外";
  return "データ不足";
}

export function strategyLabel(strategy: StrategyCandidateKind): string {
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

export function targetStrategyLabel(strategy: ScreeningTargetStrategy): string {
  const labels: Record<ScreeningTargetStrategy, string> = {
    all: "すべて",
    cash_secured_put_buy_to_own: "P売り・買ってよい",
    cash_secured_put_avoid_assignment: "買わないプット売り",
    covered_call: "カバードコール",
    long_call: "コール買い",
    upside_reversal_combo: "上昇転換コンボ",
    synthetic_forward: "シンセティック",
    wheel_cycle: "ホイール",
  };
  return labels[strategy];
}

export function getBestDraft(candidate: CandidateSymbol): PositionDraft | undefined {
  const drafts = candidate.positionDrafts ?? candidate.publicScreeningInput?.positionDrafts ?? [];
  return [...drafts].sort((a, b) => draftRank(b) - draftRank(a))[0];
}

export function getBestOptionLeg(candidate: CandidateSymbol): OptionLegDraft | undefined {
  return getBestDraft(candidate)?.legs[0];
}

export function getBestOptionQuote(candidate: CandidateSymbol): PublicOptionCandidateInput | undefined {
  const options = candidate.publicScreeningInput?.optionCandidates ?? [];
  const leg = getBestOptionLeg(candidate);
  if (leg) {
    return options.find((option) => (option.id && option.id === leg.id) || option.optionType === leg.optionType && (option.strike ?? option.strikePrice) === leg.strikePrice) ?? options[0];
  }
  return options.find((option) => isFiniteNumber(option.bid) && isFiniteNumber(option.ask)) ?? options[0];
}

export function calculateSpreadRate(option?: PublicOptionCandidateInput): number | undefined {
  if (!option || !isFiniteNumber(option.bid) || !isFiniteNumber(option.ask) || option.ask <= 0) return undefined;
  const mid = isFiniteNumber(option.mid) && option.mid > 0 ? option.mid : (option.bid + option.ask) / 2;
  if (mid <= 0) return undefined;
  return (option.ask - option.bid) / mid;
}

function targetToStrategyKinds(target: ScreeningTargetStrategy): StrategyCandidateKind[] {
  if (target === "upside_reversal_combo") return ["combo"];
  if (target === "wheel_cycle") return ["wheel", "cash_secured_put_buy_to_own", "covered_call"];
  if (target === "synthetic_forward") return ["synthetic_forward"];
  if (target === "all") return [];
  return [target];
}

function mapTargetToPrimaryStrategy(target: ScreeningTargetStrategy, fallback?: StrategyCandidateKind): StrategyCandidateKind | undefined {
  if (fallback) return fallback;
  return targetToStrategyKinds(target)[0];
}

function fitLevelLabel(level: PublicStrategyFitLevel): string {
  if (level === "fit") return "候補";
  if (level === "watch") return "監視";
  if (level === "manual_review_required") return "手動確認";
  if (level === "avoid") return "候補外";
  return "データ不足";
}

function draftRank(draft: PositionDraft): number {
  if (draft.status === "draft_ready") return 3;
  if (draft.status === "manual_review_required") return 2;
  return 1;
}

function formatUSD(value?: number): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "-";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
