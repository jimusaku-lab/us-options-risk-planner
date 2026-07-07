import { evaluateCapitalReadiness, type CapitalAssumptions, type CapitalReadinessResult } from "@/domain/capitalReadiness";
import type {
  OptionLegDraft,
  PositionDraftCapital,
  PositionDraftExitPlan,
  PositionDraftReviewState,
  PositionDraft,
  PositionDraftStatus,
  PublicScreeningCandidateInput,
  StrategyCandidateKind,
  StrategySuitability,
} from "@/types/screening";

export type PositionDraftBuildInput = {
  symbol: string;
  strategy: StrategyCandidateKind;
  strategySuitability?: StrategySuitability;
  legs: OptionLegDraft[];
  capital?: PublicScreeningCandidateInput["capital"] & { stockCostBasisUSD?: number };
  underlyingPrice?: number;
};

export type CandidatePositionDraftBuildInput = {
  symbol: string;
  strategySuitabilities?: StrategySuitability[];
  legSelections: Array<{
    strategy: StrategyCandidateKind;
    legs: OptionLegDraft[];
  }>;
  capital?: PublicScreeningCandidateInput["capital"] & { stockCostBasisUSD?: number };
  underlyingPrice?: number;
};

export function buildPositionDraft(input: PositionDraftBuildInput): PositionDraft {
  const warnings: string[] = [];
  const missingFields: string[] = [];
  if (input.legs.length === 0) missingFields.push("legs");
  if (input.strategySuitability?.level === "avoid" || input.strategySuitability?.level === "insufficient_data") {
    warnings.push(`strategySuitability is ${input.strategySuitability.level}; 建玉案ドラフトには進めません。`);
  }
  if (input.strategySuitability?.level === "manual_review_required") warnings.push("戦略判定で手動確認が必要です。");
  if (input.strategySuitability?.level === "watch") warnings.push("戦略判定がwatchのため手動確認が必要です。");

  const invalidLegFields = input.legs.flatMap((leg, index) => {
    const fields: string[] = [];
    if (!isFiniteNumber(leg.conservativePrice)) fields.push(`legs.${index}.conservativePrice`);
    if (leg.missingFields.length > 0) fields.push(...leg.missingFields.map((field) => `legs.${index}.${field}`));
    return fields;
  });
  missingFields.push(...invalidLegFields);

  const capitalReadiness = evaluateCapitalReadiness({
    strategy: input.strategy,
    legs: input.legs,
    capital: input.capital as CapitalAssumptions | undefined,
    underlyingPrice: input.underlyingPrice,
  });
  warnings.push(...capitalReadiness.warnings);
  missingFields.push(...capitalReadiness.missingFields);
  missingFields.push(...priceSourceMissingFields(input.legs));

  const status = determinePositionDraftStatus(input, capitalReadiness, unique(missingFields));
  const capital = buildDraftCapital(capitalReadiness);
  const exitPlan = buildExitPlan(input, capitalReadiness);
  const reviewState = buildPositionDraftReviewState({
    status,
    strategy: input.strategy,
    missingFields: unique(missingFields),
    warnings: unique(warnings),
  });
  return {
    id: `${input.symbol}-${input.strategy}-${input.legs[0]?.id ?? "no-leg"}`,
    strategy: input.strategy,
    status,
    symbol: input.symbol.trim().toUpperCase(),
    legs: input.legs,
    requiredCapitalUSD: capitalReadiness.requiredCapitalUSD,
    maxLossUSD: capitalReadiness.maxLossUSD,
    availableCashUSD: capitalReadiness.availableCashUSD,
    warnings: unique(warnings),
    missingFields: unique(missingFields),
    capital,
    exitPlan,
    reviewState,
  };
}

export function buildPositionDraftsForCandidate(input: CandidatePositionDraftBuildInput): PositionDraft[] {
  return input.legSelections.map((selection) =>
    buildPositionDraft({
      symbol: input.symbol,
      strategy: selection.strategy,
      strategySuitability: input.strategySuitabilities?.find((item) => item.strategy === selection.strategy),
      legs: selection.legs,
      capital: input.capital,
      underlyingPrice: input.underlyingPrice,
    }),
  );
}

export function finalizePositionDraftForReview(draft: PositionDraft): PositionDraft {
  const capital: PositionDraftCapital = draft.capital ?? {
    requiredCapitalUSD: draft.requiredCapitalUSD,
    maxLossUSD: draft.maxLossUSD,
    availableCashUSD: draft.availableCashUSD,
    premiumDebitUSD: draft.requiredCapitalUSD !== undefined && draft.maxLossUSD !== undefined && draft.requiredCapitalUSD === draft.maxLossUSD ? draft.requiredCapitalUSD : undefined,
    premiumCreditUSD: draft.requiredCapitalUSD !== undefined && draft.maxLossUSD !== undefined && draft.requiredCapitalUSD > draft.maxLossUSD ? draft.requiredCapitalUSD - draft.maxLossUSD : undefined,
    assignmentCapitalRequiredUSD: draft.requiredCapitalUSD !== undefined && draft.maxLossUSD !== undefined && draft.requiredCapitalUSD > draft.maxLossUSD ? draft.requiredCapitalUSD : undefined,
    capitalQuality: draft.status === "draft_ready" ? "ok" : draft.status === "manual_review_required" ? "watch" : "blocked",
  };
  return {
    ...draft,
    capital,
    exitPlan: draft.exitPlan ?? {
      latestCloseDate: draft.legs[0]?.expiry,
      expiryHandling: "建玉案レビューで出口ルールを確認する",
      notes: ["これは注文ではありません。", "証券会社チケット価格を最終確認してください。"],
    },
    reviewState: draft.reviewState ?? buildPositionDraftReviewState({
      status: draft.status,
      strategy: draft.strategy,
      missingFields: draft.missingFields,
      warnings: draft.warnings,
    }),
  };
}

