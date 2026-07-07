import { describe, expect, it } from "vitest";
import type { ChartAnalysisSnapshot, ChartRegime, ScreeningCandidate, StrategyCandidateInput } from "@/types/screening";
import {
  applyChartGateToStrategyFit,
  evaluateCandidateStrategySuitabilities,
  rankStrategySuitabilities,
} from "./strategySuitability";
import { evaluateStrategyFit } from "./screeningRules";

describe("strategy suitability integration", () => {
  it("keeps insufficient base fit as insufficient data", () => {
    const candidate = baseCandidate({
      optionChainQuality: {
        hasOptionChain: false,
        qualityWarnings: ["no chain"],
      },
    });
    const strategy = longCall();
    const suitability = applyChartGateToStrategyFit(strategy, evaluateStrategyFit(candidate, strategy), chart("bullish_continuation"));

    expect(suitability.level).toBe("insufficient_data");
    expect(suitability.missingFields).toContain("optionChainQuality.hasOptionChain");
  });

  it("keeps avoid base fit as avoid even when chart is strong", () => {
    const candidate = baseCandidate();
    const strategy: StrategyCandidateInput = {
      strategy: "covered_call",
      dte: 45,
      strikePrice: 104,
      stockShares: 0,
    };
    const suitability = applyChartGateToStrategyFit(strategy, evaluateStrategyFit(candidate, strategy), chart("bullish_continuation"));

    expect(suitability.level).toBe("avoid");
    expect(suitability.warnings.join(" ")).toContain("裸コール");
  });

  it("does not return fit when chart analysis is missing", () => {
    const candidate = baseCandidate();
    const strategy = longCall();
    const suitability = applyChartGateToStrategyFit(strategy, evaluateStrategyFit(candidate, strategy));

    expect(suitability.level).toBe("watch");
    expect(suitability.missingFields).toContain("chartAnalysis");
  });

  it("classifies upside reversal for long call and buy-to-own put candidates", () => {
    const results = evaluateCandidateStrategySuitabilities({
      candidate: baseCandidate(),
      chartAnalysis: chart("upside_reversal", "medium"),
    });

    expect(levelFor(results, "long_call")).toMatch(/fit|watch/);
    expect(levelFor(results, "cash_secured_put_buy_to_own")).toMatch(/fit|watch/);
  });

  it("ranks buy-to-own put high during bullish pullback", () => {
    const results = evaluateCandidateStrategySuitabilities({
      candidate: baseCandidate(),
      chartAnalysis: chart("bullish_pullback", "medium"),
    });

    expect(levelFor(results, "cash_secured_put_buy_to_own")).toBe("fit");
    expect(levelFor(results, "long_call")).toMatch(/fit|watch/);
    expect(results[0].strategy).toBe("cash_secured_put_buy_to_own");
  });

  it("keeps range neutral favorable for covered call and far put while long call stays watch or lower", () => {
    const results = evaluateCandidateStrategySuitabilities({
      candidate: baseCandidate(),
      chartAnalysis: chart("range_neutral", "medium"),
      capital: { saxoRequiredMarginUSD: 2_000, saxoMarginAvailableUSD: 3_000, cashBalanceUSD: 5_000 },
    });

    expect(["fit", "watch"]).toContain(levelFor(results, "covered_call"));
    expect(["fit", "watch"]).toContain(levelFor(results, "cash_secured_put_avoid_assignment"));
    expect(["watch", "manual_review_required", "insufficient_data", "avoid"]).toContain(levelFor(results, "long_call"));
  });

  it("does not mark buy-to-own put as fit when assignment purchase cash is missing", () => {
    const candidate = baseCandidate({
      candidateStrategies: [
        {
          strategy: "cash_secured_put_buy_to_own",
          dte: 45,
          strikePrice: 95,
          longTermHoldEligible: true,
          coveredCallTransitionPossible: true,
        },
      ],
    });
    const results = evaluateCandidateStrategySuitabilities({
      candidate,
      chartAnalysis: chart("bullish_pullback", "medium"),
    });

    expect(results[0].level).toBe("manual_review_required");
    expect(results[0].missingFields).toContain("capital.assignmentCapitalAvailableUSD");
    expect(results[0].warnings.join(" ")).toContain("現物株購入代金確認待ち");
  });

  it("blocks buy-to-own put when assignment purchase cash is insufficient", () => {
    const candidate = baseCandidate({
      candidateStrategies: [
        {
          strategy: "cash_secured_put_buy_to_own",
          dte: 45,
          strikePrice: 95,
          longTermHoldEligible: true,
          coveredCallTransitionPossible: true,
          assignmentCapitalRequired: 9_500,
        },
      ],
    });
    const results = evaluateCandidateStrategySuitabilities({
      candidate,
      chartAnalysis: chart("bullish_pullback", "medium"),
      capital: { assignmentCapitalAvailableUSD: 8_000 },
    });

    expect(results[0].level).toBe("avoid");
    expect(results[0].warnings.join(" ")).toContain("必要資金が不足");
  });

  it("does not mark covered call as fit without same-account stock shares", () => {
    const candidate = baseCandidate({
      candidateStrategies: [
        {
          strategy: "covered_call",
          dte: 45,
          strikePrice: 104,
          stockCostBasis: 90,
        },
      ],
    });
    const results = evaluateCandidateStrategySuitabilities({
      candidate,
      chartAnalysis: chart("range_neutral", "medium"),
    });

    expect(results[0].level).toBe("insufficient_data");
    expect(results[0].missingFields).toContain("stockShares");
  });

  it("uses capital stock shares as the covered call same-account gate", () => {
    const candidate = baseCandidate({
      candidateStrategies: [
        {
          strategy: "covered_call",
          dte: 45,
          strikePrice: 104,
          stockCostBasis: 90,
        },
      ],
    });
    const results = evaluateCandidateStrategySuitabilities({
      candidate,
      chartAnalysis: chart("range_neutral", "medium"),
      capital: { stockShares: 100, stockCostBasisUSD: 90 },
    });

    expect(results[0].level).toBe("fit");
  });

  it("keeps avoid-assignment put at margin confirmation wait when Saxo margin data is missing", () => {
    const candidate = baseCandidate({
      candidateStrategies: [
        {
          strategy: "cash_secured_put_avoid_assignment",
          dte: 45,
          strikePrice: 70,
          profitTakeRuleSet: true,
          stopLossRuleSet: true,
          latestCloseDateSet: true,
        },
      ],
    });
    const results = evaluateCandidateStrategySuitabilities({
      candidate,
      chartAnalysis: chart("range_neutral", "medium"),
    });

    expect(results[0].level).toBe("manual_review_required");
    expect(results[0].warnings.join(" ")).toContain("証拠金確認待ち");
    expect(results[0].missingFields).toEqual(expect.arrayContaining(["capital.saxoRequiredMarginUSD", "capital.saxoMarginAvailableUSD", "capital.cashBalanceUSD"]));
  });

  it("blocks avoid-assignment put when Saxo margin cash coverage is below 2x", () => {
    const candidate = baseCandidate({
      candidateStrategies: [
        {
          strategy: "cash_secured_put_avoid_assignment",
          dte: 45,
          strikePrice: 70,
          profitTakeRuleSet: true,
          stopLossRuleSet: true,
          latestCloseDateSet: true,
        },
      ],
    });
    const results = evaluateCandidateStrategySuitabilities({
      candidate,
      chartAnalysis: chart("range_neutral", "medium"),
      capital: { saxoRequiredMarginUSD: 2_000, saxoMarginAvailableUSD: 3_000, cashBalanceUSD: 3_500 },
    });

    expect(results[0].level).toBe("avoid");
    expect(results[0].warnings.join(" ")).toContain("2倍未満");
  });

  it("blocks downtrend for long call and avoid-assignment put", () => {
    const results = evaluateCandidateStrategySuitabilities({
      candidate: baseCandidate(),
      chartAnalysis: chart("downtrend", "medium"),
    });

    expect(levelFor(results, "long_call")).toBe("avoid");
    expect(levelFor(results, "cash_secured_put_avoid_assignment")).toBe("avoid");
    expect(["watch", "avoid"]).toContain(levelFor(results, "cash_secured_put_buy_to_own"));
  });

  it("marks event large move unknown as manual review or watch", () => {
    const results = evaluateCandidateStrategySuitabilities({
      candidate: baseCandidate(),
      chartAnalysis: chart("event_large_move_unknown", "low"),
    });

    for (const result of results) {
      expect(["watch", "manual_review_required"]).toContain(result.level);
      expect(result.level).not.toBe("fit");
    }
  });

  it("keeps covered call strike below cost basis as watch with warning", () => {
    const candidate = baseCandidate({
      candidateStrategies: [
        {
          strategy: "covered_call",
          dte: 45,
          strikePrice: 104,
          stockShares: 100,
          stockCostBasis: 110,
        },
      ],
    });
    const results = evaluateCandidateStrategySuitabilities({
      candidate,
      chartAnalysis: chart("range_neutral", "medium"),
    });

    expect(results[0].level).toBe("watch");
    expect(results[0].warnings.join(" ")).toContain("取得単価");
  });

  it("keeps avoid-assignment puts at watch when exit rules are missing", () => {
    const candidate = baseCandidate({
      candidateStrategies: [
        {
          strategy: "cash_secured_put_avoid_assignment",
          dte: 45,
          strikePrice: 70,
          profitTakeRuleSet: false,
          stopLossRuleSet: false,
          latestCloseDateSet: false,
        },
      ],
    });
    const results = evaluateCandidateStrategySuitabilities({
      candidate,
      chartAnalysis: chart("range_neutral", "medium"),
      capital: { saxoRequiredMarginUSD: 2_000, saxoMarginAvailableUSD: 3_000, cashBalanceUSD: 5_000 },
    });

    expect(results[0].level).toBe("watch");
    expect(results[0].missingFields).toEqual(expect.arrayContaining(["profit-take-rule", "stop-loss-rule", "latest-close-date"]));
  });

  it("ranks by level confidence and data quality without changing result contents", () => {
    const ranked = rankStrategySuitabilities([
      {
        strategy: "long_call",
        level: "watch",
        confidence: "medium",
        reasons: [],
        warnings: ["warn"],
        missingFields: [],
        nextChecks: [],
      },
      {
        strategy: "covered_call",
        level: "fit",
        confidence: "low",
        reasons: [],
        warnings: [],
        missingFields: [],
        nextChecks: [],
      },
    ]);

    expect(ranked[0].strategy).toBe("covered_call");
  });
});

