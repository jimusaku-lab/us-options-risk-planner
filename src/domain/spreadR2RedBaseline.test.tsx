import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OptionCloseExecution, TradeSimulation } from "@/types/domain";
import type { AccountInputs } from "@/store/useOptionsStore";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { SpreadPerformancePreview } from "@/components/results/SpreadPerformancePreview";
import { calculateBearPutSpreadEstimate, validateBearPutSpread } from "./bearPutSpread";
import { calculateHistoryPerformance } from "./historyPerformance";
import { calculateYearlyPerformanceSummary } from "./yearlyPerformance";
import { calculateOptionCloseExecutionResult, getClosedSyntheticLegHistoryItems, getOptionCloseCompletion } from "./optionCloseExecutions";

// SPREAD-REPAIR-20260912-R2 / RED_BASELINE. All values and identities are
// fictional contract-J fixtures. These tests intentionally assert the correct
// v1.1 result against existing production, not the known incorrect result.
function spread(contracts = 1, multiplier = 100): TradeSimulation {
  return {
    id: "TEST-spread", name: "TEST spread", ticker: "TEST", status: "open", strategyType: "bear_put_spread",
    accountCode: "N", accountCurrency: "USD", accountEnvironment: "PROD_N_USD_SETTLEMENT",
    currentPriceUSD: 95, fxRateJPY: 150, entryDate: "2026-09-01", expiryDate: "2026-10-02", dte: 31,
    stockPosition: null, brokerMarginJPY: 0, marginBufferMultiplier: 1, denominatorMode: "custom",
    taxProfileId: "none_nisa_or_tax_free_comparison",
    optionLegs: [
      { id: "TEST-long", type: "put", side: "buy", strikeUSD: 100, premiumUSD: 4.92, quantity: contracts,
        contractSize: multiplier, expiryDate: "2026-10-02", saxoAccountKey: "TEST-account-A", saxoUic: 900001,
        closeCostUSD: 4.5, closePlan: { enabled: true, closePriceUSD: 4.5, commissionUSD: 2.24, commissionSource: "manual" } },
      { id: "TEST-short", type: "put", side: "sell", strikeUSD: 90, premiumUSD: 0.92, quantity: contracts,
        contractSize: multiplier, expiryDate: "2026-10-02", saxoAccountKey: "TEST-account-A", saxoUic: 900002,
        closeCostUSD: 0.7, closePlan: { enabled: true, closePriceUSD: 0.7, commissionUSD: 2.24, commissionSource: "manual" } },
    ],
    optionEntryExecutions: [
      { id: "TEST-entry-long", legId: "TEST-long", tradeDate: "2026-09-01", contracts, fillPriceUSD: 4.92,
        commissionUSD: 2.24 * contracts, commissionSource: "saxo_actual", settlementCurrency: "USD", source: "broker_statement", confirmed: true },
      { id: "TEST-entry-short", legId: "TEST-short", tradeDate: "2026-09-01", contracts, fillPriceUSD: 0.92,
        commissionUSD: 2.24 * contracts, commissionSource: "saxo_actual", settlementCurrency: "USD", source: "broker_statement", confirmed: true },
    ],
  };
}

function close(legId: "TEST-long" | "TEST-short"): OptionCloseExecution {
  return { id: `TEST-close-${legId}`, legId, confirmed: true, closeKind: "buyback", closeDate: "2026-09-10",
    contracts: 1, closePriceUSD: legId === "TEST-long" ? 4.5 : 0.7, commissionUSD: 2.24,
    settlementCurrency: "USD", source: "broker_statement" };
}

const accountInputs: AccountInputs = {
  P: { accountCode: "P", currency: "JPY", cashBalance: 10000, marginAvailable: 10000, marginUsagePercent: 10, updatedAt: "2026-09-01" },
  N: { accountCode: "N", currency: "USD", cashBalance: 10000, marginAvailable: 10000, marginUsagePercent: 10, updatedAt: "2026-09-01" },
};

afterEach(cleanup);

