import type { CandidateReviewChecklistItem, CandidateReviewChecklistState, CandidateReviewReadinessStatus, CandidateSymbol } from "@/types/candidates";
import type { EntryRationaleJournal } from "@/types/domain";
import type { StrategyCandidateKind, StrategyPrecisionReview } from "@/types/screening";

export type CandidateReviewSummary = {
  status: CandidateReviewReadinessStatus;
  checkedCount: number;
  totalCount: number;
  requiredUncheckedCount: number;
  checkedLabels: string[];
  uncheckedRequiredLabels: string[];
  blockedReasons: string[];
  label: string;
};

const commonRequired = new Set([
  "チャート根拠を確認した",
  "満期と時間軸が合っている",
  "strikeの意味を確認した",
  "Bid/Ask spreadを確認した",
  "最大損失を確認した",
  "証券会社画面の価格を最終確認する",
]);

export function createChecklistStateFromPrecisionReview(
  candidate: Pick<CandidateSymbol, "id" | "symbol">,
  review: StrategyPrecisionReview,
  existing?: CandidateReviewChecklistState,
): CandidateReviewChecklistState {
  const existingMap = new Map((existing?.items ?? []).map((item) => [item.id, item]));
  const items = review.checklist.map((label, index): CandidateReviewChecklistItem => {
    const source = checklistSource(label, review.strategy);
    const id = checklistItemId(review.strategy, label, index);
    return {
      id,
      label,
      checked: existingMap.get(id)?.checked ?? false,
      required: isRequiredChecklistLabel(label),
      source,
    };
  });
  return {
    candidateId: candidate.id,
    symbol: candidate.symbol,
    strategy: review.strategy,
    updatedAt: existing?.updatedAt ?? new Date().toISOString(),
    items,
    note: existing?.note,
  };
}

export function mergeChecklistState(
  base: CandidateReviewChecklistState,
  patch: Partial<Pick<CandidateReviewChecklistState, "items" | "note">>,
  updatedAt = new Date().toISOString(),
): CandidateReviewChecklistState {
  return {
    ...base,
    ...patch,
    updatedAt,
  };
}

export function summarizeCandidateReview(
  candidate: Pick<CandidateSymbol, "strategyPrecisionReviews" | "reviewChecklistStates" | "entryRationaleJournal">,
): CandidateReviewSummary {
  const reviews = candidate.strategyPrecisionReviews ?? [];
  const states = candidate.reviewChecklistStates ?? [];
  const primary = reviews[0];
  const state = primary ? states.find((item) => item.strategy === primary.strategy) : states[0];
  const items = state?.items ?? (primary
    ? primary.checklist.map((label, index): CandidateReviewChecklistItem => ({
        id: checklistItemId(primary.strategy, label, index),
        label,
        checked: false,
        required: isRequiredChecklistLabel(label),
        source: checklistSource(label, primary.strategy),
      }))
    : []);
  const checkedLabels = items.filter((item) => item.checked).map((item) => item.label);
  const uncheckedRequiredLabels = items.filter((item) => item.required && !item.checked).map((item) => item.label);
  const blockedReasons = reviews.flatMap((review) => [
    ...review.avoidReasons,
    ...(review.chartGate.level === "blocked" ? review.chartGate.warnings : []),
    ...(review.liquidityReview.level === "blocked" ? review.liquidityReview.warnings : []),
    ...(review.capitalReview.level === "blocked" ? review.capitalReview.warnings : []),
  ]);
  const status: CandidateReviewReadinessStatus = blockedReasons.length
    ? "blocked"
    : uncheckedRequiredLabels.length === 0 && items.length > 0
      ? "ready_for_review"
      : "needs_review";
  return {
    status,
    checkedCount: checkedLabels.length,
    totalCount: items.length,
    requiredUncheckedCount: uncheckedRequiredLabels.length,
    checkedLabels,
    uncheckedRequiredLabels,
    blockedReasons: unique(blockedReasons),
    label: reviewStatusLabel(status),
  };
}

