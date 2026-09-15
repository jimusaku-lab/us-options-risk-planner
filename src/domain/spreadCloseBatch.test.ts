import { describe, expect, it } from "vitest";
import type { OptionCloseExecution, TradeSimulation } from "@/types/domain";
import { previewBearPutSpreadCloseBatch } from "./spreadCloseBatch";

const spread = (): TradeSimulation => ({ id: "R12-parent", status: "open", name: "Anonymous", ticker: "TEST", strategyType: "bear_put_spread", currentPriceUSD: 95, fxRateJPY: 0, accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD", entryDate: "2026-09-01", expiryDate: "2026-10-02", dte: 31, stockPosition: null, optionLegs: [{ id: "long", type: "put", side: "buy", strikeUSD: 100, premiumUSD: 4.92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02" }, { id: "short", type: "put", side: "sell", strikeUSD: 90, premiumUSD: .92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02" }], optionEntryExecutions: [{ id: "entry-long", legId: "long", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 4.92, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true }, { id: "entry-short", legId: "short", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: .92, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true }], brokerMarginJPY: 0, marginBufferMultiplier: 1, denominatorMode: "custom", taxProfileId: "none_nisa_or_tax_free_comparison" });
const close = (id: string, legId: "long" | "short", patch: Partial<OptionCloseExecution> = {}): OptionCloseExecution => ({ id, legId, closeKind: "buyback", closeDate: "2026-09-10", contracts: 1, closePriceUSD: legId === "long" ? 4.5 : .84, commissionUSD: 2.24, settlementCurrency: "USD", source: "saxo_history", sourceCandidateId: `candidate-${id}`, confirmationStatus: "pending", confirmed: false, ...patch });

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
