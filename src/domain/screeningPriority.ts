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

export type ScreeningPriorityBand = "high" | "medium" | "low" | "blocked";

export type ScreeningPriorityReview = {
  candidateId: string;
  symbol: string;
  priorityScore: number;
  priorityBand: ScreeningPriorityBand;
  topReasons: string[];
  penaltyReasons: string[];
  missingChecks: string[];
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
  };
};

export type ScreeningPriorityOptions = {
  existingSymbols?: Set<string>;
};

const completenessScore: Record<ScreeningCompletenessLevel, number> = {
  insufficient: -20,
  level_1_symbol_price: 8,
  level_2_chart_ready: 18,
  level_3_option_ready: 28,
  level_4_draft_ready: 36,
};

const chartConfidenceScore: Record<ChartConfidence, number> = {
  high: 24,
  medium: 15,
  low: 3,
  insufficient: -24,
};

const chartRegimeScore: Record<ChartRegime, number> = {
  bullish_continuation: 22,
  upside_reversal: 24,
  bullish_pullback: 16,
  range_neutral: 3,
  downtrend_rebound: 2,
  event_large_move_unknown: -6,
  bearish_breakdown: -28,
  downtrend: -30,
  insufficient_data: -30,
};

const strategyLevelScore: Record<PublicStrategyFitLevel, number> = {
  fit: 18,
  watch: 6,
  manual_review_required: 3,
  avoid: -28,
  insufficient_data: -18,
};

export function buildScreeningPriorityReviews(
  candidates: CandidateSymbol[],
  options: ScreeningPriorityOptions = {},
): ScreeningPriorityReview[] {
  return candidates.map((candidate) => evaluateCandidatePriority(candidate, options));
}

