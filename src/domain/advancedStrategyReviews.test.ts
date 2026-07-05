import { describe, expect, it } from "vitest";
import type { ChartRegime, PublicScreeningCandidateInput } from "@/types/screening";
import { buildAdvancedStrategyReviewsForCandidate } from "./advancedStrategyReviews";

describe("advanced strategy reviews", () => {
  it("builds wheel and combo reviews without creating draft-ready position drafts", () => {
    const reviews = buildAdvancedStrategyReviewsForCandidate(baseInput({
      chartAnalysis: chart("bullish_pullback"),
      capital: {
        availableCashUSD: 50_000,
        assignmentCapitalAvailableUSD: 50_000,
        stockShares: 100,
        stockCostBasisUSD: 95,
      },
    }));

    const wheel = reviews.find((review) => review.strategy === "wheel");
    const combo = reviews.find((review) => review.strategy === "combo");

    expect(wheel?.level).toBe("manual_review_required");
    expect(wheel?.requiredCapitalUSD).toBe(9_500);
    expect(wheel?.effectiveAcquisitionCostUSD).toBe(92);
    expect(combo?.level).toBe("manual_review_required");
    expect(combo?.netPremiumUSD).toBe(2.2);
    expect(combo?.manualReviewReasons.join(" ")).toContain("単体Call買い");
  });

  it("keeps uncovered short strangles in advanced review with naked call warning", () => {
    const reviews = buildAdvancedStrategyReviewsForCandidate(baseInput({
      chartAnalysis: chart("range_neutral"),
      capital: {
        assignmentCapitalAvailableUSD: 50_000,
        stockShares: 0,
      },
    }));

    const review = reviews.find((item) => item.strategy === "short_strangle_advanced_review");

    expect(review?.level).toBe("manual_review_required");
    expect(review?.warnings.join(" ")).toContain("naked_call_risk");
    expect(review?.missingFields).toContain("capital.stockShares");
  });

  it("creates covered short strangle review when stock cover and put capital are present", () => {
    const reviews = buildAdvancedStrategyReviewsForCandidate(baseInput({
      chartAnalysis: chart("range_neutral"),
      capital: {
        assignmentCapitalAvailableUSD: 50_000,
        stockShares: 100,
      },
    }));

    const review = reviews.find((item) => item.strategy === "short_strangle_covered");

    expect(review?.level).toBe("manual_review_required");
    expect(review?.netPremiumUSD).toBe(3.7);
    expect(review?.stockEquivalentNotionalUSD).toBe(20_000);
  });

  it("calculates ITM short put effective acquisition cost and avoids insufficient capital", () => {
    const reviews = buildAdvancedStrategyReviewsForCandidate(baseInput({
      chartAnalysis: chart("bullish_pullback"),
      capital: {
        assignmentCapitalAvailableUSD: 5_000,
      },
    }));

    const review = reviews.find((item) => item.strategy === "itm_short_put_buy_to_own");

    expect(review?.level).toBe("avoid");
    expect(review?.requiredCapitalUSD).toBe(10_000);
    expect(review?.effectiveAcquisitionCostUSD).toBe(95.9);
    expect(review?.warnings.join(" ")).toContain("資金が不足");
  });

  it("calculates event straddle break evens and max loss", () => {
    const reviews = buildAdvancedStrategyReviewsForCandidate(baseInput({
      chartAnalysis: chart("event_large_move_unknown"),
      event: {
        earningsDate: "2026-07-20",
        expectedMovePct: 8,
      },
    }));

    const review = reviews.find((item) => item.strategy === "long_straddle_event");

    expect(review?.level).toBe("manual_review_required");
    expect(review?.netPremiumUSD).toBe(8.5);
    expect(review?.maxLossUSD).toBe(850);
    expect(review?.breakEvenUpperUSD).toBe(108.5);
    expect(review?.breakEvenLowerUSD).toBe(91.5);
  });

  it("does not treat protective collar as a main candidate without existing stock", () => {
    const reviews = buildAdvancedStrategyReviewsForCandidate(baseInput({
      chartAnalysis: chart("bearish_breakdown"),
      capital: {
        stockShares: 0,
      },
    }));

    const review = reviews.find((item) => item.strategy === "protective_collar");

    expect(review?.level).toBe("avoid");
    expect(review?.missingFields).toContain("existingPosition.stockShares");
  });
});

function baseInput(overrides: Partial<PublicScreeningCandidateInput> = {}): PublicScreeningCandidateInput {
  return {
    symbol: "MSFT",
    underlyingPrice: 100,
    optionCandidates: [
      option("put-95", "put", 95, 3, 3.2, 45),
      option("call-103", "call", 103, 1.7, 2, 21),
      option("put-97", "put", 97, 2, 2.2, 21),
      option("call-102", "call", 102, 5, 5.5, 180),
      option("put-90", "put", 90, 2, 2.4, 180),
      option("put-105", "put", 105, 6, 6.2, 45),
      option("call-100", "call", 100, 4, 4.2, 30),
      option("put-100", "put", 100, 4.1, 4.3, 30),
    ],
    ...overrides,
  };
}

function option(id: string, optionType: "call" | "put", strike: number, bid: number, ask: number, dte: number) {
  return {
    id,
    optionType,
    expiry: dte <= 30 ? "2026-08-21" : dte < 100 ? "2026-09-18" : "2027-01-15",
    dte,
    strike,
    bid,
    ask,
    mid: (bid + ask) / 2,
    last: (bid + ask) / 2,
    volume: 100,
    openInterest: 500,
    iv: 0.35,
    delta: optionType === "call" ? 0.45 : -0.35,
  };
}

function chart(regime: ChartRegime): NonNullable<PublicScreeningCandidateInput["chartAnalysis"]> {
  return {
    regime,
    confidence: "medium",
    primaryTimeframe: "daily",
    timeframes: [],
    reasons: ["manual chart"],
    warnings: [],
    missingFields: [],
  };
}
