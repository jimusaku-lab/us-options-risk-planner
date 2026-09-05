import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import { createEffectiveHistoryEndpoints, createHistoryReflectionStates, createReflectionSummary, getDisplayPositionMissingFields, HistoryDiscoveryPreview, isActionRequiredRegularPositionRow, ReflectionPendingSummary, sanitizePersistedSaxoHistoryKeys, SyntheticForwardHoldRow, SyntheticForwardPairRow } from "./SaxoReadOnlyPanel";
import type { ReflectionSummary } from "./SaxoReadOnlyPanel";
import type { AccountInputs } from "@/store/useOptionsStore";
import type { TradeSimulation } from "@/types/domain";
import { getSaxoHistoryStableKey } from "./saxoAccountSync";
import type { SaxoApiOrderSnapshot, SaxoHistoryDiscoveryItem, SaxoSyntheticForwardHold, SaxoSyntheticForwardPair } from "./saxoAccountSync";

afterEach(cleanup);

const callPosition = {
  id: "call", accountKey: "account", accountAssignment: "N" as const, kind: "option" as const, side: "long" as const,
  optionType: "call" as const, quantity: 1, strike: 210, expiry: "2026-12-18", missingFields: [], fetchedAt: "2026-07-17T00:00:00.000Z",
};
const putPosition = { ...callPosition, id: "put", side: "short" as const, optionType: "put" as const, quantity: -1 };
const pair: SaxoSyntheticForwardPair = {
  id: "pair", callPosition, putPosition, ticker: "ANON", underlyingIdentity: "uic:700001:stock", accountCode: "N", accountKey: "account", expiry: "2026-12-18", strike: 210, quantity: 1,
};

it("renders one composite CTA for a paired synthetic forward and no individual draft CTA", () => {
  const onCreateDraft = vi.fn();
  render(<table><tbody><SyntheticForwardPairRow pair={pair} drafted={false} onCreateDraft={onCreateDraft} /></tbody></table>);

  expect(screen.getAllByRole("button", { name: "2脚をシンセティックとして下書き反映" })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "建玉入力へ下書き反映" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "2脚をシンセティックとして下書き反映" }));
  expect(onCreateDraft).toHaveBeenCalledWith(pair);
});

it("uses the filled-state CTA and reopens an integrated 3-A without creating another draft", () => {
  const onCreateDraft = vi.fn();
  const { rerender } = render(<table><tbody><SyntheticForwardPairRow pair={pair} drafted={false} filled onCreateDraft={onCreateDraft} /></tbody></table>);

  expect(screen.getByRole("button", { name: "約定済み二脚を統合して3-Aで確認" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "約定済み二脚を統合して3-Aで確認" }));
  expect(onCreateDraft).toHaveBeenCalledWith(pair);

  rerender(<table><tbody><SyntheticForwardPairRow pair={pair} drafted filled integrated onCreateDraft={onCreateDraft} /></tbody></table>);
  expect(screen.getByRole("button", { name: "親シンセティックの確定情報を確認" })).toBeEnabled();

  rerender(<table><tbody><SyntheticForwardPairRow pair={pair} drafted filled integrated saved onCreateDraft={onCreateDraft} onOpenDashboard={vi.fn()} /></tbody></table>);
  expect(screen.getByRole("button", { name: "建玉ダッシュボードで確認" })).toBeEnabled();
});

it("keeps a recovery CTA active when only the stale drafted marker remains", () => {
  const onCreateDraft = vi.fn();
  render(<table><tbody><SyntheticForwardPairRow pair={pair} drafted recoveryRequired onCreateDraft={onCreateDraft} /></tbody></table>);

  const button = screen.getByRole("button", { name: "シンセティック建玉を復旧して確認" });
  expect(button).toBeEnabled();
  fireEvent.click(button);
  expect(onCreateDraft).toHaveBeenCalledWith(pair);
});

