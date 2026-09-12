import { describe, expect, it, vi } from "vitest";
import { commitStrategyImport, emptyStrategyLedger, materializeStrategyEntries, prepareStrategyImport, strategyIdentityKey, type StrategyCandidate, type StrategyFill } from "./strategyLedger";
import { allocateMoney } from "./spreadCashflows";
import { hydrateStrategyRecords, useOptionsStore } from "@/store/useOptionsStore";
import { exportWorkspaceJson, parseWorkspaceJson } from "@/lib/export";

export function candidateFixture(): StrategyCandidate {
  const fills = ["buy", "sell"].map((side, index): StrategyFill => {
    const identity = { environment: "TEST", broker: "TEST", accountKey: "TEST-N", kind: "fill" as const, id: `TEST-fill-${index}` };
    return { identity, key: strategyIdentityKey(identity), revision: "TEST-v1", aliases: [],
      contract: { underlying: "TEST-underlying", instrument: `TEST-option-${index}`, ticker: "TEST", optionType: "put", side: side as "buy" | "sell", strike: index === 0 ? 100 : 90, expiry: "2026-10-02", multiplier: 100, currency: "USD", settlement: "TEST-physical", deliverable: "TEST-100-common" },
      execution: { id: `TEST-entry-${index}`, legId: `TEST-leg-${index}`, contracts: 2, tradeDate: "2026-09-01", fillPriceUSD: index === 0 ? 4.92 : 0.92, commissionUSD: 4.48, commissionSource: "saxo_actual", settlementCurrency: "USD", source: "broker_statement", confirmed: true } };
  }) as [StrategyFill, StrategyFill];
  return { id: "TEST-strategy", fills, contracts: 1, grouping: "user_confirmation", requestRevision: 1, coverage: ["positions", "orders", "trades"].map(source => ({ source, completedPages: 1, asOf: "2026-09-12T00:00:00Z", status: "complete" })) };
}
describe("R2 canonical references / atomic allocations", () => {
  it("T08 unknown specification permits reference grouping; Basket cannot be confirmed away", () => {
    const candidate = candidateFixture();
    candidate.fills.forEach(fill => { fill.contract.deliverable = ""; fill.contract.settlement = ""; });
    expect(prepareStrategyImport(candidate, emptyStrategyLedger(), [])).not.toHaveProperty("reasons");
    candidate.fills[0].contract.underlyingCategory = "Basket";
    expect(prepareStrategyImport(candidate, emptyStrategyLedger(), [])).toHaveProperty("reasons");
  });
  it("T09/T16/T18 persistence failure is atomic, backup restores references and ungroup preserves all quantities", async () => {
    const prior = useOptionsStore.getState();
    localStorage.clear();
    try {
      useOptionsStore.setState({ activeWorkspace: "live", simulations: [], simulationsByWorkspace: { demo: [], live: [] }, strategyLedgersByWorkspace: { demo: emptyStrategyLedger(), live: emptyStrategyLedger() } });
      const candidate = candidateFixture(); candidate.contracts = 2;
      const prepared = prepareStrategyImport(candidate, emptyStrategyLedger(), []);
      if ("reasons" in prepared) throw Error("fixture");
      const fail = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("TEST storage quota"); });
      expect(await useOptionsStore.getState().commitSpreadImport(prepared, 1)).toHaveProperty("reasons");
      expect(useOptionsStore.getState().simulations).toHaveLength(0);
      expect(useOptionsStore.getState().strategyLedgersByWorkspace.live.revision).toBe(0);
      fail.mockRestore();
      await useOptionsStore.getState().commitSpreadImport(prepared, 1);
      const state = useOptionsStore.getState();
      const json = exportWorkspaceJson({ workspace: "live", simulations: state.simulationsByWorkspace.live, strategyLedger: state.strategyLedgersByWorkspace.live, exportedAt: "TEST" });
      const backup = parseWorkspaceJson(json);
      state.replaceWorkspaceData(backup);
      expect(useOptionsStore.getState().simulations[0].optionEntryExecutions?.map(entry => entry.contracts)).toEqual([2, 2]);
      const raw = JSON.parse(localStorage.getItem("us-options-simulations-v2")!);
      expect(hydrateStrategyRecords(raw.live, raw.strategyLedgers.live)[0].optionEntryExecutions).toHaveLength(2);
      expect(useOptionsStore.getState().ungroupSpread(candidate.id)).toEqual({});
      expect(useOptionsStore.getState().simulations.map(item => item.optionLegs[0].quantity)).toEqual([2, 2]);
      expect(useOptionsStore.getState().strategyLedgersByWorkspace.live.allocations).toHaveLength(0);
    } finally { vi.restoreAllMocks(); useOptionsStore.setState(prior); localStorage.clear(); }
  });
  it("T09/T18 preview is pure; confirm adds one parent allocation; repeat is no-op", () => {
    const ledger = emptyStrategyLedger(), candidate = candidateFixture(), before = JSON.stringify(ledger);
    const prepared = prepareStrategyImport(candidate, ledger, []);
    expect(JSON.stringify(ledger)).toBe(before);
    if ("reasons" in prepared) throw new Error(prepared.reasons.join());
    const committed = commitStrategyImport(prepared, ledger, [], 1);
    if ("reasons" in committed) throw new Error(committed.reasons.join());
    expect(committed.ledger.fills).toHaveLength(2);
    expect(committed.ledger.allocations).toHaveLength(2);
    expect(materializeStrategyEntries(candidate.id, committed.ledger, []).entries.map(entry => entry.commissionUSD)).toEqual([2.24, 2.24]);
    expect(commitStrategyImport(prepared, committed.ledger, [], 1)).toMatchObject({ changed: false });
  });
  it("T16 stale ledger, stale request, changed evidence cannot commit", () => {
    const ledger = emptyStrategyLedger(), candidate = candidateFixture();
    const prepared = prepareStrategyImport(candidate, ledger, []);
    if ("reasons" in prepared) throw new Error("fixture");
    expect(commitStrategyImport(prepared, { ...ledger, revision: 1 }, [], 1)).toHaveProperty("reasons");
    expect(commitStrategyImport(prepared, ledger, [], 2)).toHaveProperty("reasons");
    candidate.fills[0].execution!.commissionUSD = 9;
    expect(commitStrategyImport(prepared, ledger, [], 1)).toHaveProperty("reasons");
  });
  it.each(["account", "underlying", "expiry", "multiplier", "settlement", "deliverable"])("T08 rejects %s without mutation", field => {
    const candidate = candidateFixture();
    if (field === "account") candidate.fills[1].identity.accountKey = "TEST-other";
    else if (field === "multiplier") candidate.fills[1].contract.multiplier = 10;
    else Object.assign(candidate.fills[1].contract, { [field]: "TEST-other" });
    expect(prepareStrategyImport(candidate, emptyStrategyLedger(), [])).toHaveProperty("reasons");
  });
  it.each(["partial", "failed", "pending"] as const)("T15 %s source never claims complete zero", status => {
    const candidate = candidateFixture(); candidate.coverage[1].status = status;
    expect(prepareStrategyImport(candidate, emptyStrategyLedger(), [])).toHaveProperty("reasons");
  });
  it("T10 IDs preserve equal-price split fills and distinguish entity kinds", () => {
    const identity = candidateFixture().fills[0].identity;
    expect(strategyIdentityKey(identity)).not.toBe(strategyIdentityKey({ ...identity, id: "TEST-other-fill" }));
    expect(strategyIdentityKey(identity)).not.toBe(strategyIdentityKey({ ...identity, kind: "order" }));
  });
  it("T14 a source revision does not silently replace prior confirmed evidence", () => {
    const candidate = candidateFixture(), ledger = emptyStrategyLedger();
    const prepared = prepareStrategyImport(candidate, ledger, []);
    if ("reasons" in prepared) throw new Error("fixture");
    const committed = commitStrategyImport(prepared, ledger, [], 1);
    if ("reasons" in committed) throw new Error("fixture");
    const next = candidateFixture(); next.id = "TEST-next"; next.fills[0].revision = "TEST-v2";
    expect(prepareStrategyImport(next, committed.ledger, [])).toHaveProperty("reasons");
  });
  it("fee allocation preserves one cent across three pieces, including signed rebate", () => {
    expect([0, 1, 2].map(prior => allocateMoney(.01, 3, prior, 1)).reduce((a, b) => a + b)).toBe(.01);
    expect([0, 1, 2].map(prior => allocateMoney(-.01, 3, prior, 1)).reduce((a, b) => a + b)).toBe(-.01);
  });
});
