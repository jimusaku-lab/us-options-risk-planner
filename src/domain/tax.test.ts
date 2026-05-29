import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import { calculateStockSettlementTaxResult } from "./tax";
import { calculateTaxBucketSummary } from "./taxBucketSummary";

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
});
