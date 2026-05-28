import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import {
  calculateNetInitialPremiumJPY,
  calculatePutAssignmentCapitalTotalJPY,
  calculateStockDenominatorForSimulationJPY,
  calculateUsedMarginJPY,
} from "./calculations";
import { calculateDenominators } from "./denominators";

describe("AMZN sample calculations", () => {
  it("matches the accepted sample values", () => {
    const sim = sampleAmznSimulation;
    expect(calculateStockDenominatorForSimulationJPY(sim)).toBe(4_234_488);
    expect(
      calculateUsedMarginJPY({
        brokerMarginJPY: sim.brokerMarginJPY,
        marginBufferMultiplier: sim.marginBufferMultiplier,
      }),
    ).toBe(635_804);
    expect(calculatePutAssignmentCapitalTotalJPY(sim)).toBe(3_975_000);
    expect(calculateNetInitialPremiumJPY(sim)).toBeCloseTo(70_596, 5);
  });

  it("matches denominator expectations when using the spec premium", () => {
    const sim = sampleAmznSimulation;
    const denominators = calculateDenominators(sim, calculateNetInitialPremiumJPY(sim));
    const byMode = Object.fromEntries(denominators.map((row) => [row.mode, row]));

    expect(byMode.stock_plus_ticket_margin.amountJPY).toBe(4_552_390);
    expect(byMode.stock_plus_margin.amountJPY).toBe(4_870_292);
    expect(byMode.cash_secured.amountJPY).toBe(8_209_488);
    expect(byMode.conservative_common.amountJPY).toBe(8_845_292);
    expect(byMode.stock_plus_ticket_margin.annualReturnPct).toBeCloseTo(33.3, 1);
    expect(byMode.stock_plus_margin.annualReturnPct).toBeCloseTo(31.1, 1);
    expect(byMode.cash_secured.annualReturnPct).toBeCloseTo(18.5, 1);
    expect(byMode.conservative_common.annualReturnPct).toBeCloseTo(17.1, 1);
    expect(byMode.broker_margin_only.annualReturnPct).toBeCloseTo(238.4, 1);
  });
});
