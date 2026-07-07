import type { CandidateSymbol } from "@/types/candidates";
import type {
  ChartAnalysisSnapshot,
  ChartConfidence,
  ChartRegime,
  ChartTimeframeSnapshot,
  PositionDraft,
  PublicStrategyFitLevel,
  StrategyCandidateKind,
  StrategySuitability,
} from "@/types/screening";
import type { ScreeningPriorityReview } from "@/domain/screeningPriority";
import { screeningDisplayLabel, screeningDisplayItems, screeningStrategyLabel } from "@/domain/screeningDisplayLabels";

export type ScreeningDecisionStatus =
  | "draft_ready"
  | "chart_ready"
  | "option_data_needed"
  | "capital_needed"
  | "margin_confirmation_needed"
  | "manual_review"
  | "avoid_now"
  | "insufficient_data";

export type StrategyDisplayGroup = "primary" | "secondary" | "manual_review" | "excluded" | "insufficient_data" | "workflow";

export type StrategyDisplayItem = {
  strategy: StrategyCandidateKind;
  label: string;
  group: StrategyDisplayGroup;
  level?: PublicStrategyFitLevel;
  reasons: string[];
};

export type ChartSignalSummary = {
  headline: string;
  monthlyDirection: string;
  weeklyDirection: string;
  dailyRegime: string;
  macd: string;
  slowKd: string;
  movingAveragePosition: string;
  maCross: string;
  supportResistance: string;
  keySignals: string[];
};

export type ScreeningDecisionSummary = {
  status: ScreeningDecisionStatus;
  label: string;
  primaryStrategy?: StrategyCandidateKind;
  primaryStrategyLabel: string;
  primaryBasicTrade: string;
  selectedReasons: string[];
  chartReasons: string[];
  droppedStrategies: Array<{ strategy: StrategyCandidateKind; label: string; reason: string }>;
  unconfirmedGates: string[];
  blockers: string[];
  missingData: string[];
  nextAction: string;
  chart: ChartSignalSummary;
  strategyGroups: StrategyDisplayItem[];
};

const baseStrategyOrder: StrategyCandidateKind[] = [
  "long_call",
  "cash_secured_put_buy_to_own",
  "cash_secured_put_avoid_assignment",
  "covered_call",
];

const basicTradeByStrategy: Partial<Record<StrategyCandidateKind, string>> = {
  long_call: "C買い",
  cash_secured_put_buy_to_own: "P売り",
  cash_secured_put_avoid_assignment: "P売り",
  covered_call: "C売り",
};

const statusLabels: Record<ScreeningDecisionStatus, string> = {
  draft_ready: "建玉案レビュー可",
  chart_ready: "チャート確認止まり",
  option_data_needed: "オプションデータ待ち",
  capital_needed: "資金条件待ち",
  margin_confirmation_needed: "証拠金確認待ち",
  manual_review: "手動確認",
  avoid_now: "今は見送り",
  insufficient_data: "データ不足",
};

export function buildScreeningDecisionSummary(
  candidate: CandidateSymbol,
  priorityReviews: ScreeningPriorityReview[] = [],
): ScreeningDecisionSummary {
  const publicInput = candidate.publicScreeningInput;
  const chart = extractChartSignalSummary(publicInput?.chartAnalysis);
  const suitabilities = candidate.strategySuitability ?? publicInput?.strategySuitability ?? [];
  const drafts = candidate.positionDrafts ?? publicInput?.positionDrafts ?? [];
  const candidates = baseStrategyOrder
    .map((strategy) => buildPrimaryCandidate(strategy, suitabilities, drafts))
    .filter((item): item is ReturnType<typeof buildPrimaryCandidate> & { suitability?: StrategySuitability } => Boolean(item));
  const primary = selectPrimary(candidates);
  const missingData = collectMissingData(candidate, priorityReviews, primary?.suitability);
  const unconfirmedGates = collectUnconfirmedGates(candidate, primary?.strategy, primary?.suitability, primary?.draft);
  const blockers = collectBlockers(candidate, priorityReviews, primary?.suitability);
  const status = resolveStatus(candidate, primary, missingData, unconfirmedGates, blockers);
  const strategyGroups = classifyStrategyDisplayGroups(candidate, priorityReviews, primary?.strategy);
  const droppedStrategies = buildDroppedStrategies(strategyGroups, primary?.strategy);
  return {
    status,
    label: statusLabels[status],
    primaryStrategy: primary?.strategy,
    primaryStrategyLabel: primary ? screeningStrategyLabel(primary.strategy) : "第一候補なし",
    primaryBasicTrade: primary ? basicTradeByStrategy[primary.strategy] ?? "基本取引未分類" : "-",
    selectedReasons: primary ? selectedReasonsFor(primary) : ["第一候補として強調できるだけの確認材料がまだ揃っていません。"],
    chartReasons: chart.keySignals,
    droppedStrategies,
    unconfirmedGates,
    blockers,
    missingData,
    nextAction: resolveNextAction(status, missingData, unconfirmedGates, blockers),
    chart,
    strategyGroups,
  };
}

