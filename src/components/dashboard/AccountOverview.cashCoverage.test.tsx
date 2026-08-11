import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountInputs } from "@/store/useOptionsStore";
import { AccountOverview } from "./AccountOverview";

const accountInputs: AccountInputs = {
  P: { accountCode: "P", currency: "JPY", cashBalance: 100, marginAvailable: 0, marginUsagePercent: 0, updatedAt: "2026-08-10" },
  N: { accountCode: "N", currency: "USD", cashBalance: 0, marginAvailable: 0, marginUsagePercent: 0, updatedAt: "2026-08-10" },
};

afterEach(cleanup);

describe("AccountOverview cash coverage", () => {
  it("shows a neutral re-fetch message instead of a manual apply button for same-day uncertainty", () => {
    render(createElement(AccountOverview, {
      workspace: "live",
      accountInputs,
      onChange: vi.fn(),
      onApplyCashEffect: vi.fn(),
      pendingCashEffects: [{
        id: "anonymous",
        sourceSimulationId: "simulation",
        sourceExecutionId: "execution",
        accountCode: "P",
        currency: "JPY",
        amount: 100,
        label: "匿名決済",
        detail: "",
        closeDate: "2026-08-10",
        canApply: false,
        coverage: "same_day_uncertain",
      }],
    }));

    expect(screen.getByText("Saxo残高を再取得して確認してください")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "現金残高に反映" })).not.toBeInTheDocument();
  });
});
