import { describe, expect, it } from "vitest";
import type { OhlcvBar } from "@/types/screening";
import {
  analyzeChart,
  buildChartTimeframeSnapshot,
  calculateEma,
  calculateMacd,
  calculatePercentDistance,
  calculateRsi,
  calculateSlowKd,
  calculateSma,
  deriveMovingAverageSlope,
  evaluateChartFinalGate,
} from "./chartAnalysis";

describe("chart indicator calculations", () => {
  it("calculates SMA and returns undefined when lookback is insufficient", () => {
    expect(calculateSma([1, 2, 3, 4, 5], 3)).toBe(4);
    expect(calculateSma([1, 2], 3)).toBeUndefined();
  });

  it("calculates EMA MACD RSI and SlowKD within sane bounds", () => {
    const bars = makeTrendBars(80, 100, 0.8);
    const closes = bars.map((bar) => bar.close);
    const ema = calculateEma(closes, 12);
    const macd = calculateMacd(closes);
    const rsi = calculateRsi(closes);
    const slowKd = calculateSlowKd(bars);

    expect(ema).toBeGreaterThan(100);
    expect(macd.macd).toBeTypeOf("number");
    expect(macd.signal).toBeTypeOf("number");
    expect(macd.histogram).toBeTypeOf("number");
    expect(rsi).toBeGreaterThanOrEqual(0);
    expect(rsi).toBeLessThanOrEqual(100);
    expect(slowKd.k).toBeGreaterThanOrEqual(0);
    expect(slowKd.k).toBeLessThanOrEqual(100);
    expect(slowKd.d).toBeGreaterThanOrEqual(0);
    expect(slowKd.d).toBeLessThanOrEqual(100);
  });

  it("derives moving average slope states and percent distance", () => {
    expect(deriveMovingAverageSlope([1, 2, 3, 4, 5, 6])).toBe("up");
    expect(deriveMovingAverageSlope([6, 5, 4, 3, 2, 1])).toBe("down");
    expect(deriveMovingAverageSlope([10, 10.01, 10, 10.02, 10.01, 10])).toBe("flat");
    expect(deriveMovingAverageSlope([1, 2, 3])).toBe("unknown");
    expect(calculatePercentDistance(110, 100)).toBe(10);
  });

  it("builds timeframe snapshot with support resistance and fibonacci references", () => {
    const snapshot = buildChartTimeframeSnapshot("daily", makeTrendBars(220, 100, 0.5));

    expect(snapshot.sma5).toBeTypeOf("number");
    expect(snapshot.sma20).toBeTypeOf("number");
    expect(snapshot.sma200).toBeTypeOf("number");
    expect(snapshot.recentHigh).toBeGreaterThan(snapshot.recentLow ?? 0);
    expect(snapshot.supportLevels?.length).toBeGreaterThan(0);
    expect(snapshot.resistanceLevels?.length).toBeGreaterThan(0);
    expect(snapshot.fibonacciLevels?.retracement382).toBeTypeOf("number");
  });
});

