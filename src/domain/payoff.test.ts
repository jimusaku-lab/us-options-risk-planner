import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import type { TradeSimulation } from "@/types/domain";
import { calculatePayoffAtExpiryJPY, calculatePayoffSummary } from "./payoff";

function createLongOptionSimulation(type: "call" | "put"): TradeSimulation {
  return {
    ...sampleAmznSimulation,
    strategyType: type === "call" ? "long_call" : "long_put",
    ticker: "NVDA",
    currentPriceUSD: 200,
    fxRateJPY: 1,
    brokerCommissionUSD: 0,
    brokerCommissionJPY: 0,
    exchangeFeesJPY: 0,
    fxConversionCostJPY: 0,
    carryingCostJPY: 0,
    stockPosition: null,
    optionEntryExecutions: [],
    optionLegs: [
      {
        id: `long-${type}`,
        type,
        side: "buy",
        strikeUSD: 200,
        premiumUSD: 11,
        quantity: 1,
        expiryDate: "2026-06-19",
        isCovered: false,
      },
    ],
  };
}

describe("payoff", () => {
  it("calculates long call breakeven and maximum loss from paid premium", () => {
    const summary = calculatePayoffSummary(createLongOptionSimulation("call"));

    expect(summary.breakevens[0].priceUSD).toBe(211);
    expect(summary.maxLossLabel).toBe("-1,100円");
    expect(summary.maxProfitLabel).toContain("無制限");
    expect(calculatePayoffAtExpiryJPY(createLongOptionSimulation("call"), 211)).toBe(0);
  });

  it("calculates long put breakeven and maximum loss from paid premium", () => {
    const summary = calculatePayoffSummary(createLongOptionSimulation("put"));

    expect(summary.breakevens[0].priceUSD).toBe(189);
    expect(summary.maxLossLabel).toBe("-1,100円");
    expect(calculatePayoffAtExpiryJPY(createLongOptionSimulation("put"), 189)).toBe(0);
  });

  it("keeps short put payoff calculation usable", () => {
    const simulation: TradeSimulation = {
      ...sampleAmznSimulation,
      strategyType: "short_put",
      currentPriceUSD: 200,
      fxRateJPY: 1,
      brokerCommissionUSD: 0,
      brokerCommissionJPY: 0,
      exchangeFeesJPY: 0,
      fxConversionCostJPY: 0,
      carryingCostJPY: 0,
      stockPosition: null,
      optionEntryExecutions: [],
      optionLegs: [
        {
          id: "short-put",
          type: "put",
          side: "sell",
          strikeUSD: 200,
          premiumUSD: 11,
          quantity: 1,
          expiryDate: "2026-06-19",
        },
      ],
    };

    expect(calculatePayoffSummary(simulation).breakevens[0].priceUSD).toBe(189);
    expect(calculatePayoffAtExpiryJPY(simulation, 189)).toBe(0);
  });

  it("uses stock cost minus premium as the covered call breakeven", () => {
    const simulation: TradeSimulation = {
      ...sampleAmznSimulation,
      strategyType: "covered_call",
      currentPriceUSD: 220,
      fxRateJPY: 1,
      brokerCommissionUSD: 0,
      brokerCommissionJPY: 0,
      exchangeFeesJPY: 0,
      fxConversionCostJPY: 0,
      carryingCostJPY: 0,
      stockPosition: {
        shares: 100,
        averageCostUSD: 207.5,
        denominatorPriceMode: "average_cost",
      },
      optionEntryExecutions: [],
      optionLegs: [
        {
          id: "short-call",
          type: "call",
          side: "sell",
          strikeUSD: 230,
          premiumUSD: 1.4,
          quantity: 1,
          expiryDate: "2026-06-24",
          isCovered: true,
        },
      ],
    };

    const summary = calculatePayoffSummary(simulation);

    expect(summary.breakevens[0].label).toBe("保有株込みの損益分岐点");
    expect(summary.breakevens[0].priceUSD).toBeCloseTo(206.1, 8);
    expect(summary.secondaryBreakevens?.[0].label).toBe("コール売り単体の上側損益分岐点");
    expect(summary.secondaryBreakevens?.[0].priceUSD).toBeCloseTo(231.4, 8);
    expect(summary.maxLossTitle).toBe("株価0ドル想定の最大評価損");
    expect(summary.maxLossNote).toContain("株を売却しなければ実現損ではありません");
  });
});
