import { useRef, useState } from "react";
import { ChevronUp, Database, Download, FileJson, HelpCircle, JapaneseYen, Plus, TrendingUp, Upload } from "lucide-react";
import { calculateNetInitialPremiumJPY } from "@/domain/calculations";
import { calculateDenominators, getPrimaryDenominator } from "@/domain/denominators";
import { calculatePayoffSeries } from "@/domain/payoff";
import { generateChecklist, generateRiskWarnings } from "@/domain/riskRules";
import { calculateScenarioResults } from "@/domain/scenarios";
import { calculateNisaComparison, calculateTaxResult, taxProfiles } from "@/domain/tax";
import { AccountOverview } from "@/components/dashboard/AccountOverview";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { DataPanel } from "@/components/data/DataPanel";
import { FirstRunNotice } from "@/components/help/FirstRunNotice";
import { UserGuide } from "@/components/help/UserGuide";
import { AnnualReturnFormula } from "@/components/results/AnnualReturnFormula";
import { CloseDecisionCard } from "@/components/results/CloseDecisionCard";
import { DenominatorChart, PayoffChart } from "@/components/results/Charts";
import { DenominatorTable } from "@/components/results/DenominatorTable";
import { RiskPanel } from "@/components/results/RiskPanel";
import { ScenarioCards } from "@/components/results/ScenarioCards";
import { SummaryCards } from "@/components/results/SummaryCards";
import { TaxComparisonCard } from "@/components/results/TaxComparisonCard";
import { SimulationEditor } from "@/components/wizard/SimulationEditor";
import { WheelPanel } from "@/components/wheel/WheelPanel";
import { exportSimulationsCsv, exportWorkspaceJson, parseWorkspaceJson } from "@/lib/export";
import { fetchStooqQuote, fetchUsdJpyRate, isExternalQuoteDisabled, normalizeTicker } from "@/lib/marketData";
import { useOptionsStore } from "@/store/useOptionsStore";

