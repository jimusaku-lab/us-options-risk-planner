import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { emptyStrategyLedger } from "@/domain/strategyLedger";
import { useOptionsStore } from "@/store/useOptionsStore";
import type { TradeSimulation } from "@/types/domain";

vi.mock("@/components/results/Charts", () => ({ DenominatorChart: () => null, PayoffChart: () => null }));
vi.mock("@/components/dashboard/YearlyPerformanceSummaryCard", () => ({ YearlyPerformanceSummaryCard: () => null }));
const at = "2026-09-26T06:00:00Z";
const originalStore = useOptionsStore.getState();
let connected = false;
let capability = true;
let premiumCalls = 0;
let statusCalls = 0;
function fixture(): TradeSimulation {
  return {
    id: "mid-parent", status: "open", name: "Anonymous spread", ticker: "TEST", strategyType: "bull_call_spread",
    currentPriceUSD: 110, fxRateJPY: 150, accountCode: "N", accountCurrency: "USD", accountEnvironment: "PROD_N_USD_SETTLEMENT",
    entryDate: "2026-09-01", expiryDate: "2026-12-18", dte: 83, stockPosition: null,
    optionLegs: [
      { id: "mid-long", type: "call", side: "buy", strikeUSD: 100, premiumUSD: 11, quantity: 1, contractSize: 100, expiryDate: "2026-12-18", saxoUic: 881101 },
      { id: "mid-short", type: "call", side: "sell", strikeUSD: 120, premiumUSD: 3, quantity: 1, contractSize: 100, expiryDate: "2026-12-18", saxoUic: 881102 },
    ],
    optionEntryExecutions: [
      { id: "entry-long", legId: "mid-long", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 11, commissionUSD: 2, settlementCurrency: "USD", source: "broker_statement", confirmed: true },
      { id: "entry-short", legId: "mid-short", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 3, commissionUSD: 2, settlementCurrency: "USD", source: "broker_statement", confirmed: true },
    ],
    optionCloseExecutions: [], brokerMarginJPY: 0, marginBufferMultiplier: 1, denominatorMode: "custom", taxProfileId: "none_nisa_or_tax_free_comparison",
  };
}
beforeEach(() => {
  connected = false; capability = true; premiumCalls = 0; statusCalls = 0;
  localStorage.clear(); localStorage.setItem("us-options-first-run-notice-accepted", "true");
  const simulation = fixture();
  useOptionsStore.setState({ activeWorkspace: "live", simulationsByWorkspace: { demo: [], live: [simulation] }, simulations: [simulation], strategyLedgersByWorkspace: { demo: emptyStrategyLedger(), live: emptyStrategyLedger() }, selectedSimulationId: simulation.id, selectedSimulationIds: { demo: "", live: simulation.id }, wheelCycles: [], wheelEvents: [], stockTransfers: [], wheelCyclesByWorkspace: { demo: [], live: [] }, wheelEventsByWorkspace: { demo: [], live: [] }, stockTransfersByWorkspace: { demo: [], live: [] } });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://fixture.invalid").pathname;
    const envelope = { environment: "live", readOnly: true, fetchedAt: at };
    const responses: Record<string, unknown> = {
      "/api/market/fx/usdjpy": { pair: "USDJPY", rate: 150, source: "fixture", date: "2026-09-26", fetchedAt: at },
      "/api/market/quote": { symbol: "TEST", source: "fixture", date: "2026-09-26", fetchedAt: at },
      "/api/saxo/status": { ...envelope, connected, connectionState: connected ? "connected" : "disconnected", hasToken: connected, capabilities: { bulkOptionPremiumPreview: capability && connected } },
      "/api/saxo/config/status": { ...envelope, mode: "saxo_readonly", environmentConfigured: true, clientIdConfigured: true, configurationWarnings: [], localConfigFileExists: true },
      "/api/saxo/accounts/snapshot": { ...envelope, accounts: [] },
      "/api/saxo/positions/snapshot": { ...envelope, positions: [], coverage: { status: "complete", completedPages: 1 } },
      "/api/saxo/orders/snapshot": { ...envelope, orders: [], coverage: { status: "complete", completedPages: 1 } },
      "/api/saxo/history/discovery": { ...envelope, endpoints: [{ endpoint: "trades", label: "trades", classification: "ok", itemCount: 0, message: "", items: [], coverage: { status: "complete", completedPages: 1 } }] },
    };
    if (path === "/api/saxo/status") statusCalls++;
    if (path === "/api/saxo/options/premium-candidates/preview") {
      premiumCalls++;
      const targets = JSON.parse(String(init?.body)).targets as { targetId: string }[];
      responses[path] = { ...envelope, results: targets.map(({ targetId }) => ({
        targetId, candidate: { ...envelope, status: "available", classification: "available", source: "fixture",
          bid: targetId.endsWith("mid-long") ? 12 : 2, ask: targetId.endsWith("mid-long") ? 14 : 4,
          quoteDiagnostics: { priceTypeBid: "OldIndicative", priceTypeAsk: "OldIndicative" } },
      })) };
    }
    if (!(path in responses)) throw new Error("Unexpected anonymous endpoint: " + path);
    return { ok: true, status: 200, json: async () => structuredClone(responses[path]) } as Response;
  }));
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); useOptionsStore.setState(originalStore); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mountAndReconnect() {
  render(<App />);
  await waitFor(() => expect(statusCalls).toBeGreaterThan(0));
  // The initial App capability is unavailable; only a fresh status can enable the next attempt.
  connected = true;
  const summary = screen.getByText("Saxo API詳細");
  const details = summary.closest("details")!;
  fireEvent.click(summary); details.open = true; fireEvent(details, new Event("toggle"));
  const button = await screen.findByRole("button", { name: "まとめて取得" });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}
