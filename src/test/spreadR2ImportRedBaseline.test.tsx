import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { useOptionsStore } from "@/store/useOptionsStore";
import { hydrateStrategyRecords } from "@/store/useOptionsStore";
import { emptyStrategyLedger } from "@/domain/strategyLedger";
import { calculateBearPutSpreadEstimate } from "@/domain/bearPutSpread";
import { calculateHistoryPerformance } from "@/domain/historyPerformance";
import { findSaxoBearPutSpreadPairs, type SaxoAccountMapping, type SaxoApiPositionSnapshot, type SaxoHistoryDiscoveryItem } from "@/features/saxo/saxoAccountSync";

// Unrelated chart presentation is outside this import-path test. Keep App,
// SaxoReadOnlyPanel, reconciliation, apiClient and store real.
vi.mock("@/components/results/Charts", () => ({ DenominatorChart: () => null, PayoffChart: () => null }));
vi.mock("@/components/dashboard/YearlyPerformanceSummaryCard", () => ({ YearlyPerformanceSummaryCard: () => null }));

// SPREAD-REPAIR-20260912-R2 / RED_BASELINE. Mount the real App, Panel,
// apiClient and Zustand actions. HTTP transport, unrelated charts and browser
// scrolling are replaced. JSDOM storage is isolated; no REAL/API access.
const fetchedAt = "2026-09-12T00:00:00.000Z";
const accountKey = "TEST-account-N";
const positions: SaxoApiPositionSnapshot[] = [
  { id: "TEST-position-long", positionId: "TEST-position-long", accountKey, accountAssignment: "N", accountCode: "N",
    symbol: "TEST", underlyingSymbol: "TEST", underlyingIdentity: "uic:990000:stock", underlyingIdentitySource: "instrument_details",
    assetType: "StockOption", kind: "option", side: "long", optionType: "put", strike: 100, expiry: "2026-10-02",
    quantity: 1, premiumOpenPrice: 4.92, contractSize: 100, currency: "USD", uic: 990001, settlementType: "TEST-physical", deliverableIdentity: "TEST-standard-100",
    multiLegOrderId: "TEST-parent-order", multiLegOrderIdSourceField: "MultiLegOrderId", missingFields: [], fetchedAt },
  { id: "TEST-position-short", positionId: "TEST-position-short", accountKey, accountAssignment: "N", accountCode: "N",
    symbol: "TEST", underlyingSymbol: "TEST", underlyingIdentity: "uic:990000:stock", underlyingIdentitySource: "instrument_details",
    assetType: "StockOption", kind: "option", side: "short", optionType: "put", strike: 90, expiry: "2026-10-02",
    quantity: -1, premiumOpenPrice: 0.92, contractSize: 100, currency: "USD", uic: 990002, settlementType: "TEST-physical", deliverableIdentity: "TEST-standard-100",
    multiLegOrderId: "TEST-parent-order", multiLegOrderIdSourceField: "MultiLegOrderId", missingFields: [], fetchedAt },
];
// Actual portfolio payloads need not retain the parent order/deliverable.
positions.forEach(position => { delete position.multiLegOrderId; delete position.deliverableIdentity; delete position.settlementType; });
const trades: SaxoHistoryDiscoveryItem[] = positions.map((position) => ({
  id: `TEST-fill-${position.id}`, tradeId: `TEST-fill-${position.id}`, orderId: `TEST-leg-order-${position.id}`, kind: "trade", accountKey,
  accountCode: "N", accountCurrency: "USD", symbol: "TEST", assetType: "StockOption", optionType: "put",
  uic: position.uic, strike: position.strike, expiry: position.expiry, quantity: 1,
  buySell: position.side === "long" ? "buy" : "sell", openClose: "open", price: position.premiumOpenPrice,
  tradeDate: "2026-09-01", transactionCost: 2.24,
}));
const mapping: SaxoAccountMapping = {
  workspace: "real", accountKey, currency: "USD", mappedCode: "N", environment: "live", confirmedByUser: true, confirmedAt: fetchedAt,
};
trades.forEach(trade => { trade.brokerAccountKey = accountKey; trade.accountKey = "TEST…t-N"; });