export default function App() {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isDataOpen, setIsDataOpen] = useState(false);
  const [hasAcceptedNotice, setHasAcceptedNotice] = useState(() =>
    typeof window === "undefined" ? true : window.localStorage.getItem("us-options-first-run-notice-accepted") === "true",
  );
  const [quoteStatus, setQuoteStatus] = useState("");
  const {
    activeWorkspace,
    accountInputs,
    simulations,
    wheelCycles,
    selectedSimulationId,
    switchWorkspace,
    updateAccountInputs,
    createSimulationFromTemplate,
    selectSimulation,
    deleteSimulation,
    upsertSimulation,
    replaceWorkspaceSimulations,
    createWheelCycleFromSimulation,
  } = useOptionsStore();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const selected = simulations.find((simulation) => simulation.id === selectedSimulationId) ?? simulations[0];
  const refreshAllQuotes = async () => {
    if (isExternalQuoteDisabled) {
      setQuoteStatus("公開版では外部通信を避けるため、株価取得は無効です。現在株価は手入力してください。");
      return;
    }
    const tickers = Array.from(new Set(simulations.map((simulation) => normalizeTicker(simulation.ticker)).filter(Boolean)));
    if (tickers.length === 0) {
      setQuoteStatus("先に建玉の銘柄を入力してください。");
      return;
    }
    setQuoteStatus(`株価を一括取得中... ${tickers.length}銘柄`);
    try {
      const results = await Promise.allSettled(tickers.map(async (ticker) => [ticker, await fetchStooqQuote(ticker)] as const));
      const quoteByTicker = new Map(
        results
          .filter((result): result is PromiseFulfilledResult<readonly [string, Awaited<ReturnType<typeof fetchStooqQuote>>]> => result.status === "fulfilled")
          .map((result) => result.value),
      );
      simulations.forEach((simulation) => {
        const ticker = normalizeTicker(simulation.ticker);
        const quote = quoteByTicker.get(ticker);
        if (quote) {
          upsertSimulation({ ...simulation, ticker, currentPriceUSD: quote.price });
        }
      });
      if (selectedSimulationId) selectSimulation(selectedSimulationId);
      const failedCount = results.filter((result) => result.status === "rejected").length;
      const latestQuote = quoteByTicker.values().next().value;
      setQuoteStatus(
        failedCount > 0
          ? `株価を${quoteByTicker.size}/${tickers.length}銘柄に反映しました。${failedCount}銘柄は取得できませんでした。`
          : `株価を${quoteByTicker.size}銘柄すべてに反映しました。${latestQuote?.date ?? ""} ${latestQuote?.time ?? ""}`,
      );
    } catch (error) {
      setQuoteStatus(error instanceof Error ? error.message : "株価を取得できませんでした。");
    }
  };
  const refreshAllFx = async () => {
    if (isExternalQuoteDisabled) {
      setQuoteStatus("公開版では外部通信を避けるため、為替取得は無効です。USD/JPYは手入力してください。");
      return;
    }
    if (simulations.length === 0) return;
    setQuoteStatus("USD/JPYを一括更新中...");
    try {
      const quote = await fetchUsdJpyRate();
      simulations.forEach((simulation) => {
        upsertSimulation({ ...simulation, fxRateJPY: quote.rate });
      });
      if (selectedSimulationId) selectSimulation(selectedSimulationId);
      setQuoteStatus(
        `USD/JPY ${quote.rate.toLocaleString("en-US", {
          maximumFractionDigits: 3,
        })} を全建玉に反映しました。${quote.date ?? ""} ${quote.time ?? ""}`,
      );
    } catch (error) {
      setQuoteStatus(error instanceof Error ? error.message : "為替を取得できませんでした。");
    }
  };

  const downloadCsv = () => {
    const blob = new Blob([exportSimulationsCsv(simulations)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `us-options-${activeWorkspace}-positions.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const downloadJson = () => {
    const blob = new Blob(
      [
        exportWorkspaceJson({
          workspace: activeWorkspace,
          simulations,
          exportedAt: new Date().toISOString(),
        }),
      ],
      { type: "application/json;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `us-options-${activeWorkspace}-positions.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const importJson = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const imported = parseWorkspaceJson(text);
      replaceWorkspaceSimulations(imported);
      setQuoteStatus(`${imported.length}件の建玉をJSONから復元しました。`);
      setIsEditorOpen(false);
    } catch (error) {
      setQuoteStatus(error instanceof Error ? error.message : "JSONを読み込めませんでした。");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };
  const createAndOpenEditor = () => {
    createSimulationFromTemplate();
    setIsEditorOpen(true);
  };
  const selectAndOpenEditor = (id: string) => {
    selectSimulation(id);
    setIsEditorOpen(true);
  };
  const selectOnly = (id: string) => {
    selectSimulation(id);
    setIsEditorOpen(false);
  };
  const acceptFirstRunNotice = () => {
    window.localStorage.setItem("us-options-first-run-notice-accepted", "true");
    setHasAcceptedNotice(true);
  };

  if (!selected) {
    return (
      <main className="min-h-screen bg-slate-100 text-slate-950">
        {!hasAcceptedNotice ? <FirstRunNotice onAccept={acceptFirstRunNotice} /> : null}
        <AppHeader
          activeWorkspace={activeWorkspace}
          switchWorkspace={switchWorkspace}
          createSimulationFromTemplate={createAndOpenEditor}
          onCsv={downloadCsv}
          onJson={downloadJson}
          onImportJson={() => importInputRef.current?.click()}
          onToggleGuide={() => setIsGuideOpen((current) => !current)}
          onToggleData={() => setIsDataOpen((current) => !current)}
          onRefreshQuote={undefined}
          onRefreshFx={undefined}
          quoteStatus=""
        />
        <input ref={importInputRef} className="hidden" type="file" accept="application/json,.json" onChange={(event) => void importJson(event.target.files?.[0] ?? null)} />
        <div className="mx-auto grid max-w-[1440px] gap-5 px-4 py-5">
          {isGuideOpen ? <UserGuide onClose={() => setIsGuideOpen(false)} /> : null}
          {isDataOpen ? <DataPanel onClose={() => setIsDataOpen(false)} /> : null}
          <Dashboard
            simulations={simulations}
            selectedId=""
            onSelect={selectOnly}
            onEdit={selectAndOpenEditor}
            onDelete={deleteSimulation}
            workspace={activeWorkspace}
            accountInputs={accountInputs}
          />
          <AccountOverview
            workspace={activeWorkspace}
            accountInputs={accountInputs}
            onChange={updateAccountInputs}
          />
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">
              {activeWorkspace === "demo" ? "デモ口座の建玉がありません" : "リアル口座の建玉がありません"}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              デモ口座とリアル口座は別々に保存されます。リアル口座側にはデモサンプルを自動投入しないため、実口座画面を見ながら建玉を新規登録してください。
            </p>
            <button
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
              onClick={createAndOpenEditor}
            >
              <Plus size={16} />
              新規建玉
            </button>
          </section>
          <WheelPanel cycles={wheelCycles} />
        </div>
      </main>
    );
  }

  const selectedWithAccount = {
    ...selected,
    availableCashJPY: accountInputs.availableCashJPY,
    marginUsagePercent: accountInputs.marginUsagePercent,
  };
  const premiumJPY = calculateNetInitialPremiumJPY(selectedWithAccount);
  const grossDenominators = calculateDenominators(selectedWithAccount, premiumJPY);
  const primary = getPrimaryDenominator(grossDenominators);
  const taxProfile = taxProfiles[selected.taxProfileId];
  const taxResult = calculateTaxResult({
    simulation: selectedWithAccount,
    grossProfitJPY: premiumJPY,
    denominatorJPY: primary.amountJPY,
    taxProfile,
  });
  const denominators = calculateDenominators(selectedWithAccount, premiumJPY, taxResult.netProfitJPY);
  const primaryWithNet = getPrimaryDenominator(denominators);
  const nisaComparison = calculateNisaComparison({
    netProfitJPY: taxResult.netProfitJPY,
    denominatorJPY: primary.amountJPY,
    days: selected.dte,
    expectedAnnualReturnPct: selected.nisaExpectedAnnualReturnPct ?? 6,
    taxRatePct: taxProfile.taxRatePct,
  });
  const warnings = generateRiskWarnings(selectedWithAccount);
  const checklist = generateChecklist(selectedWithAccount).map((item) => ({
    ...item,
    passed: selected.preOrderChecklist?.[item.id] ?? false,
  }));
  const updateChecklist = (id: string, checked: boolean) => {
    upsertSimulation({
      ...selected,
      preOrderChecklist: {
        ...(selected.preOrderChecklist ?? {}),
        [id]: checked,
      },
    });
  };
  const scenarios = calculateScenarioResults(selectedWithAccount);
  const payoff = calculatePayoffSeries(selectedWithAccount);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      {!hasAcceptedNotice ? <FirstRunNotice onAccept={acceptFirstRunNotice} /> : null}
      <AppHeader
        activeWorkspace={activeWorkspace}
        switchWorkspace={switchWorkspace}
        createSimulationFromTemplate={createAndOpenEditor}
        onCsv={downloadCsv}
        onJson={downloadJson}
        onImportJson={() => importInputRef.current?.click()}
        onToggleGuide={() => setIsGuideOpen((current) => !current)}
        onToggleData={() => setIsDataOpen((current) => !current)}
        onRefreshQuote={refreshAllQuotes}
        onRefreshFx={refreshAllFx}
        quoteStatus={quoteStatus}
      />
      <input ref={importInputRef} className="hidden" type="file" accept="application/json,.json" onChange={(event) => void importJson(event.target.files?.[0] ?? null)} />
      <div className="mx-auto grid max-w-[1440px] gap-5 px-4 py-5">
        {isGuideOpen ? <UserGuide onClose={() => setIsGuideOpen(false)} /> : null}
        {isDataOpen ? <DataPanel onClose={() => setIsDataOpen(false)} /> : null}
        <Dashboard
          simulations={simulations}
          selectedId={selected.id}
          onSelect={selectOnly}
          onEdit={selectAndOpenEditor}
          onDelete={deleteSimulation}
          workspace={activeWorkspace}
          accountInputs={accountInputs}
        />
        <AccountOverview
          workspace={activeWorkspace}
          accountInputs={accountInputs}
          onChange={updateAccountInputs}
        />
        {isEditorOpen ? (
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <button
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              onClick={() => setIsEditorOpen(false)}
            >
              <span>
                <span className="block text-lg font-bold text-slate-950">建玉入力</span>
                <span className="mt-1 block text-sm text-slate-600">
                  Saxo画面の数値を入力・修正します。閉じると俯瞰画面に戻ります。
                </span>
              </span>
              <span className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
                <ChevronUp size={16} />
                閉じる
              </span>
            </button>
            <div className="border-t border-slate-200 p-4">
              <SimulationEditor simulation={selected} onChange={upsertSimulation} />
            </div>
          </section>
        ) : null}
        <SummaryCards
          simulation={selectedWithAccount}
          primaryDenominator={primaryWithNet}
          taxResult={taxResult}
          blockingCount={warnings.filter((warning) => warning.blocking).length}
        />
        <DenominatorTable denominators={denominators} />
        <AnnualReturnFormula
          simulation={selectedWithAccount}
          primaryDenominator={primaryWithNet}
          taxResult={taxResult}
        />
        <TaxComparisonCard taxResult={taxResult} nisaComparison={nisaComparison} />
        <ScenarioCards scenarios={scenarios} />
        <CloseDecisionCard simulation={selected} onChange={upsertSimulation} />
        <section className="grid gap-4 xl:grid-cols-2">
          <PayoffChart simulation={selectedWithAccount} points={payoff} />
          <DenominatorChart denominators={denominators} />
        </section>
        <RiskPanel warnings={warnings} checklist={checklist} onChecklistChange={updateChecklist} />
        <WheelPanel cycles={wheelCycles} onCreateFromSelected={() => createWheelCycleFromSimulation(selected)} />
      </div>
    </main>
  );
}

