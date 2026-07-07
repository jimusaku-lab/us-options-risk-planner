import type { CandidateSymbol } from "@/types/candidates";
import type { ChartConfidence, ChartRegime, ScreeningCompletenessLevel } from "@/types/screening";
import {
  selectPriorityReview,
  type ScreeningPriorityBand,
  type ScreeningPriorityReview,
  type ScreeningTargetStrategy,
} from "@/domain/screeningPriority";

export type ScreeningSortKey =
  | "priority"
  | "completeness"
  | "chart"
  | "draft"
  | "liquidity"
  | "capital"
  | "review_ready"
  | "required_unchecked"
  | "import_order"
  | "candidate_score"
  | "chart_confidence"
  | "screening_rank"
  | "market_cap"
  | "volume"
  | "symbol";

export type MissingDataFilter = "all" | "has_missing" | "no_missing";
export type OptionPermissionFilter = "all" | "missing" | "ok";
export type WatchFilterMode = "all" | "include" | "only" | "exclude";
export type DraftFilterMode = "all" | "ready" | "manual" | "not_ready";
export type CapitalFilterMode = "all" | "ready" | "review" | "shortage" | "missing";
export type LiquidityFilterMode = "all" | "ok" | "watch" | "missing";
export type ReviewStatusFilter = "all" | "ready" | "needs_review" | "blocked" | "missing_required" | "journaled" | "not_journaled";
export type ScreeningPresetId =
  | "none"
  | "large_liquid_core"
  | "upside_reversal_watch"
  | "bullish_pullback"
  | "income_quality_watch"
  | "upside_long_call_combo"
  | "buy_to_own_put"
  | "covered_call_stock"
  | "draft_ready"
  | "missing_data"
  | "advanced_manual";
export type ScreeningStrategyView = ScreeningTargetStrategy | "combo_upside" | "advanced_manual" | "missing_data";
export type SavedScreeningFilter = SavedScreeningConditionSet;

export type ScreeningFilterState = {
  query: string;
  targetStrategy: ScreeningTargetStrategy;
  priorityBand: ScreeningPriorityBand | "all";
  levels: ScreeningCompletenessLevel[];
  chartRegime: ChartRegime | "all";
  chartConfidence: ChartConfidence | "all";
  sort: ScreeningSortKey;
  source: string;
  preset: string;
  missingData: MissingDataFilter;
  optionPermission: OptionPermissionFilter;
  watchMode: WatchFilterMode;
  includeEarnings: boolean;
  presetId?: ScreeningPresetId;
  view?: ScreeningStrategyView;
  draft?: DraftFilterMode;
  liquidity?: LiquidityFilterMode;
  capital?: CapitalFilterMode;
  reviewStatus?: ReviewStatusFilter;
};

export type SavedScreeningConditionSet = {
  id: string;
  name: string;
  savedAt: string;
  filters: ScreeningFilterState;
  moomoo?: {
    mode?: string;
    stockScreenPreset?: string;
    fetchProfile?: string;
    maxScreenResults?: number;
    maxHistorySymbols?: number;
    maxOptionSymbols?: number;
    includeOptions?: boolean;
  };
};

export type FilteredScreeningCandidates = {
  candidates: CandidateSymbol[];
  reviewsByCandidateId: Record<string, ScreeningPriorityReview[]>;
  summary: {
    total: number;
    visible: number;
    byBand: Record<string, number>;
    byLevel: Record<string, number>;
    byStrategy: Record<string, number>;
    byPreset: Record<string, number>;
    missingOptionDataCount: number;
    draftReadyCount: number;
  };
};

export const defaultScreeningFilters: ScreeningFilterState = {
  query: "",
  targetStrategy: "all",
  priorityBand: "all",
  levels: [],
  chartRegime: "all",
  chartConfidence: "all",
  sort: "priority",
  source: "all",
  preset: "all",
  missingData: "all",
  optionPermission: "all",
  watchMode: "include",
  includeEarnings: true,
  presetId: "none",
  view: "all",
  draft: "all",
  liquidity: "all",
  capital: "all",
  reviewStatus: "all",
};

