import { describe, expect, it } from "vitest";
import type { ScreeningCandidate, SyntheticForwardLeg } from "@/types/screening";
import {
  buildSyntheticForwardReviewPayload,
  evaluateSyntheticForwardCandidate,
  findSyntheticForwardLegPairs,
  syntheticForwardDisplayName,
  validateSyntheticForwardReadiness,
} from "./syntheticForward";

const generatedAt = "2026-06-23T10:00:00+09:00";

function baseCandidate(overrides: Partial<ScreeningCandidate> = {}): ScreeningCandidate {
  return {
    symbol: "NVDA",
    name: "NVIDIA",
    market: "US",
    sector: "Technology",
    underlyingPrice: 100,
    priceAsOf: generatedAt,
    dataSource: "manual",
    delayStatus: "delayed",
    technicalSnapshot: {
      dailyClose: 102,
      sma25: 96,
      sma50: 95,
      sma200: 82,
      macdSignal: "golden_cross",
      slowKdSignal: "golden_cross",
      trendNotes: [],
      movingAverageSlopes: {
        ma25: "up",
        ma50: "up",
        ma200: "flat",
      },
      patternCandidates: [
        {
          kind: "upside_reversal_combo",
          fitLevel: "fit",
          signalOrder: ["slowkd_golden_cross", "macd_golden_cross", "ma25_50_golden_cross"],
          reasons: ["fixture"],
          warnings: [],
          missingFields: [],
          suggestedStrategyKinds: ["long_call", "cash_secured_put_buy_to_own", "combo"],
          detectedAt: generatedAt,
          timing: {
            movingAverageSlopes: {
              ma25: "up",
              ma50: "up",
              ma200: "flat",
            },
            priceLocation: {
              aboveMa25: true,
              aboveMa50: true,
            },
            optionComboReadiness: {
              modes: ["school_same_expiry", "practical_split_expiry"],
              notes: [],
            },
            timingNotes: [],
          },
        },
      ],
    },
    optionChainQuality: {
      hasOptionChain: true,
      expirationCount: 8,
      targetDteAvailable: true,
      bidAskSpreadRate: 0.08,
      volume: 500,
      openInterest: 3000,
      iv: 0.42,
      qualityWarnings: [],
    },
    candidateStrategies: [],
    riskFlags: [],
    missingFields: [],
    ...overrides,
  };
}

function longCall(overrides: Partial<SyntheticForwardLeg> = {}): SyntheticForwardLeg {
  return {
    type: "long_call",
    expiry: "2026-08-21",
    dte: 60,
    strikePrice: 102,
    bid: 6.2,
    ask: 6.6,
    mid: 6.4,
    volume: 500,
    openInterest: 4000,
    iv: 0.4,
    delta: 0.52,
    ...overrides,
  };
}

function shortPut(overrides: Partial<SyntheticForwardLeg> = {}): SyntheticForwardLeg {
  return {
    type: "short_put",
    expiry: "2026-08-21",
    dte: 60,
    strikePrice: 102,
    bid: 5.8,
    ask: 6.1,
    mid: 5.95,
    volume: 450,
    openInterest: 3800,
    iv: 0.41,
    delta: -0.48,
    ...overrides,
  };
}

