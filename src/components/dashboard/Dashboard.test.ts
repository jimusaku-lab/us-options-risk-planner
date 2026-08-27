import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeSimulation } from "@/types/domain";
import type { AccountInputs } from "@/store/useOptionsStore";
import { getSimulationTickerDisplayLabel } from "./Dashboard";
import { Dashboard } from "./Dashboard";

function createSimulation(patch: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    id: "sim",
    status: "open",
    name: "Saxo imported option",
    ticker: "",
    underlyingName: "",
    strategyType: "short_put",
    currentPriceUSD: 0,
    fxRateJPY: 0,
    accountCode: "N",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    entryDate: "2026-06-23",
    expiryDate: "2026-07-24",
    dte: 31,
    accountCurrency: "USD",
    stockPosition: null,
    optionLegs: [
      {
        id: "leg",
        type: "put",
        side: "sell",
        strikeUSD: 195,
        premiumUSD: 3.75,
        quantity: 1,
        expiryDate: "2026-07-24",
      },
    ],
    brokerMarginJPY: 0,
    brokerMarginUSD: 0,
    marginBufferMultiplier: 1,
    marginUsagePercent: 0,
    availableCashJPY: 0,
    denominatorMode: "cash_secured",
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    beginnerMode: false,
    ...patch,
  };
}

const accountInputs: AccountInputs = {
  P: {
    accountCode: "P",
    accountEnvironment: "PROD_P_JPY_SETTLEMENT",
    currency: "JPY",
    cashBalance: 0,
    marginAvailable: 0,
    marginUsagePercent: 0,
    updatedAt: "2026-07-01",
  },
  N: {
    accountCode: "N",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    currency: "USD",
    cashBalance: 0,
    marginAvailable: 0,
    marginUsagePercent: 0,
    updatedAt: "2026-07-01",
  },
};

afterEach(() => {
  cleanup();
});

describe("synthetic leg history", () => {
  it("shows one confirmed closed leg in history and opens its exact execution", () => {
    const action = vi.fn();
    const simulation = createSimulation({ ticker: "ABC", strategyType: "synthetic_forward", optionLegs: [{ ...createSimulation().optionLegs[0], id: "call", type: "call", side: "buy", premiumUSD: 5 }, { ...createSimulation().optionLegs[0], id: "put", type: "put", side: "sell", premiumUSD: 4 }], optionEntryExecutions: [{ id: "entry-call", legId: "call", tradeDate: "2026-06-01", contracts: 1, fillPriceUSD: 5, settlementCurrency: "USD", commissionUSD: 2.24, source: "manual", confirmed: true }, { id: "entry-put", legId: "put", tradeDate: "2026-06-01", contracts: 1, fillPriceUSD: 4, settlementCurrency: "USD", commissionUSD: 2.24, source: "manual", confirmed: true }], optionCloseExecutions: [{ id: "close-call", legId: "call", closeKind: "buyback", closePriceUSD: 6, closeDate: "2026-06-10", contracts: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true }] });
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: true, onHistoryOpenChange: vi.fn(), onHistoryLegAction: action }));
    fireEvent.click(screen.getByRole("button", { name: /ABC \/ Synthetic Forward内 C買い/ }));
    expect(action).toHaveBeenCalledWith(simulation.id, "close-call");
  });
});

describe("getSimulationTickerDisplayLabel", () => {
  it("restores an underlying ticker from a Saxo option instrument code", () => {
    const simulation = createSimulation({
      fixtureMeta: {
        source: "live",
        isRealMoney: true,
        broker: "SaxoBank",
        purpose: "development-fixture",
        createdAt: "2026-07-01",
        notes: "",
        saxoInstrumentCode: "MNO/24N26P195:XCBF",
      },
    });

    expect(getSimulationTickerDisplayLabel(simulation)).toBe("MNO");
  });

  it("uses the option leg broker symbol when fixture metadata is absent", () => {
    const simulation = createSimulation({
      optionLegs: [
        {
          id: "leg",
          type: "call",
          side: "buy",
          strikeUSD: 340,
          premiumUSD: 24.1,
          quantity: 1,
          expiryDate: "2026-11-20",
          brokerSymbol: "V/20X26C340:XCBF",
        },
      ],
    });

    expect(getSimulationTickerDisplayLabel(simulation)).toBe("V");
  });

  it("does not return an empty label when no ticker source exists", () => {
    expect(getSimulationTickerDisplayLabel(createSimulation())).toBe("銘柄未設定");
  });
});

