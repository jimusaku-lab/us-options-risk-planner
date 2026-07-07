import type { CandidateReviewChecklistState, CandidateSymbol } from "@/types/candidates";
import type { EntryRationaleJournal } from "@/types/domain";
import type { PositionDraftReviewChecklistId, PositionDraftStatus, PublicStrategyFitLevel, StrategyFitLevel, StrategyPrecisionReviewLevel } from "@/types/screening";
import type { ReactNode } from "react";
import { EntryRationaleJournalPanel } from "@/components/journal/EntryRationaleJournalPanel";
import { buildScreeningDecisionSummary } from "@/domain/screeningDecisionSummary";
import {
  buildJournalPatchFromCandidateReview,
  createChecklistStateFromPrecisionReview,
  mergeChecklistState,
  summarizeCandidateReview,
} from "@/domain/candidateReviewChecklist";
import { updateJournalTimestamp } from "@/domain/entryRationaleJournal";
import {
  screeningDisplayItems,
  screeningDisplayLabel,
  screeningDisplayValue,
  screeningFieldLabel,
  screeningListTitle,
  screeningStrategyLabel,
} from "@/domain/screeningDisplayLabels";
import { priorityBandLabel, targetStrategyLabel, type ScreeningPriorityReview } from "@/domain/screeningPriority";
import { createScreeningReviewHandoff, formatScreeningReviewHandoffMemo, mergeReviewHandoffIntoJournal } from "@/domain/screeningReviewPayload";
import { formatUSD } from "@/lib/format";

type CandidateDetailCardProps = {
  candidate: CandidateSymbol;
  priorityReviews?: ScreeningPriorityReview[];
  onJournalChange?: (journal: EntryRationaleJournal) => void;
  getDefaultJournal?: () => EntryRationaleJournal;
  onChecklistChange?: (state: CandidateReviewChecklistState) => void;
  onDraftReviewChecklistChange?: (draftId: string, itemId: PositionDraftReviewChecklistId, checked: boolean) => void;
  reviewHandoffSource?: "local" | "public" | "manual" | "imported";
};

type PrecisionBoxItem = {
  level: StrategyPrecisionReviewLevel;
  reasons: string[];
  warnings: string[];
  targetDteRange?: [number, number];
  actualDte?: number;
  targetStrikeRatioRange?: [number, number];
  actualStrikeRatio?: number;
};

function formatValue(value: unknown, fallback = "-"): string {
  if (typeof value === "number" && Number.isFinite(value)) return Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "boolean") return value ? "確認済み" : "未確認";
  return fallback;
}

function formatPercent(value?: number): string {
  return value === undefined ? "-" : `${value.toFixed(2)}%`;
}

function fitLabel(level: StrategyFitLevel): string {
  return screeningDisplayLabel("fitLevel", level);
}

