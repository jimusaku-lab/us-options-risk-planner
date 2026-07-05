import { describe, expect, it } from "vitest";
import type { PublicOptionCandidateInput } from "@/types/screening";
import {
  selectAvoidAssignmentPutLegs,
  selectBuyToOwnPutLegs,
  selectCoveredCallLegs,
  selectLongCallLegs,
  selectOptionLegCandidates,
} from "./optionLegSelection";

describe("option leg selection", () => {
  it("prioritizes long calls with DTE 150-210 and strike/current 1.00-1.05", () => {
    const result = selectLongCallLegs({
      symbol: "MSFT",
      underlyingPrice: 100,
      strategy: "long_call",
      options: [
        call({ id: "good", dte: 180, strike: 103, bid: 4.8, ask: 5.2, volume: 120, openInterest: 500 }),
        call({ id: "far", dte: 240, strike: 120, bid: 4.8, ask: 5.2, volume: 120, openInterest: 500 }),
        put({ id: "wrong-type", dte: 180, strike: 95, bid: 3, ask: 3.3 }),
      ],
    });

    expect(result.legs[0]).toMatchObject({
      id: "good",
      optionType: "call",
      side: "buy",
      conservativePrice: 5.2,
      conservativePriceField: "ask",
    });
  });

  it("prioritizes buy-to-own puts with DTE 30-90 and strike/current 0.90-0.97", () => {
    const result = selectBuyToOwnPutLegs({
      symbol: "MSFT",
      underlyingPrice: 100,
      strategy: "cash_secured_put_buy_to_own",
      options: [
        put({ id: "good-put", dte: 45, strike: 95, bid: 2.4, ask: 2.6, volume: 90, openInterest: 300 }),
        put({ id: "too-low", dte: 45, strike: 75, bid: 2.4, ask: 2.6, volume: 90, openInterest: 300 }),
      ],
    });

    expect(result.legs[0]).toMatchObject({
      id: "good-put",
      optionType: "put",
      side: "sell",
      conservativePrice: 2.4,
      conservativePriceField: "bid",
    });
  });

  it("prioritizes avoid-assignment puts with far strike range", () => {
    const result = selectAvoidAssignmentPutLegs({
      symbol: "MSFT",
      underlyingPrice: 100,
      strategy: "cash_secured_put_avoid_assignment",
      options: [
        put({ id: "far-put", dte: 45, strike: 70, bid: 1.2, ask: 1.3, volume: 70, openInterest: 250 }),
        put({ id: "near-put", dte: 45, strike: 95, bid: 2.4, ask: 2.6, volume: 120, openInterest: 500 }),
      ],
    });

    expect(result.legs[0]).toMatchObject({
      id: "far-put",
      strikePrice: 70,
      side: "sell",
      conservativePriceField: "bid",
    });
  });

  it("prioritizes covered calls above current price and cost basis", () => {
    const result = selectCoveredCallLegs({
      symbol: "MSFT",
      underlyingPrice: 100,
      stockCostBasis: 90,
      strategy: "covered_call",
      options: [
        call({ id: "covered", dte: 45, strike: 104, bid: 2.3, ask: 2.5, volume: 80, openInterest: 300 }),
        call({ id: "below", dte: 45, strike: 88, bid: 4.5, ask: 4.9, volume: 120, openInterest: 500 }),
      ],
    });

    expect(result.legs[0]).toMatchObject({
      id: "covered",
      optionType: "call",
      side: "sell",
      conservativePrice: 2.3,
      conservativePriceField: "bid",
    });
  });

  it("warns when covered call strike is below cost basis", () => {
    const result = selectCoveredCallLegs({
      symbol: "MSFT",
      underlyingPrice: 100,
      stockCostBasis: 110,
      strategy: "covered_call",
      options: [call({ id: "below-cost", dte: 45, strike: 104, bid: 2.3, ask: 2.5 })],
    });

    expect(result.legs[0].liquidityWarnings.join(" ")).toContain("取得単価");
  });

  it("does not create usable leg from Last only", () => {
    const result = selectOptionLegCandidates({
      symbol: "MSFT",
      underlyingPrice: 100,
      strategy: "long_call",
      options: [call({ id: "last-only", dte: 180, strike: 103, bid: undefined, ask: undefined, mid: undefined, last: 5 })],
    });

    expect(result.legs).toEqual([]);
    expect(result.missingFields).toContain("optionCandidates.usableBidAsk");
  });

  it("keeps thin liquidity candidates but marks warnings", () => {
    const result = selectLongCallLegs({
      symbol: "MSFT",
      underlyingPrice: 100,
      strategy: "long_call",
      options: [call({ id: "thin", dte: 180, strike: 103, bid: 4.8, ask: 5.2, volume: 5, openInterest: 10 })],
    });

    expect(result.legs).toHaveLength(1);
    expect(result.legs[0].liquidityWarnings.join(" ")).toContain("流動性");
  });
});

function call(overrides: Partial<PublicOptionCandidateInput> = {}): PublicOptionCandidateInput {
  return option({ optionType: "call", ...overrides });
}

function put(overrides: Partial<PublicOptionCandidateInput> = {}): PublicOptionCandidateInput {
  return option({ optionType: "put", ...overrides });
}

function option(overrides: Partial<PublicOptionCandidateInput>): PublicOptionCandidateInput {
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
    volume: 100,
    openInterest: 300,
    iv: 0.32,
    delta: 0.45,
    gamma: 0.02,
    theta: -0.03,
    vega: 0.12,
    ...overrides,
  };
}
