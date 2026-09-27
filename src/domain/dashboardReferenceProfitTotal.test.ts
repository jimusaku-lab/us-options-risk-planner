import { describe, expect, it } from "vitest";
import { aggregateDashboardReferenceProfit } from "./dashboardReferenceProfitTotal";

const row = (currency: string, kind: "available" | "missing", amount?: number, eligible = true) => ({ eligible, fallbackCurrency: currency, reference: { kind, currency, amount } });

describe("dashboard reference profit total", () => {
  it("keeps USD and JPY separate and aggregates signed amounts without conversion", () => {
    expect(aggregateDashboardReferenceProfit([row("USD", "available", 12.345), row("USD", "available", -2.345), row("JPY", "available", 0), row("JPY", "available", -120)])).toEqual({
      USD: { currency: "USD", amount: 10, computedCount: 2, eligibleCount: 2 },
      JPY: { currency: "JPY", amount: -120, computedCount: 2, eligibleCount: 2 },
      unknownCurrencyCount: 0,
    });
  });
  it("does not zero-fill missing, non-finite, ineligible, or unknown-currency values", () => {
    expect(aggregateDashboardReferenceProfit([row("USD", "missing"), row("USD", "available", Number.NaN), row("JPY", "available", 44, false), row("EUR", "available", 8)])).toEqual({
      USD: { currency: "USD", computedCount: 0, eligibleCount: 2 },
      JPY: { currency: "JPY", computedCount: 0, eligibleCount: 0 },
      unknownCurrencyCount: 1,
    });
  });
  it("groups available references by their displayed currency rather than account currency", () => {
    expect(aggregateDashboardReferenceProfit([{ eligible: true, fallbackCurrency: "JPY", reference: { kind: "available", currency: "USD", amount: 12.5 } }])).toEqual({
      USD: { currency: "USD", amount: 12.5, computedCount: 1, eligibleCount: 1 },
      JPY: { currency: "JPY", computedCount: 0, eligibleCount: 0 },
      unknownCurrencyCount: 0,
    });
  });
  it("distinguishes all-missing from a valid zero", () => {
    const result = aggregateDashboardReferenceProfit([row("USD", "missing"), row("JPY", "available", 0)]);
    expect(result.USD.amount).toBeUndefined();
    expect(result.USD).toMatchObject({ computedCount: 0, eligibleCount: 1 });
    expect(result.JPY).toMatchObject({ amount: 0, computedCount: 1, eligibleCount: 1 });
  });
  it("counts a parent once when child rows are not eligible", () => {
    expect(aggregateDashboardReferenceProfit([row("USD", "available", 25), row("USD", "available", 25, false)]).USD).toMatchObject({ amount: 25, computedCount: 1, eligibleCount: 1 });
  });
});