export const targetStrategyOptions: Array<{ id: ScreeningTargetStrategy; label: string }> = [
  { id: "all", label: "すべて" },
  { id: "cash_secured_put_buy_to_own", label: "P売り・買ってよい" },
  { id: "cash_secured_put_avoid_assignment", label: "買わないプット売り" },
  { id: "covered_call", label: "カバードコール" },
  { id: "long_call", label: "コール買い" },
  { id: "upside_reversal_combo", label: "上昇転換コンボ" },
  { id: "synthetic_forward", label: "シンセティック" },
  { id: "wheel_cycle", label: "ホイール" },
];

export const strategyViewOptions: Array<{ id: ScreeningStrategyView; label: string }> = [
  ...targetStrategyOptions,
  { id: "combo_upside", label: "コンボ/上昇転換" },
  { id: "advanced_manual", label: "上級戦略手動確認" },
  { id: "missing_data", label: "不足データ" },
];

export const screeningPresetOptions: Array<{ id: ScreeningPresetId; label: string }> = [
  { id: "none", label: "プリセットなし" },
  { id: "large_liquid_core", label: "大型高流動性" },
  { id: "upside_reversal_watch", label: "上昇転換監視" },
  { id: "bullish_pullback", label: "押し目監視" },
  { id: "income_quality_watch", label: "配当・品質監視" },
  { id: "upside_long_call_combo", label: "上昇転換コール/コンボ" },
  { id: "buy_to_own_put", label: "買ってよいP売り" },
  { id: "covered_call_stock", label: "保有株カバードコール" },
  { id: "draft_ready", label: "建玉案レビュー可" },
  { id: "missing_data", label: "不足データを埋める候補" },
  { id: "advanced_manual", label: "上級戦略手動確認" },
];

export function applyScreeningPreset(filters: ScreeningFilterState, presetId: ScreeningPresetId): ScreeningFilterState {
  const base = { ...filters, presetId };
  if (presetId === "none") return base;
  if (presetId === "large_liquid_core") return { ...base, preset: "large_liquid_core", sort: "priority", targetStrategy: "all" };
  if (presetId === "upside_reversal_watch") return { ...base, preset: "upside_reversal_watch", targetStrategy: "upside_reversal_combo", sort: "priority" };
  if (presetId === "bullish_pullback") return { ...base, preset: "bullish_pullback", targetStrategy: "cash_secured_put_buy_to_own", sort: "priority" };
  if (presetId === "income_quality_watch") return { ...base, preset: "income_quality_watch", targetStrategy: "covered_call", sort: "priority" };
  if (presetId === "upside_long_call_combo") return { ...base, targetStrategy: "upside_reversal_combo", view: "combo_upside", sort: "priority" };
  if (presetId === "buy_to_own_put") return { ...base, targetStrategy: "cash_secured_put_buy_to_own", view: "cash_secured_put_buy_to_own", sort: "priority", capital: "ready", includeEarnings: false };
  if (presetId === "covered_call_stock") return { ...base, targetStrategy: "covered_call", view: "covered_call", sort: "priority", liquidity: "watch" };
  if (presetId === "draft_ready") return { ...base, levels: ["level_4_draft_ready"], draft: "ready", capital: "ready", sort: "priority" };
  if (presetId === "missing_data") return { ...base, targetStrategy: "all", view: "missing_data", levels: ["level_1_symbol_price", "level_2_chart_ready", "level_3_option_ready"], missingData: "has_missing", sort: "completeness" };
  return { ...base, view: "advanced_manual", draft: "manual", sort: "priority" };
}