export function extractChartSignalSummary(chart?: ChartAnalysisSnapshot): ChartSignalSummary {
  if (!chart) {
    return {
      headline: "チャート分析なし",
      monthlyDirection: "未確認",
      weeklyDirection: "未確認",
      dailyRegime: "未確認",
      macd: "未確認",
      slowKd: "未確認",
      movingAveragePosition: "未確認",
      maCross: "未確認",
      supportResistance: "未確認",
      keySignals: ["チャート分析がありません。"],
    };
  }
  const monthly = timeframe(chart, "monthly");
  const weekly = timeframe(chart, "weekly");
  const daily = timeframe(chart, "daily") ?? chart.timeframes[0];
  const dailyRegime = `${screeningDisplayLabel("chartRegime", chart.regime)} / 信頼度 ${screeningDisplayLabel("chartConfidence", chart.confidence)}`;
  const movingAveragePosition = daily ? maPosition(daily) : "未確認";
  const maCross = daily ? maCrossSummary(daily) : "未確認";
  const supportResistance = daily ? supportResistanceSummary(daily) : "未確認";
  const keySignals = unique([
    `日足: ${dailyRegime}`,
    daily ? `MACD: ${signalLabel(daily.macdSignal)}` : undefined,
    daily ? `SlowKD: ${signalLabel(daily.slowKdSignal)}` : undefined,
    movingAveragePosition,
    maCross,
    supportResistance,
    ...chart.reasons.slice(0, 3),
  ]);
  return {
    headline: dailyRegime,
    monthlyDirection: directionLabel(monthly),
    weeklyDirection: directionLabel(weekly),
    dailyRegime,
    macd: daily ? signalLabel(daily.macdSignal) : "未確認",
    slowKd: daily ? signalLabel(daily.slowKdSignal) : "未確認",
    movingAveragePosition,
    maCross,
    supportResistance,
    keySignals,
  };
}

export function classifyStrategyDisplayGroups(
  candidate: CandidateSymbol,
  priorityReviews: ScreeningPriorityReview[] = [],
  primaryStrategy?: StrategyCandidateKind,
): StrategyDisplayItem[] {
  const suitabilities = candidate.strategySuitability ?? candidate.publicScreeningInput?.strategySuitability ?? [];
  const byStrategy = new Map(suitabilities.map((item) => [item.strategy, item]));
  const items = baseStrategyOrder.map((strategy): StrategyDisplayItem => {
    const suitability = byStrategy.get(strategy);
    return {
      strategy,
      label: screeningStrategyLabel(strategy),
      group: groupForStrategy(strategy, suitability, primaryStrategy),
      level: suitability?.level,
      reasons: reasonSummary(suitability, priorityReviews.find((review) => review.primaryStrategy === strategy || review.targetStrategy === strategy)),
    };
  });
  if (suitabilities.some((item) => item.strategy === "wheel")) {
    items.push({
      strategy: "wheel",
      label: "ホイール運用サイクル",
      group: "workflow",
      level: "manual_review_required",
      reasons: ["ホイールは単独候補ではなく、P売りからカバードコールへつなぐ運用サイクルとして扱います。"],
    });
  }
  return items;
}

function buildPrimaryCandidate(strategy: StrategyCandidateKind, suitabilities: StrategySuitability[], drafts: PositionDraft[]) {
  const suitability = suitabilities.find((item) => item.strategy === strategy);
  const draft = drafts.find((item) => item.strategy === strategy);
  if (!suitability && !draft) return undefined;
  const gateIssues = gateIssuesFor(strategy, suitability, draft);
  const rank = primaryRank(suitability?.level, draft?.status, gateIssues.length);
  return { strategy, suitability, draft, gateIssues, rank };
}

function selectPrimary<T extends { rank: number; strategy: StrategyCandidateKind }>(items: T[]): T | undefined {
  return [...items].filter((item) => item.rank > 0).sort((a, b) => b.rank - a.rank || baseStrategyOrder.indexOf(a.strategy) - baseStrategyOrder.indexOf(b.strategy))[0];
}

function primaryRank(level?: PublicStrategyFitLevel, draftStatus?: PositionDraft["status"], gateIssueCount = 0): number {
  if (gateIssueCount > 0) return 0;
  if (draftStatus === "draft_ready") return 50;
  if (level === "fit") return 40;
  if (level === "watch") return 20;
  return 0;
}

