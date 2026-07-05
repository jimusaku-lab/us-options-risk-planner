import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Eye, FileJson, FileUp, GitCompare, ListFilter, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import type { CandidateImportSummary, CandidateReviewChecklistState, CandidateSymbol } from "@/types/candidates";
import type { EntryRationaleJournal, TradeSimulation } from "@/types/domain";
import type { PositionDraftStatus, PublicStrategyFitLevel, ScreeningCompletenessLevel } from "@/types/screening";
import { summarizeCandidateReview } from "@/domain/candidateReviewChecklist";
import { createJournalForCandidate, getJournalStatusLabel } from "@/domain/entryRationaleJournal";
import { buildScreeningComparisonItem } from "@/domain/screeningComparison";
import {
  applyScreeningPreset,
  defaultScreeningFilters,
  filterAndSortScreeningCandidates,
  strategyViewOptions,
  type SavedScreeningFilter,
  type ScreeningFilterState,
  type ScreeningPresetId,
} from "@/domain/screeningFilters";
import { evaluateCandidatePriority, getBestDraft, getBestOptionQuote, priorityBandLabel, type ScreeningPriorityReview } from "@/domain/screeningPriority";
import { parseCandidateImport } from "@/lib/candidates";
import { formatUSD } from "@/lib/format";
import { CandidateDetailCard } from "./CandidateDetailCard";

const FILTER_STORAGE_KEY = "us-options-screening-practical-filters-v1";
const SAVED_FILTER_STORAGE_KEY = "us-options-screening-saved-filters-v1";
const PUBLIC_SAMPLE_FILE_NAME = "us-options-screening-sample-v1.json";

function publicSampleUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.endsWith("/") ? base : `${base}/`}samples/${PUBLIC_SAMPLE_FILE_NAME}`;
}

function completenessLabel(level?: ScreeningCompletenessLevel): string {
  if (level === "level_4_draft_ready") return "L4 建玉案レビュー可";
  if (level === "level_3_option_ready") return "L3 オプション確認可";
  if (level === "level_2_chart_ready") return "L2 チャート確認可";
  if (level === "level_1_symbol_price") return "L1 銘柄/株価";
  if (level === "insufficient") return "不足";
  return "-";
}

function strategySuitabilityLabel(level: PublicStrategyFitLevel): string {
  if (level === "fit") return "候補";
  if (level === "watch") return "監視";
  if (level === "avoid") return "候補外";
  if (level === "manual_review_required") return "手動確認";
  return "データ不足";
}

function positionDraftStatusLabel(status?: PositionDraftStatus): string {
  if (status === "draft_ready") return "建玉案レビュー可";
  if (status === "manual_review_required") return "手動確認";
  if (status === "not_ready") return "未準備";
  return "建玉案なし";
}

function readFilters(): ScreeningFilterState {
  if (typeof window === "undefined") return defaultScreeningFilters;
  try {
    return { ...defaultScreeningFilters, ...(JSON.parse(window.localStorage.getItem(FILTER_STORAGE_KEY) ?? "{}") as Partial<ScreeningFilterState>) };
  } catch {
    return defaultScreeningFilters;
  }
}

function readSavedFilters(): SavedScreeningFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SAVED_FILTER_STORAGE_KEY) ?? "[]") as SavedScreeningFilter[];
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

function priorityBandClass(review?: ScreeningPriorityReview): string {
  if (review?.priorityBand === "high") return "border-teal-200 bg-teal-50 text-teal-900";
  if (review?.priorityBand === "medium") return "border-sky-200 bg-sky-50 text-sky-900";
  if (review?.priorityBand === "blocked") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function shortList(items: string[] | undefined, fallback = "-"): string {
  return items?.length ? items.slice(0, 2).join(" / ") : fallback;
}

function sortLabel(value: ScreeningFilterState["sort"]): string {
  if (value === "priority") return "確認優先度";
  if (value === "completeness") return "データ充足Level";
  if (value === "chart") return "チャート信頼度";
  if (value === "draft") return "建玉案レビュー可";
  if (value === "liquidity") return "流動性";
  if (value === "capital") return "資金余力";
  if (value === "review_ready") return "確認状態";
  if (value === "required_unchecked") return "必須未確認";
  if (value === "symbol") return "銘柄";
  return "取込順";
}

type CandidateDraftStrategy = "covered_call" | "short_put" | "long_call";

function truncateName(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 24 ? `${trimmed.slice(0, 24)}...` : trimmed;
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
  onChecklistChange,
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
  onChecklistChange: (candidateId: string, state: CandidateReviewChecklistState) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState("");
  const [filters, setFilters] = useState<ScreeningFilterState>(() => readFilters());
  const [savedFilters, setSavedFilters] = useState<SavedScreeningFilter[]>(() => readSavedFilters());
  const [saveName, setSaveName] = useState("");
  const [selectedComparisonIds, setSelectedComparisonIds] = useState<string[]>([]);
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [draftGate, setDraftGate] = useState<{ candidate: CandidateSymbol; strategy: CandidateDraftStrategy } | null>(null);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const sampleUrl = publicSampleUrl();
  const existingSymbols = useMemo(
    () => new Set(simulations.map((simulation) => simulation.ticker.trim().toUpperCase()).filter(Boolean)),
    [simulations],
  );
  const priorityReviews = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.id, evaluateCandidatePriority(candidate, { existingSymbols })])),
    [candidates, existingSymbols],
  );
  const visibleCandidates = useMemo(
    () => filterAndSortScreeningCandidates(candidates, priorityReviews, filters),
    [candidates, filters, priorityReviews],
  );
  const comparisonCandidates = useMemo(
    () => selectedComparisonIds
      .map((candidateId) => candidates.find((candidate) => candidate.id === candidateId))
      .filter((candidate): candidate is CandidateSymbol => Boolean(candidate)),
    [candidates, selectedComparisonIds],
  );
  const comparisonItems = useMemo(
    () => comparisonCandidates.map((candidate) => buildScreeningComparisonItem(candidate, priorityReviews.get(candidate.id))),
    [comparisonCandidates, priorityReviews],
  );

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    setSelectedComparisonIds((ids) => ids.filter((id) => candidates.some((candidate) => candidate.id === id)));
  }, [candidates]);

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

  const importPublicSample = async () => {
    setIsLoadingSample(true);
    setStatus("サンプルJSONを読み込み中...");
    try {
      const response = await fetch(sampleUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`サンプルJSONを取得できませんでした。HTTP ${response.status}`);
      const text = await response.text();
      const result = parseCandidateImport(text, PUBLIC_SAMPLE_FILE_NAME);
      if (result.candidates.length === 0) throw new Error("サンプルJSONから候補を読み込めませんでした。");
      onImport(result.candidates, result.warnings, result.summary);
      setStatus(
        result.summary
          ? `サンプル読込済み ${result.summary.importedCount}/${result.summary.totalRows}件、要確認 ${result.summary.warningCount}件、エラー ${result.summary.errorCount}件`
          : `サンプル候補 ${result.candidates.length}件を読み込みました。`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "サンプルJSONを読み込めませんでした。");
    } finally {
      setIsLoadingSample(false);
    }
  };

  const updateFilters = (partial: Partial<ScreeningFilterState>) => {
    setFilters((current) => ({ ...current, ...partial, presetId: partial.presetId ?? current.presetId }));
  };

  const applyPreset = (presetId: ScreeningPresetId) => {
    setFilters((current) => applyScreeningPreset(current, presetId));
  };

  const resetFilters = () => {
    setFilters(defaultScreeningFilters);
    setStatus("フィルタ条件をリセットしました。");
  };

  const saveCurrentFilters = () => {
    const saved: SavedScreeningFilter = {
      id: `filter-${Date.now()}`,
      name: truncateName(saveName || `条件 ${savedFilters.length + 1}`),
      savedAt: new Date().toISOString(),
      filters,
    };
    const next = [saved, ...savedFilters.filter((item) => item.name !== saved.name)].slice(0, 5);
    setSavedFilters(next);
    if (typeof window !== "undefined") window.localStorage.setItem(SAVED_FILTER_STORAGE_KEY, JSON.stringify(next));
    setSaveName("");
    setStatus(`フィルタ条件「${saved.name}」を保存しました。`);
  };

  const restoreSavedFilter = (id: string) => {
    const saved = savedFilters.find((item) => item.id === id);
    if (!saved) return;
    setFilters(saved.filters);
    setStatus(`フィルタ条件「${saved.name}」を復元しました。`);
  };

  const toggleComparison = (candidateId: string) => {
    setSelectedComparisonIds((current) => {
      if (current.includes(candidateId)) return current.filter((id) => id !== candidateId);
      return [...current, candidateId].slice(0, 5);
    });
  };

  const requestCreateSimulation = (candidate: CandidateSymbol, strategy: CandidateDraftStrategy) => {
    const summary = summarizeCandidateReview(candidate);
    if (summary.requiredUncheckedCount > 0 || summary.status === "blocked") {
      setDraftGate({ candidate, strategy });
      return;
    }
    onCreateSimulation(candidate, strategy);
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
            持ち込みデータからスクリーニング候補を確認し、建玉案の入口を作ります。JSON/CSV取込で候補を確認できます。
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            この公開版では外部自動取得に接続せず、ユーザー提供ファイルと旧互換CSV/JSONを読み込みます。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-teal-300 bg-teal-50 px-3 text-sm font-semibold text-teal-900 disabled:cursor-wait disabled:opacity-60"
            disabled={isLoadingSample}
            onClick={() => void importPublicSample()}
          >
            <FileJson size={16} />
            {isLoadingSample ? "読込中" : "サンプルを読み込む"}
          </button>
          <a className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 hover:border-slate-400 hover:bg-slate-50" href={sampleUrl} target="_blank" rel="noreferrer">
            サンプルJSONを開く
          </a>
          <button className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900" onClick={() => fileInputRef.current?.click()}>
            <FileUp size={16} />
            候補ファイル取込
          </button>
          <button className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 disabled:opacity-40" disabled={candidates.length === 0} onClick={onClear}>
            <Trash2 size={16} />
            クリア
          </button>
          <button className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 hover:border-slate-400 hover:bg-slate-50" aria-label="スクリーニング候補を閉じる" onClick={onClose}>
            <X size={16} />
            閉じる
          </button>
          <input ref={fileInputRef} className="hidden" type="file" accept="application/json,text/csv,.json,.csv" onChange={(event) => void importFile(event.target.files?.[0] ?? null)} />
        </div>
      </div>

      {importSummary ? (
        <div className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 md:grid-cols-6">
          <div><div className="font-bold text-slate-900">取込済み候補</div><div>{importSummary.importedCount}/{importSummary.totalRows}件</div></div>
          <div><div className="font-bold text-slate-900">要確認</div><div>{importSummary.warningCount}件</div></div>
          <div><div className="font-bold text-slate-900">エラー</div><div>{importSummary.errorCount}件</div></div>
          <div><div className="font-bold text-slate-900">データソース</div><div>{importSummary.source}</div></div>
          <div><div className="font-bold text-slate-900">asOf</div><div>{importSummary.asOf ?? "-"}</div></div>
          <div><div className="font-bold text-slate-900">最終取込</div><div>{importSummary.importedAt}</div></div>
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
              条件リセット
            </button>
            <button className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700" onClick={saveCurrentFilters}>
              <Save size={14} />
              現在条件を保存
            </button>
          </div>
        </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(220px,1fr)_170px_150px_150px_150px]">
          <label className="text-xs font-bold text-slate-700">
            銘柄/会社/セクター
            <div className="mt-1 flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2">
              <ListFilter size={14} className="text-slate-500" />
              <input className="h-9 min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none" value={filters.query} placeholder="例: NVDA / 半導体" onChange={(event) => updateFilters({ query: event.target.value })} />
            </div>
          </label>
          <label className="text-xs font-bold text-slate-700">
            ソート
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.sort} onChange={(event) => updateFilters({ sort: event.target.value as ScreeningFilterState["sort"] })}>
              {["priority", "completeness", "chart", "draft", "liquidity", "capital", "review_ready", "required_unchecked", "symbol", "import_order"].map((value) => <option key={value} value={value}>{sortLabel(value as ScreeningFilterState["sort"])}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            優先度
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.priorityBand} onChange={(event) => updateFilters({ priorityBand: event.target.value as ScreeningFilterState["priorityBand"] })}>
              <option value="all">すべて</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option><option value="blocked">保留</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            建玉案
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.draft} onChange={(event) => updateFilters({ draft: event.target.value as ScreeningFilterState["draft"] })}>
              <option value="all">すべて</option><option value="ready">レビュー可</option><option value="manual">手動確認</option><option value="not_ready">未準備</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            Watch
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.watchMode} onChange={(event) => updateFilters({ watchMode: event.target.value as ScreeningFilterState["watchMode"] })}>
              <option value="include">含める</option><option value="only">Watchのみ</option><option value="exclude">Watch除外</option><option value="all">すべて</option>
            </select>
          </label>
        </div>

        <div className="mt-3 text-xs font-bold text-slate-700">プリセット</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {[
            ["upside_long_call_combo", "上昇転換コール/コンボ"],
            ["buy_to_own_put", "買いたいP売り"],
            ["covered_call_stock", "保有株カバードコール"],
            ["draft_ready", "建玉案レビュー可"],
            ["missing_data", "不足データを埋める"],
            ["advanced_manual", "上級戦略手動確認"],
          ].map(([id, label]) => (
            <button key={id} className={`rounded-md border px-2.5 py-1.5 text-xs font-bold ${filters.presetId === id ? "border-teal-300 bg-teal-50 text-teal-900" : "border-slate-300 bg-white text-slate-700"}`} onClick={() => applyPreset(id as ScreeningPresetId)}>
              {label}
            </button>
          ))}
        </div>

        <div className="mt-3 text-xs font-bold text-slate-700">戦略別ビュー</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {strategyViewOptions.map((option) => (
            <button key={option.id} className={`rounded-md border px-2.5 py-1.5 text-xs font-bold ${filters.view === option.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`} onClick={() => updateFilters({ view: option.id })}>
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[160px_160px_160px_180px_1fr_auto]">
          <label className="text-xs font-bold text-slate-700">
            流動性
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.liquidity} onChange={(event) => updateFilters({ liquidity: event.target.value as ScreeningFilterState["liquidity"] })}>
              <option value="all">すべて</option><option value="ok">OK</option><option value="watch">監視含む</option><option value="missing">不足</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            資金
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.capital} onChange={(event) => updateFilters({ capital: event.target.value as ScreeningFilterState["capital"] })}>
              <option value="all">すべて</option><option value="ready">準備可</option><option value="review">追加確認</option><option value="shortage">不足</option><option value="missing">未入力</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            決算注意
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.includeEarnings ? "include" : "exclude"} onChange={(event) => updateFilters({ includeEarnings: event.target.value === "include" })}>
              <option value="include">含める</option><option value="exclude">除外</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            確認状態
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={filters.reviewStatus ?? "all"} onChange={(event) => updateFilters({ reviewStatus: event.target.value as ScreeningFilterState["reviewStatus"] })}>
              <option value="all">すべて</option><option value="ready">レビュー準備</option><option value="needs_review">要確認</option><option value="blocked">保留</option><option value="missing_required">必須未確認あり</option><option value="journaled">根拠メモあり</option><option value="not_journaled">根拠メモなし</option>
            </select>
          </label>
          <label className="text-xs font-bold text-slate-700">
            保存名
            <input className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" value={saveName} placeholder="空欄なら自動名" onChange={(event) => setSaveName(event.target.value)} />
          </label>
          <label className="text-xs font-bold text-slate-700">
            保存済み
            <select className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-900" defaultValue="" onChange={(event) => restoreSavedFilter(event.target.value)}>
              <option value="" disabled>選択</option>
              {savedFilters.map((saved) => <option key={saved.id} value={saved.id}>{saved.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      {importWarnings.length > 0 ? (
        <details className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <summary className="cursor-pointer font-bold">取込時の確認事項 {importWarnings.length}件</summary>
          <ul className="mt-2 grid max-h-36 gap-1 overflow-auto text-xs leading-5">
            {importWarnings.slice(0, 80).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
          </ul>
        </details>
      ) : null}

      {candidates.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
          <div className="text-sm font-bold text-slate-950">まずはサンプルで候補画面を試せます。</div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <div className="font-bold text-slate-900">1. サンプルを読み込む</div>
              <p className="mt-1">合成データでLevel、戦略判定、詳細カード、確認チェックを確認できます。</p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <div className="font-bold text-slate-900">2. 自分のJSON/CSVを取り込む</div>
              <p className="mt-1">認証情報、APIキー、口座ID完全値、ローカルパスは入れないでください。</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-teal-300 bg-teal-50 px-3 text-xs font-bold text-teal-900 disabled:cursor-wait disabled:opacity-60"
              disabled={isLoadingSample}
              onClick={() => void importPublicSample()}
            >
              <FileJson size={14} />
              {isLoadingSample ? "読込中" : "サンプルを読み込む"}
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700" onClick={() => fileInputRef.current?.click()}>
              <FileUp size={14} />
              自分のJSON/CSVを取り込む
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            候補は売買推奨ではなく確認用の分類です。実際の価格、資金、操作内容は証券会社画面で最終確認してください。
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
            <span className="font-bold text-slate-950">比較候補</span> {selectedComparisonIds.length}/5件。比較したい候補の「比較に追加」を押すと、確認優先度・チャート・流動性・資金条件を並べて確認できます。
          </div>
          {comparisonItems.length >= 2 ? (
            <section className="rounded-md border border-sky-200 bg-sky-50/70 p-3">
              <div className="text-sm font-bold text-slate-950">候補比較 {comparisonItems.length}/5件</div>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {comparisonItems.map((item) => (
                  <div key={item.candidateId} className="rounded-md border border-sky-200 bg-white p-3 text-xs text-slate-700">
                    <div className="flex items-start justify-between gap-2">
                      <div><div className="text-sm font-black text-slate-950">{item.symbol}</div><div>{item.company}</div></div>
                      <button className="rounded border border-slate-300 px-2 py-1 font-bold" onClick={() => toggleComparison(item.candidateId)}>解除</button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1">
                      <div>Level: {item.level}</div><div>Chart: {item.chart} / {item.confidence}</div>
                      <div>戦略: {item.primaryStrategy}</div><div>建玉案: {item.draftStatus}</div>
                      <div>満期: {item.expiry}</div><div>Strike: {item.strike}</div>
                      <div>Bid/Ask: {item.bid} / {item.ask}</div><div>Mid/Last: {item.mid} / {item.last}</div>
                      <div>Spread: {item.spreadRate}</div><div>Vol/OI: {item.volume} / {item.openInterest}</div>
                      <div>保守価格: {item.conservativePrice}</div><div>必要資金: {item.requiredCapital}</div>
                      <div>利用可能: {item.availableCash}</div><div>最大損失: {item.maxLoss}</div>
                    </div>
                    <div className="mt-2 rounded bg-slate-50 px-2 py-1">上位理由: {shortList(item.topReasons)}</div>
                    <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-amber-900">減点/未確認: {shortList([...item.penaltyReasons, ...item.missingChecks])}</div>
                  </div>
                ))}
              </div>
            </section>
          ) : selectedComparisonIds.length === 1 ? (
            <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900">比較対象をもう1件選ぶと比較パネルを表示します。</div>
          ) : null}

          {visibleCandidates.map((candidate) => {
            const hasPosition = existingSymbols.has(candidate.symbol);
            const isExpanded = expandedCandidateId === candidate.id;
            const journalStatus = getJournalStatusLabel(candidate.entryRationaleJournal);
            const review = priorityReviews.get(candidate.id) ?? evaluateCandidatePriority(candidate, { existingSymbols });
            const chartAnalysis = candidate.publicScreeningInput?.chartAnalysis;
            const topDraft = getBestDraft(candidate);
            const topQuote = getBestOptionQuote(candidate);
            const topSuitability = candidate.strategySuitability?.[0] ?? candidate.publicScreeningInput?.strategySuitability?.[0];
            const isSelected = selectedComparisonIds.includes(candidate.id);
            const reviewSummary = summarizeCandidateReview(candidate);
            return (
              <Fragment key={candidate.id}>
                <article className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="grid gap-3 lg:grid-cols-[170px_1fr_220px]">
                    <div className="grid gap-2">
                      <div className={`rounded-md border px-3 py-2 ${priorityBandClass(review)}`}>
                        <div className="text-[11px] font-bold uppercase tracking-normal">確認優先度</div>
                        <div className="mt-1 flex items-end gap-2"><span className="text-xl font-black">{priorityBandLabel(review.priorityBand)}</span><span className="text-sm font-bold">{review.priorityScore}</span></div>
                      </div>
                      <button className={`inline-flex h-9 items-center justify-center gap-1 rounded-md border px-2 text-xs font-bold ${isSelected ? "border-sky-300 bg-sky-50 text-sky-900" : "border-slate-300 bg-white text-slate-700"}`} onClick={() => toggleComparison(candidate.id)}>
                        <GitCompare size={14} />
                        {isSelected ? "比較から外す" : "比較に追加"}
                      </button>
                    </div>
                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-2 text-slate-600 hover:border-slate-400 hover:bg-slate-50" aria-expanded={isExpanded} aria-label={`${candidate.symbol} 詳細を${isExpanded ? "閉じる" : "開く"}`} title={isExpanded ? "詳細を閉じる" : "詳細を開く"} onClick={() => setExpandedCandidateId(isExpanded ? null : candidate.id)}>
                          {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                        <span className="text-lg font-black text-slate-950">{candidate.symbol}</span>
                        <span className="text-sm font-semibold text-slate-600">{candidate.company}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-700">{journalStatus}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${reviewSummary.status === "ready_for_review" ? "bg-teal-100 text-teal-800" : reviewSummary.status === "blocked" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-900"}`}>{reviewSummary.label}</span>
                        {hasPosition ? <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[11px] font-bold text-teal-800">建玉あり</span> : null}
                        {candidate.watchOnly ? <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-700">Watch</span> : null}
                      </div>
                      <div className="grid gap-2 text-xs text-slate-700 md:grid-cols-6">
                        <div><span className="font-bold text-slate-900">価格</span><br />{candidate.priceUSD === undefined ? "-" : formatUSD(candidate.priceUSD)}</div>
                        <div><span className="font-bold text-slate-900">Level</span><br />{completenessLabel(candidate.screeningCompleteness?.level)}</div>
                        <div><span className="font-bold text-slate-900">チャート</span><br />{chartAnalysis ? `${chartAnalysis.regime} / ${chartAnalysis.confidence}` : "-"}</div>
                        <div>
                          <span className="font-bold text-slate-900">戦略</span><br />
                          {topSuitability
                            ? `${review.primaryStrategyLabel ?? topSuitability.strategy} / ${strategySuitabilityLabel(topSuitability.level)}`
                            : review.primaryStrategyLabel ?? "-"}
                        </div>
                        <div><span className="font-bold text-slate-900">建玉案</span><br />{positionDraftStatusLabel(topDraft?.status)}</div>
                        <div><span className="font-bold text-slate-900">確認</span><br />{reviewSummary.checkedCount}/{reviewSummary.totalCount || "-"} 必須未確認 {reviewSummary.requiredUncheckedCount}</div>
                      </div>
                      <div className="grid gap-2 md:grid-cols-3">
                        <div className="rounded-md border border-teal-100 bg-teal-50 px-3 py-2 text-xs leading-5 text-teal-950"><div className="font-bold">上位理由</div><div>{shortList(review.topReasons)}</div></div>
                        <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950"><div className="font-bold">減点理由</div><div>{shortList(review.penaltyReasons)}</div></div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700"><div className="font-bold">未確認事項</div><div>{shortList(review.missingChecks)}</div></div>
                      </div>
                    </div>
                    <div className="grid content-start gap-2 text-xs text-slate-700">
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="font-bold text-slate-900">代表オプション</div>
                        <div>Bid/Ask: {topQuote?.bid ?? "-"} / {topQuote?.ask ?? "-"}</div>
                        <div>Mid/Last: {topQuote?.mid ?? "-"} / {topQuote?.last ?? "-"}</div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-2 text-slate-600 hover:border-slate-400 hover:bg-slate-50" title={candidate.watchOnly ? "Watch onlyを解除" : "Watch onlyにする"} onClick={() => onWatchOnly(candidate.id, !candidate.watchOnly)}><Eye size={15} /></button>
                        <button className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800" title="エントリー根拠を記録" onClick={() => setExpandedCandidateId(isExpanded ? null : candidate.id)}>根拠</button>
                        <button className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-2 text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700" title="カバードコール候補として建玉案を作成" onClick={() => requestCreateSimulation(candidate, "covered_call")}><Plus size={15} /></button>
                        <button className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800" title="P売り候補として建玉案を作成" onClick={() => requestCreateSimulation(candidate, "short_put")}>P</button>
                        <button className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800" title="コール買い候補として建玉案を作成" onClick={() => requestCreateSimulation(candidate, "long_call")}>LC</button>
                      </div>
                    </div>
                  </div>
                </article>
                {isExpanded ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
                    <CandidateDetailCard
                      candidate={candidate}
                      onJournalChange={(journal) => onJournalChange(candidate.id, journal)}
                      getDefaultJournal={() => createJournalForCandidate(candidate)}
                      onChecklistChange={(state) => onChecklistChange(candidate.id, state)}
                    />
                  </div>
                ) : null}
              </Fragment>
            );
          })}
          <div className="mt-1 flex items-center gap-2 text-xs leading-5 text-slate-500">
            <AlertTriangle size={14} />
            ランキングは確認優先度です。建玉案作成後も、権利行使価格・満期・プレミアム・証拠金は手入力で確認します。自動発注機能はありません。
          </div>
        </div>
      )}
      {draftGate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label="建玉案レビュー前確認">
          <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
            {(() => {
              const summary = summarizeCandidateReview(draftGate.candidate);
              return (
                <>
                  <div className="text-base font-black text-slate-950">建玉案レビュー前確認</div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {draftGate.candidate.symbol} は {summary.label} です。チェック済みは注文許可ではなく確認済みの記録です。建玉案レビュー可は入力候補として確認可という意味で扱います。
                  </p>
                  <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
                    <div className="font-bold">確認状態</div>
                    <div>確認済み {summary.checkedCount}/{summary.totalCount} / 必須未確認 {summary.requiredUncheckedCount}</div>
                    {summary.uncheckedRequiredLabels.length ? <div className="mt-1">必須未確認: {summary.uncheckedRequiredLabels.join(" / ")}</div> : null}
                    {summary.blockedReasons.length ? <div className="mt-1 text-rose-900">保留理由: {summary.blockedReasons.join(" / ")}</div> : null}
                  </div>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700" onClick={() => setDraftGate(null)}>キャンセル</button>
                    <button className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950" onClick={proceedDraftGate}>未確認を理解して建玉案レビューへ進む</button>
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
