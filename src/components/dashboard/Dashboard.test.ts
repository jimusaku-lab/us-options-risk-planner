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
    const simulation = createSimulation({
      ticker: "ABC",
      strategyType: "synthetic_forward",
      optionLegs: [
        { ...createSimulation().optionLegs[0], id: "call", type: "call", side: "buy", premiumUSD: 5 },
        { ...createSimulation().optionLegs[0], id: "put", type: "put", side: "sell", premiumUSD: 4 },
      ],
      optionEntryExecutions: [
        { id: "entry-call", legId: "call", tradeDate: "2026-06-01", contracts: 1, fillPriceUSD: 5, settlementCurrency: "USD", commissionUSD: 2.24, source: "manual", confirmed: true },
        { id: "entry-put", legId: "put", tradeDate: "2026-06-01", contracts: 1, fillPriceUSD: 4, settlementCurrency: "USD", commissionUSD: 2.24, source: "manual", confirmed: true },
      ],
      optionCloseExecutions: [{ id: "close-call", legId: "call", closeKind: "buyback", closePriceUSD: 6, closeDate: "2026-06-10", contracts: 1, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: 95.52, source: "manual", confirmed: true }],
    });
    const { container } = render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: true, onHistoryOpenChange: vi.fn(), onHistoryLegAction: action }));
    const row = container.querySelector('tr[data-history-kind="closed_leg"]');
    expect(row?.textContent).toContain("ABC");
    expect(row?.textContent).toContain("Synthetic Forward内 C買い");
    expect(row?.textContent).toContain("損益率（保有期間）");
    expect(row?.textContent).toContain("年率換算（参考）");
    expect(row?.textContent).toContain("実現利益+$95.52");
    expect(row?.textContent).not.toContain("現在株価");
    expect(row?.querySelectorAll("td")).toHaveLength(12);
    expect(container.querySelector('section[aria-label="継続中戦略の決済済み脚"]')).toBeNull();
    const open = screen.getByRole("button", { name: "決済実績を確認" });
    fireEvent.click(open);
    expect(action).toHaveBeenCalledWith(simulation.id, "close-call");
    cleanup();
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn() }));
    expect(screen.getByRole("button", { name: /継続中戦略の決済済み脚1件/ })).toBeTruthy();
  });

  it("shows N/USD holding-period return as the primary result and annualisation as reference", () => {
    const simulation = createSimulation({
      status: "closed",
      ticker: "XYZ",
      strategyType: "long_put",
      currentPriceUSD: 250,
      entryDate: "2025-03-10",
      expiryDate: "2025-12-19",
      optionLegs: [{ ...createSimulation().optionLegs[0], id: "put", side: "buy", premiumUSD: 7.9, quantity: 1 }],
      optionEntryExecutions: [{ id: "entry", legId: "put", tradeDate: "2025-03-10", contracts: 1, fillPriceUSD: 7.9, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true }],
      optionCloseExecutions: [{ id: "close", legId: "put", closeKind: "buyback", closeDate: "2025-03-23", contracts: 1, closePriceUSD: 23, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: 1_505.52, source: "manual", confirmed: true }],
    });
    const { container, rerender } = render(createElement(Dashboard, {
      simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs,
      historyOpen: true, onHistoryOpenChange: vi.fn(),
    }));
    const row = Array.from(container.querySelectorAll("tr")).find((candidate) => candidate.textContent?.includes("XYZ"));
    expect(row?.textContent).toContain("実現利益+$1,505.52");
    expect(row?.textContent).toContain("購入時支払総額");
    expect(row?.textContent).toContain("+190.0%");
    expect(row?.textContent).toContain("年率換算（参考）+5,335.6%保有13日");
    expect(row?.textContent).toContain("契約P $195.00");
    expect(row?.textContent).not.toContain("現在株価");
    expect(row?.textContent).not.toContain("税後参考未確定");
    expect(screen.getAllByText(/N口座の実現損益は米ドル建て・手数料控除後・税引前/)).toHaveLength(1);
    rerender(createElement(Dashboard, {
      simulations: [{ ...simulation, currentPriceUSD: 999 }], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs,
      historyOpen: true, onHistoryOpenChange: vi.fn(), currentEstimateFxQuote: { pair: "USDJPY", rate: 180, date: "2026-09-11", fetchedAt: "2026-09-11T00:00:00Z", source: "frankfurter" },
    }));
    const rerenderedRow = Array.from(container.querySelectorAll("tr")).find((candidate) => candidate.textContent?.includes("XYZ"));
    ["実現利益+$1,505.52", "+190.0%", "年率換算（参考）+5,335.6%保有13日"].forEach((text) => expect(rerenderedRow?.textContent).toContain(text));
    expect(rerenderedRow?.textContent).not.toContain("現在株価");
  });

  it("keeps signed losses and P/JPY history while hiding active market comparisons", () => {
    const loss = createSimulation({
      status: "closed", ticker: "LOSS", strategyType: "long_put",
      optionLegs: [{ ...createSimulation().optionLegs[0], id: "put", side: "buy", premiumUSD: 1, quantity: 1, assignmentPolicy: "avoid" }],
      optionEntryExecutions: [{ id: "entry", legId: "put", tradeDate: "2025-03-10", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true }],
      optionCloseExecutions: [{ id: "close", legId: "put", closeKind: "buyback", closeDate: "2025-03-23", contracts: 1, closePriceUSD: 0.3, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: -74.48, source: "manual", confirmed: true }],
    });
    const { container } = render(createElement(Dashboard, { simulations: [loss], selectedId: loss.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: true, onHistoryOpenChange: vi.fn() }));
    const lossRow = Array.from(container.querySelectorAll("tr")).find((candidate) => candidate.textContent?.includes("LOSS"));
    expect(lossRow?.textContent).toContain("実現損失-$74.48");
    expect(lossRow?.textContent).not.toContain("現在株価");
    expect(lossRow?.textContent).not.toContain("出口ルール");
  });

  it("keeps P/JPY realized history primary without current stock price", () => {
    const simulation = createSimulation({
      status: "closed", ticker: "JPYC", strategyType: "long_call", accountCode: "P",
      accountEnvironment: "PROD_P_JPY_SETTLEMENT", accountCurrency: "JPY", currentPriceUSD: 300,
      optionLegs: [{ ...createSimulation().optionLegs[0], id: "call", type: "call", side: "buy", strikeUSD: 220, premiumUSD: 2, quantity: 1 }],
      optionEntryExecutions: [{ id: "entry", legId: "call", tradeDate: "2025-03-10", contracts: 1, fillPriceUSD: 2, settlementCurrency: "JPY", brokerBookedAmountJPY: -32_000, source: "manual", confirmed: true }],
      optionCloseExecutions: [{ id: "close", legId: "call", closeKind: "buyback", closeDate: "2025-03-23", contracts: 1, closePriceUSD: 3, settlementCurrency: "JPY", brokerRealizedPnlJPY: 12_345, source: "manual", confirmed: true }],
    });
    const { container } = render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: true, onHistoryOpenChange: vi.fn() }));
    const row = Array.from(container.querySelectorAll("tr")).find((candidate) => candidate.textContent?.includes("JPYC"));
    expect(row?.textContent).toContain("実現利益+12,345円");
    expect(row?.textContent).toContain("契約C $220.00");
    expect(row?.textContent).not.toContain("現在株価");
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