describe("bulk current option price panel", () => {
  it("states that the public build has no Saxo bulk connection", () => {
    const simulation = createSimulation();
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn() }));
    expect(screen.getByRole("button", { name: "価格を一括更新" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("Dashboard close decision actions", () => {
  function currentShortPut(policy: "accept" | "avoid" | "unknown", withCurrentPrice = true): TradeSimulation {
    return createSimulation({
      ticker: "ABC",
      currentPriceUSD: 100,
      optionLegs: [{ ...createSimulation().optionLegs[0], assignmentPolicy: policy, closeCostUSD: withCurrentPrice ? 2 : undefined, closePlan: { enabled: true, commissionUSD: 2.24, commissionSource: "manual", commissionConfirmedAt: "2026-08-21T00:00:00.000Z" } }],
      optionEntryExecutions: [{ id: "entry", legId: "leg", tradeDate: "2026-06-23", contracts: 1, fillPriceUSD: 3.75, settlementCurrency: "USD", commissionUSD: 2.24, source: "manual", confirmed: true }],
    });
  }

  it.each(["accept", "unknown"] as const)("keeps premium annual return and adds current buyback P/L for %s", (policy) => {
    const simulation = currentShortPut(policy);
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn() }));
    expect(screen.getByText("プレミアム年率")).toBeTruthy();
    expect(screen.getByText(/現在買戻し概算損益 [+-]\$/)).toBeTruthy();
    expect(screen.queryByText("現在決済年率")).toBeNull();
  });

  it("keeps avoid on current close annual return plus the existing P/L label", () => {
    const simulation = currentShortPut("avoid");
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn() }));
    expect(screen.getByText("現在決済年率")).toBeTruthy();
    expect(screen.getByText(/概算損益 [+-]\$/)).toBeTruthy();
    expect(screen.queryByText(/現在買戻し概算損益/)).toBeNull();
  });

  it("shows the real missing reason and routes accept to the missing put input", () => {
    const action = vi.fn(); const simulation = currentShortPut("accept", false);
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn(), onCurrentEstimateAction: action }));
    expect(screen.getByText("現在買戻し概算損益 未計算 / 買戻し価格 未取得")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "不足情報を確認" }));
    expect(action).toHaveBeenCalledWith("sim", "leg", "exit_price");
  });

  it("does not duplicate an account margin warning into any position row", () => {
    const simulation = currentShortPut("accept");
    const highMarginAccounts = { P: accountInputs.P, N: { ...accountInputs.N, marginUsagePercent: 75 } };
    render(createElement(Dashboard, { simulations: [simulation, { ...simulation, id: "second", ticker: "XYZ" }], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs: highMarginAccounts, historyOpen: false, onHistoryOpenChange: vi.fn() }));
    expect(screen.getAllByText("警告なし")).toHaveLength(2);
    expect(screen.queryByText(/証拠金使用率が高い/)).toBeNull();
  });

  it("keeps opening net cashflow out of premium annual return and explains missing two-leg exit prices", () => {
    const simulation = createSimulation({
      ticker: "MNO",
      strategyType: "synthetic_forward",
      entryDate: "2026-07-16",
      expiryDate: "2026-12-18",
      dte: 0,
      optionLegs: [
        { id: "call-leg", type: "call", side: "buy", strikeUSD: 210, premiumUSD: 26.25, quantity: 1, expiryDate: "2026-12-18" },
        { id: "put-leg", type: "put", side: "sell", strikeUSD: 210, premiumUSD: 21.05, quantity: 1, expiryDate: "2026-12-18" },
      ],
      optionEntryExecutions: [
        { id: "call-entry", legId: "call-leg", tradeDate: "2026-07-16", contracts: 1, fillPriceUSD: 26.25, settlementCurrency: "USD", commissionUSD: 2.25, inputMode: "USD_EXECUTION_CALC", source: "manual", confirmed: true },
        { id: "put-entry", legId: "put-leg", tradeDate: "2026-07-16", contracts: 1, fillPriceUSD: 21.05, settlementCurrency: "USD", commissionUSD: 2.25, inputMode: "USD_EXECUTION_CALC", source: "manual", confirmed: true },
      ],
    });

    render(createElement(Dashboard, {
      simulations: [simulation],
      selectedId: simulation.id,
      onSelect: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      workspace: "live",
      accountInputs,
      historyOpen: false,
      onHistoryOpenChange: vi.fn(),
    }));

    expect(screen.getByText("建玉時ネット支払額")).toBeTruthy();
    expect(screen.getByText("現在決済年率")).toBeTruthy();
    expect(screen.getByText("C売却価格・P買戻し価格 未取得")).toBeTruthy();
    expect(screen.queryByText("プレミアム年率")).toBeNull();
  });

  it("opens the entry rationale journal from the dashboard status badge", () => {
    const onJournalAction = vi.fn();
    const onSelect = vi.fn();
    const simulation = createSimulation({ ticker: "MNO" });

    render(createElement(Dashboard, {
      simulations: [simulation],
      selectedId: simulation.id,
      onSelect,
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      workspace: "live",
      accountInputs,
      historyOpen: false,
      onHistoryOpenChange: vi.fn(),
      onJournalAction,
    }));

    fireEvent.click(screen.getByRole("button", { name: "根拠未記録" }));

    expect(onJournalAction).toHaveBeenCalledWith(simulation.id);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps other positions visible during normal selection", () => {
    const selected = createSimulation({ id: "sim-nvda", ticker: "MNO" });
    const other = createSimulation({ id: "sim-v", ticker: "V" });

    render(createElement(Dashboard, {
      simulations: [selected, other],
      selectedId: selected.id,
      onSelect: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      workspace: "live",
      accountInputs,
      historyOpen: false,
      onHistoryOpenChange: vi.fn(),
    }));

    expect(screen.getByText("MNO")).toBeTruthy();
    expect(screen.getByText("V")).toBeTruthy();
    expect(screen.queryByText("他の建玉を表示")).toBeNull();
  });

  it("folds other positions only while editing entry rationale from the dashboard badge", () => {
    const onClearJournalFocus = vi.fn();
    const selected = createSimulation({ id: "sim-nvda", ticker: "MNO" });
    const other = createSimulation({ id: "sim-v", ticker: "V" });

    render(createElement(Dashboard, {
      simulations: [selected, other],
      selectedId: selected.id,
      onSelect: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      workspace: "live",
      accountInputs,
      historyOpen: false,
      onHistoryOpenChange: vi.fn(),
      journalFocusSimulationId: selected.id,
      onClearJournalFocus,
    }));

    expect(screen.getByText("MNO")).toBeTruthy();
    expect(screen.queryByText("V")).toBeNull();
    expect(screen.getByText(/根拠入力中:/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "他の建玉を表示" }));

    expect(onClearJournalFocus).toHaveBeenCalledOnce();
  });

  it("calls the workflow action from the next-action close decision button without selecting only the row", () => {
    const onWorkflowTaskAction = vi.fn();
    const onSelect = vi.fn();
    const simulation = createSimulation({
      ticker: "MNO",
      optionEntryExecutions: [
        {
          id: "entry-leg",
          legId: "leg",
          tradeDate: "2026-06-23",
          contracts: 1,
          fillPriceUSD: 3.75,
          settlementCurrency: "USD",
          source: "manual",
          confirmed: true,
        },
      ],
    });

    render(createElement(Dashboard, {
      simulations: [simulation],
      selectedId: simulation.id,
      onSelect,
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      workspace: "live",
      accountInputs,
      historyOpen: false,
      onHistoryOpenChange: vi.fn(),
      onWorkflowTaskAction,
    }));

    fireEvent.click(screen.getByRole("button", { name: "反対売買判断" }));

    expect(onWorkflowTaskAction).toHaveBeenCalledWith(
      simulation.id,
      expect.objectContaining({
        targetAnchor: "close-decision",
        focusField: "close-decision-put-leg",
      }),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("calls the warning action from close-decision risk buttons", () => {
    const onWarningAction = vi.fn();
    const onSelect = vi.fn();
    const simulation = createSimulation({
      ticker: "MNO",
      strategyType: "custom",
      optionLegs: [
        {
          id: "call-leg",
          type: "call",
          side: "sell",
          strikeUSD: 225,
          premiumUSD: 1.5,
          quantity: 1,
          expiryDate: "2026-07-24",
        },
      ],
      optionEntryExecutions: [
        {
          id: "entry-call-leg",
          legId: "call-leg",
          tradeDate: "2026-06-23",
          contracts: 1,
          fillPriceUSD: 1.5,
          settlementCurrency: "USD",
          source: "manual",
          confirmed: true,
        },
      ],
    });

    render(createElement(Dashboard, {
      simulations: [simulation],
      selectedId: simulation.id,
      onSelect,
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      workspace: "live",
      accountInputs,
      historyOpen: false,
      onHistoryOpenChange: vi.fn(),
      onWarningAction,
    }));

    fireEvent.click(screen.getByRole("button", { name: "反対売買判断へ" }));

    expect(onWarningAction).toHaveBeenCalledWith(
      simulation.id,
      expect.objectContaining({
        actionAnchorId: "close-decision-call-call-leg",
      }),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });
});