function fitClass(level: StrategyFitLevel): string {
  if (level === "fit") return "border-teal-200 bg-teal-50 text-teal-800";
  if (level === "watch") return "border-sky-200 bg-sky-50 text-sky-800";
  if (level === "avoid") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function publicFitLabel(level: PublicStrategyFitLevel): string {
  return screeningDisplayLabel("publicFitLevel", level);
}

function publicFitClass(level: PublicStrategyFitLevel): string {
  if (level === "fit") return "border-teal-200 bg-teal-50 text-teal-800";
  if (level === "watch") return "border-sky-200 bg-sky-50 text-sky-800";
  if (level === "manual_review_required") return "border-amber-200 bg-amber-50 text-amber-900";
  if (level === "avoid") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function positionDraftStatusLabel(status: PositionDraftStatus): string {
  return screeningDisplayLabel("positionDraftStatus", status);
}

function reviewStatusLabel(status?: string): string {
  return status ? screeningDisplayLabel("reviewStatus", status) : "-";
}

function precisionLevelLabel(level: StrategyPrecisionReviewLevel): string {
  return screeningDisplayLabel("precisionLevel", level);
}

function precisionLevelClass(level: StrategyPrecisionReviewLevel): string {
  if (level === "pass") return "border-teal-200 bg-teal-50 text-teal-800";
  if (level === "watch") return "border-sky-200 bg-sky-50 text-sky-800";
  if (level === "blocked") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function decisionStatusClass(status: ReturnType<typeof buildScreeningDecisionSummary>["status"]): string {
  if (status === "draft_ready") return "border-teal-200 bg-teal-50 text-teal-900";
  if (status === "option_data_needed" || status === "capital_needed" || status === "margin_confirmation_needed") return "border-amber-200 bg-amber-50 text-amber-950";
  if (status === "avoid_now") return "border-rose-200 bg-rose-50 text-rose-900";
  if (status === "insufficient_data") return "border-slate-200 bg-slate-100 text-slate-700";
  return "border-sky-200 bg-sky-50 text-sky-900";
}

function strategyLabel(strategy: string): string {
  return screeningStrategyLabel(strategy);
}

function ListBlock({ title, items, tone = "slate" }: { title: string; items?: string[]; tone?: "slate" | "amber" | "rose" | "teal" }) {
  if (!items?.length) return null;
  const displayItems = screeningDisplayItems(title, items);
  const toneClass =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : tone === "rose"
        ? "border-rose-200 bg-rose-50 text-rose-950"
        : tone === "teal"
          ? "border-teal-200 bg-teal-50 text-teal-950"
          : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <div className={`rounded-md border px-3 py-2 text-xs leading-5 ${toneClass}`}>
      <div className="font-bold">{screeningListTitle(title)}</div>
      <ul className="mt-1 grid gap-1">
        {displayItems.map((item, index) => (
          <li key={`${title}-${item}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] font-bold text-slate-500">{screeningFieldLabel(label)}</div>
      <div className="mt-1 break-words text-xs font-semibold text-slate-900">{screeningDisplayValue(label, value)}</div>
    </div>
  );
}

function PrecisionReviewBox({ title, item }: { title: string; item: PrecisionBoxItem }) {
  return (
    <div className={`rounded-md border px-3 py-2 text-xs leading-5 ${precisionLevelClass(item.level)}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold">{title}</span>
        <span className="rounded bg-white/70 px-1.5 py-0.5 font-bold">{precisionLevelLabel(item.level)}</span>
      </div>
      {item.targetDteRange ? (
        <div className="mt-1">DTE {item.actualDte ?? "-"} / 目安 {item.targetDteRange[0]}-{item.targetDteRange[1]}</div>
      ) : null}
      {item.targetStrikeRatioRange ? (
        <div className="mt-1">
          strike/株価 {item.actualStrikeRatio === undefined ? "-" : item.actualStrikeRatio.toFixed(2)} / 目安 {item.targetStrikeRatioRange[0].toFixed(2)}-{item.targetStrikeRatioRange[1].toFixed(2)}
        </div>
      ) : null}
      <ul className="mt-2 grid gap-1">
        {[...item.reasons, ...item.warnings].slice(0, 5).map((entry, index) => (
          <li key={`${title}-${entry}-${index}`}>{entry}</li>
        ))}
      </ul>
    </div>
  );
}

function ReviewChecklistEditor({
  candidate,
  state,
  onChange,
}: {
  candidate: CandidateSymbol;
  state: CandidateReviewChecklistState;
  onChange?: (state: CandidateReviewChecklistState) => void;
}) {
  const summary = summarizeCandidateReview({ strategyPrecisionReviews: candidate.strategyPrecisionReviews, reviewChecklistStates: [state] });
  const updateItems = (items: CandidateReviewChecklistState["items"]) => onChange?.(mergeChecklistState(state, { items }));
  const updateNote = (note: string) => onChange?.(mergeChecklistState(state, { note }));
  const reset = () => updateItems(state.items.map((item) => ({ ...item, checked: false })));
  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold text-slate-800">建玉案レビューの手動確認チェック</div>
          <div className="mt-1 text-xs text-slate-600">
            確認済み {summary.checkedCount}/{summary.totalCount} / 必須未確認 {summary.requiredUncheckedCount} / {summary.label}
          </div>
        </div>
        <button type="button" className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700" onClick={reset}>
          すべて未確認に戻す
        </button>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {state.items.map((item) => (
          <label key={item.id} className="flex items-start gap-2 rounded-md border border-slate-200 bg-white px-2 py-2 text-xs leading-5 text-slate-700">
            <input
              type="checkbox"
              className="mt-1"
              checked={item.checked}
              onChange={(event) => updateItems(state.items.map((current) => current.id === item.id ? { ...current, checked: event.target.checked } : current))}
            />
            <span className="min-w-0">
              <span className="font-semibold text-slate-900">{item.label}</span>
              {item.required ? <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-bold text-amber-900">必須</span> : null}
            </span>
          </label>
        ))}
      </div>
      <label className="mt-3 grid gap-1 text-xs font-bold text-slate-700">
        確認メモ
        <textarea
          className="min-h-20 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal leading-6 text-slate-900"
          value={state.note ?? ""}
          placeholder="証券会社画面で確認したこと、未確認の理由など"
          onChange={(event) => updateNote(event.target.value)}
        />
      </label>
      <div className="mt-2 text-[11px] font-semibold text-slate-500">最終更新: {state.updatedAt}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
      <h4 className="text-sm font-bold text-slate-950">{title}</h4>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function copyText(text: string): void {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === "undefined") return;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function downloadText(fileName: string, text: string): void {
  if (typeof document === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    copyText(text);
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CandidateDetailCard({ candidate, priorityReviews, onJournalChange, getDefaultJournal, onChecklistChange, onDraftReviewChecklistChange, reviewHandoffSource }: CandidateDetailCardProps) {
  const screening = candidate.screeningCandidate;
  const publicInput = candidate.publicScreeningInput;
  const completeness = candidate.screeningCompleteness;
  const chartAnalysis = publicInput?.chartAnalysis;
  const strategySuitability = candidate.strategySuitability ?? publicInput?.strategySuitability;
  const positionDrafts = candidate.positionDrafts ?? publicInput?.positionDrafts;
  const advancedStrategyReviews = candidate.advancedStrategyReviews ?? publicInput?.advancedStrategyReviews;
  const strategyPrecisionReviews = candidate.strategyPrecisionReviews ?? publicInput?.strategyPrecisionReviews;
  const decisionSummary = buildScreeningDecisionSummary(candidate, priorityReviews ?? []);
  const optionCandidates = publicInput?.optionCandidates ?? [];
  const technical = screening?.technicalSnapshot;
  const optionQuality = screening?.optionChainQuality;
  const warningItems = [
    candidate.earningsWarning,
    ...(candidate.parseWarnings ?? []),
    ...(screening?.riskFlags ?? []),
    ...(optionQuality?.qualityWarnings ?? []),
  ].filter((item): item is string => Boolean(item));
  const missingItems = screening?.missingFields ?? [];
  const reviewSummary = summarizeCandidateReview(candidate);
  const handoff = createScreeningReviewHandoff({
    candidate,
    generatedAt: new Date().toISOString(),
    appVersion: "0.1.0",
    source: reviewHandoffSource ?? "public",
  });
  const manualReviewMemo = formatScreeningReviewHandoffMemo(handoff);
  const handoffJson = JSON.stringify(handoff, null, 2);
  const updateChecklist = (state: CandidateReviewChecklistState) => onChecklistChange?.(state);
  const reflectHandoffToJournal = () => {
    if (!onJournalChange) return;
    const journal = candidate.entryRationaleJournal ?? getDefaultJournal?.() ?? {
      id: `journal-${candidate.id}`,
      candidateId: candidate.id,
      symbol: candidate.symbol,
      underlyingName: candidate.company,
      strategy: "custom",
      status: "candidate",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      entryReason: "",
      technicalTags: [],
      chartEvidence: [],
      review: { outcome: "not_reviewed" },
    };
    onJournalChange(mergeReviewHandoffIntoJournal(journal, handoff));
  };
  const reflectReviewToJournal = (reviewState: CandidateReviewChecklistState) => {
    const review = strategyPrecisionReviews?.find((item) => item.strategy === reviewState.strategy);
    if (!review || !onJournalChange) return;
    const base = candidate.entryRationaleJournal ?? getDefaultJournal?.();
    if (!base) return;
    const patch = buildJournalPatchFromCandidateReview(candidate, review, reviewState);
    onJournalChange(updateJournalTimestamp({ ...base, ...patch }));
  };

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-slate-500">候補詳細</div>
          <h3 className="mt-1 text-base font-bold text-slate-950">
            {candidate.symbol} <span className="font-semibold text-slate-600">{screening?.name ?? candidate.company}</span>
          </h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className={`rounded-full border px-2 py-1 text-xs font-bold ${decisionStatusClass(decisionSummary.status)}`}>
            {decisionSummary.label}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-700">
            第一候補: {decisionSummary.primaryStrategyLabel}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Section title="総合判定">
          <div className={`rounded-md border px-3 py-3 ${decisionStatusClass(decisionSummary.status)}`}>
            <div className="text-base font-black">{decisionSummary.label}</div>
            <div className="mt-2 grid gap-1 text-xs leading-5">
              <div>第一候補: <span className="font-bold">{decisionSummary.primaryStrategyLabel}</span></div>
              <div>基本取引: <span className="font-bold">{decisionSummary.primaryBasicTrade}</span></div>
              <div>次アクション: {decisionSummary.nextAction}</div>
              <div className="text-[11px] font-semibold opacity-80">これは売買推奨ではありません。未確認ゲートが残る場合は候補として強調しません。</div>
            </div>
          </div>
        </Section>

        <Section title="チャート根拠">
          <div className="grid gap-2 text-xs leading-5">
            <div className="font-bold text-slate-950">{decisionSummary.chart.headline}</div>
            <div>月足: {decisionSummary.chart.monthlyDirection} / 週足: {decisionSummary.chart.weeklyDirection}</div>
            <div>MACD: {decisionSummary.chart.macd} / SlowKD: {decisionSummary.chart.slowKd}</div>
            <div>{decisionSummary.chart.movingAveragePosition}</div>
            <div>{decisionSummary.chart.maCross}</div>
            <div>{decisionSummary.chart.supportResistance}</div>
          </div>
          <ListBlock title="主要サイン" items={decisionSummary.chart.keySignals} tone="teal" />
        </Section>

        <Section title="第一候補">
          {decisionSummary.primaryStrategy ? (
            <div className="grid gap-3">
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-5">
                <div className="font-bold text-slate-950">{decisionSummary.primaryStrategyLabel} / {decisionSummary.primaryBasicTrade}</div>
                <div className="mt-1 text-slate-600">満期、権利行使価格、流動性、資金条件は下の未確認ゲートで確認します。</div>
              </div>
              <ListBlock title="なぜ選ばれたか" items={decisionSummary.selectedReasons} tone="teal" />
              <ListBlock title="未確認ゲート" items={decisionSummary.unconfirmedGates} tone="amber" />
            </div>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
              第一候補なし。チャート確認、オプションBid/Ask、資金条件、保有株、証拠金の不足を先に確認してください。
            </div>
          )}
          {decisionSummary.droppedStrategies.length ? (
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
              <div className="font-bold text-slate-900">なぜ他戦略を落としたか</div>
              <ul className="mt-1 grid gap-1">
                {decisionSummary.droppedStrategies.map((item) => (
                  <li key={item.strategy}>{item.label}: {screeningDisplayItems("missingFields", [item.reason])[0] ?? item.reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>

        <Section title="不足データ・次アクション">
          <div className="grid gap-2">
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-5">
              <div className="font-bold text-slate-950">次アクション</div>
              <div className="mt-1">{decisionSummary.nextAction}</div>
            </div>
            <ListBlock title="未確認ゲート" items={decisionSummary.unconfirmedGates} tone="amber" />
            <ListBlock title="missingFields" items={decisionSummary.missingData} tone="amber" />
            <ListBlock title="blockers" items={decisionSummary.blockers} tone="rose" />
          </div>
        </Section>
      </div>

      {priorityReviews?.length ? (
        <details className="mt-4 rounded-md border border-slate-200 bg-slate-50/70 p-3">
          <summary className="cursor-pointer text-sm font-bold text-slate-950">全戦略比較（内部スコア詳細）</summary>
          <div className="mt-3 text-xs leading-5 text-slate-600">
            内部スコアは確認順の補助であり、売買推奨ではありません。第一候補は上の総合判定で、未確認ゲートと除外理由を含めて確認してください。
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {priorityReviews.map((review) => (
              <div key={review.targetStrategy} className="rounded-md border border-slate-200 bg-white p-3 text-xs leading-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-black text-slate-950">{targetStrategyLabel(review.targetStrategy)}</span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-bold text-slate-700">
                    {priorityBandLabel(review.band)} {review.score}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-slate-700 sm:grid-cols-3">
                  <div>{screeningDisplayLabel("scoreItem", "chart")} {review.chartScore}/35</div>
                  <div>{screeningDisplayLabel("scoreItem", "strategy")} {review.strategyScore}/25</div>
                  <div>{screeningDisplayLabel("scoreItem", "complete")} {review.completenessScore}/15</div>
                  <div>{screeningDisplayLabel("scoreItem", "stock")} {review.stockQualityScore}/10</div>
                  <div>{screeningDisplayLabel("scoreItem", "option")} {review.optionReadinessScore}/10</div>
                  <div>{screeningDisplayLabel("scoreItem", "capital")} {review.capitalReadinessScore}/5</div>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  <ListBlock title="reasons" items={review.reasons} tone="teal" />
                  <ListBlock title="blockers" items={review.blockers} tone="rose" />
                  <ListBlock title="nextDataNeeded" items={review.nextDataNeeded} tone="amber" />
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Section title="建玉案レビュー前サマリー">
          <div className="grid gap-3">
            <div className={`rounded-md border px-3 py-2 text-sm ${reviewSummary.status === "ready_for_review" ? "border-teal-200 bg-teal-50 text-teal-900" : reviewSummary.status === "blocked" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
              <div className="font-bold">{reviewSummary.label}</div>
              <div className="mt-1 text-xs leading-5">
                確認済み {reviewSummary.checkedCount}/{reviewSummary.totalCount} / 必須未確認 {reviewSummary.requiredUncheckedCount}
              </div>
              <div className="mt-1 text-xs leading-5">チェック済みは注文許可ではなく確認記録です。建玉案レビュー可は入力候補として確認可という意味です。</div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <ListBlock title="必須未確認" items={reviewSummary.uncheckedRequiredLabels} tone="amber" />
              <ListBlock title="保留理由" items={reviewSummary.blockedReasons} tone="rose" />
            </div>
          </div>
        </Section>

        <Section title="基本情報">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label="symbol" value={candidate.symbol} />
            <Metric label="name" value={screening?.name ?? candidate.company} />
            <Metric label="market" value={screening?.market} />
            <Metric label="sector" value={screening?.sector ?? candidate.sector} />
            <Metric label="dataSource" value={screening?.dataSource ?? candidate.source} />
            <Metric label="delayStatus" value={screening?.delayStatus} />
            <Metric label="price" value={candidate.priceUSD === undefined ? screening?.underlyingPrice : formatUSD(candidate.priceUSD)} />
            <Metric label="priceAsOf" value={screening?.priceAsOf} />
            <Metric label="importedAt" value={candidate.importedAt} />
          </div>
        </Section>

        <Section title="データ充足">
          {completeness ? (
            <div className="grid gap-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Metric label="level" value={completeness.level} />
                <Metric label="strategy" value={completeness.canClassifyStrategy} />
                <Metric label="chart" value={completeness.canAnalyzeChart} />
                <Metric label="optionLiquidity" value={completeness.canEvaluateOptionLiquidity} />
                <Metric label="positionDraft" value={completeness.canCreatePositionDraft} />
                <Metric label="dataPolicy" value={publicInput ? "ユーザー提供データ" : "-"} />
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <ListBlock title="missingFields" items={completeness.missingFields} tone="amber" />
                <ListBlock title="warnings" items={completeness.warnings} tone="rose" />
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">公開版データ充足情報はありません。</p>
          )}
        </Section>

        <Section title="チャート分析">
          {chartAnalysis ? (
            <div className="grid gap-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="regime" value={chartAnalysis.regime} />
                <Metric label="confidence" value={chartAnalysis.confidence} />
                <Metric label="primary" value={chartAnalysis.primaryTimeframe} />
                <Metric label="asOf" value={chartAnalysis.asOf} />
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <ListBlock title="reasons" items={chartAnalysis.reasons} tone="teal" />
                <ListBlock title="warnings" items={chartAnalysis.warnings} tone="amber" />
                <ListBlock title="missingFields" items={chartAnalysis.missingFields} tone="rose" />
              </div>
              {chartAnalysis.timeframes.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500">
                        <th className="py-2 pr-3">足</th>
                        <th className="py-2 pr-3">終値</th>
                        <th className="py-2 pr-3">SMA25/50/200</th>
                        <th className="py-2 pr-3">MACD</th>
                        <th className="py-2 pr-3">SlowKD</th>
                        <th className="py-2 pr-3">RSI</th>
                        <th className="py-2 pr-3">距離</th>
                        <th className="py-2 pr-3">支持/抵抗</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chartAnalysis.timeframes.map((timeframe) => (
                        <tr key={timeframe.timeframe} className="border-b border-slate-100">
                          <td className="py-2 pr-3 font-bold text-slate-900">{screeningDisplayLabel("timeframe", timeframe.timeframe)}</td>
                          <td className="py-2 pr-3">{formatValue(timeframe.close)}</td>
                          <td className="py-2 pr-3">{[timeframe.sma25, timeframe.sma50, timeframe.sma200].map((value) => formatValue(value)).join(" / ")}</td>
                          <td className="py-2 pr-3">{timeframe.macdSignal ? screeningDisplayLabel("technicalSignal", timeframe.macdSignal) : "-"}</td>
                          <td className="py-2 pr-3">{timeframe.slowKdSignal ? screeningDisplayLabel("technicalSignal", timeframe.slowKdSignal) : "-"}</td>
                          <td className="py-2 pr-3">{formatValue(timeframe.rsi)}</td>
                          <td className="py-2 pr-3">
                            MA25 {formatPercent(timeframe.priceLocation?.distanceFromMa25Pct)} / MA50 {formatPercent(timeframe.priceLocation?.distanceFromMa50Pct)}
                          </td>
                          <td className="py-2 pr-3">
                            S {timeframe.supportLevels?.slice(0, 3).map((value) => formatValue(value)).join(", ") || "-"} / R {timeframe.resistanceLevels?.slice(0, 3).map((value) => formatValue(value)).join(", ") || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-slate-500">チャート分析はありません。</p>
          )}
        </Section>

        <Section title="株価・テクニカル">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label="dailyClose" value={technical?.dailyClose} />
            <Metric label="SMA25" value={technical?.sma25} />
            <Metric label="SMA50" value={technical?.sma50} />
            <Metric label="SMA200" value={technical?.sma200} />
            <Metric label="MA25 slope" value={technical?.movingAverageSlopes?.ma25} />
            <Metric label="MA50 slope" value={technical?.movingAverageSlopes?.ma50} />
            <Metric label="MA200 slope" value={technical?.movingAverageSlopes?.ma200} />
            <Metric label="MACD" value={technical?.macdSignal} />
            <Metric label="SlowKD" value={technical?.slowKdSignal} />
            <Metric label="RSI" value={technical?.rsi} />
          </div>
          <ListBlock title="trendNotes" items={technical?.trendNotes} />
          {technical?.signalEvents?.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-3">シグナル</th>
                    <th className="py-2 pr-3">発生日</th>
                    <th className="py-2 pr-3">確認期間</th>
                    <th className="py-2 pr-3">強度</th>
                    <th className="py-2 pr-3">メモ</th>
                  </tr>
                </thead>
                <tbody>
                  {technical.signalEvents.map((event, index) => (
                    <tr key={`${event.type}-${index}`} className="border-b border-slate-100">
                      <td className="py-2 pr-3 font-semibold text-slate-900">{screeningDisplayValue("technicalSignal", event.type)}</td>
                      <td className="py-2 pr-3">{event.occurredAt}</td>
                      <td className="py-2 pr-3">{event.lookbackTradingDays}</td>
                      <td className="py-2 pr-3">{screeningDisplayValue("technicalSignal", event.strength)}</td>
                      <td className="py-2 pr-3">{event.notes ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Section>

        <Section title="オプション品質">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label="hasOptionChain" value={optionQuality?.hasOptionChain} />
            <Metric label="expirationCount" value={optionQuality?.expirationCount} />
            <Metric label="targetDteAvailable" value={optionQuality?.targetDteAvailable} />
            <Metric label="bidAskSpreadRate" value={formatPercent(optionQuality?.bidAskSpreadRate)} />
            <Metric label="volume" value={optionQuality?.volume} />
            <Metric label="openInterest" value={optionQuality?.openInterest} />
            <Metric label="IV" value={optionQuality?.iv} />
            <Metric label="delta" value={optionQuality?.delta} />
            <Metric label="gamma" value={optionQuality?.gamma} />
            <Metric label="theta" value={optionQuality?.theta} />
            <Metric label="vega" value={optionQuality?.vega} />
          </div>
          <ListBlock title="qualityWarnings" items={optionQuality?.qualityWarnings} tone="amber" />
        </Section>

        <Section title="データ不足・警告">
          <div className="grid gap-2">
            <ListBlock title="missingFields" items={missingItems} tone="amber" />
            <ListBlock title="warnings / riskFlags" items={warningItems} tone="rose" />
            {!missingItems.length && !warningItems.length ? <p className="text-xs text-slate-500">表示対象の不足・警告はありません。</p> : null}
          </div>
        </Section>
      </div>

      <Section title="戦略適性">
        {strategySuitability?.length ? (
          <div className="grid gap-3">
            {strategySuitability.map((result) => (
              <div key={result.strategy} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-950">{strategyLabel(result.strategy)}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${publicFitClass(result.level)}`}>{publicFitLabel(result.level)}</span>
                  <span className="text-xs font-semibold text-slate-500">
                    {result.chartRegime ? screeningDisplayLabel("chartRegime", result.chartRegime) : "-"} / {result.confidence ? screeningDisplayLabel("chartConfidence", result.confidence) : "-"}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-4">
                  <ListBlock title="reasons" items={result.reasons} tone="teal" />
                  <ListBlock title="warnings" items={result.warnings} tone="amber" />
                  <ListBlock title="missingFields" items={result.missingFields} tone="rose" />
                  <ListBlock title="manualReview" items={result.manualReviewReasons} tone="amber" />
                </div>
                <ListBlock title="nextChecks" items={result.nextChecks} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">公開版戦略適性はありません。旧戦略別判定を確認してください。</p>
        )}
      </Section>

      <Section title="戦略精度レビュー">
        {strategyPrecisionReviews?.length ? (
          <div className="grid gap-3">
            {strategyPrecisionReviews.map((review) => {
              const checklistState = createChecklistStateFromPrecisionReview(
                { id: candidate.id, symbol: candidate.symbol },
                review,
                candidate.reviewChecklistStates?.find((item) => item.strategy === review.strategy),
              );
              return (
                <div key={review.strategy} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-950">{strategyLabel(review.strategy)}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${publicFitClass(review.level)}`}>{publicFitLabel(review.level)}</span>
                    <span className="text-xs font-semibold text-slate-500">fitは候補、建玉案はレビュー用です。</span>
                  </div>
                  <div className="mt-3 grid gap-2 lg:grid-cols-5">
                    <PrecisionReviewBox title="チャート最終ゲート" item={review.chartGate} />
                    <PrecisionReviewBox title="満期レビュー" item={review.expiryReview} />
                    <PrecisionReviewBox title="strikeレビュー" item={review.strikeReview} />
                    <PrecisionReviewBox title="流動性レビュー" item={review.liquidityReview} />
                    <PrecisionReviewBox title="資金レビュー" item={review.capitalReview} />
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <ListBlock title="避ける理由" items={review.avoidReasons} tone="rose" />
                    <ListBlock title="手動確認理由" items={review.manualReviewReasons} tone="amber" />
                    <ListBlock title="次に確認すること" items={review.nextChecks} />
                  </div>
                  <ReviewChecklistEditor candidate={candidate} state={checklistState} onChange={updateChecklist} />
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <button
                      className="rounded-md border border-teal-300 bg-teal-50 px-2.5 py-1.5 font-bold text-teal-900 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!onJournalChange}
                      onClick={() => reflectReviewToJournal(checklistState)}
                    >
                      候補レビューを根拠メモへ反映
                    </button>
                    <span className="text-slate-500">既存メモは自動上書きせず、確認内容を追記します。</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-500">戦略精度レビューはありません。</p>
        )}
      </Section>

      <Section title="オプション候補・流動性">
        {optionCandidates.length || positionDrafts?.some((draft) => draft.legs.length) ? (
          <div className="grid gap-3">
            {optionCandidates.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="py-2 pr-3">種別</th>
                      <th className="py-2 pr-3">満期</th>
                      <th className="py-2 pr-3">DTE</th>
                      <th className="py-2 pr-3">権利行使価格</th>
                      <th className="py-2 pr-3">Bid/Ask</th>
                      <th className="py-2 pr-3">Mid/Last</th>
                      <th className="py-2 pr-3">Vol/OI</th>
                      <th className="py-2 pr-3">IV/Delta</th>
                      <th className="py-2 pr-3">価格ソース</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optionCandidates.slice(0, 12).map((option, index) => (
                      <tr key={option.id ?? `${option.optionType}-${option.expiry}-${option.strike ?? option.strikePrice}-${index}`} className="border-b border-slate-100">
                        <td className="py-2 pr-3 font-bold text-slate-900">{screeningDisplayLabel("optionType", option.optionType)}</td>
                        <td className="py-2 pr-3">{option.expiry ?? "-"}</td>
                        <td className="py-2 pr-3">{formatValue(option.dte)}</td>
                        <td className="py-2 pr-3">{formatValue(option.strikePrice ?? option.strike)}</td>
                        <td className="py-2 pr-3">{formatValue(option.bid)} / {formatValue(option.ask)}</td>
                        <td className="py-2 pr-3">{formatValue(option.mid)} / {formatValue(option.last)}</td>
                        <td className="py-2 pr-3">{formatValue(option.volume)} / {formatValue(option.openInterest)}</td>
                        <td className="py-2 pr-3">{formatValue(option.iv)} / {formatValue(option.delta)}</td>
                        <td className="py-2 pr-3">{option.source ? screeningDisplayValue("source", option.source) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p className="text-xs leading-5 text-slate-600">保守価格ルール: 買いはAsk、売りはBid。MidとLastは参考値です。</p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">オプション候補はありません。</p>
        )}
      </Section>

      <Section title="建玉案レビュー">
        {positionDrafts?.length ? (
          <div className="grid gap-3">
            {positionDrafts.map((draft) => (
              <div key={draft.id} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-950">{strategyLabel(draft.strategy)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${draft.status === "draft_ready" ? "bg-teal-50 text-teal-800" : draft.status === "manual_review_required" ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-700"}`}>
                    {positionDraftStatusLabel(draft.status)}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="requiredCapitalUSD" value={draft.requiredCapitalUSD === undefined ? undefined : formatUSD(draft.requiredCapitalUSD)} />
                  <Metric label="maxLossUSD" value={draft.maxLossUSD === undefined ? undefined : formatUSD(draft.maxLossUSD)} />
                  <Metric label="availableCashUSD" value={draft.availableCashUSD === undefined ? undefined : formatUSD(draft.availableCashUSD)} />
                  <Metric label="capitalQuality" value={draft.capital?.capitalQuality} />
                  <Metric label="premiumDebitUSD" value={draft.capital?.premiumDebitUSD === undefined ? undefined : formatUSD(draft.capital.premiumDebitUSD)} />
                  <Metric label="premiumCreditUSD" value={draft.capital?.premiumCreditUSD === undefined ? undefined : formatUSD(draft.capital.premiumCreditUSD)} />
                  <Metric label="assignmentCapital" value={draft.capital?.assignmentCapitalRequiredUSD === undefined ? undefined : formatUSD(draft.capital.assignmentCapitalRequiredUSD)} />
                  <Metric label="reviewStatus" value={reviewStatusLabel(draft.reviewState?.reviewStatus)} />
                </div>
                {draft.legs.length ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[760px] text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="py-2 pr-3">種別/売買</th>
                          <th className="py-2 pr-3">満期</th>
                          <th className="py-2 pr-3">DTE</th>
                          <th className="py-2 pr-3">権利行使価格</th>
                          <th className="py-2 pr-3">保守価格</th>
                          <th className="py-2 pr-3">価格根拠</th>
                          <th className="py-2 pr-3">Mid/Last</th>
                          <th className="py-2 pr-3">qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draft.legs.map((leg) => (
                          <tr key={leg.id} className="border-b border-slate-100">
                            <td className="py-2 pr-3 font-bold text-slate-900">
                              {screeningDisplayLabel("optionType", leg.optionType)} / {screeningDisplayLabel("legSide", leg.side)}
                            </td>
                            <td className="py-2 pr-3">{leg.expiry ?? "-"}</td>
                            <td className="py-2 pr-3">{formatValue(leg.dte)}</td>
                            <td className="py-2 pr-3">{formatValue(leg.strikePrice)}</td>
                            <td className="py-2 pr-3">{formatValue(leg.conservativePrice)} {leg.conservativePriceField ? `(${leg.conservativePriceField})` : ""}</td>
                            <td className="py-2 pr-3">{leg.conservativePriceField ? `Bid/Ask ${leg.conservativePriceField}` : "未確認"}</td>
                            <td className="py-2 pr-3">{formatValue(leg.mid)} / {formatValue(leg.last)}</td>
                            <td className="py-2 pr-3">{formatValue(leg.quantity)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="profitTakePrice" value={draft.exitPlan?.profitTakePrice} />
                  <Metric label="stopLossPrice" value={draft.exitPlan?.stopLossPrice} />
                  <Metric label="latestCloseDate" value={draft.exitPlan?.latestCloseDate} />
                  <Metric label="expiryHandling" value={draft.exitPlan?.expiryHandling} />
                </div>
                {draft.reviewState?.checklist.length ? (
                  <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs font-bold text-slate-900">レビュー前チェックリスト</div>
                    <div className="mt-2 grid gap-1 md:grid-cols-2">
                      {draft.reviewState.checklist.map((item) => (
                        <label key={item.id} className="flex items-start gap-2 text-xs leading-5 text-slate-700">
                          <input
                            type="checkbox"
                            checked={item.checked}
                            readOnly={!onDraftReviewChecklistChange}
                            onChange={(event) => onDraftReviewChecklistChange?.(draft.id, item.id, event.target.checked)}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="font-semibold">{item.label}</span>
                            {item.required ? <span className="ml-1 text-rose-700">必須</span> : null}
                          </span>
                        </label>
                      ))}
                    </div>
                    <ListBlock title="transferWarnings" items={draft.reviewState.transferWarnings} tone="amber" />
                  </div>
                ) : null}
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <ListBlock title="warnings" items={draft.warnings} tone="amber" />
                  <ListBlock title="missingFields" items={draft.missingFields} tone="rose" />
                  <ListBlock title="exitPlan notes" items={draft.exitPlan?.notes} tone="slate" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">建玉案レビューはありません。Level 1-2ではチャート・オプション・資金の不足を確認してください。</p>
        )}
      </Section>

      <Section title="上級戦略レビュー">
        {advancedStrategyReviews?.length ? (
          <div className="grid gap-3">
            {advancedStrategyReviews.map((review) => (
              <div key={review.id} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-950">{strategyLabel(review.strategy)}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${publicFitClass(review.level)}`}>{publicFitLabel(review.level)}</span>
                  <span className="text-xs font-semibold text-slate-500">
                    {review.chartRegime ? screeningDisplayLabel("chartRegime", review.chartRegime) : "-"} / {review.confidence ? screeningDisplayLabel("chartConfidence", review.confidence) : "-"}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-600">
                  上級戦略は比較・手動確認用です。ここから自動発注や建玉入力への自動転記は行いません。
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="netPremiumUSD" value={review.netPremiumUSD === undefined ? undefined : formatUSD(review.netPremiumUSD)} />
                  <Metric label="requiredCapitalUSD" value={review.requiredCapitalUSD === undefined ? undefined : formatUSD(review.requiredCapitalUSD)} />
                  <Metric label="maxLossUSD" value={review.maxLossUSD === undefined ? undefined : formatUSD(review.maxLossUSD)} />
                  <Metric label="stockEquivalentNotionalUSD" value={review.stockEquivalentNotionalUSD === undefined ? undefined : formatUSD(review.stockEquivalentNotionalUSD)} />
                  <Metric label="breakEvenUpperUSD" value={review.breakEvenUpperUSD === undefined ? undefined : formatUSD(review.breakEvenUpperUSD)} />
                  <Metric label="breakEvenLowerUSD" value={review.breakEvenLowerUSD === undefined ? undefined : formatUSD(review.breakEvenLowerUSD)} />
                  <Metric label="effectiveAcquisitionCostUSD" value={review.effectiveAcquisitionCostUSD === undefined ? undefined : formatUSD(review.effectiveAcquisitionCostUSD)} />
                  <Metric label="legs" value={review.legs.length} />
                </div>
                {review.legs.length ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[760px] text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="py-2 pr-3">種別/売買</th>
                          <th className="py-2 pr-3">満期</th>
                          <th className="py-2 pr-3">DTE</th>
                          <th className="py-2 pr-3">権利行使価格</th>
                          <th className="py-2 pr-3">保守価格</th>
                          <th className="py-2 pr-3">Mid/Last</th>
                          <th className="py-2 pr-3">警告</th>
                        </tr>
                      </thead>
                      <tbody>
                        {review.legs.map((leg) => (
                          <tr key={leg.id} className="border-b border-slate-100">
                            <td className="py-2 pr-3 font-bold text-slate-900">
                              {screeningDisplayLabel("optionType", leg.optionType)} / {screeningDisplayLabel("legSide", leg.side)}
                            </td>
                            <td className="py-2 pr-3">{leg.expiry ?? "-"}</td>
                            <td className="py-2 pr-3">{formatValue(leg.dte)}</td>
                            <td className="py-2 pr-3">{formatValue(leg.strikePrice)}</td>
                            <td className="py-2 pr-3">{formatValue(leg.conservativePrice)} {leg.conservativePriceField ? `(${leg.conservativePriceField})` : ""}</td>
                            <td className="py-2 pr-3">{formatValue(leg.mid)} / {formatValue(leg.last)}</td>
                            <td className="py-2 pr-3">{leg.liquidityWarnings.slice(0, 2).join(", ") || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                <div className="mt-3 grid gap-2 md:grid-cols-4">
                  <ListBlock title="scenarios" items={review.scenarios} tone="teal" />
                  <ListBlock title="reasons" items={review.reasons} tone="teal" />
                  <ListBlock title="warnings" items={review.warnings} tone="amber" />
                  <ListBlock title="manualReview" items={review.manualReviewReasons} tone="amber" />
                </div>
                <ListBlock title="missingFields" items={review.missingFields} tone="rose" />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">上級戦略レビューはありません。</p>
        )}
      </Section>

      <Section title="戦略別判定">
        {candidate.strategyFitResults?.length ? (
          <div className="grid gap-3">
            {candidate.strategyFitResults.map((result) => (
              <div key={result.strategy} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-950">{strategyLabel(result.strategy)}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${fitClass(result.fitLevel)}`}>{fitLabel(result.fitLevel)}</span>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <ListBlock title="reasons" items={result.reasons} tone="teal" />
                  <ListBlock title="warnings" items={result.warnings} tone="amber" />
                  <ListBlock title="missingFields" items={result.missingFields} tone="rose" />
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div>
                    <div className="text-xs font-bold text-slate-700">必須チェック</div>
                    <div className="mt-1 grid gap-1">
                      {result.requiredChecks.length ? result.requiredChecks.map((check) => (
                        <div key={check.id} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1 text-xs">
                          <span>{check.label}</span>
                          <span className="font-bold">{check.passed === undefined ? "未確認" : check.passed ? "OK" : "要確認"}</span>
                        </div>
                      )) : <p className="text-xs text-slate-500">必須チェックはありません。</p>}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-700">数値チェック</div>
                    <div className="mt-1 grid gap-1">
                      {result.numericChecks.length ? result.numericChecks.map((check) => (
                        <div key={check.id} className="rounded bg-slate-50 px-2 py-1 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span>{check.label}</span>
                            <span className="font-bold">{check.passed ? "OK" : "要確認"}</span>
                          </div>
                          <div className="mt-1 text-slate-600">
                            値 {formatValue(check.value)} / 下限 {formatValue(check.min)} / 上限 {formatValue(check.max)}
                          </div>
                        </div>
                      )) : <p className="text-xs text-slate-500">数値チェックはありません。</p>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">戦略別判定はありません。</p>
        )}
      </Section>

      <Section title="上昇転換コンボ候補">
        {candidate.technicalTimingPatterns?.length ? (
          <div className="grid gap-3">
            {candidate.technicalTimingPatterns.map((pattern, index) => (
              <div key={`${pattern.kind}-${index}`} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-950">{screeningStrategyLabel(pattern.kind)}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${fitClass(pattern.fitLevel)}`}>{fitLabel(pattern.fitLevel)}</span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="signalOrder" value={pattern.signalOrder.join(" -> ")} />
                  <Metric label="slowKdCrossDate" value={pattern.timing.slowKdCrossDate} />
                  <Metric label="macdCrossDate" value={pattern.timing.macdCrossDate} />
                  <Metric label="ma25Ma50CrossDate" value={pattern.timing.ma25Ma50CrossDate} />
                  <Metric label="ma25Ma50DistancePct" value={formatPercent(pattern.timing.ma25Ma50DistancePct)} />
                  <Metric label="MA25 slope" value={pattern.timing.movingAverageSlopes.ma25} />
                  <Metric label="MA50 slope" value={pattern.timing.movingAverageSlopes.ma50} />
                  <Metric label="MA200 slope" value={pattern.timing.movingAverageSlopes.ma200} />
                  <Metric label="aboveMa25" value={pattern.timing.priceLocation.aboveMa25} />
                  <Metric label="aboveMa50" value={pattern.timing.priceLocation.aboveMa50} />
                  <Metric label="aboveMa200" value={pattern.timing.priceLocation.aboveMa200} />
                  <Metric label="comboModes" value={pattern.timing.optionComboReadiness.modes.join(", ")} />
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <ListBlock title="reasons" items={pattern.reasons} tone="teal" />
                  <ListBlock title="warnings" items={pattern.warnings} tone="amber" />
                  <ListBlock title="missingFields" items={pattern.missingFields} tone="rose" />
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <ListBlock title="timingNotes" items={pattern.timing.timingNotes} />
                  <ListBlock title="comboReadiness notes" items={pattern.timing.optionComboReadiness.notes} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">上昇転換コンボ候補はありません。</p>
        )}
      </Section>

      <Section title="シンセティックフォワード候補">
        {candidate.syntheticForwardCandidates?.length ? (
          <div className="grid gap-3">
            {candidate.syntheticForwardCandidates.map((item, index) => (
              <div key={`${item.kind}-${index}`} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-950">{screeningStrategyLabel(item.kind)}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${fitClass(item.fitLevel)}`}>{fitLabel(item.fitLevel)}</span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="expiry" value={item.expiry} />
                  <Metric label="dte" value={item.dte} />
                  <Metric label="strike" value={item.strike} />
                  <Metric label="netPremium" value={item.netPremium} />
                  <Metric label="breakEvenPrice" value={item.breakEvenPrice} />
                  <Metric label="assignmentCapitalRequired" value={item.assignmentCapitalRequired} />
                  <Metric label="assignmentCapitalAvailable" value={item.assignmentCapitalAvailable} />
                  <Metric label="syntheticDelta" value={item.syntheticDelta} />
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <div className="font-bold text-slate-800">コール買い脚</div>
                    <div className="mt-1 text-slate-700">
                      満期 {formatValue(item.longCallLeg?.expiry)} / 権利行使価格 {formatValue(item.longCallLeg?.strikePrice)} / Mid {formatValue(item.longCallLeg?.mid)}
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <div className="font-bold text-slate-800">P売り脚</div>
                    <div className="mt-1 text-slate-700">
                      満期 {formatValue(item.shortPutLeg?.expiry)} / 権利行使価格 {formatValue(item.shortPutLeg?.strikePrice)} / Mid {formatValue(item.shortPutLeg?.mid)}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <ListBlock title="reasons" items={item.reasons} tone="teal" />
                  <ListBlock title="warnings" items={item.warnings} tone="amber" />
                  <ListBlock title="missingFields" items={item.missingFields} tone="rose" />
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <ListBlock title="riskFlags" items={item.riskFlags} tone="rose" />
                  <ListBlock title="capitalEfficiencyNotes" items={item.capitalEfficiencyNotes} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">シンセティックフォワード候補はありません。</p>
        )}
      </Section>

      <Section title="手動確認ハンドオフ">
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="schema" value={handoff.schemaVersion} />
            <Metric label="source" value={handoff.source} />
            <Metric label="strategy" value={handoff.selectedStrategy ? strategyLabel(handoff.selectedStrategy) : "-"} />
            <Metric
              label="draftStatus"
              value={handoff.reviewSummary.draftStatus ? positionDraftStatusLabel(handoff.reviewSummary.draftStatus as PositionDraftStatus) : "-"}
            />
            <Metric label="reviewStatus" value={reviewStatusLabel(handoff.reviewSummary.reviewStatus)} />
            <Metric label="noOrderInstruction" value={handoff.noOrderInstructionIncluded} />
            <Metric label="noCredential" value={handoff.noPersonalCredentialIncluded} />
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <ListBlock title="blockers" items={handoff.reviewSummary.blockers} tone="rose" />
            <ListBlock title="warnings" items={handoff.reviewSummary.warnings} tone="amber" />
            <ListBlock title="missingFields" items={handoff.reviewSummary.missingFields} tone="amber" />
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-3">
            <div className="text-xs font-bold text-slate-700">Saxo TraderGO等で確認するためのメモ</div>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-50">{manualReviewMemo}</pre>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 font-bold text-slate-800" onClick={() => copyText(manualReviewMemo)}>
              手動確認メモをコピー
            </button>
            <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 font-bold text-slate-800" onClick={() => downloadText(`screening-review-handoff-${candidate.symbol}.json`, handoffJson)}>
              レビューJSONを書き出す
            </button>
            <button
              type="button"
              className="rounded-md border border-teal-300 bg-teal-50 px-3 py-2 font-bold text-teal-900 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!onJournalChange}
              onClick={reflectHandoffToJournal}
            >
              根拠メモへ反映
            </button>
          </div>
          <p className="text-xs leading-5 text-slate-600">この出力は証券会社画面での手動確認用です。建玉入力や価格欄は自動更新しません。</p>
        </div>
      </Section>

      {onJournalChange ? (
        <EntryRationaleJournalPanel
          title="候補のエントリー根拠メモ"
          subtitle="候補理由と、実際にエントリーすると判断した理由を分けて保存します。"
          journal={candidate.entryRationaleJournal ?? getDefaultJournal?.() ?? {
            id: `journal-${candidate.id}`,
            candidateId: candidate.id,
            symbol: candidate.symbol,
            underlyingName: candidate.company,
            strategy: "custom",
            status: "candidate",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            entryReason: "",
            technicalTags: [],
            chartEvidence: [],
            review: { outcome: "not_reviewed" },
          }}
          onChange={onJournalChange}
          candidateReason={
            <div className="grid gap-1">
              <div>候補スコア: {candidate.score}</div>
              <div>候補用途: {candidate.suggestedUse || "-"}</div>
              <div>
                {candidate.strategyFitResults?.slice(0, 3).map((result) => `${strategyLabel(result.strategy)} ${fitLabel(result.fitLevel)}`).join(" / ") || "戦略判定なし"}
              </div>
            </div>
          }
        />
      ) : null}
    </div>
  );
}
