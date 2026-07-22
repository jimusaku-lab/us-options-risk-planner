import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import type { TradeSimulation } from "@/types/domain";
import { getCompositeAssignmentFunding, getCompositeOptionLifecycle, getSyntheticForwardMarginCheck, getSyntheticForwardTicketNetPremiumUSD, isSyntheticForwardEntryConfirmation, isSyntheticForwardEntrySaved, shouldIncludeCompositeCloseResultsInPerformance, shouldRecoverSaxoSyntheticForwardEntryConfirmation, validateCompositeOptionPosition, validateSyntheticForwardTicketForOpen } from "./compositeOptionPosition";

function composite(strategyType: "synthetic_forward" | "combo", callStrike = 205, putStrike = 205): TradeSimulation {
  const call = { id: "combo-call", type: "call" as const, side: "buy" as const, strikeUSD: callStrike, premiumUSD: 8, quantity: 1, expiryDate: "2026-09-18" };
  const put = { id: "combo-put", type: "put" as const, side: "sell" as const, strikeUSD: putStrike, premiumUSD: 7, quantity: 1, expiryDate: "2026-09-18", putIntent: "accept_assignment" as const };
  return { ...sampleAmznSimulation, id: `test-${strategyType}`, status: "open", ticker: "NVDA", strategyType, accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD", expiryDate: "2026-09-18", optionLegs: [call, put], optionEntryExecutions: [], optionCloseExecutions: [] };
}
function entry(legId: string, contracts = 1) { return { id: `entry-${legId}-${contracts}`, legId, tradeDate: "2026-07-16", contracts, fillPriceUSD: 1, settlementCurrency: "USD" as const, source: "manual" as const, confirmed: true }; }
function close(legId: string, contracts = 1) { return { id: `close-${legId}-${contracts}`, legId, closeDate: "2026-07-17", contracts, closePriceUSD: 1, settlementCurrency: "USD" as const, source: "manual" as const, confirmed: true }; }

describe("composite option positions", () => {
  it("accepts a same-expiry/same-strike C buy + P sell synthetic forward", () => expect(validateCompositeOptionPosition(composite("synthetic_forward")).valid).toBe(true));
  it("rejects synthetic-forward strike, expiry, quantity, and leg-account mismatches", () => {
    const invalid = composite("synthetic_forward", 205, 200);
    invalid.optionLegs[1] = { ...invalid.optionLegs[1], expiryDate: "2026-10-16", quantity: 2, saxoAccountKey: "other" };
    invalid.optionLegs[0] = { ...invalid.optionLegs[0], saxoAccountKey: "account" };
    const result = validateCompositeOptionPosition(invalid);
    expect(result.valid).toBe(false); expect(result.reasons.join(" ")).toContain("同一"); expect(result.reasons.join(" ")).toContain("Saxo口座");
  });
  it("accepts a combo with a put strike at or below the call strike", () => expect(validateCompositeOptionPosition(composite("combo", 210, 200)).valid).toBe(true));
  it("keeps a parent in partial entry until both Saxo-matched legs are confirmed", () => {
    const position = composite("synthetic_forward"); position.optionEntryExecutions = [entry("combo-call")]; expect(getCompositeOptionLifecycle(position)?.state).toBe("partial_entry"); position.optionEntryExecutions.push(entry("combo-put")); expect(getCompositeOptionLifecycle(position)?.state).toBe("open");
  });
  it("marks only an open parent with both confirmed legs as saved", () => {
    const position = composite("synthetic_forward"); position.optionEntryExecutions = [entry("combo-call"), entry("combo-put")]; expect(isSyntheticForwardEntrySaved(position)).toBe(true); position.status = "entry_confirmation"; expect(isSyntheticForwardEntrySaved(position)).toBe(false);
  });
  it("recovers only unconfirmed Saxo synthetic imports into entry confirmation", () => {
    const position = composite("synthetic_forward"); position.status = "planned"; expect(shouldRecoverSaxoSyntheticForwardEntryConfirmation(position, true)).toBe(true);
    position.status = "open"; position.fixtureMeta = { source: "live", isRealMoney: true, broker: "SaxoBank", purpose: "development-fixture", createdAt: "2026-07-16", notes: "Saxo SyntheticUnderlying親注文と二脚の約定履歴を照合して建玉中として反映しました。" }; position.optionEntryExecutions = []; expect(shouldRecoverSaxoSyntheticForwardEntryConfirmation(position, true)).toBe(true); position.optionEntryExecutions = [{ ...entry("combo-call"), confirmed: false }]; expect(shouldRecoverSaxoSyntheticForwardEntryConfirmation(position, true)).toBe(true);
    position.optionEntryExecutions[0].confirmed = true; expect(shouldRecoverSaxoSyntheticForwardEntryConfirmation(position, true)).toBe(false);
    position.status = "entry_confirmation"; expect(isSyntheticForwardEntryConfirmation(position)).toBe(true); expect(shouldRecoverSaxoSyntheticForwardEntryConfirmation(position, true)).toBe(false);
  });
  it("keeps a parent in partial close and holds performance until both legs are confirmed", () => {
    const position = composite("synthetic_forward"); position.optionEntryExecutions = [entry("combo-call"), entry("combo-put")]; position.optionCloseExecutions = [close("combo-call")]; expect(getCompositeOptionLifecycle(position)?.state).toBe("partial_close"); expect(shouldIncludeCompositeCloseResultsInPerformance(position)).toBe(false); position.optionCloseExecutions.push(close("combo-put")); expect(getCompositeOptionLifecycle(position)?.state).toBe("closed"); expect(shouldIncludeCompositeCloseResultsInPerformance(position)).toBe(true);
  });
  it("keeps put assignment funding separate from the net premium", () => {
    const funding = getCompositeAssignmentFunding(composite("synthetic_forward"), { currency: "USD", cashBalance: 20_953.74 }); expect(funding).toMatchObject({ requiredUSD: 20_500, status: "sufficient" }); expect(funding?.surplusUSD).toBeCloseTo(453.74);
  });
  it("records Saxo synthetic-ticket net values without allocating them to option legs", () => {
    const position = composite("synthetic_forward", 210, 210);
    position.syntheticForwardTicket = { ticketId: "ticket-1", netOrderPriceUSD: 5.85, estimatedTotalCommissionUSD: 4.5, netFillPriceUSD: 5.85, actualTotalCommissionUSD: 4.5, requiredMarginUSD: 4_000, marginAvailableUSD: 20_874.48, assignmentAccepted: true };
    expect(getSyntheticForwardTicketNetPremiumUSD(position)).toBe(585); expect(getSyntheticForwardMarginCheck(position)).toMatchObject({ status: "sufficient", surplusUSD: 16_874.48 }); expect(validateSyntheticForwardTicketForOpen(position)).toEqual([]); expect(position.optionLegs.map((leg) => leg.premiumUSD)).toEqual([8, 7]);
  });
  it("blocks a synthetic-forward open transition until actual net values and assignment acknowledgement exist", () => {
    const position = composite("synthetic_forward", 210, 210); position.syntheticForwardTicket = { netOrderPriceUSD: 5.85, estimatedTotalCommissionUSD: 4.5 }; expect(validateSyntheticForwardTicketForOpen(position).join(" ")).toContain("ネット約定価格"); expect(validateSyntheticForwardTicketForOpen(position).join(" ")).toContain("実績総手数料");
  });
});
