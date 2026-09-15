import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { emptyStrategyLedger } from "@/domain/strategyLedger";
import { useOptionsStore } from "@/store/useOptionsStore";
import type { TradeSimulation } from "@/types/domain";

vi.mock("@/components/results/Charts", () => ({ DenominatorChart: () => null, PayoffChart: () => null }));
vi.mock("@/components/dashboard/YearlyPerformanceSummaryCard", () => ({ YearlyPerformanceSummaryCard: () => null }));

const originalStore = useOptionsStore.getState();
const fetchedAt = "2026-09-15T01:02:03.000Z";
const accountKey = "TEST-account-P";
const simulation: TradeSimulation = {
  id: "TEST-long-call", status: "open", name: "TEST long call", ticker: "TEST", strategyType: "long_call",
  currentPriceUSD: 55, fxRateJPY: 150, accountCode: "P", accountEnvironment: "PROD_P_JPY_SETTLEMENT",
  entryDate: "2026-06-01", expiryDate: "2026-10-16", dte: 137, accountCurrency: "JPY", stockPosition: null,
  brokerMarginJPY: 0, marginBufferMultiplier: 1, denominatorMode: "custom", taxProfileId: "japan_derivative_separate_tax_user_confirm",
  optionLegs: [{ id: "TEST-call-leg", type: "call", side: "buy", strikeUSD: 55, premiumUSD: 3.3, quantity: 1, expiryDate: "2026-10-16", saxoAccountKey: accountKey, saxoUic: 990001 }],
  optionEntryExecutions: [{ id: "TEST-entry", legId: "TEST-call-leg", tradeDate: "2026-06-01", contracts: 1, fillPriceUSD: 3.3, settlementCurrency: "JPY", brokerBookedAmountJPY: -50_000, source: "broker_statement", confirmed: true }],
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("us-options-first-run-notice-accepted", "true");
  localStorage.setItem("us-options-saxo-account-mappings-v1", JSON.stringify([{ workspace: "real", accountKey, currency: "JPY", mappedCode: "P", environment: "live", confirmedByUser: true, confirmedAt: fetchedAt }]));
  useOptionsStore.setState({
    activeWorkspace: "live", simulationsByWorkspace: { demo: [], live: [simulation] }, simulations: [simulation],
    strategyLedgersByWorkspace: { demo: emptyStrategyLedger(), live: emptyStrategyLedger() },
    selectedSimulationId: "", selectedSimulationIds: { demo: "", live: "" }, wheelCycles: [], wheelEvents: [], stockTransfers: [],
    wheelCyclesByWorkspace: { demo: [], live: [] }, wheelEventsByWorkspace: { demo: [], live: [] }, stockTransfersByWorkspace: { demo: [], live: [] },
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://fixture.invalid");
    const envelope = { environment: "live", readOnly: true, fetchedAt };
    const responses: Record<string, unknown> = {
      "/api/market/fx/usdjpy": { pair: "USDJPY", rate: 150, source: "fixture", date: "2026-09-15", fetchedAt },
      "/api/saxo/status": { mode: "saxo_readonly", connected: true, connectionState: "connected", hasToken: true, readOnly: true, environment: "live", environmentConfigured: true, oauthConfigured: true, bindAddress: "127.0.0.1", orderEndpointsEnabled: false },
      "/api/saxo/config/status": { mode: "saxo_readonly", readOnly: true, environment: "live", environmentConfigured: true, clientIdConfigured: true, configurationWarnings: [], localConfigFileExists: true },
      "/api/saxo/accounts/snapshot": { ...envelope, accounts: [] },
      "/api/saxo/positions/snapshot": { ...envelope, positions: [], coverage: { completedPages: 1, status: "complete" } },
      "/api/saxo/orders/snapshot": { ...envelope, orders: [{ id: "TEST-stop", accountKey, accountAssignment: "P", accountCode: "P", symbol: "TEST/16V26C55:XCBF", assetType: "StockOption", quantity: 1, side: "sell", optionType: "call", strike: 55, expiry: "2026-10-16", uic: 990001, status: "Working", orderType: "StopIfTraded", orderRelation: "StandAlone", openClose: "close", stopPrice: 0.5, missingFields: [], fetchedAt }], coverage: { completedPages: 1, status: "complete" } },
      "/api/saxo/history/discovery": { ...envelope, fromDate: "2026-09-01", toDate: "2026-09-15", endpoints: [] },
    };
    if (!(url.pathname in responses)) throw new Error(`unexpected fixture request ${url.pathname}`);
    return { ok: true, status: 200, json: async () => structuredClone(responses[url.pathname]) } as Response;
  }));
});

afterEach(() => {
  cleanup();
  useOptionsStore.setState(originalStore);
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SAXO-EXIT-ORDER-REVIEW-20260915-R10", () => {
  it("keeps a long-call stop informational and opens the visible focused review without saving", async () => {
    const before = JSON.stringify(useOptionsStore.getState().simulationsByWorkspace);
    render(<App />);
    const summary = screen.getByText("Saxo API詳細");
    const details = summary.closest("details")!;
    fireEvent.click(summary);
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const fetchButton = await screen.findByRole("button", { name: "まとめて取得" });
    await waitFor(() => expect(fetchButton).toBeEnabled());
    fireEvent.click(fetchButton);
    expect(await screen.findByText(/逆指値注文あり（未約定）/)).toBeInTheDocument();
    expect(screen.queryByText(/出口ルール確認待ち/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Saxoの注文を見る（任意）" })[0]);
    const review = await screen.findByRole("region", { name: "TESTの決済注文レビュー" });
    await waitFor(() => expect(review).toHaveFocus());
    expect(review).toHaveTextContent("逆指値 / $0.50");
    expect(JSON.stringify(useOptionsStore.getState().simulationsByWorkspace)).toBe(before);
    expect(useOptionsStore.getState().simulations[0].status).toBe("open");
    expect(useOptionsStore.getState().simulations[0].optionCloseExecutions ?? []).toHaveLength(0);
  });
});
