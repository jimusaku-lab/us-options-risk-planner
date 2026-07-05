import { describe, expect, it } from "vitest";
import type { PublicOptionCandidateInput } from "@/types/screening";
import {
  calculateOptionMid,
  calculateOptionSpreadRate,
  evaluateOptionChainLiquidity,
  evaluateOptionLiquidity,
  getConservativeEntryPrice,
} from "./optionLiquidity";

describe("option liquidity", () => {
  it("marks tight Bid Ask and enough liquidity as ok", () => {
    const result = evaluateOptionLiquidity(option({ bid: 4.8, ask: 5.2, volume: 80, openInterest: 200 }));

    expect(result.level).toBe("ok");
    expect(result.spreadRate).toBeCloseTo(0.08);
  });

  it("marks 20 to 35 percent spread as watch", () => {
    const result = evaluateOptionLiquidity(option({ bid: 4, ask: 5.2, volume: 80, openInterest: 200 }));

    expect(result.level).toBe("watch");
    expect(result.warnings.join(" ")).toContain("20%");
  });

  it("marks spread above 35 percent as avoid", () => {
    const result = evaluateOptionLiquidity(option({ bid: 3, ask: 5, volume: 80, openInterest: 200 }));

    expect(result.level).toBe("avoid");
    expect(result.warnings.join(" ")).toContain("35%");
  });

  it("marks missing Bid Ask as insufficient data", () => {
    const result = evaluateOptionLiquidity(option({ bid: undefined, ask: undefined, mid: 4.5, last: 4.4 }));

    expect(result.level).toBe("insufficient_data");
    expect(result.missingFields).toContain("option.bidAsk");
  });

  it("does not create conservative price from Last only", () => {
    const result = getConservativeEntryPrice(option({ bid: undefined, ask: undefined, mid: undefined, last: 4.4 }), "buy");

    expect(result.price).toBeUndefined();
    expect(result.field).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("Last");
  });

  it("uses Ask for buy and Bid for sell while keeping Mid as reference", () => {
    const input = option({ bid: 4.8, ask: 5.2 });

    expect(getConservativeEntryPrice(input, "buy")).toMatchObject({ price: 5.2, field: "ask", mid: 5 });
    expect(getConservativeEntryPrice(input, "sell")).toMatchObject({ price: 4.8, field: "bid", mid: 5 });
  });

  it("warns when Volume or Open Interest is thin", () => {
    const result = evaluateOptionLiquidity(option({ bid: 4.8, ask: 5.2, volume: 5, openInterest: 10 }));

    expect(result.level).toBe("avoid");
    expect(result.warnings.join(" ")).toContain("Volume");
    expect(result.warnings.join(" ")).toContain("Open Interest");
  });

  it("aggregates option chain liquidity", () => {
    const result = evaluateOptionChainLiquidity([
      option({ id: "ok", bid: 4.8, ask: 5.2, volume: 80, openInterest: 200 }),
      option({ id: "bad", bid: undefined, ask: undefined }),
    ]);

    expect(result.level).toBe("ok");
    expect(result.okCount).toBe(1);
    expect(result.insufficientCount).toBe(1);
  });

  it("calculates Mid and spread from Bid Ask", () => {
    const input = option({ bid: 10, ask: 11 });

    expect(calculateOptionMid(input)).toBe(10.5);
    expect(calculateOptionSpreadRate(input)).toBeCloseTo(1 / 10.5);
  });
});

function option(overrides: Partial<PublicOptionCandidateInput> = {}): PublicOptionCandidateInput {
  return {
    id: "opt",
    optionType: "call",
    expiry: "2027-01-15",
    dte: 180,
    strike: 105,
    bid: 4.8,
    ask: 5.2,
    mid: 5,
    last: 5,
    volume: 80,
    openInterest: 200,
    iv: 0.32,
    delta: 0.45,
    gamma: 0.02,
    theta: -0.03,
    vega: 0.12,
    ...overrides,
  };
}
