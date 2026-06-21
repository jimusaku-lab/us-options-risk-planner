import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import type { TradeSimulation } from "@/types/domain";
import { calculateYearlyPerformanceSummary } from "./yearlyPerformance";

const putLeg = sampleAmznSimulation.optionLegs.find((leg) => leg.type === "put")!;

function closedPutSimulation(patch: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    ...sampleAmznSimulation,
    status: "closed",
    entryDate: "2026-01-01",
    expiryDate: "2026-01-31",
    dte: 30,
    brokerCommissionUSD: 0,
    brokerCommissionJPY: 0,
    optionLegs: [
      {
        ...putLeg,
        id: "put-test",
        premiumUSD: 1,
        quantity: 1,
        expiryDate: "2026-01-31",
      },
    ],
    optionCloseExecutions: [
      {
        id: "close-test",
        legId: "put-test",
        closeKind: "buyback",
        confirmed: true,
        closeDate: "2026-01-10",
        contracts: 1,
        closePriceUSD: 0.2,
        commissionUSD: 0,
        settlementCurrency: "JPY",
        brokerRealizedPnlJPY: 12_345,
        source: "manual",
      },
    ],
    stockSettlement: undefined,
    ...patch,
  };
}

function assignedPutSimulation(patch: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    ...sampleAmznSimulation,
    id: "assigned-2075p",
    status: "assigned",
    ticker: "NVDA",
    name: "NVDA 207.5P assigned",
    accountEnvironment: "PROD_P_JPY_SETTLEMENT",
    accountCode: "P",
    accountCurrency: "JPY",
    entryDate: "2026-06-02",
    expiryDate: "2026-06-12",
    dte: 10,
    currentPriceUSD: 1_000,
    fxRateJPY: 160.16,
    brokerCommissionUSD: 0,
    brokerCommissionJPY: 0,
    stockPosition: {
      shares: 100,
      averageCostUSD: 207.5,
      denominatorPriceMode: "current_price",
    },
    optionLegs: [
      {
        ...putLeg,
        id: "put-2075",
        type: "put",
        side: "sell",
        strikeUSD: 207.5,
        premiumUSD: 1.21,
        quantity: 1,
        expiryDate: "2026-06-12",
      },
    ],
    optionEntryExecutions: [
      {
        id: "entry-2075",
        legId: "put-2075",
        tradeDate: "2026-06-02",
        contracts: 1,
        fillPriceUSD: 1.21,
        settlementCurrency: "JPY",
        brokerBookedAmountJPY: 18_792,
        brokerPremiumJPY: 18_792,
        brokerTransactionCostJPY: 0,
        source: "broker_statement",
        confirmed: true,
      },
    ],
    optionCloseExecutions: [],
    stockAcquisition: {
      enabled: true,
      acquisitionDate: "2026-06-12",
      shares: 100,
      priceUSD: 207.5,
      accountEnvironment: "PROD_P_JPY_SETTLEMENT",
      source: "saxo_history",
      confirmationStatus: "confirmed",
    },
    stockSettlement: undefined,
    ...patch,
  };
}

