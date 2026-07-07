import { describe, expect, it } from "vitest";
import { buildStrategyPriorityReviews, evaluateCandidatePriority } from "@/domain/screeningPriority";
import type { CandidateSymbol } from "@/types/candidates";

describe("screening priority review", () => {
  it("keeps chart insufficient candidates at insufficient_data", () => {
    const candidate = makeCandidate("NOCHART", { chart: false });

    const review = evaluateCandidatePriority(candidate, { targetStrategy: "long_call" });

    expect(review.band).toBe("insufficient_data");
    expect(review.chartScore).toBe(0);
    expect(review.nextDataNeeded.join(" ")).toContain("チャート分析");
  });

  it("shows option bid/ask as next data when options are missing", () => {
    const candidate = makeCandidate("L2", { level: "level_2_chart_ready", optionBidAsk: false });

    const review = evaluateCandidatePriority(candidate, { targetStrategy: "cash_secured_put_buy_to_own" });

    expect(review.band).toBe("secondary_watch");
    expect(review.nextDataNeeded.join(" ")).toContain("option bid/ask");
    expect(review.nextDataNeeded.join(" ")).toContain("capital");
  });

  it("maps strategy avoid to avoid band", () => {
    const candidate = makeCandidate("AVOID", { strategyLevel: "avoid" });

    const review = evaluateCandidatePriority(candidate, { targetStrategy: "long_call" });

    expect(review.band).toBe("avoid");
    expect(review.blockers.join(" ")).toContain("候補外");
  });

  it("adds stock quality score for large liquid stock screen candidates", () => {
    const candidate = makeCandidate("BIG", {
      rawSourceRow: { screeningPreset: "large_liquid_core" },
      marketCapUSD: 500_000_000_000,
      volume: 10_000_000,
      relativeVolume: 1.3,
    });

    const review = evaluateCandidatePriority(candidate, { targetStrategy: "covered_call" });

    expect(review.stockQualityScore).toBeGreaterThanOrEqual(7);
    expect(review.reasons.join(" ")).toContain("大型株");
  });

  it("creates strategy-specific reviews for operation switching", () => {
    const reviews = buildStrategyPriorityReviews(makeCandidate("OPS", {}));

    expect(reviews.map((review) => review.targetStrategy)).toContain("long_call");
    expect(reviews.map((review) => review.targetStrategy)).toContain("covered_call");
    expect(reviews.every((review) => review.candidateId === "OPS")).toBe(true);
  });
});

function makeCandidate(
  symbol: string,
  options: {
    chart?: boolean;
    level?: "level_2_chart_ready" | "level_4_draft_ready";
    optionBidAsk?: boolean;
    strategyLevel?: "fit" | "watch" | "avoid" | "manual_review_required" | "insufficient_data";
    rawSourceRow?: Record<string, string>;
    marketCapUSD?: number;
    volume?: number;
    relativeVolume?: number;
  },
): CandidateSymbol {
  const chart = options.chart !== false;
  const level = options.level ?? "level_2_chart_ready";
  const optionBidAsk = options.optionBidAsk ?? false;
  return {
    id: symbol,
    source: "manual_import",
    importedAt: "2026-07-06T00:00:00.000Z",
    rawSourceRow: options.rawSourceRow,
    rank: 1,
    symbol,
    company: symbol,
    priceUSD: 100,
    marketCapUSD: options.marketCapUSD,
    volume: options.volume,
    relativeVolume: options.relativeVolume,
    score: 80,
    suggestedUse: "test",
    screeningCompleteness: {
      level,
      canAnalyzeChart: chart,
      canClassifyStrategy: true,
      canEvaluateOptionLiquidity: optionBidAsk,
      canCreatePositionDraft: level === "level_4_draft_ready",
      missingFields: optionBidAsk ? [] : ["optionCandidates.bidAsk"],
      warnings: [],
    },
    publicScreeningInput: {
      symbol,
      underlyingPrice: 100,
      chartAnalysis: chart ? {
        regime: "bullish_pullback",
        confidence: "high",
        primaryTimeframe: "daily",
        timeframes: [],
        reasons: ["chart"],
        warnings: [],
        missingFields: [],
      } : undefined,
      optionCandidates: optionBidAsk ? [{ optionType: "call", expiry: "2026-12-18", strike: 105, bid: 4, ask: 4.3, volume: 100, openInterest: 1000 }] : [],
    },
    strategySuitability: [
      {
        strategy: "long_call",
        level: options.strategyLevel ?? "fit",
        reasons: [],
        warnings: [],
        missingFields: [],
        nextChecks: [],
      },
      {
        strategy: "covered_call",
        level: options.strategyLevel ?? "fit",
        reasons: [],
        warnings: [],
        missingFields: [],
        nextChecks: [],
      },
      {
        strategy: "cash_secured_put_buy_to_own",
        level: options.strategyLevel ?? "fit",
        reasons: [],
        warnings: [],
        missingFields: [],
        nextChecks: [],
      },
    ],
    positionDrafts: [],
  };
}
