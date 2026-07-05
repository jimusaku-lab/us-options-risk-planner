import { describe, expect, it } from "vitest";
import type { PublicScreeningCandidateInput } from "@/types/screening";
import { detectScreeningCompleteness } from "./screeningCompleteness";

const baseCandidate: PublicScreeningCandidateInput = {
  symbol: "MSFT",
  market: "US",
  underlyingPrice: 500,
  priceAsOf: "2026-07-04T09:00:00+09:00",
  technicalSnapshot: {
    dailyClose: 500,
    sma25: 490,
    trendNotes: ["manual technical note"],
  },
};

describe("screening completeness", () => {
  it("detects Level 1 with symbol and price even when chart data is still missing", () => {
    const result = detectScreeningCompleteness({
      symbol: "MSFT",
      underlyingPrice: 500,
      priceAsOf: "2026-07-04T09:00:00+09:00",
    });

    expect(result).toMatchObject({
      level: "level_1_symbol_price",
      canClassifyStrategy: true,
      canAnalyzeChart: false,
      canEvaluateOptionLiquidity: false,
      canCreatePositionDraft: false,
    });
    expect(result.missingFields).toContain("technicalSnapshot.minimum");
    expect(result.missingFields).toContain("chartAnalysis.orDailyOhlcv");
  });

  it("keeps minimum technical data at Level 1 until chart-ready data is present", () => {
    const result = detectScreeningCompleteness(baseCandidate);

    expect(result).toMatchObject({
      level: "level_1_symbol_price",
      canClassifyStrategy: true,
      canAnalyzeChart: false,
      canEvaluateOptionLiquidity: false,
      canCreatePositionDraft: false,
    });
    expect(result.missingFields).toContain("chartAnalysis.orDailyOhlcv");
  });

  it("detects Level 2 when chart analysis or enough technical snapshot is available", () => {
    const result = detectScreeningCompleteness({
      ...baseCandidate,
      technicalSnapshot: {
        dailyClose: 500,
        sma25: 490,
        sma50: 470,
        sma200: 420,
        macdSignal: "bullish",
        trendNotes: [],
      },
    });

    expect(result.level).toBe("level_2_chart_ready");
    expect(result.canAnalyzeChart).toBe(true);
  });

  it("detects Level 3 only when option bid ask liquidity and IV are present", () => {
    const level3 = detectScreeningCompleteness({
      ...level2Candidate(),
      optionCandidates: [
        {
          optionType: "call",
          expiry: "2026-12-18",
          strike: 520,
          bid: 20,
          ask: 21,
          volume: 100,
          openInterest: 1200,
          iv: 0.32,
        },
      ],
    });
    const missingBidAsk = detectScreeningCompleteness({
      ...level2Candidate(),
      optionCandidates: [
        {
          optionType: "call",
          expiry: "2026-12-18",
          strike: 520,
          last: 20.5,
          volume: 100,
          openInterest: 1200,
          iv: 0.32,
        },
      ],
    });

    expect(level3.level).toBe("level_3_option_ready");
    expect(level3.canEvaluateOptionLiquidity).toBe(true);
    expect(missingBidAsk.level).toBe("level_2_chart_ready");
    expect(missingBidAsk.missingFields).toContain("optionCandidates.bidAsk");
  });

  it("detects Level 4 when capital and risk budget are available", () => {
    const result = detectScreeningCompleteness({
      ...level2Candidate(),
      optionCandidates: [
        {
          optionType: "put",
          expiry: "2026-09-18",
          strike: 470,
          bid: 12,
          ask: 13,
          volume: 80,
          openInterest: 900,
          iv: 0.28,
        },
      ],
      capital: {
        availableCashUSD: 60_000,
        maxLossToleranceUSD: 2_000,
      },
    });

    expect(result.level).toBe("level_4_draft_ready");
    expect(result.canCreatePositionDraft).toBe(true);
  });

  it("does not detect Level 4 without capital information", () => {
    const result = detectScreeningCompleteness({
      ...level2Candidate(),
      optionCandidates: [
        {
          optionType: "put",
          expiry: "2026-09-18",
          strike: 470,
          bid: 12,
          ask: 13,
          volume: 80,
          openInterest: 900,
          iv: 0.28,
        },
      ],
    });

    expect(result.level).toBe("level_3_option_ready");
    expect(result.canCreatePositionDraft).toBe(false);
    expect(result.missingFields).toContain("capital.availableCashOrRiskBudget");
  });
});

function level2Candidate(): PublicScreeningCandidateInput {
  return {
    ...baseCandidate,
    chartAnalysis: {
      asOf: "2026-07-04T09:00:00+09:00",
      regime: "bullish_continuation",
      confidence: "medium",
      primaryTimeframe: "daily",
      timeframes: [],
      reasons: ["manual chart review"],
      warnings: [],
      missingFields: [],
    },
  };
}