describe("SPREAD-REPAIR-20260912-R2 RED_BASELINE", () => {
  it("T12/T13 ambiguous partial lots keep D; fully liquidated cashflow is still known", () => {
    const simulation = spread(2);
    simulation.optionEntryExecutions = simulation.optionEntryExecutions!.flatMap(entry => [
      { ...entry, contracts: 1, commissionUSD: 2.24 },
      { ...entry, id: `${entry.id}-second`, contracts: 1, tradeDate: "2026-09-02", commissionUSD: 2.24 },
    ]);
    simulation.optionCloseExecutions = [close("TEST-long")];
    expect(calculateBearPutSpreadEstimate(simulation)).toMatchObject({ kind: "missing", entryAllInDebitUSD: 808.96 });
    simulation.optionCloseExecutions = [close("TEST-long"), close("TEST-short"), { ...close("TEST-long"), id: "TEST-long-second", closeDate: "2026-09-11" }, { ...close("TEST-short"), id: "TEST-short-second", closeDate: "2026-09-11" }];
    simulation.status = "closed";
    expect(calculateBearPutSpreadEstimate(simulation)).toMatchObject({ kind: "available", totalEstimatedPnlUSD: -57.92, annualizedReturnPct: undefined });
    expect(calculateHistoryPerformance(simulation).realizedOptionProfitUSD).toBe(-57.92);
  });
  it("T13/T17 year-crossing records count each closed leg once and ignore later quote/FX", () => {
    const simulation = { ...spread(), status: "closed" as const, optionCloseExecutions: [
      { ...close("TEST-long"), closeDate: "2026-12-31" }, { ...close("TEST-short"), closeDate: "2027-01-01" },
    ] };
    expect(calculateYearlyPerformanceSummary([simulation], 2026).monthly.reduce((sum, row) => sum + row.nOptionUSD, 0)).toBe(-46.48);
    expect(calculateYearlyPerformanceSummary([simulation], 2027).monthly.reduce((sum, row) => sum + row.nOptionUSD, 0)).toBe(17.52);
    const initial = calculateHistoryPerformance(simulation);
    const changed = calculateHistoryPerformance({ ...simulation, currentPriceUSD: 999, fxRateJPY: 999 });
    expect(changed.realizedOptionProfitUSD).toBe(initial.realizedOptionProfitUSD);
    expect(changed.holdingPeriodReturnPct).toBe(initial.holdingPeriodReturnPct);
  });
  it("T14 corrected close supersedes its old quantity and cashflow, preserving the old record", () => {
    const original = close("TEST-long");
    const simulation = { ...spread(), optionCloseExecutions: [original, { ...original, id: "TEST-corrected", supersedesId: original.id, closePriceUSD: 4.6 }] };
    expect(calculateBearPutSpreadEstimate(simulation)).toMatchObject({ lifecycle: { state: "one_leg_remaining" }, realizedPnlUSD: -36.48 });
    expect(simulation.optionCloseExecutions).toHaveLength(2);
  });
  it("T01 control: existing all-open production arithmetic is -28.96 on D404.48 and immutable", () => {
    const simulation = spread();
    const before = JSON.stringify(simulation);
    const result = calculateBearPutSpreadEstimate(simulation, "2026-09-10");
    expect(result.kind).toBe("available");
    if (result.kind !== "available") throw new Error("complete fixture unexpectedly missing");
    expect(result.entryAllInDebitUSD).toBeCloseTo(404.48, 8);
    expect(result.closeNetProceedsUSD).toBeCloseTo(375.52, 8);
    expect(result.totalEstimatedPnlUSD).toBeCloseTo(-28.96, 8);
    expect(JSON.stringify(simulation)).toBe(before);
  });

  it("T02: ended history retains the same D404.48 and -7.1598101266 percent", () => {
    const simulation = { ...spread(), status: "closed" as const, optionCloseExecutions: [close("TEST-long"), close("TEST-short")] };
    expect(getOptionCloseCompletion(simulation).state).toBe("complete");
    const result = calculateHistoryPerformance(simulation);
    expect(result.realizedOptionProfitUSD).toBeCloseTo(-28.96, 8);
    expect.soft(result.primaryDenominator.amountUSD).toBeCloseTo(404.48, 8);
    expect.soft(result.holdingPeriodReturnPct).toBeCloseTo(-7.159810126582279, 8);
  });

  it("T03: confirmed spread long-put close produces one leg-history row while parent stays open", () => {
    const simulation = { ...spread(), optionCloseExecutions: [close("TEST-long")] };
    expect(getOptionCloseCompletion(simulation).state).toBe("partial");
    const result = calculateBearPutSpreadEstimate(simulation, "2026-09-10");
    expect(result).toMatchObject({ kind: "available", lifecycle: { state: "one_leg_remaining" } });
    if (result.kind === "available") {
      expect(result.realizedPnlUSD).toBeCloseTo(-46.48, 8);
      expect(result.remainingEstimatedPnlUSD).toBeCloseTo(17.52, 8);
    }
    // This is the actual history selector used by Dashboard, not a test-only model.
    expect(getClosedSyntheticLegHistoryItems([simulation]).map((item) => item.legId)).toEqual(["TEST-long"]);
    expect(simulation.status).toBe("open");
  });

  it("T04: multiplier10 stays consistent through close result and spread cumulative P/L", () => {
    const execution = close("TEST-long");
    const simulation = { ...spread(1, 10), optionCloseExecutions: [execution] };
    expect.soft(calculateOptionCloseExecutionResult(simulation, execution)?.realizedPnlUSD).toBeCloseTo(-8.68, 8);
    const result = calculateBearPutSpreadEstimate(simulation, "2026-09-10");
    expect(result.kind).toBe("available");
    if (result.kind !== "available") throw new Error("complete multiplier10 fixture unexpectedly missing");
    expect(result.entryAllInDebitUSD).toBeCloseTo(44.48, 8);
    expect(result.remainingEstimatedPnlUSD).toBeCloseTo(-2.28, 8);
    expect.soft(result.totalEstimatedPnlUSD).toBeCloseTo(-10.96, 8);
  });

  it("T06: explicit remaining-one-contract close total2.24 is not halved again", () => {
    const simulation = { ...spread(2), optionCloseExecutions: [close("TEST-long"), close("TEST-short")] };
    // Each closePlan is explicitly for its current one-contract remainder;
    // these are scenario totals, not fees for the original two contracts.
    const result = calculateBearPutSpreadEstimate(simulation, "2026-09-10");
    expect(result).toMatchObject({ kind: "available", lifecycle: { state: "partial_pairs", longRemaining: 1, shortRemaining: 1 } });
    if (result.kind !== "available") throw new Error("complete partial fixture unexpectedly missing");
    expect(result.entryAllInDebitUSD).toBeCloseTo(808.96, 8);
    expect.soft(result.evaluatedLegs.map((leg) => leg.closeFeeUSD)).toEqual([2.24, 2.24]);
    expect.soft(result.remainingEstimatedPnlUSD).toBeCloseTo(-28.96, 8);
    expect.soft(result.totalEstimatedPnlUSD).toBeCloseTo(-57.92, 8);
  });

  it.each(["price", "fee"] as const)("T07: missing exit %s does not erase known D404.48 in Dashboard", (missing) => {
    const simulation = spread();
    const leg = simulation.optionLegs[0];
    if (missing === "price") { leg.closeCostUSD = undefined; leg.closePlan!.closePriceUSD = undefined; }
    else leg.closePlan!.commissionUSD = undefined;
    const result = calculateBearPutSpreadEstimate(simulation, "2026-09-10");
    expect(result.kind).toBe(missing === "price" ? "missing" : "available");
    if (missing === "fee" && result.kind === "available") {
      expect(result.evaluatedLegs[0]).toMatchObject({ closeFeeUSD: 2.24, closeFeeSource: "saxo_ticket_confirmed_standard" });
      expect(leg.closePlan?.commissionUSD).toBeUndefined();
    }
    render(<Dashboard simulations={[simulation]} selectedId={simulation.id} onSelect={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()}
      workspace="live" accountInputs={accountInputs} historyOpen={false} onHistoryOpenChange={vi.fn()}
      positionFocusSimulationId={simulation.id} onPositionFocus={vi.fn()} />);
    render(<SpreadPerformancePreview simulation={simulation} />);
    const detail = screen.getByRole("region", { name: "戦略の決済プレビュー" });
    const entryCard = within(detail).getByText("建玉時の手数料込み支払額").parentElement!;
    expect(entryCard).toHaveTextContent("$404.48");
  });

  it("T08: saved spread with different leg accounts is invalid without mutating evidence", () => {
    const simulation = spread();
    simulation.optionLegs[1].saxoAccountKey = "TEST-account-B";
    const before = JSON.stringify(simulation);
    expect.soft(validateBearPutSpread(simulation).valid).toBe(false);
    expect(JSON.stringify(simulation)).toBe(before);
  });

  it("T11: un-timestamped manual exit prices must be labelled reference, not implicit current Bid/Ask", () => {
    const simulation = spread();
    // Numbers have been entered explicitly, but neither leg has quote evidence
    // or a recorded source time. They must not silently become current quotes.
    render(<Dashboard simulations={[simulation]} selectedId={simulation.id} onSelect={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()}
      workspace="live" accountInputs={accountInputs} historyOpen={false} onHistoryOpenChange={vi.fn()}
      positionFocusSimulationId={simulation.id} onPositionFocus={vi.fn()} />);
    render(<SpreadPerformancePreview simulation={simulation} />);
    const detail = screen.getByRole("region", { name: "戦略の決済プレビュー" });
    expect(detail).toHaveTextContent(/手入力参考.*時点未記録/);
  });

  it.each(["expiry", "multiplier", "currency"] as const)("T08 control: existing %s incompatibility remains rejected", (mismatch) => {
    const simulation = spread();
    if (mismatch === "expiry") simulation.optionLegs[1].expiryDate = "2026-11-20";
    if (mismatch === "multiplier") simulation.optionLegs[1].contractSize = 10;
    if (mismatch === "currency") simulation.accountCurrency = "JPY";
    expect(validateBearPutSpread(simulation).valid).toBe(false);
  });
});