function baseCandidate(overrides: Partial<ScreeningCandidate> = {}): ScreeningCandidate {
  return {
    symbol: "MSFT",
    name: "Microsoft",
    market: "US",
    underlyingPrice: 100,
    priceAsOf: "2026-07-04T09:00:00+09:00",
    dataSource: "manual",
    delayStatus: "delayed",
    technicalSnapshot: {
      dailyClose: 100,
      sma25: 96,
      sma50: 92,
      sma200: 80,
      macdSignal: "bullish",
      slowKdSignal: "bullish",
      rsi: 58,
      trendNotes: [],
    },
    optionChainQuality: {
      hasOptionChain: true,
      expirationCount: 8,
      targetDteAvailable: true,
      bidAskSpreadRate: 0.08,
      volume: 500,
      openInterest: 2_000,
      iv: 0.3,
      qualityWarnings: [],
    },
    candidateStrategies: [
      longCall(),
      {
        strategy: "cash_secured_put_buy_to_own",
        dte: 45,
        strikePrice: 95,
        longTermHoldEligible: true,
        coveredCallTransitionPossible: true,
        availableCash: 12_000,
        assignmentCapitalRequired: 9_500,
      },
      {
        strategy: "covered_call",
        dte: 45,
        strikePrice: 104,
        stockShares: 100,
        stockCostBasis: 90,
      },
      {
        strategy: "cash_secured_put_avoid_assignment",
        dte: 45,
        strikePrice: 70,
        profitTakeRuleSet: true,
        stopLossRuleSet: true,
        latestCloseDateSet: true,
      },
    ],
    riskFlags: [],
    missingFields: [],
    ...overrides,
  };
}

