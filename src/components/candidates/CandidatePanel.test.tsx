import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidatePanel } from "./CandidatePanel";
import type { CandidateSymbol } from "@/types/candidates";

const baseProps = {
  candidates: [] as CandidateSymbol[],
  importWarnings: [] as string[],
  simulations: [],
  onImport: vi.fn(),
  onClear: vi.fn(),
  onClose: vi.fn(),
  onWatchOnly: vi.fn(),
  onCreateSimulation: vi.fn(),
};

afterEach(() => {
  cleanup();
});

describe("CandidatePanel", () => {
  it("uses moomoo screening wording instead of presenting TradingView as the main source", () => {
    render(<CandidatePanel {...baseProps} />);

    expect(screen.getByRole("heading", { name: "スクリーニング候補" })).toBeInTheDocument();
    expect(screen.getByText(/moomooスクリーニング候補を確認/)).toBeInTheDocument();
    expect(screen.getByText(/moomoo OpenD連携は後続工程です/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /候補ファイル取込/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "スクリーニング候補を閉じる" })).toBeInTheDocument();
    expect(screen.getByText(/moomoo候補JSON\/CSV、または互換CSV/)).toBeInTheDocument();
    expect(screen.queryByText(/TradingView/)).not.toBeInTheDocument();
    expect(screen.queryByText(/tradingview_candidates/)).not.toBeInTheDocument();
  });

  it("renders candidates with new moomoo source names without breaking actions", () => {
    const candidate: CandidateSymbol = {
      id: "moomoo-NVDA-1",
      source: "moomoo_file_import",
      importedAt: "2026-06-23T00:00:00.000Z",
      rank: 1,
      symbol: "NVDA",
      company: "NVIDIA",
      priceUSD: 110,
      score: 80,
      suggestedUse: "screening candidate",
    };

    render(<CandidatePanel {...baseProps} candidates={[candidate]} />);

    expect(screen.getByText("NVDA")).toBeInTheDocument();
    expect(screen.getByTitle("カバードコール候補として建玉案を作成")).toBeInTheDocument();
    expect(screen.getByTitle("P売り候補として建玉案を作成")).toBeInTheDocument();
    expect(screen.getByTitle("コール買い候補として建玉案を作成")).toBeInTheDocument();
  });

  it("opens and closes candidate detail cards from each row", () => {
    const candidate: CandidateSymbol = {
      id: "moomoo-NVDA-1",
      source: "moomoo_file_import",
      importedAt: "2026-07-01T09:00:00+09:00",
      rank: 1,
      symbol: "NVDA",
      company: "NVIDIA",
      priceUSD: 140,
      score: 80,
      suggestedUse: "screening candidate",
      strategyFitResults: [
        {
          strategy: "long_call",
          fitLevel: "fit",
          reasons: ["MACD is bullish"],
          warnings: ["event date check"],
          missingFields: ["optionContracts.delta"],
          requiredChecks: [{ id: "profit_take", label: "利確ルール", passed: true }],
          numericChecks: [{ id: "spread", label: "Bid/Ask spread", value: 0.08, max: 0.15, passed: true }],
        },
      ],
      screeningCandidate: {
        symbol: "NVDA",
        name: "NVIDIA",
        market: "US",
        underlyingPrice: 140,
        dataSource: "moomoo",
        delayStatus: "delayed",
        technicalSnapshot: { trendNotes: ["trend improving"] },
        optionChainQuality: { hasOptionChain: true, qualityWarnings: ["Bid/Ask spread is wide"] },
        candidateStrategies: [],
        riskFlags: [],
        missingFields: ["optionContracts.delta"],
      },
    };

    render(<CandidatePanel {...baseProps} candidates={[candidate]} />);

    fireEvent.click(screen.getByRole("button", { name: "NVDA 詳細を開く" }));

    expect(screen.getByText("候補詳細")).toBeInTheDocument();
    expect(screen.getByText("MACD is bullish")).toBeInTheDocument();
    expect(screen.getAllByText("Bid/Ask spread is wide").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "NVDA 詳細を閉じる" }));

    expect(screen.queryByText("候補詳細")).not.toBeInTheDocument();
  });

  it("shows import summary and screening fit results", () => {
    const candidate: CandidateSymbol = {
      id: "moomoo-NVDA-1",
      source: "moomoo_file_import",
      importedAt: "2026-06-23T00:00:00.000Z",
      rank: 1,
      symbol: "NVDA",
      company: "NVIDIA",
      priceUSD: 110,
      score: 80,
      suggestedUse: "screening candidate",
      strategyFitResults: [
        {
          strategy: "long_call",
          fitLevel: "fit",
          reasons: [],
          warnings: [],
          missingFields: [],
          requiredChecks: [],
          numericChecks: [],
        },
      ],
      screeningCandidate: {
        symbol: "NVDA",
        name: "NVIDIA",
        market: "US",
        underlyingPrice: 110,
        dataSource: "moomoo",
        delayStatus: "delayed",
        technicalSnapshot: { trendNotes: [] },
        optionChainQuality: { hasOptionChain: true, qualityWarnings: [] },
        candidateStrategies: [],
        riskFlags: [],
        missingFields: ["priceAsOf"],
      },
    };

    render(
      <CandidatePanel
        {...baseProps}
        candidates={[candidate]}
        importSummary={{
          totalRows: 2,
          importedCount: 1,
          warningCount: 1,
          errorCount: 1,
          source: "moomoo_file_import",
          format: "csv",
          asOf: "2026-06-23T00:00:00+09:00",
          importedAt: "2026-06-23T00:00:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("取込済み候補")).toBeInTheDocument();
    expect(screen.getByText("1/2件")).toBeInTheDocument();
    expect(screen.getByText("long_call: fit")).toBeInTheDocument();
    expect(screen.getByText("priceAsOf")).toBeInTheDocument();
  });

  it("calls onClose from the panel close button", () => {
    const onClose = vi.fn();
    const { getByRole } = render(<CandidatePanel {...baseProps} onClose={onClose} />);

    fireEvent.click(getByRole("button", { name: "スクリーニング候補を閉じる" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
