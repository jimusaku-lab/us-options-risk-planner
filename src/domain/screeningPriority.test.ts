import { describe, expect, it } from "vitest";
import { evaluateCandidatePriority } from "@/domain/screeningPriority";
import type { CandidateSymbol } from "@/types/candidates";

describe("screening priority", () => {
  it("keeps strong chart candidates above weak chart candidates even when option data exists", () => {
    const strong = makeCandidate("STRONG", {
      chartRegime: "upside_reversal",
      confidence: "high",
      bidAsk: true,
      draftReady: true,
    });
    const weak = makeCandidate("WEAK", {
      chartRegime: "range_neutral",
      confidence: "low",
      bidAsk: true,
      draftReady: true,
    });

    const strongReview = evaluateCandidatePriority(strong);
    const weakReview = evaluateCandidatePriority(weak);

    expect(strongReview.priorityScore).toBeGreaterThan(weakReview.priorityScore);
    expect(strongReview.priorityBand).toBe("high");
    expect(weakReview.penaltyReasons.join(" ")).toContain("チャート根拠が弱い");
  });

  it("blocks capital shortage candidates from the top band", () => {
    const shortage = makeCandidate("SHORT", {
      chartRegime: "bullish_continuation",
      confidence: "high",
      bidAsk: true,
      capitalShortage: true,
    });

    const review = evaluateCandidatePriority(shortage);

    expect(review.priorityBand).toBe("blocked");
    expect(review.priorityScore).toBeLessThanOrEqual(35);
    expect(review.penaltyReasons.join(" ")).toContain("資金不足");
  });

  it("penalizes last-only option quotes", () => {
    const lastOnly = makeCandidate("LAST", {
      chartRegime: "bullish_continuation",
      confidence: "high",
      lastOnly: true,
    });

    const review = evaluateCandidatePriority(lastOnly);

    expect(review.priorityBand).toBe("blocked");
    expect(review.penaltyReasons.join(" ")).toContain("Lastのみ");
    expect(review.missingChecks.join(" ")).toContain("オプションBid/Ask");
  });
});

function makeCandidate(
  symbol: string,
  options: {
    chartRegime: "bullish_continuation" | "upside_reversal" | "range_neutral";
    confidence: "high" | "medium" | "low";
    bidAsk?: boolean;
    lastOnly?: boolean;
    draftReady?: boolean;
    capitalShortage?: boolean;
  },
): CandidateSymbol {
  const draftStatus = options.capitalShortage ? "not_ready" : options.draftReady ? "draft_ready" : "manual_review_required";
  const optionCandidate = options.lastOnly
    ? { optionType: "call" as const, expiry: "2026-12-18", strike: 105, last: 5.2, volume: 100, openInterest: 1000 }
    : options.bidAsk
      ? { optionType: "call" as const, expiry: "2026-12-18", strike: 105, bid: 5, ask: 5.4, mid: 5.2, last: 5.2, volume: 100, openInterest: 1000 }
      : undefined;
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
      level: optionCandidate ? "level_4_draft_ready" : "level_2_chart_ready",
      canAnalyzeChart: true,
      canClassifyStrategy: true,
      canEvaluateOptionLiquidity: Boolean(optionCandidate),
      canCreatePositionDraft: Boolean(optionCandidate),
      missingFields: [],
      warnings: [],
    },
    publicScreeningInput: {
      symbol,
      underlyingPrice: 100,
      chartAnalysis: {
        regime: options.chartRegime,
        confidence: options.confidence,
        primaryTimeframe: "daily",
        timeframes: [],
        reasons: ["chart reason"],
        warnings: [],
        missingFields: [],
      },
      optionCandidates: optionCandidate ? [optionCandidate] : [],
      capital: { availableCashUSD: options.capitalShortage ? 100 : 10_000, maxLossToleranceUSD: 1_500, assignmentCapitalAvailableUSD: options.capitalShortage ? 100 : 10_000 },
    },
    strategySuitability: [
      {
        strategy: "long_call",
        level: "fit",
        chartRegime: options.chartRegime,
        confidence: options.confidence,
        reasons: [],
        warnings: [],
        missingFields: [],
        nextChecks: [],
      },
    ],
    positionDrafts: optionCandidate
      ? [
          {
            id: `${symbol}-draft`,
            strategy: "long_call",
            status: draftStatus,
            symbol,
            requiredCapitalUSD: options.capitalShortage ? 800 : 540,
            maxLossUSD: 540,
            availableCashUSD: options.capitalShortage ? 100 : 10_000,
            warnings: options.capitalShortage ? ["利用可能資金が不足しています。"] : [],
            missingFields: [],
            legs: [
              {
                id: `${symbol}-leg`,
                optionType: "call",
                side: "buy",
                expiry: "2026-12-18",
                strikePrice: 105,
                conservativePrice: options.lastOnly ? undefined : 5.4,
                conservativePriceField: options.lastOnly ? undefined : "ask",
                liquidityWarnings: [],
                missingFields: options.lastOnly ? ["conservativePrice"] : [],
              },
            ],
          },
        ]
      : [],
  };
}
