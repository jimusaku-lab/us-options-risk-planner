import { describe, expect, it } from "vitest";
import type { ScreeningCandidate, StrategyCandidateInput, StrategyCandidateKind } from "@/types/screening";
import { evaluateStrategyFit, screeningStrategyLabels } from "./screeningRules";

function baseCandidate(overrides: Partial<ScreeningCandidate> = {}): ScreeningCandidate {
  return {
    symbol: "NVDA",
    name: "NVIDIA",
    market: "US",
    sector: "Technology",
    underlyingPrice: 100,
    priceAsOf: "2026-06-22T09:00:00+09:00",
    dataSource: "manual",
    delayStatus: "delayed",
    technicalSnapshot: {
      dailyClose: 100,
      sma5: 101,
      sma10: 99,
      sma25: 95,
      sma50: 90,
      sma200: 80,
      weeklySma13: 88,
      weeklySma26: 82,
      weeklySma52: 70,
      macdSignal: "bullish",
      slowKdSignal: "golden_cross",
      rsi: 58,
      trendNotes: [],
    },
    optionChainQuality: {
      hasOptionChain: true,
      expirationCount: 12,
      targetDteAvailable: true,
      bidAskSpreadRate: 0.08,
      volume: 1200,
      openInterest: 8000,
      iv: 0.42,
      delta: 0.35,
      gamma: 0.02,
      theta: -0.04,
      vega: 0.12,
      qualityWarnings: [],
    },
    candidateStrategies: [],
    riskFlags: [],
    missingFields: [],
    ...overrides,
  };
}

describe("screening strategy fit rules", () => {
  it("defines labels for every first-phase strategy candidate kind", () => {
    const strategyKinds: StrategyCandidateKind[] = [
      "cash_secured_put_buy_to_own",
      "cash_secured_put_avoid_assignment",
      "covered_call",
      "long_call",
      "short_strangle",
      "synthetic_forward",
      "combo",
    ];

    expect(Object.keys(screeningStrategyLabels).sort()).toEqual([...strategyKinds].sort());
  });

  it("fits buy-to-own cash secured puts at DTE 45 and strike/current 0.95", () => {
    const input: StrategyCandidateInput = {
      strategy: "cash_secured_put_buy_to_own",
      dte: 45,
      strikePrice: 95,
    };

    const result = evaluateStrategyFit(baseCandidate(), input);
    expect(result.fitLevel).toBe("fit");
    expect(result.numericChecks.every((check) => check.passed)).toBe(true);
  });

  it("watches buy-to-own cash secured puts when strike/current is too low", () => {
    const input: StrategyCandidateInput = {
      strategy: "cash_secured_put_buy_to_own",
      dte: 45,
      strikePrice: 80,
    };

    const result = evaluateStrategyFit(baseCandidate(), input);
    expect(result.fitLevel).toBe("watch");
    expect(result.numericChecks.find((check) => check.id === "strike-current-0.90-0.97")?.passed).toBe(false);
  });

  it("fits avoid-assignment cash secured puts at DTE 45 and strike/current 0.70", () => {
    const input: StrategyCandidateInput = {
      strategy: "cash_secured_put_avoid_assignment",
      dte: 45,
      strikePrice: 70,
      profitTakeRuleSet: true,
      stopLossRuleSet: true,
      latestCloseDateSet: true,
    };

    const result = evaluateStrategyFit(baseCandidate(), input);
    expect(result.fitLevel).toBe("fit");
  });

  it("reports required checks for avoid-assignment puts without exit rules", () => {
    const input: StrategyCandidateInput = {
      strategy: "cash_secured_put_avoid_assignment",
      dte: 45,
      strikePrice: 70,
      profitTakeRuleSet: false,
      stopLossRuleSet: false,
      latestCloseDateSet: false,
    };

    const result = evaluateStrategyFit(baseCandidate(), input);
    expect(result.fitLevel).toBe("watch");
    expect(result.requiredChecks.filter((check) => check.passed === false).map((check) => check.id)).toEqual([
      "profit-take-rule",
      "stop-loss-rule",
      "latest-close-date",
    ]);
  });

  it("fits covered calls with 100 covered shares and strike/current 1.04", () => {
    const input: StrategyCandidateInput = {
      strategy: "covered_call",
      dte: 45,
      strikePrice: 104,
      stockShares: 100,
      stockCostBasis: 90,
    };

    const result = evaluateStrategyFit(baseCandidate(), input);
    expect(result.fitLevel).toBe("fit");
  });

  it("avoids covered calls without 100 covered shares", () => {
    const input: StrategyCandidateInput = {
      strategy: "covered_call",
      dte: 45,
      strikePrice: 104,
      stockShares: 0,
    };

    const result = evaluateStrategyFit(baseCandidate(), input);
    expect(result.fitLevel).toBe("avoid");
    expect(result.warnings.some((warning) => warning.includes("裸コール"))).toBe(true);
  });

  it("fits long calls at DTE 160 and strike/current 1.03", () => {
    const input: StrategyCandidateInput = {
      strategy: "long_call",
      dte: 160,
      strikePrice: 103,
      premium: 8,
    };

    const result = evaluateStrategyFit(baseCandidate(), input);
    expect(result.fitLevel).toBe("fit");
  });

  it("watches long calls when DTE is too short", () => {
    const input: StrategyCandidateInput = {
      strategy: "long_call",
      dte: 60,
      strikePrice: 103,
      premium: 8,
    };

    const result = evaluateStrategyFit(baseCandidate(), input);
    expect(result.fitLevel).toBe("watch");
    expect(result.numericChecks.find((check) => check.id === "dte-150-plus")?.passed).toBe(false);
  });

  it("returns insufficient data when the option chain is missing", () => {
    const input: StrategyCandidateInput = {
      strategy: "long_call",
      dte: 160,
      strikePrice: 103,
    };

    const result = evaluateStrategyFit(
      baseCandidate({
        optionChainQuality: {
          hasOptionChain: false,
          qualityWarnings: ["no chain"],
        },
      }),
      input,
    );
    expect(result.fitLevel).toBe("insufficient_data");
    expect(result.missingFields).toContain("optionChainQuality.hasOptionChain");
  });

  it("keeps short strangle, synthetic forward, and combo as deferred review receptacles", () => {
    const deferredStrategies: StrategyCandidateKind[] = ["short_strangle", "synthetic_forward", "combo"];

    for (const strategy of deferredStrategies) {
      const result = evaluateStrategyFit(baseCandidate(), {
        strategy,
        sameAccount: undefined,
        sameExpiry: undefined,
      });

      expect(result.strategy).toBe(strategy);
      expect(result.fitLevel).toBe("watch");
      expect(result.numericChecks).toEqual([]);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.requiredChecks.map((check) => check.id)).toEqual(["same-account", "same-expiry"]);
    }
  });
});