describe("current price and strike display", () => {
  it("shows a stored current price once with the call strike and strike-based comparison", () => {
    const simulation = createSimulation({
      ticker: "ABC",
      currentPriceUSD: 219.39,
      optionLegs: [{ ...createSimulation().optionLegs[0], type: "call", side: "buy", strikeUSD: 220 }],
    });
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn() }));

    expect(screen.getByText("契約 / 現在株価")).toBeTruthy();
    expect(screen.getByText("現在株価 $219.39")).toBeTruthy();
    expect(screen.getByText("C $220.00 / -$0.61 / -0.3%")).toBeTruthy();
  });

  it("shows the current price once and each call/put strike for a synthetic position", () => {
    const simulation = createSimulation({
      ticker: "ABC",
      strategyType: "synthetic_forward",
      currentPriceUSD: 200,
      optionLegs: [
        { ...createSimulation().optionLegs[0], id: "call", type: "call", side: "buy", strikeUSD: 195 },
        { ...createSimulation().optionLegs[0], id: "put", type: "put", side: "sell", strikeUSD: 205 },
      ],
    });
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn() }));

    expect(screen.getAllByText("現在株価 $200.00")).toHaveLength(1);
    expect(screen.getByText("C $195.00 / +$5.00 / +2.6%")).toBeTruthy();
    expect(screen.getByText("P $205.00 / -$5.00 / -2.4%")).toBeTruthy();
  });

  it("keeps an unavailable current price explicit instead of rendering a zero", () => {
    const simulation = createSimulation({ ticker: "ABC", currentPriceUSD: 0 });
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn() }));

    expect(screen.getByText("現在株価 未取得")).toBeTruthy();
    expect(screen.getByText("上部の「価格を一括更新」で取得")).toBeTruthy();
    expect(screen.queryByText("現在株価 $0.00")).toBeNull();
  });
});