it("keeps stale draft and broken links actionable while excluding formal linked holdings", () => {
  const row = { position: callPosition, status: "matched" } as never;
  expect(isActionRequiredRegularPositionRow(row, { status: "draft", reason: "stale marker" }, false)).toBe(true);
  expect(isActionRequiredRegularPositionRow(row, { status: "broken", reason: "missing target" }, false)).toBe(true);
  expect(isActionRequiredRegularPositionRow(row, { status: "linked", simulation: {} as TradeSimulation, simulationId: "saved" }, false)).toBe(false);
});

it("counts an OCO pair as one actionable exit-rule review and exposes its direct CTA", () => {
  const simulation: TradeSimulation = {
    ...sampleAmznSimulation,
    id: "anonymous-exit-rule", ticker: "SAMPLE", status: "open", accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD",
    strategyType: "short_put",
    optionLegs: [{ ...sampleAmznSimulation.optionLegs[0], id: "put-leg", type: "put", side: "sell", strikeUSD: 400, expiryDate: "2026-10-16", quantity: 1 }],
  };
  const base = {
    accountKey: "anonymous", accountAssignment: "N" as const, accountCode: "N" as const, symbol: "SAMPLE/16V26P400:XCBF",
    assetType: "StockOption", quantity: 1, side: "buy" as const, optionType: "put" as const, strike: 400, expiry: "2026-10-16",
    status: "Working", orderRelation: "Oco", isExitCandidate: true, missingFields: [], fetchedAt: "2026-09-04T00:00:00.000Z",
  };
  const orders: SaxoApiOrderSnapshot[] = [
    { ...base, id: "limit", orderType: "Limit", price: 1.9 },
    { ...base, id: "stop", orderType: "StopIfTraded", price: 6.2 },
  ];
  const summary = createReflectionSummary({ mappedSnapshots: [], accountInputs: { P: { cashBalance: 0 } as never, N: { cashBalance: 0 } as never }, positionRows: [], simulations: [simulation], stockTransfers: [], orders, historyEndpoints: [], historyReflectionStates: {} });
  const onOpen = vi.fn();
  const onPrimaryAction = vi.fn();
  render(<ReflectionPendingSummary summary={summary} onShowMapping={vi.fn()} onShowSnapshot={vi.fn()} onShowPositions={vi.fn()} onShowOrders={vi.fn()} onShowHistory={vi.fn()} onOpenHistoryAction={vi.fn()} onOpenOrderAction={onOpen} onPrimaryAction={onPrimaryAction} />);
  expect(summary.orderActions).toHaveLength(1);
  expect(summary.requiredActionCount).toBe(1);
  expect(summary.progress).toEqual({ location: "Saxo取得完了", next: "SAMPLEのOCO出口注文を確認", remaining: "1操作" });
  expect(screen.getByText("現在地:")).toBeInTheDocument();
  expect(screen.getByText("次にすること:")).toBeInTheDocument();
  expect(screen.getByText("完了まで:")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "SAMPLEの出口ルールを確認" }));
  expect(onPrimaryAction).toHaveBeenCalledWith(expect.objectContaining({ kind: "order", action: expect.objectContaining({ simulationId: "anonymous-exit-rule", legId: "put-leg" }) }));
});

