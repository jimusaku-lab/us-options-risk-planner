import { describe, expect, it } from "vitest";
import { buildScreeningComparisonItem } from "@/domain/screeningComparison";
import { evaluateCandidatePriority } from "@/domain/screeningPriority";
import type { CandidateSymbol } from "@/types/candidates";

describe("screening comparison", () => {
  it("builds comparison rows with quote, leg, capital, and review reasons", () => {
    const candidate: CandidateSymbol = {
      id: "cmp",
      source: "manual_import",
      importedAt: "2026-07-05T00:00:00.000Z",
      rank: 1,
      symbol: "CMP",
      company: "Compare Inc",
      priceUSD: 100,
      score: 90,
      suggestedUse: "test",
      screeningCompleteness: {
        level: "level_4_draft_ready",
        canAnalyzeChart: true,
        canClassifyStrategy: true,
        canEvaluateOptionLiquidity: true,
        canCreatePositionDraft: true,
        missingFields: [],
        warnings: [],
      },
      publicScreeningInput: {
        symbol: "CMP",
        underlyingPrice: 100,
        chartAnalysis: {
          regime: "bullish_continuation",
          confidence: "high",
          primaryTimeframe: "daily",
          timeframes: [],
          reasons: ["trend"],
          warnings: [],
          missingFields: [],
        },
        optionCandidates: [
          {
            id: "cmp-call",
            optionType: "call",
            expiry: "2026-12-18",
            strike: 105,
            bid: 4,
            ask: 4.4,
            mid: 4.2,
            last: 4.1,
            volume: 120,
            openInterest: 1500,
            iv: 0.32,
          },
        ],
        capital: { availableCashUSD: 10_000, maxLossToleranceUSD: 1000 },
      },
      strategySuitability: [
        {
          strategy: "long_call",
          level: "fit",
          reasons: [],
          warnings: [],
          missingFields: [],
          nextChecks: [],
        },
      ],
      positionDrafts: [
        {
          id: "cmp-draft",
          strategy: "long_call",
          status: "draft_ready",
          symbol: "CMP",
          requiredCapitalUSD: 440,
          maxLossUSD: 440,
          availableCashUSD: 10_000,
          warnings: [],
          missingFields: [],
          legs: [
            {
              id: "cmp-call",
              optionType: "call",
              side: "buy",
              expiry: "2026-12-18",
              strikePrice: 105,
              conservativePrice: 4.4,
              conservativePriceField: "ask",
              liquidityWarnings: [],
              missingFields: [],
            },
          ],
        },
      ],
    };

    const item = buildScreeningComparisonItem(candidate, evaluateCandidatePriority(candidate));

    expect(item.symbol).toBe("CMP");
    expect(item.primaryStrategy).toBe("コール買い");
    expect(item.bid).toBe("4");
    expect(item.ask).toBe("4.4");
    expect(item.spreadRate).toBe("9.5%");
    expect(item.conservativePrice).toBe("4.4");
    expect(item.requiredCapital).toBe("$440");
    expect(item.topReasons.join(" ")).toContain("チャート");
  });
});
