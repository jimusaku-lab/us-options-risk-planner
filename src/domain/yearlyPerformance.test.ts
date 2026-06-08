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
});
