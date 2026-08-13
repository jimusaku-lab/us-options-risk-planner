import { describe, expect, it } from "vitest";
import { calculateReferenceTotalAssetsBreakdownJPY, calculateReferenceTotalAssetsJPY, formatReferenceTotalAssetsJPY } from "./referenceTotalAssets";

const freshQuote = { pair: "USDJPY" as const, rate: 150.255, date: "2026-08-10", source: "local_proxy" as const, fetchedAt: "2026-08-10T00:10:00.000Z" };

describe("calculateReferenceTotalAssetsJPY", () => {
  it("uses only P/N account net assets and rounds the JPY total", () => {
    expect(calculateReferenceTotalAssetsJPY({ pSaxoTotalValueJPY: 1_000_000, nSaxoTotalValueUSD: 20_000, fxQuote: freshQuote })).toBe(4_005_100);
    expect(formatReferenceTotalAssetsJPY(4_005_100)).toBe("¥4,005,100");
  });

  it("rounds each displayed account value but rounds the reference total from unrounded inputs", () => {
    expect(calculateReferenceTotalAssetsBreakdownJPY({ pSaxoTotalValueJPY: 100.4, nSaxoTotalValueUSD: 1, fxQuote: { ...freshQuote, rate: 0.4 } })).toEqual({
      pAccountAssetsJPY: 100,
      nAccountAssetsJPY: 0,
      referenceTotalAssetsJPY: 101,
    });
  });

  it("uses a prior-business-day quote but rejects unavailable or invalid rates", () => {
    expect(calculateReferenceTotalAssetsJPY({ pSaxoTotalValueJPY: 1, nSaxoTotalValueUSD: 1, fxQuote: { ...freshQuote, date: "2026-08-08", fetchedAt: "2026-08-10T00:10:00.000Z" } })).toBe(151);
    expect(calculateReferenceTotalAssetsJPY({ pSaxoTotalValueJPY: 1, nSaxoTotalValueUSD: 1 })).toBeUndefined();
    expect(calculateReferenceTotalAssetsJPY({ pSaxoTotalValueJPY: 1, nSaxoTotalValueUSD: 1, fxQuote: { ...freshQuote, rate: 0 } })).toBeUndefined();
    expect(calculateReferenceTotalAssetsJPY({ pSaxoTotalValueJPY: 1, nSaxoTotalValueUSD: 1, fxQuote: { ...freshQuote, rate: -1 } })).toBeUndefined();
    expect(calculateReferenceTotalAssetsJPY({ pSaxoTotalValueJPY: 1, nSaxoTotalValueUSD: 1, fxQuote: { ...freshQuote, rate: Number.NaN } })).toBeUndefined();
    expect(formatReferenceTotalAssetsJPY(undefined)).toBe("—");
    expect(calculateReferenceTotalAssetsBreakdownJPY({ pSaxoTotalValueJPY: 1, fxQuote: freshQuote })).toBeUndefined();
  });

  it("does not depend on buying power, margin, cash, or profit values", () => {
    const base = { pSaxoTotalValueJPY: 900_000, nSaxoTotalValueUSD: 10_000, fxQuote: freshQuote };
    expect(calculateReferenceTotalAssetsJPY(base)).toBe(calculateReferenceTotalAssetsJPY({ ...base, buyingPower: 1, marginAvailable: 999_999, cashBalance: 0, pnl: -500 } as typeof base));
  });
});
