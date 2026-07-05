import type { CandidateSymbol } from "@/types/candidates";
import type { ScreeningPriorityReview } from "@/domain/screeningPriority";
import { calculateSpreadRate, getBestDraft, getBestOptionLeg, getBestOptionQuote, strategyLabel } from "@/domain/screeningPriority";

export type ScreeningComparisonItem = {
  candidateId: string;
  symbol: string;
  company: string;
  price?: number;
  level: string;
  chart: string;
  confidence: string;
  primaryStrategy: string;
  secondaryStrategy: string;
  expiry: string;
  strike: string;
  bid: string;
  ask: string;
  mid: string;
  last: string;
  spreadRate: string;
  volume: string;
  openInterest: string;
  iv: string;
  conservativePrice: string;
  requiredCapital: string;
  availableCash: string;
  maxLoss: string;
  draftStatus: string;
  topReasons: string[];
  penaltyReasons: string[];
  missingChecks: string[];
};

export function buildScreeningComparisonItems(
  candidates: CandidateSymbol[],
  reviews: Map<string, ScreeningPriorityReview>,
): ScreeningComparisonItem[] {
  return candidates.map((candidate) => buildScreeningComparisonItem(candidate, reviews.get(candidate.id)));
}

export function buildScreeningComparisonItem(candidate: CandidateSymbol, review?: ScreeningPriorityReview): ScreeningComparisonItem {
  const chart = candidate.publicScreeningInput?.chartAnalysis;
  const strategies = candidate.strategySuitability ?? candidate.publicScreeningInput?.strategySuitability ?? [];
  const draft = getBestDraft(candidate);
  const leg = getBestOptionLeg(candidate);
  const quote = getBestOptionQuote(candidate);
  return {
    candidateId: candidate.id,
    symbol: candidate.symbol,
    company: candidate.company,
    price: candidate.priceUSD,
    level: candidate.screeningCompleteness?.level ?? "-",
    chart: chart?.regime ?? "-",
    confidence: chart?.confidence ?? "-",
    primaryStrategy: review?.primaryStrategyLabel ?? (strategies[0]?.strategy ? strategyLabel(strategies[0].strategy) : "-"),
    secondaryStrategy: strategies[1]?.strategy ? strategyLabel(strategies[1].strategy) : "-",
    expiry: leg?.expiry ?? quote?.expiry ?? "-",
    strike: formatNumber(leg?.strikePrice ?? quote?.strikePrice ?? quote?.strike),
    bid: formatNumber(quote?.bid),
    ask: formatNumber(quote?.ask),
    mid: formatNumber(quote?.mid),
    last: formatNumber(quote?.last),
    spreadRate: formatPercent(calculateSpreadRate(quote)),
    volume: formatNumber(quote?.volume, 0),
    openInterest: formatNumber(quote?.openInterest, 0),
    iv: formatPercent(quote?.iv),
    conservativePrice: formatNumber(leg?.conservativePrice),
    requiredCapital: formatUsd(draft?.requiredCapitalUSD),
    availableCash: formatUsd(draft?.availableCashUSD),
    maxLoss: formatUsd(draft?.maxLossUSD),
    draftStatus: draft?.status ?? "none",
    topReasons: review?.topReasons ?? [],
    penaltyReasons: review?.penaltyReasons ?? [],
    missingChecks: review?.missingChecks ?? [],
  };
}

function formatNumber(value?: number, maximumFractionDigits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  return Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function formatUsd(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  return `$${Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)}`;
}

function formatPercent(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}
