import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidateDetailCard } from "./CandidateDetailCard";
import type { CandidateSymbol } from "@/types/candidates";

function buildCandidate(): CandidateSymbol {
  return {
    id: "candidate-NVDA",
    source: "moomoo_file_import",
    importedAt: "2026-07-01T09:00:00+09:00",
    rawSourceRow: {
      Symbol: "NVDA",
      token: "secret-token",
      password: "secret-password",
      accountId: "123456789",
      localPath: "/Users/motomichi/private/input.json",
      apiKey: "secret-api-key",
    },
    rank: 1,
    symbol: "NVDA",
    company: "NVIDIA",
    priceUSD: 140,
    sector: "Technology",
    score: 88,
    suggestedUse: "screening candidate",
    parseWarnings: ["row 1: Volume is empty"],
    strategyFitResults: [
      {
        strategy: "long_call",
        fitLevel: "fit",
        reasons: ["MACD is bullish"],
        warnings: ["earnings date not confirmed"],
        missingFields: ["optionContracts.delta"],
        requiredChecks: [{ id: "profit_take", label: "利確ルール", passed: true }],
        numericChecks: [{ id: "spread", label: "Bid/Ask spread", value: 0.08, max: 0.15, passed: true }],
      },
      {
        strategy: "covered_call",
        fitLevel: "watch",
        reasons: ["保有株の前提確認"],
        warnings: [],
        missingFields: [],
        requiredChecks: [],
        numericChecks: [],
      },
      {
        strategy: "synthetic_forward",
        fitLevel: "insufficient_data",
        reasons: [],
        warnings: ["資金確認"],
        missingFields: ["assignmentCapitalAvailable"],
        requiredChecks: [],
        numericChecks: [],
      },
      {
        strategy: "short_strangle",
        fitLevel: "avoid",
        reasons: ["イベント未確認"],
        warnings: [],
        missingFields: [],
        requiredChecks: [],
        numericChecks: [],
      },
    ],
    technicalTimingPatterns: [
      {
        kind: "upside_reversal_combo",
        fitLevel: "watch",
        signalOrder: ["slowkd_golden_cross", "macd_golden_cross", "ma25_50_golden_cross"],
        reasons: ["SlowKD cross detected"],
        warnings: ["MA25/50 distance is narrow"],
        missingFields: ["signalEvents.ma25_50_golden_cross"],
        suggestedStrategyKinds: ["long_call", "cash_secured_put_buy_to_own"],
        detectedAt: "2026-07-01T09:00:00+09:00",
        timing: {
          slowKdCrossDate: "2026-06-27",
          macdCrossDate: "2026-06-28",
          ma25Ma50CrossDate: "2026-06-30",
          ma25Ma50DistancePct: 1.2,
          movingAverageSlopes: { ma25: "up", ma50: "flat", ma200: "up" },
          priceLocation: { aboveMa25: true, aboveMa50: true, aboveMa200: false },
          optionComboReadiness: {
            modes: ["school_same_expiry", "practical_split_expiry"],
            longCallReady: true,
            buyToOwnPutReady: false,
            liquidityOk: false,
            eventRiskOk: true,
            notes: ["流動性注意"],
          },
          timingNotes: ["signal order is valid"],
        },
      },
    ],
    syntheticForwardCandidates: [
      {
        kind: "synthetic_forward",
        fitLevel: "watch",
        technicalBias: "fit",
        expiry: "2026-08-21",
        dte: 51,
        strike: 140,
        netPremium: 0.4,
        breakEvenPrice: 140.4,
        assignmentCapitalRequired: 14_000,
        assignmentCapitalAvailable: 12_000,
        syntheticDelta: 0.92,
        stockEquivalentNotional: 14_000,
        capitalEfficiencyNotes: ["capital check required"],
        longCallLeg: { type: "long_call", expiry: "2026-08-21", dte: 51, strikePrice: 140, mid: 5.2 },
        shortPutLeg: { type: "short_put", expiry: "2026-08-21", dte: 51, strikePrice: 140, mid: 4.8 },
        reasons: ["synthetic delta is high"],
        warnings: ["assignment capital shortage"],
        missingFields: ["put.openInterest"],
        riskFlags: ["assignment_capital_shortage"],
      },
    ],
    screeningCompleteness: {
      level: "level_4_draft_ready",
      canClassifyStrategy: true,
      canAnalyzeChart: true,
      canEvaluateOptionLiquidity: true,
      canCreatePositionDraft: true,
      missingFields: [],
      warnings: [],
    },
    publicScreeningInput: {
      symbol: "NVDA",
      underlyingPrice: 140,
      chartAnalysis: {
        asOf: "2026-07-01T09:00:00+09:00",
        regime: "bullish_continuation",
        confidence: "high",
        primaryTimeframe: "daily",
        reasons: ["chart regime is bullish"],
        warnings: ["high chase check"],
        missingFields: [],
        timeframes: [
          {
            timeframe: "daily",
            close: 140,
            sma25: 135,
            sma50: 132,
            sma200: 120,
            macdSignal: "bullish",
            slowKdSignal: "bullish",
            rsi: 58,
            priceLocation: { distanceFromMa25Pct: 3.7, distanceFromMa50Pct: 6.1 },
            supportLevels: [135, 132],
            resistanceLevels: [145],
          },
        ],
      },
      strategySuitability: [
        {
          strategy: "long_call",
          level: "manual_review_required",
          chartRegime: "bullish_continuation",
          confidence: "high",
          reasons: ["strategy chart ok"],
          warnings: ["manual strategy check"],
          missingFields: ["capital.maxLossToleranceUSD"],
          manualReviewReasons: ["review before draft"],
          nextChecks: ["DTE 150日以上"],
        },
      ],
      optionCandidates: [
        {
          id: "call-1",
          optionType: "call",
          expiry: "2027-01-15",
          dte: 198,
          strike: 145,
          bid: 8.4,
          ask: 8.8,
          mid: 8.6,
          last: 8.5,
          volume: 120,
          openInterest: 900,
          iv: 0.42,
          delta: 0.52,
          source: "user_export",
        },
      ],
      positionDrafts: [
        {
          id: "draft-long-call",
          strategy: "long_call",
          status: "draft_ready",
          symbol: "NVDA",
          requiredCapitalUSD: 880,
          maxLossUSD: 880,
          availableCashUSD: 2_000,
          warnings: ["建玉案レビューのみ"],
          missingFields: [],
          legs: [
            {
              id: "call-1-leg",
              optionType: "call",
              side: "buy",
              expiry: "2027-01-15",
              dte: 198,
              strikePrice: 145,
              conservativePrice: 8.8,
              conservativePriceField: "ask",
              mid: 8.6,
              last: 8.5,
              quantity: 1,
              liquidityWarnings: [],
              missingFields: [],
            },
          ],
        },
      ],
      advancedStrategyReviews: [
        {
          id: "NVDA-short-strangle-advanced",
          strategy: "short_strangle_advanced_review",
          level: "manual_review_required",
          symbol: "NVDA",
          chartRegime: "range_neutral",
          confidence: "medium",
          netPremiumUSD: 3.7,
          requiredCapitalUSD: 13_000,
          maxLossUSD: 12_630,
          stockEquivalentNotionalUSD: 28_000,
          breakEvenUpperUSD: 153.7,
          breakEvenLowerUSD: 126.3,
          effectiveAcquisitionCostUSD: 126.3,
          scenarios: ["レンジ内", "上抜け", "下抜け"],
          reasons: ["range review"],
          warnings: ["naked_call_risk: 100株カバーが確認できません。"],
          missingFields: ["capital.stockShares"],
          manualReviewReasons: ["裸コール化しないことを確認してください。"],
          legs: [
            {
              id: "short-call",
              optionType: "call",
              side: "sell",
              expiry: "2026-08-21",
              dte: 51,
              strikePrice: 150,
              conservativePrice: 1.7,
              conservativePriceField: "bid",
              mid: 1.8,
              last: 1.75,
              quantity: 1,
              liquidityWarnings: ["流動性不足"],
              missingFields: [],
            },
            {
              id: "short-put",
              optionType: "put",
              side: "sell",
              expiry: "2026-08-21",
              dte: 51,
              strikePrice: 130,
              conservativePrice: 2,
              conservativePriceField: "bid",
              mid: 2.1,
              last: 2.05,
              quantity: 1,
              liquidityWarnings: [],
              missingFields: [],
            },
          ],
        },
      ],
      strategyPrecisionReviews: [
        {
          strategy: "long_call",
          level: "manual_review_required",
          chartGate: {
            level: "pass",
            reasons: ["週足50本線が上向きです。"],
            warnings: [],
          },
          expiryReview: {
            level: "pass",
            targetDteRange: [150, 9999],
            actualDte: 198,
            reasons: ["DTE 198日: コール買いの標準レンジです。"],
            warnings: [],
          },
          strikeReview: {
            level: "pass",
            targetStrikeRatioRange: [1, 1.05],
            actualStrikeRatio: 1.04,
            reasons: ["strike/株価比 1.04: コール買いレンジ内です。"],
            warnings: [],
          },
          liquidityReview: {
            level: "pass",
            reasons: ["Askを保守価格に使用します。", "Bid/Askあり、spread 4.7%"],
            warnings: [],
          },
          capitalReview: {
            level: "pass",
            reasons: ["最大損失 $880"],
            warnings: [],
          },
          manualReviewReasons: ["反対売買前提、時間価値減少、損益分岐点を確認してください。"],
          avoidReasons: [],
          nextChecks: ["チャート根拠", "満期と時間軸"],
          checklist: ["チャート根拠を確認した", "証券会社画面の価格を最終確認する"],
        },
      ],
    },
    strategySuitability: [
      {
        strategy: "long_call",
        level: "manual_review_required",
        chartRegime: "bullish_continuation",
        confidence: "high",
        reasons: ["strategy chart ok"],
        warnings: ["manual strategy check"],
        missingFields: ["capital.maxLossToleranceUSD"],
        manualReviewReasons: ["review before draft"],
        nextChecks: ["DTE 150日以上"],
      },
    ],
    positionDrafts: [
      {
        id: "draft-long-call",
        strategy: "long_call",
        status: "draft_ready",
        symbol: "NVDA",
        requiredCapitalUSD: 880,
        maxLossUSD: 880,
        availableCashUSD: 2_000,
        warnings: ["建玉案レビューのみ"],
        missingFields: [],
        reviewState: {
          reviewStatus: "not_reviewed",
          checklist: [
            { id: "chart_confirmed", label: "チャート根拠を確認した", checked: false, required: true, blockingIfUnchecked: true },
            { id: "saxo_ticket_confirmed", label: "証券会社画面の価格を最終確認する", checked: false, required: true, blockingIfUnchecked: true },
          ],
          transferWarnings: ["証券会社画面で最終確認するまで入力候補にしません。"],
        },
        legs: [
          {
            id: "call-1-leg",
            optionType: "call",
            side: "buy",
            expiry: "2027-01-15",
            dte: 198,
            strikePrice: 145,
            conservativePrice: 8.8,
            conservativePriceField: "ask",
            mid: 8.6,
            last: 8.5,
            quantity: 1,
            liquidityWarnings: [],
            missingFields: [],
          },
        ],
      },
    ],
    advancedStrategyReviews: [
      {
        id: "NVDA-short-strangle-advanced",
        strategy: "short_strangle_advanced_review",
        level: "manual_review_required",
        symbol: "NVDA",
        chartRegime: "range_neutral",
        confidence: "medium",
        netPremiumUSD: 3.7,
        requiredCapitalUSD: 13_000,
        maxLossUSD: 12_630,
        stockEquivalentNotionalUSD: 28_000,
        breakEvenUpperUSD: 153.7,
        breakEvenLowerUSD: 126.3,
        effectiveAcquisitionCostUSD: 126.3,
        scenarios: ["レンジ内", "上抜け", "下抜け"],
        reasons: ["range review"],
        warnings: ["naked_call_risk: 100株カバーが確認できません。"],
        missingFields: ["capital.stockShares"],
        manualReviewReasons: ["裸コール化しないことを確認してください。"],
        legs: [
          {
            id: "short-call",
            optionType: "call",
            side: "sell",
            expiry: "2026-08-21",
            dte: 51,
            strikePrice: 150,
            conservativePrice: 1.7,
            conservativePriceField: "bid",
            mid: 1.8,
            last: 1.75,
            quantity: 1,
            liquidityWarnings: ["流動性不足"],
            missingFields: [],
          },
          {
            id: "short-put",
            optionType: "put",
            side: "sell",
            expiry: "2026-08-21",
            dte: 51,
            strikePrice: 130,
            conservativePrice: 2,
            conservativePriceField: "bid",
            mid: 2.1,
            last: 2.05,
            quantity: 1,
            liquidityWarnings: [],
            missingFields: [],
          },
        ],
      },
    ],
    strategyPrecisionReviews: [
      {
        strategy: "long_call",
        level: "manual_review_required",
        chartGate: {
          level: "pass",
          reasons: ["週足50本線が上向きです。"],
          warnings: [],
        },
        expiryReview: {
          level: "pass",
          targetDteRange: [150, 9999],
          actualDte: 198,
          reasons: ["DTE 198日: コール買いの標準レンジです。"],
          warnings: [],
        },
        strikeReview: {
          level: "pass",
          targetStrikeRatioRange: [1, 1.05],
          actualStrikeRatio: 1.04,
          reasons: ["strike/株価比 1.04: コール買いレンジ内です。"],
          warnings: [],
        },
        liquidityReview: {
          level: "pass",
          reasons: ["Askを保守価格に使用します。", "Bid/Askあり、spread 4.7%"],
          warnings: [],
        },
        capitalReview: {
          level: "pass",
          reasons: ["最大損失 $880"],
          warnings: [],
        },
        manualReviewReasons: ["反対売買前提、時間価値減少、損益分岐点を確認してください。"],
        avoidReasons: [],
        nextChecks: ["チャート根拠", "満期と時間軸"],
        checklist: ["チャート根拠を確認した", "証券会社画面の価格を最終確認する"],
      },
    ],
    screeningCandidate: {
      symbol: "NVDA",
      name: "NVIDIA",
      market: "US",
      sector: "Technology",
      underlyingPrice: 140,
      priceAsOf: "2026-07-01T08:59:00+09:00",
      dataSource: "moomoo",
      delayStatus: "delayed",
      technicalSnapshot: {
        dailyClose: 139.5,
        sma25: 135,
        sma50: 132,
        sma200: 120,
        macdSignal: "bullish",
        slowKdSignal: "golden_cross",
        rsi: 58,
        trendNotes: ["trend improving"],
        signalEvents: [
          {
            type: "slowkd_golden_cross",
            occurredAt: "2026-06-27",
            lookbackTradingDays: 3,
            strength: "normal",
            notes: "slow kd crossed",
          },
        ],
        movingAverageSlopes: { ma25: "up", ma50: "flat", ma200: "up" },
      },
      optionChainQuality: {
        hasOptionChain: true,
        expirationCount: 5,
        targetDteAvailable: true,
        bidAskSpreadRate: 0.08,
        volume: 120,
        openInterest: 900,
        iv: 0.42,
        delta: 0.53,
        gamma: 0.02,
        theta: -0.03,
        vega: 0.11,
        qualityWarnings: ["Bid/Ask spread is wide"],
      },
      candidateStrategies: [],
      riskFlags: ["流動性注意"],
      missingFields: ["optionContracts.delta"],
    },
  };
}