describe("bulk current option price panel", () => {
  it("renders a read-only preview before one explicit apply action", () => {
    const fetch = vi.fn(); const apply = vi.fn(); const simulation = createSimulation({ ticker: "ABC" });
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn(), bulkOptionPriceAvailable: true, onFetchBulkOptionPrices: fetch, onApplyBulkOptionPrices: apply, bulkOptionPricePreview: [{ target: { targetId: "sim:leg", simulationId: "sim", legId: "leg", ticker: "ABC", strategyType: "short_put", optionType: "put", side: "sell", strike: 195, expiry: "2026-07-24", quantity: 1 }, status: "ready", selectedPriceUSD: 2.4, selectedField: "ask", reason: "買戻し候補のAskを採用" }] }));
    expect(screen.queryByTestId("bulk-option-price-panel")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "価格を一括更新" }));
    expect(screen.getByRole("dialog", { name: "現在オプション価格を一括更新" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取得成功分1脚を一括反映" }));
    expect(fetch).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps the public surface safely disabled", () => {
    const simulation = createSimulation(); render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn() }));
    expect(screen.getByText("SaxoローカルAPIが旧版です。ローカルAPIを更新して再起動してください。個別取得は利用できます。")).toBeTruthy();
  });
  it("requires and clears the in-dialog OldIndicative confirmation before it enables apply", () => {
    const simulation = createSimulation({ ticker: "ABC" }); const onConfirmation = vi.fn(); const onClose = vi.fn();
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn(), bulkOptionPriceAvailable: true, onFetchBulkOptionPrices: vi.fn(), onApplyBulkOptionPrices: vi.fn(), bulkOptionPriceReferenceConfirmed: false, onBulkOptionPriceReferenceConfirmedChange: onConfirmation, onBulkOptionPriceDialogClose: onClose, bulkOptionPricePreview: [{ target: { targetId: "sim:leg", simulationId: "sim", legId: "leg", ticker: "ABC", strategyType: "short_put", optionType: "put", side: "sell", strike: 195, expiry: "2026-07-24", quantity: 1 }, candidate: { environment: "live", fetchedAt: "2026-08-15T00:00:00Z", status: "available", classification: "available", source: "fixture", message: "ok", ask: 2.4, quoteDiagnostics: { priceTypeAsk: "OldIndicative" } }, status: "confirmable_reference", selectedPriceUSD: 2.4, selectedField: "ask", reason: "参考値" }] }));
    fireEvent.click(screen.getByRole("button", { name: "価格を一括更新" }));
    expect(screen.getByText("取得成功 1脚 / 通常 0脚 / 参考値・要確認 1脚 / 反映不可 0脚")).toBeTruthy();
    expect(screen.getByRole("button", { name: "取得成功分0脚を一括反映" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onConfirmation).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "現在オプション価格の確認を閉じる" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("Dashboard close decision actions", () => {
  function currentShortPut(policy: "accept" | "avoid" | "unknown", withCurrentPrice = true): TradeSimulation {
    return createSimulation({
      ticker: "ABC",
      currentPriceUSD: 100,
      optionLegs: [{
        ...createSimulation().optionLegs[0],
        assignmentPolicy: policy,
        closeCostUSD: withCurrentPrice ? 2 : undefined,
        closePlan: { enabled: true, commissionUSD: 2.24, commissionSource: "manual", commissionConfirmedAt: "2026-08-21T00:00:00.000Z" },
      }],
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
    const action = vi.fn();
    const simulation = currentShortPut("accept", false);
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
      ticker: "NVDA",
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

  it("keeps an explicit temporary position focus separate from the normal list state", () => {
    const onFocus = vi.fn();
    const onClearPositionFocus = vi.fn();
    const selected = createSimulation({ id: "sim-pgr", ticker: "PGR" });
    const other = createSimulation({ id: "sim-other", ticker: "OTHER" });

    const { rerender } = render(createElement(Dashboard, {
      simulations: [selected, other],
      selectedId: selected.id,
      onSelect: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      workspace: "live",
      accountInputs,
      historyOpen: false,
      onHistoryOpenChange: vi.fn(),
      onPositionFocus: onFocus,
    }));

    const positionRow = document.querySelector('tr[aria-label="PGRの詳細を表示する"]')!;
    fireEvent.click(positionRow);
    expect(onFocus).toHaveBeenCalledWith(selected.id);

    fireEvent.keyDown(positionRow, { key: "Enter" });
    expect(onFocus).toHaveBeenCalledTimes(2);

    rerender(createElement(Dashboard, {
      simulations: [selected, other],
      selectedId: selected.id,
      onSelect: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      workspace: "live",
      accountInputs,
      historyOpen: false,
      onHistoryOpenChange: vi.fn(),
      positionFocusSimulationId: selected.id,
      onPositionFocus: onFocus,
      onClearPositionFocus,
    }));

    expect(screen.getByText("PGRを確認中")).toBeTruthy();
    expect(screen.getByText("他1件を非表示")).toBeTruthy();
    expect(screen.queryByText("OTHER")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "全建玉一覧に戻る" }));
    expect(onClearPositionFocus).toHaveBeenCalledOnce();
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

  it("offers a direct 3-A review for a historical long-option entry conflict", () => {
    const onHistoryEntryAction = vi.fn();
    const simulation = createSimulation({
      status: "closed", ticker: "ABC", strategyType: "long_put",
      optionLegs: [{ ...createSimulation().optionLegs[0], id: "put", type: "put", side: "buy", quantity: 1 }],
      optionEntryExecutions: [
        { id: "entry-a", legId: "put", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true },
        { id: "entry-b", legId: "put", tradeDate: "2026-08-02", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true },
      ],
      optionCloseExecutions: [{ id: "close", legId: "put", closeKind: "buyback", closeDate: "2026-08-05", contracts: 1, closePriceUSD: 1.5, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: 45.52, source: "manual", confirmed: true }],
    });
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: true, onHistoryOpenChange: vi.fn(), onHistoryEntryAction }));
    expect(screen.getAllByText("開始約定の数量超過（証跡未照合）").length).toBeGreaterThan(0);
    expect(screen.queryByText("完了（追加操作なし）")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "購入時約定を確認" }));
    expect(onHistoryEntryAction).toHaveBeenCalledWith(simulation.id);
  });
});
