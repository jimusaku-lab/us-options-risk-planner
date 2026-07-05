import { describe, expect, it } from "vitest";
import {
  buildJournalPatchFromCandidateReview,
  createChecklistStateFromPrecisionReview,
  mergeChecklistState,
  summarizeCandidateReview,
} from "@/domain/candidateReviewChecklist";
import type { CandidateSymbol } from "@/types/candidates";
import type { StrategyPrecisionReview } from "@/types/screening";

const review: StrategyPrecisionReview = {
  strategy: "long_call",
  level: "manual_review_required",
  chartGate: { level: "pass", reasons: ["週足が上向き"], warnings: [] },
  expiryReview: { level: "pass", targetDteRange: [150, 9999], actualDte: 180, reasons: ["DTE ok"], warnings: [] },
  strikeReview: { level: "pass", targetStrikeRatioRange: [1, 1.05], actualStrikeRatio: 1.03, reasons: ["strike ok"], warnings: [] },
  liquidityReview: { level: "pass", reasons: ["Askを保守価格に使用"], warnings: [] },
  capitalReview: { level: "pass", reasons: ["最大損失を確認"], warnings: [] },
  manualReviewReasons: ["時間価値減少を確認"],
  avoidReasons: [],
  nextChecks: ["チャート根拠"],
  checklist: ["チャート根拠を確認した", "証券会社画面の価格を最終確認する"],
};

function candidate(): CandidateSymbol {
  return {
    id: "candidate-NVDA",
    source: "manual_import",
    importedAt: "2026-07-05T00:00:00.000Z",
    rank: 1,
    symbol: "NVDA",
    company: "NVIDIA",
    priceUSD: 140,
    score: 90,
    suggestedUse: "long call candidate",
    strategyPrecisionReviews: [review],
    entryRationaleJournal: {
      id: "journal-1",
      candidateId: "candidate-NVDA",
      symbol: "NVDA",
      underlyingName: "NVIDIA",
      strategy: "custom",
      accountCode: "UNKNOWN",
      status: "candidate",
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z",
      entryReason: "既存の根拠",
      technicalTags: ["既存タグ"],
      technicalMemo: "既存メモ",
      expectedScenario: "",
      profitTakingPlan: "",
      stopLossPlan: "",
      invalidationCondition: "",
      chartEvidence: [],
      review: { outcome: "not_reviewed" },
    },
  };
}

describe("candidate review checklist", () => {
  it("creates required checklist state and summarizes missing required checks", () => {
    const state = createChecklistStateFromPrecisionReview({ id: "candidate-NVDA", symbol: "NVDA" }, review);
    const summary = summarizeCandidateReview({ strategyPrecisionReviews: [review], reviewChecklistStates: [state] });

    expect(state.items).toHaveLength(2);
    expect(state.items.every((item) => item.required)).toBe(true);
    expect(summary.status).toBe("needs_review");
    expect(summary.requiredUncheckedCount).toBe(2);
  });

  it("restores checked state and marks ready after required checks are complete", () => {
    const state = createChecklistStateFromPrecisionReview({ id: "candidate-NVDA", symbol: "NVDA" }, review);
    const checked = mergeChecklistState(state, { items: state.items.map((item) => ({ ...item, checked: true })) }, "2026-07-05T01:00:00.000Z");
    const restored = createChecklistStateFromPrecisionReview({ id: "candidate-NVDA", symbol: "NVDA" }, review, checked);
    const summary = summarizeCandidateReview({ strategyPrecisionReviews: [review], reviewChecklistStates: [restored] });

    expect(restored.updatedAt).toBe("2026-07-05T01:00:00.000Z");
    expect(summary.status).toBe("ready_for_review");
    expect(summary.checkedCount).toBe(2);
  });

  it("builds an explicit journal patch without leaking dangerous source fields", () => {
    const baseCandidate = candidate();
    const state = createChecklistStateFromPrecisionReview({ id: baseCandidate.id, symbol: baseCandidate.symbol }, review);
    const patch = buildJournalPatchFromCandidateReview(baseCandidate, review, mergeChecklistState(state, { note: "価格は手元で再確認" }));
    const serialized = JSON.stringify(patch);

    expect(patch.entryReason).toContain("既存の根拠");
    expect(patch.entryReason).toContain("候補レビュー: NVDA / コール買い");
    expect(patch.technicalTags).toContain("候補レビュー確認");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("accountId");
    expect(serialized).not.toContain("localPath");
    expect(serialized).not.toContain("apiKey");
  });
});