describe("R15 App all-fetch to common price preview", () => {
  it("rechecks reconnect capability, previews without persistence, cancels, then adopts once with explicit reference confirmation", async () => {
    const button = await mountAndReconnect();
    const before = structuredClone(useOptionsStore.getState().simulations);
    const persistence = vi.spyOn(Storage.prototype, "setItem");
    const priceWrites = () => persistence.mock.calls.filter(([key]) => key === "us-options-simulations-v2");
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: "現在オプション価格を一括更新" });
    const apply = await within(dialog).findByRole("button", { name: /一括反映/ });
    expect(premiumCalls).toBe(1);
    expect(statusCalls).toBeGreaterThan(1);
    expect(within(dialog).getByText(/Bid\/Askから中間値の参考損益と決済目安/)).toBeInTheDocument();
    expect(apply).toBeDisabled();
    expect(useOptionsStore.getState().simulations).toEqual(before);
    expect(priceWrites()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "現在オプション価格の確認を閉じる" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useOptionsStore.getState().simulations).toEqual(before);
    expect(screen.getByText("まとめて取得が完了しました。反映待ちサマリーを確認してください。")).toBeInTheDocument();
    fireEvent.click(button);
    const reopened = await screen.findByRole("dialog");
    const checkbox = await within(reopened).findByRole("checkbox", { name: /OldIndicative/ });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(within(reopened).getByRole("button", { name: /一括反映/ }));
    await waitFor(() => expect(useOptionsStore.getState().simulations[0].optionLegs[0].referenceQuote?.midUSD).toBe(13));
    const saved = useOptionsStore.getState().simulations[0];
    expect(saved.optionLegs[1].referenceQuote?.midUSD).toBe(3);
    expect(saved.optionLegs[0].referenceQuote?.batchId).toBe(saved.optionLegs[1].referenceQuote?.batchId);
    expect(saved.optionLegs.map(leg => leg.closePlan?.closePriceUSD)).toEqual([12, 4]);
    expect(priceWrites()).toHaveLength(1);
    expect(saved.optionEntryExecutions).toEqual(before[0].optionEntryExecutions);
    expect(saved.optionCloseExecutions).toEqual(before[0].optionCloseExecutions);
    expect(saved.status).toBe("open");
    expect(JSON.parse(localStorage.getItem("us-options-simulations-v2")!).live[0].optionLegs).toEqual(saved.optionLegs);
  });
  it("keeps account/history completion separate when current helper has no bulk capability", async () => {
    capability = false;
    const button = await mountAndReconnect();
    const before = structuredClone(useOptionsStore.getState().simulations);
    fireEvent.click(button);
    await screen.findByText("まとめて取得が完了しました。反映待ちサマリーを確認してください。");
    await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getAllByText(/一括価格取得に未対応/).length).toBeGreaterThan(0));
    expect(premiumCalls).toBe(0);
    expect(useOptionsStore.getState().simulations).toEqual(before);
  });
});
