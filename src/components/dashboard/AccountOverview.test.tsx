import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountInputs } from "@/store/useOptionsStore";
import { AccountOverview } from "./AccountOverview";

const accountInputs: AccountInputs = {
  P: { accountCode: "P", currency: "JPY", cashBalance: 999, buyingPower: 1, marginAvailable: 2, marginUsagePercent: 3, accountValue: 1, saxoTotalValue: 1_000_000, updatedAt: "2026-08-10" },
  N: { accountCode: "N", currency: "USD", cashBalance: 888, buyingPower: 4, marginAvailable: 5, marginUsagePercent: 6, accountValue: 2, saxoTotalValue: 20_000, updatedAt: "2026-08-10" },
};
afterEach(cleanup);

describe("AccountOverview reference total assets", () => {
  it("does not render a manual cash apply button for same-day Saxo coverage uncertainty", () => {
    render(createElement(AccountOverview, { workspace: "live" as const, accountInputs, onChange: vi.fn(), onApplyCashEffect: vi.fn(), pendingCashEffects: [{ id: "anonymous", sourceSimulationId: "simulation", sourceExecutionId: "execution", accountCode: "P", currency: "JPY", amount: 100, label: "匿名決済", detail: "", closeDate: "2026-08-10", canApply: false, coverage: "same_day_uncertain", missingReason: "同日確認待ち" }] }));
    expect(screen.getByText("Saxo残高を再取得して確認してください")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "現金残高に反映" })).not.toBeInTheDocument();
  });
  it("shows exactly one independent asset card and keeps it separate from account margin summary", () => {
    const props = { workspace: "live" as const, accountInputs, referenceFxQuote: { pair: "USDJPY" as const, rate: 150.25, date: "2026-08-08", source: "local_proxy" as const, fetchedAt: "2026-08-10T00:00:00.000Z" }, onChange: vi.fn() };
    render(createElement(AccountOverview, props));
    const assetCard = screen.getByRole("region", { name: "口座全体の資産" });
    const marginCard = screen.getByRole("heading", { name: "口座全体の余力・証拠金" }).closest("section");

    expect(screen.getAllByText((_, element) => element?.textContent === "P口座資産　¥1,000,000")).toHaveLength(1);
    expect(screen.getAllByText((_, element) => element?.textContent === "N口座資産　¥3,005,000")).toHaveLength(1);
    expect(screen.getAllByText((_, element) => element?.textContent === "参考総資産　¥4,005,000")).toHaveLength(1);
    expect(assetCard).toBeTruthy();
    expect(marginCard).toBeTruthy();
    expect(assetCard).not.toBe(marginCard);
    expect(assetCard.textContent).toBe("P口座資産　¥1,000,000N口座資産　¥3,005,000参考総資産　¥4,005,000");
    expect(assetCard.querySelector(".flex-nowrap")).toBeTruthy();
  });

  it("renders one warning per affected account with source and update evidence", () => {
    render(createElement(AccountOverview, {
      workspace: "live" as const,
      accountInputs: {
        P: { ...accountInputs.P, marginUsagePercent: 69.9 },
        N: { ...accountInputs.N, marginUsagePercent: 70, saxoSyncHistory: [{ id: "anonymous", source: "saxo_api", accountKey: "masked", fetchedAt: "2026-08-10T00:00:00.000Z", appliedAt: "2026-08-10T00:01:00.000Z", appliedFields: ["marginUsagePercent"] }] },
      },
      onChange: vi.fn(),
    }));
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.getByRole("status", { name: "P口座の証拠金使用率警告" })).toHaveTextContent("取得元未確認");
    expect(screen.getByRole("status", { name: "N口座の証拠金使用率警告" })).toHaveTextContent("Saxo API");
    expect(screen.getAllByText(/建玉数を増やしたとの判定ではありません/)).toHaveLength(2);
  });

  it("shows no warning at 59.9 and opens the selected account margin input from the CTA", async () => {
    render(createElement(AccountOverview, { workspace: "live" as const, accountInputs: { P: { ...accountInputs.P, marginUsagePercent: 59.9 }, N: { ...accountInputs.N, marginUsagePercent: 60 } }, onChange: vi.fn() }));
    expect(screen.queryByRole("status", { name: "P口座の証拠金使用率警告" })).toBeNull();
    const warning = screen.getByRole("status", { name: "N口座の証拠金使用率警告" });
    fireEvent.click(within(warning).getByRole("button", { name: "口座情報を確認" }));
    await waitFor(() => expect(document.querySelector("#account-margin-usage-N input")).toHaveFocus());
  });
});
