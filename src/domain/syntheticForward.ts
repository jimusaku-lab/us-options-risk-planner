import { createExternalReviewPayload } from "@/domain/screeningReviewPayload";
import type {
  ExternalReviewPayload,
  ScreeningCandidate,
  StrategyFitLevel,
  StrategyFitResult,
  SyntheticForwardCandidate,
  SyntheticForwardEvaluation,
  SyntheticForwardLeg,
  SyntheticForwardRiskFlag,
} from "@/types/screening";

export const syntheticForwardKind = "synthetic_forward" as const;
export const syntheticForwardDisplayName = "シンセティックフォワード候補";

type SyntheticForwardLegPairInput = {
  underlyingPrice?: number;
  callLegs: SyntheticForwardLeg[];
  putLegs: SyntheticForwardLeg[];
  maxStrikeDistancePct?: number;
};

type SyntheticForwardEvaluationInput = {
  candidate: ScreeningCandidate;
  longCallLeg?: SyntheticForwardLeg;
  shortPutLeg?: SyntheticForwardLeg;
  assignmentCapitalAvailable?: number;
  longTermHoldEligible?: boolean;
  maxStrikeDistancePct?: number;
};

type SyntheticForwardReadiness = {
  technicalBias: StrategyFitLevel;
  reasons: string[];
  warnings: string[];
  missingFields: string[];
  riskFlags: SyntheticForwardRiskFlag[];
};

function isFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function compactUnique<T extends string>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function legMid(leg: SyntheticForwardLeg | undefined): number | undefined {
  if (!leg) return undefined;
  if (isFiniteNumber(leg.mid)) return leg.mid;
  if (isFiniteNumber(leg.bid) && isFiniteNumber(leg.ask)) return (leg.bid + leg.ask) / 2;
  return undefined;
}

function callEntryPrice(leg: SyntheticForwardLeg | undefined): number | undefined {
  if (!leg) return undefined;
  return isFiniteNumber(leg.ask) ? leg.ask : legMid(leg);
}

function putCreditPrice(leg: SyntheticForwardLeg | undefined): number | undefined {
  if (!leg) return undefined;
  return isFiniteNumber(leg.bid) ? leg.bid : legMid(leg);
}

function spreadRate(leg: SyntheticForwardLeg | undefined): number | undefined {
  const mid = legMid(leg);
  if (!leg || !isFiniteNumber(leg.bid) || !isFiniteNumber(leg.ask) || !isFiniteNumber(mid) || mid <= 0) return undefined;
  return (leg.ask - leg.bid) / mid;
}

function strikeDistancePct(callLeg: SyntheticForwardLeg, putLeg: SyntheticForwardLeg, underlyingPrice?: number): number | undefined {
  const denominator = isFiniteNumber(underlyingPrice) && underlyingPrice > 0 ? underlyingPrice : Math.max(callLeg.strikePrice, putLeg.strikePrice);
  if (!isFiniteNumber(denominator) || denominator <= 0) return undefined;
  return Math.abs(callLeg.strikePrice - putLeg.strikePrice) / denominator * 100;
}

function strikeToPriceRatio(strike: number | undefined, underlyingPrice: number | undefined): number | undefined {
  if (!isFiniteNumber(strike) || !isFiniteNumber(underlyingPrice) || underlyingPrice <= 0) return undefined;
  return strike / underlyingPrice;
}

function hasMinimumLiquidity(leg: SyntheticForwardLeg | undefined): boolean | undefined {
  if (!leg) return undefined;
  const volumeOk = isFiniteNumber(leg.volume) && leg.volume >= 10;
  const oiOk = isFiniteNumber(leg.openInterest) && leg.openInterest >= 20;
  return volumeOk || oiOk;
}

function hasLiquidityAttention(leg: SyntheticForwardLeg | undefined): boolean {
  if (!leg) return false;
  const spread = spreadRate(leg);
  return (
    (isFiniteNumber(spread) && spread > 0.2) ||
    (isFiniteNumber(leg.volume) && leg.volume < 50) ||
    (isFiniteNumber(leg.openInterest) && leg.openInterest < 100)
  );
}

