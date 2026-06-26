import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import type { TradeSimulation } from "@/types/domain";
import { calculateHistoryPerformance } from "./historyPerformance";

function shortPutSimulation(patch: Partial<TradeSimulation> = {}): TradeSimulation {
  const basePut = sampleAmznSimulation.optionLegs.find((leg) => leg.type === "put") ?? sampleAmznSimulation.optionLegs[0];
  return {
    ...sampleAmznSimulation,
    id: "nvda-put",
    ticker: "NVDA",
    strategyType: "short_put",
    accountEnvironment: "PROD_P_JPY_SETTLEMENT",
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    denominatorMode: "cash_secured",
    stockPosition: null,
    brokerMarginJPY: 0,
    marginBufferMultiplier: 1,
    optionLegs: [
      {
        ...basePut,
        id: "put",
        type: "put",
        side: "sell",
        quantity: 1,
      },
    ],
    optionEntryExecutions: [],
    optionCloseExecutions: [],
    ...patch,
  };
}

describe("history performance", () => {
  it("uses actual close date days for closed buyback history", () => {
    const simulation = shortPutSimulation({
      status: "closed",
      entryDate: "2026-05-27",
      expiryDate: "2026-06-05",
      dte: 9,
      fxRateJPY: 157.8258,
      optionLegs: [
        {
          ...shortPutSimulation().optionLegs[0],
          strikeUSD: 200,
          premiumUSD: 1.16,
        },
      ],
      optionCloseExecutions: [
        {
          id: "close-p200",
          legId: "put",
          closeKind: "buyback",
          confirmed: true,
          closeDate: "2026-06-02",
          contracts: 1,
          closePriceUSD: 0.13,
          settlementCurrency: "JPY",
          brokerRealizedPnlJPY: 15_491,
          source: "manual",
        },
      ],
    });

    const result = calculateHistoryPerformance(simulation);

    expect(result.taxSimulation.dte).toBe(6);
    expect(result.taxGrossProfitJPY).toBe(15_491);
    expect(result.primaryDenominator.amountJPY).toBeCloseTo(3_156_516, 0);
    expect(result.primaryDenominator.annualReturnPct).toBeCloseTo(result.taxResult.grossAnnualReturnPct, 8);
    expect(result.primaryDenominator.netAnnualReturnPct).toBeCloseTo(result.taxResult.netAnnualReturnPct, 8);
  });

  it("uses strike assignment capital as assigned short put denominator without stock market value", () => {
    const simulation = shortPutSimulation({
      status: "assigned",
      entryDate: "2026-06-02",
      expiryDate: "2026-06-12",
      dte: 10,
      fxRateJPY: 160.16,
      optionLegs: [
        {
          ...shortPutSimulation().optionLegs[0],
          strikeUSD: 207.5,
          premiumUSD: 1.21,
        },
      ],
      optionEntryExecutions: [
        {
          id: "entry-p2075",
          legId: "put",
          tradeDate: "2026-06-02",
          contracts: 1,
          fillPriceUSD: 1.21,
          settlementCurrency: "JPY",
          brokerPremiumJPY: 18_792,
          source: "broker_statement",
          confirmed: true,
        },
      ],
      stockPosition: {
        shares: 100,
        averageCostUSD: 207.5,
        denominatorPriceMode: "current_price",
      },
      currentPriceUSD: 415,
      stockAcquisition: {
        enabled: true,
        acquisitionDate: "2026-06-12",
        shares: 100,
        priceUSD: 207.5,
        accountEnvironment: "PROD_P_JPY_SETTLEMENT",
        source: "saxo_history",
      },
    });

    const result = calculateHistoryPerformance(simulation);

    expect(result.assignedPutStockHoldingMode).toBe(true);
    expect(result.primaryDenominator.amountJPY).toBeCloseTo(3_323_320, 0);
    expect(result.primaryDenominator.amountJPY).not.toBeCloseTo(6_646_640, 0);
    expect(result.primaryDenominator.components.some((component) => component.label === "現物株時価" && component.amountJPY > 0)).toBe(false);
    expect(result.primaryDenominator.annualReturnPct).toBeCloseTo(20.6, 1);
  });

  it("keeps confirmed N covered call close performance in USD when JPY reference is missing", () => {
    const simulation = shortPutSimulation({
      id: "nvda-c225",
      name: "NVDA C225",
      strategyType: "covered_call",
      status: "closed",
      accountEnvironment: "PROD_N_USD_SETTLEMENT",
      accountCode: "N",
      accountCurrency: "USD",
      entryDate: "2026-06-18",
      expiryDate: "2026-07-10",
      dte: 22,
      fxRateJPY: 0,
      referenceFxRateJPY: undefined,
      brokerCommissionUSD: 2.25,
      stockPosition: {
        shares: 100,
        averageCostUSD: 207.5,
        denominatorPriceMode: "average_cost",
      },
      optionLegs: [
        {
          ...shortPutSimulation().optionLegs[0],
          id: "call-225",
          type: "call",
          side: "sell",
          strikeUSD: 225,
          premiumUSD: 1.83,
          quantity: 1,
          expiryDate: "2026-07-10",
        },
      ],
      optionCloseExecutions: [
        {
          id: "close-c225",
          legId: "call-225",
          closeKind: "buyback",
          confirmed: true,
          closeDate: "2026-06-23",
          contracts: 1,
          closePriceUSD: 0.79,
          commissionUSD: 2.25,
          settlementCurrency: "USD",
          realizedPnlUSD: 99.5,
          source: "saxo_history",
        },
      ],
    });

    const result = calculateHistoryPerformance(simulation);
    const closeResult = result.optionCloseExecutionResults[0];

    expect(closeResult.entryPremiumUSD - closeResult.openCommissionUSD).toBeCloseTo(180.75, 8);
    expect(closeResult.closeCostUSD + closeResult.closeCommissionUSD).toBeCloseTo(81.25, 8);
    expect(closeResult.realizedPnlUSD).toBeCloseTo(99.5, 8);
    expect(closeResult.realizedPnlJPY).toBe(0);
    expect(result.realizedOptionProfitJPY).toBe(0);
    expect(result.primaryDenominator.currency).toBe("USD");
    expect(result.primaryDenominator.annualReturnPct).not.toBe(0);
  });
});
