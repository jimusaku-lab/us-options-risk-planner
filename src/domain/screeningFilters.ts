import type { CandidateSymbol } from "@/types/candidates";
import type { ScreeningCompletenessLevel, StrategyCandidateKind } from "@/types/screening";
import { summarizeCandidateReview } from "@/domain/candidateReviewChecklist";
import type { ScreeningPriorityReview } from "@/domain/screeningPriority";

export type ScreeningStrategyView =
  | "all"
  | "long_call"
  | "cash_secured_put_buy_to_own"
  | "covered_call"
  | "cash_secured_put_avoid_assignment"
  | "combo_upside"
  | "synthetic_forward"
  | "advanced_manual"
  | "missing_data";

export type ScreeningSortKey =
  | "priority"
  | "completeness"
  | "chart"
  | "draft"
  | "liquidity"
  | "capital"
  | "review_ready"
  | "required_unchecked"
  | "symbol"
  | "import_order";

export type WatchFilterMode = "all" | "include" | "only" | "exclude";
export type DraftFilterMode = "all" | "ready" | "manual" | "not_ready";
export type CapitalFilterMode = "all" | "ready" | "review" | "shortage" | "missing";
export type LiquidityFilterMode = "all" | "ok" | "watch" | "missing";
export type PriorityBandFilter = "all" | "high" | "medium" | "low" | "blocked";
export type ReviewStatusFilter = "all" | "ready" | "needs_review" | "blocked" | "missing_required" | "journaled" | "not_journaled";
export type ScreeningPresetId =
  | "none"
  | "upside_long_call_combo"
  | "buy_to_own_put"
  | "covered_call_stock"
  | "draft_ready"
  | "missing_data"
  | "advanced_manual";

export type ScreeningFilterState = {
  query: string;
  view: ScreeningStrategyView;
  sort: ScreeningSortKey;
  priorityBand: PriorityBandFilter;
  levels: ScreeningCompletenessLevel[];
  watchMode: WatchFilterMode;
  includeEarnings: boolean;
  draft: DraftFilterMode;
  liquidity: LiquidityFilterMode;
  capital: CapitalFilterMode;
  reviewStatus: ReviewStatusFilter;
  presetId: ScreeningPresetId;
};

export type SavedScreeningFilter = {
  id: string;
  name: string;
  savedAt: string;
  filters: ScreeningFilterState;
};

export const defaultScreeningFilters: ScreeningFilterState = {
  query: "",
  view: "all",
  sort: "priority",
  priorityBand: "all",
  levels: [],
  watchMode: "include",
  includeEarnings: true,
  draft: "all",
  liquidity: "all",
  capital: "all",
  reviewStatus: "all",
  presetId: "none",
};

export const screeningPresetOptions: Array<{ id: ScreeningPresetId; label: string }> = [
  { id: "none", label: "プリセットなし" },
  { id: "upside_long_call_combo", label: "上昇転換のコール買い/コンボ候補" },
  { id: "buy_to_own_put", label: "買ってよいP売り候補" },
  { id: "covered_call_stock", label: "保有株カバードコール候補" },
  { id: "draft_ready", label: "建玉案レビュー可" },
  { id: "missing_data", label: "不足データを埋める候補" },
  { id: "advanced_manual", label: "上級戦略手動確認" },
];

export const strategyViewOptions: Array<{ id: ScreeningStrategyView; label: string }> = [
  { id: "all", label: "すべて" },
  { id: "long_call", label: "コール買い" },
  { id: "cash_secured_put_buy_to_own", label: "買いたいP売り" },
  { id: "covered_call", label: "カバードコール" },
  { id: "cash_secured_put_avoid_assignment", label: "反対売買前提P売り" },
  { id: "combo_upside", label: "コンボ/上昇転換" },
  { id: "synthetic_forward", label: "シンセティック" },
  { id: "advanced_manual", label: "上級戦略手動確認" },
  { id: "missing_data", label: "不足データ" },
];

export function applyScreeningPreset(filters: ScreeningFilterState, presetId: ScreeningPresetId): ScreeningFilterState {
  const base = { ...filters, presetId };
  if (presetId === "none") return { ...base };
  if (presetId === "upside_long_call_combo") return { ...base, view: "combo_upside", priorityBand: "all", sort: "priority", draft: "all", liquidity: "all", capital: "all" };
  if (presetId === "buy_to_own_put") return { ...base, view: "cash_secured_put_buy_to_own", sort: "priority", capital: "ready", includeEarnings: false };
  if (presetId === "covered_call_stock") return { ...base, view: "covered_call", sort: "priority", liquidity: "watch", watchMode: "include" };
  if (presetId === "draft_ready") return { ...base, view: "all", levels: ["level_4_draft_ready"], draft: "ready", capital: "ready", sort: "priority" };
  if (presetId === "missing_data") return { ...base, view: "missing_data", levels: ["level_1_symbol_price", "level_2_chart_ready", "level_3_option_ready"], sort: "completeness" };
  return { ...base, view: "advanced_manual", draft: "manual", sort: "priority" };
}

