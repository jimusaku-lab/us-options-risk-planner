export type DashboardReferenceProfitRow = {
  eligible: boolean;
  /** Account currency is used only when the valuation itself is missing. */
  fallbackCurrency?: string;
  reference: { kind: "available" | "missing"; currency?: string; amount?: number };
};

export type DashboardCurrencyProfitTotal = {
  currency: "USD" | "JPY";
  amount?: number;
  computedCount: number;
  eligibleCount: number;
};

export type DashboardReferenceProfitTotal = {
  USD: DashboardCurrencyProfitTotal;
  JPY: DashboardCurrencyProfitTotal;
  unknownCurrencyCount: number;
};

/** Sum finite row-level reference amounts without converting or zero-filling missing values. */
export function aggregateDashboardReferenceProfit(
  rows: readonly DashboardReferenceProfitRow[],
): DashboardReferenceProfitTotal {
  const totals: DashboardReferenceProfitTotal = {
    USD: { currency: "USD", computedCount: 0, eligibleCount: 0 },
    JPY: { currency: "JPY", computedCount: 0, eligibleCount: 0 },
    unknownCurrencyCount: 0,
  };

  for (const row of rows) {
    if (!row.eligible) continue;
    const currency = row.reference.kind === "available" ? row.reference.currency : row.fallbackCurrency;
    if (currency !== "USD" && currency !== "JPY") {
      totals.unknownCurrencyCount += 1;
      continue;
    }
    const total = totals[currency];
    total.eligibleCount += 1;
    if (row.reference.kind !== "available" || row.reference.currency !== currency || row.reference.amount === undefined || !Number.isFinite(row.reference.amount)) continue;
    total.amount = (total.amount ?? 0) + row.reference.amount;
    total.computedCount += 1;
  }
  return totals;
}
