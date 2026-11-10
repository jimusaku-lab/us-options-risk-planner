import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import type { OptionLeg, TradeSimulation } from "@/types/domain";
import { calculateAccountExpiryPayoff, getExpiryBreakevenMoves } from "./accountExpiryPayoff";

const expiry = "2027-01-15";
const long: OptionLeg = { id: "long", type: "call", side: "buy", strikeUSD: 100, premiumUSD: 6, contractSize: 100, quantity: 1, expiryDate: expiry };
const short: OptionLeg = { ...long, id: "short", side: "sell", strikeUSD: 120, premiumUSD: 1.35 };
function fixture(legs = [long, short]): TradeSimulation {
  return {
    ...sampleAmznSimulation, id: "test-spread", status: "open", strategyType: "bull_call_spread",
    ticker: "TEST", accountCurrency: "USD", accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT",
    currentPriceUSD: 101.67, expiryDate: expiry, stockPosition: null,
    optionLegs: legs, optionCloseExecutions: [],
    optionEntryExecutions: legs.map((leg) => ({
      id: `fill-${leg.id}`, legId: leg.id, contracts: leg.quantity, fillPriceUSD: leg.premiumUSD,
      commissionUSD: 2.5, settlementCurrency: "USD", tradeDate: "2026-11-02", source: "manual", confirmed: true,
    })),
  };
}

describe("account expiry payoff", () => {
  it("matches the two-leg example and marks current price without using current option quotes", () => {
    const result = calculateAccountExpiryPayoff(fixture());
    expect(result).toMatchObject({ kind: "available", currency: "USD", maxLoss: -470, maxProfit: 1530, breakevens: [104.7], spot: 101.67 });
    if (result.kind !== "available") throw new Error(result.reason);
    expect(result.atPrice(result.spot!)).toBeCloseTo(-303);
    expect(result.atPrice(result.breakevens[0])).toBeCloseTo(0);
    expect(result.atPrice(200)).toBe(1530);
  });

  it("derives the range from the net strategy slope, including unbounded tails and finite put risk", () => {
    expect(calculateAccountExpiryPayoff(fixture([long]))).toMatchObject({ maxProfit: Infinity, maxLoss: -602.5 });
    expect(calculateAccountExpiryPayoff(fixture([short]))).toMatchObject({ maxProfit: 132.5, maxLoss: -Infinity });
    expect(calculateAccountExpiryPayoff(fixture([{ ...long, type: "put", side: "sell" }]))).toMatchObject({
      maxProfit: 597.5, maxLoss: -9402.5, breakevens: [94.025],
    });
  });

  it("uses the signed opening yen booking and fixed saved FX without deducting fees again", () => {
    const s = fixture();
    s.accountCurrency = "JPY";
    s.referenceFxRateJPY = 150;
    s.optionEntryExecutions = s.optionEntryExecutions!.map((e, i) => ({
      ...e, settlementCurrency: "JPY", brokerBookedAmountJPY: i === 0 ? -90_500 : 20_000,
    }));
    expect(calculateAccountExpiryPayoff(s)).toMatchObject({
      currency: "JPY", fxRate: 150, maxLoss: -70_500, maxProfit: 229_500, breakevens: [104.7],
    });
  });

  it("shows stock only when its USD basis is known and offsets covered calls", () => {
    const s = fixture([short]);
    s.strategyType = "covered_call";
    expect(calculateAccountExpiryPayoff(s).kind).toBe("missing");
    s.stockPosition = { shares: 100, averageCostUSD: 110, denominatorPriceMode: "average_cost" };
    expect(calculateAccountExpiryPayoff(s)).toMatchObject({ maxLoss: -10867.5, maxProfit: 1132.5 });
  });

  it("does not guess missing execution data, mixed expiries, or a current-price marker", () => {
    const missingFee = fixture();
    missingFee.optionEntryExecutions![0].commissionUSD = undefined;
    expect(calculateAccountExpiryPayoff(missingFee).kind).toBe("missing");
    expect(calculateAccountExpiryPayoff(fixture([{ ...long, contractSize: undefined }])).kind).toBe("missing");
    expect(calculateAccountExpiryPayoff(fixture([long, { ...short, expiryDate: "2027-02-19" }])).kind).toBe("missing");
    expect(calculateAccountExpiryPayoff({ ...fixture(), currentPriceUSD: 0 })).toMatchObject({ kind: "available", spot: undefined });
    expect(calculateAccountExpiryPayoff({ ...fixture(), status: "planned" }).kind).toBe("missing");
  });

  it("excludes a closed leg and its realized P/L from the remaining chart", () => {
    const s = fixture();
    s.optionCloseExecutions = [{
      id: "closed-short", legId: short.id, confirmed: true, closeDate: "2026-11-03",
      contracts: 1, closePriceUSD: 2, commissionUSD: 2.5, settlementCurrency: "USD", source: "manual",
    }];
    expect(calculateAccountExpiryPayoff(s)).toMatchObject({ kind: "available", partial: true, maxLoss: -602.5, maxProfit: Infinity });
  });
});

describe("move from current price to expiry breakeven", () => {
  it("calculates the requested anonymous rise and fall from the same break-even", () => {
    const rising = getExpiryBreakevenMoves(101.67, [104.7], []);
    const falling = getExpiryBreakevenMoves(110, [104.7], []);
    if (rising.kind !== "moves" || falling.kind !== "moves") throw new Error("missing moves");
    expect(rising.moves[0].delta).toBeCloseTo(3.03);
    expect(rising.moves[0].percent).toBeCloseTo(2.98, 2);
    expect(falling.moves[0].delta).toBeCloseTo(-5.30);
    expect(falling.moves[0].percent).toBeCloseTo(-4.82, 2);
  });
  it("uses the exact point and the current price as the percentage denominator", () => {
    const gap = getExpiryBreakevenMoves(100, [101.2345], []);
    if (gap.kind !== "moves") throw new Error(gap.kind);
    expect(gap.moves[0].delta).toBeCloseTo(1.2345, 8);
    expect(gap.moves[0].percent).toBeCloseTo(1.2345, 6);
  });

  it("shows both directions with the nearest point first", () => {
    expect(getExpiryBreakevenMoves(100, [85, 110], [])).toEqual({
      kind: "moves", moves: [{ target: 110, delta: 10, percent: 10 }, { target: 85, delta: -15, percent: -15 }],
    });
  });

  it("uses the nearest boundary of a zero-P/L range and recognizes a price inside it", () => {
    const range = [{ start: 80, end: 95 }, { start: 115, end: Infinity }];
    expect(getExpiryBreakevenMoves(100, [], range)).toMatchObject({ moves: [{ target: 95, delta: -5 }, { target: 115, delta: 15 }] });
    expect(getExpiryBreakevenMoves(120, [], range)).toEqual({ kind: "in-range" });
  });

  it("distinguishes missing price, no break-even and already at break-even", () => {
    expect(getExpiryBreakevenMoves(undefined, [100], [])).toEqual({ kind: "no-spot" });
    expect(getExpiryBreakevenMoves(0, [100], [])).toEqual({ kind: "no-spot" });
    expect(getExpiryBreakevenMoves(90, [], [])).toEqual({ kind: "no-breakeven" });
    expect(getExpiryBreakevenMoves(100, [100 + 1e-10], [])).toMatchObject({ moves: [{ delta: 0, percent: 0 }] });
  });
});