function selectedReasonsFor(primary: { strategy: StrategyCandidateKind; suitability?: StrategySuitability; draft?: PositionDraft }): string[] {
  return unique([
    `${basicTradeByStrategy[primary.strategy] ?? "基本取引"}として確認します。`,
    ...screeningDisplayItems("reasons", primary.suitability?.reasons ?? []).slice(0, 3),
    primary.draft?.status === "draft_ready" ? "建玉案レビューに必要な価格・資金情報があります。" : undefined,
  ]).slice(0, 5);
}

function collectMissingData(candidate: CandidateSymbol, priorityReviews: ScreeningPriorityReview[], primary?: StrategySuitability): string[] {
  return unique([
    ...(candidate.screeningCompleteness?.missingFields ?? []),
    ...(candidate.screeningCandidate?.missingFields ?? []),
    ...(primary?.missingFields ?? []),
    ...priorityReviews.flatMap((review) => review.nextDataNeeded),
  ]).slice(0, 8);
}

function collectUnconfirmedGates(candidate: CandidateSymbol, strategy?: StrategyCandidateKind, suitability?: StrategySuitability, draft?: PositionDraft): string[] {
  if (!strategy) {
    const suitabilities = candidate.strategySuitability ?? candidate.publicScreeningInput?.strategySuitability ?? [];
    const drafts = candidate.positionDrafts ?? candidate.publicScreeningInput?.positionDrafts ?? [];
    return screeningDisplayItems(
      "missingFields",
      unique(baseStrategyOrder.flatMap((item) => gateIssuesFor(item, suitabilities.find((result) => result.strategy === item), drafts.find((result) => result.strategy === item)))),
    ).slice(0, 8);
  }
  const gates = unique([
    ...gateIssuesFor(strategy, suitability, draft),
    ...(draft?.missingFields ?? []),
  ]);
  return screeningDisplayItems("missingFields", gates).slice(0, 8);
}

function collectBlockers(candidate: CandidateSymbol, priorityReviews: ScreeningPriorityReview[], primary?: StrategySuitability): string[] {
  return unique([
    ...(primary?.warnings ?? []),
    ...(candidate.screeningCompleteness?.warnings ?? []),
    ...(candidate.screeningCandidate?.riskFlags ?? []),
    ...priorityReviews.flatMap((review) => review.blockers),
  ]).slice(0, 8);
}

function gateIssuesFor(strategy?: StrategyCandidateKind, suitability?: StrategySuitability, draft?: PositionDraft): string[] {
  if (!strategy) return [];
  const fields = unique([...(suitability?.missingFields ?? []), ...(draft?.missingFields ?? [])]);
  const warnings = [...(suitability?.warnings ?? []), ...(draft?.warnings ?? [])].join(" ");
  if (strategy === "cash_secured_put_buy_to_own") {
    return unique([
      fields.find((field) => field.includes("assignmentCapitalAvailable")),
      /現物株購入代金確認待ち|必要資金が不足|割当を受け入れる前提が未確認/.test(warnings) ? "capital.assignmentCapitalAvailableUSD" : undefined,
    ]);
  }
  if (strategy === "covered_call") {
    return unique([
      fields.find((field) => field.includes("stockShares")),
      /現物株確認待ち|100株未満|株を渡してよい前提が未確認/.test(warnings) ? "capital.stockShares" : undefined,
    ]);
  }
  if (strategy === "cash_secured_put_avoid_assignment") {
    return unique([
      fields.find((field) => field.includes("saxoRequiredMargin")),
      fields.find((field) => field.includes("saxoMarginAvailable")),
      fields.find((field) => field.includes("cashBalance")),
      /証拠金確認待ち|2倍未満|証拠金余力/.test(warnings) ? "capital.saxoRequiredMarginUSD" : undefined,
    ]);
  }
  return [];
}

function resolveStatus(
  candidate: CandidateSymbol,
  primary: ReturnType<typeof buildPrimaryCandidate>,
  missingData: string[],
  unconfirmedGates: string[],
  blockers: string[],
): ScreeningDecisionStatus {
  const chart = candidate.publicScreeningInput?.chartAnalysis;
  if (!chart || chart.regime === "insufficient_data" || chart.confidence === "insufficient") return "insufficient_data";
  if (chart.regime === "downtrend" || chart.regime === "bearish_breakdown") return "avoid_now";
  if (unconfirmedGates.some((item) => /Saxo|証拠金|saxo/i.test(item))) return "margin_confirmation_needed";
  if (unconfirmedGates.length > 0 || missingData.some((item) => /capital|資金|stockShares|assignment/i.test(item))) return "capital_needed";
  if (missingData.some((item) => /option|Bid|Ask|IV|Greeks|open interest|volume/i.test(item))) return "option_data_needed";
  if (primary?.draft?.status === "draft_ready") return "draft_ready";
  if (primary) return "manual_review";
  if (blockers.length > 0) return "avoid_now";
  return "chart_ready";
}

