import { describe, expect, it } from "vitest";
import type { ScreeningCandidate, TechnicalSignalEvent } from "@/types/screening";
import {
  buildUpsideReversalComboPattern,
  buildUpsideReversalComboReviewPayload,
  evaluateUpsideReversalComboTiming,
  upsideReversalComboDisplayName,
  validateUpsideReversalComboReadiness,
} from "./technicalPatterns";

const detectedAt = "2026-06-23T09:00:00+09:00";

function signalEvents(overrides: TechnicalSignalEvent[] = []): TechnicalSignalEvent[] {
  return overrides.length > 0
    ? overrides
    : [
        {
          type: "slowkd_golden_cross",
          occurredAt: "2026-06-03",
          lookbackTradingDays: 12,
          strength: "normal",
        },
        {
          type: "macd_golden_cross",
          occurredAt: "2026-06-07",
          lookbackTradingDays: 8,
          strength: "normal",
        },
        {
          type: "ma25_50_golden_cross",
          occurredAt: "2026-06-12",
          lookbackTradingDays: 3,
          strength: "normal",
        },
      ];
}

function baseCandidate(overrides: Partial<ScreeningCandidate> = {}): ScreeningCandidate {
  return {
    symbol: "NVDA",
    name: "NVIDIA",
    market: "US",
    sector: "Technology",
    underlyingPrice: 100,
    priceAsOf: "2026-06-23T09:00:00+09:00",
    dataSource: "manual",
    delayStatus: "delayed",
    technicalSnapshot: {
      dailyClose: 102,
      sma5: 101,
      sma10: 100,
      sma25: 96,
      sma50: 95,
      sma75: 91,
      sma100: 89,
      sma200: 82,
      weeklySma13: 88,
      weeklySma26: 84,
      weeklySma52: 76,
      macdSignal: "golden_cross",
      slowKdSignal: "golden_cross",
      rsi: 58,
      trendNotes: [],
      signalEvents: signalEvents(),
      movingAverageSlopes: {
        ma25: "up",
        ma50: "up",
        ma200: "flat",
      },
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
    candidateStrategies: [
      {
        strategy: "long_call",
        dte: 160,
        strikePrice: 103,
        premium: 8,
      },
      {
        strategy: "cash_secured_put_buy_to_own",
        dte: 45,
        strikePrice: 95,
        longTermHoldEligible: true,
        assignmentCapitalRequired: 9500,
        availableCash: 12000,
      },
    ],
    riskFlags: [],
    missingFields: [],
    ...overrides,
  };
}

describe("upside reversal combo timing", () => {
  it("uses the expected public display label", () => {
    expect(upsideReversalComboDisplayName).toBe("上昇転換コンボ候補");
  });

  it("fits when SlowKD, MACD, and MA signals are ordered and trend/readiness are aligned", () => {
    const result = evaluateUpsideReversalComboTiming({
      candidate: baseCandidate(),
      detectedAt,
    });

    expect(result.fitLevel).toBe("fit");
    expect(result.kind).toBe("upside_reversal_combo");
    expect(result.signalOrder).toEqual(["slowkd_golden_cross", "macd_golden_cross", "ma25_50_golden_cross"]);
    expect(result.timing.optionComboReadiness.modes).toEqual(["school_same_expiry", "practical_split_expiry"]);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
    expect(result.missingFields).toEqual([]);
  });

  it("watches when SlowKD and MACD are present but the 25/50 day averages are still far apart", () => {
    const result = evaluateUpsideReversalComboTiming({
      candidate: baseCandidate({
        technicalSnapshot: {
          ...baseCandidate().technicalSnapshot,
          sma25: 90,
          sma50: 100,
          signalEvents: signalEvents([
            {
              type: "slowkd_golden_cross",
              occurredAt: "2026-06-03",
              lookbackTradingDays: 12,
              strength: "normal",
            },
            {
              type: "macd_golden_cross",
              occurredAt: "2026-06-07",
              lookbackTradingDays: 8,
              strength: "normal",
            },
          ]),
        },
      }),
      detectedAt,
    });

    expect(result.fitLevel).toBe("watch");
    expect(result.warnings).toContain("25日線と50日線はまだ接近していません。");
  });

  it("avoids when the 50 day average is down", () => {
    const result = evaluateUpsideReversalComboTiming({
      candidate: baseCandidate({
        technicalSnapshot: {
          ...baseCandidate().technicalSnapshot,
          movingAverageSlopes: {
            ma25: "up",
            ma50: "down",
            ma200: "flat",
          },
        },
      }),
      detectedAt,
    });

    expect(result.fitLevel).toBe("avoid");
    expect(result.warnings).toContain("50日線が下向きです。");
  });

  it("watches when price is below the 25 day or 50 day averages", () => {
    const result = evaluateUpsideReversalComboTiming({
      candidate: baseCandidate({
        technicalSnapshot: {
          ...baseCandidate().technicalSnapshot,
          dailyClose: 93,
        },
      }),
      detectedAt,
    });

    expect(result.fitLevel).toBe("watch");
    expect(result.warnings).toContain("株価が25日線または50日線を下回っています。");
  });

  it("returns insufficient data when option chain data is unavailable", () => {
    const result = evaluateUpsideReversalComboTiming({
      candidate: baseCandidate({
        optionChainQuality: {
          hasOptionChain: false,
          qualityWarnings: ["no chain"],
        },
      }),
      detectedAt,
    });

    expect(result.fitLevel).toBe("insufficient_data");
    expect(result.missingFields).toContain("optionChainQuality.hasOptionChain");
  });

  it("avoids when the 100 share acquisition premise is not acceptable", () => {
    const result = evaluateUpsideReversalComboTiming({
      candidate: baseCandidate({
        candidateStrategies: [
          baseCandidate().candidateStrategies[0],
          {
            strategy: "cash_secured_put_buy_to_own",
            dte: 45,
            strikePrice: 95,
            longTermHoldEligible: false,
            assignmentCapitalRequired: 9500,
            availableCash: 12000,
          },
        ],
      }),
      detectedAt,
    });

    expect(result.fitLevel).toBe("avoid");
    expect(result.warnings).toContain("100株取得前提にできない銘柄です。");
  });

  it("avoids when put assignment capital is insufficient", () => {
    const result = evaluateUpsideReversalComboTiming({
      candidate: baseCandidate({
        candidateStrategies: [
          baseCandidate().candidateStrategies[0],
          {
            strategy: "cash_secured_put_buy_to_own",
            dte: 45,
            strikePrice: 95,
            longTermHoldEligible: true,
            assignmentCapitalRequired: 9500,
            availableCash: 5000,
          },
        ],
      }),
      detectedAt,
    });

    expect(result.fitLevel).toBe("avoid");
    expect(result.warnings).toContain("P売り権利行使時の資金が不足しています。");
  });

  it("preserves school same expiry and practical split expiry modes", () => {
    const readiness = validateUpsideReversalComboReadiness({
      candidate: baseCandidate(),
      comboModes: ["school_same_expiry", "practical_split_expiry"],
    });
    const pattern = buildUpsideReversalComboPattern({
      candidate: baseCandidate(),
      detectedAt,
      comboModes: ["school_same_expiry", "practical_split_expiry"],
    });

    expect(readiness.readiness.modes).toEqual(["school_same_expiry", "practical_split_expiry"]);
    expect(pattern.timing.optionComboReadiness.modes).toEqual(["school_same_expiry", "practical_split_expiry"]);
  });

  it("builds an external review payload without credentials, account numbers, or local paths", () => {
    const payload = buildUpsideReversalComboReviewPayload({
      candidate: {
        ...baseCandidate(),
        technicalSnapshot: {
          ...baseCandidate().technicalSnapshot,
          trendNotes: ["source file /Users/motomichi/private.csv"],
        },
        accountNumber: "123456789",
        localPath: "/Users/motomichi/private.json",
        refreshToken: "secret-refresh-token",
      } as unknown as ScreeningCandidate,
      detectedAt,
      appVersion: "0.1.0",
      userStrategyAssumptions: ["反対売買決済を前提に確認する"],
    });

    const serialized = JSON.stringify(payload);
    expect(payload.technicalTimingPatterns?.[0].kind).toBe("upside_reversal_combo");
    expect(payload.strategyFitResults.map((result) => result.strategy)).toEqual(["long_call", "cash_secured_put_buy_to_own"]);
    expect(serialized).not.toContain("123456789");
    expect(serialized).not.toContain("secret-refresh-token");
    expect(serialized).not.toContain("/Users/");
    expect(serialized).toContain("[removed-local-path]");
  });
});
