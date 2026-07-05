import { describe, expect, it } from "vitest";
import type { ChartAnalysisSnapshot, PublicOptionCandidateInput, PublicScreeningCandidateInput, StrategySuitability } from "@/types/screening";
import { buildStrategyPrecisionReviewsForCandidate } from "./strategyPrecision";

describe("strategy precision reviews", () => {
  it("does not keep weak chart long call candidates at fit", () => {
    const reviews = buildStrategyPrecisionReviewsForCandidate(candidate({
      chartAnalysis: chart({ confidence: "low" }),
      strategySuitability: [suitability("long_call", "fit")],
      optionCandidates: [call({ dte: 180, strike: 103, ask: 5.2, bid: 5, volume: 100, openInterest: 800 })],
      capital: { availableCashUSD: 2_000, maxLossToleranceUSD: 800 },
    }));
    const review = reviews.find((item) => item.strategy === "long_call")!;

    expect(review.level).not.toBe("fit");
    expect(review.chartGate.warnings.join(" ")).toContain("チャート信頼度");
  });

  it("warns when DTE and strike are outside the strategy range", () => {
    const reviews = buildStrategyPrecisionReviewsForCandidate(candidate({
      strategySuitability: [suitability("long_call", "fit")],
      optionCandidates: [call({ dte: 21, strike: 125, ask: 2, bid: 1.8, volume: 100, openInterest: 800 })],
      capital: { availableCashUSD: 2_000, maxLossToleranceUSD: 800 },
    }));
    const review = reviews.find((item) => item.strategy === "long_call")!;

    expect(review.level).toBe("manual_review_required");
    expect(review.expiryReview.warnings.join(" ")).toContain("DTE 21日");
    expect(review.strikeReview.warnings.join(" ")).toContain("権利行使価格レンジ外");
  });

  it("blocks Last-only option quotes because conservative price cannot be built", () => {
    const reviews = buildStrategyPrecisionReviewsForCandidate(candidate({
      strategySuitability: [suitability("long_call", "fit")],
      optionCandidates: [call({ dte: 180, strike: 103, bid: undefined, ask: undefined, mid: undefined, last: 5 })],
      capital: { availableCashUSD: 2_000, maxLossToleranceUSD: 800 },
    }));
    const review = reviews.find((item) => item.strategy === "long_call")!;

    expect(review.level).toBe("avoid");
    expect(review.liquidityReview.warnings.join(" ")).toContain("Lastのみ");
    expect(review.avoidReasons.join(" ")).toContain("保守価格");
  });

  it("blocks buy-to-own puts when assignment capital is short", () => {
    const reviews = buildStrategyPrecisionReviewsForCandidate(candidate({
      strategySuitability: [suitability("cash_secured_put_buy_to_own", "fit")],
      optionCandidates: [put({ dte: 45, strike: 95, bid: 2.5, ask: 2.7, volume: 100, openInterest: 800 })],
      capital: { assignmentCapitalAvailableUSD: 5_000 },
    }));
    const review = reviews.find((item) => item.strategy === "cash_secured_put_buy_to_own")!;

    expect(review.level).toBe("avoid");
    expect(review.capitalReview.warnings.join(" ")).toContain("必要資金が不足");
  });

  it("avoids covered calls below cost basis", () => {
    const reviews = buildStrategyPrecisionReviewsForCandidate(candidate({
      chartAnalysis: chart({ regime: "range_neutral", confidence: "medium" }),
      strategySuitability: [suitability("covered_call", "fit")],
      optionCandidates: [call({ dte: 45, strike: 104, bid: 2.2, ask: 2.4, volume: 100, openInterest: 800 })],
      capital: { stockShares: 100, stockCostBasisUSD: 110 },
    }));
    const review = reviews.find((item) => item.strategy === "covered_call")!;

    expect(review.level).toBe("avoid");
    expect(review.avoidReasons.join(" ")).toContain("取得単価");
  });

  it("keeps advanced strategies at manual review", () => {
    const reviews = buildStrategyPrecisionReviewsForCandidate(candidate({
      advancedStrategyReviews: [
        {
          id: "review",
          strategy: "synthetic_forward",
          level: "manual_review_required",
          symbol: "MSFT",
          legs: [],
          scenarios: ["上昇時", "下落時"],
          reasons: ["synthetic review"],
          warnings: [],
          missingFields: ["optionCandidates.shortPutSameExpiryStrike"],
          manualReviewReasons: ["同一満期・同一strikeを確認してください。"],
        },
      ],
    }));
    const review = reviews.find((item) => item.strategy === "synthetic_forward")!;

    expect(review.level).toBe("manual_review_required");
    expect(review.manualReviewReasons.join(" ")).toContain("上級戦略");
  });
});

function candidate(overrides: Partial<PublicScreeningCandidateInput> = {}): PublicScreeningCandidateInput {
  return {
    symbol: "MSFT",
    underlyingPrice: 100,
    chartAnalysis: chart(),
    ...overrides,
  };
}

function chart(overrides: Partial<ChartAnalysisSnapshot> = {}): ChartAnalysisSnapshot {
  return {
    regime: "bullish_continuation",
    confidence: "high",
    primaryTimeframe: "daily",
    timeframes: [
      {
        timeframe: "daily",
        close: 100,
        priceLocation: { distanceFromMa25Pct: 3 },
      },
      {
        timeframe: "weekly",
        close: 100,
        movingAverageSlopes: { ma50: "up" },
      },
    ],
    reasons: ["chart ok"],
    warnings: [],
    missingFields: [],
    ...overrides,
  };
}

function suitability(strategy: StrategySuitability["strategy"], level: StrategySuitability["level"]): StrategySuitability {
  return {
    strategy,
    level,
    reasons: [],
    warnings: [],
    missingFields: [],
    nextChecks: [],
  };
}

function call(overrides: Partial<PublicOptionCandidateInput> = {}): PublicOptionCandidateInput {
  return option({ optionType: "call", ...overrides });
}

function put(overrides: Partial<PublicOptionCandidateInput> = {}): PublicOptionCandidateInput {
  return option({ optionType: "put", ...overrides });
}

function option(overrides: Partial<PublicOptionCandidateInput>): PublicOptionCandidateInput {
  return {
    id: "option",
    optionType: "call",
    expiry: "2027-01-15",
    dte: 180,
    strike: 103,
    bid: 4.8,
    ask: 5.2,
    mid: 5,
    last: 5,
    volume: 100,
    openInterest: 800,
    iv: 0.32,
    delta: 0.45,
    gamma: 0.02,
    theta: -0.03,
    vega: 0.12,
    ...overrides,
  };
}