it("uses the same pending model for a P-account difference and its top-level direct CTA", () => {
  const summary = createReflectionSummary({
    mappedSnapshots: [{
      accountCode: "P" as const,
      mapping: { workspace: "real", accountKey: "anonymous-account", displayName: "Anonymous P", currency: "JPY", environment: "live", confirmedByUser: true } as never,
      snapshot: { accountKey: "anonymous-account", currency: "JPY", values: { cashBalance: 100 }, missingFields: [], fetchedAt: "2026-09-04T00:00:00.000Z" } as never,
    }],
    accountInputs: { P: { ...accountInputs.P, cashBalance: 0 }, N: accountInputs.N },
    positionRows: [], simulations: [], stockTransfers: [], orders: [], historyEndpoints: [], historyReflectionStates: {},
  });
  const onPrimaryAction = vi.fn();
  render(<ReflectionPendingSummary summary={summary} onShowMapping={vi.fn()} onShowSnapshot={vi.fn()} onShowPositions={vi.fn()} onShowOrders={vi.fn()} onShowHistory={vi.fn()} onOpenHistoryAction={vi.fn()} onPrimaryAction={onPrimaryAction} />);

  expect(summary.progress.next).toBe("P口座の残高差分を確認");
  expect(summary.requiredActionCount).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "P口座の差分を確認して反映へ" }));
  expect(onPrimaryAction).toHaveBeenCalledWith(expect.objectContaining({ kind: "account", accountCode: "P", target: "snapshot" }));
});

it("treats a strong same-event opening record as official despite its source-date representation", () => {
  const simulation: TradeSimulation = {
    ...sampleAmznSimulation,
    id: "entry-canonical",
    ticker: "ANON",
    accountCode: "P",
    accountEnvironment: "PROD_P_JPY_SETTLEMENT",
    accountCurrency: "JPY",
    optionLegs: [{ ...sampleAmznSimulation.optionLegs[0], id: "entry-leg", type: "call", side: "buy", strikeUSD: 160, expiryDate: "2027-01-15", quantity: 1, premiumUSD: 23.85, saxoUic: 700001 }],
    optionEntryExecutions: [
      { id: "canonical", legId: "entry-leg", tradeDate: "2026-08-12", canonicalTradeDate: "2026-08-12", executionTimeUtc: "2026-08-11T15:20:00.000Z", contracts: 1, fillPriceUSD: 23.85, settlementCurrency: "JPY", brokerBookedAmountJPY: -100, brokerPremiumJPY: -99, brokerTransactionCostJPY: 1, source: "saxo_api_estimate", confirmed: true },
      { id: "duplicate", legId: "entry-leg", tradeDate: "2026-08-11", sourceTradeDate: "2026-08-11", contracts: 1, fillPriceUSD: 23.85, settlementCurrency: "JPY", brokerBookedAmountJPY: -100, brokerPremiumJPY: -99, brokerTransactionCostJPY: 1, source: "saxo_api_estimate", confirmed: false },
    ],
  };
  const item: SaxoHistoryDiscoveryItem = {
    id: "opening-source", kind: "trade", accountCode: "P", accountCurrency: "JPY", symbol: "ANON", assetType: "StockOption", optionType: "call", strike: 160, expiry: "2027-01-15", tradeDate: "2026-08-11", quantity: 1, buySell: "buy", openClose: "open", price: 23.85, uic: 700001,
  };
  const states = createHistoryReflectionStates([{ endpoint: "trades", label: "約定", classification: "ok", itemCount: 1, message: "", items: [item] }], [simulation], [], [], []);
  expect(states[item.id]).toMatchObject({ status: "official", recordId: "canonical", target: "entry" });
});

