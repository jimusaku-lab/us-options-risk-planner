import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectDangerousFields,
  normalizePublicScreeningPackage,
  normalizePublicScreeningPackageToCandidateImport,
  parsePublicScreeningPackage,
} from "./publicScreeningPackage";
import { parseCandidateImport } from "./candidates";

describe("public screening package", () => {
  it("parses us_options_screening_package.v1 and normalizes to existing candidate import result", () => {
    const payload = createPackage({
      symbol: "MSFT",
      underlyingPrice: 500,
      technicalSnapshot: {
        dailyClose: 500,
        sma25: 490,
        sma50: 470,
        sma200: 420,
        macdSignal: "bullish",
        trendNotes: [],
      },
      optionCandidates: [
        {
          optionType: "call",
          expiry: "2026-12-18",
          dte: 167,
          strike: 520,
          bid: 20,
          ask: 21,
          volume: 100,
          openInterest: 1200,
          iv: 0.32,
        },
      ],
      capital: {
        availableCashUSD: 60_000,
        maxLossToleranceUSD: 3_000,
      },
      positionDrafts: [
        {
          id: "msft-long-call-draft",
          strategy: "long_call",
          status: "draft_ready",
          symbol: "MSFT",
          requiredCapitalUSD: 2_100,
          maxLossUSD: 2_100,
          availableCashUSD: 60_000,
          legs: [
            {
              id: "msft-long-call-leg",
              optionType: "call",
              side: "buy",
              expiry: "2026-12-18",
              dte: 167,
              strikePrice: 520,
              conservativePrice: 21,
              conservativePriceField: "ask",
              mid: 20.5,
              last: 20.5,
              quantity: 1,
              liquidityWarnings: [],
              missingFields: [],
            },
          ],
          warnings: [],
          missingFields: [],
        },
      ],
    });

    const parsed = parsePublicScreeningPackage(JSON.stringify(payload));
    const normalized = normalizePublicScreeningPackageToCandidateImport(payload, "2026-07-04T09:00:00+09:00");

    expect(parsed.schemaVersion).toBe("us_options_screening_package.v1");
    expect(normalized.summary).toMatchObject({
      totalRows: 1,
      importedCount: 1,
      source: "manual_import",
      format: "json",
    });
    expect(normalized.candidates[0]).toMatchObject({
      symbol: "MSFT",
      priceUSD: 500,
      score: 90,
    });
    expect(normalized.candidates[0].screeningCandidate?.missingFields).not.toContain("optionCandidates.bidAsk");
    expect(normalized.candidates[0].strategyFitResults?.length).toBeGreaterThan(0);
    expect(normalized.candidates[0].publicScreeningInput?.optionCandidates?.[0]?.bid).toBe(20);
    expect(normalized.candidates[0].screeningCompleteness?.level).toBe("level_4_draft_ready");
    expect(normalized.candidates[0].strategySuitability?.length).toBeGreaterThan(0);
    expect(normalized.candidates[0].positionDrafts?.some((draft) => draft.status === "draft_ready")).toBe(true);
    expect(normalized.candidates[0].strategyPrecisionReviews?.some((review) => review.strategy === "long_call")).toBe(true);
    expect(normalized.candidates[0].advancedStrategyReviews?.some((review) => review.strategy === "synthetic_forward")).toBe(true);
  });

  it("accepts us_options_screening_package.v1 through the existing candidate import entry", () => {
    const payload = createPackage({
      symbol: "GOOGL",
      underlyingPrice: 260,
      technicalSnapshot: {
        dailyClose: 260,
        sma25: 252,
        sma50: 245,
        sma200: 220,
        macdSignal: "bullish",
        trendNotes: [],
      },
    });

    const imported = parseCandidateImport(JSON.stringify(payload), "screening-package.json", "2026-07-04T09:00:00+09:00");

    expect(imported.summary).toMatchObject({
      totalRows: 1,
      importedCount: 1,
      format: "json",
    });
    expect(imported.candidates[0]).toMatchObject({
      symbol: "GOOGL",
      priceUSD: 260,
    });
    expect(imported.screeningCandidates).toHaveLength(1);
    expect(imported.screeningCandidates?.[0]?.missingFields).toContain("optionCandidates.bidAsk");
  });

  it("keeps Level 2 when Bid Ask are missing and does not create Level 3", () => {
    const normalized = normalizePublicScreeningPackage(createPackage({
      symbol: "AAPL",
      underlyingPrice: 210,
      chartAnalysis: {
        regime: "bullish_pullback",
        confidence: "medium",
        primaryTimeframe: "daily",
        timeframes: [],
        reasons: ["manual chart review"],
        warnings: [],
        missingFields: [],
      },
      optionCandidates: [
        {
          optionType: "put",
          expiry: "2026-09-18",
          strike: 195,
          last: 4.2,
          volume: 50,
          openInterest: 700,
          iv: 0.25,
        },
      ],
    }));

    expect(normalized.candidates[0].completeness.level).toBe("level_2_chart_ready");
    expect(normalized.candidates[0].candidate.missingFields).toContain("optionCandidates.bidAsk");
  });

  it("does not create Level 4 when capital data is missing", () => {
    const normalized = normalizePublicScreeningPackage(createPackage({
      symbol: "NVDA",
      underlyingPrice: 140,
      chartAnalysis: {
        regime: "bullish_continuation",
        confidence: "medium",
        primaryTimeframe: "daily",
        timeframes: [],
        reasons: ["manual chart review"],
        warnings: [],
        missingFields: [],
      },
      optionCandidates: [
        {
          optionType: "call",
          expiry: "2026-12-18",
          strike: 150,
          bid: 10,
          ask: 11,
          volume: 100,
          openInterest: 1000,
          iv: 0.4,
        },
      ],
    }));

    expect(normalized.candidates[0].completeness.level).toBe("level_3_option_ready");
    expect(normalized.candidates[0].completeness.canCreatePositionDraft).toBe(false);
  });

  it("detects and strips credential-like fields and local paths", () => {
    const payload = createPackage({
      symbol: "V",
      underlyingPrice: 340,
      technicalSnapshot: {
        dailyClose: 340,
        sma25: 330,
        trendNotes: ["manual"],
      },
      token: "secret-token",
      password: "secret-password",
      accountId: "123456789",
      localPath: "/Users/motomichi/private/export.json",
      order: { place_order: true },
    });

    const findings = detectDangerousFields(payload);
    const normalized = normalizePublicScreeningPackageToCandidateImport(payload, "2026-07-04T09:00:00+09:00");
    const serialized = JSON.stringify(normalized);

    expect(findings.map((finding) => finding.reason)).toEqual(expect.arrayContaining(["credential_like_key", "local_path", "order_operation"]));
    expect(normalized.warnings.join(" ")).toContain("危険フィールド");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("secret-password");
    expect(serialized).not.toContain("123456789");
    expect(serialized).not.toContain("/Users/");
  });

  it("normalizes mixed Level 1-4 package fixtures and strips dangerous operation fields", () => {
    const payload = createPackageWithCandidates([
      {
        symbol: "L1",
        underlyingPrice: 100,
        token: "secret-token",
        localPath: "/Users/motomichi/private/level1.json",
      },
      {
        symbol: "L2",
        underlyingPrice: 120,
        chartAnalysis: {
          regime: "bullish_pullback",
          confidence: "medium",
          primaryTimeframe: "daily",
          timeframes: [],
          reasons: ["manual chart review"],
          warnings: [],
          missingFields: [],
        },
      },
      {
        symbol: "L3",
        underlyingPrice: 200,
        chartAnalysis: {
          regime: "bullish_continuation",
          confidence: "medium",
          primaryTimeframe: "daily",
          timeframes: [],
          reasons: ["manual chart review"],
          warnings: [],
          missingFields: [],
        },
        optionCandidates: [
          {
            optionType: "call",
            expiry: "2026-12-18",
            dte: 166,
            strike: 210,
            bid: 9.5,
            ask: 10,
            volume: 100,
            openInterest: 1000,
            iv: 0.28,
          },
        ],
      },
      {
        symbol: "L4",
        underlyingPrice: 300,
        chartAnalysis: {
          regime: "bullish_continuation",
          confidence: "high",
          primaryTimeframe: "daily",
          timeframes: [],
          reasons: ["manual chart review"],
          warnings: [],
          missingFields: [],
        },
        optionCandidates: [
          {
            optionType: "call",
            expiry: "2026-12-18",
            dte: 166,
            strike: 310,
            bid: 12,
            ask: 12.8,
            volume: 200,
            openInterest: 1800,
            iv: 0.31,
          },
        ],
        capital: {
          availableCashUSD: 50_000,
          maxLossToleranceUSD: 2_000,
        },
        advancedStrategyReviews: [
          {
            id: "l4-synthetic-review",
            strategy: "synthetic_forward",
            level: "manual_review_required",
            symbol: "L4",
            legs: [],
            scenarios: [],
            reasons: ["advanced review only"],
            warnings: [],
            missingFields: [],
            manualReviewReasons: ["複合損益を手動確認"],
          },
        ],
        order: { place_order: true },
        [["unlock", "trade"].join("_")]: true,
        exercise: true,
        apiKey: "secret-api-key",
        accountId: "123456789",
      },
    ]);

    const normalized = normalizePublicScreeningPackageToCandidateImport(payload, "2026-07-05T09:00:00+09:00");
    const bySymbol = new Map(normalized.candidates.map((candidate) => [candidate.symbol, candidate]));
    const serialized = JSON.stringify(normalized);
    const serializedCandidates = JSON.stringify(normalized.candidates);

    expect(bySymbol.get("L1")?.screeningCompleteness?.level).toBe("level_1_symbol_price");
    expect(bySymbol.get("L1")?.positionDrafts?.some((draft) => draft.status === "draft_ready")).not.toBe(true);
    expect(bySymbol.get("L2")?.screeningCompleteness?.level).toBe("level_2_chart_ready");
    expect(bySymbol.get("L2")?.strategySuitability?.some((item) => item.level === "fit")).not.toBe(true);
    expect(bySymbol.get("L3")?.screeningCompleteness?.level).toBe("level_3_option_ready");
    expect(bySymbol.get("L3")?.positionDrafts?.some((draft) => draft.status === "draft_ready")).not.toBe(true);
    expect(bySymbol.get("L4")?.screeningCompleteness?.level).toBe("level_4_draft_ready");
    expect(bySymbol.get("L4")?.strategyPrecisionReviews?.some((review) => review.level === "fit" || review.level === "manual_review_required")).toBe(true);
    expect(bySymbol.get("L4")?.advancedStrategyReviews?.[0]).toMatchObject({
      strategy: "synthetic_forward",
      level: "manual_review_required",
    });
    expect(normalized.warnings.join(" ")).toContain("危険フィールド");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("secret-api-key");
    expect(serialized).not.toContain("123456789");
    expect(serialized).not.toContain("/Users/");
    expect(serializedCandidates).not.toContain("place_order");
    expect(serializedCandidates).not.toContain(["unlock", "trade"].join("_"));
    expect(serializedCandidates).not.toContain("exercise");
  });

  it("imports the public sample screening package through the existing candidate import path", () => {
    const samplePath = path.resolve(process.cwd(), "public/samples/us-options-screening-sample-v1.json");
    const text = readFileSync(samplePath, "utf8");
    const payload = JSON.parse(text) as unknown;

    expect(detectDangerousFields(payload)).toEqual([]);

    const imported = parseCandidateImport(text, "us-options-screening-sample-v1.json", "2026-07-05T09:30:00+09:00");
    const bySymbol = new Map(imported.candidates.map((candidate) => [candidate.symbol, candidate]));

    expect(imported.summary).toMatchObject({
      totalRows: 7,
      importedCount: 7,
      format: "json",
    });
    expect(bySymbol.get("PSAMPLE1")?.screeningCompleteness?.level).toBe("level_1_symbol_price");
    expect(bySymbol.get("PSAMPLE1")?.positionDrafts?.some((draft) => draft.status === "draft_ready")).not.toBe(true);

    expect(bySymbol.get("PSAMPLE2")?.screeningCompleteness?.level).toBe("level_2_chart_ready");
    expect(bySymbol.get("PSAMPLE2")?.strategySuitability?.some((item) => item.level === "fit")).not.toBe(true);
    expect(bySymbol.get("PSAMPLE2")?.positionDrafts?.some((draft) => draft.status === "draft_ready")).not.toBe(true);

    expect(bySymbol.get("PSAMPLE3")?.screeningCompleteness?.level).toBe("level_3_option_ready");
    expect(bySymbol.get("PSAMPLE3")?.positionDrafts?.some((draft) => draft.status === "draft_ready")).not.toBe(true);
    expect(bySymbol.get("PSAMPLE3")?.publicScreeningInput?.optionCandidates?.[0]).toMatchObject({
      bid: 5.2,
      ask: 5.6,
    });
    expect(bySymbol.get("PSAMPLE3")?.strategyPrecisionReviews?.some((review) => review.expiryReview.targetDteRange)).toBe(true);

    expect(bySymbol.get("PSAMPLE4")?.screeningCompleteness?.level).toBe("level_4_draft_ready");
    expect(bySymbol.get("PSAMPLE4")?.positionDrafts?.some((draft) => draft.status === "draft_ready")).toBe(true);
    expect(bySymbol.get("PSAMPLE4")?.advancedStrategyReviews?.some((review) => review.level === "manual_review_required")).toBe(true);
    expect(bySymbol.get("PSAMPLE4")?.strategyPrecisionReviews?.some((review) => review.checklist.includes("証券会社画面の価格を最終確認する"))).toBe(true);

    expect(bySymbol.get("PSAMPLE5")?.screeningCompleteness?.level).toBe("level_4_draft_ready");
    expect(bySymbol.get("PSAMPLE5")?.positionDrafts?.some((draft) => draft.status === "draft_ready")).not.toBe(true);
    expect(bySymbol.get("PSAMPLE5")?.strategyPrecisionReviews?.some((review) => review.avoidReasons.length > 0 || review.capitalReview.level === "blocked")).toBe(true);
    expect(bySymbol.get("PSAMPLE6")?.strategyPrecisionReviews?.some((review) => review.strategy === "cash_secured_put_avoid_assignment" && review.strikeReview.level === "blocked")).toBe(true);
    expect(bySymbol.get("PSAMPLE7")?.strategyPrecisionReviews?.some((review) => review.strategy === "covered_call" && review.avoidReasons.join(" ").includes("取得単価"))).toBe(true);
    expect(JSON.stringify(imported)).not.toContain("/Users/");
  });
});

function createPackage(candidate: Record<string, unknown>) {
  return createPackageWithCandidates([candidate]);
}

function createPackageWithCandidates(candidates: Record<string, unknown>[]) {
  return {
    schemaVersion: "us_options_screening_package.v1",
    generatedAt: "2026-07-04T09:00:00+09:00",
    source: "manual",
    dataPolicy: {
      userProvided: true,
      containsCredentials: false,
      notes: ["user provided package"],
    },
    candidates: candidates.map((candidate) => ({
        name: "Candidate",
        market: "US",
        priceAsOf: "2026-07-04T09:00:00+09:00",
        ...candidate,
      })),
  };
}