function resolveNextAction(status: ScreeningDecisionStatus, missingData: string[], gates: string[], blockers: string[]): string {
  if (status === "draft_ready") return "建玉案レビュー前チェックを確認し、証券会社画面で価格を手動確認してください。";
  if (status === "margin_confirmation_needed") return "Saxoの必要証拠金、証拠金余力、現金残高2倍バッファを確認してください。";
  if (status === "capital_needed") return gates[0] ? `${gates[0]}を確認してください。` : "資金条件と保有株を確認してください。";
  if (status === "option_data_needed") return "オプションBid/Ask、出来高、OI、IV/Greeksを取得してください。";
  if (status === "avoid_now") return blockers[0] ? `見送り理由を確認: ${blockers[0]}` : "チャートまたはゲート条件が改善するまで見送りです。";
  if (status === "insufficient_data") return missingData[0] ? `${screeningDisplayItems("missingFields", [missingData[0]])[0]}を追加してください。` : "チャート分析に必要なデータを追加してください。";
  return "チャート根拠を目視確認し、不足データを追加してください。";
}

function buildDroppedStrategies(items: StrategyDisplayItem[], primary?: StrategyCandidateKind) {
  return items
    .filter((item) => item.strategy !== primary && item.group !== "workflow")
    .map((item) => ({
      strategy: item.strategy,
      label: item.label,
      reason: item.reasons[0] ?? groupReason(item.group),
    }))
    .slice(0, 4);
}

function groupForStrategy(strategy: StrategyCandidateKind, suitability?: StrategySuitability, primary?: StrategyCandidateKind): StrategyDisplayGroup {
  if (strategy === primary) return "primary";
  if (!suitability || suitability.level === "insufficient_data") return "insufficient_data";
  if (suitability.level === "avoid") return "excluded";
  if (suitability.level === "manual_review_required") return "manual_review";
  return "secondary";
}

function reasonSummary(suitability?: StrategySuitability, review?: ScreeningPriorityReview): string[] {
  return unique([
    ...(suitability?.warnings ?? []),
    ...(suitability?.missingFields ?? []),
    ...(suitability?.manualReviewReasons ?? []),
    ...(suitability?.reasons ?? []),
    ...(review?.blockers ?? []),
    ...(review?.nextDataNeeded ?? []),
  ]).slice(0, 3);
}

function groupReason(group: StrategyDisplayGroup): string {
  if (group === "manual_review") return "手動確認ゲートが残っています。";
  if (group === "excluded") return "現在条件では候補外です。";
  if (group === "insufficient_data") return "判定データが不足しています。";
  return "第一候補より優先度が低いため次点です。";
}

function timeframe(chart: ChartAnalysisSnapshot, timeframeName: "monthly" | "weekly" | "daily"): ChartTimeframeSnapshot | undefined {
  return chart.timeframes.find((item) => item.timeframe === timeframeName);
}

function directionLabel(snapshot?: ChartTimeframeSnapshot): string {
  if (!snapshot) return "未確認";
  const slopes = snapshot.movingAverageSlopes;
  if (slopes?.ma50 === "up" || slopes?.ma200 === "up") return "上向き";
  if (slopes?.ma50 === "down" || slopes?.ma200 === "down") return "下向き";
  if (slopes?.ma50 === "flat" || slopes?.ma200 === "flat") return "横ばい";
  return snapshot.notes?.[0] ?? "未確認";
}

function signalLabel(signal?: string): string {
  return signal ? screeningDisplayLabel("technicalSignal", signal) : "未確認";
}

function maPosition(snapshot: ChartTimeframeSnapshot): string {
  const location = snapshot.priceLocation;
  if (!location) return "移動平均線位置: 未確認";
  const above = [
    location.aboveMa25 ? "25日線上" : undefined,
    location.aboveMa50 ? "50日線上" : undefined,
    location.aboveMa200 ? "200日線上" : undefined,
  ].filter(Boolean);
  return above.length ? `株価: ${above.join("・")}` : "株価: 主要移動平均線上の確認不足";
}

function maCrossSummary(snapshot: ChartTimeframeSnapshot): string {
  const distance = snapshot.priceLocation?.distanceFromMa50Pct;
  if (typeof distance === "number" && Number.isFinite(distance)) return `25/50日線: 50日線から${distance.toFixed(1)}%`;
  return snapshot.notes?.find((note) => /25|50|cross|クロス|接近/.test(note)) ?? "25/50日線: 未確認";
}

function supportResistanceSummary(snapshot: ChartTimeframeSnapshot): string {
  const supports = snapshot.supportLevels?.slice(0, 2).map(formatNumber).join(", ") || "-";
  const resistances = snapshot.resistanceLevels?.slice(0, 2).map(formatNumber).join(", ") || "-";
  return `支持 ${supports} / 抵抗 ${resistances}`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "-";
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