function AppHeader({
  activeWorkspace,
  switchWorkspace,
  createSimulationFromTemplate,
  onCsv,
  onJson,
  onImportJson,
  onToggleGuide,
  onToggleData,
  onRefreshQuote,
  onRefreshFx,
  quoteStatus,
}: {
  activeWorkspace: "demo" | "live";
  switchWorkspace: (workspace: "demo" | "live") => void;
  createSimulationFromTemplate: () => void;
  onCsv: () => void;
  onJson: () => void;
  onImportJson: () => void;
  onToggleGuide: () => void;
  onToggleData: () => void;
  onRefreshQuote?: () => void;
  onRefreshFx?: () => void;
  quoteStatus: string;
}) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-normal">米国株オプション建玉管理・リスク確認</h1>
          <p className="mt-1 text-sm text-slate-600">投資助言ではなく、建玉の記録・注文前の試算・資金管理・リスク確認ツールです。</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <div className="flex rounded-md border border-slate-300 bg-slate-50 p-0.5">
            <button
              className={`rounded px-3 py-1.5 text-sm font-bold ${
                activeWorkspace === "demo" ? "bg-sky-600 text-white" : "text-slate-700"
              }`}
              onClick={() => switchWorkspace("demo")}
            >
              DEMO
            </button>
            <button
              className={`rounded px-3 py-1.5 text-sm font-bold ${
                activeWorkspace === "live" ? "bg-red-600 text-white" : "text-slate-700"
              }`}
              onClick={() => switchWorkspace("live")}
            >
              REAL
            </button>
          </div>
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-sm font-semibold text-slate-900"
            onClick={createSimulationFromTemplate}
          >
            <Plus size={16} />
            新規建玉
          </button>
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-900"
            onClick={onToggleGuide}
            title="このアプリの使い方とデータ保存方針を表示"
            aria-label="使い方"
          >
            <HelpCircle size={16} />
          </button>
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-900"
            onClick={onToggleData}
            title="データ管理: この端末に保存された入力データの説明と削除"
            aria-label="データ管理"
          >
            <Database size={16} />
          </button>
          <button
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900 disabled:opacity-40"
            onClick={onRefreshQuote}
            disabled={!onRefreshQuote || isExternalQuoteDisabled}
            title={
              isExternalQuoteDisabled
                ? "公開版では外部通信を避けるため、株価取得は無効です"
                : "登録済み建玉の全銘柄について、現在株価を公開クオートから一括取得"
            }
          >
            <TrendingUp size={16} />
            株価
          </button>
          <button
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900 disabled:opacity-40"
            onClick={onRefreshFx}
            disabled={!onRefreshFx || isExternalQuoteDisabled}
            title={
              isExternalQuoteDisabled
                ? "公開版では外部通信を避けるため、為替取得は無効です"
                : "USD/JPY為替レートを取得し、登録済み建玉すべてに一括反映"
            }
          >
            <JapaneseYen size={16} />
            為替
          </button>
          <button
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900"
            onClick={onCsv}
          >
            <Download size={16} />
            CSV
          </button>
          <button
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900"
            onClick={onJson}
            title="このワークスペースの建玉をJSONでバックアップ"
          >
            <FileJson size={16} />
            JSON
          </button>
          <button
            className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900"
            onClick={onImportJson}
            title="JSONバックアップからこのワークスペースへ復元"
          >
            <Upload size={16} />
            復元
          </button>
        </div>
      </div>
      <div className={activeWorkspace === "demo" ? "bg-sky-50 text-sky-900" : "bg-red-50 text-red-900"}>
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm font-semibold">
          <span>
            {activeWorkspace === "demo"
              ? "DEMO口座ワークスペース: 開発・練習用です。実取引データとは分けて保存します。"
              : "REAL口座ワークスペース: 実資金を前提にした管理用です。DEMOとは別保存です。"}
          </span>
          {quoteStatus ? <span className="font-normal">{quoteStatus}</span> : null}
        </div>
      </div>
    </header>
  );
}
