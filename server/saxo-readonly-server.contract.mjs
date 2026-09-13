import assert from "node:assert/strict";
import test from "node:test";

process.env.SAXO_READONLY_SERVER_TEST = "1";

const { enrichPositionUnderlyingIdentities, normalizePosition, normalizeOrder, normalizeHistoryItem, normalizeHistoryItemsWithInstrumentDetails, fetchSaxoPages, resolveHistoryAccountIdentity, inferTransactionCostFromTradeValue } = await import("./saxo-readonly-server.mjs");

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
test("R3 InstrumentDetails resolves effective currency and contract size, while preserving source missing fields", async () => {
  const raw = { PositionBase: { AccountKey: "TEST-N", PositionId: "TEST-position", AssetType: "StockOption", Amount: 1, Uic: 990001, Strike: 100, ExpiryDate: "2026-10-02", PutCall: "Put" } };
  const normalized = normalizePosition(raw, new Map(), "2026-09-13T00:00:00Z", 0);
  assert.deepEqual(normalized.missingFields.filter(field => ["currency", "contractSize"].includes(field)), ["currency", "contractSize"]);
  const [enriched] = await enrichPositionUnderlyingIdentities([normalized], "TEST", async () => ({ CurrencyCode: "USD", ContractSize: 100, RelatedInstruments: [] }));
  assert.equal(enriched.currency, "USD"); assert.equal(enriched.currencySourceField, "InstrumentDetails.CurrencyCode");
  assert.equal(enriched.contractSize, 100); assert.equal(enriched.contractSizeSourceField, "InstrumentDetails.ContractSize");
  assert.deepEqual(enriched.missingFields.filter(field => ["currency", "contractSize"].includes(field)), []);
  assert.deepEqual(enriched.sourceMissingFields.filter(field => ["currency", "contractSize"].includes(field)), ["currency", "contractSize"]);
});

