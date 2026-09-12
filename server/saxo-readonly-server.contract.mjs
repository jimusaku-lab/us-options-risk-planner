import assert from "node:assert/strict";
import test from "node:test";

process.env.SAXO_READONLY_SERVER_TEST = "1";

const { enrichPositionUnderlyingIdentities, normalizePosition, normalizeOrder, normalizeHistoryItem, fetchSaxoPages } = await import("./saxo-readonly-server.mjs");

test("R2 documented specification fields enrich existing underlying without fabricating deliverable", async () => {
  const position = { kind: "option", uic: 990001, assetType: "StockOption", accountKey: "TEST-N", underlyingIdentity: "uic:990000:stock" };
  const [enriched] = await enrichPositionUnderlyingIdentities([position], "TEST", async () => ({ ContractSize: 10, SettlementStyle: "PhysicalDelivery", UnderlyingTypeCategory: "Instrument" }));
  assert.equal(enriched.contractSize, 10);
  assert.equal(enriched.settlementType, "PhysicalDelivery");
  assert.equal(enriched.underlyingTypeCategory, "Instrument");
  assert.equal(enriched.deliverableIdentity, undefined);
  assert.match(enriched.contractSpecificationSource, /ref\/v1\/instruments\/details/);
  const [missing] = await enrichPositionUnderlyingIdentities([position], "TEST", async () => ({}));
  assert.equal(missing.contractSize, undefined);
  assert.equal(missing.deliverableIdentity, undefined);
});
test("R2 parent order, fill and masked display identity stay distinct", () => {
  const order = normalizeOrder({ AccountKey: "TEST-N-account", OrderId: "TEST-leg", MultiLegOrderDetails: { MultiLegOrderId: "TEST-parent" } }, new Map(), "TEST-time", 0);
  assert.equal(order.orderId, "TEST-leg"); assert.equal(order.multiLegOrderId, "TEST-parent");
  assert.equal(order.orderRelation, undefined);
  const item = normalizeHistoryItem({ AccountKey: "TEST-N-account", TradeId: "TEST-fill", OrderId: "TEST-leg", Amount: 1 }, "trade", 8);
  assert.equal(item.brokerAccountKey, "TEST-N-account"); assert.equal(item.tradeId, "TEST-fill");
  assert.notEqual(item.accountKey, item.brokerAccountKey);
  const noFill = normalizeHistoryItem({ AccountKey: "TEST-N-account", OrderId: "TEST-leg" }, "trade", 0);
  assert.equal(noFill.tradeId, undefined); assert.equal(noFill.brokerHistoryId, undefined);
});
test("R2 pagination retains complete, partial and failed coverage", async () => {
  let page = 0;
  const result = await fetchSaxoPages("trades", {}, async () => ++page === 1 ? { Data: [1], __next: "https://TEST.invalid/openapi/trades?skip=1" } : { Data: [2] }, "https://TEST.invalid/openapi/");
  assert.deepEqual(result, { Data: [1, 2], coverage: { completedPages: 2, status: "complete" } });
  page = 0;
  const partial = await fetchSaxoPages("trades", {}, async () => { if (++page > 1) throw Error("TEST interrupted"); return { Data: [1], __next: "https://TEST.invalid/openapi/trades?skip=1" }; }, "https://TEST.invalid/openapi/");
  assert.equal(partial.coverage.status, "partial");
});

test("normalizes an anonymized nested Saxo option payload through PositionBase.Uic to a canonical underlying", async () => {
  const raw = (positionId, uic, amount) => ({
    PositionBase: {
      AccountKey: "account-anonymized",
      PositionId: positionId,
      AssetType: "StockOption",
      Amount: amount,
      Uic: uic,
    },
    DisplayAndFormat: { Symbol: "" },
  });
  const positions = [
    normalizePosition(raw("call-position", 510001, 1), new Map(), "2026-07-17T00:00:00.000Z", 0),
    normalizePosition(raw("put-position", 510002, -1), new Map(), "2026-07-17T00:00:00.000Z", 1),
  ];
  const fetchDetails = async ({ uic }) => {
    if (uic === 510001 || uic === 510002) return { RelatedInstruments: [{ Uic: 700001, AssetType: "Stock" }] };
    if (uic === 700001) return { Symbol: "CANON:XNAS" };
    throw new Error("unexpected instrument");
  };

  const enriched = await enrichPositionUnderlyingIdentities(positions, "client-anonymized", fetchDetails);

  assert.deepEqual(enriched.map((position) => position.underlyingIdentity), ["uic:700001:stock", "uic:700001:stock"]);
  assert.deepEqual(enriched.map((position) => position.underlyingSymbol), ["CANON", "CANON"]);
  assert.ok(enriched.every((position) => position.underlyingIdentitySource?.includes("RelatedInstruments")));
});
