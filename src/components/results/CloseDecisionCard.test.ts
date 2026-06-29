import { describe, expect, it } from "vitest";
import type { SaxoApiOrderSnapshot } from "@/features/saxo/saxoAccountSync";
import { getLongOptionExitOrderLineCandidate } from "./CloseDecisionCard";

function createOrder(overrides: Partial<SaxoApiOrderSnapshot>): SaxoApiOrderSnapshot {
  return {
    id: overrides.id ?? "order",
    accountKey: "n-key",
    accountAssignment: "N",
    symbol: "V",
    optionType: "call",
    strike: 335,
    expiry: "2026-11-20",
    isExitCandidate: true,
    missingFields: [],
    fetchedAt: "2026-06-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("long option exit order line candidates", () => {
  it("uses Saxo closing limit and stop prices as long call profit and stop lines", () => {
    const candidate = getLongOptionExitOrderLineCandidate([
      createOrder({ id: "limit", orderType: "Limit", price: 33 }),
      createOrder({ id: "stop", orderType: "Stop", stopPrice: 11 }),
    ]);

    expect(candidate.profitTargetPriceUSD).toBe(33);
    expect(candidate.stopLossPriceUSD).toBe(11);
  });

  it("ignores empty or zero-priced orders", () => {
    const candidate = getLongOptionExitOrderLineCandidate([
      createOrder({ id: "zero-limit", price: 0 }),
      createOrder({ id: "empty-stop" }),
    ]);

    expect(candidate.profitTargetPriceUSD).toBeUndefined();
    expect(candidate.stopLossPriceUSD).toBeUndefined();
  });
});