it("renders an unresolved pair without individual reflection controls", () => {
  const hold: SaxoSyntheticForwardHold = { id: "hold", callPosition, putPosition, accountCode: "N", expiry: "2026-12-18", strike: 210, quantity: 1, reason: "原資産識別子をSaxoから取得できませんでした。" };
  render(<table><tbody><SyntheticForwardHoldRow hold={hold} /></tbody></table>);

  expect(screen.getByText("統合保留")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

const closeHistory: SaxoHistoryDiscoveryItem = {
  id: "anonymous-close", kind: "trade", accountCode: "N", symbol: "SAMPLE", assetType: "StockOption",
  optionType: "call", strike: 100, expiry: "2026-12-18", tradeDate: "2026-08-11", quantity: 1,
  buySell: "sell", openClose: "close", price: 12.5,
};

function summaryWithHistoryAction(action: ReflectionSummary["historyActions"][number]): ReflectionSummary {
  return {
    accountLines: [],
    positionLine: { detail: "0件", actionable: false, actionLabel: "確認" },
    orderLine: { detail: "0件", actionable: false },
    historyLine: { detail: "決済1件", actionable: true, actionLabel: "履歴候補一覧を見る" },
    historyActions: [action],
    requiredActionCount: 1,
    hasPending: true,
    progress: { location: "Saxo取得完了", next: "SAMPLEの決済内容を確認", remaining: "1操作" },
    hasNewPositionCandidates: false,
    historyIsSupplemental: false,
  };
}

const accountInputs: AccountInputs = {
  P: {
    accountCode: "P",
    currency: "JPY",
    cashBalance: 0,
    marginAvailable: 0,
    marginUsagePercent: 0,
    updatedAt: "2026-08-13T00:00:00.000Z",
  },
  N: {
    accountCode: "N",
    currency: "USD",
    cashBalance: 0,
    marginAvailable: 0,
    marginUsagePercent: 0,
    updatedAt: "2026-08-13T00:00:00.000Z",
  },
};

const stockSettlementHistory: SaxoHistoryDiscoveryItem = {
  id: "anonymous-stock-sale",
  kind: "trade",
  accountCode: "N",
  symbol: "NVDA",
  assetType: "Stock",
  buySell: "sell",
  quantity: 100,
  price: 202.76,
  tradeDate: "2026-06-23",
  sourceIdMasked: "masked-stock-sale",
};

it("shows a close-specific direct CTA that only requests one Section 7 draft", () => {
  const onOpenHistoryAction = vi.fn();
  render(<ReflectionPendingSummary summary={summaryWithHistoryAction({ item: closeHistory, target: "close", mode: "create" })} onShowMapping={vi.fn()} onShowSnapshot={vi.fn()} onShowPositions={vi.fn()} onShowOrders={vi.fn()} onShowHistory={vi.fn()} onOpenHistoryAction={onOpenHistoryAction} />);

  expect(screen.getByText(/SAMPLE \/ C \/ 行使価格 100 \/ 2026-12-18 \/ 2026-08-11 \/ 決済/)).toBeInTheDocument();
  expect(screen.getByText("Section 7へ確認用下書きを作成して移動します。まだ正式保存されません。")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "SAMPLEの決済内容を確認する" }));
  expect(onOpenHistoryAction).toHaveBeenCalledTimes(1);
  expect(onOpenHistoryAction).toHaveBeenCalledWith(closeHistory);
});

it("uses a return CTA for an existing draft and no direct creation CTA for blocked history", () => {
  const onOpenHistoryAction = vi.fn();
  const { rerender } = render(<ReflectionPendingSummary summary={summaryWithHistoryAction({ item: closeHistory, target: "close", mode: "return" })} onShowMapping={vi.fn()} onShowSnapshot={vi.fn()} onShowPositions={vi.fn()} onShowOrders={vi.fn()} onShowHistory={vi.fn()} onOpenHistoryAction={onOpenHistoryAction} />);
  fireEvent.click(screen.getByRole("button", { name: "SAMPLEの決済確認へ戻る" }));
  expect(onOpenHistoryAction).toHaveBeenCalledTimes(1);

  const onShowHistory = vi.fn();
  rerender(<ReflectionPendingSummary summary={summaryWithHistoryAction({ item: { ...closeHistory, buySell: "unknown" }, target: "close", mode: "review", reason: "自動反映できません。履歴一覧で理由を確認してください。" })} onShowMapping={vi.fn()} onShowSnapshot={vi.fn()} onShowPositions={vi.fn()} onShowOrders={vi.fn()} onShowHistory={onShowHistory} onOpenHistoryAction={onOpenHistoryAction} />);
  expect(screen.queryByRole("button", { name: /決済内容を確認する/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "履歴候補一覧を見る" }).at(-1)!);
  expect(onShowHistory).toHaveBeenCalledTimes(1);
});

it("renders stock settlement rows with stock-specific fields instead of option placeholders", () => {
  const onOpenHistoryAction = vi.fn();
  render(<ReflectionPendingSummary summary={summaryWithHistoryAction({ item: stockSettlementHistory, target: "stock_settlement", mode: "return", reason: "不足項目: 取得単価" })} onShowMapping={vi.fn()} onShowSnapshot={vi.fn()} onShowPositions={vi.fn()} onShowOrders={vi.fn()} onShowHistory={vi.fn()} onOpenHistoryAction={onOpenHistoryAction} />);

  expect(screen.getByText(/NVDA \/ 2026-06-23 \/ 100株 \/ 202.76 USD \/ 株式譲渡/)).toBeInTheDocument();
  expect(screen.queryByText(/種類未確認/)).not.toBeInTheDocument();
  expect(screen.queryByText(/行使価格/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "NVDAの株式譲渡を確認する" }));
  expect(onOpenHistoryAction).toHaveBeenCalledWith(stockSettlementHistory);
});