describe("synthetic forward candidate core", () => {
  it("uses the expected public display label", () => {
    expect(syntheticForwardDisplayName).toBe("シンセティックフォワード候補");
  });

  it("finds same-expiry near-strike leg pairs", () => {
    const pairs = findSyntheticForwardLegPairs({
      underlyingPrice: 100,
      callLegs: [longCall(), longCall({ expiry: "2026-09-18", strikePrice: 110 })],
      putLegs: [shortPut(), shortPut({ expiry: "2026-09-18", strikePrice: 90 })],
    });

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      kind: "synthetic_forward",
      expiry: "2026-08-21",
      strike: 102,
    });
  });

  it("fits when same expiry, same strike, capital, liquidity, and directional conditions are aligned", () => {
    const result = evaluateSyntheticForwardCandidate({
      candidate: baseCandidate(),
      longCallLeg: longCall(),
      shortPutLeg: shortPut(),
      assignmentCapitalAvailable: 15000,
      longTermHoldEligible: true,
    });

    expect(result.fitLevel).toBe("fit");
    expect(result.kind).toBe("synthetic_forward");
    expect(result.netPremium).toBeCloseTo(0.8);
    expect(result.breakEvenPrice).toBeCloseTo(102.8);
    expect(result.assignmentCapitalRequired).toBe(10200);
    expect(result.syntheticDelta).toBeCloseTo(1);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.missingFields).toEqual([]);
  });

  it("watches when directional conditions exist but liquidity needs attention", () => {
    const result = evaluateSyntheticForwardCandidate({
      candidate: baseCandidate(),
      longCallLeg: longCall({ bid: 5, ask: 6.3, mid: 5.65, volume: 30, openInterest: 80 }),
      shortPutLeg: shortPut(),
      assignmentCapitalAvailable: 15000,
      longTermHoldEligible: true,
    });

    expect(result.fitLevel).toBe("watch");
    expect(result.riskFlags).toContain("liquidity_attention");
    expect(result.warnings).toContain("流動性注意です。");
  });

  it("watches or avoids when directional conditions are weak", () => {
    const result = evaluateSyntheticForwardCandidate({
      candidate: baseCandidate({
        technicalSnapshot: {
          ...baseCandidate().technicalSnapshot,
          dailyClose: 92,
          macdSignal: "neutral",
          slowKdSignal: "neutral",
          patternCandidates: [],
          movingAverageSlopes: {
            ma25: "flat",
            ma50: "flat",
            ma200: "flat",
          },
        },
      }),
      longCallLeg: longCall(),
      shortPutLeg: shortPut(),
      assignmentCapitalAvailable: 15000,
      longTermHoldEligible: true,
    });

    expect(["watch", "avoid"]).toContain(result.fitLevel);
    expect(result.riskFlags).toContain("directional_bias_weak");
  });

  it("avoids when assignment capital is insufficient", () => {
    const result = evaluateSyntheticForwardCandidate({
      candidate: baseCandidate(),
      longCallLeg: longCall(),
      shortPutLeg: shortPut(),
      assignmentCapitalAvailable: 5000,
      longTermHoldEligible: true,
    });

    expect(result.fitLevel).toBe("avoid");
    expect(result.riskFlags).toContain("assignment_capital_shortage");
  });

  it("avoids when the 100-share acquisition premise is not acceptable", () => {
    const result = evaluateSyntheticForwardCandidate({
      candidate: baseCandidate(),
      longCallLeg: longCall(),
      shortPutLeg: shortPut(),
      assignmentCapitalAvailable: 15000,
      longTermHoldEligible: false,
    });

    expect(result.fitLevel).toBe("avoid");
    expect(result.riskFlags).toContain("long_term_hold_not_eligible");
  });

  it("returns insufficient data when same-expiry legs are not available", () => {
    const result = evaluateSyntheticForwardCandidate({
      candidate: baseCandidate(),
      longCallLeg: longCall(),
      shortPutLeg: shortPut({ expiry: "2026-09-18" }),
      assignmentCapitalAvailable: 15000,
      longTermHoldEligible: true,
    });

    expect(result.fitLevel).toBe("insufficient_data");
    expect(result.missingFields).toContain("syntheticForward.sameExpiry");
  });

  it("adds long_put_risk_window warning for longer DTE candidates", () => {
    const readiness = validateSyntheticForwardReadiness({
      candidate: baseCandidate(),
      longCallLeg: longCall({ expiry: "2026-12-18", dte: 170 }),
      shortPutLeg: shortPut({ expiry: "2026-12-18", dte: 170 }),
      assignmentCapitalAvailable: 15000,
      longTermHoldEligible: true,
    });

    expect(readiness.riskFlags).toContain("long_put_risk_window");
    expect(readiness.warnings).toContain("long_put_risk_window: P売りのリスク期間が長めです。");
  });

  it("builds an external review payload without credentials, account numbers, or local paths", () => {
    const payload = buildSyntheticForwardReviewPayload({
      candidate: {
        ...baseCandidate({
          technicalSnapshot: {
            ...baseCandidate().technicalSnapshot,
            trendNotes: ["source file /Users/motomichi/private.csv"],
          },
        }),
        accountNumber: "123456789",
        localPath: "/Users/motomichi/private.json",
        refreshToken: "secret-refresh-token",
      } as unknown as ScreeningCandidate,
      longCallLeg: longCall(),
      shortPutLeg: shortPut(),
      assignmentCapitalAvailable: 15000,
      longTermHoldEligible: true,
      generatedAt,
      appVersion: "0.1.0",
      userStrategyAssumptions: ["同一満期と資金確認を前提に確認する"],
    });

    const serialized = JSON.stringify(payload);
    expect(payload.strategyFitResults[0].strategy).toBe("synthetic_forward");
    expect(payload.syntheticForwardCandidates?.[0].kind).toBe("synthetic_forward");
    expect(serialized).not.toContain("123456789");
    expect(serialized).not.toContain("secret-refresh-token");
    expect(serialized).not.toContain("/Users/");
    expect(serialized).toContain("[removed-local-path]");
  });
});
