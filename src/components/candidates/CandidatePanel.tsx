import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Eye, FileUp, ListFilter, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import type { CandidateImportResult, CandidateImportSummary, CandidateSymbol } from "@/types/candidates";
import type { EntryRationaleJournal, TradeSimulation } from "@/types/domain";
import type { PositionDraftReviewChecklistId, PositionDraftStatus, PublicStrategyFitLevel, ScreeningCompletenessLevel } from "@/types/screening";
import { createJournalForCandidate, getJournalStatusLabel } from "@/domain/entryRationaleJournal";
import {
  screeningDisplayItems,
  screeningDisplayLabel,
  screeningDisplayValue,
  screeningMissingFieldLabel,
  screeningStrategyLabel,
} from "@/domain/screeningDisplayLabels";
import {
  defaultScreeningFilters,
  filterAndSortScreeningCandidates,
  targetStrategyOptions,
  type SavedScreeningConditionSet,
  type ScreeningFilterState,
} from "@/domain/screeningFilters";
import {
  buildScreeningPriorityReviewMap,
  priorityBandLabel,
  selectPriorityReview,
  type ScreeningPriorityBand,
  type ScreeningPriorityReview,
} from "@/domain/screeningPriority";
import { parseCandidateImport } from "@/lib/candidates";
import { formatUSD } from "@/lib/format";
import { CandidateDetailCard } from "./CandidateDetailCard";
import {
  fetchLastMoomooScreeningResult,
  fetchMoomooScreeningStatus,
  MoomooScreeningApiError,
  probeMoomooOptionData,
  runMoomooScreening,
  type MoomooOptionDataProbeSummary,
  type MoomooScreeningImportPreview,
  type MoomooScreeningStatusResponse,
  type MoomooScreeningUniverseMode,
  type MoomooStockScreenPreset,
} from "@/features/moomoo/moomooScreeningApiClient";

function formatCompact(value?: number): string {
  if (value === undefined) return "-";
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercentValue(value?: number): string {
  if (value === undefined) return "-";
  return `${value.toFixed(2)}%`;
}

function parseSymbolsInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/)
        .map((item) => item.trim().toUpperCase().replace(/^US\./, ""))
        .filter(Boolean),
    ),
  ).slice(0, 50);
}

function permissionLabel(value?: string): string {
  if (value === "ok") return "ok";
  if (value === "permission_missing") return "権限不足";
  return value || "unknown";
}

function textValue(value: unknown, fallback = "-"): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function completenessLabel(level?: ScreeningCompletenessLevel): string {
  return level ? screeningDisplayLabel("completeness", level) : "-";
}

function strategySuitabilityLabel(level: PublicStrategyFitLevel): string {
  return screeningDisplayLabel("publicFitLevel", level);
}

function positionDraftStatusLabel(status?: PositionDraftStatus): string {
  return status ? screeningDisplayLabel("positionDraftStatus", status) : "建玉案なし";
}

function summarizePreview(importResult: CandidateImportResult): string {
  const summary = importResult.summary;
  return summary
    ? `正規化候補 ${summary.importedCount}/${summary.totalRows}件、要確認 ${summary.warningCount}件、エラー ${summary.errorCount}件`
    : `正規化候補 ${importResult.candidates.length}件`;
}

const stockScreenPresetLabels: Record<MoomooStockScreenPreset, string> = {
  large_liquid_core: "大型・高流動性",
  upside_reversal_watch: "上昇転換監視",
  bullish_pullback: "上昇押し目",
  income_quality_watch: "配当・品質監視",
};

type MoomooFetchProfile = "quick" | "standard" | "deep" | "custom";

const FILTER_STORAGE_KEY = "us-options-local-screening-ranking-filters-v1";
const CONDITION_STORAGE_KEY = "us-options-local-screening-condition-sets-v1";
type CandidateDraftStrategy = "covered_call" | "short_put" | "long_call";

const fetchProfiles: Record<Exclude<MoomooFetchProfile, "custom">, {
  label: string;
  maxScreenResults: number;
  maxHistorySymbols: number;
  includeOptions: boolean;
  note: string;
}> = {
  quick: { label: "簡易", maxScreenResults: 20, maxHistorySymbols: 5, includeOptions: false, note: "小さく試す" },
  standard: { label: "標準", maxScreenResults: 50, maxHistorySymbols: 20, includeOptions: false, note: "通常確認" },
  deep: { label: "詳細", maxScreenResults: 100, maxHistorySymbols: 40, includeOptions: false, note: "候補を広く確認" },
};

function readFilters(): ScreeningFilterState {
  if (typeof window === "undefined") return defaultScreeningFilters;
  try {
    return { ...defaultScreeningFilters, ...(JSON.parse(window.localStorage.getItem(FILTER_STORAGE_KEY) ?? "{}") as Partial<ScreeningFilterState>) };
  } catch {
    return defaultScreeningFilters;
  }
}

function readConditionSets(): SavedScreeningConditionSet[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONDITION_STORAGE_KEY) ?? "[]") as SavedScreeningConditionSet[];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function truncateName(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 28 ? `${trimmed.slice(0, 28)}...` : trimmed;
}

function priorityBandClass(review?: ScreeningPriorityReview): string {
  if (review?.band === "primary_watch") return "border-teal-200 bg-teal-50 text-teal-900";
  if (review?.band === "secondary_watch") return "border-sky-200 bg-sky-50 text-sky-900";
  if (review?.band === "manual_review") return "border-amber-200 bg-amber-50 text-amber-950";
  if (review?.band === "avoid") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function shortList(items?: string[], fallback = "-", displayKind?: string): string {
  const displayItems = displayKind ? screeningDisplayItems(displayKind, items) : items;
  return displayItems?.length ? displayItems.slice(0, 2).join(" / ") : fallback;
}

function sortLabel(value: ScreeningFilterState["sort"]): string {
  if (value === "priority") return "確認優先度";
  if (value === "candidate_score") return "候補スコア";
  if (value === "chart_confidence" || value === "chart") return "チャート信頼度";
  if (value === "screening_rank" || value === "import_order") return "取得順";
  if (value === "market_cap") return "時価総額";
  if (value === "volume") return "出来高";
  if (value === "completeness") return "データ充足";
  if (value === "liquidity") return "流動性";
  if (value === "capital") return "資金条件";
  return "銘柄";
}

function MoomooOptionToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs font-bold text-teal-950">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      オプション取得を試す
    </label>
  );
}

