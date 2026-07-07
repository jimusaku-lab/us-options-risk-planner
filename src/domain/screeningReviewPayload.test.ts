import { describe, expect, it } from "vitest";
import type { CandidateSymbol } from "@/types/candidates";
import type { ScreeningCandidate, StrategyFitResult, TechnicalTimingPattern } from "@/types/screening";
import { createExternalReviewPayload, createScreeningReviewHandoff, formatScreeningReviewHandoffMemo, mergeReviewHandoffIntoJournal } from "./screeningReviewPayload";

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

  it("creates a safe screening review handoff without orderable wording or unsafe fields", () => {
    const candidate: CandidateSymbol = {
      id: "candidate-NVDA",
      source: "moomoo_file_import",
      importedAt: "2026-07-06T09:00:00+09:00",
      rawSourceRow: {
        token: "secret-token",
        accountId: "123456789",
        localPath: "/Users/motomichi/private.json",
      },
      rank: 1,
      symbol: "NVDA",
      company: "NVIDIA",
      priceUSD: 200,
      score: 88,
      suggestedUse: "screening candidate",
      screeningCompleteness: {
        level: "level_4_draft_ready",
        canClassifyStrategy: true,
        canAnalyzeChart: true,
        canEvaluateOptionLiquidity: true,
        canCreatePositionDraft: true,
        missingFields: [],
        warnings: [],
      },
      positionDrafts: [
        {
          id: "draft-long-call",
          strategy: "long_call",
          status: "draft_ready",
          symbol: "NVDA",
          requiredCapitalUSD: 900,
          maxLossUSD: 900,
          availableCashUSD: 2_000,
          warnings: ["建玉案レビューのみ"],
          missingFields: [],
          legs: [
            {
              id: "call-leg",
              optionType: "call",
              side: "buy",
              expiry: "2027-01-15",
              strikePrice: 210,
              conservativePrice: 9,
              conservativePriceField: "ask",
              mid: 8.8,
              last: 8.7,
              quantity: 1,
              liquidityWarnings: [],
              missingFields: [],
            },
          ],
          reviewState: {
            reviewStatus: "not_reviewed",
            transferWarnings: ["これは注文ではありません。"],
            checklist: [
              { id: "chart_confirmed", label: "チャート根拠を確認した", required: true, checked: false, blockingIfUnchecked: true },
              { id: "strategy_confirmed", label: "戦略が自分の意図と合っている", required: true, checked: true, blockingIfUnchecked: true },
            ],
          },
        },
      ],
    };

    const handoff = createScreeningReviewHandoff({
      candidate,
      generatedAt: "2026-07-06T10:00:00+09:00",
      source: "public",
    });
    const memo = formatScreeningReviewHandoffMemo(handoff);
    const serialized = JSON.stringify(handoff);

    expect(handoff.schemaVersion).toBe("us_options_screening_review_handoff.v1");
    expect(handoff.reviewSummary.reviewStatus).toBe("not_reviewed");
    expect(handoff.reviewSummary.blockers).toContain("建玉案レビュー可でも必須チェックが未完了です。");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("123456789");
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toMatch(/買い推奨|売り推奨|今すぐ実行|勝てる|必ず利益|注文できます|注文可能|発注できます/);
    expect(memo).toContain("Saxo TraderGO等の証券会社チケットで最終確認");
    expect(memo).toContain("これは注文票ではありません。");
  });

  it("merges handoff into technical memo without overwriting entryReason", () => {
    const candidate: CandidateSymbol = {
      id: "candidate-MSFT",
      source: "manual_import",
      importedAt: "2026-07-06T09:00:00+09:00",
      rank: 1,
      symbol: "MSFT",
      company: "Microsoft",
      score: 80,
      suggestedUse: "manual review",
    };
    const handoff = createScreeningReviewHandoff({
      candidate,
      generatedAt: "2026-07-06T10:00:00+09:00",
      source: "manual",
    });
    const journal = mergeReviewHandoffIntoJournal({
      id: "journal-1",
      candidateId: candidate.id,
      symbol: "MSFT",
      strategy: "custom",
      status: "candidate",
      createdAt: "2026-07-06T09:00:00+09:00",
      updatedAt: "2026-07-06T09:00:00+09:00",
      entryReason: "自分で書いた理由",
      technicalTags: [],
      technicalMemo: "",
      chartEvidence: [],
      review: { outcome: "not_reviewed" },
    }, handoff, "2026-07-06T10:01:00+09:00");

    expect(journal.entryReason).toBe("自分で書いた理由");
    expect(journal.technicalMemo).toContain("レビュー要約: MSFT");
    expect(journal.technicalTags).toContain("候補レビュー確認");
  });
});