export function filterAndSortScreeningCandidates(
  candidates: CandidateSymbol[],
  reviewsByCandidateId: Record<string, ScreeningPriorityReview[]> | Map<string, ScreeningPriorityReview | ScreeningPriorityReview[]>,
  filters: ScreeningFilterState,
): CandidateSymbol[] {
  const filtered = candidates.filter((candidate) => candidateMatchesFilters(candidate, readReviews(reviewsByCandidateId, candidate.id), filters));
  return filtered.sort((a, b) => compareCandidates(a, b, reviewsByCandidateId, filters));
}

export function buildFilteredScreeningCandidates(
  candidates: CandidateSymbol[],
  reviewsByCandidateId: Record<string, ScreeningPriorityReview[]>,
  filters: ScreeningFilterState,
): FilteredScreeningCandidates {
  const visible = filterAndSortScreeningCandidates(candidates, reviewsByCandidateId, filters);
  return {
    candidates: visible,
    reviewsByCandidateId,
    summary: {
      total: candidates.length,
      visible: visible.length,
      byBand: countBy(candidates, (candidate) => selectPriorityReview(reviewsByCandidateId[candidate.id], filters.targetStrategy)?.band ?? "none"),
      byLevel: countBy(candidates, (candidate) => candidate.screeningCompleteness?.level ?? "none"),
      byStrategy: countBy(candidates, (candidate) => selectPriorityReview(reviewsByCandidateId[candidate.id], filters.targetStrategy)?.targetStrategy ?? "none"),
      byPreset: countBy(candidates, (candidate) => getScreeningPreset(candidate) ?? "none"),
      missingOptionDataCount: candidates.filter(hasMissingOptionData).length,
      draftReadyCount: candidates.filter((candidate) => (candidate.positionDrafts ?? candidate.publicScreeningInput?.positionDrafts ?? []).some((draft) => draft.status === "draft_ready")).length,
    },
  };
}

export function candidateMatchesFilters(
  candidate: CandidateSymbol,
  reviews: ScreeningPriorityReview[] | undefined,
  filters: ScreeningFilterState,
): boolean {
  const review = selectPriorityReview(reviews, filters.targetStrategy);
  const query = filters.query.trim().toUpperCase();
  if (query) {
    const haystack = [candidate.symbol, candidate.company, candidate.sector, candidate.screeningCandidate?.name].join(" ").toUpperCase();
    if (!haystack.includes(query)) return false;
  }
  if (filters.watchMode === "only" && !candidate.watchOnly) return false;
  if (filters.watchMode === "exclude" && candidate.watchOnly) return false;
  if (!filters.includeEarnings && (candidate.earningsWarning || candidate.publicScreeningInput?.event?.earningsDate)) return false;
  if (filters.view && filters.view !== "all" && !matchesStrategyView(candidate, filters.view)) return false;
  const level = candidate.screeningCompleteness?.level;
  if (filters.levels.length > 0 && (!level || !filters.levels.includes(level))) return false;
  if (filters.priorityBand !== "all" && review?.band !== filters.priorityBand) return false;
  if (filters.chartRegime !== "all" && candidate.publicScreeningInput?.chartAnalysis?.regime !== filters.chartRegime) return false;
  if (filters.chartConfidence !== "all" && candidate.publicScreeningInput?.chartAnalysis?.confidence !== filters.chartConfidence) return false;
  if (filters.source !== "all" && candidate.source !== filters.source) return false;
  if (filters.preset !== "all" && getScreeningPreset(candidate) !== filters.preset) return false;
  if (filters.missingData === "has_missing" && !hasAnyMissingData(candidate, review)) return false;
  if (filters.missingData === "no_missing" && hasAnyMissingData(candidate, review)) return false;
  if (filters.optionPermission === "missing" && !hasMissingOptionData(candidate)) return false;
  if (filters.optionPermission === "ok" && hasMissingOptionData(candidate)) return false;
  if (filters.draft && !matchesDraft(candidate, filters.draft)) return false;
  if (filters.liquidity && !matchesLiquidity(candidate, filters.liquidity)) return false;
  if (filters.capital && !matchesCapital(candidate, filters.capital)) return false;
  if (filters.targetStrategy !== "all" && (!review || !hasTargetStrategy(candidate, filters.targetStrategy))) return false;
  return true;
}

