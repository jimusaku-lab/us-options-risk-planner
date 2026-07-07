import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  onJournalChange: vi.fn(),
  onChecklistChange: vi.fn(),
  onDraftReviewChecklistChange: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CandidatePanel", () => {
  it("uses moomoo screening wording instead of presenting TradingView as the main source", () => {
    render(<CandidatePanel {...baseProps} />);

    expect(screen.getByRole("heading", { name: "スクリーニング候補" })).toBeInTheDocument();
    expect(screen.getByText(/持ち込みデータからスクリーニング候補を確認/)).toBeInTheDocument();
    expect(screen.getByText(/外部自動取得に接続せず/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /候補ファイル取込/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "サンプルを読み込む" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "サンプルJSONを開く" })).toHaveAttribute("href", "/samples/us-options-screening-sample-levels-v1.json");
    expect(screen.getByRole("button", { name: "スクリーニング候補を閉じる" })).toBeInTheDocument();
    expect(screen.getByText(/まずはサンプルで候補画面を試せます/)).toBeInTheDocument();
    expect(screen.getByText(/候補は売買推奨ではなく確認用の分類/)).toBeInTheDocument();
    expect(screen.queryByText(/TradingView/)).not.toBeInTheDocument();
    expect(screen.queryByText(/tradingview_candidates/)).not.toBeInTheDocument();
  });

  it("loads the bundled public sample through the existing import path", async () => {
    const onImport = vi.fn();
    const samplePackage = {
      schemaVersion: "us_options_screening_package.v1",
      generatedAt: "2026-07-05T09:30:00+09:00",
      source: "manual",
      dataPolicy: { userProvided: true, containsCredentials: false, redistributionChecked: true },
      candidates: [
        {
          symbol: "PSAMPLE",
          name: "Public Sample",
          market: "US",
          underlyingPrice: 100,
          priceAsOf: "2026-07-05T09:30:00+09:00",
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify(samplePackage),
    })));

    render(<CandidatePanel {...baseProps} onImport={onImport} />);

    fireEvent.click(screen.getAllByRole("button", { name: "サンプルを読み込む" })[0]);

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith("/samples/us-options-screening-sample-levels-v1.json", { cache: "no-store" });
    expect(onImport.mock.calls[0][0][0]).toMatchObject({ symbol: "PSAMPLE", company: "Public Sample" });
    expect(screen.getByText(/サンプル読込済み 1\/1件/)).toBeInTheDocument();
  });

  it("shows a status message when bundled sample loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => "",
    })));

    render(<CandidatePanel {...baseProps} />);

    fireEvent.click(screen.getAllByRole("button", { name: "サンプルを読み込む" })[0]);

    expect(await screen.findByText(/サンプルJSONを取得できませんでした。HTTP 404/)).toBeInTheDocument();
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
    expect(screen.getAllByText("確認優先度").length).toBeGreaterThan(0);
    expect(screen.getAllByText("コール買い").length).toBeGreaterThan(0);
    expect(screen.getByText("未確認事項")).toBeInTheDocument();
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
    expect(screen.getAllByText(/上昇継続/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/信頼度: 高/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/bullish_continuation/)).not.toBeInTheDocument();
    expect(screen.getAllByText("建玉案レビュー可").length).toBeGreaterThan(0);
    expect(screen.getByText(/コール買い \/ 手動確認/)).toBeInTheDocument();
    expect(screen.getByText("上位理由")).toBeInTheDocument();
    expect(screen.getByText("減点理由")).toBeInTheDocument();
    expect(screen.getByText("未確認事項")).toBeInTheDocument();
  });

  it("shows review state and requires explicit proceed when required checks are unfinished", () => {
    const onCreateSimulation = vi.fn();
    const candidate: CandidateSymbol = {
      id: "public-MSFT-review",
      source: "manual_import",
      importedAt: "2026-07-05T09:00:00+09:00",
      rank: 1,
      symbol: "MSFT",
      company: "Microsoft",
      priceUSD: 500,
      score: 90,
      suggestedUse: "long call review",
      strategyPrecisionReviews: [
        {
          strategy: "long_call",
          level: "manual_review_required",
          chartGate: { level: "pass", reasons: ["週足が上向き"], warnings: [] },
          expiryReview: { level: "pass", targetDteRange: [150, 9999], actualDte: 180, reasons: ["DTE ok"], warnings: [] },
          strikeReview: { level: "pass", targetStrikeRatioRange: [1, 1.05], actualStrikeRatio: 1.02, reasons: ["strike ok"], warnings: [] },
          liquidityReview: { level: "pass", reasons: ["Askあり"], warnings: [] },
          capitalReview: { level: "pass", reasons: ["最大損失確認"], warnings: [] },
          manualReviewReasons: [],
          avoidReasons: [],
          nextChecks: [],
          checklist: ["チャート根拠を確認した", "証券会社画面の価格を最終確認する"],
        },
      ],
    };

    render(<CandidatePanel {...baseProps} candidates={[candidate]} onCreateSimulation={onCreateSimulation} />);

    expect(screen.getAllByText("要確認").length).toBeGreaterThan(0);
    expect(screen.getByText((_, element) => element?.textContent === "確認0/2 必須未確認 2")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("コール買い候補として建玉案を作成"));

    expect(screen.getByRole("dialog", { name: "建玉案レビュー前確認" })).toBeInTheDocument();
    expect(onCreateSimulation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "未確認を理解して建玉案レビューへ進む" }));

    expect(onCreateSimulation).toHaveBeenCalledWith(candidate, "long_call");
  });

  it("calls onClose from the panel close button", () => {
    const onClose = vi.fn();
    const { getByRole } = render(<CandidatePanel {...baseProps} onClose={onClose} />);

    fireEvent.click(getByRole("button", { name: "スクリーニング候補を閉じる" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
