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
        saxoInstrumentCode: "NVDA/24N26P195:XCBF",
      },
    });

    expect(getSimulationTickerDisplayLabel(simulation)).toBe("NVDA");
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

describe("Dashboard close decision actions", () => {
  it("opens the entry rationale journal from the dashboard status badge", () => {
    const onJournalAction = vi.fn();
    const onSelect = vi.fn();
    const simulation = createSimulation({ ticker: "NVDA" });

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
    const selected = createSimulation({ id: "sim-nvda", ticker: "NVDA" });
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

    expect(screen.getByText("NVDA")).toBeTruthy();
    expect(screen.getByText("V")).toBeTruthy();
    expect(screen.queryByText("他の建玉を表示")).toBeNull();
  });

  it("folds other positions only while editing entry rationale from the dashboard badge", () => {
    const onClearJournalFocus = vi.fn();
    const selected = createSimulation({ id: "sim-nvda", ticker: "NVDA" });
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

    expect(screen.getByText("NVDA")).toBeTruthy();
    expect(screen.queryByText("V")).toBeNull();
    expect(screen.getByText(/根拠入力中:/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "他の建玉を表示" }));

    expect(onClearJournalFocus).toHaveBeenCalledOnce();
  });

  it("calls the workflow action from the next-action close decision button without selecting only the row", () => {
    const onWorkflowTaskAction = vi.fn();
    const onSelect = vi.fn();
    const simulation = createSimulation({
      ticker: "NVDA",
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
      ticker: "NVDA",
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