it("classifies confirmed stock settlements as official and removes them from required-action summary CTAs", () => {
  const simulation: TradeSimulation = {
    id: "nvda-settlement",
    status: "closed",
    name: "NVDA covered call",
    ticker: "NVDA",
    underlyingName: "NVIDIA",
    strategyType: "covered_call",
    currentPriceUSD: 202.76,
    fxRateJPY: 0,
    accountCode: "N",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    accountCurrency: "USD",
    entryDate: "2026-06-12",
    expiryDate: "2026-07-10",
    dte: 28,
    stockPosition: {
      shares: 0,
      averageCostUSD: 207.5,
      denominatorPriceMode: "average_cost",
    },
    optionLegs: [],
    optionEntryExecutions: [],
    optionCloseExecutions: [],
    stockSettlement: {
      enabled: true,
      kind: "manual_sale",
      settlementDate: "2026-06-23",
      shares: 100,
      sellPriceUSD: 202.76,
      costBasisUSD: 207.5,
      commissionUSD: 18.26,
      source: "saxo_history",
      sourceCandidateId: getSaxoHistoryStableKey(stockSettlementHistory),
      sourceTradeId: stockSettlementHistory.id,
      confirmationStatus: "confirmed",
      completionStatus: "complete",
    },
    brokerMarginJPY: 0,
    brokerMarginUSD: 0,
    marginBufferMultiplier: 1,
    marginUsagePercent: 0,
    availableCashJPY: 0,
    denominatorMode: "custom",
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    nisaExpectedAnnualReturnPct: 8,
    brokerCommissionUSD: 2.25,
  };
  const endpoints = [{ endpoint: "trades", label: "約定", classification: "ok" as const, itemCount: 1, message: "", items: [{ ...stockSettlementHistory }] }];
  const reflectionStates = createHistoryReflectionStates(endpoints, [simulation], [], [], []);
  const summary = createReflectionSummary({
    mappedSnapshots: [],
    accountInputs,
    positionRows: [],
    simulations: [simulation],
    stockTransfers: [],
    orders: [],
    historyEndpoints: endpoints,
    historyReflectionStates: reflectionStates,
  });

  expect(reflectionStates[stockSettlementHistory.id]).toMatchObject({ status: "official", target: "stock_settlement" });
  expect(summary.requiredActionCount).toBe(0);
  expect(summary.historyActions).toHaveLength(0);
});

