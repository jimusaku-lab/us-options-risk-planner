import { describe, expect, it } from "vitest";
import type { TradeSimulation } from "@/types/domain";
import { calculateOptionCloseExecutionResults } from "./optionCloseExecutions";
import { calculateHistoryCashflowDisplay } from "./historyCashflowDisplay";

function simulation(patch: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    id: "history-cashflow",
    status: "closed",
    name: "Anonymous option",
    ticker: "COO",
    underlyingName: "Anonymous",
    strategyType: "long_put",
    currentPriceUSD: 0,
    fxRateJPY: 150,
    accountCode: "N",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    entryDate: "2026-08-01",
    expiryDate: "2026-10-16",
    dte: 76,
    accountCurrency: "USD",
    stockPosition: null,
    optionLegs: [{ id: "leg", type: "put", side: "buy", strikeUSD: 100, premiumUSD: 7.9, quantity: 1, expiryDate: "2026-10-16" }],
    optionEntryExecutions: [{ id: "entry", legId: "leg", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 7.9, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true }],
    optionCloseExecutions: [{ id: "close", legId: "leg", closeKind: "buyback", closeDate: "2026-08-14", contracts: 1, closePriceUSD: 23, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: 1505.52, source: "manual", confirmed: true }],
    brokerMarginJPY: 0,
    brokerMarginUSD: 0,
    marginBufferMultiplier: 1,
    marginUsagePercent: 0,
    availableCashJPY: 0,
    denominatorMode: "cash_secured",
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    beginnerMode: false,
    ...patch,
  };
}

function display(value: TradeSimulation) {
  return calculateHistoryCashflowDisplay(value, calculateOptionCloseExecutionResults(value));
}

describe("history cashflow display", () => {
  it("shows the COO buy entry payment and sale receipt net of each fee", () => {
    expect(display(simulation())).toMatchObject({
      available: true,
      entry: { amountUSD: -792.24, label: "建玉時支払" },
      close: { amountUSD: 2297.76, label: "決済時受取" },
      realizedPnlUSD: 1505.52,
      reconciles: true,
    });
  });

  it.each([
    ["buy loss", "buy", 1, 0.3, -74.48, -102.24, 27.76],
    ["sell profit", "sell", 3.75, 1, 270.52, 372.76, -102.24],
    ["sell loss", "sell", 3.75, 5, -129.48, 372.76, -502.24],
  ] as const)("keeps signed fee-inclusive cashflow for %s", (_name, side, entryPrice, closePrice, pnl, entryAmount, closeAmount) => {
    const value = simulation({
      strategyType: side === "sell" ? "short_put" : "long_put",
      optionLegs: [{ ...simulation().optionLegs[0], side, premiumUSD: entryPrice }],
      optionEntryExecutions: [{ ...simulation().optionEntryExecutions![0], fillPriceUSD: entryPrice }],
      optionCloseExecutions: [{ ...simulation().optionCloseExecutions![0], closePriceUSD: closePrice, realizedPnlUSD: pnl }],
    });
    const result = display(value);
    expect(result.available).toBe(true);
    if (result.available) expect([result.entry.amountUSD, result.close.amountUSD, result.realizedPnlUSD, result.reconciles]).toEqual([entryAmount, closeAmount, pnl, true]);
  });

  it("distinguishes explicit expiration fee, zero, and missing evidence", () => {
    const zero = simulation({ optionCloseExecutions: [{ ...simulation().optionCloseExecutions![0], closeKind: "expired", closePriceUSD: undefined, commissionUSD: 0, realizedPnlUSD: -792.24 }] });
    expect(display(zero)).toMatchObject({ available: true, close: { amountUSD: 0, label: "満期時受払" } });

    const charged = simulation({ optionCloseExecutions: [{ ...simulation().optionCloseExecutions![0], closeKind: "expired", closePriceUSD: undefined, commissionUSD: 2.24, realizedPnlUSD: -794.48 }] });
    expect(display(charged)).toMatchObject({ available: true, close: { amountUSD: -2.24, label: "満期時支払" }, reconciles: true });

    const missing = simulation({ optionCloseExecutions: [{ ...simulation().optionCloseExecutions![0], closeKind: "expired", closePriceUSD: undefined, commissionUSD: undefined, realizedPnlUSD: -792.24 }] });
    expect(display(missing)).toEqual({ available: false, reason: "入出金内訳 未確認" });
  });

  it("aggregates multiple allocated closes without repeating entry cost", () => {
    const value = simulation({
      optionLegs: [{ ...simulation().optionLegs[0], quantity: 2, premiumUSD: 1 }],
      optionEntryExecutions: [{ ...simulation().optionEntryExecutions![0], contracts: 2, fillPriceUSD: 1, commissionUSD: 4.48 }],
      optionCloseExecutions: [
        { ...simulation().optionCloseExecutions![0], id: "close-1", closePriceUSD: 2, realizedPnlUSD: 95.52 },
        { ...simulation().optionCloseExecutions![0], id: "close-2", closePriceUSD: 3, realizedPnlUSD: 195.52 },
      ],
    });
    expect(display(value)).toMatchObject({
      available: true,
      entry: { amountUSD: -204.48 },
      close: { amountUSD: 495.52 },
      realizedPnlUSD: 291.04,
      reconciles: true,
      executionCount: 2,
    });
  });

  it("does not fill unknown fees or create USD cashflow for P/JPY", () => {
    const unknown = simulation({ optionEntryExecutions: [{ ...simulation().optionEntryExecutions![0], commissionUSD: undefined }] });
    expect(display(unknown)).toEqual({ available: false, reason: "入出金内訳 未確認" });
    const pJpy = simulation({ accountCode: "P", accountEnvironment: "PROD_P_JPY_SETTLEMENT", accountCurrency: "JPY" });
    expect(display(pJpy)).toEqual({ available: false, reason: "JPY入出金は確定JPY実績を使用" });
  });

  it("accepts cent-rounding noise but rejects a material mismatch", () => {
    const value = simulation();
    const roundedResults = calculateOptionCloseExecutionResults(value).map((result) => ({ ...result, realizedPnlUSD: result.realizedPnlUSD + 0.004 }));
    expect(calculateHistoryCashflowDisplay(value, roundedResults)).toMatchObject({ available: true, reconciles: true });
    const conflictingResults = calculateOptionCloseExecutionResults(value).map((result) => ({ ...result, realizedPnlUSD: result.realizedPnlUSD + 1 }));
    expect(calculateHistoryCashflowDisplay(value, conflictingResults)).toEqual({ available: false, reason: "入出金と実現損益 不一致" });
  });
});