export function updatePositionDraftReviewChecklist(
  draft: PositionDraft,
  itemId: PositionDraftReviewState["checklist"][number]["id"],
  checked: boolean,
): PositionDraft {
  const current = draft.reviewState ?? buildPositionDraftReviewState({
    status: draft.status,
    strategy: draft.strategy,
    missingFields: draft.missingFields,
    warnings: draft.warnings,
  });
  const nextChecklist = current.checklist.map((item) => item.id === itemId ? { ...item, checked } : item);
  const blockingUnchecked = nextChecklist.some((item) => item.blockingIfUnchecked && !item.checked);
  const reviewStatus: PositionDraftReviewState["reviewStatus"] =
    draft.status === "not_ready"
      ? "blocked"
      : draft.missingFields.length > 0
        ? "needs_data"
        : blockingUnchecked
          ? "not_reviewed"
          : "ready_for_manual_transfer";
  return {
    ...draft,
    reviewState: {
      ...current,
      checklist: nextChecklist,
      reviewStatus,
    },
  };
}

export function buildLongCallDraft(input: Omit<PositionDraftBuildInput, "strategy">): PositionDraft {
  return buildPositionDraft({ ...input, strategy: "long_call" });
}

export function buildBuyToOwnPutDraft(input: Omit<PositionDraftBuildInput, "strategy">): PositionDraft {
  return buildPositionDraft({ ...input, strategy: "cash_secured_put_buy_to_own" });
}

export function buildAvoidAssignmentPutDraft(input: Omit<PositionDraftBuildInput, "strategy">): PositionDraft {
  return buildPositionDraft({ ...input, strategy: "cash_secured_put_avoid_assignment" });
}

export function buildCoveredCallDraft(input: Omit<PositionDraftBuildInput, "strategy">): PositionDraft {
  return buildPositionDraft({ ...input, strategy: "covered_call" });
}

function determinePositionDraftStatus(
  input: PositionDraftBuildInput,
  capitalReadiness: CapitalReadinessResult,
  missingFields: string[],
): PositionDraftStatus {
  if (input.legs.length === 0) return "not_ready";
  if (missingFields.some((field) => field.includes("conservativePrice"))) return "not_ready";
  if (missingFields.some((field) => field.includes("priceSource") || field.includes("option.bidAsk") || field.includes("option.ask") || field.includes("option.bid"))) return "not_ready";
  if (input.legs.some((leg) => leg.liquidityWarnings.some((warning) => warning.includes("Lastのみ") || warning.includes("流動性が低すぎ")))) return "not_ready";
  if (input.strategySuitability?.level === "avoid" || input.strategySuitability?.level === "insufficient_data") return "not_ready";
  if (capitalReadiness.level === "not_ready" || capitalReadiness.level === "insufficient_data") return "not_ready";
  if (!["long_call", "cash_secured_put_buy_to_own", "cash_secured_put_avoid_assignment", "covered_call"].includes(input.strategy)) return "manual_review_required";
  if (input.strategy === "cash_secured_put_avoid_assignment") return "manual_review_required";
  if (input.strategySuitability?.level === "watch" || input.strategySuitability?.level === "manual_review_required") return "manual_review_required";
  if (capitalReadiness.level === "manual_review_required") return "manual_review_required";
  return "draft_ready";
}

function priceSourceMissingFields(legs: OptionLegDraft[]): string[] {
  return legs.flatMap((leg, index) => {
    const expected = leg.side === "buy" ? "ask" : "bid";
    if (leg.conservativePriceField !== expected) return [`legs.${index}.priceSource.${expected}`];
    return [];
  });
}

function buildDraftCapital(capitalReadiness: CapitalReadinessResult): PositionDraftCapital {
  return {
    premiumDebitUSD: capitalReadiness.premiumDebitUSD,
    premiumCreditUSD: capitalReadiness.premiumCreditUSD,
    requiredCapitalUSD: capitalReadiness.requiredCapitalUSD,
    maxLossUSD: capitalReadiness.maxLossUSD,
    assignmentCapitalRequiredUSD: capitalReadiness.assignmentCapitalRequiredUSD,
    stockNotionalUSD: capitalReadiness.stockNotionalUSD,
    availableCashUSD: capitalReadiness.availableCashUSD,
    buyingPowerUSD: capitalReadiness.buyingPowerUSD,
    maxLossToleranceUSD: capitalReadiness.maxLossToleranceUSD,
    saxoRequiredMarginUSD: capitalReadiness.saxoRequiredMarginUSD,
    saxoMarginAvailableUSD: capitalReadiness.saxoMarginAvailableUSD,
    cashBalanceUSD: capitalReadiness.cashBalanceUSD,
    marginCashCoverageRatio: capitalReadiness.marginCashCoverageRatio,
    marginUsageAfterEntryPct: capitalReadiness.marginUsageAfterEntryPct,
    capitalQuality: capitalReadiness.capitalQuality,
  };
}

