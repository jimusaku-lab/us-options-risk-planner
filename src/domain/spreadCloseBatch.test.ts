import { describe, expect, it } from "vitest";
import type { OptionCloseExecution, TradeSimulation } from "@/types/domain";
import { previewBearPutSpreadCloseBatch, previewVerticalSpreadCloseBatch } from "./spreadCloseBatch";

const spread = (): TradeSimulation => ({ id: "R12-parent", status: "open", name: "Anonymous", ticker: "TEST", strategyType: "bear_put_spread", currentPriceUSD: 95, fxRateJPY: 0, accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD", entryDate: "2026-09-01", expiryDate: "2026-10-02", dte: 31, stockPosition: null, optionLegs: [{ id: "long", type: "put", side: "buy", strikeUSD: 100, premiumUSD: 4.92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02" }, { id: "short", type: "put", side: "sell", strikeUSD: 90, premiumUSD: .92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02" }], optionEntryExecutions: [{ id: "entry-long", legId: "long", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 4.92, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true }, { id: "entry-short", legId: "short", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: .92, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true }], brokerMarginJPY: 0, marginBufferMultiplier: 1, denominatorMode: "custom", taxProfileId: "none_nisa_or_tax_free_comparison" });
const close = (id: string, legId: "long" | "short", patch: Partial<OptionCloseExecution> = {}): OptionCloseExecution => ({ id, legId, closeKind: "buyback", closeDate: "2026-09-10", contracts: 1, closePriceUSD: legId === "long" ? 4.5 : .84, commissionUSD: 2.24, settlementCurrency: "USD", source: "saxo_history", sourceCandidateId: `candidate-${id}`, confirmationStatus: "pending", confirmed: false, ...patch });
const managedTwoLeg = (strategyType: "synthetic_forward" | "combo" | "short_strangle" | "custom"): TradeSimulation => {
  const shapes = {
    synthetic_forward: [{ type: "call" as const, side: "buy" as const, strikeUSD: 100, premiumUSD: 4, closePriceUSD: 3 }, { type: "put" as const, side: "sell" as const, strikeUSD: 100, premiumUSD: 3, closePriceUSD: 1 }],
    combo: [{ type: "call" as const, side: "buy" as const, strikeUSD: 100, premiumUSD: 4, closePriceUSD: 3 }, { type: "put" as const, side: "sell" as const, strikeUSD: 90, premiumUSD: 3, closePriceUSD: 1 }],
    short_strangle: [{ type: "call" as const, side: "sell" as const, strikeUSD: 110, premiumUSD: 4, closePriceUSD: 3 }, { type: "put" as const, side: "sell" as const, strikeUSD: 90, premiumUSD: 3, closePriceUSD: 2 }],
    custom: [{ type: "call" as const, side: "buy" as const, strikeUSD: 105, premiumUSD: 5, closePriceUSD: 4 }, { type: "put" as const, side: "sell" as const, strikeUSD: 85, premiumUSD: 2, closePriceUSD: 1 }],
  }[strategyType];
  const input = spread(); input.strategyType = strategyType;
  input.optionLegs = shapes.map((shape, index) => ({ id: index === 0 ? "long" : "short", type: shape.type, side: shape.side, strikeUSD: shape.strikeUSD, premiumUSD: shape.premiumUSD, quantity: 1, contractSize: 100, expiryDate: "2026-10-02" }));
  input.optionEntryExecutions = input.optionLegs.map((leg) => ({ id: `entry-${leg.id}`, legId: leg.id, tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: leg.premiumUSD, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true }));
  input.optionCloseExecutions = input.optionLegs.map((leg, index) => close(`close-${leg.id}`, leg.id as "long" | "short", { closePriceUSD: shapes[index].closePriceUSD }));
  return input;
};

describe("R12 public anonymous close batch", () => {
  it("shows two rows and blocks either missing leg", () => {
    for (const execution of [close("only-short", "short"), close("only-long", "long")]) {
      const result = previewBearPutSpreadCloseBatch({ ...spread(), optionCloseExecutions: [execution] });
      expect(result.rows).toHaveLength(2); expect(result.ready).toBe(false); expect(result.rows.map((row) => row.state).sort()).toEqual(["not_acquired", "ready"]);
    }
  });
  it("confirms both in one immutable terminal snapshot", () => {
    const input = { ...spread(), optionCloseExecutions: [close("short", "short"), close("long", "long")] }, before = JSON.stringify(input);
    const result = previewBearPutSpreadCloseBatch(input);
    expect(result).toMatchObject({ ready: true, newlyConfirmedCount: 2, combinedRealizedPnlUSD: -42.96, totalCostsUSD: 8.96 });
    expect(result.nextSimulation?.status).toBe("closed"); expect(JSON.stringify(input)).toBe(before);
  });
  it.each([
    ["bull_call_spread", "call", 90, 100],
    ["bear_call_spread", "call", 100, 90],
    ["bull_put_spread", "put", 90, 100],
    ["bear_put_spread", "put", 100, 90],
  ] as const)("uses the same immutable two-leg terminal batch for %s", (strategyType, optionType, buyStrike, sellStrike) => {
    const input = spread();
    input.strategyType = strategyType;
    input.optionLegs = [
      { ...input.optionLegs[0], type: optionType, strikeUSD: buyStrike },
      { ...input.optionLegs[1], type: optionType, strikeUSD: sellStrike },
    ];
    input.optionCloseExecutions = [close("close-buy", "long"), close("close-sell", "short")];
    const before = JSON.stringify(input);
    const result = previewVerticalSpreadCloseBatch(input);
    expect(result).toMatchObject({ applies: true, ready: true, newlyConfirmedCount: 2 });
    expect(result.nextSimulation?.status).toBe("closed");
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each([
    ["synthetic_forward", ["call:buy", "put:sell"], 91.04],
    ["combo", ["call:buy", "put:sell"], 91.04],
    ["short_strangle", ["call:sell", "put:sell"], 191.04],
    ["custom", ["call:buy", "put:sell"], -8.96],
  ] as const)("uses the same evidence-only parent batch for managed non-vertical %s without applying a vertical contract", (strategyType, expectedLegs, expectedPnl) => {
    const input = managedTwoLeg(strategyType);
    const result = previewVerticalSpreadCloseBatch(input);
    expect(result).toMatchObject({ applies: true, ready: true, newlyConfirmedCount: 2 });
    expect(result.rows.map((row) => `${row.leg.type}:${row.leg.side}`)).toEqual(expectedLegs);
    expect(result.combinedRealizedPnlUSD).toBeCloseTo(expectedPnl, 6);
    expect(result.nextSimulation?.status).toBe("closed");
    expect(result.nextSimulation?.optionCloseExecutions?.filter((execution) => execution.confirmed)).toHaveLength(2);
  });
  it("preserves one saved leg and blocks pending accounting, invalid quantity, and missing costs", () => {
    const saved = close("saved", "long", { confirmed: true, confirmationStatus: "confirmed" });
    const audit = close("voided", "short", { voided: true, confirmationStatus: "ignored" });
    const preserved = previewBearPutSpreadCloseBatch({ ...spread(), optionCloseExecutions: [saved, audit, close("short", "short")] });
    expect(preserved).toMatchObject({ ready: true, newlyConfirmedCount: 1 });
    expect(preserved.nextSimulation?.optionCloseExecutions).toHaveLength(3);
    expect(preserved.nextSimulation?.optionCloseExecutions?.[1]).toEqual(audit);
    expect(previewBearPutSpreadCloseBatch({ ...spread(), optionCloseExecutions: [close("long", "long", { accountingStatus: "pending" }), close("short", "short")] }).ready).toBe(false);
    expect(previewBearPutSpreadCloseBatch({ ...spread(), optionCloseExecutions: [close("long", "long", { contracts: 2 }), close("short", "short")] }).ready).toBe(false);
    expect(previewBearPutSpreadCloseBatch({ ...spread(), optionCloseExecutions: [close("long", "long", { commissionUSD: undefined }), close("short", "short")] }).ready).toBe(false);
  });
  it("retains a non-voided ignored audit record without confirming or calculating it", () => {
    const ignored = close("ignored-audit", "short", { confirmationStatus: "ignored", closePriceUSD: 999, commissionUSD: 999 });
    const result = previewBearPutSpreadCloseBatch({ ...spread(), optionCloseExecutions: [ignored, close("short-close", "short"), close("long-close", "long")] });
    expect(result).toMatchObject({ ready: true, newlyConfirmedCount: 2, combinedRealizedPnlUSD: -42.96, totalCostsUSD: 8.96 });
    expect(result.pendingExecutionIds).not.toContain(ignored.id);
    expect(result.nextSimulation?.optionCloseExecutions?.find((execution) => execution.id === ignored.id)).toEqual(ignored);
  });
});