it("counts pending stock settlements as actionable and exposes a reasoned CTA", () => {
  const simulation: TradeSimulation = {
    id: "nvda-settlement-pending",
    status: "closed",
    name: "NVDA covered call",
    ticker: "NVDA",
    underlyingName: "NVIDIA",
    strategyType: "covered_call",
    currentPriceUSD: 202.76,
    fxRateJPY: 0,
    accountCode: "N",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    accountCurrency: "USD",
    entryDate: "2026-06-12",
    expiryDate: "2026-07-10",
    dte: 28,
    stockPosition: {
      shares: 0,
      averageCostUSD: 207.5,
      denominatorPriceMode: "average_cost",
    },
    optionLegs: [],
    optionEntryExecutions: [{ id: "legacy-helper", legId: "sample-call", tradeDate: "2026-08-20", contracts: 1, fillPriceUSD: 2.5, settlementCurrency: "USD", source: "saxo_api_estimate", confirmed: false }],
    optionCloseExecutions: [],
    stockSettlement: {
      enabled: true,
      kind: "manual_sale",
      settlementDate: "2026-06-23",
      shares: 100,
      sellPriceUSD: 202.76,
      costBasisUSD: 0,
      source: "saxo_history",
      sourceCandidateId: getSaxoHistoryStableKey(stockSettlementHistory),
      sourceTradeId: stockSettlementHistory.id,
      confirmationStatus: "pending",
      completionStatus: "incomplete",
    },
    brokerMarginJPY: 0,
    brokerMarginUSD: 0,
    marginBufferMultiplier: 1,
    marginUsagePercent: 0,
    availableCashJPY: 0,
    denominatorMode: "custom",
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    nisaExpectedAnnualReturnPct: 8,
    brokerCommissionUSD: 2.25,
  };
  const endpoints = [{ endpoint: "trades", label: "約定", classification: "ok" as const, itemCount: 1, message: "", items: [{ ...stockSettlementHistory }] }];
  const reflectionStates = createHistoryReflectionStates(endpoints, [simulation], [], [], []);
  const summary = createReflectionSummary({
    mappedSnapshots: [],
    accountInputs,
    positionRows: [],
    simulations: [simulation],
    stockTransfers: [],
    orders: [],
    historyEndpoints: endpoints,
    historyReflectionStates: reflectionStates,
  });

  expect(reflectionStates[stockSettlementHistory.id]).toMatchObject({ status: "candidate", target: "stock_settlement" });
  expect(summary.requiredActionCount).toBe(1);
  expect(summary.historyActions).toHaveLength(1);
  expect(summary.historyActions[0]).toMatchObject({ target: "stock_settlement", mode: "return", reason: "不足項目: 取得単価" });
});

it("keeps a merged effective close candidate intact for the history display path", () => {
  const trade = { ...closeHistory, id: "trade", accountCode: "P" as const, accountCurrency: "JPY", profitLoss: undefined, bookedAmountUSD: 3235.23 };
  const merged = { ...trade, profitLossAccountCurrency: 119265, relatedCandidateKeys: ["closed"] };
  const endpoints = createEffectiveHistoryEndpoints(
    [{ endpoint: "trades", label: "約定", classification: "ok", itemCount: 1, message: "", items: [trade] }, { endpoint: "closed", label: "決済", classification: "ok", itemCount: 1, message: "", items: [{ ...closeHistory, id: "closed", accountCode: "P" as const, accountCurrency: "JPY", profitLossAccountCurrency: 119265 }] }],
    [merged],
  );
  expect(endpoints).toHaveLength(1);
  expect(endpoints[0].items).toEqual([merged]);
});

it("does not show symbol as missing when an underlying ticker has been resolved", () => {
  expect(getDisplayPositionMissingFields({ id: "anonymous", accountKey: "masked", accountAssignment: "P", kind: "option", side: "long", underlyingSymbol: "ABC", missingFields: ["symbol", "currency"], fetchedAt: "2026-08-12T00:00:00.000Z" }, "ABC")).toEqual(["currency"]);
});

