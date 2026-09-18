import { describe, expect, it } from "vitest";
import { reconcileStrategyCandidates, type SpreadImportSnapshot } from "@/features/saxo/spreadStrategyImport";
import { emptyStrategyLedger, prepareStrategyImport, commitStrategyImport, materializeStrategyEntries } from "./strategyLedger";
import { previewBearPutSpreadCloseBatch } from "./spreadCloseBatch";
import type { TradeSimulation } from "@/types/domain";

// Independent economic expectations, not obtained from the implementation registry.
type R13Case = readonly ["bull_call_spread" | "bear_call_spread" | "bull_put_spread" | "bear_put_spread", "call" | "put", number, number, number, number, number, number, number];
const cases: readonly R13Case[] = [
  ["bull_call_spread", "call", 335, 355, 5, 2, 6, 2.5, 41.04],
  ["bear_call_spread", "call", 355, 335, 2, 5, 1, 3, 91.04],
  ["bull_put_spread", "put", 90, 100, 2, 5, 1, 3, 91.04],
  ["bear_put_spread", "put", 100, 90, 5, 2, 6, 2.5, 41.04],
] as const;

function snapshot(row: R13Case): SpreadImportSnapshot {
  const [, type, buyStrike, sellStrike, buyPrice, sellPrice] = row;
  const positions: SpreadImportSnapshot["positions"] = ["long", "short"].map((side, i) => ({
    id: `independent-position-${i}`, positionId: `independent-position-${i}`, accountKey: "INDEPENDENT-N", accountAssignment: "N", accountCode: "N",
    symbol: "TEST", underlyingSymbol: "TEST", underlyingIdentity: "uic:980000:stock", kind: "option", assetType: "StockOption", optionType: type,
    side: side as "long" | "short", strike: i ? sellStrike : buyStrike, expiry: "2026-10-23", quantity: i ? -1 : 1, contractSize: 100, currency: "USD", uic: 980001 + i,
    missingFields: [], fetchedAt: "2026-09-18T00:00:00Z",
  }));
  return { environment: "TEST", requestRevision: 1, positions, orders: [],
    coverage: ["positions", "orders", "trades"].map(source => ({ source, asOf: "2026-09-18T00:00:00Z", completedPages: 1, status: "complete" })),
    history: positions.map((position, i) => ({ id: `independent-fill-${i}`, tradeId: `independent-fill-${i}`, brokerAccountKey: "INDEPENDENT-N", kind: "trade", accountCurrency: "USD", uic: position.uic,
      optionType: type, strike: position.strike, expiry: position.expiry, quantity: 1, buySell: i ? "sell" : "buy", openClose: "open", price: i ? sellPrice : buyPrice, transactionCost: 2.24, tradeDate: "2026-09-17" })),
  };
}

describe("R13 independent four-type import and settlement economics", () => {
  it.each(cases)("%s imports actual matching option history and settles once", (...row) => {
    const ledger = emptyStrategyLedger();
    const candidates = reconcileStrategyCandidates(snapshot(row), ledger, []);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].strategyType).toBe(row[0]);
    const prepared = prepareStrategyImport(candidates[0], ledger, []);
    expect(prepared).not.toHaveProperty("reasons");
    if ("reasons" in prepared) throw new Error(prepared.reasons.join("/"));
    const result = commitStrategyImport(prepared, ledger, [], 1);
    if ("reasons" in result) throw new Error(result.reasons.join("/"));
    expect(commitStrategyImport(prepared, result.ledger, [], 1)).toMatchObject({ changed: false });
    const material = materializeStrategyEntries(result.strategyId, result.ledger, []);
    const simulation = {
      id: result.strategyId, status: "open", name: "Independent anonymous", ticker: "TEST", strategyType: row[0], currentPriceUSD: 100, fxRateJPY: 0,
      accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD", entryDate: "2026-09-17", expiryDate: "2026-10-23", dte: 36, stockPosition: null,
      optionLegs: material.legs, optionEntryExecutions: material.entries,
      optionCloseExecutions: material.legs.map((leg, i) => ({ id: `independent-close-${i}`, legId: leg.id, closeKind: "buyback", closeDate: "2026-09-18", contracts: 1,
        closePriceUSD: leg.side === "buy" ? row[6] : row[7], commissionUSD: 2.24, settlementCurrency: "USD", source: "saxo_history", sourceCandidateId: `independent-close-${i}`, confirmationStatus: "pending", confirmed: false })),
      brokerMarginJPY: 0, marginBufferMultiplier: 1, denominatorMode: "custom", taxProfileId: "none_nisa_or_tax_free_comparison",
    } as TradeSimulation;
    const before = JSON.stringify(simulation);
    const review = previewBearPutSpreadCloseBatch(simulation);
    expect(review).toMatchObject({ applies: true, ready: true, newlyConfirmedCount: 2, combinedRealizedPnlUSD: row[8], totalCostsUSD: 8.96 });
    expect(review.nextSimulation?.status).toBe("closed");
    expect(JSON.stringify(simulation)).toBe(before);
  });
  it("rejects caller supplied type that contradicts the actual option contracts", () => {
    const ledger = emptyStrategyLedger();
    const candidate = reconcileStrategyCandidates(snapshot(cases[3]), ledger, [])[0];
    expect(prepareStrategyImport({ ...candidate, strategyType: "bear_call_spread" }, ledger, [])).toHaveProperty("reasons");
  });
});