describe("yearly performance summary", () => {
  it("does not aggregate open positions", () => {
    const summary = calculateYearlyPerformanceSummary([
      closedPutSimulation({ status: "open" }),
    ], 2026);

    expect(summary.optionPnlJPY).toBe(0);
    expect(summary.optionCount).toBe(0);
  });

  it("does not aggregate unconfirmed close execution drafts", () => {
    const summary = calculateYearlyPerformanceSummary([
      closedPutSimulation({
        optionCloseExecutions: [
          {
            id: "draft-close",
            legId: "put-test",
            closeKind: "buyback",
            confirmed: false,
            closeDate: "2026-01-10",
            contracts: 1,
            closePriceUSD: 0.2,
            settlementCurrency: "JPY",
            brokerRealizedPnlJPY: 12_345,
            source: "manual",
          },
        ],
      }),
    ], 2026);

    expect(summary.optionPnlJPY).toBe(0);
    expect(summary.optionCount).toBe(0);
    expect(summary.unconfirmedCount).toBeGreaterThan(0);
  });

  it("prioritizes Saxo realized JPY for P/DEMO accounts", () => {
    const summary = calculateYearlyPerformanceSummary([
      closedPutSimulation({
        accountEnvironment: "PROD_P_JPY_SETTLEMENT",
        accountCode: "P",
        accountCurrency: "JPY",
        fxRateJPY: 160,
        optionCloseExecutions: [
          {
            id: "saxo-close",
            legId: "put-test",
            closeKind: "buyback",
            confirmed: true,
            closeDate: "2026-01-10",
            contracts: 1,
            closePriceUSD: 0.2,
            commissionUSD: 0,
            settlementCurrency: "JPY",
            brokerRealizedPnlJPY: 15_491,
            source: "manual",
          },
        ],
      }),
    ], 2026);

    expect(summary.optionPnlJPY).toBe(15_491);
    expect(summary.realizedPnlJPY).toBe(15_491);
  });

  it("keeps N account USD results out of confirmed JPY totals", () => {
    const summary = calculateYearlyPerformanceSummary([
      closedPutSimulation({
        accountEnvironment: "PROD_N_USD_SETTLEMENT",
        accountCode: "N",
        accountCurrency: "USD",
        referenceFxRateJPY: 150,
        fxRateJPY: 150,
        optionCloseExecutions: [
          {
            id: "n-close",
            legId: "put-test",
            closeKind: "buyback",
            confirmed: true,
            closeDate: "2026-01-10",
            contracts: 1,
            closePriceUSD: 0.2,
            commissionUSD: 0,
            settlementCurrency: "USD",
            realizedPnlUSD: 100,
            fxRateJPY: 150,
            source: "manual",
          },
        ],
      }),
    ], 2026);

    expect(summary.realizedPnlJPY).toBe(0);
    expect(summary.optionPnlJPY).toBe(0);
    expect(summary.nOptionPnlUSD).toBe(100);
    expect(summary.nReferencePnlJPY).toBe(15_000);
    expect(summary.optionAnnualReturnPct).toBeUndefined();
    expect(summary.nOptionAnnualReturnPct).toBeDefined();
    expect(summary.optionBreakdowns[0].currency).toBe("USD");
    expect(summary.optionBreakdowns[0].amountUSD).toBe(100);
  });

  it("aggregates monthly results by realization date", () => {
    const summary = calculateYearlyPerformanceSummary([
      closedPutSimulation({
        id: "jan",
        optionCloseExecutions: [
          {
            id: "jan-close",
            legId: "put-test",
            closeKind: "buyback",
            confirmed: true,
            closeDate: "2026-01-31",
            contracts: 1,
            closePriceUSD: 0.2,
            settlementCurrency: "JPY",
            brokerRealizedPnlJPY: 10_000,
            source: "manual",
          },
        ],
      }),
      closedPutSimulation({
        id: "feb",
        optionCloseExecutions: [
          {
            id: "feb-close",
            legId: "put-test",
            closeKind: "buyback",
            confirmed: true,
            closeDate: "2026-02-01",
            contracts: 1,
            closePriceUSD: 0.2,
            settlementCurrency: "JPY",
            brokerRealizedPnlJPY: -3_000,
            source: "manual",
          },
        ],
      }),
    ], 2026);

    expect(summary.monthly[0].totalJPY).toBe(10_000);
    expect(summary.monthly[0].cumulativeJPY).toBe(10_000);
    expect(summary.monthly[1].totalJPY).toBe(-3_000);
    expect(summary.monthly[1].cumulativeJPY).toBe(7_000);
  });

  it("aggregates confirmed assigned short put premium without mixing stock market value", () => {
    const summary = calculateYearlyPerformanceSummary([
      closedPutSimulation({
        id: "closed-200p",
        ticker: "NVDA",
        accountEnvironment: "PROD_P_JPY_SETTLEMENT",
        accountCode: "P",
        accountCurrency: "JPY",
        optionCloseExecutions: [
          {
            id: "close-200p",
            legId: "put-test",
            closeKind: "buyback",
            confirmed: true,
            closeDate: "2026-06-02",
            contracts: 1,
            closePriceUSD: 0.13,
            commissionUSD: 0,
            settlementCurrency: "JPY",
            brokerRealizedPnlJPY: 15_491,
            source: "manual",
          },
        ],
      }),
      assignedPutSimulation(),
    ], 2026);

    expect(summary.optionPnlJPY).toBe(34_283);
    expect(summary.realizedPnlJPY).toBe(34_283);
    expect(summary.stockPnlJPY).toBe(0);
    expect(summary.stockSettlementCount).toBe(0);
    expect(summary.optionCount).toBe(2);
    expect(summary.optionAnnualReturnIncludedCount).toBe(2);
    expect(summary.optionAnnualReturnExcludedCount).toBe(0);
    expect(summary.monthly[5].optionJPY).toBe(34_283);
    expect(summary.tickerSummaries.find((item) => item.ticker === "NVDA")?.optionJPY).toBe(34_283);
    expect(summary.optionAnnualReturnPct).toBeDefined();
    expect(summary.optionCapitalDaysJPY).toBeGreaterThan(0);
    const annualizedFromCapitalDays = (summary.optionAnnualReturnProfitJPY / summary.optionCapitalDaysJPY) * 100;
    expect(summary.optionAnnualReturnPct).toBeCloseTo(annualizedFromCapitalDays, 6);
    const individualAverage =
      summary.optionBreakdowns.reduce((sum, item) => sum + (item.annualReturnPct ?? 0), 0) /
      summary.optionBreakdowns.length;
    expect(summary.optionAnnualReturnPct).not.toBeCloseTo(individualAverage, 6);
    expect(summary.optionBreakdowns.every((item) => item.annualReturnPct !== undefined)).toBe(true);
  });

  it("uses only calculable events for the aggregate annual return", () => {
    const summary = calculateYearlyPerformanceSummary([
      closedPutSimulation({
        id: "closed-200p",
        ticker: "NVDA",
        accountEnvironment: "PROD_P_JPY_SETTLEMENT",
        accountCode: "P",
        accountCurrency: "JPY",
        optionCloseExecutions: [
          {
            id: "close-200p",
            legId: "put-test",
            closeKind: "buyback",
            confirmed: true,
            closeDate: "2026-06-02",
            contracts: 1,
            closePriceUSD: 0.13,
            commissionUSD: 0,
            settlementCurrency: "JPY",
            brokerRealizedPnlJPY: 15_491,
            source: "manual",
          },
        ],
      }),
      assignedPutSimulation({
        fxRateJPY: 0,
        referenceFxRateJPY: undefined,
        optionEntryExecutions: [
          {
            id: "entry-2075-no-fx",
            legId: "put-2075",
            tradeDate: "2026-06-02",
            contracts: 1,
            fillPriceUSD: 1.21,
            settlementCurrency: "JPY",
            brokerBookedAmountJPY: 18_792,
            source: "broker_statement",
            confirmed: true,
          },
        ],
      }),
    ], 2026);

    expect(summary.optionPnlJPY).toBe(34_283);
    expect(summary.optionAnnualReturnIncludedCount).toBe(1);
    expect(summary.optionAnnualReturnExcludedCount).toBe(1);
    expect(summary.optionAnnualReturnProfitJPY).toBe(15_491);
    expect(summary.optionAnnualReturnPct).toBeCloseTo((15_491 / summary.optionCapitalDaysJPY) * 100, 6);
    expect(summary.annualReturnMissingCount).toBe(1);
    expect(summary.transactionUnconfirmedCount).toBe(0);
    expect(summary.optionBreakdowns.find((item) => item.label === "P売り権利行使プレミアム")?.annualReturnMissingReason).toBe("USD/JPYが未取得");
    expect(summary.issues.some((issue) => issue.detail === "この権利行使プレミアムはUSD/JPYが未取得のため年率を計算できません。")).toBe(true);
  });

  it("calculates assigned short put denominator from Saxo entry execution fx", () => {
    const summary = calculateYearlyPerformanceSummary([
      assignedPutSimulation({
        fxRateJPY: 0,
        referenceFxRateJPY: undefined,
        optionEntryExecutions: [
          {
            id: "entry-2075-fx",
            legId: "put-2075",
            tradeDate: "2026-06-02",
            contracts: 1,
            fillPriceUSD: 1.21,
            settlementCurrency: "JPY",
            brokerExchangeRateJPY: 160.16,
            brokerBookedAmountJPY: 18_792,
            brokerPremiumJPY: 18_792,
            source: "broker_statement",
            confirmed: true,
          },
        ],
      }),
    ], 2026);

    expect(summary.optionBreakdowns[0].denominatorJPY).toBeCloseTo(207.5 * 100 * 160.16, 2);
    expect(summary.optionBreakdowns[0].annualReturnPct).toBeDefined();
    expect(summary.optionAnnualReturnIncludedCount).toBe(1);
    expect(summary.optionAnnualReturnExcludedCount).toBe(0);
  });

  it("marks annual return as uncalculated when denominator or days are missing", () => {
    const summary = calculateYearlyPerformanceSummary([
      assignedPutSimulation({
        fxRateJPY: 0,
        referenceFxRateJPY: undefined,
        optionEntryExecutions: [
          {
            id: "entry-2075-no-fx",
            legId: "put-2075",
            tradeDate: "2026-06-02",
            contracts: 1,
            fillPriceUSD: 1.21,
            settlementCurrency: "JPY",
            brokerBookedAmountJPY: 18_792,
            source: "broker_statement",
            confirmed: true,
          },
        ],
      }),
    ], 2026);

    expect(summary.optionPnlJPY).toBe(18_792);
    expect(summary.optionAnnualReturnPct).toBeUndefined();
    expect(summary.optionBreakdowns[0].annualReturnPct).toBeUndefined();
    expect(summary.optionBreakdowns[0].annualReturnMissingReason).toBe("USD/JPYが未取得");
    expect(summary.issues.some((issue) => issue.label === "年率未計算")).toBe(true);
  });
});
