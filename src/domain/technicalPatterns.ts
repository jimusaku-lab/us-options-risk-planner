import { createExternalReviewPayload } from "@/domain/screeningReviewPayload";
import { evaluateStrategyFit } from "@/domain/screeningRules";
import type {
  ExternalReviewPayload,
  MovingAverageSlopes,
  OptionComboMode,
  ScreeningCandidate,
  StrategyCandidateInput,
  StrategyFitLevel,
  StrategyFitResult,
  TechnicalSignalEvent,
  TechnicalSignalEventType,
  TechnicalTimingPattern,
  UpsideReversalComboTiming,
} from "@/types/screening";

export const upsideReversalComboKind = "upside_reversal_combo" as const;
export const upsideReversalComboDisplayName = "上昇転換コンボ候補";

type UpsideReversalComboEvaluationInput = {
  candidate: ScreeningCandidate;
  detectedAt: string;
  comboModes?: OptionComboMode[];
  maxMa25Ma50DistancePct?: number;
  maxChaseDistanceFromMa25Pct?: number;
};

type UpsideReversalComboEvaluation = {
  kind: typeof upsideReversalComboKind;
  fitLevel: StrategyFitLevel;
  signalOrder: TechnicalSignalEventType[];
  suggestedStrategyKinds: ["long_call", "cash_secured_put_buy_to_own", "combo"];
  comboModes: OptionComboMode[];
  reasons: string[];
  warnings: string[];
  missingFields: string[];
  strategyFitResults: StrategyFitResult[];
  timing: UpsideReversalComboTiming;
};

type UpsideReversalComboReadiness = {
  readiness: UpsideReversalComboTiming["optionComboReadiness"];
  strategyFitResults: StrategyFitResult[];
  reasons: string[];
  warnings: string[];
  missingFields: string[];
  avoidReasons: string[];
};

const defaultComboModes: OptionComboMode[] = ["school_same_expiry", "practical_split_expiry"];
const signalSequence: TechnicalSignalEventType[] = ["slowkd_golden_cross", "macd_golden_cross", "ma25_50_golden_cross"];

function sortEvents(events: TechnicalSignalEvent[]): TechnicalSignalEvent[] {
  return [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
}

function firstEvent(events: TechnicalSignalEvent[], type: TechnicalSignalEventType): TechnicalSignalEvent | undefined {
  return sortEvents(events).find((event) => event.type === type);
}

function hasOrderedEvents(events: TechnicalSignalEvent[], first: TechnicalSignalEventType, second: TechnicalSignalEventType): boolean {
  const firstMatch = firstEvent(events, first);
  const secondMatch = firstEvent(events, second);
  if (!firstMatch || !secondMatch) return false;
  return Date.parse(firstMatch.occurredAt) <= Date.parse(secondMatch.occurredAt);
}

function compactUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function isFiniteNumber(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function percentDistance(numerator: number | undefined, denominator: number | undefined): number | undefined {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator) || denominator === 0) return undefined;
  return ((numerator - denominator) / denominator) * 100;
}

function deriveMovingAverageSlopes(candidate: ScreeningCandidate): MovingAverageSlopes {
  const slopes = candidate.technicalSnapshot.movingAverageSlopes;
  return {
    ma25: slopes?.ma25 ?? "unknown",
    ma50: slopes?.ma50 ?? "unknown",
    ma200: slopes?.ma200 ?? "unknown",
  };
}

function findStrategy(candidate: ScreeningCandidate, strategy: StrategyCandidateInput["strategy"]): StrategyCandidateInput | undefined {
  return candidate.candidateStrategies.find((input) => input.strategy === strategy);
}

function hasBadLiquidity(candidate: ScreeningCandidate): boolean {
  const quality = candidate.optionChainQuality;
  return (
    (isFiniteNumber(quality.bidAskSpreadRate) && quality.bidAskSpreadRate > 0.35) ||
    (isFiniteNumber(quality.volume) && quality.volume < 10) ||
    (isFiniteNumber(quality.openInterest) && quality.openInterest < 20)
  );
}