function longCall(): StrategyCandidateInput {
  return {
    strategy: "long_call",
    dte: 180,
    strikePrice: 103,
    premium: 8,
  };
}

function chart(regime: ChartRegime, confidence: ChartAnalysisSnapshot["confidence"] = "high"): ChartAnalysisSnapshot {
  return {
    asOf: "2026-07-04T09:00:00+09:00",
    regime,
    confidence,
    primaryTimeframe: "daily",
    timeframes: [
      {
        timeframe: "daily",
        close: 100,
        sma25: 96,
        sma50: 92,
        sma200: 80,
        macdSignal: "bullish",
        slowKdSignal: "bullish",
        movingAverageSlopes: {
          ma25: regime === "downtrend" ? "down" : "up",
          ma50: regime === "downtrend" ? "down" : "up",
          ma200: regime === "downtrend" ? "down" : "up",
        },
        priceLocation: {
          aboveMa25: regime !== "downtrend",
          aboveMa50: regime !== "downtrend",
          aboveMa200: regime !== "downtrend",
          distanceFromMa25Pct: 4,
          distanceFromMa50Pct: 8,
        },
        notes: [],
      },
      {
        timeframe: "weekly",
        close: 100,
        movingAverageSlopes: {
          ma25: regime === "downtrend" ? "down" : "up",
          ma50: regime === "downtrend" ? "down" : "up",
          ma200: regime === "downtrend" ? "down" : "up",
        },
        notes: [],
      },
    ],
    reasons: [`${regime} reason`],
    warnings: regime === "event_large_move_unknown" ? ["イベント大変動注意"] : [],
    missingFields: [],
  };
}

function levelFor(results: ReturnType<typeof evaluateCandidateStrategySuitabilities>, strategy: StrategyCandidateInput["strategy"]) {
  const result = results.find((item) => item.strategy === strategy);
  if (!result) throw new Error(`missing strategy ${strategy}`);
  return result.level;
}
