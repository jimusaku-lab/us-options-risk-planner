import { describe, expect, it } from "vitest";
import { applyCurrentOptionPricePreview, createCurrentOptionPricePreviewRow, getCurrentOptionPriceTargets } from "./bulkOptionPrice";
import type { TradeSimulation } from "@/types/domain";

const synthetic = (): TradeSimulation => ({ id: "parent", name: "parent", ticker: "PARENT", strategyType: "synthetic_forward", status: "open", accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD", entryDate: "2026-09-01", expiryDate: "2026-12-18", dte: 86, fxRateJPY: 150, currentPriceUSD: 100, stockPosition: null, brokerMarginJPY: 0, brokerMarginUSD: 0, marginBufferMultiplier: 1, denominatorMode: "cash_secured", taxProfileId: "japan_derivative_separate_tax_user_confirm", optionLegs: [{ id: "call", type: "call", side: "buy", strikeUSD: 100, premiumUSD: 2, quantity: 1, contractSize: 100, expiryDate: "2026-12-18" }, { id: "put", type: "put", side: "sell", strikeUSD: 100, premiumUSD: 2, quantity: 1, contractSize: 100, expiryDate: "2026-12-18" }] });
const applyPair = (value: number, batchId = `batch-${value}`, simulation = synthetic()) => { const callPrice = 6 + value / 200; const putPrice = 6 - value / 200; const rows = getCurrentOptionPriceTargets([simulation]).map(target => createCurrentOptionPricePreviewRow(target, { environment: "live", fetchedAt: "2026-09-23T01:00:00.000Z", status: "available", classification: "available", source: "test", message: "ok", ...(target.side === "buy" ? { bid: callPrice } : { ask: putPrice }) })); return applyCurrentOptionPricePreview([simulation], rows, { capturedAt: "2026-09-23T01:00:00.000Z", batchId })[0]; };

describe("R14 parent time-value evidence", () => {
  it("persists one parent record only after all residual legs share one batch", () => {
    const original = synthetic();
    const rows = getCurrentOptionPriceTargets([original]).map(target => createCurrentOptionPricePreviewRow(target, { environment: "live", fetchedAt: "2026-09-23T01:00:00.000Z", status: "available", classification: "available", source: "test", message: "ok", ...(target.side === "buy" ? { bid: 4 } : { ask: 3 }) }));
    const [next] = applyCurrentOptionPricePreview([original], rows, { capturedAt: "2026-09-23T01:00:00.000Z", batchId: "batch-parent" });
    expect(next.timeValueParentHistory).toHaveLength(1);
    expect(next.timeValueParentHistory?.[0].positionValueUSD).toBe(100);
    expect(next.timeValueParentUpdateReason).toBeUndefined();
  });
  it("does not create a parent when an atomic composite apply is incomplete", () => {
    const original = synthetic();
    const targets = getCurrentOptionPriceTargets([original]);
    const row = createCurrentOptionPricePreviewRow(targets[0], { environment: "live", fetchedAt: "2026-09-23T01:00:00.000Z", status: "available", classification: "available", source: "test", message: "ok", bid: 4 });
    const [next] = applyCurrentOptionPricePreview([original], [row], { capturedAt: "2026-09-23T01:00:00.000Z", batchId: "batch-partial" });
    expect(next.timeValueParentHistory).toBeUndefined();
    expect(next.optionLegs.every(leg => leg.closeCostUSD === undefined)).toBe(true);
  });
  it.each([[192], [-208], [996], [-1004]])("preserves the signed parent amount %s", expected => { expect(applyPair(expected).timeValueParentHistory?.[0].positionValueUSD).toBe(expected); });
  it("retains superseded same-day accounting evidence", () => { const first = applyPair(192, "revision-one"); const revised = { ...first, optionEntryExecutions: first.optionLegs.map(leg => ({ id: `revised-${leg.id}`, legId: leg.id, tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: leg.premiumUSD, commissionUSD: 0, settlementCurrency: "USD" as const, confirmed: true, source: "manual" as const })) }; const second = applyPair(-208, "revision-two", revised); expect(second.timeValueParentHistory?.[0].positionValueUSD).toBe(-208); expect(second.timeValueParentHistory?.[0].superseded?.[0].positionValueUSD).toBe(192); });
  it("does not manufacture parent fees without evidence", () => { const result = applyPair(192, "missing-fee", { ...synthetic(), accountEnvironment: "DEMO_JPY_BASE" }); expect(result.timeValueParentHistory?.[0].closeFeeUSD).toBeUndefined(); expect(result.timeValueParentHistory?.[0].closeCashflowUSD).toBeUndefined(); });
});
