import { describe, expect, it } from "vitest";
import type { TradeSimulation, WheelCycle, WheelEvent } from "@/types/domain";
import {
  isOpenNShortPutWheelSimulation,
  reconcileWheelDerivedState,
  resolveConfirmedNShortPutTerminal,
} from "./wheelReconciliation";

function shortPut(overrides: Partial<TradeSimulation> = {}): TradeSimulation {
  const id = overrides.id ?? "put-abc";
  return {
    id,
    name: "Anonymous short put",
    ticker: "ABC",
    strategyType: "short_put",
    status: "open",
    accountCode: "N",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    accountCurrency: "USD",
    entryDate: "2026-08-01",
    expiryDate: "2026-09-18",
    dte: 48,
    currentPriceUSD: 100,
    fxRateJPY: 150,
    stockPosition: null,
    optionLegs: [{ id: `${id}-leg`, type: "put", side: "sell", strikeUSD: 90, premiumUSD: 3, quantity: 1, expiryDate: "2026-09-18", assignmentPolicy: "accept" }],
    optionEntryExecutions: [{ id: `${id}-entry`, legId: `${id}-leg`, tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 3, settlementCurrency: "USD", commissionUSD: 2.24, source: "manual", confirmed: true }],
    optionCloseExecutions: [],
    brokerMarginJPY: 0,
    brokerMarginUSD: 9_000,
    marginBufferMultiplier: 1,
    availableCashJPY: 0,
    denominatorMode: "broker_margin_only",
    nisaExpectedAnnualReturnPct: 5,
    ...overrides,
  } as TradeSimulation;
}

function cycle(overrides: Partial<WheelCycle> = {}): WheelCycle {
  return {
    id: "cycle-abc",
    ticker: "ABC",
    primaryAccountCode: "N",
    currentPhase: "n_short_put",
    currentAccountCode: "N",
    currentShares: 0,
    averageCostUSD: 0,
    usdCashImpact: 0,
    cumulativePremiumUSD: 999,
    cumulativeStockRealizedPnlUSD: 0,
    cumulativeFeesUSD: 999,
    cumulativeTotalPnlUSD: 999,
    eventIds: [],
    linkedSimulationIds: ["put-abc"],
    openedAt: "2026-08-01",
    ...overrides,
  };
}

function close(simulation: TradeSimulation, overrides: Record<string, unknown> = {}): TradeSimulation {
  return {
    ...simulation,
    status: "closed",
    optionCloseExecutions: [{
      id: `${simulation.id}-close`,
      legId: simulation.optionLegs[0].id,
      closeKind: "buyback",
      confirmed: true,
      closeDate: "2026-08-10",
      contracts: 1,
      closePriceUSD: 2,
      commissionUSD: 2.24,
      settlementCurrency: "USD",
      source: "manual",
      realizedPnlUSD: 95.52,
      ...overrides,
    }],
  } as TradeSimulation;
}

function synthetic(policy: "unknown" | "accept" | "avoid" = "accept"): TradeSimulation {
  return {
    ...shortPut({ id: "synthetic-abc", strategyType: "synthetic_forward" }),
    name: "Anonymous synthetic",
    optionLegs: [
      { id: "call-leg", type: "call", side: "buy", strikeUSD: 100, premiumUSD: 5, quantity: 1, expiryDate: "2026-09-18" },
      { id: "put-leg", type: "put", side: "sell", strikeUSD: 100, premiumUSD: 3, quantity: 1, expiryDate: "2026-09-18", assignmentPolicy: policy },
    ],
    optionEntryExecutions: [
      { id: "call-entry", legId: "call-leg", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 5, settlementCurrency: "USD", commissionUSD: 8, source: "manual", confirmed: true },
      { id: "put-entry", legId: "put-leg", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 3, settlementCurrency: "USD", commissionUSD: 2.24, source: "manual", confirmed: true },
    ],
  } as TradeSimulation;
}

