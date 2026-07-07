import { describe, expect, it } from "vitest";
import { defaultScreeningFilters, filterAndSortScreeningCandidates } from "@/domain/screeningFilters";
import { buildScreeningPriorityReviewMap } from "@/domain/screeningPriority";
import type { CandidateSymbol } from "@/types/candidates";

describe("screening operations filters", () => {
  it("filters by target strategy", () => {
    const call = makeCandidate("CALL", "long_call", "level_2_chart_ready");
    const covered = makeCandidate("COVERED", "covered_call", "level_2_chart_ready");
    const reviews = buildScreeningPriorityReviewMap([call, covered]);

    const result = filterAndSortScreeningCandidates([covered, call], reviews, {
      ...defaultScreeningFilters,
      targetStrategy: "long_call",
    });

    expect(result.map((candidate) => candidate.symbol)).toEqual(["CALL"]);
  });

  it("filters by priority band, level, chart regime, source, and preset", () => {
    const target = makeCandidate("TARGET", "long_call", "level_2_chart_ready", {
      source: "manual_import",
      preset: "large_liquid_core",
      chartRegime: "bullish_pullback",
    });
    const other = makeCandidate("OTHER", "long_call", "level_4_draft_ready", {
      source: "manual_import",
      preset: "manual",
      chartRegime: "range_neutral",
    });
    const reviews = buildScreeningPriorityReviewMap([target, other]);

    const result = filterAndSortScreeningCandidates([other, target], reviews, {
      ...defaultScreeningFilters,
      priorityBand: "secondary_watch",
      levels: ["level_2_chart_ready"],
      chartRegime: "bullish_pullback",
      source: "manual_import",
      preset: "large_liquid_core",
    });

    expect(result.map((candidate) => candidate.symbol)).toEqual(["TARGET"]);
  });

  it("sorts by market cap and detects missing option data", () => {
    const small = makeCandidate("SMALL", "long_call", "level_2_chart_ready", { marketCapUSD: 10 });
    const large = makeCandidate("LARGE", "long_call", "level_2_chart_ready", { marketCapUSD: 1_000_000 });
    const reviews = buildScreeningPriorityReviewMap([small, large]);

    const result = filterAndSortScreeningCandidates([small, large], reviews, {
      ...defaultScreeningFilters,
      sort: "market_cap",
      missingData: "has_missing",
      optionPermission: "missing",
    });

    expect(result.map((candidate) => candidate.symbol)).toEqual(["LARGE", "SMALL"]);
  });
});

function makeCandidate(
  symbol: string,
  strategy: "long_call" | "covered_call",
  level: "level_2_chart_ready" | "level_4_draft_ready",
  options: {
    source?: CandidateSymbol["source"];
    preset?: string;
    chartRegime?: "bullish_pullback" | "range_neutral";
    marketCapUSD?: number;
  } = {},
): CandidateSymbol {
  return {
    id: symbol,
    source: options.source ?? "manual_import",
    importedAt: "2026-07-06T00:00:00.000Z",
    rawSourceRow: { screeningPreset: options.preset ?? "manual" },
    rank: 1,
    symbol,
    company: symbol,
    priceUSD: 100,
    marketCapUSD: options.marketCapUSD,
    score: 80,
    suggestedUse: "test",
    screeningCompleteness: {
      level,
      canAnalyzeChart: true,
      canClassifyStrategy: true,
      canEvaluateOptionLiquidity: level === "level_4_draft_ready",
      canCreatePositionDraft: level === "level_4_draft_ready",
      missingFields: level === "level_4_draft_ready" ? [] : ["optionCandidates.bidAsk"],
      warnings: [],
    },
    publicScreeningInput: {
      symbol,
      underlyingPrice: 100,
      rawSourceRow: { screeningPreset: options.preset ?? "manual" },
      chartAnalysis: {
        regime: options.chartRegime ?? "bullish_pullback",
        confidence: "high",
        primaryTimeframe: "daily",
        timeframes: [],
        reasons: [],
        warnings: [],
        missingFields: [],
      },
      optionCandidates: [],
    },
    strategySuitability: [
      {
        strategy,
        level: "fit",
        reasons: [],
        warnings: [],
        missingFields: [],
        nextChecks: [],
      },
    ],
    positionDrafts: [],
  };
}