function hasLiquidityWarning(candidate: ScreeningCandidate): boolean {
  const quality = candidate.optionChainQuality;
  return (
    quality.qualityWarnings.length > 0 ||
    (isFiniteNumber(quality.bidAskSpreadRate) && quality.bidAskSpreadRate > 0.2) ||
    (isFiniteNumber(quality.volume) && quality.volume < 50) ||
    (isFiniteNumber(quality.openInterest) && quality.openInterest < 100)
  );
}

export function validateUpsideReversalComboReadiness(input: {
  candidate: ScreeningCandidate;
  comboModes?: OptionComboMode[];
}): UpsideReversalComboReadiness {
  const { candidate } = input;
  const modes = input.comboModes?.length ? input.comboModes : defaultComboModes;
  const longCall = findStrategy(candidate, "long_call");
  const buyToOwnPut = findStrategy(candidate, "cash_secured_put_buy_to_own");
  const strategyFitResults = [longCall, buyToOwnPut]
    .filter((strategy): strategy is StrategyCandidateInput => Boolean(strategy))
    .map((strategy) => evaluateStrategyFit(candidate, strategy));
  const longCallResult = strategyFitResults.find((result) => result.strategy === "long_call");
  const putResult = strategyFitResults.find((result) => result.strategy === "cash_secured_put_buy_to_own");
  const missingFields: string[] = [];
  const warnings: string[] = [];
  const reasons: string[] = [];
  const avoidReasons: string[] = [];

  if (!longCall) missingFields.push("candidateStrategies.long_call");
  if (!buyToOwnPut) missingFields.push("candidateStrategies.cash_secured_put_buy_to_own");
  if (!candidate.optionChainQuality.hasOptionChain) missingFields.push("optionChainQuality.hasOptionChain");

  const longCallReady = longCallResult?.fitLevel === "fit";
  const buyToOwnPutReady = putResult?.fitLevel === "fit";
  if (longCallReady) reasons.push("ロングコール条件が単独戦術の目安に入っています。");
  if (buyToOwnPutReady) reasons.push("P売り条件が単独戦術の目安に入っています。");
  if (longCallResult && longCallResult.fitLevel !== "fit") warnings.push("ロングコール条件は要確認です。");
  if (putResult && putResult.fitLevel !== "fit") warnings.push("P売り条件は要確認です。");

  const longTermHoldEligible = buyToOwnPut?.longTermHoldEligible;
  if (longTermHoldEligible === false) avoidReasons.push("100株取得前提にできない銘柄です。");
  if (longTermHoldEligible === undefined && buyToOwnPut) warnings.push("100株取得前提にできるか未確認です。");

  const assignmentCapitalSufficient =
    buyToOwnPut?.availableCash !== undefined && buyToOwnPut.assignmentCapitalRequired !== undefined
      ? buyToOwnPut.availableCash >= buyToOwnPut.assignmentCapitalRequired
      : undefined;
  if (assignmentCapitalSufficient === false) avoidReasons.push("P売り権利行使時の資金が不足しています。");
  if (assignmentCapitalSufficient === undefined && buyToOwnPut) warnings.push("P売り権利行使時の資金確認が未完了です。");

  const liquidityOk = candidate.optionChainQuality.hasOptionChain && !hasBadLiquidity(candidate);
  if (hasBadLiquidity(candidate)) avoidReasons.push("オプション流動性が低すぎます。");
  if (!hasBadLiquidity(candidate) && hasLiquidityWarning(candidate)) warnings.push("流動性注意です。");

  return {
    readiness: {
      modes,
      longCallReady,
      buyToOwnPutReady,
      longTermHoldEligible,
      assignmentCapitalSufficient,
      liquidityOk,
      eventRiskOk: candidate.riskFlags.length === 0 ? true : undefined,
      notes: compactUnique([...candidate.optionChainQuality.qualityWarnings, ...candidate.riskFlags]),
    },
    strategyFitResults,
    reasons,
    warnings: compactUnique(warnings),
    missingFields: compactUnique(missingFields),
    avoidReasons: compactUnique(avoidReasons),
  };
}