function hasBadLiquidity(leg: SyntheticForwardLeg | undefined): boolean {
  if (!leg) return true;
  const spread = spreadRate(leg);
  const liquidityOk = hasMinimumLiquidity(leg);
  return (isFiniteNumber(spread) && spread > 0.35) || liquidityOk === false;
}

function resolveDte(callLeg?: SyntheticForwardLeg, putLeg?: SyntheticForwardLeg): number | undefined {
  if (callLeg?.dte !== undefined && putLeg?.dte !== undefined && callLeg.dte === putLeg.dte) return callLeg.dte;
  return callLeg?.dte ?? putLeg?.dte;
}

function isStandardOrLongDte(dte: number | undefined): boolean {
  return dte !== undefined && ((dte >= 30 && dte <= 90) || (dte >= 150 && dte <= 180));
}

function isLongRiskWindow(dte: number | undefined): boolean {
  return dte !== undefined && dte >= 150 && dte <= 180;
}

function resolveTechnicalBias(candidate: ScreeningCandidate): SyntheticForwardReadiness {
  const snapshot = candidate.technicalSnapshot;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const missingFields: string[] = [];
  const riskFlags: SyntheticForwardRiskFlag[] = [];
  const upsidePattern = snapshot.patternCandidates?.find((pattern) => pattern.kind === "upside_reversal_combo");

  if (upsidePattern?.fitLevel === "fit") {
    return {
      technicalBias: "fit",
      reasons: ["上昇転換コンボ候補のテクニカル判定がfitです。"],
      warnings: [],
      missingFields: [],
      riskFlags: [],
    };
  }
  if (upsidePattern?.fitLevel === "watch") {
    reasons.push("上昇転換コンボ候補のテクニカル判定がwatchです。");
    riskFlags.push("directional_bias_weak");
  }

  const close = snapshot.dailyClose;
  if (!isFiniteNumber(close)) missingFields.push("technicalSnapshot.dailyClose");
  if (!isFiniteNumber(snapshot.sma25)) missingFields.push("technicalSnapshot.sma25");
  if (!isFiniteNumber(snapshot.sma50)) missingFields.push("technicalSnapshot.sma50");

  const aboveMa25 = isFiniteNumber(close) && isFiniteNumber(snapshot.sma25) ? close >= snapshot.sma25 : undefined;
  const aboveMa50 = isFiniteNumber(close) && isFiniteNumber(snapshot.sma50) ? close >= snapshot.sma50 : undefined;
  const ma50Slope = snapshot.movingAverageSlopes?.ma50;
  if (!ma50Slope) missingFields.push("technicalSnapshot.movingAverageSlopes.ma50");
  if (ma50Slope === "down") {
    warnings.push("50日線が下向きで方向性注意です。");
    riskFlags.push("directional_bias_weak");
  }
  const momentumImproving =
    snapshot.macdSignal === "bullish" ||
    snapshot.macdSignal === "golden_cross" ||
    snapshot.slowKdSignal === "bullish" ||
    snapshot.slowKdSignal === "golden_cross" ||
    Boolean(snapshot.signalEvents?.some((event) => event.type === "macd_golden_cross" || event.type === "slowkd_golden_cross"));

  if (aboveMa25 && aboveMa50 && (ma50Slope === "up" || ma50Slope === "flat") && momentumImproving) {
    reasons.push("株価が25日線・50日線の上にあり、方向性確認に使える状態です。");
    return {
      technicalBias: upsidePattern?.fitLevel === "watch" || ma50Slope === "flat" ? "watch" : "fit",
      reasons,
      warnings,
      missingFields,
      riskFlags: compactUnique(riskFlags),
    };
  }

  if (missingFields.length > 0) {
    return { technicalBias: "insufficient_data", reasons, warnings, missingFields: compactUnique(missingFields), riskFlags: compactUnique(riskFlags) };
  }

  warnings.push("上昇方向条件が弱いため方向性注意です。");
  riskFlags.push("directional_bias_weak");
  return {
    technicalBias: ma50Slope === "down" || aboveMa25 === false || aboveMa50 === false ? "avoid" : "watch",
    reasons,
    warnings,
    missingFields: [],
    riskFlags: compactUnique(riskFlags),
  };
}

