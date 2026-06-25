import { describe, expect, it } from "vitest";
import type { ScreeningCandidate, StrategyFitResult, TechnicalTimingPattern } from "@/types/screening";
import { createExternalReviewPayload } from "./screeningReviewPayload";

function candidateWithUnsafeFields(): ScreeningCandidate {
  return {
    symbol: "NVDA",
    name: "NVIDIA",
    market: "US",
    underlyingPrice: 100,
    dataSource: "manual",
    delayStatus: "delayed",
    technicalSnapshot: {
      trendNotes: ["source file /Users/motomichi/private.csv"],
    },
    optionChainQuality: {
      hasOptionChain: true,
      qualityWarnings: [],
    },
    candidateStrategies: [],
    riskFlags: [],
    missingFields: [],
    accountNumber: "123456789",
    localPath: "/Users/motomichi/secret.json",
    refreshToken: "secret-refresh-token",
  } as unknown as ScreeningCandidate;
}

describe("screening external review payload", () => {
  it("does not include credentials, account numbers, or local paths", () => {
    const result: StrategyFitResult = {
      strategy: "long_call",
      fitLevel: "fit",
      reasons: ["コール買いのDTEと権利行使価格レンジに入っています。"],
      warnings: [],
      missingFields: [],
      requiredChecks: [],
      numericChecks: [],
    };

    const payload = createExternalReviewPayload({
      generatedAt: "2026-06-22T09:00:00+09:00",
      appVersion: "0.1.0",
      candidate: candidateWithUnsafeFields(),
      strategyFitResults: [result],
      userStrategyAssumptions: ["権利行使ではなく反対売買を前提にする"],
      dataQualityNotes: ["manual sample"],
    });

    const serialized = JSON.stringify(payload);
    expect(payload.noPersonalCredentialIncluded).toBe(true);
    expect(serialized).not.toContain("123456789");
    expect(serialized).not.toContain("secret-refresh-token");
    expect(serialized).not.toContain("/Users/");
    expect(serialized).toContain("[removed-local-path]");
  });

  it("can carry an upside reversal combo pattern placeholder without calling external review", () => {
    const pattern: TechnicalTimingPattern = {
      kind: "upside_reversal_combo",
      fitLevel: "insufficient_data",
      signalOrder: ["slowkd_golden_cross", "macd_golden_cross", "ma25_50_golden_cross"],
      reasons: [],
      warnings: ["工程3で本格判定を追加するまで、受け皿として保持します。"],
      missingFields: ["technicalSnapshot.signalEvents"],
      suggestedStrategyKinds: ["long_call", "cash_secured_put_buy_to_own", "combo"],
      detectedAt: "2026-06-22T09:00:00+09:00",
      timing: {
        movingAverageSlopes: {
          ma25: "unknown",
          ma50: "unknown",
          ma200: "unknown",
        },
        priceLocation: {},
        optionComboReadiness: {
          modes: ["school_same_expiry", "practical_split_expiry"],
          notes: [],
        },
        timingNotes: [],
      },
    };

    const payload = createExternalReviewPayload({
      generatedAt: "2026-06-22T09:00:00+09:00",
      appVersion: "0.1.0",
      candidate: candidateWithUnsafeFields(),
      strategyFitResults: [],
      technicalTimingPatterns: [pattern],
    });

    expect(payload.technicalTimingPatterns?.[0]).toMatchObject({
      kind: "upside_reversal_combo",
      fitLevel: "insufficient_data",
    });
    expect(payload.technicalTimingPatterns?.[0].timing.optionComboReadiness.modes).toEqual([
      "school_same_expiry",
      "practical_split_expiry",
    ]);
  });

  it("can carry deferred synthetic forward and combo fit results without detailed judgment", () => {
    const payload = createExternalReviewPayload({
      generatedAt: "2026-06-22T09:00:00+09:00",
      appVersion: "0.1.0",
      candidate: candidateWithUnsafeFields(),
      strategyFitResults: [
        {
          strategy: "synthetic_forward",
          fitLevel: "watch",
          reasons: [],
          warnings: ["後続工程で同一満期、必要資金、複合損失を確認します。"],
          missingFields: [],
          requiredChecks: [],
          numericChecks: [],
        },
        {
          strategy: "combo",
          fitLevel: "watch",
          reasons: [],
          warnings: ["後続工程でコール買いと買ってよいP売りの組み合わせを確認します。"],
          missingFields: [],
          requiredChecks: [],
          numericChecks: [],
        },
      ],
    });

    expect(payload.strategyFitResults.map((result) => result.strategy)).toEqual(["synthetic_forward", "combo"]);
    expect(payload.strategyFitResults.every((result) => result.fitLevel === "watch")).toBe(true);
    expect(payload.strategyFitResults.every((result) => result.numericChecks.length === 0)).toBe(true);
  });
});
