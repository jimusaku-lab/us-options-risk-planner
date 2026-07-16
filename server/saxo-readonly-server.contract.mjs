import assert from "node:assert/strict";
import test from "node:test";

process.env.SAXO_READONLY_SERVER_TEST = "1";

const { enrichPositionUnderlyingIdentities, normalizePosition } = await import("./saxo-readonly-server.mjs");

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