export function evaluateUpsideReversalComboTiming(input: UpsideReversalComboEvaluationInput): UpsideReversalComboEvaluation {
  const { candidate } = input;
  const snapshot = candidate.technicalSnapshot;
  const comboModes = input.comboModes?.length ? input.comboModes : defaultComboModes;
  const maxMaDistancePct = input.maxMa25Ma50DistancePct ?? 2;
  const maxChaseDistancePct = input.maxChaseDistanceFromMa25Pct ?? 12;
  const events = snapshot.signalEvents ?? [];
  const sortedRelevantEvents = sortEvents(events).filter((event) => signalSequence.includes(event.type));
  const signalOrder = sortedRelevantEvents.map((event) => event.type);
  const slowKd = firstEvent(events, "slowkd_golden_cross");
  const macd = firstEvent(events, "macd_golden_cross");
  const maCross = firstEvent(events, "ma25_50_golden_cross");
  const ma25Ma50DistancePct = percentDistance(snapshot.sma25, snapshot.sma50);
  const crossNear = ma25Ma50DistancePct !== undefined && Math.abs(ma25Ma50DistancePct) <= maxMaDistancePct;
  const movingAverageSlopes = deriveMovingAverageSlopes(candidate);
  const priceLocation = {
    aboveMa25: isFiniteNumber(snapshot.dailyClose) && isFiniteNumber(snapshot.sma25) ? snapshot.dailyClose >= snapshot.sma25 : undefined,
    aboveMa50: isFiniteNumber(snapshot.dailyClose) && isFiniteNumber(snapshot.sma50) ? snapshot.dailyClose >= snapshot.sma50 : undefined,
    aboveMa200: isFiniteNumber(snapshot.dailyClose) && isFiniteNumber(snapshot.sma200) ? snapshot.dailyClose >= snapshot.sma200 : undefined,
    distanceFromMa25Pct: percentDistance(snapshot.dailyClose, snapshot.sma25),
    distanceFromMa50Pct: percentDistance(snapshot.dailyClose, snapshot.sma50),
  };
  const readiness = validateUpsideReversalComboReadiness({ candidate, comboModes });
  const reasons: string[] = [...readiness.reasons];
  const warnings: string[] = [...readiness.warnings];
  const missingFields: string[] = [...readiness.missingFields];
  const avoidReasons: string[] = [...readiness.avoidReasons];

  if (!isFiniteNumber(snapshot.dailyClose)) missingFields.push("technicalSnapshot.dailyClose");
  if (!isFiniteNumber(snapshot.sma25)) missingFields.push("technicalSnapshot.sma25");
  if (!isFiniteNumber(snapshot.sma50)) missingFields.push("technicalSnapshot.sma50");
  if (!slowKd) missingFields.push("technicalSnapshot.signalEvents.slowkd_golden_cross");
  if (!macd) missingFields.push("technicalSnapshot.signalEvents.macd_golden_cross");
  if (events.length === 0) missingFields.push("technicalSnapshot.signalEvents");

  if (slowKd && macd && hasOrderedEvents(events, "slowkd_golden_cross", "macd_golden_cross")) {
    reasons.push("SlowKDからMACDの順で上昇転換シグナルを確認できます。");
  } else if (slowKd && macd) {
    warnings.push("SlowKDとMACDの順序が逆転しています。");
  }

  if (maCross) {
    reasons.push("25日線と50日線のクロス成立を確認できます。");
  } else if (crossNear) {
    reasons.push("25日線と50日線が接近しています。");
  } else {
    warnings.push("25日線と50日線はまだ接近していません。");
  }

  if (movingAverageSlopes.ma50 === "down") {
    avoidReasons.push("50日線が下向きです。");
  } else if (movingAverageSlopes.ma50 === "flat") {
    warnings.push("50日線は横ばいのため要確認です。");
  } else if (movingAverageSlopes.ma50 === "up") {
    reasons.push("50日線は上向きです。");
  } else {
    missingFields.push("technicalSnapshot.movingAverageSlopes.ma50");
  }

  if (movingAverageSlopes.ma25 === "up") reasons.push("25日線は上向きです。");
  if (movingAverageSlopes.ma25 === "down") warnings.push("25日線が下向きです。");
  if (movingAverageSlopes.ma200 === "down") warnings.push("200日線が下向きです。");

  if (priceLocation.aboveMa25 && priceLocation.aboveMa50) {
    reasons.push("株価が25日線と50日線の上に戻っています。");
  } else if (priceLocation.aboveMa25 === false || priceLocation.aboveMa50 === false) {
    warnings.push("株価が25日線または50日線を下回っています。");
  }

  if (isFiniteNumber(priceLocation.distanceFromMa25Pct) && priceLocation.distanceFromMa25Pct > maxChaseDistancePct) {
    warnings.push("追いかけ注意です。");
  }

  const allRequiredSignalsReady = Boolean(slowKd && macd && hasOrderedEvents(events, "slowkd_golden_cross", "macd_golden_cross") && (maCross || crossNear));
  const priceReady = priceLocation.aboveMa25 === true && priceLocation.aboveMa50 === true;
  const trendReady = movingAverageSlopes.ma50 === "up" && movingAverageSlopes.ma25 !== "down";
  const optionReady =
    readiness.readiness.longCallReady === true &&
    readiness.readiness.buyToOwnPutReady === true &&
    readiness.readiness.longTermHoldEligible === true &&
    readiness.readiness.assignmentCapitalSufficient === true &&
    readiness.readiness.liquidityOk === true;
  const fitLevel: StrategyFitLevel =
    missingFields.length > 0
      ? "insufficient_data"
      : avoidReasons.length > 0
        ? "avoid"
        : allRequiredSignalsReady && trendReady && priceReady && optionReady && warnings.length === 0
          ? "fit"
          : "watch";

  const timing: UpsideReversalComboTiming = {
    slowKdCrossDate: slowKd?.occurredAt,
    macdCrossDate: macd?.occurredAt,
    ma25Ma50CrossDate: maCross?.occurredAt,
    ma25Ma50DistancePct,
    movingAverageSlopes,
    priceLocation,
    optionComboReadiness: readiness.readiness,
    timingNotes: compactUnique([...reasons, ...warnings, ...avoidReasons]),
  };

  return {
    kind: upsideReversalComboKind,
    fitLevel,
    signalOrder,
    suggestedStrategyKinds: ["long_call", "cash_secured_put_buy_to_own", "combo"],
    comboModes,
    reasons: compactUnique(reasons),
    warnings: compactUnique([...warnings, ...avoidReasons]),
    missingFields: compactUnique(missingFields),
    strategyFitResults: readiness.strategyFitResults,
    timing,
  };
}

