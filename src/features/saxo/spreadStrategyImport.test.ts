import { describe, expect, it } from "vitest";
import { commitStrategyImport, emptyStrategyLedger, prepareStrategyImport } from "@/domain/strategyLedger";
import { getSpreadImportIssueGroups, getSpreadImportIssues, reconcileStrategyCandidates, type SpreadImportSnapshot } from "./spreadStrategyImport";
import type { TradeSimulation } from "@/types/domain";

function fixture(): SpreadImportSnapshot {
  const positions = (["long", "short"] as const).map((side, i) => ({ id: `TEST-position-${i}`, positionId: `TEST-position-${i}`, accountKey: "TEST-N", accountAssignment: "N" as const, accountCode: "N" as const,
    symbol: "TEST", underlyingSymbol: "TEST", underlyingIdentity: "uic:990000:stock", kind: "option" as const, assetType: "StockOption", optionType: "put" as const, side,
    strike: i ? 90 : 100, expiry: "2026-10-02", quantity: i ? -1 : 1, contractSize: 100, currency: "USD", uic: 990001 + i, missingFields: [], fetchedAt: "2026-09-12T00:00:00Z" }));
  return { environment: "TEST", requestRevision: 1, positions, orders: [], coverage: ["positions", "orders", "trades"].map(source => ({ source, asOf: "2026-09-12T00:00:00Z", completedPages: 1, status: "complete" })),
    history: positions.map((position, i) => ({ id: `trade-${i}`, tradeId: `TEST-fill-${i}`, brokerAccountKey: "TEST-N", kind: "trade", accountCurrency: "USD", uic: position.uic, optionType: "put", strike: position.strike, expiry: position.expiry, quantity: 1, buySell: i ? "sell" : "buy", openClose: "open", price: i ? .92 : 4.92, transactionCost: 2.24, tradeDate: "2026-09-11" })) };
}
const candidates = (snapshot: SpreadImportSnapshot) => reconcileStrategyCandidates(snapshot, emptyStrategyLedger(), []);
function existingFixture(snapshot: SpreadImportSnapshot): TradeSimulation {
  const candidate = candidates(snapshot)[0], fill = candidate.fills[0];
  // Only fields used by source reconciliation are needed for this record.
  return { id: "TEST-existing", accountCode: "N", optionLegs: [{ id: "TEST-existing-leg", saxoAccountKey: "TEST-N", saxoUic: 990001 }], optionEntryExecutions: [{ ...fill.execution!, legId: "TEST-existing-leg" }] } as TradeSimulation;
}

describe("R2 current holding / opening lot safety", () => {
  it("accepts the clean first 1:1 import", () => expect(candidates(fixture())).toHaveLength(1));
  it("does not offer a closed historical lot after the same instrument was reopened", () => {
    const snapshot = fixture();
    snapshot.history.push({ ...snapshot.history[0], id: "TEST-old-open", tradeId: "TEST-old-open", tradeDate: "2026-09-01" }, { ...snapshot.history[0], id: "TEST-old-close", tradeId: "TEST-old-close", tradeDate: "2026-09-02", openClose: "close", buySell: "sell" });
    expect(candidates(snapshot)).toEqual([]);
    expect(getSpreadImportIssues(snapshot)[0]).toMatchObject({ code: "lifecycle_history" });
  });
  it("rejects opening quantity exceeding current quantity", () => {
    const snapshot = fixture(); snapshot.history[0].quantity = 2;
    expect(candidates(snapshot)).toEqual([]);
    expect(getSpreadImportIssues(snapshot)[0]).toMatchObject({ code: "quantity_mismatch" });
  });
  it("does not double count duplicate current UIC rows", () => {
    const snapshot = fixture(); snapshot.positions.push({ ...snapshot.positions[0] });
    expect(candidates(snapshot)).toEqual([]);
    expect(getSpreadImportIssues(snapshot)[0]).toMatchObject({ code: "duplicate_positions" });
  });
  it("does not guess pairing between distinct split fills", () => {
    const snapshot = fixture(); snapshot.positions.forEach(position => { position.quantity! *= 2; });
    snapshot.history.push(...snapshot.history.map(item => ({ ...item, id: `${item.id}-split`, tradeId: `${item.tradeId}-split` })));
    expect(candidates(snapshot)).toEqual([]);
    expect(getSpreadImportIssues(snapshot)).toHaveLength(2);
    expect(getSpreadImportIssues(snapshot)[0]).toMatchObject({ code: "multiple_opening_lots" });
  });
  it("deduplicates identical copies of one fill without creating a new economic lot", () => {
    const snapshot = fixture(); snapshot.history.push({ ...snapshot.history[0], id: "TEST-other-source" });
    expect(candidates(snapshot)).toHaveLength(1);
    expect(getSpreadImportIssues(snapshot)).toEqual([]);
  });
  it("rejects conflicting copies of the same fill", () => {
    const snapshot = fixture(); snapshot.history.push({ ...snapshot.history[0], id: "TEST-conflicting-source", quantity: 2 });
    expect(candidates(snapshot)).toEqual([]);
    expect(getSpreadImportIssues(snapshot)[0].code).toBe("opening_identity");
  });
  it("blocks missing current quantity instead of treating it as opening quantity", () => {
    const snapshot = fixture(); delete snapshot.positions[0].quantity;
    expect(candidates(snapshot)).toEqual([]);
    expect(getSpreadImportIssues(snapshot)[0].code).toBe("quantity_mismatch");
  });
  it("does not show unrelated standalone instruments as required user repairs", () => {
    const snapshot = fixture(); snapshot.positions.pop(); snapshot.history.push({ ...snapshot.history[0], id: "TEST-close", tradeId: "TEST-close", openClose: "close" });
    expect(getSpreadImportIssues(snapshot)).toEqual([]);
  });
  it("keeps safe other contracts available when one instrument is unsafe", () => {
    const snapshot = fixture();
    const other = fixture(); other.positions.forEach(position => { position.uic! += 10; position.underlyingIdentity = "uic:990010:stock"; });
    other.history.forEach(trade => { trade.uic! += 10; trade.tradeId += "-other"; });
    snapshot.positions.push(...other.positions); snapshot.history.push(...other.history);
    snapshot.history[0].quantity = 2;
    expect(candidates(snapshot)).toHaveLength(1);
    expect(candidates(snapshot)[0].fills[0].contract.instrument).toBe("990011");
  });
  it("does not demand reconfirmation for already allocated sources after close history arrives", () => {
    const snapshot = fixture(), ledger = emptyStrategyLedger();
    const candidate = candidates(snapshot)[0];
    const prepared = prepareStrategyImport(candidate, ledger, []);
    if ("reasons" in prepared) throw Error(prepared.reasons.join());
    const committed = commitStrategyImport(prepared, ledger, [], 1);
    if ("reasons" in committed) throw Error(committed.reasons.join());
    snapshot.history.push({ ...snapshot.history[0], id: "TEST-close", tradeId: "TEST-close", openClose: "close", buySell: "sell" });
    expect(getSpreadImportIssues(snapshot, committed.ledger)).toEqual([]);
    expect(reconcileStrategyCandidates(snapshot, committed.ledger, [])).toEqual([]);
  });
  it("keeps a uniquely identified existing standalone source as a reference", () => {
    const snapshot = fixture(), source = existingFixture(snapshot);
    const result = reconcileStrategyCandidates(snapshot, emptyStrategyLedger(), [source]);
    expect(result).toHaveLength(1);
    expect(result[0].fills[0].existing?.simulationId).toBe(source.id);
    expect(result[0].fills[0].execution).toBeUndefined();
    expect(getSpreadImportIssues(snapshot, emptyStrategyLedger(), [source])).toEqual([]);
  });
  it.each(["legacy_id", "duplicate_source", "changed_evidence", "no_confirmed_entry"])("preserves existing %s records without creating duplicate canonical fills", mode => {
    const snapshot = fixture(), source = existingFixture(snapshot), sources = [source];
    if (mode === "legacy_id") { delete source.optionEntryExecutions![0].saxoFillId; source.optionEntryExecutions![0].historyCandidateIds = ["trade-0"]; }
    if (mode === "duplicate_source") sources.push({ ...source, id: "TEST-duplicate" });
    if (mode === "changed_evidence") source.optionEntryExecutions![0].commissionUSD = 5;
    if (mode === "no_confirmed_entry") source.optionEntryExecutions = [];
    const before = JSON.stringify(sources);
    expect(reconcileStrategyCandidates(snapshot, emptyStrategyLedger(), sources)).toEqual([]);
    expect(getSpreadImportIssues(snapshot, emptyStrategyLedger(), sources)[0].code).toBe("existing_source");
    expect(JSON.stringify(sources)).toBe(before);
  });
});

