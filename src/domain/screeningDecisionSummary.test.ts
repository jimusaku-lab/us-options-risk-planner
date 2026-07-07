import { describe, expect, it } from "vitest";
import { buildScreeningDecisionSummary } from "./screeningDecisionSummary";
import type { CandidateSymbol } from "@/types/candidates";

describe("screening decision summary", () => {
  it("does not highlight buy-to-own put when assignment purchase capital is missing", () => {
    const summary = buildScreeningDecisionSummary(candidate({
      strategySuitability: [
        {
          strategy: "cash_secured_put_buy_to_own",
          level: "manual_review_required",
          reasons: ["押し目局面です。"],
          warnings: ["現物株購入代金確認待ちです。"],
          missingFields: ["capital.assignmentCapitalAvailableUSD"],
          manualReviewReasons: ["対象口座の資金を確認してください。"],
          nextChecks: [],
        },
      ],
    }));

    expect(summary.primaryStrategy).toBeUndefined();
    expect(summary.status).toBe("capital_needed");
    expect(summary.unconfirmedGates).toContain("割当可能資金未入力");
  });

  it("chooses long call as first candidate and explains dropped strategies", () => {
    const summary = buildScreeningDecisionSummary(candidate({
      strategySuitability: [
        {
          strategy: "long_call",
          level: "fit",
          reasons: ["上昇継続でC買いと矛盾しません。"],
          warnings: [],
          missingFields: [],
          nextChecks: [],
        },
        {
          strategy: "covered_call",
          level: "manual_review_required",
          reasons: [],
          warnings: ["現物株確認待ちです。"],
          missingFields: ["capital.stockShares"],
          manualReviewReasons: [],
          nextChecks: [],
        },
      ],
      positionDrafts: [
        {
          id: "draft",
          strategy: "long_call",
          status: "draft_ready",
          symbol: "MSFT",
          legs: [],
          requiredCapitalUSD: 500,
          maxLossUSD: 500,
          availableCashUSD: 2_000,
          warnings: [],
          missingFields: [],
        },
      ],
    }));

    expect(summary.status).toBe("draft_ready");
    expect(summary.primaryStrategy).toBe("long_call");
    expect(summary.primaryBasicTrade).toBe("C買い");
    expect(summary.droppedStrategies.map((item) => item.strategy)).toContain("covered_call");
  });

  it("keeps avoid-assignment put at margin confirmation wait when Saxo margin is missing", () => {
    const summary = buildScreeningDecisionSummary(candidate({
      strategySuitability: [
        {
          strategy: "cash_secured_put_avoid_assignment",
          level: "manual_review_required",
          reasons: ["レンジ局面です。"],
          warnings: ["証拠金確認待ちです。"],
          missingFields: ["capital.saxoRequiredMarginUSD", "capital.saxoMarginAvailableUSD", "capital.cashBalanceUSD"],
          manualReviewReasons: [],
          nextChecks: [],
        },
      ],
    }));

    expect(summary.primaryStrategy).toBeUndefined();
    expect(summary.status).toBe("margin_confirmation_needed");
    expect(summary.nextAction).toContain("Saxoの必要証拠金");
  });
});

function candidate(overrides: Partial<CandidateSymbol> = {}): CandidateSymbol {
  return {
    id: "candidate-MSFT",
    source: "manual",
    importedAt: "2026-07-07T09:00:00+09:00",
    rank: 1,
    symbol: "MSFT",
    company: "Microsoft",
    score: 80,
    suggestedUse: "screening",
    screeningCompleteness: {
      level: "level_3_option_ready",
      canClassifyStrategy: true,
      canAnalyzeChart: true,
      canEvaluateOptionLiquidity: true,
      canCreatePositionDraft: false,
      missingFields: [],
      warnings: [],
    },
    publicScreeningInput: {
      symbol: "MSFT",
      underlyingPrice: 100,
      chartAnalysis: {
        regime: "bullish_continuation",
        confidence: "high",
        primaryTimeframe: "daily",
        timeframes: [
          {
            timeframe: "daily",
            close: 100,
            macdSignal: "bullish",
            slowKdSignal: "bullish",
            priceLocation: { aboveMa25: true, aboveMa50: true, aboveMa200: true, distanceFromMa50Pct: 4 },
            supportLevels: [96],
            resistanceLevels: [105],
          },
        ],
        reasons: ["上昇継続"],
        warnings: [],
        missingFields: [],
      },
    },
    ...overrides,
  };
}
