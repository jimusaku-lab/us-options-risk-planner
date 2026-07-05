import type {
  ChartAnalysisSnapshot,
  ChartConfidence,
  ChartRegime,
  ChartTimeframe,
  ChartTimeframeSnapshot,
  MovingAverageSlopeState,
  OhlcvBar,
  ScreeningDataSource,
  TechnicalSignal,
  TechnicalSnapshot,
} from "@/types/screening";

export type ChartAnalysisInput = {
  asOf?: string;
  source?: ScreeningDataSource;
  daily?: OhlcvBar[];
  weekly?: OhlcvBar[];
  monthly?: OhlcvBar[];
  technicalSnapshot?: Partial<TechnicalSnapshot>;
  eventRisk?: {
    earningsNear?: boolean;
    ivElevated?: boolean;
    notes?: string[];
  };
};

export type MacdResult = {
  macd?: number;
  signal?: number;
  histogram?: number;
};

export type SlowKdResult = {
  k?: number;
  d?: number;
};

export type ChartFinalGateResult = {
  passed: boolean;
  level: "pass" | "watch" | "blocked" | "insufficient_data";
  reasons: string[];
  warnings: string[];
  manualReviewReasons: string[];
};

export type ChartFinalGateParams = {
  direction?: "bullish" | "neutral";
  horizon?: "short" | "medium" | "long";
  maxChaseDistancePct?: number;
};

type ClassifiedRegime = {
  regime: ChartRegime;
  confidence: ChartConfidence;
  reasons: string[];
  warnings: string[];
  missingFields: string[];
};

const dailySmaPeriods = [5, 10, 20, 25, 50, 75, 100, 200] as const;
const weeklySmaPeriods = [5, 10, 13, 20, 26, 52] as const;
const monthlySmaPeriods = [5, 10, 20] as const;

export function calculateSma(values: number[], period: number): number | undefined {
  const series = calculateSmaSeries(values, period);
  return lastDefined(series);
}

export function calculateEma(values: number[], period: number): number | undefined {
  const series = calculateEmaSeries(values, period);
  return lastDefined(series);
}

export function calculateMacd(closes: number[]): MacdResult {
  const macdSeries = calculateMacdSeries(closes);
  const macd = lastDefined(macdSeries);
  const signal = lastDefined(calculateEmaSeries(macdSeries.filter(isFiniteNumber), 9));
  if (macd === undefined || signal === undefined) return { macd, signal };
  return {
    macd,
    signal,
    histogram: macd - signal,
  };
}