function buildExitPlan(input: PositionDraftBuildInput, capitalReadiness: CapitalReadinessResult): PositionDraftExitPlan {
  const firstLeg = input.legs[0];
  const price = firstLeg?.conservativePrice;
  if (input.strategy === "long_call") {
    return {
      profitTakePrice: isFiniteNumber(price) ? round2(price * 1.3) : undefined,
      stopLossPrice: isFiniteNumber(price) ? round2(price * 0.6) : undefined,
      latestCloseDate: firstLeg?.expiry,
      expiryHandling: "満期前に時間価値と損切りラインを確認する",
      notes: ["これは注文ではありません。Saxo TraderGO等のチケット価格を最終確認します。"],
    };
  }
  if (input.strategy === "cash_secured_put_avoid_assignment") {
    return {
      latestCloseDate: firstLeg?.expiry,
      expiryHandling: "割当前提ではないため満期前の買戻し期限を手動確認する",
      notes: ["出口ルール未確認なら建玉案レビュー止まりです。", ...capitalReadiness.warnings],
    };
  }
  if (input.strategy === "cash_secured_put_buy_to_own") {
    return {
      latestCloseDate: firstLeg?.expiry,
      expiryHandling: "割当時に100株取得し、その後のカバードコール移行を確認する",
      notes: ["実質取得単価と割当資金を確認します。"],
    };
  }
  if (input.strategy === "covered_call") {
    return {
      latestCloseDate: firstLeg?.expiry,
      expiryHandling: "権利行使時に株を渡してよい価格か確認する",
      notes: ["既存100株の取得単価と売却許容価格を確認します。"],
    };
  }
  return {
    latestCloseDate: firstLeg?.expiry,
    expiryHandling: "上級戦略は手動確認に留める",
    notes: ["複数脚・上級戦略は自動転記対象外です。"],
  };
}

export function buildPositionDraftReviewState({
  status,
  strategy,
  missingFields,
  warnings,
  checkedIds = [],
}: {
  status: PositionDraftStatus;
  strategy: StrategyCandidateKind;
  missingFields: string[];
  warnings: string[];
  checkedIds?: string[];
}): PositionDraftReviewState {
  const checked = new Set(checkedIds);
  const checklist = [
    item("chart_confirmed", "チャート根拠を確認した", true, checked),
    item("strategy_confirmed", "戦略候補であり売買推奨ではないことを確認した", true, checked),
    item("expiry_strike_confirmed", "満期・権利行使価格を確認した", true, checked),
    item("bid_ask_confirmed", "Bid/Ask由来の保守価格を確認した", true, checked),
    item("liquidity_confirmed", "Volume / Open Interest / IVを確認した", true, checked),
    item("capital_confirmed", "利用可能資金または保有株を確認した", true, checked),
    item("max_loss_confirmed", "最大損失または割当資金を確認した", true, checked),
    item("assignment_confirmed", assignmentLabel(strategy), strategy !== "long_call", checked),
    item("exit_rule_confirmed", "利確・損切り・満期前判断期限を確認した", true, checked),
    item("saxo_ticket_confirmed", "証券会社チケット価格を最終確認した", true, checked),
  ];
  const blockingUnchecked = checklist.some((entry) => entry.blockingIfUnchecked && !entry.checked);
  const reviewStatus: PositionDraftReviewState["reviewStatus"] =
    status === "not_ready"
      ? "blocked"
      : missingFields.length > 0
        ? "needs_data"
        : blockingUnchecked
          ? "not_reviewed"
          : "ready_for_manual_transfer";
  return {
    checklist,
    reviewStatus,
    transferWarnings: unique([
      "これは注文ではありません。",
      "建玉入力への反映前に内容確認が必要です。",
      "Saxo TraderGO等のチケット価格を最終確認してください。",
      status !== "draft_ready" ? "手動確認が必要です。" : undefined,
      ...warnings,
    ].filter((value): value is string => Boolean(value))),
  };
}

function item(id: PositionDraftReviewState["checklist"][number]["id"], label: string, required: boolean, checked: Set<string>) {
  return {
    id,
    label,
    required,
    checked: checked.has(id),
    blockingIfUnchecked: required,
  };
}

function assignmentLabel(strategy: StrategyCandidateKind): string {
  if (strategy === "covered_call") return "株を渡してよい前提を確認した";
  if (strategy === "cash_secured_put_buy_to_own") return "100株取得前提と割当資金を確認した";
  if (strategy === "cash_secured_put_avoid_assignment") return "割当リスクが残ることを確認した";
  return "割当・株式移動リスクを確認した";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