function buildCandidateBase(input: SyntheticForwardEvaluationInput): SyntheticForwardCandidate {
  const { candidate, longCallLeg, shortPutLeg } = input;
  const underlyingPrice = candidate.underlyingPrice;
  const sameStrike = longCallLeg && shortPutLeg ? (longCallLeg.strikePrice + shortPutLeg.strikePrice) / 2 : longCallLeg?.strikePrice ?? shortPutLeg?.strikePrice;
  const callCost = callEntryPrice(longCallLeg);
  const putCredit = putCreditPrice(shortPutLeg);
  const netPremium = isFiniteNumber(callCost) && isFiniteNumber(putCredit) ? callCost - putCredit : undefined;
  const dte = resolveDte(longCallLeg, shortPutLeg);
  const syntheticDelta =
    isFiniteNumber(longCallLeg?.delta) && isFiniteNumber(shortPutLeg?.delta) ? longCallLeg.delta - shortPutLeg.delta : undefined;
  const assignmentCapitalRequired = isFiniteNumber(sameStrike) ? sameStrike * 100 : undefined;
  const stockEquivalentNotional = isFiniteNumber(underlyingPrice) ? underlyingPrice * 100 : undefined;
  const capitalEfficiencyNotes: string[] = [];
  if (isFiniteNumber(netPremium)) capitalEfficiencyNotes.push(`差額プレミアムは1株あたり${netPremium.toFixed(2)}USDです。`);
  if (isFiniteNumber(assignmentCapitalRequired)) capitalEfficiencyNotes.push("P売り割当時の100株相当資金を別途確認します。");

  return {
    kind: syntheticForwardKind,
    expiry: longCallLeg?.expiry ?? shortPutLeg?.expiry,
    dte,
    strike: sameStrike,
    strikeToPriceRatio: strikeToPriceRatio(sameStrike, underlyingPrice),
    longCallLeg,
    shortPutLeg,
    netPremium,
    syntheticDelta,
    breakEvenPrice: isFiniteNumber(sameStrike) && isFiniteNumber(netPremium) ? sameStrike + netPremium : undefined,
    assignmentCapitalRequired,
    assignmentCapitalAvailable: input.assignmentCapitalAvailable,
    stockEquivalentNotional,
    capitalEfficiencyNotes,
  };
}

export function findSyntheticForwardLegPairs(input: SyntheticForwardLegPairInput): SyntheticForwardCandidate[] {
  const maxDistancePct = input.maxStrikeDistancePct ?? 1;
  const pairs: SyntheticForwardCandidate[] = [];
  for (const callLeg of input.callLegs.filter((leg) => leg.type === "long_call")) {
    for (const putLeg of input.putLegs.filter((leg) => leg.type === "short_put")) {
      if (callLeg.expiry !== putLeg.expiry) continue;
      const distance = strikeDistancePct(callLeg, putLeg, input.underlyingPrice);
      if (distance === undefined || distance > maxDistancePct) continue;
      pairs.push(buildCandidateBase({
        candidate: {
          symbol: "",
          market: "",
          underlyingPrice: input.underlyingPrice,
          dataSource: "manual",
          delayStatus: "unknown",
          technicalSnapshot: { trendNotes: [] },
          optionChainQuality: { hasOptionChain: true, qualityWarnings: [] },
          candidateStrategies: [],
          riskFlags: [],
          missingFields: [],
        },
        longCallLeg: callLeg,
        shortPutLeg: putLeg,
      }));
    }
  }
  return pairs;
}

