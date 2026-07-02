import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
    expect(screen.getByText("MACD is bullish")).toBeInTheDocument();
    expect(screen.getByText("earnings date not confirmed")).toBeInTheDocument();
    expect(screen.getAllByText("optionContracts.delta").length).toBeGreaterThan(0);
    expect(screen.getByText("利確ルール")).toBeInTheDocument();
    expect(screen.getByText("Bid/Ask spread")).toBeInTheDocument();
    expect(screen.getAllByText("Bid/Ask spread is wide").length).toBeGreaterThan(0);
    expect(screen.getByText("SlowKD cross detected")).toBeInTheDocument();
    expect(screen.getByText("signal order is valid")).toBeInTheDocument();
    expect(screen.getByText("synthetic delta is high")).toBeInTheDocument();
    expect(screen.getByText("assignment capital shortage")).toBeInTheDocument();
    expect(screen.getByText("assignmentCapitalRequired")).toBeInTheDocument();

    expect(screen.queryByText("secret-token")).not.toBeInTheDocument();
    expect(screen.queryByText("secret-password")).not.toBeInTheDocument();
    expect(screen.queryByText("123456789")).not.toBeInTheDocument();
    expect(screen.queryByText("/Users/motomichi/private/input.json")).not.toBeInTheDocument();
    expect(screen.queryByText("secret-api-key")).not.toBeInTheDocument();
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
