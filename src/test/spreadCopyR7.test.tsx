import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { SpreadPerformancePreview } from "@/components/results/SpreadPerformancePreview";
import type { AccountInputs } from "@/store/useOptionsStore";
import type { TradeSimulation } from "@/types/domain";

const accountInputs: AccountInputs = {
  P: { accountCode: "P", currency: "JPY", cashBalance: 10000, marginAvailable: 10000, marginUsagePercent: 10, updatedAt: "2026-09-01" },
  N: { accountCode: "N", currency: "USD", cashBalance: 10000, marginAvailable: 10000, marginUsagePercent: 10, updatedAt: "2026-09-01" },
};

function spread(): TradeSimulation {
  return {
    id: "R7-spread", status: "open", name: "Anonymous spread", ticker: "TEST", strategyType: "bear_put_spread",
    currentPriceUSD: 98.97, fxRateJPY: 150, accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT",
    entryDate: "2026-09-01", expiryDate: "2026-10-02", dte: 31, accountCurrency: "USD", stockPosition: null,
    brokerMarginJPY: 0, marginBufferMultiplier: 1, denominatorMode: "custom", taxProfileId: "none_nisa_or_tax_free_comparison",
    strategyContractVerification: { state: "unknown" },
    optionLegs: [
      { id: "long", type: "put", side: "buy", strikeUSD: 100, premiumUSD: 4.02, quantity: 1, contractSize: 100, expiryDate: "2026-10-02", closeCostUSD: 4.05, closePlan: { enabled: true, closePriceUSD: 4.05, priceSource: "saxo", priceSelectedField: "bid", priceType: "OldIndicative", priceFetchedAt: "2026-09-13T01:00:00Z" } },
      { id: "short", type: "put", side: "sell", strikeUSD: 90, premiumUSD: 0.02, quantity: 1, contractSize: 100, expiryDate: "2026-10-02", closeCostUSD: 0.79, closePlan: { enabled: true, closePriceUSD: 0.79, priceSource: "saxo", priceSelectedField: "ask", priceType: "OldIndicative", priceFetchedAt: "2026-09-13T01:00:00Z" } },
    ],
    optionEntryExecutions: [
      { id: "entry-long", legId: "long", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 4.02, settlementCurrency: "USD", commissionUSD: 2.24, source: "broker_statement", confirmed: true },
      { id: "entry-short", legId: "short", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 0.02, settlementCurrency: "USD", commissionUSD: 2.24, source: "broker_statement", confirmed: true },
    ],
  };
}

afterEach(cleanup);

describe("R7 spread copy and hierarchy", () => {
  it("uses compact copy and normal dashboard typography", () => {
    render(<Dashboard simulations={[spread()]} selectedId="R7-spread" onSelect={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()}
      workspace="live" accountInputs={accountInputs} historyOpen={false} onHistoryOpenChange={vi.fn()}
      positionFocusSimulationId="R7-spread" onPositionFocus={vi.fn()} />);
    expect(screen.getByText("ベア・プット")).toBeInTheDocument();
    expect(screen.getByText("P100買い／P90売り・1組")).toBeInTheDocument();
    expect(screen.queryByText(/契約仕様未照合/)).not.toBeInTheDocument();
    const result = screen.getByText(/決済した場合の参考損益/);
    expect(result).toHaveTextContent("-$82.96");
    expect(result.className).toContain("text-[11px]");
    expect(result.className).not.toContain("text-base");
    expect(result.className).not.toContain("text-sm");
  });

  it("reveals one concise calculation instead of three cards", () => {
    render(<SpreadPerformancePreview simulation={spread()} />);
    const region = screen.getByRole("region", { name: "戦略の決済プレビュー" });
    expect(within(region).getByText("ベア・プットの内訳")).toBeInTheDocument();
    expect(within(region).getByText("古い参考気配で計算")).toBeInTheDocument();
    expect(region.querySelectorAll(":scope > div.grid.sm\\:grid-cols-3")).toHaveLength(0);
    expect(within(region).queryByText(/注文は行いません|満期相殺/)).not.toBeInTheDocument();
    const calculation = within(region).getByText("今決済した場合の計算内訳").closest("details")!;
    expect(calculation).not.toHaveAttribute("open");
    fireEvent.click(within(calculation).getByText("今決済した場合の計算内訳"));
    expect(calculation).toHaveTextContent("買いプットの売却代金");
    expect(calculation).toHaveTextContent("売りプットの買戻代金");
    expect(calculation).toHaveTextContent("$321.52 − $404.48 = -$82.96");
    const details = within(region).getByText("詳細情報").closest("details")!;
    fireEvent.click(within(details).getByText("詳細情報"));
    expect(details).toHaveTextContent("満期の決済方法・引渡対象の情報が一部未取得です。満期時の最大損益は算出していません。");
  });

  it("keeps incompatibility visible", () => {
    const simulation = spread();
    simulation.strategyContractVerification = { state: "incompatible" };
    render(<SpreadPerformancePreview simulation={simulation} />);
    expect(screen.getByText("契約情報に不一致があります。現在評価へ使えない項目を確認してください。")).toBeInTheDocument();
  });

  it("separates partial results and suppresses current math after close", () => {
    const partial = spread();
    partial.optionCloseExecutions = [{ id: "close-long", legId: "long", confirmed: true, closeDate: "2026-09-10", contracts: 1, closePriceUSD: 4.05, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement" }];
    const { rerender } = render(<SpreadPerformancePreview simulation={partial} />);
    expect(screen.getByText(/決済済みの損益/)).toHaveTextContent(/残っている分を決済した場合/);
    const closed = spread();
    closed.status = "closed";
    closed.optionCloseExecutions = [
      { id: "close-long", legId: "long", confirmed: true, closeDate: "2026-09-10", contracts: 1, closePriceUSD: 4.05, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement" },
      { id: "close-short", legId: "short", confirmed: true, closeDate: "2026-09-10", contracts: 1, closePriceUSD: 0.79, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement" },
    ];
    rerender(<SpreadPerformancePreview simulation={closed} />);
    expect(screen.getByText(/実現損益/)).toBeInTheDocument();
    expect(screen.queryByText("今決済した場合の計算内訳")).not.toBeInTheDocument();
  });
});