export function buildUpsideReversalComboPattern(input: UpsideReversalComboEvaluationInput): TechnicalTimingPattern {
  const evaluation = evaluateUpsideReversalComboTiming(input);
  return {
    kind: evaluation.kind,
    fitLevel: evaluation.fitLevel,
    signalOrder: evaluation.signalOrder,
    reasons: evaluation.reasons,
    warnings: evaluation.warnings,
    missingFields: evaluation.missingFields,
    suggestedStrategyKinds: evaluation.suggestedStrategyKinds,
    detectedAt: input.detectedAt,
    timing: evaluation.timing,
  };
}

export function buildUpsideReversalComboReviewPayload(input: UpsideReversalComboEvaluationInput & {
  appVersion: string;
  userStrategyAssumptions?: string[];
  dataQualityNotes?: string[];
}): ExternalReviewPayload {
  const evaluation = evaluateUpsideReversalComboTiming(input);
  return createExternalReviewPayload({
    generatedAt: input.detectedAt,
    appVersion: input.appVersion,
    candidate: {
      ...input.candidate,
      technicalSnapshot: {
        ...input.candidate.technicalSnapshot,
        patternCandidates: [buildUpsideReversalComboPattern(input)],
      },
    },
    strategyFitResults: evaluation.strategyFitResults,
    technicalTimingPatterns: [buildUpsideReversalComboPattern(input)],
    userStrategyAssumptions: input.userStrategyAssumptions,
    dataQualityNotes: input.dataQualityNotes,
  });
}
