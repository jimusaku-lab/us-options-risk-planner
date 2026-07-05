import type { PublicOptionCandidateInput } from "@/types/screening";

export type OptionSide = "buy" | "sell";
export type OptionLiquidityLevel = "ok" | "watch" | "avoid" | "insufficient_data";

export type ConservativeEntryPrice = {
  price?: number;
  field?: "bid" | "ask";
  mid?: number;
  last?: number;
  missingFields: string[];
  warnings: string[];
};

export type OptionLiquidityEvaluation = {
  level: OptionLiquidityLevel;
  spreadRate?: number;
  mid?: number;
  warnings: string[];
  missingFields: string[];
};

export type OptionChainLiquidityEvaluation = {
  level: OptionLiquidityLevel;
  warnings: string[];
  missingFields: string[];
  okCount: number;
  watchCount: number;
  avoidCount: number;
  insufficientCount: number;
};

const levelSeverity: Record<OptionLiquidityLevel, number> = {
  ok: 0,
  watch: 1,
  avoid: 2,
  insufficient_data: 3,
};

export function calculateOptionMid(option: PublicOptionCandidateInput): number | undefined {
  if (isFiniteNumber(option.bid) && isFiniteNumber(option.ask)) return (option.bid + option.ask) / 2;
  return isFiniteNumber(option.mid) ? option.mid : undefined;
}

export function calculateOptionSpreadRate(option: PublicOptionCandidateInput): number | undefined {
  if (!isFiniteNumber(option.bid) || !isFiniteNumber(option.ask)) return undefined;
  const mid = calculateOptionMid(option);
  if (!isFiniteNumber(mid) || mid <= 0) return undefined;
  return (option.ask - option.bid) / mid;
}

export function getConservativeEntryPrice(option: PublicOptionCandidateInput, side: OptionSide): ConservativeEntryPrice {
  const mid = calculateOptionMid(option);
  const warnings: string[] = [];
  const missingFields: string[] = [];
  if (side === "buy" && isFiniteNumber(option.ask)) {
    return { price: option.ask, field: "ask", mid, last: option.last, missingFields, warnings };
  }
  if (side === "sell" && isFiniteNumber(option.bid)) {
    return { price: option.bid, field: "bid", mid, last: option.last, missingFields, warnings };
  }
  missingFields.push(side === "buy" ? "option.ask" : "option.bid", "option.bidAsk");
  if (isFiniteNumber(mid)) warnings.push("Midは参考値です。保守価格には使いません。");
  if (isFiniteNumber(option.last)) warnings.push("Lastのみ、またはBid/Ask不足のため保守価格を作りません。");
  return { mid, last: option.last, missingFields: unique(missingFields), warnings };
}

export function evaluateOptionLiquidity(option: PublicOptionCandidateInput): OptionLiquidityEvaluation {
  const warnings: string[] = [];
  const missingFields: string[] = [];
  const mid = calculateOptionMid(option);
  const spreadRate = calculateOptionSpreadRate(option);
  let level: OptionLiquidityLevel = "ok";

  if (!isFiniteNumber(option.bid) || !isFiniteNumber(option.ask)) {
    missingFields.push("option.bidAsk");
    if (isFiniteNumber(option.last)) warnings.push("Lastのみでは建玉候補の保守価格にしません。");
    if (isFiniteNumber(option.mid)) warnings.push("Midは参考値です。Bid/Askを確認してください。");
    return { level: "insufficient_data", spreadRate, mid, warnings: unique(warnings), missingFields: unique(missingFields) };
  }

  if (!isFiniteNumber(spreadRate)) {
    level = worstLevel(level, "insufficient_data");
    missingFields.push("option.spreadRate");
  } else if (spreadRate > 0.35) {
    level = worstLevel(level, "avoid");
    warnings.push("Bid/Askスプレッドが35%を超えています。");
  } else if (spreadRate > 0.2) {
    level = worstLevel(level, "watch");
    warnings.push("Bid/Askスプレッドが20%を超えています。");
  }

  if (!isFiniteNumber(option.volume)) {
    level = worstLevel(level, "watch");
    missingFields.push("option.volume");
    warnings.push("Volumeが未取得です。");
  } else if (option.volume < 10) {
    level = worstLevel(level, "avoid");
    warnings.push("Volumeが10未満です。");
  } else if (option.volume < 50) {
    level = worstLevel(level, "watch");
    warnings.push("Volumeが50未満です。");
  }

  if (!isFiniteNumber(option.openInterest)) {
    level = worstLevel(level, "watch");
    missingFields.push("option.openInterest");
    warnings.push("Open Interestが未取得です。");
  } else if (option.openInterest < 20) {
    level = worstLevel(level, "avoid");
    warnings.push("Open Interestが20未満です。");
  } else if (option.openInterest < 100) {
    level = worstLevel(level, "watch");
    warnings.push("Open Interestが100未満です。");
  }

  if (!isFiniteNumber(option.iv)) warnings.push("IVが未取得です。");
  if (!isFiniteNumber(option.delta)) warnings.push("Deltaが未取得です。");
  if (!isFiniteNumber(option.gamma)) warnings.push("Gammaが未取得です。");
  if (!isFiniteNumber(option.theta)) warnings.push("Thetaが未取得です。");
  if (!isFiniteNumber(option.vega)) warnings.push("Vegaが未取得です。");

  return { level, spreadRate, mid, warnings: unique(warnings), missingFields: unique(missingFields) };
}

export function evaluateOptionChainLiquidity(options: PublicOptionCandidateInput[]): OptionChainLiquidityEvaluation {
  if (options.length === 0) {
    return {
      level: "insufficient_data",
      warnings: ["オプション候補がありません。"],
      missingFields: ["optionCandidates"],
      okCount: 0,
      watchCount: 0,
      avoidCount: 0,
      insufficientCount: 0,
    };
  }
  const evaluations = options.map(evaluateOptionLiquidity);
  const counts = {
    okCount: evaluations.filter((item) => item.level === "ok").length,
    watchCount: evaluations.filter((item) => item.level === "watch").length,
    avoidCount: evaluations.filter((item) => item.level === "avoid").length,
    insufficientCount: evaluations.filter((item) => item.level === "insufficient_data").length,
  };
  const usableCount = counts.okCount + counts.watchCount;
  return {
    level: usableCount > 0 ? (counts.okCount > 0 ? "ok" : "watch") : "insufficient_data",
    warnings: unique(evaluations.flatMap((item) => item.warnings)),
    missingFields: unique(evaluations.flatMap((item) => item.missingFields)),
    ...counts,
  };
}

function worstLevel(current: OptionLiquidityLevel, next: OptionLiquidityLevel): OptionLiquidityLevel {
  return levelSeverity[next] > levelSeverity[current] ? next : current;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
