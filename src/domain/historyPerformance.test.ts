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

  it("uses the confirmed long-option purchase total rather than a margin denominator", () => {
    const simulation = shortPutSimulation({
      id: "long-history-usd", strategyType: "long_call", status: "closed", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCode: "N", accountCurrency: "USD", entryDate: "2026-08-01",
      optionLegs: [{ ...shortPutSimulation().optionLegs[0], id: "call", type: "call", side: "buy", premiumUSD: 1, quantity: 1 }],
      optionEntryExecutions: [{ id: "entry", legId: "call", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true }],
      optionCloseExecutions: [{ id: "close", legId: "call", closeKind: "buyback", closeDate: "2026-08-05", contracts: 1, closePriceUSD: 1.5, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: 45.52, source: "manual", confirmed: true }],
    });
    const result = calculateHistoryPerformance(simulation);
    expect(result.primaryDenominator.label).toBe("購入時支払総額");
    expect(result.primaryDenominator.amountUSD).toBeCloseTo(102.24, 8);
    expect(result.holdingPeriodReturnPct).toBeCloseTo((45.52 / 102.24) * 100, 8);
    expect(result.holdingPeriodReturnCurrency).toBe("USD");
    expect(result.primaryDenominator.annualReturnPct).toBeCloseTo((45.52 / 102.24 / 4) * 365 * 100, 8);
    expect(result.primaryDenominator.netAnnualReturnPct).toBeUndefined();
  });

  it("does not render an unknown long-option purchase basis as a 0% historical return", () => {
    const simulation = shortPutSimulation({
      id: "long-history-missing-entry", strategyType: "long_put", status: "closed", accountEnvironment: "PROD_P_JPY_SETTLEMENT",
      optionLegs: [{ ...shortPutSimulation().optionLegs[0], id: "put", type: "put", side: "buy", quantity: 1 }], optionEntryExecutions: [],
      optionCloseExecutions: [{ id: "close", legId: "put", closeKind: "buyback", closeDate: "2026-08-05", contracts: 1, closePriceUSD: 1.5, settlementCurrency: "JPY", brokerRealizedPnlJPY: 3_000, source: "manual", confirmed: true }],
    });
    const result = calculateHistoryPerformance(simulation);
    expect(result.historicalAnnualReturnMissingReason).toBe("購入時支払額");
    expect(result.optionCloseExecutionResults[0].annualReturnPct).toBeUndefined();
  });

  it("distinguishes missing dates, duplicate evidence, and unmatched multi-date partial closes", () => {
    const base = shortPutSimulation({
      id: "long-history-entry-issue", strategyType: "long_put", status: "closed", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCode: "N", accountCurrency: "USD",
      optionLegs: [{ ...shortPutSimulation().optionLegs[0], id: "put", type: "put", side: "buy", quantity: 1 }],
      optionCloseExecutions: [{ id: "close", legId: "put", closeKind: "buyback", closeDate: "2026-08-05", contracts: 1, closePriceUSD: 1.5, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: 45.52, source: "manual", confirmed: true }],
    });
    expect(calculateHistoryPerformance({ ...base, optionEntryExecutions: [{ id: "entry", legId: "put", tradeDate: "", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true }] }).historicalAnnualReturnMissingReason).toBe("購入時約定日");
    expect(calculateHistoryPerformance({ ...base, optionEntryExecutions: [
      { id: "entry-a", legId: "put", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true },
      { id: "entry-b", legId: "put", tradeDate: "2026-08-02", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true },
    ] }).historicalAnnualReturnMissingReason).toBe("開始約定の数量超過（証跡未照合）");

    const multiLot = { ...base, optionLegs: [{ ...base.optionLegs[0], id: "call", type: "call" as const, side: "buy" as const, quantity: 2 }], optionEntryExecutions: [
      { id: "entry-one", legId: "call", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD" as const, source: "manual" as const, confirmed: true },
      { id: "entry-two", legId: "call", tradeDate: "2026-08-03", contracts: 1, fillPriceUSD: 2, commissionUSD: 2.24, settlementCurrency: "USD" as const, source: "manual" as const, confirmed: true },
    ], optionCloseExecutions: [{ ...base.optionCloseExecutions![0], legId: "call", contracts: 2, realizedPnlUSD: 90 }] };
    const complete = calculateHistoryPerformance(multiLot);
    expect(complete.historicalAnnualReturnMissingReason).toBeUndefined();
    expect(complete.primaryDenominator.annualReturnPct).toBeCloseTo((90 / (102.24 * 4 + 202.24 * 2)) * 365 * 100, 8);
    expect(calculateHistoryPerformance({ ...multiLot, optionCloseExecutions: [{ ...multiLot.optionCloseExecutions![0], contracts: 1 }] }).historicalAnnualReturnMissingReason).toBe("決済ロットの対応");
  });

  it("canonicalises only entries with the same strong broker identity", () => {
    const simulation = shortPutSimulation({ id: "canonical-entry", strategyType: "long_call", status: "closed", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCode: "N", accountCurrency: "USD",
      optionLegs: [{ ...shortPutSimulation().optionLegs[0], id: "call", type: "call", side: "buy", quantity: 1 }],
      optionEntryExecutions: [
        { id: "entry-a", legId: "call", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "saxo_api_estimate", saxoTicketId: "fixture-ticket", confirmed: true },
        { id: "entry-b", legId: "call", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "saxo_api_estimate", saxoTicketId: "fixture-ticket", confirmed: true },
      ],
      optionCloseExecutions: [{ id: "close", legId: "call", closeKind: "buyback", closeDate: "2026-08-05", contracts: 1, closePriceUSD: 1.5, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: 45.52, source: "manual", confirmed: true }],
    });
    expect(calculateHistoryPerformance(simulation).historicalAnnualReturnMissingReason).toBeUndefined();
  });

  it("does not copy the N/USD tax-before annual return into tax-after", () => {
    const simulation = shortPutSimulation({ id: "usd-tax-after", status: "closed", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCode: "N", accountCurrency: "USD",
      optionCloseExecutions: [{ id: "close", legId: "put-leg", closeKind: "buyback", closeDate: "2026-08-05", contracts: 1, closePriceUSD: 1.5, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: 45.52, source: "manual", confirmed: true }],
    });
    const result = calculateHistoryPerformance(simulation);
    expect(result.primaryDenominator.annualReturnPct).toBeDefined();
    expect(result.primaryDenominator.netAnnualReturnPct).toBeUndefined();
  });

  it("uses the one-day convention only for a same-day confirmed long-option close", () => {
    const simulation = shortPutSimulation({
      id: "long-history-same-day", strategyType: "long_call", status: "closed", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCode: "N", accountCurrency: "USD",
      optionLegs: [{ ...shortPutSimulation().optionLegs[0], id: "call", type: "call", side: "buy", quantity: 1 }],
      optionEntryExecutions: [{ id: "entry", legId: "call", tradeDate: "2026-08-05", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true }],
      optionCloseExecutions: [{ id: "close", legId: "call", closeKind: "buyback", closeDate: "2026-08-05", contracts: 1, closePriceUSD: 1.5, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: 45.52, source: "manual", confirmed: true }],
    });
    expect(calculateHistoryPerformance(simulation).optionCloseExecutionResults[0].holdingDays).toBe(1);
    const reversed = { ...simulation, optionCloseExecutions: [{ ...simulation.optionCloseExecutions![0], closeDate: "2026-08-04" }] };
    expect(calculateHistoryPerformance(reversed).historicalAnnualReturnMissingReason).toBe("建玉日と決済日の順序");
  });
});
