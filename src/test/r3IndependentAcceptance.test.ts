import { describe, expect, it } from "vitest";
import { getSaxoOrderDisplayCategory } from "@/features/saxo/SaxoReadOnlyPanel";
import { findOrderCandidatesForLeg, type SaxoApiOrderSnapshot, type SaxoApiPositionSnapshot } from "@/features/saxo/saxoAccountSync";

const order = {
  id: "fixture-order", accountAssignment: "N", accountKey: "fixture-account-a",
  environment: "live", uic: 990001, symbol: "ABC",
  optionType: "call", strike: 55, expiry: "2026-10-16", side: "sell",
  quantity: 1, status: "Working", orderType: "StopIfTraded", openClose: "unknown",
  missingFields: [], fetchedAt: "2026-09-13T00:00:00.000Z",
} satisfies SaxoApiOrderSnapshot;
const position = {
  id: "fixture-position", accountAssignment: "N", accountKey: "fixture-account-a",
  environment: "live", uic: 990001, kind: "option", symbol: "ABC",
  underlyingSymbol: "ABC", optionType: "call", strike: 55,
  expiry: "2026-10-16", side: "long", quantity: 1,
  missingFields: [], fetchedAt: "2026-09-13T00:00:00.000Z",
} satisfies SaxoApiPositionSnapshot;

describe("R3 independent acceptance: order role consistency", () => {
  it("recognizes only a complete same-account opposite-side match", () => {
    expect(getSaxoOrderDisplayCategory(order, [position])).toBe("exit_matched");
    expect(getSaxoOrderDisplayCategory({ ...order, openClose: "close" }, [position])).toBe("exit_explicit");
    expect(getSaxoOrderDisplayCategory(order, [{ ...position, accountKey: "fixture-account-b" }])).not.toBe("exit");
    expect(getSaxoOrderDisplayCategory(order, [{ ...position, quantity: undefined }])).not.toBe("exit");
  });
  it("keeps explicit opening orders out of exit reviews", () => {
    const simulation = { ticker: "ABC", accountCode: "N" } as Parameters<typeof findOrderCandidatesForLeg>[0];
    const leg = { type: "call", side: "buy", strikeUSD: 55, expiryDate: "2026-10-16", quantity: 1 } as Parameters<typeof findOrderCandidatesForLeg>[1];
    expect(findOrderCandidatesForLeg(simulation, leg, [{ ...order, openClose: "open" }])).toEqual([]);
  });
  it("rejects environment mismatch and multiple matching holdings", () => {
    expect(getSaxoOrderDisplayCategory(order, [{ ...position, environment: "sim" }])).not.toBe("exit");
    expect(getSaxoOrderDisplayCategory(order, [position, { ...position, id: "fixture-position-2" }])).not.toBe("exit");
  });
  it("uses confirmed remaining quantity for the actionable review", () => {
    const leg = { id: "fixture-leg", type: "call", side: "buy", strikeUSD: 55, expiryDate: "2026-10-16", quantity: 2, saxoAccountKey: "fixture-account-a", saxoUic: 990001 } as Parameters<typeof findOrderCandidatesForLeg>[1];
    const simulation = { id: "fixture-simulation", status: "open", ticker: "ABC", accountCode: "N", optionLegs: [leg], optionCloseExecutions: [{ id: "confirmed-close", legId: leg.id, contracts: 1, confirmed: true }] } as Parameters<typeof findOrderCandidatesForLeg>[0];
    expect(findOrderCandidatesForLeg(simulation, leg, [{ ...order, quantity: 1 }])).toHaveLength(1);
    expect(findOrderCandidatesForLeg(simulation, leg, [{ ...order, quantity: 2 }])).toEqual([]);
  });
});
