import { describe, expect, it } from "vitest";
import { resolveEvaluationQuote, calculateReferencePnl, calculateReferencePositionPnl } from "./midpointEvaluation";
describe("R15 midpoint evaluation", () => {
  it("distinguishes absent Bid, absent Ask, explicit zero, crossed and forbidden quote diagnostics", () => {
    const base = { priceTypeBid: "Indicative", priceTypeAsk: "Tradable", fetchedAt: "x", source: "fixture" };
    expect(resolveEvaluationQuote({ ...base, ask: 2 }).reason).toBe("Bidが未取得");
    expect(resolveEvaluationQuote({ ...base, bid: 2 }).reason).toBe("Askが未取得");
    expect(resolveEvaluationQuote({ ...base, bid: 0, ask: 2 })).toMatchObject({ kind: "available", mid: 1 });
    expect(resolveEvaluationQuote({ ...base, bid: -1, ask: 2 }).reason).toBe("Bidが負値です");
    expect(resolveEvaluationQuote({ ...base, bid: 3, ask: 2 }).reason).toBe("BidがAskを上回っています");
    expect(resolveEvaluationQuote({ ...base, bid: 1, ask: 2, priceTypeAsk: "NoAccess" }).reason).toContain("Ask: NoAccess");
  });
  it("uses same-candidate bid/ask midpoint", () => { const q = resolveEvaluationQuote({ bid: 8, ask: 12, priceTypeBid: "Indicative", priceTypeAsk: "Tradable", fetchedAt: "fixture", source: "fixture", delayedByMinutes: 15 }); expect(q.kind).toBe("available"); expect(q.mid).toBe(10); expect(q.delayedByMinutes).toBe(15); });
  it("keeps reference and conservative bases separate", () => { const r = calculateReferencePnl({ side: "buy", startPrice: 10, quote: { bid: 8, ask: 12 }, contracts: 1, contractSize: 100, entryFee: 2, closeFee: 2 }); expect(r.referencePnl).toBe(-4); expect(r.conservativePnl).toBe(-204); });
  it("rejects invalid and marks OldIndicative confirmable", () => { expect(resolveEvaluationQuote({ bid: 12, ask: 8, fetchedAt: "fixture", source: "fixture" }).kind).toBe("unavailable"); expect(resolveEvaluationQuote({ bid: 8, ask: 12, priceTypeBid: "OldIndicative", priceTypeAsk: "Indicative", fetchedAt: "fixture", source: "fixture" }).kind).toBe("confirmable_reference"); expect(resolveEvaluationQuote({ bid: 8, ask: 12, priceTypeBid: "Theor", priceTypeAsk: "Indicative", fetchedAt: "fixture", source: "fixture" }).kind).toBe("unavailable"); expect(resolveEvaluationQuote({ bid: Number.MAX_VALUE, ask: Number.MAX_VALUE, priceTypeBid: "Indicative", priceTypeAsk: "Tradable", fetchedAt: "fixture", source: "fixture" }).kind).toBe("unavailable"); });
});