export function compareCandidates(
  a: CandidateSymbol,
  b: CandidateSymbol,
  reviewsByCandidateId: Record<string, ScreeningPriorityReview[]> | Map<string, ScreeningPriorityReview | ScreeningPriorityReview[]>,
  filters: ScreeningFilterState,
): number {
  const ar = selectPriorityReview(readReviews(reviewsByCandidateId, a.id), filters.targetStrategy);
  const br = selectPriorityReview(readReviews(reviewsByCandidateId, b.id), filters.targetStrategy);
  if (filters.sort === "symbol") return a.symbol.localeCompare(b.symbol);
  if (filters.sort === "screening_rank" || filters.sort === "import_order") return a.rank - b.rank;
  if (filters.sort === "candidate_score") return (b.score ?? 0) - (a.score ?? 0) || a.rank - b.rank;
  if (filters.sort === "chart_confidence" || filters.sort === "chart") return chartConfidenceRank(b.publicScreeningInput?.chartAnalysis?.confidence) - chartConfidenceRank(a.publicScreeningInput?.chartAnalysis?.confidence) || (br?.chartScore ?? 0) - (ar?.chartScore ?? 0) || a.rank - b.rank;
  if (filters.sort === "completeness") return (br?.completenessScore ?? 0) - (ar?.completenessScore ?? 0) || a.rank - b.rank;
  if (filters.sort === "draft" || filters.sort === "capital") return (br?.capitalReadinessScore ?? 0) - (ar?.capitalReadinessScore ?? 0) || a.rank - b.rank;
  if (filters.sort === "liquidity") return (br?.optionReadinessScore ?? 0) - (ar?.optionReadinessScore ?? 0) || a.rank - b.rank;
  if (filters.sort === "market_cap") return (b.marketCapUSD ?? 0) - (a.marketCapUSD ?? 0) || a.rank - b.rank;
  if (filters.sort === "volume") return (b.volume ?? 0) - (a.volume ?? 0) || a.rank - b.rank;
  return (br?.score ?? 0) - (ar?.score ?? 0) || a.rank - b.rank;
}

export function matchesStrategyView(candidate: CandidateSymbol, view: ScreeningStrategyView): boolean {
  if (view === "all") return true;
  if (view === "missing_data") return hasAnyMissingData(candidate);
  if (view === "combo_upside") return Boolean(candidate.technicalTimingPatterns?.length || candidate.publicScreeningInput?.chartAnalysis?.regime === "upside_reversal" || hasStrategy(candidate, "combo"));
  if (view === "advanced_manual") return Boolean(candidate.advancedStrategyReviews?.some((review) => review.level === "manual_review_required"));
  return hasTargetStrategy(candidate, view);
}

function hasTargetStrategy(candidate: CandidateSymbol, target: ScreeningTargetStrategy): boolean {
  if (target === "upside_reversal_combo") return Boolean(candidate.technicalTimingPatterns?.length || hasStrategy(candidate, "combo"));
  if (target === "synthetic_forward") return Boolean(candidate.syntheticForwardCandidates?.length || hasStrategy(candidate, "synthetic_forward"));
  if (target === "wheel_cycle") return hasStrategy(candidate, "wheel") || hasStrategy(candidate, "covered_call") || hasStrategy(candidate, "cash_secured_put_buy_to_own");
  if (target === "all") return true;
  return hasStrategy(candidate, target);
}

function hasStrategy(candidate: CandidateSymbol, strategy: string): boolean {
  return Boolean(
    candidate.strategySuitability?.some((item) => item.strategy === strategy) ||
      candidate.strategyFitResults?.some((item) => item.strategy === strategy) ||
      candidate.positionDrafts?.some((draft) => draft.strategy === strategy) ||
      candidate.publicScreeningInput?.candidateStrategies?.some((item) => item.strategy === strategy),
  );
}

