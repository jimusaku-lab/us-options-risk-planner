import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { calculateHistoryPerformance } from "@/domain/historyPerformance";
import { emptyStrategyLedger } from "@/domain/strategyLedger";
import { hydrateStrategyRecords, useOptionsStore } from "@/store/useOptionsStore";
import type { TradeSimulation } from "@/types/domain";

vi.mock("@/components/results/Charts", () => ({ DenominatorChart: () => null, PayoffChart: () => null }));
vi.mock("@/components/dashboard/YearlyPerformanceSummaryCard", () => ({ YearlyPerformanceSummaryCard: () => null }));

const originalStore = useOptionsStore.getState();

function simulation(): TradeSimulation {
  return {
    id: "R11-spread", status: "open", name: "Anonymous spread", ticker: "TEST", strategyType: "bear_put_spread",
    currentPriceUSD: 95, fxRateJPY: 0, accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD",
    entryDate: "2026-09-01", expiryDate: "2026-10-02", dte: 31, stockPosition: null,
    optionLegs: [
      { id: "R11-long", type: "put", side: "buy", strikeUSD: 100, premiumUSD: 4.92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02" },
      { id: "R11-short", type: "put", side: "sell", strikeUSD: 90, premiumUSD: 0.92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02" },
    ],
    optionEntryExecutions: [
      { id: "R11-entry-long", legId: "R11-long", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 4.92, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true },
      { id: "R11-entry-short", legId: "R11-short", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 0.92, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true },
    ],
    optionCloseExecutions: [
      { id: "R11-close-short", legId: "R11-short", closeKind: "buyback", closeDate: "2026-09-10", contracts: 1, closePriceUSD: 0.84, commissionUSD: 2.24, settlementCurrency: "USD", source: "saxo_history", sourceCandidateId: "R11-candidate-short", confirmationStatus: "pending", confirmed: false },
      { id: "R11-close-long", legId: "R11-long", closeKind: "buyback", closeDate: "2026-09-10", contracts: 1, closePriceUSD: 4.5, commissionUSD: 2.24, settlementCurrency: "USD", source: "saxo_history", sourceCandidateId: "R11-candidate-long", confirmationStatus: "pending", confirmed: false },
    ],
    brokerMarginJPY: 0, brokerMarginUSD: 0, marginBufferMultiplier: 1, marginUsagePercent: 0,
    availableCashJPY: 0, denominatorMode: "custom", taxProfileId: "none_nisa_or_tax_free_comparison", nisaExpectedAnnualReturnPct: 8,
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("us-options-first-run-notice-accepted", "true");
  const value = simulation();
  useOptionsStore.setState({
    activeWorkspace: "live", simulationsByWorkspace: { demo: [], live: [value] }, simulations: [value],
    strategyLedgersByWorkspace: { demo: emptyStrategyLedger(), live: emptyStrategyLedger() },
    selectedSimulationId: value.id, selectedSimulationIds: { demo: "", live: value.id },
    wheelCycles: [], wheelEvents: [], stockTransfers: [], wheelCyclesByWorkspace: { demo: [], live: [] },
    wheelEventsByWorkspace: { demo: [], live: [] }, stockTransfersByWorkspace: { demo: [], live: [] },
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: "isolated_fixture" }) }) as Response));
});

afterEach(() => {
  cleanup();
  useOptionsStore.setState(originalStore);
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SAXO-SPREAD-CLOSE-CONFIRM-20260915-R11 App integration", () => {
  it("keeps imported drafts inert until the R12 parent confirmation, then persists both once", async () => {
    render(<App />);
    const before = JSON.stringify(useOptionsStore.getState().simulationsByWorkspace);
    expect(calculateHistoryPerformance(useOptionsStore.getState().simulations[0]).realizedOptionProfitUSD).toBe(0);
    fireEvent.click(await screen.findByTitle("この建玉を編集"));
    await waitFor(() => expect(document.getElementById("option-close-execution-R11-close-short")).not.toBeNull());
    const shortCard = document.getElementById("option-close-execution-R11-close-short")!;
    expect(within(shortCard).getByText(/\$3\.52 \/ 参考JPY 未確認/)).toBeInTheDocument();
    expect(JSON.stringify(useOptionsStore.getState().simulationsByWorkspace)).toBe(before);

    expect(within(shortCard).queryByRole("button", { name: /正式保存/ })).not.toBeInTheDocument();
    const review = screen.getByRole("region", { name: "ベア・プット2脚の決済確認" });
    expect(within(review).getByText("P100買い（売り決済）")).toBeInTheDocument();
    expect(within(review).getByText("P90売り（買い決済）")).toBeInTheDocument();
    fireEvent.click(within(review).getByRole("button", { name: "2脚の決済内容を確認して正式保存" }));
    await waitFor(() => expect(useOptionsStore.getState().simulations[0].status).toBe("closed"));
    const stored = useOptionsStore.getState().simulations[0];
    expect(stored.optionCloseExecutions?.every((execution) => execution.confirmed)).toBe(true);
    expect(calculateHistoryPerformance(stored).realizedOptionProfitUSD).toBe(-42.96);

    const persisted = JSON.parse(localStorage.getItem("us-options-simulations-v2")!);
    const reloaded = hydrateStrategyRecords(persisted.live, persisted.strategyLedgers.live)[0];
    expect(reloaded.status).toBe("closed");
    expect(reloaded.optionCloseExecutions).toHaveLength(2);
    expect(calculateHistoryPerformance(reloaded).realizedOptionProfitUSD).toBe(-42.96);
  });
});
