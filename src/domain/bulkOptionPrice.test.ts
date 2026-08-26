import { describe, expect, it } from "vitest";
import { applyCurrentOptionPricePreview, createCurrentOptionPricePreviewRow, getBulkApplicableTargetIds, getBulkOptionPricePreviewCounts, getCurrentOptionPriceTargets, resolveSaxoOptionLegIdentifiers } from "./bulkOptionPrice";
import type { CurrentOptionPriceTarget } from "./bulkOptionPrice";
import type { TradeSimulation } from "@/types/domain";
import type { SaxoOptionPremiumCandidate } from "@/features/saxo/saxoAccountSync";
import { buildSaxoOptionPremiumCandidateInput } from "@/components/results/CloseDecisionCard";

const target = (id: string, side: "buy" | "sell"): CurrentOptionPriceTarget => ({ targetId: `synthetic:${id}`, simulationId: "synthetic", legId: id, ticker: "ABC", strategyType: "synthetic_forward", optionType: side === "buy" ? "call" : "put", side, strike: 100, expiry: "2026-12-18", quantity: 1 });
const quote = (fields: Partial<SaxoOptionPremiumCandidate>): SaxoOptionPremiumCandidate => ({ environment: "live", fetchedAt: "2026-08-15T00:00:00Z", status: "available", classification: "available", source: "fixture", message: "fixture", ...fields });
const standalone = (): TradeSimulation => ({ id: "legacy", name: "legacy", ticker: "ABC", strategyType: "long_call", status: "open", accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD", entryDate: "2026-08-01", expiryDate: "2026-12-18", dte: 100, fxRateJPY: 150, currentPriceUSD: 100, stockPosition: null, optionLegs: [{ id: "call", type: "call", side: "buy", strikeUSD: 100, premiumUSD: 2, quantity: 1, expiryDate: "2026-12-18" }], brokerMarginJPY: 0, marginBufferMultiplier: 1, denominatorMode: "cash_secured", taxProfileId: "japan_derivative_separate_tax_user_confirm" });

describe("generic bulk option price contract", () => {
  it("uses executable side only and leaves Mid/Last for individual confirmation", () => {
    expect(createCurrentOptionPricePreviewRow(target("call", "buy"), quote({ bid: 2, mid: 3 }))).toMatchObject({ selectedField: "bid", selectedPriceUSD: 2 });
    expect(createCurrentOptionPricePreviewRow(target("put", "sell"), quote({ mid: 3, last: 3 }))).toMatchObject({ status: "unavailable" });
  });
  it("excludes both synthetic legs when either side is missing", () => {
    const call = createCurrentOptionPricePreviewRow(target("call", "buy"), quote({ bid: 2 }));
    const put = createCurrentOptionPricePreviewRow(target("put", "sell"), quote({}));
    const simulations: TradeSimulation[] = [{ ...standalone(), id: "synthetic", strategyType: "synthetic_forward", optionLegs: [{ ...standalone().optionLegs[0], id: "call" }, { ...standalone().optionLegs[0], id: "put", type: "put", side: "sell" }] }];
    expect(getBulkApplicableTargetIds([call, put], simulations)).toEqual(new Set());
  });
  it("uses legacy standalone fixture identifiers but not composite parent instrument identifiers", () => {
    const fixtureMeta: NonNullable<TradeSimulation["fixtureMeta"]> = { source: "demo", isRealMoney: false, broker: "SaxoBank", purpose: "development-fixture", createdAt: "2026-08-15", notes: "", saxoAccountKey: "account", saxoUic: 10, saxoPositionId: "position", saxoInstrumentCode: "instrument" };
    const legacy = { ...standalone(), fixtureMeta };
    expect(getCurrentOptionPriceTargets([legacy])[0]).toMatchObject({ accountKey: "account", uic: 10, positionId: "position", instrumentCode: "instrument" });
    expect(buildSaxoOptionPremiumCandidateInput(legacy, legacy.optionLegs[0])).toMatchObject(resolveSaxoOptionLegIdentifiers(legacy, legacy.optionLegs[0]));
    const withLeg = { ...legacy, optionLegs: [{ ...legacy.optionLegs[0], saxoUic: 11, saxoPositionId: "leg", brokerSymbol: "leg-instrument" }] };
    expect(resolveSaxoOptionLegIdentifiers(withLeg, withLeg.optionLegs[0])).toMatchObject({ uic: 11, positionId: "leg", instrumentCode: "leg-instrument" });
    const synthetic = { ...standalone(), strategyType: "synthetic_forward" as const, optionLegs: [{ ...standalone().optionLegs[0], id: "call" }, { ...standalone().optionLegs[0], id: "put", type: "put" as const, side: "sell" as const }], fixtureMeta };
    expect(getCurrentOptionPriceTargets([synthetic]).every((item) => item.accountKey === "account" && item.uic === undefined && item.positionId === undefined && item.instrumentCode === undefined)).toBe(true);
  });
  it("requires explicit reference confirmation for OldIndicative and does not create a zero-filled snapshot", () => {
    const old = createCurrentOptionPricePreviewRow(target("old", "buy"), quote({ bid: 2.15, ask: 2.31, mid: 2.23, last: 2.22, quoteDiagnostics: { priceTypeBid: "OldIndicative" } }));
    expect(old).toMatchObject({ status: "confirmable_reference", selectedPriceUSD: 2.15, selectedField: "bid" });
    expect(getBulkOptionPricePreviewCounts([old])).toEqual({ successful: 1, ready: 0, confirmableReference: 1, unavailable: 0 });
    expect(getBulkApplicableTargetIds([old], [{ id: "synthetic", strategyType: "synthetic_forward", optionLegs: [{ id: "old" }] }] as never)).toEqual(new Set());
    expect(getBulkApplicableTargetIds([old], [{ id: "synthetic", strategyType: "synthetic_forward", optionLegs: [{ id: "old" }] }] as never, true)).toEqual(new Set(["synthetic:old"]));
    const missingUnderlying = { ...standalone(), currentPriceUSD: 0 };
    const liveTarget = getCurrentOptionPriceTargets([missingUnderlying])[0];
    const updated = applyCurrentOptionPricePreview([missingUnderlying], [createCurrentOptionPricePreviewRow(liveTarget, quote({ bid: 2 }))], { capturedAt: "2026-08-15T00:00:00Z" });
    expect(updated[0].optionLegs[0]).toMatchObject({ closeCostUSD: 2, valueSnapshots: undefined });
  });
  it("does not make forbidden quote types available after confirmation", () => {
    for (const priceType of ["NoAccess", "NoMarket", "Pending"]) {
      const row = createCurrentOptionPricePreviewRow(target("blocked", "buy"), quote({ bid: 2, quoteDiagnostics: { priceTypeBid: priceType } }));
      expect(row.status).toBe("unavailable");
      expect(getBulkApplicableTargetIds([row], [{ id: "synthetic", strategyType: "synthetic_forward", optionLegs: [{ id: "blocked" }] }] as never, true)).toEqual(new Set());
    }
  });
  it("excludes a fully closed composite leg and targets only its confirmed remainder", () => {
    const partial = { ...standalone(), id: "partial", strategyType: "synthetic_forward" as const, optionLegs: [{ ...standalone().optionLegs[0], id: "call" }, { ...standalone().optionLegs[0], id: "put", type: "put" as const, side: "sell" as const }], optionCloseExecutions: [{ id: "closed-call", legId: "call", closeKind: "buyback" as const, confirmed: true, closeDate: "2026-08-20", contracts: 1, settlementCurrency: "USD" as const, source: "manual" as const }] };
    expect(getCurrentOptionPriceTargets([partial])).toMatchObject([{ legId: "put", quantity: 1 }]);
  });
});
