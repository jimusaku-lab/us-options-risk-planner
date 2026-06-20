import { describe, expect, it } from "vitest";
import { calculateStockHoldingEvaluation } from "./stockHoldingEvaluation";

describe("stock holding evaluation", () => {
  it("uses Saxo current price before app current price", () => {
    const evaluation = calculateStockHoldingEvaluation({
      ticker: "NVDA",
      shares: 100,
      averageCostUSD: 207.5,
      appCurrentPriceUSD: 220,
      fxRateJPY: 160,
      saxoPosition: {
        currentPrice: 225,
        fetchedAt: "2026-06-20T10:00:00Z",
      },
    });

    expect(evaluation?.source).toBe("saxo_position");
    expect(evaluation?.currentPriceUSD).toBe(225);
    expect(evaluation?.costBasisUSD).toBe(20_750);
    expect(evaluation?.marketValueUSD).toBe(22_500);
    expect(evaluation?.unrealizedPnlUSD).toBe(1_750);
    expect(evaluation?.unrealizedPnlPct).toBeCloseTo(8.4337, 4);
    expect(evaluation?.marketValueJPY).toBe(3_600_000);
  });

  it("derives current price from Saxo market value when price is missing", () => {
    const evaluation = calculateStockHoldingEvaluation({
      ticker: "NVDA",
      shares: 100,
      averageCostUSD: 207.5,
      appCurrentPriceUSD: 220,
      fxRateJPY: 160,
      saxoPosition: {
        marketValue: 22_600,
        unrealizedPnl: 1_850,
      },
    });

    expect(evaluation?.currentPriceUSD).toBe(226);
    expect(evaluation?.marketValueUSD).toBe(22_600);
    expect(evaluation?.unrealizedPnlUSD).toBe(1_850);
    expect(evaluation?.appCalculatedUnrealizedPnlUSD).toBe(1_850);
  });

  it("falls back to app current price without treating missing values as zero", () => {
    const evaluation = calculateStockHoldingEvaluation({
      ticker: "NVDA",
      shares: 100,
      averageCostUSD: 207.5,
      appCurrentPriceUSD: 210,
      fxRateJPY: 0,
    });

    expect(evaluation?.source).toBe("app_current_price");
    expect(evaluation?.currentPriceUSD).toBe(210);
    expect(evaluation?.marketValueUSD).toBe(21_000);
    expect(evaluation?.unrealizedPnlUSD).toBe(250);
    expect(evaluation?.marketValueJPY).toBeUndefined();
  });
});