export function buildJournalPatchFromCandidateReview(
  candidate: CandidateSymbol,
  review: StrategyPrecisionReview,
  state: CandidateReviewChecklistState,
): Partial<EntryRationaleJournal> {
  const summary = summarizeCandidateReview({ strategyPrecisionReviews: [review], reviewChecklistStates: [state] });
  const checked = summary.checkedLabels.length ? summary.checkedLabels.map((item) => `- ${item}`).join("\n") : "- なし";
  const unchecked = summary.uncheckedRequiredLabels.length ? summary.uncheckedRequiredLabels.map((item) => `- ${item}`).join("\n") : "- なし";
  const manual = review.manualReviewReasons.length ? review.manualReviewReasons.map((item) => `- ${item}`).join("\n") : "- なし";
  const avoid = review.avoidReasons.length ? review.avoidReasons.map((item) => `- ${item}`).join("\n") : "- なし";
  const block = [
    `候補レビュー: ${candidate.symbol} / ${strategyLabel(review.strategy)}`,
    `レビュー状態: ${summary.label}`,
    `チャート: ${review.chartGate.level} ${[...review.chartGate.reasons, ...review.chartGate.warnings].join(" / ") || "-"}`,
    `満期: ${review.expiryReview.level} ${[...review.expiryReview.reasons, ...review.expiryReview.warnings].join(" / ") || "-"}`,
    `strike: ${review.strikeReview.level} ${[...review.strikeReview.reasons, ...review.strikeReview.warnings].join(" / ") || "-"}`,
    `流動性: ${review.liquidityReview.level} ${[...review.liquidityReview.reasons, ...review.liquidityReview.warnings].join(" / ") || "-"}`,
    `資金: ${review.capitalReview.level} ${[...review.capitalReview.reasons, ...review.capitalReview.warnings].join(" / ") || "-"}`,
    "確認済み:",
    checked,
    "必須未確認:",
    unchecked,
    "手動確認理由:",
    manual,
    "避ける理由:",
    avoid,
    state.note ? `メモ: ${state.note}` : "",
  ].filter(Boolean).join("\n");
  const tags = unique([
    ...(candidate.entryRationaleJournal?.technicalTags ?? []),
    "候補レビュー確認",
    strategyLabel(review.strategy),
    summary.status === "ready_for_review" ? "レビュー準備" : summary.status === "blocked" ? "保留" : "要確認",
  ]);
  return {
    entryReason: appendBlock(candidate.entryRationaleJournal?.entryReason ?? "", block),
    technicalTags: tags,
    technicalMemo: appendBlock(candidate.entryRationaleJournal?.technicalMemo ?? "", [
      `チャート最終ゲート: ${review.chartGate.level}`,
      `満期レビュー: ${review.expiryReview.level}`,
      `strikeレビュー: ${review.strikeReview.level}`,
      `流動性レビュー: ${review.liquidityReview.level}`,
      `資金レビュー: ${review.capitalReview.level}`,
    ].join("\n")),
    expectedScenario: candidate.entryRationaleJournal?.expectedScenario || candidate.suggestedUse,
  };
}

export function reviewStatusLabel(status: CandidateReviewReadinessStatus): string {
  if (status === "ready_for_review") return "レビュー準備";
  if (status === "blocked") return "保留";
  return "要確認";
}

export function strategyLabel(strategy: StrategyCandidateKind): string {
  const labels: Record<StrategyCandidateKind, string> = {
    long_call: "コール買い",
    cash_secured_put_buy_to_own: "買いたいP売り",
    cash_secured_put_avoid_assignment: "買いたくないP売り",
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

function checklistSource(label: string, strategy: StrategyCandidateKind): CandidateReviewChecklistItem["source"] {
  if (label.includes("100株") || label.includes("反対売買") || label.includes("満期前") || label.includes("P割当") || label.includes("取得単価")) return "strategy";
  if (strategy === "combo" || strategy === "synthetic_forward") return "strategy";
  return "common";
}

function isRequiredChecklistLabel(label: string): boolean {
  return commonRequired.has(label) || label.includes("100株") || label.includes("満期前") || label.includes("取得単価") || label.includes("P割当");
}

function checklistItemId(strategy: StrategyCandidateKind, label: string, index: number): string {
  return `${strategy}-${index}-${label.replace(/\s+/g, "-").slice(0, 40)}`;
}

function appendBlock(current: string, block: string): string {
  const trimmed = current.trim();
  if (!trimmed) return block;
  if (trimmed.includes(block)) return trimmed;
  return `${trimmed}\n\n${block}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