export function CandidatePanel({
  candidates,
  importWarnings,
  importSummary,
  simulations,
  onImport,
  onClear,
  onClose,
  onWatchOnly,
  onCreateSimulation,
  onJournalChange,
  onDraftReviewChecklistChange,
}: {
  candidates: CandidateSymbol[];
  importWarnings: string[];
  importSummary?: CandidateImportSummary;
  simulations: TradeSimulation[];
  onImport: (candidates: CandidateSymbol[], warnings: string[], summary?: CandidateImportSummary) => void;
  onClear: () => void;
  onClose: () => void;
  onWatchOnly: (id: string, watchOnly: boolean) => void;
  onCreateSimulation: (candidate: CandidateSymbol, strategy: CandidateDraftStrategy) => void;
  onJournalChange: (candidateId: string, journal: EntryRationaleJournal) => void;
  onDraftReviewChecklistChange: (candidateId: string, draftId: string, itemId: PositionDraftReviewChecklistId, checked: boolean) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState("");
  const [filters, setFilters] = useState<ScreeningFilterState>(() => readFilters());
  const [savedConditionSets, setSavedConditionSets] = useState<SavedScreeningConditionSet[]>(() => readConditionSets());
  const [saveName, setSaveName] = useState("");
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [moomooUniverseMode, setMoomooUniverseMode] = useState<MoomooScreeningUniverseMode>("symbols");
  const [moomooSymbolsInput, setMoomooSymbolsInput] = useState("NVDA, MSFT, AAPL, AMZN, GOOGL");
  const [moomooMaxSymbols, setMoomooMaxSymbols] = useState(5);
  const [moomooStockScreenPreset, setMoomooStockScreenPreset] = useState<MoomooStockScreenPreset>("large_liquid_core");
  const [moomooFetchProfile, setMoomooFetchProfile] = useState<MoomooFetchProfile>("quick");
  const [moomooMaxScreenResults, setMoomooMaxScreenResults] = useState(20);
  const [moomooMaxHistorySymbols, setMoomooMaxHistorySymbols] = useState(5);
  const [moomooMaxOptionSymbols, setMoomooMaxOptionSymbols] = useState(3);
  const [moomooIncludeOptions, setMoomooIncludeOptions] = useState(false);
  const [moomooLoading, setMoomooLoading] = useState(false);
  const [moomooStatus, setMoomooStatus] = useState<MoomooScreeningStatusResponse | null>(null);
  const [moomooPreview, setMoomooPreview] = useState<MoomooScreeningImportPreview | null>(null);
  const [moomooOptionProbe, setMoomooOptionProbe] = useState<MoomooOptionDataProbeSummary | null>(null);
  const [moomooMessage, setMoomooMessage] = useState("");
  const [draftGate, setDraftGate] = useState<{ candidate: CandidateSymbol; strategy: CandidateDraftStrategy } | null>(null);
  const existingSymbols = useMemo(
    () => new Set(simulations.map((simulation) => simulation.ticker.trim().toUpperCase()).filter(Boolean)),
    [simulations],
  );
  const priorityReviewsByCandidateId = useMemo(
    () => buildScreeningPriorityReviewMap(candidates, { existingSymbols }),
    [candidates, existingSymbols],
  );
  const visibleCandidates = useMemo(
    () => filterAndSortScreeningCandidates(candidates, priorityReviewsByCandidateId, filters),
    [candidates, filters, priorityReviewsByCandidateId],
  );
  const previewCandidates = moomooPreview?.importResult.candidates ?? [];
  const previewWarnings = moomooPreview?.importResult.warnings ?? [];
  const previewPriorityReviewsByCandidateId = useMemo(
    () => buildScreeningPriorityReviewMap(previewCandidates, { existingSymbols }),
    [previewCandidates, existingSymbols],
  );

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  const updateFilters = (partial: Partial<ScreeningFilterState>) => {
    setFilters((current) => ({ ...current, ...partial }));
  };

  const resetFilters = () => {
    setFilters(defaultScreeningFilters);
    setStatus("ランキング条件をリセットしました。");
  };

  const importFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const result = parseCandidateImport(text, file.name);
      onImport(result.candidates, result.warnings, result.summary);
      setStatus(
        result.summary
          ? `取込済み候補 ${result.summary.importedCount}/${result.summary.totalRows}件、要確認 ${result.summary.warningCount}件、エラー ${result.summary.errorCount}件`
          : `${result.candidates.length}件の候補を読み込みました。`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "候補ファイルを読み込めませんでした。");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const setSymbolsFromCandidates = () => {
    const symbols = Array.from(new Set(candidates.map((candidate) => candidate.symbol).filter(Boolean))).slice(0, 50);
    if (symbols.length > 0) setMoomooSymbolsInput(symbols.join(", "));
  };

  const applyFetchProfile = (profile: MoomooFetchProfile) => {
    setMoomooFetchProfile(profile);
    if (profile === "custom") return;
    const selected = fetchProfiles[profile];
    setMoomooMaxScreenResults(selected.maxScreenResults);
    setMoomooMaxHistorySymbols(selected.maxHistorySymbols);
    setMoomooIncludeOptions(selected.includeOptions);
  };

  const markCustomProfile = () => {
    setMoomooFetchProfile("custom");
  };

  const saveCurrentConditionSet = () => {
    const saved: SavedScreeningConditionSet = {
      id: `condition-${Date.now()}`,
      name: truncateName(saveName || `条件セット ${savedConditionSets.length + 1}`),
      savedAt: new Date().toISOString(),
      filters,
      moomoo: {
        mode: moomooUniverseMode,
        stockScreenPreset: moomooStockScreenPreset,
        fetchProfile: moomooFetchProfile,
        maxScreenResults: moomooMaxScreenResults,
        maxHistorySymbols: moomooMaxHistorySymbols,
        maxOptionSymbols: moomooMaxOptionSymbols,
        includeOptions: moomooIncludeOptions,
      },
    };
    const next = [saved, ...savedConditionSets.filter((item) => item.name !== saved.name)].slice(0, 8);
    setSavedConditionSets(next);
    if (typeof window !== "undefined") window.localStorage.setItem(CONDITION_STORAGE_KEY, JSON.stringify(next));
    setSaveName("");
    setStatus(`条件セット「${saved.name}」を保存しました。`);
  };

  const restoreConditionSet = (id: string) => {
    const saved = savedConditionSets.find((item) => item.id === id);
    if (!saved) return;
    setFilters({ ...defaultScreeningFilters, ...saved.filters });
    if (saved.moomoo?.mode === "symbols" || saved.moomoo?.mode === "stock_screen") setMoomooUniverseMode(saved.moomoo.mode);
    if (saved.moomoo?.stockScreenPreset && saved.moomoo.stockScreenPreset in stockScreenPresetLabels) setMoomooStockScreenPreset(saved.moomoo.stockScreenPreset as MoomooStockScreenPreset);
    if (saved.moomoo?.fetchProfile && ["quick", "standard", "deep", "custom"].includes(saved.moomoo.fetchProfile)) setMoomooFetchProfile(saved.moomoo.fetchProfile as MoomooFetchProfile);
    if (typeof saved.moomoo?.maxScreenResults === "number") setMoomooMaxScreenResults(saved.moomoo.maxScreenResults);
    if (typeof saved.moomoo?.maxHistorySymbols === "number") setMoomooMaxHistorySymbols(saved.moomoo.maxHistorySymbols);
    if (typeof saved.moomoo?.maxOptionSymbols === "number") setMoomooMaxOptionSymbols(saved.moomoo.maxOptionSymbols);
    if (typeof saved.moomoo?.includeOptions === "boolean") setMoomooIncludeOptions(saved.moomoo.includeOptions);
    setStatus(`条件セット「${saved.name}」を復元しました。`);
  };

  const deleteConditionSet = (id: string) => {
    const next = savedConditionSets.filter((item) => item.id !== id);
    setSavedConditionSets(next);
    if (typeof window !== "undefined") window.localStorage.setItem(CONDITION_STORAGE_KEY, JSON.stringify(next));
    setStatus("条件セットを削除しました。");
  };

  const handleMoomooError = (error: unknown) => {
    setMoomooMessage(
      error instanceof MoomooScreeningApiError
        ? error.userMessage
        : error instanceof Error
          ? error.message
          : "moomooスクリーニングAPIでエラーが発生しました。",
    );
  };

  const checkMoomooStatus = async () => {
    setMoomooLoading(true);
    setMoomooMessage("");
    try {
      const response = await fetchMoomooScreeningStatus();
      setMoomooStatus(response);
      const opendMessage = response.status?.opend?.listening === false ? "OpenD未起動" : "OpenD確認済み";
      const sdkMessage = response.status?.sdk?.status === "missing" ? "SDK未導入" : "SDK確認済み";
      setMoomooMessage(`状態確認: ${opendMessage} / ${sdkMessage}`);
    } catch (error) {
      handleMoomooError(error);
    } finally {
      setMoomooLoading(false);
    }
  };

  const runMoomoo = async () => {
    const symbols = parseSymbolsInput(moomooSymbolsInput);
    if (moomooUniverseMode === "symbols" && symbols.length === 0) {
      setMoomooMessage("取得対象銘柄を入力してください。");
      return;
    }
    setMoomooLoading(true);
    setMoomooMessage("");
    try {
      const preview = await runMoomooScreening({
        universeMode: moomooUniverseMode,
        symbols: moomooUniverseMode === "symbols" ? symbols : undefined,
        maxSymbols: Math.min(Math.max(1, moomooMaxSymbols), 50),
        includeOptions: moomooIncludeOptions,
        stockScreenPreset: moomooStockScreenPreset,
        maxScreenResults: Math.min(Math.max(1, moomooMaxScreenResults), 200),
        maxHistorySymbols: Math.min(Math.max(0, moomooMaxHistorySymbols), 50),
        maxOptionSymbols: Math.min(Math.max(0, moomooMaxOptionSymbols), 10),
      });
      setMoomooPreview(preview);
      setMoomooMessage(`取得結果をプレビューしました。${summarizePreview(preview.importResult)}`);
    } catch (error) {
      handleMoomooError(error);
    } finally {
      setMoomooLoading(false);
    }
  };

  const runOptionDataProbe = async () => {
    const symbols = parseSymbolsInput(moomooSymbolsInput);
    if (symbols.length === 0) {
      setMoomooMessage("Option probe対象銘柄を入力してください。");
      return;
    }
    setMoomooLoading(true);
    setMoomooMessage("");
    try {
      const probe = await probeMoomooOptionData({ symbols: symbols.slice(0, 5), maxSymbols: Math.min(Math.max(1, moomooMaxOptionSymbols || 1), 5) });
      setMoomooOptionProbe(probe);
      setMoomooMessage(
        probe.status === "ok"
          ? `Option probe完了: Bid/Ask ${probe.counts.candidatesWithBidAsk ?? 0}件 / OI+Volume ${probe.counts.candidatesWithOiVolume ?? 0}件 / IV+Greeks ${probe.counts.candidatesWithIvGreeks ?? 0}件`
          : probe.status === "permission_missing"
            ? "Option probe: 米国オプション相場権限不足です。成功系として扱いません。"
            : `Option probe: ${probe.status}`,
      );
    } catch (error) {
      handleMoomooError(error);
    } finally {
      setMoomooLoading(false);
    }
  };

  const loadLastMoomooResult = async () => {
    setMoomooLoading(true);
    setMoomooMessage("");
    try {
      const preview = await fetchLastMoomooScreeningResult();
      setMoomooPreview(preview);
      setMoomooMessage(`前回結果をプレビューしました。${summarizePreview(preview.importResult)}`);
    } catch (error) {
      handleMoomooError(error);
    } finally {
      setMoomooLoading(false);
    }
  };

  const importMoomooPreview = () => {
    if (!moomooPreview) return;
    onImport(moomooPreview.importResult.candidates, moomooPreview.importResult.warnings, moomooPreview.importResult.summary);
    setStatus(
      moomooPreview.importResult.summary
        ? `moomoo取得候補 ${moomooPreview.importResult.summary.importedCount}/${moomooPreview.importResult.summary.totalRows}件を反映しました。`
        : `moomoo取得候補 ${moomooPreview.importResult.candidates.length}件を反映しました。`,
    );
    setMoomooMessage("プレビュー結果を候補リストへ反映しました。");
  };

  const requestCreateSimulation = (candidate: CandidateSymbol, strategy: CandidateDraftStrategy) => {
    setDraftGate({ candidate, strategy });
  };

  const proceedDraftGate = () => {
    if (!draftGate) return;
    onCreateSimulation(draftGate.candidate, draftGate.strategy);
    setDraftGate(null);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">スクリーニング候補</h2>
          <p className="mt-1 text-sm text-slate-600">
            moomooスクリーニング候補を確認し、建玉案の入口を作ります。ローカル版ではOpenD Read-only取得とJSON/CSV取込を使えます。
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            取得結果はプレビューで確認してから候補リストへ反映します。自動発注はありません。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp size={16} />
            候補ファイル取込
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 disabled:opacity-40"
            disabled={candidates.length === 0}
            onClick={onClear}
          >
            <Trash2 size={16} />
            クリア
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 hover:border-slate-400 hover:bg-slate-50"
            aria-label="スクリーニング候補を閉じる"
            onClick={onClose}
          >
            <X size={16} />
            閉じる
          </button>
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept="application/json,text/csv,.json,.csv"
            onChange={(event) => void importFile(event.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      <section className="mt-4 rounded-md border border-teal-200 bg-teal-50/60 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-teal-950">moomoo自動取得</h3>
            <p className="mt-1 text-xs leading-5 text-teal-900">
              ローカルRead-only APIから取得します。反映ボタンを押すまで候補リストは置き換えません。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-md border border-teal-300 bg-white px-3 py-2 text-xs font-bold text-teal-900 hover:bg-teal-50 disabled:opacity-50"
              disabled={moomooLoading}
              onClick={() => void checkMoomooStatus()}
            >
              状態確認
            </button>
            <button
              className="rounded-md border border-teal-300 bg-white px-3 py-2 text-xs font-bold text-teal-900 hover:bg-teal-50 disabled:opacity-50"
              disabled={moomooLoading}
              onClick={() => void loadLastMoomooResult()}
            >
              前回結果を読み込み
            </button>
            <button
              className="rounded-md border border-teal-300 bg-white px-3 py-2 text-xs font-bold text-teal-900 hover:bg-teal-50 disabled:opacity-50"
              disabled={moomooLoading}
              onClick={() => void runOptionDataProbe()}
            >
              Option probe
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(["symbols", "stock_screen"] as const).map((mode) => (
            <button
              key={mode}
              className={`rounded-md border px-3 py-2 text-xs font-bold ${
                moomooUniverseMode === mode
                  ? "border-teal-700 bg-teal-700 text-white"
                  : "border-teal-300 bg-white text-teal-900 hover:bg-teal-50"
              }`}
              type="button"
              onClick={() => setMoomooUniverseMode(mode)}
            >
              {mode === "symbols" ? "銘柄を指定" : "条件でスクリーニング"}
            </button>
          ))}
        </div>

        {moomooUniverseMode === "symbols" ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_120px_150px_auto]">
            <label className="text-xs font-bold text-teal-950">
              銘柄
              <textarea
                className="mt-1 h-20 w-full resize-none rounded-md border border-teal-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-teal-600"
                value={moomooSymbolsInput}
                placeholder="NVDA, MSFT"
                onChange={(event) => setMoomooSymbolsInput(event.target.value)}
              />
            </label>
            <label className="text-xs font-bold text-teal-950">
              最大取得数
              <input
                className="mt-1 h-10 w-full rounded-md border border-teal-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-teal-600"
                type="number"
                min={1}
                max={50}
                value={moomooMaxSymbols}
                onChange={(event) => setMoomooMaxSymbols(Math.min(50, Math.max(1, Number(event.target.value) || 1)))}
              />
            </label>
            <div className="flex items-center pt-5">
              <MoomooOptionToggle checked={moomooIncludeOptions} onChange={setMoomooIncludeOptions} />
            </div>
            <div className="flex flex-col justify-end gap-2">
              {candidates.length > 0 ? (
                <button
                  className="rounded-md border border-teal-300 bg-white px-3 py-2 text-xs font-bold text-teal-900 hover:bg-teal-50"
                  onClick={setSymbolsFromCandidates}
                >
                  候補リストから銘柄を使う
                </button>
              ) : null}
              <button
                className="rounded-md bg-teal-700 px-3 py-2 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-50"
                disabled={moomooLoading}
                onClick={() => void runMoomoo()}
              >
                {moomooLoading ? "取得中" : "moomoo自動取得"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_140px_120px_120px_150px_150px_auto]">
            <label className="text-xs font-bold text-teal-950">
              プリセット
              <select
                className="mt-1 h-10 w-full rounded-md border border-teal-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-teal-600"
                value={moomooStockScreenPreset}
                onChange={(event) => setMoomooStockScreenPreset(event.target.value as MoomooStockScreenPreset)}
              >
                {(Object.keys(stockScreenPresetLabels) as MoomooStockScreenPreset[]).map((preset) => (
                  <option key={preset} value={preset}>{stockScreenPresetLabels[preset]}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-teal-950">
              取得プロファイル
              <select
                className="mt-1 h-10 w-full rounded-md border border-teal-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-teal-600"
                value={moomooFetchProfile}
                onChange={(event) => applyFetchProfile(event.target.value as MoomooFetchProfile)}
              >
                <option value="quick">簡易 20/5</option>
                <option value="standard">標準 50/20</option>
                <option value="deep">詳細 100/40</option>
                <option value="custom">カスタム</option>
              </select>
            </label>
            <label className="text-xs font-bold text-teal-950">
              取得上限
              <input
                className="mt-1 h-10 w-full rounded-md border border-teal-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-teal-600"
                type="number"
                min={1}
                max={200}
                value={moomooMaxScreenResults}
                onChange={(event) => {
                  markCustomProfile();
                  setMoomooMaxScreenResults(Math.min(200, Math.max(1, Number(event.target.value) || 1)));
                }}
              />
            </label>
            <label className="text-xs font-bold text-teal-950">
              履歴足上限
              <input
                className="mt-1 h-10 w-full rounded-md border border-teal-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-teal-600"
                type="number"
                min={0}
                max={50}
                value={moomooMaxHistorySymbols}
                onChange={(event) => {
                  markCustomProfile();
                  setMoomooMaxHistorySymbols(Math.min(50, Math.max(0, Number(event.target.value) || 0)));
                }}
              />
            </label>
            <div className="flex items-center pt-5">
              <MoomooOptionToggle checked={moomooIncludeOptions} onChange={(checked) => {
                markCustomProfile();
                setMoomooIncludeOptions(checked);
              }} />
            </div>
            {moomooIncludeOptions ? (
              <label className="text-xs font-bold text-teal-950">
                Option上限
                <input
                  className="mt-1 h-10 w-full rounded-md border border-teal-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-teal-600"
                  type="number"
                  min={0}
                  max={10}
                  value={moomooMaxOptionSymbols}
                  onChange={(event) => {
                    markCustomProfile();
                    setMoomooMaxOptionSymbols(Math.min(10, Math.max(0, Number(event.target.value) || 0)));
                  }}
                />
              </label>
            ) : <div />}
            <div className="flex flex-col justify-end">
              <button
                className="rounded-md bg-teal-700 px-3 py-2 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-50"
                disabled={moomooLoading}
                onClick={() => void runMoomoo()}
              >
                {moomooLoading ? "取得中" : "moomoo自動取得"}
              </button>
            </div>
            <div className="lg:col-span-7 rounded-md border border-teal-200 bg-white px-3 py-2 text-xs leading-5 text-teal-950">
              予想取得規模: スクリーニング {moomooMaxScreenResults}件 / 履歴足 {moomooMaxHistorySymbols}件 / オプション {moomooIncludeOptions ? moomooMaxOptionSymbols : 0}件。履歴足は全候補には取得しません。{moomooFetchProfile !== "custom" ? ` ${fetchProfiles[moomooFetchProfile].note}` : " カスタム条件です。"}
            </div>
          </div>
        )}

        {moomooMessage ? (
          <div className="mt-3 rounded-md border border-teal-200 bg-white px-3 py-2 text-xs font-semibold leading-5 text-teal-950">
            {moomooMessage}
          </div>
        ) : null}

        {moomooStatus ? (
          <div className="mt-3 grid gap-2 rounded-md border border-teal-200 bg-white p-3 text-xs text-slate-700 md:grid-cols-4">
            <div>
              <div className="font-bold text-slate-900">API状態</div>
              <div>{moomooStatus.status?.state ?? "-"}</div>
            </div>
            <div>
              <div className="font-bold text-slate-900">OpenD</div>
              <div>{moomooStatus.status?.opend?.listening ? "起動中" : "未起動"}</div>
            </div>
            <div>
              <div className="font-bold text-slate-900">SDK</div>
              <div>{moomooStatus.status?.sdk?.status ?? "-"}</div>
            </div>
            <div>
              <div className="font-bold text-slate-900">米国オプション</div>
              <div>{permissionLabel(moomooStatus.permissions?.usOption)}</div>
            </div>
          </div>
        ) : null}

        {moomooOptionProbe ? (
          <div className="mt-3 rounded-md border border-teal-200 bg-white p-3 text-xs text-slate-700">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-950">オプションデータ確認</div>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  Bid/Ask/OI/Volume/IV/Greeksの取得可否だけをread-onlyで確認します。raw JSONは保存しません。
                </p>
              </div>
              <div className={`rounded-md px-3 py-1.5 text-xs font-bold ${
                moomooOptionProbe.status === "ok"
                  ? "bg-teal-100 text-teal-900"
                  : moomooOptionProbe.status === "permission_missing"
                    ? "bg-amber-100 text-amber-950"
                    : "bg-rose-100 text-rose-900"
              }`}>
                {moomooOptionProbe.status}
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-5">
              <div><span className="font-bold text-slate-900">US株</span><br />{permissionLabel(moomooOptionProbe.permissions.usStock)}</div>
              <div><span className="font-bold text-slate-900">米国オプション</span><br />{permissionLabel(moomooOptionProbe.permissions.usOption)}</div>
              <div><span className="font-bold text-slate-900">銘柄</span><br />{moomooOptionProbe.checked.symbols.join(", ") || "-"}</div>
              <div><span className="font-bold text-slate-900">Bid/Ask</span><br />{moomooOptionProbe.counts.candidatesWithBidAsk ?? 0}件</div>
              <div><span className="font-bold text-slate-900">IV+Greeks</span><br />{moomooOptionProbe.counts.candidatesWithIvGreeks ?? 0}件</div>
            </div>
            <div className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-4">
              <div><span className="font-bold text-slate-900">満期API</span><br />{moomooOptionProbe.checked.expirationDateApi}</div>
              <div><span className="font-bold text-slate-900">スクリーニングAPI</span><br />{moomooOptionProbe.checked.optionScreenApi}</div>
              <div><span className="font-bold text-slate-900">チェーンAPI</span><br />{moomooOptionProbe.checked.optionChainApi}</div>
              <div><span className="font-bold text-slate-900">価格API</span><br />{moomooOptionProbe.checked.optionQuoteApi}</div>
            </div>
            <div className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-5">
              <div><span className="font-bold text-slate-900">行数</span><br />{moomooOptionProbe.counts.chainRows ?? 0}</div>
              <div><span className="font-bold text-slate-900">正規化</span><br />{moomooOptionProbe.counts.normalizedOptionCandidates ?? 0}</div>
              <div><span className="font-bold text-slate-900">OI+Volume</span><br />{moomooOptionProbe.counts.candidatesWithOiVolume ?? 0}</div>
              <div><span className="font-bold text-slate-900">Bid/Ask有無</span><br />{moomooOptionProbe.sampleFieldPresence.bid && moomooOptionProbe.sampleFieldPresence.ask ? "あり" : "不足"}</div>
              <div><span className="font-bold text-slate-900">Lastのみ</span><br />{moomooOptionProbe.sampleFieldPresence.last && !(moomooOptionProbe.sampleFieldPresence.bid && moomooOptionProbe.sampleFieldPresence.ask) ? "保守価格不可" : "-"}</div>
            </div>
            {moomooOptionProbe.status === "permission_missing" ? (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 font-semibold leading-5 text-amber-950">
                米国オプション相場権限不足です。Level 3-4 / PositionDraft / option quote lookupの成功系は権限付与後に再実行してください。
              </p>
            ) : null}
            {moomooOptionProbe.warnings.length > 0 ? (
              <ul className="mt-3 grid gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 leading-5 text-amber-950">
                {moomooOptionProbe.warnings.slice(0, 8).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}

        {moomooPreview ? (
          <div className="mt-3 rounded-md border border-teal-200 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-950">取得結果プレビュー</div>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  取得結果はまだ候補リストへ反映していません。内容を確認してから反映してください。
                </p>
              </div>
              <button
                className="rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                disabled={previewCandidates.length === 0}
                onClick={importMoomooPreview}
              >
                候補リストへ反映
              </button>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-slate-700 md:grid-cols-6">
              <div>
                <div className="font-bold text-slate-900">実行状態</div>
                <div>{moomooPreview.raw.run?.status ?? "-"}</div>
              </div>
              <div>
                <div className="font-bold text-slate-900">取得件数</div>
                <div>{moomooPreview.raw.run?.processedSymbols ?? 0}件</div>
              </div>
              <div>
                <div className="font-bold text-slate-900">正規化</div>
                <div>{moomooPreview.importResult.summary?.importedCount ?? previewCandidates.length}件</div>
              </div>
              <div>
                <div className="font-bold text-slate-900">データ時点</div>
                <div>{textValue(moomooPreview.raw.asOf)}</div>
              </div>
              <div>
                <div className="font-bold text-slate-900">米国株</div>
                <div>{permissionLabel(moomooPreview.raw.permissions?.usStock)}</div>
              </div>
              <div>
                <div className="font-bold text-slate-900">米国オプション</div>
                <div>{permissionLabel(moomooPreview.raw.permissions?.usOption)}</div>
              </div>
            </div>
            {moomooPreview.raw.universe ? (
              <div className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 md:grid-cols-8">
                <div>
                  <div className="font-bold text-slate-900">取得方法</div>
                  <div>{moomooPreview.raw.universe.mode === "stock_screen" ? "条件でスクリーニング" : moomooPreview.raw.universe.mode === "symbols" ? "銘柄指定" : "-"}</div>
                </div>
                <div>
                  <div className="font-bold text-slate-900">プリセット</div>
                  <div>{moomooPreview.raw.universe.preset ?? "-"}</div>
                </div>
                <div>
                  <div className="font-bold text-slate-900">条件一致</div>
                  <div>{moomooPreview.raw.universe.screenMatchedCount ?? "-"}</div>
                </div>
                <div>
                  <div className="font-bold text-slate-900">取得候補</div>
                  <div>{moomooPreview.raw.universe.screenReturnedCount ?? "-"}</div>
                </div>
                <div>
                  <div className="font-bold text-slate-900">株価</div>
                  <div>{moomooPreview.raw.universe.snapshotRequestedCount ?? "-"}</div>
                </div>
                <div>
                  <div className="font-bold text-slate-900">履歴足</div>
                  <div>{moomooPreview.raw.universe.historyRequestedCount ?? "-"}</div>
                </div>
                <div>
                  <div className="font-bold text-slate-900">オプション</div>
                  <div>{moomooPreview.raw.universe.optionRequestedCount ?? "-"}</div>
                </div>
                <div>
                  <div className="font-bold text-slate-900">利用枠</div>
                  <div>{moomooPreview.raw.universe.quota?.status ?? "-"} / {moomooPreview.raw.universe.quota?.remain ?? "-"}</div>
                </div>
              </div>
            ) : null}
            {moomooPreview.raw.permissions?.usOption === "permission_missing" ? (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-950">
                米国オプション相場権限が不足しています。株価と日足テクニカルは候補化し、オプション流動性はデータ不足として扱います。
              </p>
            ) : null}
            {previewWarnings.length > 0 || (moomooPreview.raw.warnings?.length ?? 0) > 0 ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
                <div className="font-bold">警告</div>
                <ul className="mt-1 grid gap-1">
                  {[...(moomooPreview.raw.warnings ?? []), ...previewWarnings].slice(0, 10).map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {previewCandidates.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[760px] text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="py-2 pr-3">銘柄</th>
                      <th className="py-2 pr-3">会社</th>
                      <th className="py-2 pr-3">確認順</th>
                      <th className="py-2 pr-3 text-right">価格</th>
                      <th className="py-2 pr-3">戦術判定</th>
                      <th className="py-2 pr-3">不足</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewCandidates.slice(0, 5).map((candidate) => {
                      const review = selectPriorityReview(previewPriorityReviewsByCandidateId[candidate.id], filters.targetStrategy);
                      return (
                        <tr key={candidate.id} className="border-b border-slate-100">
                          <td className="py-2 pr-3 font-bold text-slate-950">{candidate.symbol}</td>
                          <td className="py-2 pr-3 text-slate-700">{candidate.company}</td>
                          <td className="py-2 pr-3 text-slate-700">{review ? `${priorityBandLabel(review.band)} ${review.score}` : "-"}</td>
                          <td className="numeric-input py-2 pr-3 text-right font-semibold">{candidate.priceUSD === undefined ? "-" : formatUSD(candidate.priceUSD)}</td>
                          <td className="py-2 pr-3 text-slate-700">
                            {review?.primaryStrategyLabel ?? (candidate.strategyFitResults?.slice(0, 2).map((result) => `${screeningStrategyLabel(result.strategy)}: ${screeningDisplayLabel("fitLevel", result.fitLevel)}`).join(" / ") || "-")}
                          </td>
                          <td className="py-2 pr-3 text-slate-600">
                            {screeningDisplayItems("nextDataNeeded", review?.nextDataNeeded).slice(0, 3).join(", ") || candidate.screeningCandidate?.missingFields.slice(0, 3).map(screeningMissingFieldLabel).join(", ") || "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {importSummary ? (
        <div className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 md:grid-cols-6">
          <div>
            <div className="font-bold text-slate-900">取込済み候補</div>
            <div>{importSummary.importedCount}/{importSummary.totalRows}件</div>
          </div>
          <div>
            <div className="font-bold text-slate-900">要確認</div>
            <div>{importSummary.warningCount}件</div>
          </div>
          <div>
            <div className="font-bold text-slate-900">エラー</div>
            <div>{importSummary.errorCount}件</div>
          </div>
          <div>
            <div className="font-bold text-slate-900">データソース</div>
            <div>{screeningDisplayValue("dataSource", importSummary.source)}</div>
          </div>
          <div>
            <div className="font-bold text-slate-900">データ時点</div>
            <div>{importSummary.asOf ?? "-"}</div>
          </div>
          <div>
            <div className="font-bold text-slate-900">最終取込</div>
            <div>{importSummary.importedAt}</div>
          </div>
        </div>
      ) : null}

      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">候補 {visibleCandidates.length}/{candidates.length}件</span>
            <span className="rounded bg-white px-2 py-1 text-xs font-bold text-slate-600">並び替え: {sortLabel(filters.sort)}</span>
            {status ? <span className="text-slate-600">{status}</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700" onClick={resetFilters}>
              <RotateCcw size={14} />
              全条件クリア
            </button>
            <button className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700" onClick={saveCurrentConditionSet}>
              <Save size={14} />
              現在の条件を保存
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(220px,1fr)_180px_150px_150px_150px]">
          <label className="text-xs font-bold text-slate-700">
            銘柄/会社/セクター
            <div className="mt-1 flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2">
              <ListFilter size={14} className="text-slate-500" />
              <input className="h-9 min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none" value={filters.query} placeholder="NVDA / 半導体" onChange={(event) => updateFilters({ query: event.target.value })} />
            </div>
          </label>
          <label className="text-xs font-bold text-slate-700">
            対象戦略
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.targetStrategy} onChange={(event) => updateFilters({ targetStrategy: event.target.value as ScreeningFilterState["targetStrategy"] })}>
              {targetStrategyOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            ソート
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.sort} onChange={(event) => updateFilters({ sort: event.target.value as ScreeningFilterState["sort"] })}>
              {["priority", "candidate_score", "chart_confidence", "screening_rank", "market_cap", "volume", "symbol"].map((value) => <option key={value} value={value}>{sortLabel(value as ScreeningFilterState["sort"])}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            優先度
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.priorityBand} onChange={(event) => updateFilters({ priorityBand: event.target.value as ScreeningFilterState["priorityBand"] })}>
              <option value="all">すべて</option>
              <option value="primary_watch">確認優先</option>
              <option value="secondary_watch">次点</option>
              <option value="manual_review">手動確認</option>
              <option value="avoid">候補外</option>
              <option value="insufficient_data">データ不足</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            Watch
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.watchMode} onChange={(event) => updateFilters({ watchMode: event.target.value as ScreeningFilterState["watchMode"] })}>
              <option value="include">含める</option><option value="only">Watchのみ</option><option value="exclude">Watch除外</option><option value="all">すべて</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {targetStrategyOptions.map((option) => (
            <button key={option.id} className={`rounded-md border px-2.5 py-1.5 text-xs font-bold ${filters.targetStrategy === option.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`} onClick={() => updateFilters({ targetStrategy: option.id })}>
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[150px_170px_170px_160px_160px_1fr_150px]">
          <label className="text-xs font-bold text-slate-700">
            チャート局面
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.chartRegime} onChange={(event) => updateFilters({ chartRegime: event.target.value as ScreeningFilterState["chartRegime"] })}>
              <option value="all">すべて</option><option value="bullish_continuation">上昇継続</option><option value="upside_reversal">上昇転換</option><option value="bullish_pullback">押し目</option><option value="range_neutral">レンジ</option><option value="downtrend">下落</option><option value="insufficient_data">不足</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            充足Level
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.levels[0] ?? "all"} onChange={(event) => updateFilters({ levels: event.target.value === "all" ? [] : [event.target.value as ScreeningCompletenessLevel] })}>
              <option value="all">すべて</option><option value="level_1_symbol_price">L1</option><option value="level_2_chart_ready">L2</option><option value="level_3_option_ready">L3</option><option value="level_4_draft_ready">L4</option><option value="insufficient">不足</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            不足データ
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.missingData} onChange={(event) => updateFilters({ missingData: event.target.value as ScreeningFilterState["missingData"] })}>
              <option value="all">すべて</option><option value="has_missing">不足あり</option><option value="no_missing">不足なし</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            Option
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.optionPermission} onChange={(event) => updateFilters({ optionPermission: event.target.value as ScreeningFilterState["optionPermission"] })}>
              <option value="all">すべて</option><option value="missing">Bid/Ask不足</option><option value="ok">Bid/Askあり</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            データ取得元
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.source} onChange={(event) => updateFilters({ source: event.target.value })}>
              <option value="all">すべて</option><option value="moomoo_opend">moomoo取得</option><option value="moomoo_file_import">moomooファイル</option><option value="manual_import">手入力/JSON</option><option value="imported_csv">CSV</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            保存名
            <input className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={saveName} placeholder="空欄なら自動名" onChange={(event) => setSaveName(event.target.value)} />
          </label>
          <label className="text-xs font-bold text-slate-700">
            条件セット
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" defaultValue="" onChange={(event) => restoreConditionSet(event.target.value)}>
              <option value="" disabled>選択</option>
              {savedConditionSets.map((saved) => <option key={saved.id} value={saved.id}>{saved.name}</option>)}
            </select>
          </label>
        </div>
        {savedConditionSets.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {savedConditionSets.map((saved) => (
              <button key={saved.id} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-600" onClick={() => deleteConditionSet(saved.id)}>
                削除: {saved.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {importWarnings.length > 0 ? (
        <details className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <summary className="cursor-pointer font-bold">取込時の確認事項 {importWarnings.length}件</summary>
          <ul className="mt-2 grid max-h-36 gap-1 overflow-auto text-xs leading-5">
            {importWarnings.slice(0, 80).map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {candidates.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
          moomoo候補JSON/CSV、または互換CSVを取り込むと、スクリーニング候補をここで確認できます。
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1680px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2 pr-3">詳細</th>
                <th className="py-2 pr-3">確認順</th>
                <th className="py-2 pr-3">理由/不足</th>
                <th className="py-2 pr-3 text-right">順位</th>
                <th className="py-2 pr-3">銘柄</th>
                <th className="py-2 pr-3">会社</th>
                <th className="py-2 pr-3 text-right">価格</th>
                <th className="py-2 pr-3 text-right">変化率</th>
                <th className="py-2 pr-3 text-right">出来高</th>
                <th className="py-2 pr-3 text-right">時価総額</th>
                <th className="py-2 pr-3">セクター</th>
                <th className="py-2 pr-3">注意</th>
                <th className="py-2 pr-3">充足</th>
                <th className="py-2 pr-3">チャート</th>
                <th className="py-2 pr-3">建玉案</th>
                <th className="py-2 pr-3">戦術判定</th>
                <th className="py-2 pr-3">不足</th>
                <th className="py-2 pr-3 text-right">スコア</th>
                <th className="py-2 pr-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleCandidates.map((candidate) => {
                const hasPosition = existingSymbols.has(candidate.symbol);
                const hasWarnings = (candidate.parseWarnings?.length ?? 0) > 0 || Boolean(candidate.earningsWarning);
                const isExpanded = expandedCandidateId === candidate.id;
                const journalStatus = getJournalStatusLabel(candidate.entryRationaleJournal);
                const chartAnalysis = candidate.publicScreeningInput?.chartAnalysis;
                const topSuitabilities = candidate.strategySuitability?.slice(0, 3);
                const topDraft = candidate.positionDrafts?.[0] ?? candidate.publicScreeningInput?.positionDrafts?.[0];
                const strategyReviews = priorityReviewsByCandidateId[candidate.id] ?? [];
                const review = selectPriorityReview(strategyReviews, filters.targetStrategy);
                return (
                  <Fragment key={candidate.id}>
                    <tr className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 pr-3">
                        <button
                          className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-2 text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                          aria-expanded={isExpanded}
                          aria-label={`${candidate.symbol} 詳細を${isExpanded ? "閉じる" : "開く"}`}
                          title={isExpanded ? "詳細を閉じる" : "詳細を開く"}
                          onClick={() => setExpandedCandidateId(isExpanded ? null : candidate.id)}
                        >
                          {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                      </td>
                      <td className="py-3 pr-3">
                        <div className={`rounded-md border px-2 py-1 text-xs ${priorityBandClass(review)}`}>
                          <div className="font-black">{review ? priorityBandLabel(review.band) : "-"}</div>
                          <div className="font-bold">{review?.score ?? "-"}</div>
                          <div>{review?.primaryStrategyLabel ?? "-"}</div>
                        </div>
                      </td>
                      <td className="py-3 pr-3 text-xs leading-5 text-slate-700">
                        <div className="font-bold text-teal-800">{shortList(review?.reasons, "-", "reasons")}</div>
                        <div className="text-amber-800">{shortList(review?.blockers, "", "blockers")}</div>
                        <div className="text-slate-500">{shortList(review?.nextDataNeeded, "", "nextDataNeeded")}</div>
                      </td>
                      <td className="numeric-input py-3 pr-3 text-right font-semibold text-slate-700">{candidate.rank}</td>
                      <td className="py-3 pr-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-slate-950">{candidate.symbol}</span>
                          {hasPosition ? <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[11px] font-bold text-teal-800">建玉あり</span> : null}
                          {candidate.watchOnly ? <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-700">Watch</span> : null}
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-700">{journalStatus}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-3 text-slate-700">{candidate.company}</td>
                      <td className="numeric-input py-3 pr-3 text-right font-semibold">{candidate.priceUSD === undefined ? "-" : formatUSD(candidate.priceUSD)}</td>
                      <td className="numeric-input py-3 pr-3 text-right font-semibold">{formatPercentValue(candidate.changePercent)}</td>
                      <td className="numeric-input py-3 pr-3 text-right font-semibold">{formatCompact(candidate.volume)}</td>
                      <td className="numeric-input py-3 pr-3 text-right font-semibold">{formatCompact(candidate.marketCapUSD)}</td>
                      <td className="py-3 pr-3 text-slate-700">{candidate.sector ?? "-"}</td>
                      <td className={`py-3 pr-3 text-xs font-semibold ${hasWarnings ? "text-amber-700" : "text-slate-500"}`}>
                        {candidate.earningsWarning || candidate.parseWarnings?.[0] || "-"}
                      </td>
                      <td className="py-3 pr-3 text-xs text-slate-700">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">
                          {completenessLabel(candidate.screeningCompleteness?.level)}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-xs text-slate-700">
                        {chartAnalysis ? (
                          <div className="grid gap-1">
                            <span className="font-semibold">{screeningDisplayLabel("chartRegime", chartAnalysis.regime)}</span>
                            <span className="text-slate-500">信頼度: {screeningDisplayLabel("chartConfidence", chartAnalysis.confidence)}</span>
                          </div>
                        ) : "-"}
                      </td>
                      <td className="py-3 pr-3 text-xs text-slate-700">
                        <div className="grid gap-1">
                          <span className={`rounded px-1.5 py-0.5 font-semibold ${topDraft?.status === "draft_ready" ? "bg-teal-50 text-teal-800" : topDraft?.status === "manual_review_required" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"}`}>
                            {positionDraftStatusLabel(topDraft?.status)}
                          </span>
                          {topDraft ? (
                            <span className="text-slate-500">
                              {topDraft.capital?.capitalQuality ? screeningDisplayValue("capitalQuality", topDraft.capital.capitalQuality) : "-"} / 必要 {topDraft.requiredCapitalUSD === undefined ? "-" : formatUSD(topDraft.requiredCapitalUSD)} / 最大損失 {topDraft.maxLossUSD === undefined ? "-" : formatUSD(topDraft.maxLossUSD)}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-3 pr-3 text-xs text-slate-700">
                        <div className="flex flex-wrap gap-1">
                          {topSuitabilities?.length ? topSuitabilities.map((result) => (
                            <span key={result.strategy} className="rounded bg-teal-50 px-1.5 py-0.5 font-semibold text-teal-800">
                              {screeningStrategyLabel(result.strategy)}: {strategySuitabilityLabel(result.level)}
                            </span>
                          )) : candidate.strategyFitResults?.slice(0, 3).map((result) => (
                            <span key={result.strategy} className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">
                              {screeningStrategyLabel(result.strategy)}: {screeningDisplayLabel("fitLevel", result.fitLevel)}
                            </span>
                          ))}
                          {candidate.technicalTimingPatterns?.[0] ? (
                            <span className="rounded bg-teal-50 px-1.5 py-0.5 font-semibold text-teal-800">
                              上昇転換コンボ候補: {screeningDisplayLabel("fitLevel", candidate.technicalTimingPatterns[0].fitLevel)}
                            </span>
                          ) : null}
                          {candidate.syntheticForwardCandidates?.[0] ? (
                            <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-800">
                              シンセティック: {screeningDisplayLabel("fitLevel", candidate.syntheticForwardCandidates[0].fitLevel)}
                            </span>
                          ) : null}
                          {!topSuitabilities?.length && !candidate.strategyFitResults?.length && !candidate.technicalTimingPatterns?.length && !candidate.syntheticForwardCandidates?.length ? "-" : null}
                        </div>
                      </td>
                      <td className="py-3 pr-3 text-xs text-slate-600">
                        {candidate.screeningCompleteness?.missingFields.length
                          ? candidate.screeningCompleteness.missingFields.slice(0, 3).map(screeningMissingFieldLabel).join(", ")
                          : candidate.screeningCandidate?.missingFields.length
                            ? candidate.screeningCandidate.missingFields.slice(0, 3).map(screeningMissingFieldLabel).join(", ")
                            : "-"}
                      </td>
                      <td className="numeric-input py-3 pr-3 text-right font-bold text-slate-900">{candidate.score}</td>
                      <td className="py-3 pr-3 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button
                            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-2 text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                            title={candidate.watchOnly ? "Watch onlyを解除" : "Watch onlyにする"}
                            onClick={() => onWatchOnly(candidate.id, !candidate.watchOnly)}
                          >
                            <Eye size={15} />
                          </button>
                          <button
                            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800"
                            title="エントリー根拠を記録"
                            onClick={() => setExpandedCandidateId(candidate.id)}
                          >
                            根拠
                          </button>
                          <button
                            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-2 text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"
                            title="カバードコール候補として建玉案を作成"
                            onClick={() => requestCreateSimulation(candidate, "covered_call")}
                          >
                            <Plus size={15} />
                            <span className="sr-only">Covered Call</span>
                          </button>
                          <button
                            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
                            title="P売り候補として建玉案を作成"
                            onClick={() => requestCreateSimulation(candidate, "short_put")}
                          >
                            P
                          </button>
                          <button
                            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800"
                            title="コール買い候補として建玉案を作成"
                            onClick={() => requestCreateSimulation(candidate, "long_call")}
                          >
                            LC
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className="border-b border-slate-200 bg-slate-50/70">
                        <td colSpan={19} className="px-3 py-4">
                          <CandidateDetailCard
                            candidate={candidate}
                            priorityReviews={strategyReviews}
                            onJournalChange={(journal) => onJournalChange(candidate.id, journal)}
                            getDefaultJournal={() => createJournalForCandidate(candidate)}
                            onDraftReviewChecklistChange={(draftId, itemId, checked) => onDraftReviewChecklistChange(candidate.id, draftId, itemId, checked)}
                            reviewHandoffSource="local"
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex items-center gap-2 text-xs leading-5 text-slate-500">
            <AlertTriangle size={14} />
            建玉案作成後も、権利行使価格・満期・プレミアム・証拠金は手入力で確認します。自動発注機能はありません。
          </div>
        </div>
      )}
      {draftGate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label="建玉案レビュー前確認">
          <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
            {(() => {
              const draft = draftGate.candidate.positionDrafts?.[0] ?? draftGate.candidate.publicScreeningInput?.positionDrafts?.[0];
              const unchecked = draft?.reviewState?.checklist.filter((item) => item.blockingIfUnchecked && !item.checked) ?? [];
              const blockers = [
                ...(draft?.missingFields ?? []),
                ...(draft?.legs.flatMap((leg) => [...leg.missingFields, ...leg.liquidityWarnings]) ?? []),
              ];
              return (
                <>
                  <div className="text-base font-black text-slate-950">建玉案レビュー前確認</div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {draftGate.candidate.symbol} を入力候補として確認します。これは建玉入力への自動転記ではなく、内容確認後に既存の建玉案作成画面へ進む操作です。
                  </p>
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
                    <div className="font-bold">確認状態</div>
                    <div>建玉案: {positionDraftStatusLabel(draft?.status)} / 手動確認: {draft?.reviewState?.reviewStatus ? screeningDisplayLabel("reviewStatus", draft.reviewState.reviewStatus) : "-"}</div>
                    {unchecked.length ? <div className="mt-1">必須未確認: {unchecked.map((item) => item.label).join(" / ")}</div> : null}
                    {blockers.length ? <div className="mt-1 text-rose-900">不足/警告: {screeningDisplayItems("missingFields", blockers).slice(0, 6).join(" / ")}</div> : null}
                  </div>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700" onClick={() => setDraftGate(null)}>キャンセル</button>
                    <button className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950" onClick={proceedDraftGate}>内容を確認して建玉案レビューへ進む</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}
    </section>
  );
}