function matchesDraft(candidate: CandidateSymbol, mode: DraftFilterMode): boolean {
  if (mode === "all") return true;
  const drafts = candidate.positionDrafts ?? candidate.publicScreeningInput?.positionDrafts ?? [];
  if (mode === "ready") return drafts.some((draft) => draft.status === "draft_ready");
  if (mode === "manual") return drafts.some((draft) => draft.status === "manual_review_required");
  return drafts.length === 0 || drafts.some((draft) => draft.status === "not_ready");
}

function matchesLiquidity(candidate: CandidateSymbol, mode: LiquidityFilterMode): boolean {
  if (mode === "all") return true;
  const options = candidate.publicScreeningInput?.optionCandidates ?? [];
  const hasBidAsk = options.some((option) => isFiniteNumber(option.bid) && isFiniteNumber(option.ask));
  const hasWarning = Boolean(candidate.screeningCandidate?.optionChainQuality.qualityWarnings.length);
  if (mode === "ok") return hasBidAsk && !hasWarning;
  if (mode === "watch") return hasBidAsk || hasWarning;
  return !hasBidAsk;
}

function matchesCapital(candidate: CandidateSymbol, mode: CapitalFilterMode): boolean {
  if (mode === "all") return true;
  const drafts = candidate.positionDrafts ?? candidate.publicScreeningInput?.positionDrafts ?? [];
  const hasShortage = drafts.some((draft) => isFiniteNumber(draft.requiredCapitalUSD) && isFiniteNumber(draft.availableCashUSD) && draft.availableCashUSD < draft.requiredCapitalUSD);
  if (mode === "ready") return drafts.some((draft) => draft.status === "draft_ready") && !hasShortage;
  if (mode === "review") return drafts.some((draft) => draft.status === "manual_review_required");
  if (mode === "shortage") return hasShortage || drafts.some((draft) => draft.status === "not_ready");
  return !candidate.publicScreeningInput?.capital;
}

export function getScreeningPreset(candidate: CandidateSymbol): string | undefined {
  return candidate.rawSourceRow?.screeningPreset || candidate.rawSourceRow?.preset || (candidate.publicScreeningInput?.rawSourceRow as Record<string, string> | undefined)?.screeningPreset;
}

function readReviews(
  source: Record<string, ScreeningPriorityReview[]> | Map<string, ScreeningPriorityReview | ScreeningPriorityReview[]>,
  candidateId: string,
): ScreeningPriorityReview[] | undefined {
  if (source instanceof Map) {
    const value = source.get(candidateId);
    if (!value) return undefined;
    return Array.isArray(value) ? value : [value];
  }
  return source[candidateId];
}

function hasMissingOptionData(candidate: CandidateSymbol): boolean {
  const missing = [
    ...(candidate.screeningCompleteness?.missingFields ?? []),
    ...(candidate.screeningCandidate?.missingFields ?? []),
  ].join(" ");
  const options = candidate.publicScreeningInput?.optionCandidates ?? [];
  const hasBidAsk = options.some((option) => isFiniteNumber(option.bid) && isFiniteNumber(option.ask));
  return !hasBidAsk || /option|Bid\/Ask|bidAsk|permissions\.usOption/i.test(missing);
}

function hasAnyMissingData(candidate: CandidateSymbol, review?: ScreeningPriorityReview): boolean {
  return Boolean(
    candidate.screeningCompleteness?.missingFields.length ||
      candidate.screeningCandidate?.missingFields.length ||
      review?.nextDataNeeded.length,
  );
}

function chartConfidenceRank(confidence?: ChartConfidence): number {
  if (confidence === "high") return 4;
  if (confidence === "medium") return 3;
  if (confidence === "low") return 2;
  return 1;
}

function countBy<T>(items: T[], getter: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = getter(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