test("R3 keeps direct specification provenance for direct-only, matching-detail, and conflicting-detail cases", async () => {
  const raw = { PositionBase: { AccountKey: "TEST-N", PositionId: "TEST-direct", AssetType: "StockOption", Amount: 1, Uic: 990002, Strike: 100, ExpiryDate: "2026-10-02", PutCall: "Put", Currency: "EUR", ContractSize: 50 } };
  const normalized = normalizePosition(raw, new Map(), "2026-09-13T00:00:00Z", 0);
  assert.equal(normalized.currency, "EUR");
  assert.equal(normalized.currencySourceField, "PositionBase.Currency");
  assert.equal(normalized.contractSize, 50);
  assert.equal(normalized.contractSizeSourceField, "PositionBase.ContractSize");

  const [directOnly] = await enrichPositionUnderlyingIdentities([normalized], "TEST", async () => ({}));
  assert.equal(directOnly.currencySourceField, "PositionBase.Currency");
  assert.equal(directOnly.contractSizeSourceField, "PositionBase.ContractSize");
  assert.deepEqual(directOnly.specificationConflicts, []);

  const [matching] = await enrichPositionUnderlyingIdentities([normalized], "TEST", async () => ({ CurrencyCode: "EUR", ContractSize: 50 }));
  assert.equal(matching.currencySourceField, "PositionBase.Currency");
  assert.equal(matching.contractSizeSourceField, "PositionBase.ContractSize");
  assert.deepEqual(matching.specificationConflicts, []);

  const [conflicting] = await enrichPositionUnderlyingIdentities([normalized], "TEST", async () => ({ CurrencyCode: "USD", ContractSize: 100 }));
  assert.equal(conflicting.currency, "EUR");
  assert.equal(conflicting.currencySourceField, "PositionBase.Currency");
  assert.equal(conflicting.contractSize, 50);
  assert.equal(conflicting.contractSizeSourceField, "PositionBase.ContractSize");
  assert.deepEqual(conflicting.specificationConflicts, ["currency", "contractSize"]);
});
test("R3 rejects conflicting direct and detail specification evidence without overwriting it", async () => {
  const position = { kind: "option", uic: 990001, assetType: "StockOption", accountKey: "TEST-N", currency: "EUR", currencySourceField: "PositionBase.Currency", contractSize: 10, contractSizeSourceField: "PositionBase.ContractSize", missingFields: [] };
  const [enriched] = await enrichPositionUnderlyingIdentities([position], "TEST", async () => ({ CurrencyCode: "USD", ContractSize: 100 }));
  assert.equal(enriched.currency, "EUR"); assert.equal(enriched.contractSize, 10);
  assert.deepEqual(enriched.specificationConflicts, ["currency", "contractSize"]);
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
test("R3 order normalization preserves explicit role and instrument identity separately from order type", () => {
  const closing = normalizeOrder({ AccountKey: "TEST-N", OrderId: "TEST-order", AssetType: "StockOption", Uic: 55001, Amount: 1, BuySell: "Sell", OpenOrderType: "StopIfTraded", ToOpenClose: "Close", Status: "Working", PutCall: "Call" }, new Map(), "TEST-time", 0);
  assert.equal(closing.orderType, "StopIfTraded"); assert.equal(closing.openClose, "close"); assert.equal(closing.openCloseSourceField, "ToOpenClose"); assert.equal(closing.uic, 55001);
  const unknown = normalizeOrder({ AccountKey: "TEST-N", OrderId: "TEST-order-2", AssetType: "StockOption", Amount: 1, BuySell: "Sell", OpenOrderType: "StopIfTraded", Status: "Working", PutCall: "Put" }, new Map(), "TEST-time", 1);
  assert.equal(unknown.openClose, "unknown");
});
test("R2 pagination retains complete, partial and failed coverage", async () => {
  let page = 0;
  const result = await fetchSaxoPages("trades", {}, async () => ++page === 1 ? { Data: [1], __next: "https://TEST.invalid/openapi/trades?skip=1" } : { Data: [2] }, "https://TEST.invalid/openapi/");
  assert.deepEqual(result, { Data: [1, 2], coverage: { completedPages: 2, status: "complete" } });
  page = 0;
  const partial = await fetchSaxoPages("trades", {}, async () => { if (++page > 1) throw Error("TEST interrupted"); return { Data: [1], __next: "https://TEST.invalid/openapi/trades?skip=1" }; }, "https://TEST.invalid/openapi/");
  assert.equal(partial.coverage.status, "partial");
});

test("R2 explicit zero transaction fee remains known and beats inference", () => {
  const zero = normalizeHistoryItem({ TradeId: "TEST-zero", TransactionCost: 0, BookedAmount: -404, Premium: -400 }, "trade", 0);
  assert.equal(zero.transactionCost, 0);
  const missing = normalizeHistoryItem({ TradeId: "TEST-missing" }, "trade", 1);
  assert.equal(missing.transactionCost, undefined);
});

test("R4 resolves AccountId-only trade identity through one same-environment account", () => {
  const accounts = [{ accountKey: "TEST-N-key", accountId: "TEST-N-id", accountNumber: "TEST-N-number", currency: "USD", environment: "sim" }];
  const item = normalizeHistoryItem({ AccountId: "TEST-N-id", TradeId: "TEST-fill", AccountCurrency: "USD", Currency: "USD" }, "trade", 0, { accounts, environment: "sim" });
  assert.equal(item.brokerAccountKey, "TEST-N-key");
  assert.equal(item.brokerAccountIdentityStatus, "resolved");
  assert.equal(item.brokerAccountKeySourceField, "AccountId");
  assert.equal(item.accountCurrencySourceField, "AccountCurrency");
});

test("R4 blocks duplicate, unmatched, conflicting and cross-environment account identities", () => {
  const duplicate = [{ accountKey: "TEST-A", accountId: "TEST-id", environment: "sim" }, { accountKey: "TEST-B", accountId: "TEST-id", environment: "sim" }];
  assert.equal(resolveHistoryAccountIdentity({ AccountId: "TEST-id" }, duplicate, "sim").status, "ambiguous");
  assert.equal(resolveHistoryAccountIdentity({ AccountId: "missing" }, duplicate, "sim").status, "unmatched");
  assert.equal(resolveHistoryAccountIdentity({ AccountKey: "TEST-A", AccountId: "TEST-other" }, [{ accountKey: "TEST-A", accountId: "TEST-id", environment: "sim" }, { accountKey: "TEST-B", accountId: "TEST-other", environment: "sim" }], "sim").status, "conflict");
  assert.equal(resolveHistoryAccountIdentity({ AccountKey: "TEST-A", AccountId: "TEST-unknown" }, [{ accountKey: "TEST-A", accountId: "TEST-id", environment: "sim" }], "sim").status, "conflict");
  assert.equal(resolveHistoryAccountIdentity({ AccountId: "TEST-live" }, [{ accountKey: "TEST-live-key", accountId: "TEST-live", environment: "live" }], "sim").status, "environment_mismatch");
});

test("R4 derives only a positive signed USD same-currency booked difference and ignores ClientCurrency", () => {
  const buy = normalizeHistoryItem({ TradeId: "TEST-buy", AccountId: "TEST-id", Currency: "USD", AccountCurrency: "USD", ClientCurrency: "JPY", TradedValue: -510, BookedAmountAccountCurrency: -512.24 }, "trade", 0);
  const sell = normalizeHistoryItem({ TradeId: "TEST-sell", AccountId: "TEST-id", Currency: "USD", AccountCurrency: "USD", ClientCurrency: "JPY", TradedValue: 110, BookedAmountAccountCurrency: 107.76 }, "trade", 1);
  assert.equal(buy.transactionCost, 2.24);
  assert.equal(sell.transactionCost, 2.24);
  assert.equal(buy.transactionCostSource, "derived_same_currency_booked_difference");
  assert.equal(buy.transactionCostSourceField, "TradedValue - BookedAmountAccountCurrency");
  assert.equal(inferTransactionCostFromTradeValue({ Currency: "USD", AccountCurrency: "JPY", TradedValue: -510, BookedAmountAccountCurrency: -512.24 }, "JPY"), undefined);
  assert.equal(inferTransactionCostFromTradeValue({ Currency: "USD", AccountCurrency: "USD", TradedValue: -512.24, BookedAmountAccountCurrency: -510 }, "USD"), undefined);
  assert.equal(inferTransactionCostFromTradeValue({ Currency: "USD", AccountCurrency: "USD", TradedValue: -510, BookedAmountAccountCurrency: -512.24, IsCorrection: true }, "USD"), undefined);
});

test("R4 resolves missing trade currency from same-identity InstrumentDetails without mutating raw", async () => {
  const accounts = [{ accountKey: "TEST-N-key", accountId: "TEST-N-id", currency: "USD", environment: "sim" }];
  const raw = { TradeId: "TEST-fill", AccountId: "TEST-N-id", AssetType: "StockOption", Uic: 710001, ClientCurrency: "JPY", TradedValue: -510, BookedAmountAccountCurrency: -512.24 };
  const [item] = await normalizeHistoryItemsWithInstrumentDetails([raw], "trade", { accounts, environment: "sim", clientKey: "TEST-client", fetchedAt: "2026-09-13T00:00:00.000Z" }, async ({ uic, assetType, accountKey }) => {
    assert.deepEqual({ uic, assetType, accountKey }, { uic: 710001, assetType: "StockOption", accountKey: "TEST-N-key" });
    return { CurrencyCode: "USD" };
  });
  assert.equal("Currency" in raw, false);
  assert.equal(item.currency, "USD");
  assert.equal(item.currencySourceField, "InstrumentDetails.CurrencyCode");
  assert.equal(item.currencyEvidenceFetchedAt, "2026-09-13T00:00:00.000Z");
  assert.equal(item.transactionCost, 2.24);
});

test("R4 blocks missing or conflicting InstrumentDetails currency evidence", async () => {
  const accounts = [{ accountKey: "TEST-N-key", accountId: "TEST-N-id", currency: "USD", environment: "sim" }];
  const base = { TradeId: "TEST-fill", AccountId: "TEST-N-id", AssetType: "StockOption", Uic: 710001, TradedValue: -510, BookedAmountAccountCurrency: -512.24 };
  const [missing] = await normalizeHistoryItemsWithInstrumentDetails([base], "trade", { accounts, environment: "sim" }, async () => ({}));
  assert.equal(missing.transactionCost, undefined);
  assert.equal(missing.currency, undefined);
  const [conflict] = await normalizeHistoryItemsWithInstrumentDetails([{ ...base, Currency: "EUR" }], "trade", { accounts, environment: "sim" }, async () => ({ CurrencyCode: "USD" }));
  assert.equal(conflict.currencyConflict, true);
  assert.equal(conflict.transactionCostConflict, true);
  assert.equal(conflict.transactionCost, undefined);
});

test("R4 explicit transaction cost including zero wins over derived evidence", () => {
  const direct = normalizeHistoryItem({ TradeId: "TEST-direct", Currency: "USD", AccountCurrency: "USD", TradedValue: -510, BookedAmountAccountCurrency: -512.24, TransactionCost: 1.11 }, "trade", 0);
  const zero = normalizeHistoryItem({ TradeId: "TEST-zero", Currency: "USD", AccountCurrency: "USD", TradedValue: -510, BookedAmountAccountCurrency: -512.24, TransactionCost: 0 }, "trade", 1);
  assert.equal(direct.transactionCost, 1.11);
  assert.equal(direct.transactionCostSource, "direct");
  assert.equal(zero.transactionCost, 0);
  assert.equal(zero.transactionCostSource, "direct");
  const conflict = normalizeHistoryItem({ TradeId: "TEST-conflict", Currency: "USD", AccountCurrency: "USD", TransactionCost: 1, TotalTransactionCost: 2 }, "trade", 2);
  assert.equal(conflict.transactionCost, 1);
  assert.equal(conflict.transactionCostConflict, true);
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