export function calculateRsi(closes: number[], period = 14): number | undefined {
  if (period <= 0 || closes.length < period + 1) return undefined;
  const window = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < window.length; index += 1) {
    const diff = window[index] - window[index - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const averageGain = gains / period;
  const averageLoss = losses / period;
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const rs = averageGain / averageLoss;
  return 100 - 100 / (1 + rs);
}

export function calculateSlowKd(bars: OhlcvBar[], kPeriod = 14, dPeriod = 3): SlowKdResult {
  const sortedBars = sortBars(bars);
  if (kPeriod <= 0 || dPeriod <= 0 || sortedBars.length < kPeriod) return {};
  const kSeries: number[] = [];
  for (let index = kPeriod - 1; index < sortedBars.length; index += 1) {
    const window = sortedBars.slice(index - kPeriod + 1, index + 1);
    const highs = window.map((bar) => bar.high ?? bar.close);
    const lows = window.map((bar) => bar.low ?? bar.close);
    const highest = Math.max(...highs);
    const lowest = Math.min(...lows);
    const close = sortedBars[index].close;
    kSeries.push(highest === lowest ? 50 : ((close - lowest) / (highest - lowest)) * 100);
  }
  const k = kSeries.at(-1);
  const d = kSeries.length >= dPeriod ? average(kSeries.slice(-dPeriod)) : undefined;
  return { k, d };
}

export function calculatePercentDistance(value?: number, base?: number): number | undefined {
  if (!isFiniteNumber(value) || !isFiniteNumber(base) || base === 0) return undefined;
  return ((value - base) / base) * 100;
}

export function deriveMovingAverageSlope(values: number[]): MovingAverageSlopeState {
  const finiteValues = values.filter(isFiniteNumber);
  if (finiteValues.length < 4) return "unknown";
  const latest = finiteValues.at(-1);
  const prior = finiteValues.at(Math.max(0, finiteValues.length - 6));
  if (!isFiniteNumber(latest) || !isFiniteNumber(prior) || prior === 0) return "unknown";
  const changePct = ((latest - prior) / prior) * 100;
  if (changePct > 0.35) return "up";
  if (changePct < -0.35) return "down";
  return "flat";
}

export function buildChartTimeframeSnapshot(timeframe: ChartTimeframe, bars: OhlcvBar[]): ChartTimeframeSnapshot {
  const sortedBars = sortBars(bars);
  const closes = sortedBars.map((bar) => bar.close).filter(isFiniteNumber);
  const close = closes.at(-1);
  const macd = calculateMacd(closes);
  const slowKd = calculateSlowKd(sortedBars);
  const rsi = calculateRsi(closes);
  const periodSet = periodsForTimeframe(timeframe);
  const smaByPeriod = new Map<number, number | undefined>(periodSet.map((period) => [period, calculateSma(closes, period)]));
  const smaSeriesByPeriod = new Map<number, Array<number | undefined>>(
    periodSet.map((period) => [period, calculateSmaSeries(closes, period)]),
  );
  const lookback = sortedBars.slice(-60);
  const recentHigh = lookback.length ? Math.max(...lookback.map((bar) => bar.high ?? bar.close)) : undefined;
  const recentLow = lookback.length ? Math.min(...lookback.map((bar) => bar.low ?? bar.close)) : undefined;
  const supportLevels = uniqueNumbers([
    recentLow,
    smaByPeriod.get(timeframe === "weekly" ? 13 : 25),
    smaByPeriod.get(50),
    smaByPeriod.get(200),
  ]);
  const resistanceLevels = uniqueNumbers([recentHigh, smaByPeriod.get(20), smaByPeriod.get(50)]);
  const fibonacciLevels = buildFibonacciLevels(recentHigh, recentLow);
  const notes = sortedBars.length < minimumBarsForTimeframe(timeframe) ? [`${timeframe} bars are below preferred lookback.`] : [];

  return {
    timeframe,
    close,
    sma5: smaByPeriod.get(5),
    sma10: smaByPeriod.get(10),
    sma20: smaByPeriod.get(20),
    sma13: smaByPeriod.get(13),
    sma25: smaByPeriod.get(25),
    sma26: smaByPeriod.get(26),
    sma50: smaByPeriod.get(50),
    sma52: smaByPeriod.get(52),
    sma75: smaByPeriod.get(75),
    sma100: smaByPeriod.get(100),
    sma200: smaByPeriod.get(200),
    macdSignal: technicalSignalFromMacd(macd),
    slowKdSignal: technicalSignalFromSlowKd(slowKd),
    rsi,
    macd,
    slowKd,
    movingAverageSlopes: buildSnapshotSlopes(timeframe, smaSeriesByPeriod),
    priceLocation: {
      aboveMa25: compareAbove(close, smaByPeriod.get(25)),
      aboveMa50: compareAbove(close, smaByPeriod.get(50)),
      aboveMa200: compareAbove(close, smaByPeriod.get(200)),
      distanceFromMa25Pct: calculatePercentDistance(close, smaByPeriod.get(25)),
      distanceFromMa50Pct: calculatePercentDistance(close, smaByPeriod.get(50)),
    },
    recentHigh,
    recentLow,
    supportLevels,
    resistanceLevels,
    fibonacciLevels,
    ohlcv: sortedBars,
    notes,
  };
}

export function analyzeChart(input: ChartAnalysisInput): ChartAnalysisSnapshot {
  const timeframes = [
    ...(input.monthly?.length ? [buildChartTimeframeSnapshot("monthly", input.monthly)] : []),
    ...(input.weekly?.length ? [buildChartTimeframeSnapshot("weekly", input.weekly)] : []),
    ...(input.daily?.length ? [buildChartTimeframeSnapshot("daily", input.daily)] : []),
  ];
  const withTechnicalFallback = applyTechnicalSnapshotFallback(timeframes, input.technicalSnapshot);
  const classification = classifyChartRegime(withTechnicalFallback, input);
  return {
    asOf: input.asOf,
    regime: classification.regime,
    confidence: classification.confidence,
    primaryTimeframe: "daily",
    timeframes: withTechnicalFallback,
    reasons: classification.reasons,
    warnings: [...classification.warnings, ...(input.eventRisk?.notes ?? [])],
    missingFields: classification.missingFields,
  };
}

export function evaluateChartFinalGate(
  snapshot: ChartAnalysisSnapshot,
  params: ChartFinalGateParams = {},
): ChartFinalGateResult {
  const direction = params.direction ?? "bullish";
  const horizon = params.horizon ?? "medium";
  const maxChaseDistancePct = params.maxChaseDistancePct ?? 12;
  const daily = getTimeframe(snapshot, "daily");
  const weekly = getTimeframe(snapshot, "weekly");
  const reasons: string[] = [];
  const warnings: string[] = [];
  const manualReviewReasons: string[] = [];

  if (snapshot.regime === "insufficient_data" || snapshot.confidence === "insufficient") {
    return {
      passed: false,
      level: "insufficient_data",
      reasons: [],
      warnings: snapshot.warnings,
      manualReviewReasons: ["チャート分析に必要な日足または週足データが不足しています。"],
    };
  }

  if (snapshot.regime === "bearish_breakdown" || snapshot.regime === "downtrend") {
    warnings.push("下落局面のため上昇前提の建玉案へは進めません。");
    return { passed: false, level: "blocked", reasons, warnings, manualReviewReasons };
  }

  if (direction === "bullish" && weekly?.movingAverageSlopes?.ma50 === "down") {
    warnings.push("週足50本線が下向きです。");
  } else if (weekly?.movingAverageSlopes?.ma50 === "up") {
    reasons.push("週足50本線が上向きです。");
  } else if (horizon !== "short") {
    manualReviewReasons.push("30-90日以上の判断には週足方向感の確認が必要です。");
  }

  const chaseDistance = daily?.priceLocation?.distanceFromMa25Pct ?? daily?.priceLocation?.distanceFromMa50Pct;
  if (isFiniteNumber(chaseDistance) && chaseDistance > maxChaseDistancePct) {
    warnings.push("株価が主要移動平均線から離れており、高値追い注意です。");
  }

  if (daily && isFiniteNumber(daily.close) && isFiniteNumber(daily.recentLow) && daily.close < daily.recentLow * 1.01) {
    warnings.push("直近安値またはサポート近辺です。割れ込み確認が必要です。");
  }

  if (snapshot.regime === "event_large_move_unknown") {
    manualReviewReasons.push("イベントまたはIV上昇により方向判定を手動確認してください。");
  }

  const level: ChartFinalGateResult["level"] =
    warnings.some((warning) => warning.includes("週足50本線が下向き"))
      ? "watch"
      : warnings.length > 0 || manualReviewReasons.length > 0 || snapshot.confidence === "low"
        ? "watch"
        : "pass";
  return {
    passed: level === "pass",
    level,
    reasons: reasons.length ? reasons : snapshot.reasons,
    warnings,
    manualReviewReasons,
  };
}

function classifyChartRegime(timeframes: ChartTimeframeSnapshot[], input: ChartAnalysisInput): ClassifiedRegime {
  const daily = getTimeframeFromList(timeframes, "daily");
  const weekly = getTimeframeFromList(timeframes, "weekly");
  const reasons: string[] = [];
  const warnings: string[] = [];
  const missingFields: string[] = [];

  if (input.eventRisk?.earningsNear || input.eventRisk?.ivElevated) {
    return {
      regime: "event_large_move_unknown",
      confidence: daily ? "low" : "insufficient",
      reasons: ["イベントまたはIV上昇があり、方向を決め打ちしません。"],
      warnings: ["イベント大変動注意です。"],
      missingFields: daily ? [] : ["daily"],
    };
  }

  if (!daily || daily.close === undefined) {
    return {
      regime: "insufficient_data",
      confidence: "insufficient",
      reasons: [],
      warnings: ["日足データが不足しています。"],
      missingFields: ["daily.ohlcv"],
    };
  }

  const dailyAbove25 = daily.priceLocation?.aboveMa25 === true;
  const dailyAbove50 = daily.priceLocation?.aboveMa50 === true;
  const dailyBelow50 = daily.priceLocation?.aboveMa50 === false;
  const dailyBelow200 = daily.priceLocation?.aboveMa200 === false;
  const ma50Slope = daily.movingAverageSlopes?.ma50 ?? "unknown";
  const ma25Slope = daily.movingAverageSlopes?.ma25 ?? "unknown";
  const weeklySlope = fallbackSlope(weekly?.movingAverageSlopes?.ma50, weekly?.movingAverageSlopes?.ma25);
  const macdImproving = daily.macdSignal === "bullish" || (isFiniteNumber(daily.macd?.histogram) && daily.macd.histogram > 0);
  const slowKdImproving = daily.slowKdSignal === "bullish" || (isFiniteNumber(daily.slowKd?.k) && daily.slowKd.k > 55);
  const nearSupport = isNearAnyLevel(daily.close, [
    daily.sma25,
    daily.sma50,
    daily.fibonacciLevels?.retracement382,
    daily.fibonacciLevels?.retracement500,
    daily.fibonacciLevels?.retracement618,
    ...(daily.supportLevels ?? []),
  ], 5);
  const shortAverageAboveMedium = isFiniteNumber(daily.sma25) && isFiniteNumber(daily.sma50) ? daily.sma25 >= daily.sma50 : undefined;
  const mediumAverageBelowLong = isFiniteNumber(daily.sma50) && isFiniteNumber(daily.sma200) ? daily.sma50 < daily.sma200 : undefined;
  const nearHigh = isFiniteNumber(daily.recentHigh) && daily.close >= daily.recentHigh * 0.98;
  const recentLowBreak = isFiniteNumber(daily.recentLow) && daily.close < daily.recentLow * 0.99;

  if (dailyBelow50 && ma50Slope === "down" && (recentLowBreak || dailyBelow200)) {
    reasons.push("株価が50日線を下回り、50日線も下向きです。");
    if (dailyBelow200) reasons.push("株価が200日線も下回っています。");
    return { regime: recentLowBreak ? "bearish_breakdown" : "downtrend", confidence: "medium", reasons, warnings, missingFields };
  }

  if ((dailyAbove25 || dailyAbove50) && (macdImproving || slowKdImproving) && ma25Slope !== "down" && (shortAverageAboveMedium === false || mediumAverageBelowLong === true)) {
    reasons.push("株価が短中期移動平均線を回復し、MACDまたはSlowKDが改善しています。");
    if (ma50Slope === "down") warnings.push("50日線はまだ下向きのため転換初動は要確認です。");
    return {
      regime: "upside_reversal",
      confidence: ma50Slope === "down" ? "low" : "medium",
      reasons,
      warnings,
      missingFields,
    };
  }

  if (dailyAbove25 && dailyAbove50 && ma50Slope === "up" && weeklySlope !== "down" && macdImproving) {
    reasons.push("株価が25日線/50日線を上回り、50日線が上向きです。");
    if (weeklySlope === "up") reasons.push("週足方向感も上向きです。");
    if (nearHigh) warnings.push("直近高値圏のため高値追い注意です。");
    return {
      regime: "bullish_continuation",
      confidence: weeklySlope === "up" ? "high" : "medium",
      reasons,
      warnings,
      missingFields,
    };
  }

  if ((dailyAbove25 || dailyAbove50) && (macdImproving || slowKdImproving) && ma25Slope !== "down") {
    reasons.push("株価が短中期移動平均線を回復し、MACDまたはSlowKDが改善しています。");
    if (ma50Slope === "down") warnings.push("50日線はまだ下向きのため転換初動は要確認です。");
    return {
      regime: "upside_reversal",
      confidence: ma50Slope === "down" ? "low" : "medium",
      reasons,
      warnings,
      missingFields,
    };
  }

  if ((weeklySlope === "up" || ma50Slope === "up") && (nearSupport || dailyBelow50 || ma25Slope === "down") && !recentLowBreak) {
    reasons.push("上昇基調を保ちながら主要サポートまたはフィボナッチ近辺まで押しています。");
    return {
      regime: "bullish_pullback",
      confidence: weeklySlope === "up" ? "medium" : "low",
      reasons,
      warnings,
      missingFields,
    };
  }

  if (ma50Slope === "flat" && isFiniteNumber(daily.rsi) && daily.rsi > 35 && daily.rsi < 65 && !recentLowBreak && !nearHigh) {
    reasons.push("50日線が横ばいで、RSIも極端ではありません。");
    return { regime: "range_neutral", confidence: "medium", reasons, warnings, missingFields };
  }

  if (dailyBelow50 && ma50Slope === "down") {
    reasons.push("株価が50日線を下回り、50日線が下向きです。");
    return { regime: "downtrend", confidence: "medium", reasons, warnings, missingFields };
  }

  warnings.push("明確な局面分類には追加確認が必要です。");
  return { regime: "range_neutral", confidence: "low", reasons, warnings, missingFields };
}

function calculateSmaSeries(values: number[], period: number): Array<number | undefined> {
  if (period <= 0) return values.map(() => undefined);
  return values.map((_, index) => {
    if (index + 1 < period) return undefined;
    return average(values.slice(index + 1 - period, index + 1));
  });
}

function calculateEmaSeries(values: number[], period: number): Array<number | undefined> {
  if (period <= 0 || values.length < period) return values.map(() => undefined);
  const multiplier = 2 / (period + 1);
  const series: Array<number | undefined> = values.map(() => undefined);
  let previous = average(values.slice(0, period));
  series[period - 1] = previous;
  for (let index = period; index < values.length; index += 1) {
    previous = (values[index] - previous) * multiplier + previous;
    series[index] = previous;
  }
  return series;
}

function calculateMacdSeries(closes: number[]): Array<number | undefined> {
  const ema12 = calculateEmaSeries(closes, 12);
  const ema26 = calculateEmaSeries(closes, 26);
  return closes.map((_, index) => {
    const fast = ema12[index];
    const slow = ema26[index];
    return fast !== undefined && slow !== undefined ? fast - slow : undefined;
  });
}

function applyTechnicalSnapshotFallback(
  timeframes: ChartTimeframeSnapshot[],
  technicalSnapshot?: Partial<TechnicalSnapshot>,
): ChartTimeframeSnapshot[] {
  if (!technicalSnapshot) return timeframes;
  const existingDaily = getTimeframeFromList(timeframes, "daily");
  const fallbackDaily: ChartTimeframeSnapshot = {
    timeframe: "daily",
    close: existingDaily?.close ?? technicalSnapshot.dailyClose,
    sma5: existingDaily?.sma5 ?? technicalSnapshot.sma5,
    sma10: existingDaily?.sma10 ?? technicalSnapshot.sma10,
    sma25: existingDaily?.sma25 ?? technicalSnapshot.sma25,
    sma50: existingDaily?.sma50 ?? technicalSnapshot.sma50,
    sma75: existingDaily?.sma75 ?? technicalSnapshot.sma75,
    sma100: existingDaily?.sma100 ?? technicalSnapshot.sma100,
    sma200: existingDaily?.sma200 ?? technicalSnapshot.sma200,
    macdSignal: existingDaily?.macdSignal ?? technicalSnapshot.macdSignal,
    slowKdSignal: existingDaily?.slowKdSignal ?? technicalSnapshot.slowKdSignal,
    rsi: existingDaily?.rsi ?? technicalSnapshot.rsi,
    movingAverageSlopes: existingDaily?.movingAverageSlopes ?? technicalSnapshot.movingAverageSlopes,
    priceLocation: {
      aboveMa25: compareAbove(technicalSnapshot.dailyClose, technicalSnapshot.sma25),
      aboveMa50: compareAbove(technicalSnapshot.dailyClose, technicalSnapshot.sma50),
      aboveMa200: compareAbove(technicalSnapshot.dailyClose, technicalSnapshot.sma200),
      distanceFromMa25Pct: calculatePercentDistance(technicalSnapshot.dailyClose, technicalSnapshot.sma25),
      distanceFromMa50Pct: calculatePercentDistance(technicalSnapshot.dailyClose, technicalSnapshot.sma50),
    },
    notes: technicalSnapshot.trendNotes,
  };
  if (existingDaily) {
    return timeframes.map((timeframe) => (timeframe.timeframe === "daily" ? { ...fallbackDaily, ...timeframe } : timeframe));
  }
  return [...timeframes, fallbackDaily];
}

function periodsForTimeframe(timeframe: ChartTimeframe): readonly number[] {
  if (timeframe === "daily") return dailySmaPeriods;
  if (timeframe === "weekly") return weeklySmaPeriods;
  return monthlySmaPeriods;
}

function buildSnapshotSlopes(
  timeframe: ChartTimeframe,
  smaSeriesByPeriod: Map<number, Array<number | undefined>>,
): ChartTimeframeSnapshot["movingAverageSlopes"] {
  const periods =
    timeframe === "weekly"
      ? { ma25: 13, ma50: 26, ma200: 52 }
      : timeframe === "monthly"
        ? { ma25: 5, ma50: 10, ma200: 20 }
        : { ma25: 25, ma50: 50, ma200: 200 };
  return {
    ma25: deriveMovingAverageSlope(smaSeriesByPeriod.get(periods.ma25)?.filter(isFiniteNumber) ?? []),
    ma50: deriveMovingAverageSlope(smaSeriesByPeriod.get(periods.ma50)?.filter(isFiniteNumber) ?? []),
    ma200: deriveMovingAverageSlope(smaSeriesByPeriod.get(periods.ma200)?.filter(isFiniteNumber) ?? []),
  };
}

function minimumBarsForTimeframe(timeframe: ChartTimeframe): number {
  if (timeframe === "daily") return 120;
  if (timeframe === "weekly") return 52;
  return 20;
}

function buildFibonacciLevels(high?: number, low?: number): ChartTimeframeSnapshot["fibonacciLevels"] {
  if (!isFiniteNumber(high) || !isFiniteNumber(low) || high <= low) return undefined;
  const range = high - low;
  return {
    high,
    low,
    retracement382: high - range * 0.382,
    retracement500: high - range * 0.5,
    retracement618: high - range * 0.618,
  };
}

function technicalSignalFromMacd(macd: MacdResult): TechnicalSignal {
  if (!isFiniteNumber(macd.macd) || !isFiniteNumber(macd.signal)) return "unknown";
  if (macd.macd > macd.signal && (macd.histogram ?? 0) >= 0) return "bullish";
  if (macd.macd < macd.signal && (macd.histogram ?? 0) <= 0) return "bearish";
  return "neutral";
}

function technicalSignalFromSlowKd(slowKd: SlowKdResult): TechnicalSignal {
  if (!isFiniteNumber(slowKd.k) || !isFiniteNumber(slowKd.d)) return "unknown";
  if (slowKd.k > slowKd.d) return "bullish";
  if (slowKd.k < slowKd.d) return "bearish";
  return "neutral";
}

function getTimeframe(snapshot: ChartAnalysisSnapshot, timeframe: ChartTimeframe): ChartTimeframeSnapshot | undefined {
  return getTimeframeFromList(snapshot.timeframes, timeframe);
}

function getTimeframeFromList(timeframes: ChartTimeframeSnapshot[], timeframe: ChartTimeframe): ChartTimeframeSnapshot | undefined {
  return timeframes.find((item) => item.timeframe === timeframe);
}

function compareAbove(value?: number, base?: number): boolean | undefined {
  if (!isFiniteNumber(value) || !isFiniteNumber(base)) return undefined;
  return value >= base;
}

function isNearAnyLevel(value: number, levels: Array<number | undefined>, tolerancePct = 3): boolean {
  return levels.some((level) => {
    if (!isFiniteNumber(level) || level === 0) return false;
    return Math.abs(((value - level) / level) * 100) <= tolerancePct;
  });
}

function fallbackSlope(...slopes: Array<MovingAverageSlopeState | undefined>): MovingAverageSlopeState {
  return slopes.find((slope) => slope && slope !== "unknown") ?? "unknown";
}

function sortBars(bars: OhlcvBar[]): OhlcvBar[] {
  return [...bars]
    .filter((bar) => isFiniteNumber(bar.close))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function lastDefined(values: Array<number | undefined>): number | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] !== undefined) return values[index];
  }
  return undefined;
}

function uniqueNumbers(values: Array<number | undefined>): number[] {
  return Array.from(new Set(values.filter(isFiniteNumber).map((value) => Number(value.toFixed(4)))));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