it("does not let an old response-local history id hide a different close candidate", () => {
  const leg = sampleAmznSimulation.optionLegs[0];
  const simulation: TradeSimulation = {
    ...sampleAmznSimulation,
    ticker: "SAMPLE",
    accountCode: "N",
    accountCurrency: "USD",
    optionLegs: [{ ...leg, id: "sample-call", type: "call", side: "buy", strikeUSD: 100, expiryDate: "2026-12-18", quantity: 1 }],
    optionCloseExecutions: [],
  };
  const item = { ...closeHistory, id: "closed_position-9" };
  const endpoints = [{ endpoint: "trades", label: "約定", classification: "ok" as const, itemCount: 1, message: "", items: [item] }];

  const staleOnly = createHistoryReflectionStates(endpoints, [simulation], ["closed_position-9"], [], []);
  const semanticOnly = createHistoryReflectionStates(endpoints, [simulation], [getSaxoHistoryStableKey(item)], [], []);

  expect(staleOnly[item.id]).toEqual({ status: "none" });
  expect(semanticOnly[item.id]).toMatchObject({ status: "broken", target: "close" });
  expect(sanitizePersistedSaxoHistoryKeys(["closed_position-9", "trade-27", "saxo-history|trade|stable", "saxo-history|trade|stable"])).toEqual(["saxo-history|trade|stable"]);
});

it("re-recognizes one unique formal legacy entry without restoring its response-local key", () => {
  const leg = sampleAmznSimulation.optionLegs[0];
  const simulation: TradeSimulation = {
    ...sampleAmznSimulation,
    id: "legacy-formal-entry",
    status: "closed",
    ticker: "SAMPLE",
    accountCode: "N",
    accountCurrency: "USD",
    entryDate: "2026-08-20",
    optionLegs: [{ ...leg, id: "sample-call", type: "call", side: "buy", strikeUSD: 100, expiryDate: "2026-12-18", quantity: 1, premiumUSD: 2.5 }],
    optionEntryExecutions: [],
  };
  const item: SaxoHistoryDiscoveryItem = {
    id: "trade-27", kind: "trade", accountCode: "N", accountCurrency: "USD", symbol: "SAMPLE", assetType: "StockOption",
    optionType: "call", strike: 100, expiry: "2026-12-18", tradeDate: "2026-08-20", quantity: 1, buySell: "buy", openClose: "open", price: 2.5,
  };
  const states = createHistoryReflectionStates(
    [{ endpoint: "trades", label: "約定", classification: "ok", itemCount: 1, message: "", items: [item] }],
    [simulation],
    sanitizePersistedSaxoHistoryKeys(["trade-27"]),
    [],
    [],
  );

  expect(states[item.id]).toMatchObject({ status: "official", simulationId: simulation.id, target: "entry" });
});

it("keeps completed history out of pending actions and opens the dashboard ended-history view", () => {
  const onShowEndedHistory = vi.fn();
  const completed = { ...closeHistory, id: "completed-history", openClose: "unknown" as const, buySell: "unknown" as const };
  render(
    <HistoryDiscoveryPreview
      endpoints={[{ endpoint: "trades", label: "約定", classification: "ok", itemCount: 1, message: "", items: [completed] }]}
      fetchedAt="2026-09-04T00:00:00.000Z"
      isLoading={false}
      historyDraft={null}
      reflectionStates={{ [completed.id]: { status: "official", target: "entry", simulationId: "anonymous", recordId: "official-record" } }}
      actionMessages={{}}
      resolveHistoryTarget={() => "unknown"}
      simulations={[]}
      onLoad={vi.fn()}
      onGoEntry={vi.fn()}
      onGoClose={vi.fn()}
      onGoAssignment={vi.fn()}
      onGoStockSettlement={vi.fn()}
      onIgnoreHistoryCandidate={vi.fn()}
      onUnignoreHistoryCandidate={vi.fn()}
      onCreateDraftAndOpen={() => false}
      onCreateDrafts={vi.fn()}
      onShowEndedHistory={onShowEndedHistory}
    />,
  );

  expect(screen.getByText("今回の取得で追加処理はありません。")).toBeInTheDocument();
  expect(screen.queryByText(/完了済み履歴を表示/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "反映済みの終了建玉を表示" }));
  expect(onShowEndedHistory).toHaveBeenCalledTimes(1);
});
