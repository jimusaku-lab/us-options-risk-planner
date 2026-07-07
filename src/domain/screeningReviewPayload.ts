import type { CandidateSymbol } from "@/types/candidates";
import type { EntryRationaleJournal, StrategyType } from "@/types/domain";
import type {
  ExternalReviewPayload,
  PositionDraft,
  ScreeningCandidate,
  StrategyCandidateKind,
  StrategyFitResult,
  SyntheticForwardEvaluation,
  TechnicalTimingPattern,
} from "@/types/screening";

const sensitiveKeyPattern = /(token|secret|password|credential|accountNumber|accountId|account[_-]?id|acc[_-]?id|localPath|path|apiKey|api[_-]?key|refresh)/i;
const localPathPattern = /(?:\/Users\/|\/home\/|[A-Za-z]:\\)/;

function sanitizeForExternalReview(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, currentValue) => {
      if (sensitiveKeyPattern.test(key)) return undefined;
      if (typeof currentValue === "string" && localPathPattern.test(currentValue)) return "[removed-local-path]";
      return currentValue;
    }),
  ) as unknown;
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

function formatMaybeUsd(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function strategyLabel(strategy?: string): string {
  const labels: Record<string, string> = {
    long_call: "コール買い",
    cash_secured_put_buy_to_own: "買いたいP売り",
    cash_secured_put_avoid_assignment: "買わないプット売り",
    covered_call: "カバードコール",
    wheel: "Wheel",
    short_strangle: "ショートストラングル",
    short_strangle_covered: "カバー付きストラングル",
    short_strangle_advanced_review: "上級ストラングル",
    synthetic_forward: "シンセティック",
    combo: "コンボ",
    itm_short_put_buy_to_own: "ITM P売り",
    long_straddle_event: "イベントストラドル",
    protective_collar: "カラー",
  };
  return strategy ? labels[strategy] ?? strategy : "-";
}

function toJournalStrategy(strategy?: string): StrategyType | undefined {
  if (strategy === "covered_call" || strategy === "long_call" || strategy === "wheel" || strategy === "short_strangle") return strategy;
  if (strategy === "cash_secured_put_buy_to_own" || strategy === "cash_secured_put_avoid_assignment" || strategy === "itm_short_put_buy_to_own") return "short_put";
  if (strategy === "synthetic_forward" || strategy === "combo") return "custom";
  return undefined;
}

function inferHandoffSource(candidate: CandidateSymbol, explicit?: ScreeningReviewHandoff["source"]): ScreeningReviewHandoff["source"] {
  if (explicit) return explicit;
  if (candidate.source === "manual" || candidate.source === "manual_import") return "manual";
  if (candidate.source === "moomoo_file_import" || candidate.source === "legacy_tradingview" || candidate.source === "tradingview" || candidate.source === "imported_csv") return "imported";
  return "public";
}

function selectPositionDraft(candidate: CandidateSymbol, selectedDraftId?: string, selectedStrategy?: string): PositionDraft | undefined {
  const drafts = candidate.positionDrafts ?? candidate.publicScreeningInput?.positionDrafts ?? [];
  return drafts.find((draft) => draft.id === selectedDraftId)
    ?? drafts.find((draft) => draft.strategy === selectedStrategy)
    ?? drafts[0];
}

function collectDraftBlockers(draft?: PositionDraft): string[] {
  if (!draft) return ["建玉案レビューが未生成です。"];
  return unique([
    draft.status === "not_ready" ? "建玉案レビューの前提データが不足しています。" : undefined,
    draft.reviewState?.reviewStatus === "blocked" ? "手動確認へ進む前のブロックがあります。" : undefined,
    draft.reviewState?.reviewStatus === "needs_data" ? "手動確認へ進む前に不足データがあります。" : undefined,
    draft.status === "draft_ready" && draft.reviewState?.reviewStatus !== "ready_for_manual_transfer"
      ? "建玉案レビュー可でも必須チェックが未完了です。"
      : undefined,
    ...draft.missingFields,
    ...draft.legs.flatMap((leg) => leg.missingFields),
    ...draft.legs.flatMap((leg) => leg.liquidityWarnings.filter((warning) => /Lastのみ|Bid\/Ask|流動性|Volume|Open Interest|権限不足/.test(warning))),
  ]);
}

function checklistLabel(draft: PositionDraft | undefined, itemId: string, fallback: string): string {
  const item = draft?.reviewState?.checklist.find((entry) => entry.id === itemId);
  if (!item) return `未確認: ${fallback}`;
  return `${item.checked ? "確認済み" : "未確認"}: ${item.label}`;
}

function buildManualChecklists(draft?: PositionDraft): ScreeningReviewHandoff["manualChecklists"] {
  const firstLeg = draft?.legs[0];
  return {
    chart: [
      checklistLabel(draft, "chart_confirmed", "チャート根拠を確認した"),
      "月足・週足・日足の方向感が戦略と矛盾しないか確認する",
    ],
    strategy: [
      checklistLabel(draft, "strategy_confirmed", "戦略が自分の意図と合っている"),
      `${strategyLabel(draft?.strategy)}は候補分類であり、売買判断そのものではありません。`,
    ],
    expiryStrike: [
      checklistLabel(draft, "expiry_strike_confirmed", "満期・権利行使価格を確認した"),
      `満期: ${firstLeg?.expiry ?? "-"} / DTE: ${firstLeg?.dte ?? "-"}`,
      `権利行使価格: ${firstLeg?.strikePrice ?? "-"}`,
    ],
    bidAskLiquidity: [
      checklistLabel(draft, "bid_ask_confirmed", "Bid/AskとMid/Lastの違いを確認した"),
      checklistLabel(draft, "liquidity_confirmed", "OI/Volume/spreadを確認した"),
      `保守価格: ${firstLeg?.conservativePrice ?? "-"} (${firstLeg?.conservativePriceField ?? "未確認"})`,
      `Mid/Last: ${firstLeg?.mid ?? "-"} / ${firstLeg?.last ?? "-"}`,
      "買い建てはAsk、売り建てはBidを保守価格にします。MidとLastは参考情報です。",
    ],
    capitalRisk: [
      checklistLabel(draft, "capital_confirmed", "必要資金または保有株を確認した"),
      checklistLabel(draft, "max_loss_confirmed", "最大損失または割当資金を確認した"),
      `必要資金: ${formatMaybeUsd(draft?.requiredCapitalUSD)} / 最大損失: ${formatMaybeUsd(draft?.maxLossUSD)}`,
      `利用可能資金: ${formatMaybeUsd(draft?.availableCashUSD)}`,
    ],
    assignmentExit: [
      checklistLabel(draft, "assignment_confirmed", "割当・株式移動リスクを確認した"),
      checklistLabel(draft, "exit_rule_confirmed", "利確・損切り・最終決済期限を確認した"),
      `出口ルール: ${draft?.exitPlan?.expiryHandling ?? "-"}`,
      `最終確認日: ${draft?.exitPlan?.latestCloseDate ?? "-"}`,
    ],
    saxoTicketFinalCheck: [
      checklistLabel(draft, "saxo_ticket_confirmed", "Saxo TraderGO等の証券会社チケットで最終価格を確認する"),
      "このメモは注文票ではありません。",
      "証券会社画面でBid/Ask、数量、満期、権利行使価格、口座、手数料を最終確認します。",
    ],
  };
}

function appendBlock(current: string | undefined, block: string): string {
  const trimmed = current?.trim() ?? "";
  if (!trimmed) return block;
  if (trimmed.includes(block)) return trimmed;
  return `${trimmed}\n\n${block}`;
}

function buildHandoffCandidateSummary(candidate: CandidateSymbol, draft?: PositionDraft) {
  const chart = candidate.publicScreeningInput?.chartAnalysis;
  return sanitizeForExternalReview({
    id: candidate.id,
    symbol: candidate.symbol,
    company: candidate.company,
    source: candidate.source,
    importedAt: candidate.importedAt,
    priceUSD: candidate.priceUSD,
    score: candidate.score,
    suggestedUse: candidate.suggestedUse,
    completeness: candidate.screeningCompleteness,
    chart: chart ? {
      regime: chart.regime,
      confidence: chart.confidence,
      reasons: chart.reasons,
      warnings: chart.warnings,
      missingFields: chart.missingFields,
    } : undefined,
    strategySuitability: candidate.strategySuitability?.map((item) => ({
      strategy: item.strategy,
      level: item.level,
      reasons: item.reasons,
      warnings: item.warnings,
      missingFields: item.missingFields,
      nextChecks: item.nextChecks,
    })),
    selectedDraft: draft ? {
      id: draft.id,
      strategy: draft.strategy,
      status: draft.status,
      reviewStatus: draft.reviewState?.reviewStatus,
      legs: draft.legs.map((leg) => ({
        optionType: leg.optionType,
        side: leg.side,
        expiry: leg.expiry,
        dte: leg.dte,
        strikePrice: leg.strikePrice,
        conservativePrice: leg.conservativePrice,
        conservativePriceField: leg.conservativePriceField,
        mid: leg.mid,
        last: leg.last,
        quantity: leg.quantity,
        liquidityWarnings: leg.liquidityWarnings,
        missingFields: leg.missingFields,
      })),
      requiredCapitalUSD: draft.requiredCapitalUSD,
      maxLossUSD: draft.maxLossUSD,
      availableCashUSD: draft.availableCashUSD,
      warnings: draft.warnings,
      missingFields: draft.missingFields,
      exitPlan: draft.exitPlan,
    } : undefined,
  });
}

export type ScreeningReviewHandoff = {
  schemaVersion: "us_options_screening_review_handoff.v1";
  generatedAt: string;
  appVersion?: string;
  noOrderInstructionIncluded: true;
  noPersonalCredentialIncluded: true;
  source: "local" | "public" | "manual" | "imported";
  candidate: unknown;
  selectedStrategy?: string;
  selectedDraftId?: string;
  reviewSummary: {
    completenessLevel?: string;
    strategyStatus?: string;
    draftStatus?: string;
    reviewStatus?: string;
    blockers: string[];
    warnings: string[];
    missingFields: string[];
  };
  manualChecklists: {
    chart: string[];
    strategy: string[];
    expiryStrike: string[];
    bidAskLiquidity: string[];
    capitalRisk: string[];
    assignmentExit: string[];
    saxoTicketFinalCheck: string[];
  };
  journalDraft: {
    technicalMemo: string;
    expectedScenario?: string;
    profitTakingPlan?: string;
    stopLossPlan?: string;
  };
  dataQualityNotes: string[];
};

export function createScreeningReviewHandoff(params: {
  candidate: CandidateSymbol;
  generatedAt: string;
  appVersion?: string;
  source?: ScreeningReviewHandoff["source"];
  selectedStrategy?: StrategyCandidateKind | string;
  selectedDraftId?: string;
  dataQualityNotes?: string[];
}): ScreeningReviewHandoff {
  const draft = selectPositionDraft(params.candidate, params.selectedDraftId, params.selectedStrategy);
  const selectedStrategy = params.selectedStrategy ?? draft?.strategy ?? params.candidate.strategySuitability?.[0]?.strategy ?? params.candidate.strategyFitResults?.[0]?.strategy;
  const strategy = selectedStrategy ? params.candidate.strategySuitability?.find((item) => item.strategy === selectedStrategy) : undefined;
  const chart = params.candidate.publicScreeningInput?.chartAnalysis;
  const blockers = collectDraftBlockers(draft);
  const warnings = unique([
    params.candidate.earningsWarning,
    ...(params.candidate.parseWarnings ?? []),
    ...(params.candidate.screeningCompleteness?.warnings ?? []),
    ...(params.candidate.screeningCandidate?.riskFlags ?? []),
    ...(params.candidate.screeningCandidate?.optionChainQuality.qualityWarnings ?? []),
    ...(strategy?.warnings ?? []),
    ...(draft?.warnings ?? []),
    ...(draft?.reviewState?.transferWarnings ?? []),
  ]);
  const missingFields = unique([
    ...(params.candidate.screeningCompleteness?.missingFields ?? []),
    ...(params.candidate.screeningCandidate?.missingFields ?? []),
    ...(strategy?.missingFields ?? []),
    ...(draft?.missingFields ?? []),
  ]);
  const technicalMemo = [
    `レビュー要約: ${params.candidate.symbol} / ${strategyLabel(String(selectedStrategy ?? ""))}`,
    `チャート: ${chart?.regime ?? "-"} / confidence ${chart?.confidence ?? "-"}`,
    chart?.reasons.length ? `チャート根拠: ${chart.reasons.join(" / ")}` : "",
    `戦略状態: ${strategy?.level ?? "-"}`,
    `建玉案: ${draft?.status ?? "-"} / 手動確認: ${draft?.reviewState?.reviewStatus ?? "-"}`,
    draft?.legs[0]
      ? `レッグ: ${draft.legs[0].side} ${draft.legs[0].optionType} ${draft.legs[0].expiry ?? "-"} strike ${draft.legs[0].strikePrice ?? "-"} 保守価格 ${draft.legs[0].conservativePrice ?? "-"} (${draft.legs[0].conservativePriceField ?? "未確認"})`
      : "",
    `資金: 必要 ${formatMaybeUsd(draft?.requiredCapitalUSD)} / 最大損失 ${formatMaybeUsd(draft?.maxLossUSD)} / 利用可能 ${formatMaybeUsd(draft?.availableCashUSD)}`,
    draft?.exitPlan?.expiryHandling ? `出口: ${draft.exitPlan.expiryHandling}` : "",
    blockers.length ? `ブロック: ${blockers.join(" / ")}` : "",
    warnings.length ? `警告: ${warnings.join(" / ")}` : "",
    "Saxo TraderGO等の証券会社チケットで最終価格を確認する。",
  ].filter(Boolean).join("\n");
  return {
    schemaVersion: "us_options_screening_review_handoff.v1",
    generatedAt: params.generatedAt,
    appVersion: params.appVersion,
    noOrderInstructionIncluded: true,
    noPersonalCredentialIncluded: true,
    source: inferHandoffSource(params.candidate, params.source),
    candidate: buildHandoffCandidateSummary(params.candidate, draft),
    selectedStrategy: selectedStrategy ? String(selectedStrategy) : undefined,
    selectedDraftId: draft?.id ?? params.selectedDraftId,
    reviewSummary: {
      completenessLevel: params.candidate.screeningCompleteness?.level,
      strategyStatus: strategy?.level ?? params.candidate.strategyFitResults?.find((item) => item.strategy === selectedStrategy)?.fitLevel,
      draftStatus: draft?.status,
      reviewStatus: draft?.reviewState?.reviewStatus,
      blockers,
      warnings,
      missingFields,
    },
    manualChecklists: buildManualChecklists(draft),
    journalDraft: {
      technicalMemo,
      expectedScenario: params.candidate.entryRationaleJournal?.expectedScenario || params.candidate.suggestedUse,
      profitTakingPlan: draft?.exitPlan?.profitTakePrice !== undefined ? `参考利確価格: ${draft.exitPlan.profitTakePrice}` : draft?.exitPlan?.notes?.[0],
      stopLossPlan: draft?.exitPlan?.stopLossPrice !== undefined ? `参考損切り価格: ${draft.exitPlan.stopLossPrice}` : undefined,
    },
    dataQualityNotes: unique([
      "持ち込み価格は参考情報です。Saxo TraderGO等の証券会社画面で最終確認します。",
      "draft_readyは入力候補として確認できる状態であり、取引操作の可否ではありません。",
      ...(params.dataQualityNotes ?? []),
    ]),
  };
}

export function formatScreeningReviewHandoffMemo(handoff: ScreeningReviewHandoff): string {
  const candidate = handoff.candidate as { symbol?: string; company?: string; priceUSD?: number; selectedDraft?: { legs?: Array<{ side?: string; optionType?: string; expiry?: string; strikePrice?: number; conservativePrice?: number; conservativePriceField?: string; mid?: number; last?: number }> } };
  const leg = candidate.selectedDraft?.legs?.[0];
  return [
    `スクリーニング手動確認メモ ${handoff.generatedAt}`,
    `銘柄: ${candidate.symbol ?? "-"} ${candidate.company ?? ""}`.trim(),
    `戦略候補: ${strategyLabel(handoff.selectedStrategy)}`,
    `株価参考: ${formatMaybeUsd(candidate.priceUSD)}`,
    `方向/レッグ: ${leg ? `${leg.side ?? "-"} ${leg.optionType ?? "-"}` : "-"}`,
    `満期: ${leg?.expiry ?? "-"}`,
    `権利行使価格: ${leg?.strikePrice ?? "-"}`,
    `保守価格の根拠: ${leg?.conservativePrice ?? "-"} (${leg?.conservativePriceField ?? "未確認"})`,
    `Mid/Last参考: ${leg?.mid ?? "-"} / ${leg?.last ?? "-"}`,
    `必要資金: ${handoff.manualChecklists.capitalRisk.find((item) => item.startsWith("必要資金:")) ?? "-"}`,
    `最大損失: ${handoff.reviewSummary.draftStatus ?? "-"} / ${handoff.reviewSummary.reviewStatus ?? "-"}`,
    `割当/株式売却リスク: ${handoff.manualChecklists.assignmentExit.join(" / ")}`,
    `出口ルール: ${handoff.manualChecklists.assignmentExit.find((item) => item.startsWith("出口ルール:")) ?? "-"}`,
    `未確認項目: ${handoff.reviewSummary.blockers.length ? handoff.reviewSummary.blockers.join(" / ") : "なし"}`,
    `警告: ${handoff.reviewSummary.warnings.length ? handoff.reviewSummary.warnings.join(" / ") : "なし"}`,
    "Saxo TraderGO等の証券会社チケットで最終確認",
    "これは注文票ではありません。",
  ].join("\n");
}

export function mergeReviewHandoffIntoJournal(
  journal: EntryRationaleJournal,
  handoff: ScreeningReviewHandoff,
  updatedAt = new Date().toISOString(),
): EntryRationaleJournal {
  const selectedStrategy = toJournalStrategy(handoff.selectedStrategy);
  return {
    ...journal,
    strategy: selectedStrategy ?? journal.strategy,
    updatedAt,
    entryReason: journal.entryReason,
    technicalTags: unique([
      ...journal.technicalTags,
      "候補レビュー確認",
      handoff.reviewSummary.reviewStatus === "ready_for_manual_transfer" ? "手動確認メモ作成済み" : "手動確認あり",
      handoff.selectedStrategy ? strategyLabel(handoff.selectedStrategy) : undefined,
    ]),
    technicalMemo: appendBlock(journal.technicalMemo, handoff.journalDraft.technicalMemo),
    expectedScenario: journal.expectedScenario || handoff.journalDraft.expectedScenario,
    profitTakingPlan: journal.profitTakingPlan || handoff.journalDraft.profitTakingPlan,
    stopLossPlan: journal.stopLossPlan || handoff.journalDraft.stopLossPlan,
  };
}

export function createExternalReviewPayload(params: {
  generatedAt: string;
  appVersion: string;
  candidate: ScreeningCandidate;
  strategyFitResults: StrategyFitResult[];
  technicalTimingPatterns?: TechnicalTimingPattern[];
  syntheticForwardCandidates?: SyntheticForwardEvaluation[];
  userStrategyAssumptions?: string[];
  dataQualityNotes?: string[];
}): ExternalReviewPayload {
  return {
    generatedAt: params.generatedAt,
    appVersion: params.appVersion,
    candidate: sanitizeForExternalReview(params.candidate) as ScreeningCandidate,
    strategyFitResults: sanitizeForExternalReview(params.strategyFitResults) as StrategyFitResult[],
    technicalTimingPatterns: params.technicalTimingPatterns
      ? (sanitizeForExternalReview(params.technicalTimingPatterns) as TechnicalTimingPattern[])
      : undefined,
    syntheticForwardCandidates: params.syntheticForwardCandidates
      ? (sanitizeForExternalReview(params.syntheticForwardCandidates) as SyntheticForwardEvaluation[])
      : undefined,
    userStrategyAssumptions: params.userStrategyAssumptions ?? [],
    dataQualityNotes: params.dataQualityNotes ?? [],
    noPersonalCredentialIncluded: true,
  };
}
