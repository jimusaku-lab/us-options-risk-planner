import { expect, it } from "vitest";
import type { TradeSimulation } from "@/types/domain";
import { applyCurrentOptionPricePreview, createCurrentOptionPricePreviewRow, getCurrentOptionPriceTargets } from "./bulkOptionPrice";

it("keeps mismatched fee coverage unknown and records a matching explicit total", () => {
  const simulation: TradeSimulation = { id: "fees", ticker: "TEST", name: "anonymous", strategyType: "bull_call_spread", status: "open", accountCode: "N", accountCurrency: "USD", accountEnvironment: "PROD_N_USD_SETTLEMENT", currentPriceUSD: 110, fxRateJPY: 150, entryDate: "2026-09-01", expiryDate: "2026-12-18", dte: 86, stockPosition: null, brokerMarginJPY: 0, marginBufferMultiplier: 1, denominatorMode: "custom", taxProfileId: "none_nisa_or_tax_free_comparison", strategyContractVerification: { state: "verified" }, optionLegs: [{ id: "buy", type: "call", side: "buy", strikeUSD: 100, premiumUSD: 11, quantity: 2, contractSize: 100, expiryDate: "2026-12-18", saxoUic: 101, closePlan: { enabled: true, closePriceUSD: 13, commissionUSD: 2, commissionSource: "manual", commissionContracts: 1 } }, { id: "sell", type: "call", side: "sell", strikeUSD: 120, premiumUSD: 3, quantity: 2, contractSize: 100, expiryDate: "2026-12-18", saxoUic: 102, closePlan: { enabled: true, closePriceUSD: 3, commissionUSD: 2, commissionSource: "manual", commissionContracts: 1 } }] };
  simulation.optionEntryExecutions = simulation.optionLegs.map(leg => ({ id: `entry-${leg.id}`, legId: leg.id, tradeDate: "2026-09-01", contracts: 2, fillPriceUSD: leg.premiumUSD, commissionUSD: 4, settlementCurrency: "USD", confirmed: true, source: "broker_statement" }));
  const rows = getCurrentOptionPriceTargets([simulation]).map(target => createCurrentOptionPricePreviewRow(target, { environment: "live", status: "available", classification: "available", source: "fixture", message: "anonymous", fetchedAt: "2026-09-23T02:00:00Z", bid: target.side === "buy" ? 13 : 3, ask: target.side === "buy" ? 13 : 3 }));
  const result = applyCurrentOptionPricePreview([simulation], rows, { capturedAt: "2026-09-23T02:01:00Z", batchId: "fees-batch" })[0];
  expect(result.optionLegs.map(leg => leg.valueObservations?.[0].feeUSD)).toEqual([undefined, undefined]);
  simulation.optionLegs = simulation.optionLegs.map(leg => ({ ...leg, closePlan: { ...leg.closePlan!, commissionUSD: 4, commissionContracts: 2 } }));
  const confirmed = applyCurrentOptionPricePreview([simulation], rows, { capturedAt: "2026-09-23T02:02:00Z", batchId: "fees-confirmed" })[0];
  expect(confirmed.optionLegs.map(leg => leg.valueObservations?.[0].feeUSD)).toEqual([4, 4]);
});