describe("chart regime classification", () => {
  it("classifies strong bullish continuation", () => {
    const snapshot = analyzeChart({
      daily: makeTrendBars(240, 100, 0.6),
      weekly: makeTrendBars(80, 80, 1.4, "2024-01-05"),
      monthly: makeTrendBars(36, 60, 2, "2023-01-31"),
    });

    expect(snapshot.regime).toBe("bullish_continuation");
    expect(snapshot.confidence).toBe("high");
    expect(snapshot.reasons.length).toBeGreaterThan(0);
  });

  it("classifies upside reversal", () => {
    const snapshot = analyzeChart({
      daily: [...makeTrendBars(95, 220, -0.9), ...makeTrendBars(35, 136, 1.0, "2026-04-06")],
      weekly: makeTrendBars(80, 160, -0.2, "2024-01-05"),
    });

    expect(snapshot.regime).toBe("upside_reversal");
    expect(snapshot.reasons.join(" ")).toContain("回復");
  });

  it("classifies bullish pullback", () => {
    const uptrend = makeTrendBars(180, 100, 0.7);
    const lastClose = uptrend.at(-1)?.close ?? 220;
    const pullback = makeTrendBars(20, lastClose, -0.9, "2026-06-30");
    const snapshot = analyzeChart({
      daily: [...uptrend, ...pullback],
      weekly: makeTrendBars(80, 80, 1.3, "2024-01-05"),
    });

    expect(snapshot.regime).toBe("bullish_pullback");
  });

  it("classifies range neutral", () => {
    const snapshot = analyzeChart({
      daily: makeWaveBars(180, 100, 2),
      weekly: makeWaveBars(80, 100, 1.5, "2024-01-05"),
    });

    expect(snapshot.regime).toBe("range_neutral");
  });

  it("classifies downtrend or bearish breakdown", () => {
    const snapshot = analyzeChart({
      daily: makeTrendBars(240, 220, -0.65),
      weekly: makeTrendBars(80, 180, -1.1, "2024-01-05"),
    });

    expect(["downtrend", "bearish_breakdown"]).toContain(snapshot.regime);
  });

  it("classifies event large move unknown", () => {
    const snapshot = analyzeChart({
      daily: makeTrendBars(120, 100, 0.1),
      eventRisk: {
        earningsNear: true,
        notes: ["決算接近"],
      },
    });

    expect(snapshot.regime).toBe("event_large_move_unknown");
    expect(snapshot.warnings.join(" ")).toContain("イベント");
  });

  it("classifies insufficient data", () => {
    const snapshot = analyzeChart({});

    expect(snapshot.regime).toBe("insufficient_data");
    expect(snapshot.confidence).toBe("insufficient");
    expect(snapshot.missingFields).toContain("daily.ohlcv");
  });
});

describe("chart final gate", () => {
  it("keeps bullish gate at watch or below when weekly trend is strongly down", () => {
    const snapshot = analyzeChart({
      daily: [...makeTrendBars(95, 220, -0.9), ...makeTrendBars(35, 136, 1.0, "2026-04-06")],
      weekly: makeTrendBars(80, 220, -1.5, "2024-01-05"),
    });
    const gate = evaluateChartFinalGate(snapshot, { horizon: "medium" });

    expect(["watch", "blocked", "insufficient_data"]).toContain(gate.level);
    expect(gate.passed).toBe(false);
  });

  it("marks chasing recent highs as watch", () => {
    const snapshot = analyzeChart({
      daily: makeSurgeBars(),
      weekly: makeTrendBars(80, 80, 1.2, "2024-01-05"),
    });
    const gate = evaluateChartFinalGate(snapshot, { maxChaseDistancePct: 8 });

    expect(gate.level).toBe("watch");
    expect(gate.warnings.join(" ")).toContain("高値追い");
  });
});

function makeTrendBars(count: number, start: number, step: number, startDate = "2026-01-01"): OhlcvBar[] {
  const startTime = Date.parse(startDate);
  return Array.from({ length: count }, (_, index) => {
    const close = round(start + step * index);
    return {
      date: new Date(startTime + index * 86_400_000).toISOString().slice(0, 10),
      open: round(close - step * 0.25),
      high: round(close + Math.max(1, Math.abs(step) * 1.8)),
      low: round(close - Math.max(1, Math.abs(step) * 1.8)),
      close,
      volume: 1_000_000 + index,
    };
  });
}

function makeWaveBars(count: number, center: number, amplitude: number, startDate = "2026-01-01"): OhlcvBar[] {
  const startTime = Date.parse(startDate);
  return Array.from({ length: count }, (_, index) => {
    const close = round(center + Math.sin(index / 5) * amplitude);
    return {
      date: new Date(startTime + index * 86_400_000).toISOString().slice(0, 10),
      open: round(close - 0.2),
      high: round(close + 1),
      low: round(close - 1),
      close,
      volume: 900_000 + index,
    };
  });
}

function makeSurgeBars(): OhlcvBar[] {
  const base = makeTrendBars(210, 100, 0.25);
  const lastClose = base.at(-1)?.close ?? 152;
  return [...base, ...makeTrendBars(20, lastClose + 8, 1.7, "2026-07-30")];
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