export function validateSyntheticForwardReadiness(input: SyntheticForwardEvaluationInput): SyntheticForwardReadiness {
  const base = buildCandidateBase(input);
  const reasons: string[] = [];
  const warnings: string[] = [];
  const missingFields: string[] = [];
  const riskFlags: SyntheticForwardRiskFlag[] = [];
  const technical = resolveTechnicalBias(input.candidate);
  reasons.push(...technical.reasons);
  warnings.push(...technical.warnings);
  missingFields.push(...technical.missingFields);
  riskFlags.push(...technical.riskFlags);

  if (!isFiniteNumber(input.candidate.underlyingPrice)) missingFields.push("underlyingPrice");
  if (!input.candidate.optionChainQuality.hasOptionChain) missingFields.push("optionChainQuality.hasOptionChain");
  if (!input.longCallLeg) missingFields.push("syntheticForward.longCallLeg");
  if (!input.shortPutLeg) missingFields.push("syntheticForward.shortPutLeg");
  if (input.longCallLeg && input.shortPutLeg && input.longCallLeg.expiry !== input.shortPutLeg.expiry) missingFields.push("syntheticForward.sameExpiry");
  if (!isFiniteNumber(base.dte)) missingFields.push("syntheticForward.dte");
  if (!isFiniteNumber(base.netPremium)) missingFields.push("syntheticForward.netPremium");

  const distance = input.longCallLeg && input.shortPutLeg ? strikeDistancePct(input.longCallLeg, input.shortPutLeg, input.candidate.underlyingPrice) : undefined;
  if (distance !== undefined && distance > (input.maxStrikeDistancePct ?? 1)) {
    warnings.push("同一権利行使価格付近で組めません。");
    riskFlags.push("directional_bias_weak");
  }

  if (isFiniteNumber(base.strikeToPriceRatio) && (base.strikeToPriceRatio < 0.98 || base.strikeToPriceRatio > 1.05)) {
    warnings.push("権利行使価格と現在株価の比率が0.98から1.05の目安から外れています。");
  }
  if (isFiniteNumber(base.dte) && !isStandardOrLongDte(base.dte)) warnings.push("DTEが標準候補または長め候補の範囲外です。");
  if (isLongRiskWindow(base.dte)) {
    warnings.push("long_put_risk_window: P売りのリスク期間が長めです。");
    riskFlags.push("long_put_risk_window");
  }

  if (!isFiniteNumber(callEntryPrice(input.longCallLeg))) missingFields.push("syntheticForward.longCallLeg.askOrMid");
  if (!isFiniteNumber(putCreditPrice(input.shortPutLeg))) missingFields.push("syntheticForward.shortPutLeg.bidOrMid");

  if (hasBadLiquidity(input.longCallLeg) || hasBadLiquidity(input.shortPutLeg)) {
    warnings.push("オプション流動性が低すぎます。");
    riskFlags.push("liquidity_too_low");
  } else if (hasLiquidityAttention(input.longCallLeg) || hasLiquidityAttention(input.shortPutLeg) || input.candidate.optionChainQuality.qualityWarnings.length > 0) {
    warnings.push("流動性注意です。");
    riskFlags.push("liquidity_attention");
  }

  if (input.longTermHoldEligible === false) {
    warnings.push("100株取得前提にできない銘柄です。");
    riskFlags.push("long_term_hold_not_eligible");
  } else if (input.longTermHoldEligible === undefined) {
    warnings.push("100株取得前提にできるか未確認です。");
  }

  if (isFiniteNumber(base.assignmentCapitalRequired) && isFiniteNumber(input.assignmentCapitalAvailable)) {
    if (input.assignmentCapitalAvailable < base.assignmentCapitalRequired) {
      warnings.push("P売り割当時の資金が不足しています。");
      riskFlags.push("assignment_capital_shortage");
    }
  } else if (input.shortPutLeg) {
    warnings.push("P売り割当時の資金確認が未完了です。");
  }

  if (input.candidate.riskFlags.length > 0) {
    warnings.push("イベントリスクは要確認です。");
    riskFlags.push("event_risk_attention");
  }

  return {
    technicalBias: technical.technicalBias,
    reasons: compactUnique(reasons),
    warnings: compactUnique(warnings),
    missingFields: compactUnique(missingFields),
    riskFlags: compactUnique(riskFlags),
  };
}