export function filterAndSortScreeningCandidates(
  candidates: CandidateSymbol[],
  reviews: Map<string, ScreeningPriorityReview>,
  filters: ScreeningFilterState,
): CandidateSymbol[] {
  const filtered = candidates.filter((candidate) => candidateMatchesFilters(candidate, reviews.get(candidate.id), filters));
  return filtered.sort((a, b) => compareCandidates(a, b, reviews, filters.sort));
}

export function candidateMatchesFilters(candidate: CandidateSymbol, review: ScreeningPriorityReview | undefined, filters: ScreeningFilterState): boolean {
  const query = filters.query.trim().toUpperCase();
  if (query) {
    const haystack = [candidate.symbol, candidate.company, candidate.sector, candidate.screeningCandidate?.name].join(" ").toUpperCase();
    if (!haystack.includes(query)) return false;
  }
  if (filters.watchMode === "only" && !candidate.watchOnly) return false;
  if (filters.watchMode === "exclude" && candidate.watchOnly) return false;
  if (!filters.includeEarnings && (candidate.earningsWarning || candidate.publicScreeningInput?.event?.earningsDate)) return false;
  const level = candidate.screeningCompleteness?.level;
  if (filters.levels.length > 0 && (!level || !filters.levels.includes(level))) return false;
  if (filters.priorityBand !== "all" && review?.priorityBand !== filters.priorityBand) return false;
  if (!matchesStrategyView(candidate, filters.view)) return false;
  if (!matchesDraft(candidate, filters.draft)) return false;
  if (!matchesLiquidity(candidate, filters.liquidity)) return false;
  if (!matchesCapital(candidate, filters.capital)) return false;
  if (!matchesReviewStatus(candidate, filters.reviewStatus ?? "all")) return false;
  return true;
}

export function matchesStrategyView(candidate: CandidateSymbol, view: ScreeningStrategyView): boolean {
  if (view === "all") return true;
  if (view === "missing_data") return Boolean(candidate.screeningCompleteness?.missingFields.length || candidate.screeningCandidate?.missingFields.length);
  if (view === "combo_upside") {
    return Boolean(candidate.technicalTimingPatterns?.length || hasStrategy(candidate, "combo") || candidate.publicScreeningInput?.chartAnalysis?.regime === "upside_reversal");
  }
  if (view === "advanced_manual") return Boolean(candidate.advancedStrategyReviews?.some((review) => review.level === "manual_review_required"));
  return hasStrategy(candidate, view);
}

function hasStrategy(candidate: CandidateSymbol, strategy: StrategyCandidateKind): boolean {
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

function matchesReviewStatus(candidate: CandidateSymbol, mode: ReviewStatusFilter): boolean {
  if (mode === "all") return true;
  const summary = summarizeCandidateReview(candidate);
  if (mode === "ready") return summary.status === "ready_for_review";
  if (mode === "needs_review") return summary.status === "needs_review";
  if (mode === "blocked") return summary.status === "blocked";
  if (mode === "missing_required") return summary.requiredUncheckedCount > 0;
  const hasJournal = Boolean(candidate.entryRationaleJournal?.entryReason.trim());
  return mode === "journaled" ? hasJournal : !hasJournal;
}

function compareCandidates(a: CandidateSymbol, b: CandidateSymbol, reviews: Map<string, ScreeningPriorityReview>, sort: ScreeningSortKey): number {
  const ar = reviews.get(a.id);
  const br = reviews.get(b.id);
  if (sort === "symbol") return a.symbol.localeCompare(b.symbol);
  if (sort === "import_order") return a.rank - b.rank;
  if (sort === "completeness") return (br?.sortKeys.completeness ?? 0) - (ar?.sortKeys.completeness ?? 0) || a.rank - b.rank;
  if (sort === "chart") return (br?.sortKeys.chart ?? 0) - (ar?.sortKeys.chart ?? 0) || a.rank - b.rank;
  if (sort === "draft") return (br?.sortKeys.capital ?? 0) - (ar?.sortKeys.capital ?? 0) || a.rank - b.rank;
  if (sort === "liquidity") return (br?.sortKeys.liquidity ?? 0) - (ar?.sortKeys.liquidity ?? 0) || a.rank - b.rank;
  if (sort === "capital") return (br?.sortKeys.capital ?? 0) - (ar?.sortKeys.capital ?? 0) || a.rank - b.rank;
  if (sort === "review_ready") {
    const as = summarizeCandidateReview(a);
    const bs = summarizeCandidateReview(b);
    return reviewSortScore(bs) - reviewSortScore(as) || a.rank - b.rank;
  }
  if (sort === "required_unchecked") return summarizeCandidateReview(a).requiredUncheckedCount - summarizeCandidateReview(b).requiredUncheckedCount || a.rank - b.rank;
  return (br?.priorityScore ?? 0) - (ar?.priorityScore ?? 0) || a.rank - b.rank;
}

function reviewSortScore(summary: ReturnType<typeof summarizeCandidateReview>): number {
  if (summary.status === "ready_for_review") return 3;
  if (summary.status === "needs_review") return 2;
  return 1;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
