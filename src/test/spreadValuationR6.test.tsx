import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { calculateBearPutSpreadEstimate } from "@/domain/bearPutSpread";
import { emptyStrategyLedger } from "@/domain/strategyLedger";
import { useOptionsStore } from "@/store/useOptionsStore";
import type { TradeSimulation } from "@/types/domain";

vi.mock("@/components/results/Charts", () => ({ DenominatorChart: () => null, PayoffChart: () => null }));
vi.mock("@/components/dashboard/YearlyPerformanceSummaryCard", () => ({ YearlyPerformanceSummaryCard: () => null }));

const initialStore = useOptionsStore.getState();
const fixture: TradeSimulation = {
  id: "r6-spread", status: "open", name: "Anonymous spread", ticker: "TEST", strategyType: "bear_put_spread",
  currentPriceUSD: 0, fxRateJPY: 150, accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT",
  entryDate: "2026-09-01", expiryDate: "2026-10-02", dte: 31, accountCurrency: "USD", stockPosition: null,
  brokerMarginJPY: 0, marginBufferMultiplier: 1, denominatorMode: "custom", taxProfileId: "none_nisa_or_tax_free_comparison",
  optionLegs: [
    { id: "long", type: "put", side: "buy", strikeUSD: 100, premiumUSD: 4.02, quantity: 1, contractSize: 100, expiryDate: "2026-10-02", saxoAccountKey: "fixture-account", saxoUic: 101 },
    { id: "short", type: "put", side: "sell", strikeUSD: 90, premiumUSD: 0.02, quantity: 1, contractSize: 100, expiryDate: "2026-10-02", saxoAccountKey: "fixture-account", saxoUic: 102 },
  ],
  optionEntryExecutions: [
    { id: "entry-long", legId: "long", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 4.02, settlementCurrency: "USD", commissionUSD: 2.24, source: "broker_statement", confirmed: true },
    { id: "entry-short", legId: "short", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 0.02, settlementCurrency: "USD", commissionUSD: 2.24, source: "broker_statement", confirmed: true },
  ],
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("us-options-first-run-notice-accepted", "true");
  useOptionsStore.setState({ activeWorkspace: "live", simulationsByWorkspace: { demo: [], live: [fixture] }, simulations: [fixture], strategyLedgersByWorkspace: { demo: emptyStrategyLedger(), live: emptyStrategyLedger() }, selectedSimulationId: "", selectedSimulationIds: { demo: "", live: "" }, wheelCycles: [], wheelEvents: [], stockTransfers: [], wheelCyclesByWorkspace: { demo: [], live: [] }, wheelEventsByWorkspace: { demo: [], live: [] }, stockTransfersByWorkspace: { demo: [], live: [] } });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://fixture.invalid");
    if (url.pathname === "/api/saxo/status") return { ok: true, status: 200, json: async () => ({ connected: true, readOnly: true, environment: "live", capabilities: { bulkOptionPremiumPreview: true } }) } as Response;
    if (url.pathname === "/api/market/quote") return { ok: true, status: 200, json: async () => ({ symbol: "TEST", price: 94, source: "nasdaq", date: "2026-09-12", fetchedAt: "2026-09-13T01:00:00Z" }) } as Response;
    if (url.pathname === "/api/saxo/options/premium-candidates/preview") return { ok: true, status: 200, json: async () => ({ readOnly: true, results: [
      { targetId: "r6-spread:long", candidate: { status: "available", classification: "available", source: "saxo", fetchedAt: "2026-09-13T01:00:00Z", bid: 4.05, quoteDiagnostics: { priceTypeBid: "OldIndicative" } } },
      { targetId: "r6-spread:short", candidate: { status: "available", classification: "available", source: "saxo", fetchedAt: "2026-09-13T01:00:00Z", ask: 0.79, quoteDiagnostics: { priceTypeAsk: "OldIndicative" } } },
    ] }) } as Response;
    throw new Error(`unexpected fixture request ${url.pathname}`);
  }));
});

afterEach(() => { cleanup(); useOptionsStore.setState(initialStore); localStorage.clear(); vi.unstubAllGlobals(); });

describe("R6 integrated preview", () => {
  it("does not save on preview and applies stock plus both option legs once", async () => {
    render(<App />);
    const open = await screen.findByRole("button", { name: "価格を一括更新" });
    await waitFor(() => expect(open).toBeEnabled());
    const before = JSON.stringify(useOptionsStore.getState().simulationsByWorkspace);
    fireEvent.click(open);
    expect(await screen.findByText(/TEST: 94 \/ nasdaq/)).toBeInTheDocument();
    expect(JSON.stringify(useOptionsStore.getState().simulationsByWorkspace)).toBe(before);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /株価1銘柄・確認済み参考価格 2脚を一括反映/ }));
    await waitFor(() => expect(useOptionsStore.getState().simulations[0].currentPriceUSD).toBe(94));
    const saved = useOptionsStore.getState().simulations[0];
    expect(saved.optionLegs.map((leg) => leg.closeCostUSD)).toEqual([4.05, 0.79]);
    expect(saved.optionEntryExecutions).toEqual(fixture.optionEntryExecutions);
    expect(saved.optionCloseExecutions).toHaveLength(0);
    expect(calculateBearPutSpreadEstimate(saved)).toMatchObject({ kind: "available", entryAllInDebitUSD: 404.48, closeNetProceedsUSD: 321.52, totalEstimatedPnlUSD: -82.96 });
    await act(async () => {});
  });
});