export function evaluateCandidatePriority(
  candidate: CandidateSymbol,
  options: ScreeningPriorityOptions = {},
): ScreeningPriorityReview {
  const topReasons: string[] = [];
  const penaltyReasons: string[] = [];
  const missingChecks: string[] = [];
  const publicInput = candidate.publicScreeningInput;
  const chart = publicInput?.chartAnalysis;
  const completenessLevel = candidate.screeningCompleteness?.level ?? (candidate.screeningCandidate ? "level_1_symbol_price" : "insufficient");
  const completeness = completenessScore[completenessLevel] ?? 0;

  if (completenessLevel === "level_4_draft_ready") topReasons.push("データ充足: 建玉案レビューまで確認可能");
  else if (completenessLevel === "level_3_option_ready") topReasons.push("データ充足: Bid/Ask付きオプション候補あり");
  else if (completenessLevel === "level_2_chart_ready") topReasons.push("データ充足: チャート確認可能");
  else missingChecks.push("チャート、オプション、資金条件の追加確認");

  const chartScore = chart
    ? (chartConfidenceScore[chart.confidence] ?? 0) + (chartRegimeScore[chart.regime] ?? 0)
    : candidate.screeningCandidate?.technicalSnapshot?.trendNotes?.length
      ? 8
      : -24;
  if (chart) {
    if (["bullish_continuation", "upside_reversal", "bullish_pullback"].includes(chart.regime) && chart.confidence !== "low") {
      topReasons.push(`チャート: ${chart.regime} / ${chart.confidence}`);
    }
    if (chart.confidence === "low" || chart.confidence === "insufficient") penaltyReasons.push(`チャート根拠が弱い: ${chart.confidence}`);
    if (chart.regime === "downtrend" || chart.regime === "bearish_breakdown") penaltyReasons.push(`チャート局面: ${chart.regime}`);
    missingChecks.push(...chart.missingFields.map((field) => `チャート: ${field}`));
  } else {
    penaltyReasons.push("チャート分析なし");
    missingChecks.push("チャート分析");
  }

  const strategyResults = candidate.strategySuitability ?? publicInput?.strategySuitability ?? [];
  const legacyStrategyResults = candidate.strategyFitResults ?? [];
  const bestStrategy = strategyResults.length
    ? [...strategyResults].sort((a, b) => strategyLevelScore[b.level] - strategyLevelScore[a.level])[0]
    : undefined;
  const primaryStrategy = bestStrategy?.strategy ?? legacyStrategyResults[0]?.strategy;
  const strategy = strategyResults.length
    ? Math.max(...strategyResults.map((item) => strategyLevelScore[item.level] ?? 0))
    : legacyStrategyResults.length
      ? Math.max(...legacyStrategyResults.map((item) => strategyLevelScore[item.fitLevel] ?? 0))
      : -6;
  if (bestStrategy) {
    if (bestStrategy.level === "fit") topReasons.push(`戦略: ${strategyLabel(bestStrategy.strategy)} 候補`);
    if (bestStrategy.level === "watch") missingChecks.push(`戦略: ${strategyLabel(bestStrategy.strategy)} は監視条件`);
    if (bestStrategy.level === "manual_review_required") missingChecks.push(`戦略: ${strategyLabel(bestStrategy.strategy)} は手動確認`);
    if (bestStrategy.level === "avoid" || bestStrategy.level === "insufficient_data") penaltyReasons.push(`戦略: ${strategyLabel(bestStrategy.strategy)} ${fitLevelLabel(bestStrategy.level)}`);
    missingChecks.push(...bestStrategy.missingFields.map((field) => `戦略: ${field}`));
    missingChecks.push(...(bestStrategy.manualReviewReasons ?? []));
  } else if (legacyStrategyResults.length === 0) {
    missingChecks.push("戦略適性");
  }

  const liquidity = evaluateLiquidity(candidate, publicInput?.optionCandidates ?? []);
  topReasons.push(...liquidity.topReasons);
  penaltyReasons.push(...liquidity.penaltyReasons);
  missingChecks.push(...liquidity.missingChecks);

  const capital = evaluateCapital(candidate, candidate.positionDrafts ?? publicInput?.positionDrafts ?? []);
  topReasons.push(...capital.topReasons);
  penaltyReasons.push(...capital.penaltyReasons);
  missingChecks.push(...capital.missingChecks);

  const eventRisk = evaluateEventRisk(candidate);
  penaltyReasons.push(...eventRisk.penaltyReasons);
  missingChecks.push(...eventRisk.missingChecks);

  const hasExistingPosition = options.existingSymbols?.has(candidate.symbol.trim().toUpperCase()) ?? false;
  const existingPosition = hasExistingPosition || publicInput?.existingPosition?.stockShares ? 5 : 0;
  if (existingPosition > 0) topReasons.push("既存建玉/保有株との関連確認対象");

  const sortKeys = {
    completeness,
    chart: chartScore,
    strategy,
    liquidity: liquidity.score,
    capital: capital.score,
    eventRisk: eventRisk.score,
    existingPosition,
  };
  const rawScore =
    sortKeys.completeness +
    sortKeys.chart * 1.8 +
    sortKeys.strategy +
    sortKeys.liquidity +
    sortKeys.capital +
    sortKeys.eventRisk +
    sortKeys.existingPosition;
  const hardBlocked =
    completenessLevel === "insufficient" ||
    chartScore <= -35 ||
    capital.hardStop ||
    liquidity.hardStop ||
    strategy <= -24;
  const normalizedScore = Math.round(rawScore / 1.6);
  const weakChartCap = chart && (chart.confidence === "low" || chart.regime === "range_neutral") ? 74 : 100;
  const priorityScore = Math.max(0, Math.min(weakChartCap, normalizedScore));
  const priorityBand: ScreeningPriorityBand = hardBlocked
    ? "blocked"
    : priorityScore >= 78
      ? "high"
      : priorityScore >= 48
        ? "medium"
        : "low";

  const review: ScreeningPriorityReview = {
    candidateId: candidate.id,
    symbol: candidate.symbol,
    priorityScore: priorityBand === "blocked" ? Math.min(priorityScore, 35) : priorityScore,
    priorityBand,
    topReasons: unique(topReasons).slice(0, 5),
    penaltyReasons: unique(penaltyReasons).slice(0, 6),
    missingChecks: unique(missingChecks).slice(0, 7),
    primaryStrategy,
    primaryStrategyLabel: primaryStrategy ? strategyLabel(primaryStrategy) : undefined,
    sortKeys,
  };
  if (review.topReasons.length === 0) review.topReasons.push("確認材料を追加すると優先度を判定しやすくなります");
  if (review.priorityBand === "blocked" && review.penaltyReasons.length === 0) review.penaltyReasons.push("建玉案レビューへ進む条件が不足しています");
  return review;
}

function evaluateLiquidity(candidate: CandidateSymbol, options: PublicOptionCandidateInput[]) {
  const topReasons: string[] = [];
  const penaltyReasons: string[] = [];
  const missingChecks: string[] = [];
  const quality = candidate.screeningCandidate?.optionChainQuality;
  const hasBidAsk = options.some((option) => isFiniteNumber(option.bid) && isFiniteNumber(option.ask));
  const lastOnly = options.some((option) => !isFiniteNumber(option.bid) && !isFiniteNumber(option.ask) && isFiniteNumber(option.last));
  const spreads = options
    .map((option) => calculateSpreadRate(option))
    .filter(isFiniteNumber);
  const minSpread = spreads.length ? Math.min(...spreads) : quality?.bidAskSpreadRate;
  const hasVolumeOi = options.some((option) => (option.volume ?? 0) >= 50 && (option.openInterest ?? 0) >= 300);
  let score = 0;

  if (hasBidAsk) {
    score += 16;
    topReasons.push("流動性: Bid/Askあり");
  } else if (quality?.hasOptionChain) {
    score -= 10;
    missingChecks.push("オプションBid/Ask");
  } else if (options.length > 0 || quality?.hasOptionChain === false) {
    score -= 18;
    missingChecks.push("利用可能なオプションチェーン");
  }
  if (lastOnly) {
    score -= 22;
    penaltyReasons.push("流動性: Lastのみで保守価格なし");
    if (!hasBidAsk) missingChecks.push("オプションBid/Ask");
  }
  if (isFiniteNumber(minSpread)) {
    if (minSpread <= 0.12) {
      score += 8;
      topReasons.push(`流動性: spread ${(minSpread * 100).toFixed(1)}%`);
    } else if (minSpread >= 0.25) {
      score -= 14;
      penaltyReasons.push(`流動性: spread ${(minSpread * 100).toFixed(1)}%`);
    } else {
      missingChecks.push(`流動性: spread ${(minSpread * 100).toFixed(1)}%`);
    }
  }
  if (hasVolumeOi) {
    score += 6;
  } else if (options.length > 0) {
    score -= 6;
    missingChecks.push("Volume / Open Interest");
  }
  const qualityWarnings = quality?.qualityWarnings ?? [];
  if (qualityWarnings.length > 0) {
    score -= Math.min(18, qualityWarnings.length * 6);
    penaltyReasons.push(...qualityWarnings.map((warning) => `流動性: ${warning}`));
  }
  return {
    score,
    topReasons,
    penaltyReasons,
    missingChecks,
    hardStop: lastOnly && !hasBidAsk,
  };
}