describe("R3 product specification evidence", () => {
  it("keeps a potential pair visible when product currency or multiplier is unavailable", () => {
    const snapshot = fixture(); delete snapshot.positions[0].currency; delete snapshot.positions[0].contractSize; snapshot.positions[0].missingFields = ["currency", "contractSize"];
    expect(candidates(snapshot)).toEqual([]);
    expect(getSpreadImportIssues(snapshot)).toEqual([expect.objectContaining({ code: "specification_missing" })]);
  });
  it("does not overwrite a specification conflict or a non-USD product with account defaults", () => {
    const conflict = fixture(); conflict.positions[0].specificationConflicts = ["currency"];
    expect(candidates(conflict)).toEqual([]); expect(getSpreadImportIssues(conflict)[0].code).toBe("specification_conflict");
    const unsupported = fixture(); unsupported.positions[0].currency = "EUR";
    expect(candidates(unsupported)).toEqual([]); expect(getSpreadImportIssues(unsupported)[0].code).toBe("unsupported_currency");
  });
});

describe("R4 AccountId-only history and derived same-currency fee", () => {
  it("uses only the resolved AccountKey and preserves derived fee provenance", () => {
    const snapshot = fixture();
    snapshot.history.forEach((trade) => {
      trade.brokerAccountIdentityStatus = "resolved";
      trade.brokerAccountKeySourceField = "AccountId";
      trade.transactionCostSource = "derived_same_currency_booked_difference";
      trade.transactionCostSourceField = "TradedValue - BookedAmountAccountCurrency";
    });
    const candidate = candidates(snapshot)[0];
    expect(candidate.fills.map((fill) => fill.execution?.commissionUSD)).toEqual([2.24, 2.24]);
    expect(candidate.fills.map((fill) => fill.execution?.commissionSource)).toEqual(["saxo_derived_same_currency_booked_difference", "saxo_derived_same_currency_booked_difference"]);
  });

  it("does not compare masked display AccountId as an AccountKey fallback", () => {
    const snapshot = fixture();
    snapshot.history.forEach((trade) => {
      delete trade.brokerAccountKey;
      trade.accountKey = "TEST-N";
      trade.brokerAccountIdentityStatus = "unmatched";
    });
    expect(candidates(snapshot)).toEqual([]);
    expect(getSpreadImportIssues(snapshot)[0]).toMatchObject({ code: "account_identity" });
    expect(getSpreadImportIssueGroups(snapshot)).toHaveLength(1);
    expect(getSpreadImportIssueGroups(snapshot)[0].label).toContain("ベア・プット");
  });
});
