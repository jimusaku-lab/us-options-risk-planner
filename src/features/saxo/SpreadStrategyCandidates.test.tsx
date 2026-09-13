import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyStrategyLedger } from "@/domain/strategyLedger";
import { reconcileStrategyCandidates, type SpreadImportSnapshot } from "./spreadStrategyImport";
import { SpreadStrategyCandidates } from "./SpreadStrategyCandidates";

afterEach(cleanup);

function candidateFixture(ticker = "SAMPLE", offset = 0) {
  const positions = (["long", "short"] as const).map((side, index) => ({ id: `${ticker}-position-${index}`, positionId: `${ticker}-position-${index}`, accountKey: "TEST-N", accountAssignment: "N" as const, accountCode: "N" as const, symbol: ticker, underlyingSymbol: ticker, underlyingIdentity: `uic:${990000 + offset}:stock`, kind: "option" as const, assetType: "StockOption", optionType: "put" as const, side, strike: index ? 90 : 100, expiry: "2026-10-02", quantity: index ? -1 : 1, contractSize: 100, currency: "USD", uic: 990001 + offset + index, missingFields: [], fetchedAt: "2026-09-12T00:00:00Z" }));
  const snapshot: SpreadImportSnapshot = { environment: "TEST", requestRevision: 1, positions, orders: [], coverage: ["positions", "orders", "trades"].map((source) => ({ source, asOf: "2026-09-12T00:00:00Z", completedPages: 1, status: "complete" as const })), history: positions.map((position, index) => ({ id: `${ticker}-trade-${index}`, tradeId: `${ticker}-fill-${index}`, brokerAccountKey: "TEST-N", kind: "trade", accountCurrency: "USD", uic: position.uic, optionType: "put", strike: position.strike, expiry: position.expiry, quantity: 1, buySell: index ? "sell" : "buy", openClose: "open", price: index ? 0.92 : 4.92, transactionCost: 2.24, tradeDate: "2026-09-11" })) };
  return reconcileStrategyCandidates(snapshot, emptyStrategyLedger(), [])[0];
}

describe("R5 one-primary spread import", () => {
  it("replaces confirmation with save and then removes the save action", async () => {
    const onCommit = vi.fn().mockResolvedValue({});
    render(<SpreadStrategyCandidates candidates={[candidateFixture()]} ledger={emptyStrategyLedger()} simulations={[]} onCommit={onCommit} />);
    expect(screen.getByText("次にすること：SAMPLEの2脚を確認")).toBeInTheDocument();
    expect(screen.getByText("まだ未保存")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "この2脚を確認する" }));
    expect(screen.getAllByText("内容確認済み／まだ未保存").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "この2脚を確認する" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "このスプレッドを保存して表示" }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText(/保存しました/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "このスプレッドを保存して表示" })).toBeNull();
  });
  it("names the selected target when multiple spreads exist", () => {
    render(<SpreadStrategyCandidates candidates={[candidateFixture("FIRST"), candidateFixture("SECOND", 10)]} ledger={emptyStrategyLedger()} simulations={[]} onCommit={vi.fn()} />);
    expect(screen.getByText("次にすること：FIRSTの2脚を確認")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("SECOND / 2脚"));
    expect(screen.getByText("次にすること：SECONDの2脚を確認")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "この2脚を確認する" })).toHaveLength(1);
  });
});