function evaluateCapital(candidate: CandidateSymbol, drafts: PositionDraft[]) {
  const topReasons: string[] = [];
  const penaltyReasons: string[] = [];
  const missingChecks: string[] = [];
  const ready = drafts.some((draft) => draft.status === "draft_ready");
  const manual = drafts.some((draft) => draft.status === "manual_review_required");
  const notReady = drafts.some((draft) => draft.status === "not_ready");
  let score = 0;

  if (ready) {
    score += 16;
    topReasons.push("資金: 建玉案レビュー可");
  } else if (manual) {
    score += 2;
    missingChecks.push("資金: 手動確認");
  } else if (candidate.screeningCompleteness?.level === "level_4_draft_ready") {
    score -= 12;
    missingChecks.push("建玉案ステータス");
  } else {
    score -= 6;
    missingChecks.push("資金条件");
  }

  for (const draft of drafts) {
    const shortage = isFiniteNumber(draft.requiredCapitalUSD) && isFiniteNumber(draft.availableCashUSD) && draft.availableCashUSD < draft.requiredCapitalUSD;
    const lossOverTolerance = draft.warnings.some((warning) => warning.includes("最大損失") || warning.includes("不足"));
    if (draft.status === "not_ready" || shortage || lossOverTolerance) {
      score -= shortage ? 34 : 22;
      penaltyReasons.push(shortage ? `資金不足: 必要 ${formatUSD(draft.requiredCapitalUSD)} / 利用可能 ${formatUSD(draft.availableCashUSD)}` : `建玉案未準備: ${strategyLabel(draft.strategy)}`);
    }
    missingChecks.push(...draft.missingFields.map((field) => `建玉案: ${field}`));
    penaltyReasons.push(...draft.warnings.filter((warning) => warning.includes("不足") || warning.includes("超え")));
  }

  return {
    score,
    topReasons,
    penaltyReasons: unique(penaltyReasons),
    missingChecks: unique(missingChecks),
    hardStop: notReady || penaltyReasons.some((reason) => reason.includes("資金不足")),
  };
}

function evaluateEventRisk(candidate: CandidateSymbol) {
  const penaltyReasons: string[] = [];
  const missingChecks: string[] = [];
  let score = 0;
  const event = candidate.publicScreeningInput?.event;
  if (candidate.earningsWarning) {
    score -= 12;
    penaltyReasons.push(`イベント: ${candidate.earningsWarning}`);
  }
  if (event?.earningsDate || event?.importantEventDate) {
    score -= 8;
    penaltyReasons.push(`イベント日確認: ${event.earningsDate ?? event.importantEventDate}`);
  } else {
    missingChecks.push("決算日/重要イベント");
  }
  if (isFiniteNumber(event?.expectedMovePct) && event.expectedMovePct >= 8) {
    score -= 8;
    penaltyReasons.push(`イベント変動想定: ${event.expectedMovePct.toFixed(1)}%`);
  }
  return { score, penaltyReasons, missingChecks };
}

export function strategyLabel(strategy: StrategyCandidateKind): string {
  const labels: Record<StrategyCandidateKind, string> = {
    long_call: "コール買い",
    cash_secured_put_buy_to_own: "買いたいP売り",
    cash_secured_put_avoid_assignment: "反対売買前提P売り",
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

function fitLevelLabel(level: PublicStrategyFitLevel): string {
  if (level === "fit") return "候補";
  if (level === "watch") return "監視";
  if (level === "manual_review_required") return "手動確認";
  if (level === "avoid") return "候補外";
  return "データ不足";
}

export function priorityBandLabel(band: ScreeningPriorityBand): string {
  if (band === "high") return "高";
  if (band === "medium") return "中";
  if (band === "low") return "低";
  return "保留";
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
