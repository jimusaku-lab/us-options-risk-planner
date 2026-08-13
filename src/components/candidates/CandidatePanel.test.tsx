import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidatePanel } from "./CandidatePanel";
import type { CandidateSymbol } from "@/types/candidates";

const apiMocks = vi.hoisted(() => ({
  fetchMoomooScreeningStatus: vi.fn(),
  runMoomooScreening: vi.fn(),
  fetchLastMoomooScreeningResult: vi.fn(),
  probeMoomooOptionData: vi.fn(),
}));

vi.mock("@/features/moomoo/moomooScreeningApiClient", () => ({
  ...apiMocks,
  MoomooScreeningApiError: class MoomooScreeningApiError extends Error {
    userMessage: string;
    constructor(message: string, options?: { userMessage?: string }) {
      super(message);
      this.name = "MoomooScreeningApiError";
      this.userMessage = options?.userMessage ?? message;
    }
  },
}));

const baseProps = {
  candidates: [] as CandidateSymbol[],
  importWarnings: [] as string[],
  simulations: [],
  onImport: vi.fn(),
  onClear: vi.fn(),
  onClose: vi.fn(),
  onWatchOnly: vi.fn(),
  onCreateSimulation: vi.fn(),
  onJournalChange: vi.fn(),
  onDraftReviewChecklistChange: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CandidatePanel", () => {
  it("uses moomoo screening wording instead of presenting TradingView as the main source", () => {
    render(<CandidatePanel {...baseProps} />);

    expect(screen.getByRole("heading", { name: "スクリーニング候補" })).toBeInTheDocument();
    expect(screen.getByText(/moomooスクリーニング候補を確認/)).toBeInTheDocument();
    expect(screen.getByText(/ローカル版ではOpenD Read-only取得/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /候補ファイル取込/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "moomoo自動取得" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Option probe" })).toBeInTheDocument();
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
    expect(screen.getByText("コール買い: 候補")).toBeInTheDocument();
    expect(screen.getByText("株価時点不足")).toBeInTheDocument();
    expect(screen.queryByText("long_call: fit")).not.toBeInTheDocument();
    expect(screen.queryByText("priceAsOf")).not.toBeInTheDocument();
  });

  it("shows public screening completeness, chart, strategy suitability, and draft status in the list", () => {
    const candidate: CandidateSymbol = {
      id: "public-MSFT-1",
      source: "manual_import",
      importedAt: "2026-07-04T09:00:00+09:00",
      rank: 1,
      symbol: "MSFT",
      company: "Microsoft",
      priceUSD: 500,
      score: 90,
      suggestedUse: "screening package level_4_draft_ready",
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
        symbol: "MSFT",
        underlyingPrice: 500,
        chartAnalysis: {
          regime: "bullish_continuation",
          confidence: "high",
          primaryTimeframe: "daily",
          timeframes: [],
          reasons: ["chart ok"],
          warnings: [],
          missingFields: [],
        },
      },
      strategySuitability: [
        {
          strategy: "long_call",
          level: "manual_review_required",
          chartRegime: "bullish_continuation",
          confidence: "high",
          reasons: [],
          warnings: [],
          missingFields: [],
          manualReviewReasons: ["check"],
          nextChecks: [],
        },
      ],
      positionDrafts: [
        {
          id: "draft",
          strategy: "long_call",
          status: "draft_ready",
          symbol: "MSFT",
          legs: [],
          requiredCapitalUSD: 1_000,
          maxLossUSD: 1_000,
          availableCashUSD: 2_000,
          warnings: [],
          missingFields: [],
        },
      ],
    };

    render(<CandidatePanel {...baseProps} candidates={[candidate]} />);

    expect(screen.getByText("L4 建玉案レビュー可")).toBeInTheDocument();
    expect(screen.getAllByText("上昇継続").length).toBeGreaterThan(0);
    expect(screen.getByText("信頼度: 高")).toBeInTheDocument();
    expect(screen.getByText("建玉案レビュー可")).toBeInTheDocument();
    expect(screen.getByText("コール買い: 手動確認")).toBeInTheDocument();
    expect(screen.queryByText("bullish_continuation")).not.toBeInTheDocument();
  });

  it("calls onClose from the panel close button", () => {
    const onClose = vi.fn();
    const { getByRole } = render(<CandidatePanel {...baseProps} onClose={onClose} />);

    fireEvent.click(getByRole("button", { name: "スクリーニング候補を閉じる" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("previews moomoo API results without importing until the user applies them", async () => {
    const onImport = vi.fn();
    const previewCandidate: CandidateSymbol = {
      id: "moomoo_opend-NVDA-1",
      source: "moomoo_opend",
      importedAt: "2026-06-30T09:01:00+09:00",
      rank: 1,
      symbol: "NVDA",
      company: "NVIDIA",
      priceUSD: 140,
      score: 0,
      suggestedUse: "screening candidate",
      strategyFitResults: [
        {
          strategy: "long_call",
          fitLevel: "insufficient_data",
          reasons: [],
          warnings: [],
          missingFields: ["optionChainQuality.hasOptionChain"],
          requiredChecks: [],
          numericChecks: [],
        },
      ],
      screeningCandidate: {
        symbol: "NVDA",
        name: "NVIDIA",
        market: "US",
        underlyingPrice: 140,
        dataSource: "moomoo",
        delayStatus: "unknown",
        technicalSnapshot: { trendNotes: [] },
        optionChainQuality: { hasOptionChain: false, qualityWarnings: ["米国オプション相場権限不足"] },
        candidateStrategies: [],
        riskFlags: ["米国オプション権限不足"],
        missingFields: ["optionChainQuality.hasOptionChain"],
      },
    };
    const summary = {
      totalRows: 1,
      importedCount: 1,
      warningCount: 2,
      errorCount: 0,
      source: "moomoo_opend" as const,
      format: "json" as const,
      asOf: "2026-06-30T09:00:00+09:00",
      importedAt: "2026-06-30T09:01:00+09:00",
    };
    apiMocks.runMoomooScreening.mockResolvedValue({
      raw: {
        asOf: "2026-06-30T09:00:00+09:00",
        permissions: { usStock: "ok", usOption: "permission_missing" },
        run: { status: "partial", processedSymbols: 1 },
        warnings: ["米国オプション相場権限不足"],
      },
      importResult: {
        candidates: [previewCandidate],
        warnings: ["米国オプション相場権限不足"],
        summary,
      },
    });

    render(<CandidatePanel {...baseProps} onImport={onImport} />);

    fireEvent.change(screen.getByPlaceholderText("NVDA, MSFT"), { target: { value: "NVDA" } });
    fireEvent.click(screen.getByRole("button", { name: "moomoo自動取得" }));

    await screen.findByText("取得結果プレビュー");
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getByText("権限不足")).toBeInTheDocument();
    expect(screen.getByText(/米国オプション相場権限が不足/)).toBeInTheDocument();
    expect(screen.getAllByText(/データ不足/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "候補リストへ反映" }));

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledWith([previewCandidate], ["米国オプション相場権限不足"], summary);
  });

  it("shows local API startup guidance when status check fails", async () => {
    apiMocks.fetchMoomooScreeningStatus.mockRejectedValue(
      new Error("moomooスクリーニングAPIが起動していません。ローカル版で `npm run dev:moomoo-screening-api` を起動してください。"),
    );

    render(<CandidatePanel {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "状態確認" }));

    await waitFor(() => {
      expect(screen.getByText(/npm run dev:moomoo-screening-api/)).toBeInTheDocument();
    });
  });

  it("shows option data probe permission gate without importing candidates", async () => {
    const onImport = vi.fn();
    apiMocks.probeMoomooOptionData.mockResolvedValue({
      schemaVersion: "us_options_moomoo_option_data_probe.v1",
      readOnly: true,
      asOf: "2026-07-06T09:00:00+09:00",
      status: "permission_missing",
      permissions: { usStock: "unknown", usOption: "permission_missing" },
      checked: {
        symbols: ["NVDA"],
        expirationDateApi: "permission_missing",
        optionScreenApi: "not_checked",
        optionChainApi: "not_checked",
        optionQuoteApi: "not_checked",
      },
      counts: {
        normalizedOptionCandidates: 0,
        candidatesWithBidAsk: 0,
        candidatesWithOiVolume: 0,
        candidatesWithIvGreeks: 0,
      },
      sampleFieldPresence: {
        bid: false,
        ask: false,
        last: false,
        volume: false,
        openInterest: false,
        impliedVolatility: false,
        delta: false,
        gamma: false,
        theta: false,
        vega: false,
      },
      warnings: ["米国オプション相場権限不足"],
    });

    render(<CandidatePanel {...baseProps} onImport={onImport} />);
    fireEvent.change(screen.getByPlaceholderText("NVDA, MSFT"), { target: { value: "NVDA" } });
    fireEvent.click(screen.getByRole("button", { name: "Option probe" }));

    await screen.findByText("オプションデータ確認");
    expect(apiMocks.probeMoomooOptionData).toHaveBeenCalledWith({ symbols: ["NVDA"], maxSymbols: 3 });
    expect(screen.getAllByText("権限不足").length).toBeGreaterThan(0);
    expect(screen.getByText(/成功系として扱いません/)).toBeInTheDocument();
    expect(screen.getByText(/Level 3-4 \/ PositionDraft \/ option quote lookupの成功系/)).toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("runs moomoo stock screening mode as preview only until explicit import", async () => {
    const onImport = vi.fn();
    const previewCandidate: CandidateSymbol = {
      id: "moomoo-opend-NVDA-1",
      source: "moomoo_opend",
      importedAt: "2026-07-05T09:01:00+09:00",
      rank: 1,
      symbol: "NVDA",
      company: "NVIDIA",
      priceUSD: 194,
      marketCapUSD: 4_700_000_000_000,
      relativeVolume: 0.9,
      score: 70,
      suggestedUse: "moomoo local screening level_2_chart_ready",
      screeningCompleteness: {
        level: "level_2_chart_ready",
        canClassifyStrategy: true,
        canAnalyzeChart: true,
        canEvaluateOptionLiquidity: false,
        canCreatePositionDraft: false,
        missingFields: ["optionCandidates.bidAsk"],
        warnings: [],
      },
    };
    apiMocks.runMoomooScreening.mockResolvedValue({
      raw: {
        asOf: "2026-07-05T09:00:00+09:00",
        permissions: { usStock: "ok", usOption: "unknown" },
        run: { status: "ok", processedSymbols: 1 },
        universe: {
          mode: "stock_screen",
          preset: "large_liquid_core",
          screenMatchedCount: 2703,
          screenReturnedCount: 1,
          snapshotRequestedCount: 1,
          historyRequestedCount: 1,
          optionRequestedCount: 0,
          quota: { status: "ok", remain: 97 },
        },
        warnings: [],
      },
      importResult: {
        candidates: [previewCandidate],
        warnings: [],
        summary: {
          totalRows: 1,
          importedCount: 1,
          warningCount: 0,
          errorCount: 0,
          source: "moomoo_opend",
          format: "json",
          asOf: "2026-07-05T09:00:00+09:00",
          importedAt: "2026-07-05T09:01:00+09:00",
        },
      },
    });

    render(<CandidatePanel {...baseProps} onImport={onImport} />);

    fireEvent.click(screen.getByRole("button", { name: "条件でスクリーニング" }));
    fireEvent.change(screen.getByLabelText("プリセット"), { target: { value: "bullish_pullback" } });
    fireEvent.change(screen.getByLabelText("取得上限"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("履歴足上限"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "moomoo自動取得" }));

    await screen.findByText("取得結果プレビュー");
    expect(apiMocks.runMoomooScreening).toHaveBeenCalledWith(expect.objectContaining({
      universeMode: "stock_screen",
      stockScreenPreset: "bullish_pullback",
      maxScreenResults: 12,
      maxHistorySymbols: 4,
      includeOptions: false,
    }));
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.getAllByText("条件でスクリーニング").length).toBeGreaterThan(0);
    expect(screen.queryByText("stock_screen")).not.toBeInTheDocument();
    expect(screen.getByText("2703")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "候補リストへ反映" }));
    expect(onImport).toHaveBeenCalledTimes(1);
  });
});