const originalStore = useOptionsStore.getState();
const requests: string[] = [];
const unexpectedRequests: string[] = [];
const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("us-options-first-run-notice-accepted", "true");
  localStorage.setItem("us-options-saxo-account-mappings-v1", JSON.stringify([mapping]));
  useOptionsStore.setState({
    activeWorkspace: "live", simulationsByWorkspace: { demo: [], live: [] }, simulations: [],
    strategyLedgersByWorkspace: { demo: emptyStrategyLedger(), live: emptyStrategyLedger() },
    selectedSimulationId: "", selectedSimulationIds: { demo: "", live: "" },
    wheelCycles: [], wheelEvents: [], stockTransfers: [],
    wheelCyclesByWorkspace: { demo: [], live: [] }, wheelEventsByWorkspace: { demo: [], live: [] }, stockTransfersByWorkspace: { demo: [], live: [] },
  });
  requests.length = 0;
  unexpectedRequests.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://fixture.invalid");
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url.pathname}`);
    const envelope = { environment: "live", readOnly: true, fetchedAt };
    const responses: Record<string, unknown> = {
      "/api/market/fx/usdjpy": { pair: "USDJPY", rate: 150, source: "local_proxy", date: "2026-09-12", fetchedAt },
      "/api/saxo/status": { mode: "saxo_readonly", connected: true, connectionState: "connected", hasToken: true, readOnly: true,
        environment: "live", environmentConfigured: true, oauthConfigured: true, bindAddress: "127.0.0.1", orderEndpointsEnabled: false },
      "/api/saxo/config/status": { mode: "saxo_readonly", readOnly: true, environment: "live", environmentConfigured: true,
        clientIdConfigured: true, configurationWarnings: [], localConfigFileExists: true },
      "/api/saxo/accounts/snapshot": { ...envelope, accounts: [] },
      "/api/saxo/positions/snapshot": { ...envelope, positions, coverage: { completedPages: 1, status: "complete" } },
      "/api/saxo/orders/snapshot": { ...envelope, orders: [], coverage: { completedPages: 1, status: "complete" } },
      "/api/saxo/history/discovery": { ...envelope, fromDate: "2026-09-01", toDate: "2026-09-12",
        endpoints: [{ endpoint: "trades", label: "TEST trades", classification: "ok", itemCount: trades.length, message: "", items: trades, coverage: { completedPages: 1, status: "complete" } }] },
    };
    if (method !== "GET" || !(url.pathname in responses)) {
      unexpectedRequests.push(`${method} ${url.pathname}`);
      throw new Error("RED_BASELINE blocks all non-fixture transport");
    }
    return { ok: true, status: 200, json: async () => structuredClone(responses[url.pathname]) } as Response;
  }));
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  useOptionsStore.setState(originalStore);
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (scrollDescriptor) Object.defineProperty(Element.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("SPREAD-REPAIR-20260912-R2 RED_BASELINE production import", () => {
  it("does not revive closed lots and explains why grouping was withheld in the real Panel", async () => {
    trades.push({ ...trades[0], id: "TEST-old-close", tradeId: "TEST-old-close", openClose: "close", buySell: "sell" });
    try {
      render(<App />);
      const details = screen.getByText("Saxo API詳細").closest("details")!;
      details.open = true; fireEvent(details, new Event("toggle"));
      const fetchButton = await screen.findByRole("button", { name: "まとめて取得" });
      await waitFor(() => expect(fetchButton).toBeEnabled());
      fireEvent.click(fetchButton);
      const explanation = await screen.findByRole("region", { name: "スプレッドにまとめなかった明細" });
      expect(explanation).toHaveTextContent("元の明細は残しています");
      expect(explanation).toHaveTextContent("現在保有する購入分を確定できません");
      expect(screen.queryByRole("button", { name: "組み合わせを確認" })).toBeNull();
      expect(useOptionsStore.getState().simulations).toHaveLength(0);
      expect(unexpectedRequests).toEqual([]);
    } finally { trades.pop(); }
  });
  it("T18: actual App fetch exposes one spread confirmation before any parent/store mutation", async () => {
    // The existing production pair resolver accepts this exact input. The
    // RED must therefore occur in the application connection, not the fixture.
    expect(findSaxoBearPutSpreadPairs(positions).pairs).toHaveLength(0);
    const before = JSON.stringify(useOptionsStore.getState().simulationsByWorkspace);
    render(<App />);
    const summary = screen.getByText("Saxo API詳細");
    const details = summary.closest("details")!;
    fireEvent.click(summary);
    // JSDOM has no native details activation; dispatch its native toggle event.
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const fetchButton = await screen.findByRole("button", { name: "まとめて取得" });
    await waitFor(() => expect(fetchButton).toBeEnabled());
    fireEvent.click(fetchButton);
    await screen.findByText("まとめて取得が完了しました。反映待ちサマリーを確認してください。");
    expect(requests).toEqual(expect.arrayContaining([
      "GET /api/saxo/positions/snapshot", "GET /api/saxo/orders/snapshot", "GET /api/saxo/history/discovery",
    ]));
    expect(unexpectedRequests).toEqual([]);
    expect(JSON.stringify(useOptionsStore.getState().simulationsByWorkspace)).toBe(before);
    // Both input rows actually reached the rendered Panel. A transport error
    // or an empty/hidden source list must not masquerade as the target RED.
    expect(screen.queryByRole("button", { name: "確認して建玉入力へ" })).toBeNull();
    // A production confirmation route must exist before testing parent commit,
    // re-fetch, reload, and partial/full history. No fake handler is substituted.
    const confirmations = screen.queryAllByRole("button", { name: /この2脚を確認する/ });
    expect(confirmations.filter((button) => !(button as HTMLButtonElement).disabled)).toHaveLength(1);
    fireEvent.click(confirmations[0]);
    expect(screen.getAllByText("内容確認済み／まだ未保存").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "この2脚を確認する" })).toBeNull();
    const apply = await screen.findByRole("button", { name: "このスプレッドを保存して表示" });
    expect(JSON.stringify(useOptionsStore.getState().simulationsByWorkspace)).toBe(before);
    const persistence = vi.spyOn(Storage.prototype, "setItem");
    fireEvent.click(apply);
    await waitFor(() => expect(useOptionsStore.getState().simulations).toHaveLength(1));
    expect(persistence.mock.calls.filter(([key]) => key === "us-options-simulations-v2")).toHaveLength(1);
    const parent = useOptionsStore.getState().simulations[0];
    expect(parent.strategyType).toBe("bear_put_spread");
    expect(parent.optionEntryExecutions).toHaveLength(2);
    expect(parent.optionCloseExecutions).toEqual([]);
    expect(parent.strategyContractVerification?.state).toBe("unknown");
    expect(parent.optionLegs.map(leg => leg.saxoUic)).toEqual([990001, 990002]);
    const preview = await screen.findByRole("region", { name: "戦略の決済プレビュー" });
    expect(preview).toHaveTextContent("$404.48");
    expect(screen.getAllByRole("region", { name: "戦略の決済プレビュー" })).toHaveLength(1);
    expect(screen.queryByText("権利行使時に必要な買付資金")).toBeNull();
    const envelope = JSON.parse(localStorage.getItem("us-options-simulations-v2")!);
    expect(envelope.live[0].optionEntryExecutions).toEqual([]);
    expect(envelope.strategyLedgers.live.fills).toHaveLength(2);
    expect(hydrateStrategyRecords(envelope.live, envelope.strategyLedgers.live)[0].optionEntryExecutions).toEqual(parent.optionEntryExecutions);
    // Drive the production preview inputs; these edits must preserve the
    // canonical fills and remain reloadable, not silently overwrite origin.
    for (const [label, value] of [["P買い 決済参考価格 USD", "4.5"], ["P売り 決済参考価格 USD", "0.7"], ["P買い 決済費用合計 USD", "2.24"], ["P売り 決済費用合計 USD", "2.24"]]) {
      fireEvent.change(within(preview).getByLabelText(label), { target: { value } });
    }
    await waitFor(() => expect(preview).toHaveTextContent("$-28.96"));
    const reload = JSON.parse(localStorage.getItem("us-options-simulations-v2")!);
    const reloaded = hydrateStrategyRecords(reload.live, reload.strategyLedgers.live)[0];
    expect(calculateBearPutSpreadEstimate(reloaded)).toMatchObject({ entryAllInDebitUSD: 404.48, totalEstimatedPnlUSD: -28.96 });
    // The same HTTP import after save must offer no duplicate parent.
    fireEvent.click(screen.getByRole("button", { name: "全建玉一覧に戻る" }));
    const secondDetails = screen.getByText("Saxo API詳細").closest("details")!;
    secondDetails.open = true; fireEvent(secondDetails, new Event("toggle"));
    const fetchAgain = await screen.findByRole("button", { name: "まとめて取得" });
    fireEvent.click(fetchAgain);
    await waitFor(() => expect(fetchAgain).toBeEnabled());
    expect(useOptionsStore.getState().simulations).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "この2脚を確認する" })).toBeNull();
    // Feed confirmed fixture executions through the production persistence
    // action (broker operations are never made). Partial then closed history.
    const closedLong = { id: "TEST-close-long", legId: reloaded.optionLegs[0].id, confirmed: true, closeDate: "2026-09-10", contracts: 1, closePriceUSD: 4.5, commissionUSD: 2.24, settlementCurrency: "USD" as const, source: "manual" as const };
    act(() => useOptionsStore.getState().upsertSimulation({ ...reloaded, optionCloseExecutions: [closedLong] }));
    expect(calculateBearPutSpreadEstimate(useOptionsStore.getState().simulations[0])).toMatchObject({ realizedPnlUSD: -46.48, remainingEstimatedPnlUSD: 17.52, totalEstimatedPnlUSD: -28.96 });
    act(() => useOptionsStore.getState().upsertSimulation({ ...reloaded, status: "closed", optionCloseExecutions: [closedLong, { ...closedLong, id: "TEST-close-short", legId: reloaded.optionLegs[1].id, closePriceUSD: .7 }] }));
    const closed = useOptionsStore.getState().simulations[0];
    expect(calculateBearPutSpreadEstimate(closed)).toMatchObject({ lifecycle: { state: "closed" }, realizedPnlUSD: -28.96, entryAllInDebitUSD: 404.48 });
    const performance = calculateHistoryPerformance(closed);
    expect(performance.realizedOptionProfitUSD).toBe(-28.96);
    expect(unexpectedRequests).toEqual([]);
  });
});
