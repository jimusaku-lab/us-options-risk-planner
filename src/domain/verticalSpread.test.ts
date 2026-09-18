import { describe, expect, it } from "vitest";
import type { TradeSimulation } from "@/types/domain";
import { calculateVerticalSpreadEstimate, classifyVerticalSpreadLegs } from "./verticalSpread";

const makeVertical = (strategyType: TradeSimulation["strategyType"], optionType: "call" | "put", buyStrike: number, sellStrike: number): TradeSimulation => {
  const credit = strategyType === "bear_call_spread" || strategyType === "bull_put_spread";
  return ({
  id: `fixture-${strategyType}`, name: "anonymous vertical", ticker: "VERT", accountCode: "N", accountCurrency: "USD", accountEnvironment: "PROD_N_USD_SETTLEMENT",
  strategyType, status: "open", entryDate: "2026-01-01", expiryDate: "2026-12-18", currentPriceUSD: 100, fxRateJPY: 150, dte: 30, stockPosition: null, brokerMarginJPY: 0, marginBufferMultiplier: 1, denominatorMode: "custom", taxProfileId: "none_nisa_or_tax_free_comparison",
  strategyContractVerification: { state: "verified" },
  optionLegs: [
    { id: "buy", type: optionType, side: "buy", quantity: 1, contractSize: 100, strikeUSD: buyStrike, expiryDate: "2026-12-18", premiumUSD: credit ? 1 : 4, closePlan: { enabled: true, closePriceUSD: credit ? 1 : 3, commissionUSD: 1, commissionSource: "manual" } },
    { id: "sell", type: optionType, side: "sell", quantity: 1, contractSize: 100, strikeUSD: sellStrike, expiryDate: "2026-12-18", premiumUSD: credit ? 4 : 2, closePlan: { enabled: true, closePriceUSD: credit ? 3 : 1, commissionUSD: 1, commissionSource: "manual" } },
  ],
  optionEntryExecutions: [
    { id: "entry-buy", legId: "buy", tradeDate: "2026-01-01", contracts: 1, fillPriceUSD: credit ? 1 : 4, settlementCurrency: "USD", commissionUSD: 1, commissionSource: "saxo_actual", source: "broker_statement", confirmed: true },
    { id: "entry-sell", legId: "sell", tradeDate: "2026-01-01", contracts: 1, fillPriceUSD: credit ? 4 : 2, settlementCurrency: "USD", commissionUSD: 1, commissionSource: "saxo_actual", source: "broker_statement", confirmed: true },
  ],
  });
};

describe("vertical spread registry", () => {
  it.each([
    ["bull_call_spread", "call", 90, 100], ["bear_call_spread", "call", 110, 100],
    ["bull_put_spread", "put", 90, 100], ["bear_put_spread", "put", 100, 90],
  ] as const)("classifies and values %s without silent defaults", (strategyType, optionType, buyStrike, sellStrike) => {
    const simulation = makeVertical(strategyType, optionType, buyStrike, sellStrike);
    expect(classifyVerticalSpreadLegs(simulation.optionLegs)).toBe(strategyType);
    const result = calculateVerticalSpreadEstimate(simulation, "2026-01-11");
    expect(result.kind).toBe("available");
    if (result.kind === "available") expect(result.denominatorUSD).toBe(strategyType === "bear_call_spread" || strategyType === "bull_put_spread" ? 702 : 202);
  });

  it("keeps missing close evidence unavailable", () => {
    const simulation = makeVertical("bull_call_spread", "call", 90, 100);
    simulation.optionLegs[0].closePlan = undefined;
    expect(calculateVerticalSpreadEstimate(simulation)).toMatchObject({ kind: "missing" });
  });

  it.each(["bear_call_spread", "bull_put_spread"] as const)("keeps %s cashflow but withholds denominator and rates until the contract is verified", (strategyType) => {
    const simulation = makeVertical(strategyType, strategyType === "bear_call_spread" ? "call" : "put", strategyType === "bear_call_spread" ? 110 : 90, strategyType === "bear_call_spread" ? 100 : 100);
    simulation.strategyContractVerification = { state: "unknown" };
    const result = calculateVerticalSpreadEstimate(simulation, "2026-01-11");
    expect(result).toMatchObject({ kind: "available" });
    if (result.kind === "available") {
      expect(result.denominatorUSD).toBeUndefined();
      expect(result.periodReturnPct).toBeUndefined();
      expect(result.annualizedReturnPct).toBeUndefined();
      expect(result.rateMissingReason).toContain("契約仕様 未照合");
    }
  });

  it("includes only active confirmed close cashflows once and leaves same-day annualization unset", () => {
    const simulation = makeVertical("bull_call_spread", "call", 90, 100);
    simulation.optionCloseExecutions = [
      { id: "close-buy", legId: "buy", closeKind: "buyback", confirmed: true, closeDate: "2026-01-10", contracts: 1, closePriceUSD: 3, commissionUSD: 1, settlementCurrency: "USD", source: "broker_statement" },
      { id: "close-sell", legId: "sell", closeKind: "buyback", confirmed: true, closeDate: "2026-01-10", contracts: 1, closePriceUSD: 1, commissionUSD: 1, settlementCurrency: "USD", source: "broker_statement" },
    ];
    expect(calculateVerticalSpreadEstimate(simulation, "2026-01-11")).toMatchObject({ kind: "available", estimatedPnlUSD: -4, evaluatedLegIds: [] });
    const sameDay = calculateVerticalSpreadEstimate(makeVertical("bull_call_spread", "call", 90, 100), "2026-01-01");
    expect(sameDay).toMatchObject({ kind: "available", annualizedReturnPct: undefined });
  });
});