describe("wheel N short put reconciliation", () => {
  it("includes an accepted synthetic put leg but excludes unknown and avoid", () => {
    expect(isOpenNShortPutWheelSimulation(shortPut({ strategyType: "synthetic_forward" }))).toBe(true);
    expect(isOpenNShortPutWheelSimulation(shortPut({ optionLegs: [{ ...shortPut().optionLegs[0], assignmentPolicy: "unknown" }] }))).toBe(false);
    expect(isOpenNShortPutWheelSimulation(shortPut({ optionLegs: [{ ...shortPut().optionLegs[0], assignmentPolicy: "avoid" }] }))).toBe(false);
  });

  it.each(["unknown", "avoid"] as const)("keeps standalone %s outside active wheel reconciliation", (policy) => {
    const simulation = shortPut({ optionLegs: [{ ...shortPut().optionLegs[0], assignmentPolicy: policy }] });
    const result = reconcileWheelDerivedState({ cycles: [], events: [], simulations: [simulation], workspace: "live" });
    expect(result.cycles).toHaveLength(0);
    expect(result.events).toHaveLength(0);
  });

  it.each(["unknown", "avoid"] as const)("keeps synthetic %s outside active wheel reconciliation", (policy) => {
    const result = reconcileWheelDerivedState({ cycles: [], events: [], simulations: [synthetic(policy)], workspace: "live" });
    expect(result.cycles).toHaveLength(0);
    expect(result.events).toHaveLength(0);
  });

  it("does not activate an accepted leg until its full opening execution is confirmed", () => {
    const simulation = shortPut({ optionEntryExecutions: [{ ...shortPut().optionEntryExecutions![0], confirmed: false }] });
    expect(isOpenNShortPutWheelSimulation(simulation)).toBe(false);
    expect(reconcileWheelDerivedState({ cycles: [], events: [], simulations: [simulation], workspace: "live" }).cycles).toHaveLength(0);
  });

  it("links an accepted synthetic parent to its put leg and aggregates only put evidence", () => {
    const simulation = synthetic();
    const result = reconcileWheelDerivedState({ cycles: [], events: [], simulations: [simulation], workspace: "live" });
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toMatchObject({ currentPhase: "n_short_put", cumulativePremiumUSD: 300, cumulativeFeesUSD: 2.24, cumulativeTotalPnlUSD: 0 });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ linkedSimulationId: "synthetic-abc", linkedOptionLegId: "put-leg" });
  });

  it("closes a synthetic wheel put from the put leg alone and ignores call close P/L and fees", () => {
    const simulation = synthetic();
    simulation.optionCloseExecutions = [
      { id: "call-close", legId: "call-leg", closeKind: "buyback", confirmed: true, closeDate: "2026-08-09", contracts: 1, closePriceUSD: 7, commissionUSD: 9, settlementCurrency: "USD", source: "manual", realizedPnlUSD: 1_000 },
      { id: "put-close", legId: "put-leg", closeKind: "buyback", confirmed: true, closeDate: "2026-08-10", contracts: 1, closePriceUSD: 2, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", realizedPnlUSD: 95.52 },
    ];
    const result = reconcileWheelDerivedState({ cycles: [], events: [], simulations: [simulation], workspace: "live" });
    expect(result.cycles[0]).toMatchObject({ currentPhase: "n_cash", cumulativePremiumUSD: 300, cumulativeFeesUSD: 4.48, cumulativeTotalPnlUSD: 95.52 });
    expect(result.events.filter((event) => event.type === "short_put_closed")).toHaveLength(1);
  });

  it("does not reuse unlinked same-ticker cycles and creates an isolated derived cycle", () => {
    const result = reconcileWheelDerivedState({
      cycles: [cycle({ id: "cycle-a", linkedSimulationIds: [] }), cycle({ id: "cycle-b", linkedSimulationIds: [] })],
      events: [], simulations: [shortPut()], workspace: "live",
    });
    expect(result.cycles.find((item) => item.id === "cycle-a")?.linkedSimulationIds).toEqual([]);
    expect(result.cycles.find((item) => item.id === "cycle-b")?.linkedSimulationIds).toEqual([]);
    expect(result.cycles.find((item) => item.linkedSimulationIds.includes("put-abc"))?.id)
      .toBe("wheel-live-put-abc-put-abc-leg");
    expect(result.events).toHaveLength(1);
  });

  it("removes only stale automatic active artifacts after policy changes", () => {
    const simulation = shortPut({ optionLegs: [{ ...shortPut().optionLegs[0], assignmentPolicy: "avoid" }] });
    const automatic: WheelEvent = { id: "wheel-event-short-put-opened-put-abc", wheelCycleId: "cycle-abc", type: "short_put_opened", occurredAt: "2026-08-01", accountCode: "N", description: "ABC N口座プット売りを建玉開始", phaseAfter: "n_short_put", linkedSimulationId: "put-abc" };
    const manual: WheelEvent = { id: "manual", wheelCycleId: "cycle-abc", type: "manual_adjustment", occurredAt: "2026-07-01", accountCode: "N", description: "audit", phaseAfter: "n_cash", linkedSimulationId: "put-abc", derivationSource: "manual" };
    const first = reconcileWheelDerivedState({ cycles: [cycle({ eventIds: [automatic.id, manual.id] })], events: [automatic, manual], simulations: [simulation], workspace: "live" });
    expect(first.events.map((event) => event.id)).toEqual(["manual"]);
    expect(first.cycles[0]).toMatchObject({ currentPhase: "n_cash", linkedSimulationIds: ["put-abc"] });
    const second = reconcileWheelDerivedState({ cycles: first.cycles, events: first.events, simulations: [simulation], workspace: "live" });
    expect(second.changed).toBe(false);
  });

  it("preserves history evidence without treating unknown policy as active", () => {
    const simulation = shortPut({ optionLegs: [{ ...shortPut().optionLegs[0], assignmentPolicy: "unknown" }] });
    const history: WheelEvent = { id: "history-open", wheelCycleId: "cycle-abc", type: "short_put_opened", occurredAt: "2026-08-01", accountCode: "N", description: "confirmed history", phaseAfter: "n_short_put", linkedSimulationId: "put-abc", derivationSource: "history" };
    const result = reconcileWheelDerivedState({ cycles: [cycle({ eventIds: [history.id] })], events: [history], simulations: [simulation], workspace: "live" });
    expect(result.events.map((event) => event.id)).toEqual(["history-open"]);
    expect(result.cycles[0].currentPhase).toBe("n_cash");
  });

  it("removes an empty managed cycle but preserves an empty manual cycle", () => {
    const result = reconcileWheelDerivedState({
      cycles: [cycle({ id: "managed", eventIds: [], linkedSimulationIds: [], reconciliationVersion: 1 }), cycle({ id: "manual-cycle", eventIds: [], linkedSimulationIds: [], reconciliationVersion: undefined })],
      events: [], simulations: [], workspace: "live",
    });
    expect(result.cycles.map((item) => item.id)).toEqual(["manual-cycle"]);
  });

  it("does not use a singleton cycle across tickers and moves the existing event by id", () => {
    const different = shortPut({ id: "put-xyz", ticker: "XYZ", optionLegs: [{ id: "xyz-leg", type: "put", side: "sell", strikeUSD: 80, premiumUSD: 2, quantity: 1, expiryDate: "2026-09-18", assignmentPolicy: "accept" }], optionEntryExecutions: [{ id: "xyz-entry", legId: "xyz-leg", tradeDate: "2026-08-02", contracts: 1, fillPriceUSD: 2, settlementCurrency: "USD", commissionUSD: 2.24, source: "manual", confirmed: true }] });
    const misplaced: WheelEvent = { id: "event-preserved", wheelCycleId: "cycle-abc", type: "short_put_opened", occurredAt: "2026-08-02", accountCode: "N", description: "misplaced", phaseAfter: "n_short_put", linkedSimulationId: "put-xyz" };
    const result = reconcileWheelDerivedState({ cycles: [cycle({ eventIds: ["event-preserved"], linkedSimulationIds: ["put-abc", "put-xyz"] })], events: [misplaced], simulations: [shortPut(), different], workspace: "live" });
    const xyzCycle = result.cycles.find((item) => item.ticker === "XYZ");
    expect(xyzCycle).toBeDefined();
    expect(result.events.find((event) => event.id === "event-preserved")?.wheelCycleId).toBe(xyzCycle?.id);
    expect(result.cycles.find((item) => item.id === "cycle-abc")?.linkedSimulationIds).not.toContain("put-xyz");
    expect(result.cycles.find((item) => item.id === "cycle-abc")?.eventIds).not.toContain("event-preserved");
  });

  it("keeps manual and unlinked events untouched for audit", () => {
    const manual: WheelEvent = { id: "manual-event", wheelCycleId: "cycle-abc", type: "manual_adjustment", occurredAt: "2026-08-02", accountCode: "N", description: "manual", phaseAfter: "n_short_put", linkedSimulationId: "put-xyz" };
    const result = reconcileWheelDerivedState({ cycles: [cycle()], events: [manual], simulations: [shortPut({ id: "put-xyz", ticker: "XYZ" })], workspace: "live" });
    expect(result.events.find((event) => event.id === "manual-event")?.wheelCycleId).toBe("cycle-abc");
  });

  it("does not infer a cycle for a blank ticker without a valid exact link", () => {
    const result = reconcileWheelDerivedState({ cycles: [cycle()], events: [], simulations: [shortPut({ id: "blank", ticker: "" })], workspace: "live" });
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].linkedSimulationIds).not.toContain("blank");
  });

  it("creates one close event from a confirmed full buyback and returns to N cash", () => {
    const result = reconcileWheelDerivedState({ cycles: [cycle()], events: [], simulations: [close(shortPut())], workspace: "live" });
    expect(result.events.filter((event) => event.type === "short_put_closed")).toHaveLength(1);
    expect(result.events.find((event) => event.type === "short_put_closed")).toMatchObject({ occurredAt: "2026-08-10", usdPnl: 95.52, feeUSD: 2.24, phaseAfter: "n_cash" });
    expect(result.cycles[0]).toMatchObject({ currentPhase: "n_cash", cumulativePremiumUSD: 300, cumulativeFeesUSD: 4.48, cumulativeTotalPnlUSD: 95.52 });
  });

  it("handles expiry but does not close partial or unconfirmed executions", () => {
    const base = shortPut();
    const expired = close(base, { closeKind: "expired", closePriceUSD: undefined, realizedPnlUSD: 297.76 });
    expect(resolveConfirmedNShortPutTerminal(expired)).toMatchObject({ kind: "closed", terminalStatus: "expired" });
    const partial = close({ ...base, optionLegs: [{ ...base.optionLegs[0], quantity: 2 }] }, { contracts: 1 });
    expect(resolveConfirmedNShortPutTerminal(partial).kind).toBe("partial");
    const unconfirmed = close(base, { confirmed: false });
    expect(resolveConfirmedNShortPutTerminal(unconfirmed).kind).toBe("none");
  });

  it("requires confirmed stock acquisition evidence for assignment", () => {
    const pending = shortPut({ status: "assigned", stockAcquisition: { enabled: true, acquisitionDate: "2026-09-18", shares: 100, priceUSD: 90, accountEnvironment: "PROD_N_USD_SETTLEMENT", source: "manual", confirmationStatus: "pending" } });
    expect(resolveConfirmedNShortPutTerminal(pending).kind).toBe("none");
    const confirmed = { ...pending, stockAcquisition: { ...pending.stockAcquisition!, confirmationStatus: "confirmed" as const } };
    const result = reconcileWheelDerivedState({ cycles: [cycle()], events: [], simulations: [confirmed], workspace: "live" });
    expect(result.events.find((event) => event.type === "put_assigned")).toMatchObject({ sharesChange: 100, phaseAfter: "n_stock_holding" });
    expect(result.cycles[0]).toMatchObject({ currentPhase: "n_stock_holding", currentShares: 100 });
  });

  it("is idempotent and does not count open premium as realized profit", () => {
    const first = reconcileWheelDerivedState({ cycles: [cycle()], events: [], simulations: [close(shortPut())], workspace: "live" });
    const second = reconcileWheelDerivedState({ cycles: first.cycles, events: first.events, simulations: [close(shortPut())], workspace: "live" });
    expect(second.changed).toBe(false);
    expect(second.events.filter((event) => event.type === "short_put_closed")).toHaveLength(1);
    expect(second.cycles[0].cumulativePremiumUSD).toBe(300);
    expect(second.cycles[0].cumulativeTotalPnlUSD).toBe(95.52);
  });
});
