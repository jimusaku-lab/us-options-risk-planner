import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import { calculateStockSettlementTaxResult } from "./tax";
import { calculateTaxBucketSummary } from "./taxBucketSummary";
import { calculateOptionCloseExecutionResults } from "./optionCloseExecutions";

describe("stock settlement tax bucket", () => {
  it("keeps stock capital gains separate from option premium tax", () => {
    const result = calculateStockSettlementTaxResult({
      ...sampleAmznSimulation,
      fxRateJPY: 160,
      stockSettlement: {
        enabled: true,
        kind: "covered_call_assignment",
        settlementDate: "2026-06-12",
        shares: 100,
        sellPriceUSD: 280,
        costBasisUSD: 270,
        fxRateJPY: 160,
        commissionUSD: 2,
      },
    });

    expect(result.grossProceedsJPY).toBe(4_480_000);
    expect(result.costBasisJPY).toBe(4_320_000);
    expect(result.feesJPY).toBe(320);
    expect(result.realizedGainJPY).toBe(159_680);
    expect(result.estimatedTaxJPY).toBe(32_438);
    expect(result.holdingDays).toBe(17);
    expect(result.annualReturnPct).toBeCloseTo(79.4, 1);
  });

  it("aggregates ended option and stock settlement buckets separately", () => {
    const summary = calculateTaxBucketSummary([
      {
        ...sampleAmznSimulation,
        status: "closed",
        fxRateJPY: 160,
        brokerCommissionUSD: 2,
        optionCloseExecutions: [
          {
            id: "close-1",
            legId: sampleAmznSimulation.optionLegs[0].id,
            confirmed: true,
            closeDate: "2026-06-02",
            contracts: 1,
            closePriceUSD: 0.1,
            commissionUSD: 2,
            fxRateJPY: 160,
            settlementCurrency: "JPY",
            source: "manual",
          },
        ],
        stockSettlement: {
          enabled: true,
          kind: "covered_call_assignment",
          settlementDate: "2026-06-12",
          shares: 100,
          sellPriceUSD: 280,
          costBasisUSD: 270,
          fxRateJPY: 160,
        },
      },
    ]);

    expect(summary.optionCount).toBe(1);
    expect(summary.stockSettlementCount).toBe(1);
    expect(summary.optionProfitJPY).toBeGreaterThan(0);
    expect(summary.stockRealizedGainJPY).toBe(160_000);
    expect(summary.optionAnnualReturnPct).toBeGreaterThan(0);
    expect(summary.stockAnnualReturnPct).toBeGreaterThan(0);
  });

  it("uses option close execution results for closed option history", () => {
    const putLeg = sampleAmznSimulation.optionLegs.find((leg) => leg.type === "put") ?? sampleAmznSimulation.optionLegs[0];
    const simulation = {
      ...sampleAmznSimulation,
      status: "closed" as const,
      entryDate: "2026-05-31",
      fxRateJPY: 150,
      brokerCommissionUSD: 2.25,
      brokerCommissionJPY: undefined,
      optionLegs: [
        {
          ...putLeg,
          id: "put-test",
          type: "put" as const,
          premiumUSD: 1.16,
          quantity: 1,
        },
      ],
      optionCloseExecutions: [
        {
          id: "exec-test",
          legId: "put-test",
          confirmed: true,
          closeDate: "2026-06-02",
          contracts: 1,
          closePriceUSD: 0.17,
          commissionUSD: 2.25,
          fxRateJPY: 150,
          settlementCurrency: "JPY" as const,
          source: "manual" as const,
        },
      ],
    };

    const [result] = calculateOptionCloseExecutionResults(simulation);
    expect(result.realizedPnlUSD).toBeCloseTo(94.5, 4);
    expect(result.realizedPnlJPY).toBeCloseTo(14_175, 0);
    expect(result.holdingDays).toBe(2);

    const summary = calculateTaxBucketSummary([simulation]);
    expect(summary.optionCount).toBe(1);
    expect(summary.optionCloseMissingCount).toBe(0);
    expect(summary.optionProfitJPY).toBeCloseTo(14_175, 0);
  });

  it("does not aggregate estimated option profit for closed positions without execution records", () => {
    const summary = calculateTaxBucketSummary([
      {
        ...sampleAmznSimulation,
        status: "closed",
        optionCloseExecutions: [],
      },
    ]);

    expect(summary.optionCount).toBe(0);
    expect(summary.optionCloseMissingCount).toBe(1);
    expect(summary.optionProfitJPY).toBe(0);
  });
});
