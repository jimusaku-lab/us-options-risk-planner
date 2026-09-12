import { describe, expect, it } from "vitest";
import type { TradeSimulation } from "@/types/domain";
import { calculateBearPutSpreadEstimate, getBearPutSpreadLifecycle, validateBearPutSpread } from "./bearPutSpread";

function spread(overrides: Partial<TradeSimulation> = {}): TradeSimulation {
  const base: TradeSimulation = {
    id: "spread-1", status: "open", name: "Example spread", ticker: "TEST", strategyType: "bear_put_spread",
    currentPriceUSD: 95, fxRateJPY: 150, accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT",
    entryDate: "2026-09-01", expiryDate: "2026-10-02", dte: 31, accountCurrency: "USD", stockPosition: null,
    brokerMarginJPY: 0, marginBufferMultiplier: 1, denominatorMode: "custom", taxProfileId: "none_nisa_or_tax_free_comparison",
    optionLegs: [
      { id: "long", type: "put", side: "buy", strikeUSD: 100, premiumUSD: 4.92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02", closeCostUSD: 4.5, closePlan: { enabled: true, closePriceUSD: 4.5, commissionUSD: 2.24, commissionSource: "user_confirmed_standard" } },
      { id: "short", type: "put", side: "sell", strikeUSD: 90, premiumUSD: 0.92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02", closeCostUSD: 0.7, closePlan: { enabled: true, closePriceUSD: 0.7, commissionUSD: 2.24, commissionSource: "user_confirmed_standard" } },
    ],
    optionEntryExecutions: [
      { id: "entry-long", legId: "long", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 4.92, settlementCurrency: "USD", commissionUSD: 2.24, commissionSource: "saxo_actual", source: "broker_statement", confirmed: true },
      { id: "entry-short", legId: "short", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 0.92, settlementCurrency: "USD", commissionUSD: 2.24, commissionSource: "saxo_actual", source: "broker_statement", confirmed: true },
    ],
  };
  return { ...base, ...overrides };
}

describe("bear put spread", () => {
  it("validates one higher-strike long put and one lower-strike short put", () => {
    expect(validateBearPutSpread(spread()).valid).toBe(true);
    const invalid = spread({ optionLegs: spread().optionLegs.map((leg) => ({ ...leg, strikeUSD: 95 })) });
    expect(validateBearPutSpread(invalid)).toMatchObject({ valid: false });
  });

  it("uses the explicit multiplier and confirmed fees for the main estimate", () => {
    const result = calculateBearPutSpreadEstimate(spread(), "2026-09-11");
    expect(result.kind).toBe("available");
    if (result.kind !== "available") return;
    expect(result.entryAllInDebitUSD).toBeCloseTo(404.48, 8);
    expect(result.closeNetProceedsUSD).toBeCloseTo(375.52, 8);
    expect(result.totalEstimatedPnlUSD).toBeCloseTo(-28.96, 8);
    expect(result.periodReturnPct).toBeCloseTo(-7.1598, 3);
  });

  it("does not treat a screenshot price difference as realized P/L", () => {
    const result = calculateBearPutSpreadEstimate(spread(), "2026-09-11");
    expect(result.kind === "available" ? result.totalEstimatedPnlUSD : undefined).not.toBe(-43);
    expect(result.kind === "available" ? result.totalEstimatedPnlUSD : undefined).not.toBe(-34);
  });

  it("keeps missing close fees distinct from explicit zero", () => {
    const missing = spread({ optionLegs: spread().optionLegs.map((leg) => leg.id === "short" ? { ...leg, closePlan: { ...leg.closePlan!, commissionUSD: undefined } } : leg) });
    expect(calculateBearPutSpreadEstimate(missing).kind).toBe("missing");
    const zero = spread({ optionLegs: spread().optionLegs.map((leg) => ({ ...leg, closePlan: { ...leg.closePlan!, commissionUSD: 0 } })) });
    expect(calculateBearPutSpreadEstimate(zero).kind).toBe("available");
  });

  it("uses a non-100 multiplier instead of silently assuming 100", () => {
    const small = spread({ optionLegs: spread().optionLegs.map((leg) => ({ ...leg, contractSize: 10 })) });
    const result = calculateBearPutSpreadEstimate(small, "2026-09-11");
    expect(result.kind).toBe("available");
    if (result.kind === "available") expect(result.entryAllInDebitUSD).toBeCloseTo(44.48, 8);
  });

  it("separates realized long-put P/L from the remaining short-put estimate", () => {
    const partial = spread({ optionCloseExecutions: [{ id: "close-long", legId: "long", confirmed: true, closeDate: "2026-09-10", contracts: 1, closePriceUSD: 4.7, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: -20, source: "broker_statement" }] });
    expect(getBearPutSpreadLifecycle(partial)).toMatchObject({ state: "one_leg_remaining", longRemaining: 0, shortRemaining: 1 });
    const result = calculateBearPutSpreadEstimate(partial, "2026-09-11");
    expect(result.kind).toBe("available");
    if (result.kind !== "available") return;
    // An unscoped broker P/L is not authoritative. Confirmed cashflows are
    // 470 - 492 - 2.24 - 2.24, with no arbitrary -20 override.
    expect(result.realizedPnlUSD).toBe(-26.48);
    expect(result.remainingEstimatedPnlUSD).toBeCloseTo(17.52, 8);
    expect(result.totalEstimatedPnlUSD).toBeCloseTo(-8.96, 8);
    expect(result.evaluatedLegs.map((leg) => leg.legId)).toEqual(["short"]);
  });

  it("distinguishes equal partial pairs, imbalanced legs, and fully closed", () => {
    const twoLots = spread({ optionLegs: spread().optionLegs.map((leg) => ({ ...leg, quantity: 2 })), optionEntryExecutions: spread().optionEntryExecutions!.map((entry) => ({ ...entry, contracts: 2, commissionUSD: 4.48 })) });
    const pairPartial = { ...twoLots, optionCloseExecutions: ["long", "short"].map((legId) => ({ id: `close-${legId}`, legId, confirmed: true, closeDate: "2026-09-10", contracts: 1, closePriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD" as const, realizedPnlUSD: 0, source: "broker_statement" as const })) };
    expect(getBearPutSpreadLifecycle(pairPartial).state).toBe("partial_pairs");
    const imbalanced = { ...twoLots, optionCloseExecutions: pairPartial.optionCloseExecutions.slice(0, 1) };
    expect(getBearPutSpreadLifecycle(imbalanced).state).toBe("imbalanced");
    const closed = { ...twoLots, optionCloseExecutions: ["long", "short"].map((legId) => ({ id: `close-${legId}`, legId, confirmed: true, closeDate: "2026-09-10", contracts: 2, closePriceUSD: 1, commissionUSD: 4.48, settlementCurrency: "USD" as const, realizedPnlUSD: 0, source: "broker_statement" as const })) };
    expect(getBearPutSpreadLifecycle(closed).state).toBe("closed");
  });

  it("is deterministic and does not mutate the simulation", () => {
    const simulation = spread();
    const before = JSON.stringify(simulation);
    expect(calculateBearPutSpreadEstimate(simulation, "2026-09-11")).toEqual(calculateBearPutSpreadEstimate(simulation, "2026-09-11"));
    expect(JSON.stringify(simulation)).toBe(before);
  });
});