export function evaluateSyntheticForwardCandidate(input: SyntheticForwardEvaluationInput): SyntheticForwardEvaluation {
  const base = buildCandidateBase(input);
  const readiness = validateSyntheticForwardReadiness(input);
  const avoidRiskFlags: SyntheticForwardRiskFlag[] = ["assignment_capital_shortage", "long_term_hold_not_eligible", "liquidity_too_low"];
  const hasAvoidRisk = readiness.riskFlags.some((flag) => avoidRiskFlags.includes(flag));
  const sameExpiry = input.longCallLeg && input.shortPutLeg && input.longCallLeg.expiry === input.shortPutLeg.expiry;
  const nearStrike =
    input.longCallLeg && input.shortPutLeg
      ? (strikeDistancePct(input.longCallLeg, input.shortPutLeg, input.candidate.underlyingPrice) ?? Number.POSITIVE_INFINITY) <= (input.maxStrikeDistancePct ?? 1)
      : false;
  const ratioOk = isFiniteNumber(base.strikeToPriceRatio) && base.strikeToPriceRatio >= 0.98 && base.strikeToPriceRatio <= 1.05;
  const dteOk = isStandardOrLongDte(base.dte);
  const fitLevel: StrategyFitLevel =
    readiness.missingFields.length > 0
      ? "insufficient_data"
      : hasAvoidRisk || readiness.technicalBias === "avoid" || !sameExpiry || !nearStrike
        ? "avoid"
        : readiness.technicalBias === "fit" && ratioOk && dteOk && readiness.warnings.length === 0
          ? "fit"
          : "watch";

  return {
    ...base,
    fitLevel,
    technicalBias: readiness.technicalBias,
    reasons: readiness.reasons,
    warnings: readiness.warnings,
    missingFields: readiness.missingFields,
    riskFlags: readiness.riskFlags,
  };
}

export function buildSyntheticForwardStrategyFitResult(evaluation: SyntheticForwardEvaluation): StrategyFitResult {
  return {
    strategy: "synthetic_forward",
    fitLevel: evaluation.fitLevel,
    reasons: evaluation.reasons,
    warnings: evaluation.warnings,
    missingFields: evaluation.missingFields,
    requiredChecks: [
      { id: "same-expiry", label: "コールとPの満期が同一か", passed: Boolean(evaluation.longCallLeg && evaluation.shortPutLeg && evaluation.longCallLeg.expiry === evaluation.shortPutLeg.expiry) },
      { id: "near-same-strike", label: "同一または近い権利行使価格か", passed: evaluation.longCallLeg && evaluation.shortPutLeg ? Math.abs(evaluation.longCallLeg.strikePrice - evaluation.shortPutLeg.strikePrice) <= Math.max(1, (evaluation.strike ?? 0) * 0.01) : undefined },
      { id: "assignment-capital", label: "P売り割当時の資金を確認する", passed: isFiniteNumber(evaluation.assignmentCapitalRequired) && isFiniteNumber(evaluation.assignmentCapitalAvailable) ? evaluation.assignmentCapitalAvailable >= evaluation.assignmentCapitalRequired : undefined },
    ],
    numericChecks: [
      { id: "strike-current-0.98-1.05", label: "権利行使価格 / 現在株価 0.98から1.05", value: evaluation.strikeToPriceRatio, min: 0.98, max: 1.05, passed: isFiniteNumber(evaluation.strikeToPriceRatio) && evaluation.strikeToPriceRatio >= 0.98 && evaluation.strikeToPriceRatio <= 1.05 },
      { id: "dte-standard-or-long", label: "DTE 30から90日、または150から180日", value: evaluation.dte, min: 30, max: 180, passed: isStandardOrLongDte(evaluation.dte) },
    ],
  };
}

export function buildSyntheticForwardReviewPayload(input: SyntheticForwardEvaluationInput & {
  generatedAt: string;
  appVersion: string;
  userStrategyAssumptions?: string[];
  dataQualityNotes?: string[];
}): ExternalReviewPayload {
  const evaluation = evaluateSyntheticForwardCandidate(input);
  return createExternalReviewPayload({
    generatedAt: input.generatedAt,
    appVersion: input.appVersion,
    candidate: input.candidate,
    strategyFitResults: [buildSyntheticForwardStrategyFitResult(evaluation)],
    syntheticForwardCandidates: [evaluation],
    userStrategyAssumptions: input.userStrategyAssumptions,
    dataQualityNotes: input.dataQualityNotes,
  });
}