describe("CandidateDetailCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows fit details, timing patterns, synthetic forward details, and sanitized source data", () => {
    render(<CandidateDetailCard candidate={buildCandidate()} />);

    expect(screen.getByText("候補詳細")).toBeInTheDocument();
    expect(screen.getByText("総合判定")).toBeInTheDocument();
    expect(screen.getAllByText("チャート根拠").length).toBeGreaterThan(0);
    expect(screen.getByText("第一候補")).toBeInTheDocument();
    expect(screen.getByText("不足データ・次アクション")).toBeInTheDocument();
    expect(screen.queryByText("戦略別ランキングレビュー")).not.toBeInTheDocument();
    expect(screen.getByText("MACD is bullish")).toBeInTheDocument();
    expect(screen.getByText("earnings date not confirmed")).toBeInTheDocument();
    expect(screen.getAllByText("Delta不足").length).toBeGreaterThan(0);
    expect(screen.getByText("利確ルール")).toBeInTheDocument();
    expect(screen.getByText("Bid/Ask spread")).toBeInTheDocument();
    expect(screen.getAllByText("Bid/Ask spread is wide").length).toBeGreaterThan(0);
    expect(screen.getByText("SlowKD cross detected")).toBeInTheDocument();
    expect(screen.getByText("signal order is valid")).toBeInTheDocument();
    expect(screen.getByText("synthetic delta is high")).toBeInTheDocument();
    expect(screen.getByText("assignment capital shortage")).toBeInTheDocument();
    expect(screen.getAllByText("割当必要資金").length).toBeGreaterThan(0);
    expect(screen.getByText("データ充足")).toBeInTheDocument();
    expect(screen.getByText("L4 建玉案レビュー可")).toBeInTheDocument();
    expect(screen.getByText("チャート分析")).toBeInTheDocument();
    expect(screen.getAllByText("chart regime is bullish").length).toBeGreaterThan(0);
    expect(screen.getByText("戦略適性")).toBeInTheDocument();
    expect(screen.getAllByText("手動確認").length).toBeGreaterThan(0);
    expect(screen.getByText("review before draft")).toBeInTheDocument();
    expect(screen.getByText("戦略精度レビュー")).toBeInTheDocument();
    expect(screen.getByText("チャート最終ゲート")).toBeInTheDocument();
    expect(screen.getByText("満期レビュー")).toBeInTheDocument();
    expect(screen.getByText("strikeレビュー")).toBeInTheDocument();
    expect(screen.getByText("流動性レビュー")).toBeInTheDocument();
    expect(screen.getByText("資金レビュー")).toBeInTheDocument();
    expect(screen.getByText("DTE 198日: コール買いの標準レンジです。")).toBeInTheDocument();
    expect(screen.getByText("Askを保守価格に使用します。")).toBeInTheDocument();
    expect(screen.getByText("建玉案レビューの手動確認チェック")).toBeInTheDocument();
    expect(screen.getAllByText("証券会社画面の価格を最終確認する").length).toBeGreaterThan(0);
    expect(screen.getByText("建玉案レビュー前サマリー")).toBeInTheDocument();
    expect(screen.getAllByText(/必須未確認/).length).toBeGreaterThan(0);
    expect(screen.getByText("オプション候補・流動性")).toBeInTheDocument();
    expect(screen.getByText("8.4 / 8.8")).toBeInTheDocument();
    expect(screen.getByText("建玉案レビュー")).toBeInTheDocument();
    expect(screen.queryByText("draft_ready")).not.toBeInTheDocument();
    expect(screen.getAllByText("建玉案レビュー可").length).toBeGreaterThan(0);
    expect(screen.getAllByText("必要資金").length).toBeGreaterThan(0);
    expect(screen.getByText("手動確認ハンドオフ")).toBeInTheDocument();
    expect(screen.getByText("Saxo TraderGO等で確認するためのメモ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "手動確認メモをコピー" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "レビューJSONを書き出す" })).toBeInTheDocument();
    expect(screen.getByText("上級戦略レビュー")).toBeInTheDocument();
    expect(screen.getByText("ショートストラングル（上級確認）")).toBeInTheDocument();
    expect(screen.getByText("裸コールリスク: 100株カバーが確認できません。")).toBeInTheDocument();
    expect(screen.getByText("裸コール化しないことを確認してください。")).toBeInTheDocument();
    expect(screen.getByText("$153.70")).toBeInTheDocument();

    expect(screen.queryByText("secret-token")).not.toBeInTheDocument();
    expect(screen.queryByText("secret-password")).not.toBeInTheDocument();
    expect(screen.queryByText("123456789")).not.toBeInTheDocument();
    expect(screen.queryByText("/Users/motomichi/private/input.json")).not.toBeInTheDocument();
    expect(screen.queryByText("secret-api-key")).not.toBeInTheDocument();
  });

  it("keeps priority scores collapsed as internal strategy comparison", () => {
    render(
      <CandidateDetailCard
        candidate={buildCandidate()}
        priorityReviews={[
          {
            candidateId: "candidate-NVDA",
            symbol: "NVDA",
            targetStrategy: "long_call",
            band: "manual_review",
            score: 33,
            chartScore: 20,
            strategyScore: 10,
            completenessScore: 3,
            stockQualityScore: 0,
            optionReadinessScore: 0,
            capitalReadinessScore: 0,
            reasons: ["チャート確認"],
            blockers: ["資金確認待ち"],
            nextDataNeeded: ["option bid/ask"],
            warnings: [],
            primaryStrategy: "long_call",
            primaryStrategyLabel: "コール買い",
            sortKeys: { completeness: 3, chart: 20, strategy: 10, liquidity: 0, capital: 0, eventRisk: 0, existingPosition: 0, stockQuality: 0 },
            priorityScore: 33,
            priorityBand: "manual_review",
            topReasons: ["チャート確認"],
            penaltyReasons: ["資金確認待ち"],
            missingChecks: ["option bid/ask"],
          },
        ]}
      />,
    );

    expect(screen.queryByText("戦略別ランキングレビュー")).not.toBeInTheDocument();
    expect(screen.getByText("全戦略比較（内部スコア詳細）")).toBeInTheDocument();
    expect(screen.getByText(/内部スコアは確認順の補助/)).toBeInTheDocument();
  });

  it("saves checklist changes and reflects review details to the journal only when requested", () => {
    const onChecklistChange = vi.fn();
    const onJournalChange = vi.fn();
    const candidate = buildCandidate();

    render(
      <CandidateDetailCard
        candidate={candidate}
        onChecklistChange={onChecklistChange}
        onJournalChange={onJournalChange}
        getDefaultJournal={() => ({
          id: "journal-default",
          candidateId: candidate.id,
          symbol: candidate.symbol,
          underlyingName: candidate.company,
          strategy: "custom",
          accountCode: "UNKNOWN",
          status: "candidate",
          createdAt: "2026-07-05T00:00:00.000Z",
          updatedAt: "2026-07-05T00:00:00.000Z",
          entryReason: "既存の根拠",
          technicalTags: [],
          technicalMemo: "",
          expectedScenario: "",
          profitTakingPlan: "",
          stopLossPlan: "",
          invalidationCondition: "",
          chartEvidence: [],
          review: { outcome: "not_reviewed" },
        })}
      />,
    );

    fireEvent.click(screen.getAllByLabelText(/チャート根拠を確認した/)[0]);
    expect(onChecklistChange).toHaveBeenCalledTimes(1);
    expect(onChecklistChange.mock.calls[0][0].items.some((item: { label: string; checked: boolean }) => item.label === "チャート根拠を確認した" && item.checked)).toBe(true);
    expect(onJournalChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "候補レビューを根拠メモへ反映" }));
    expect(onJournalChange).toHaveBeenCalledTimes(1);
    expect(onJournalChange.mock.calls[0][0].entryReason).toContain("候補レビュー: NVDA / コール買い");
    expect(JSON.stringify(onJournalChange.mock.calls[0][0])).not.toContain("secret-token");
  });

  it("updates draft review checklist and reflects safe handoff details without overwriting entry reason", () => {
    const onDraftReviewChecklistChange = vi.fn();
    const onJournalChange = vi.fn();
    const candidate = buildCandidate();

    render(
      <CandidateDetailCard
        candidate={candidate}
        onDraftReviewChecklistChange={onDraftReviewChecklistChange}
        onJournalChange={onJournalChange}
        getDefaultJournal={() => ({
          id: "journal-default",
          candidateId: candidate.id,
          symbol: candidate.symbol,
          underlyingName: candidate.company,
          strategy: "custom",
          accountCode: "UNKNOWN",
          status: "candidate",
          createdAt: "2026-07-05T00:00:00.000Z",
          updatedAt: "2026-07-05T00:00:00.000Z",
          entryReason: "ユーザーが書いた理由",
          technicalTags: [],
          technicalMemo: "既存メモ",
          expectedScenario: "",
          profitTakingPlan: "",
          stopLossPlan: "",
          invalidationCondition: "",
          chartEvidence: [],
          review: { outcome: "not_reviewed" },
        })}
      />,
    );

    fireEvent.click(screen.getAllByLabelText(/チャート根拠を確認した/).at(-1)!);
    expect(onDraftReviewChecklistChange).toHaveBeenCalledWith("draft-long-call", "chart_confirmed", true);

    fireEvent.click(screen.getByRole("button", { name: "根拠メモへ反映" }));
    expect(onJournalChange).toHaveBeenCalledTimes(1);
    expect(onJournalChange.mock.calls[0][0].entryReason).toBe("ユーザーが書いた理由");
    expect(onJournalChange.mock.calls[0][0].technicalMemo).toContain("レビュー要約: NVDA");
    expect(onJournalChange.mock.calls[0][0].technicalMemo).toContain("Saxo TraderGO");
    expect(JSON.stringify(onJournalChange.mock.calls[0][0])).not.toContain("secret-token");
    expect(JSON.stringify(onJournalChange.mock.calls[0][0])).not.toContain("/Users/motomichi/private/input.json");
  });

  it("does not crash for legacy candidates without screeningCandidate", () => {
    render(
      <CandidateDetailCard
        candidate={{
          id: "legacy-MSFT",
          source: "legacy_tradingview",
          importedAt: "2026-07-01T09:00:00+09:00",
          rank: 2,
          symbol: "MSFT",
          company: "Microsoft",
          score: 70,
          suggestedUse: "legacy candidate",
        }}
      />,
    );

    expect(screen.getAllByText("MSFT").length).toBeGreaterThan(0);
    expect(screen.getByText("戦略別判定はありません。")).toBeInTheDocument();
    expect(screen.getByText("表示対象の不足・警告はありません。")).toBeInTheDocument();
  });
});
