import { describe, expect, it } from "vitest";
import { applyScreeningPreset, defaultScreeningFilters, filterAndSortScreeningCandidates } from "@/domain/screeningFilters";
import { evaluateCandidatePriority } from "@/domain/screeningPriority";
import type { CandidateSymbol } from "@/types/candidates";

describe("screening filters", () => {
  it("applies draft-ready preset and excludes capital shortage candidates", () => {
    const ready = makeCandidate("READY", "level_4_draft_ready", "draft_ready");
    const blocked = makeCandidate("BLOCKED", "level_4_draft_ready", "not_ready");
    const reviews = new Map([ready, blocked].map((candidate) => [candidate.id, evaluateCandidatePriority(candidate)]));
    const filters = applyScreeningPreset(defaultScreeningFilters, "draft_ready");

    const result = filterAndSortScreeningCandidates([blocked, ready], reviews, filters);

    expect(result.map((candidate) => candidate.symbol)).toEqual(["READY"]);
  });

  it("shows missing data candidates in the missing-data view", () => {
    const l2 = makeCandidate("L2", "level_2_chart_ready", undefined);
    const l4 = makeCandidate("L4", "level_4_draft_ready", "draft_ready");
    const reviews = new Map([l2, l4].map((candidate) => [candidate.id, evaluateCandidatePriority(candidate)]));
    const filters = { ...defaultScreeningFilters, view: "missing_data" as const };

    const result = filterAndSortScreeningCandidates([l4, l2], reviews, filters);

    expect(result.map((candidate) => candidate.symbol)).toEqual(["L2"]);
  });

  it("filters by strategy view", () => {
    const longCall = makeCandidate("CALL", "level_4_draft_ready", "draft_ready", "long_call");
    const covered = makeCandidate("COVERED", "level_4_draft_ready", "draft_ready", "covered_call");
    const reviews = new Map([longCall, covered].map((candidate) => [candidate.id, evaluateCandidatePriority(candidate)]));

    const result = filterAndSortScreeningCandidates([covered, longCall], reviews, {
      ...defaultScreeningFilters,
      view: "long_call",
    });

    expect(result.map((candidate) => candidate.symbol)).toEqual(["CALL"]);
  });

  it("filters and sorts by saved review checklist readiness", () => {
    const ready = {
      ...makeCandidate("READY", "level_4_draft_ready", "draft_ready"),
      strategyPrecisionReviews: [makeReview()],
      reviewChecklistStates: [
        {
          candidateId: "READY",
          symbol: "READY",
          strategy: "long_call" as const,
          updatedAt: "2026-07-05T01:00:00.000Z",
          items: [
            { id: "chart", label: "チャート根拠を確認した", checked: true, required: true, source: "common" as const },
            { id: "price", label: "証券会社画面の価格を最終確認する", checked: true, required: true, source: "common" as const },
          ],
        },
      ],
    };
    const missing = {
      ...makeCandidate("MISSING", "level_4_draft_ready", "draft_ready"),
      strategyPrecisionReviews: [makeReview()],
      reviewChecklistStates: [
        {
          candidateId: "MISSING",
          symbol: "MISSING",
          strategy: "long_call" as const,
          updatedAt: "2026-07-05T01:00:00.000Z",
          items: [
            { id: "chart", label: "チャート根拠を確認した", checked: false, required: true, source: "common" as const },
            { id: "price", label: "証券会社画面の価格を最終確認する", checked: true, required: true, source: "common" as const },
          ],
        },
      ],
    };
    const reviews = new Map([ready, missing].map((candidate) => [candidate.id, evaluateCandidatePriority(candidate)]));

    expect(filterAndSortScreeningCandidates([missing, ready], reviews, { ...defaultScreeningFilters, reviewStatus: "ready" }).map((candidate) => candidate.symbol)).toEqual(["READY"]);
    expect(filterAndSortScreeningCandidates([ready, missing], reviews, { ...defaultScreeningFilters, sort: "required_unchecked" }).map((candidate) => candidate.symbol)).toEqual(["READY", "MISSING"]);
  });
});

function makeReview() {
  return {
    strategy: "long_call" as const,
    level: "manual_review_required" as const,
    chartGate: { level: "pass" as const, reasons: [], warnings: [] },
    expiryReview: { level: "pass" as const, reasons: [], warnings: [] },
    strikeReview: { level: "pass" as const, reasons: [], warnings: [] },
    liquidityReview: { level: "pass" as const, reasons: [], warnings: [] },
    capitalReview: { level: "pass" as const, reasons: [], warnings: [] },
    manualReviewReasons: [],
    avoidReasons: [],
    nextChecks: [],
    checklist: ["チャート根拠を確認した", "証券会社画面の価格を最終確認する"],
  };
}

function makeCandidate(
  symbol: string,
  level: "level_2_chart_ready" | "level_4_draft_ready",
  draftStatus?: "draft_ready" | "not_ready",
  strategy: "long_call" | "covered_call" = "long_call",
): CandidateSymbol {
  return {
    id: symbol,
    source: "manual_import",
    importedAt: "2026-07-05T00:00:00.000Z",
    rank: 1,
    symbol,
    company: symbol,
    priceUSD: 100,
    score: 80,
    suggestedUse: "test",
    screeningCompleteness: {
      level,
      canAnalyzeChart: true,
      canClassifyStrategy: true,
      canEvaluateOptionLiquidity: level === "level_4_draft_ready",
      canCreatePositionDraft: level === "level_4_draft_ready",
      missingFields: level === "level_4_draft_ready" ? [] : ["optionCandidates.bidAsk"],
      warnings: [],
    },
    publicScreeningInput: {
      symbol,
      underlyingPrice: 100,
      chartAnalysis: {
        regime: "bullish_continuation",
        confidence: "high",
        primaryTimeframe: "daily",
        timeframes: [],
        reasons: [],
        warnings: [],
        missingFields: [],
      },
      optionCandidates: level === "level_4_draft_ready" ? [{ optionType: "call", expiry: "2026-12-18", strike: 105, bid: 4, ask: 4.3, volume: 100, openInterest: 1000 }] : [],
      capital: level === "level_4_draft_ready" ? { availableCashUSD: draftStatus === "not_ready" ? 100 : 10_000, maxLossToleranceUSD: 1000 } : undefined,
    },
    strategySuitability: [
      {
        strategy,
        level: "fit",
        reasons: [],
        warnings: [],
        missingFields: [],
        nextChecks: [],
      },
    ],
    positionDrafts: draftStatus
      ? [
          {
            id: `${symbol}-draft`,
            strategy,
            status: draftStatus,
            symbol,
            legs: [],
            requiredCapitalUSD: 430,
            maxLossUSD: 430,
            availableCashUSD: draftStatus === "not_ready" ? 100 : 10_000,
            warnings: draftStatus === "not_ready" ? ["資金不足"] : [],
            missingFields: [],
          },
        ]
      : [],
  };
}
