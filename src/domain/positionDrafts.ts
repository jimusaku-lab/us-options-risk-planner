import { evaluateCapitalReadiness, type CapitalAssumptions, type CapitalReadinessResult } from "@/domain/capitalReadiness";
import type {
  OptionLegDraft,
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

  const status = determinePositionDraftStatus(input, capitalReadiness, unique(missingFields));
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
  if (input.strategySuitability?.level === "avoid" || input.strategySuitability?.level === "insufficient_data") return "not_ready";
  if (capitalReadiness.level === "not_ready" || capitalReadiness.level === "insufficient_data") return "not_ready";
  if (input.strategy === "cash_secured_put_avoid_assignment") return "manual_review_required";
  if (input.strategySuitability?.level === "watch" || input.strategySuitability?.level === "manual_review_required") return "manual_review_required";
  if (capitalReadiness.level === "manual_review_required") return "manual_review_required";
  return "draft_ready";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
