import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TradeSimulation } from "@/types/domain";
import type { AccountInputs } from "@/store/useOptionsStore";
import { getSimulationTickerDisplayLabel } from "./Dashboard";
import { Dashboard } from "./Dashboard";
import { BasisMetric } from "./PositionBasisCard";
import { createCurrentOptionPricePreviewRow, getCurrentOptionPriceTargets } from "@/domain/bulkOptionPrice";
import { captureReferenceQuote, resolveEvaluationQuote } from "@/domain/midpointEvaluation";
function explicitFixtureQuotes(s: TradeSimulation) { s.optionLegs = s.optionLegs.map(leg => ({...leg, contractSize:100, referenceQuote: leg.closeCostUSD === undefined ? undefined : captureReferenceQuote(resolveEvaluationQuote({bid:leg.closeCostUSD,ask:leg.closeCostUSD,priceTypeBid:"Tradable",priceTypeAsk:"Tradable",source:"fixture",fetchedAt:"2026-09-26T01:00:00Z"}),"fixture")})); return s; }

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
        contractSize: 100,
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

it("omits reason and rateReason only in compact metrics while preserving the detailed calculation evidence", () => {
 const missing = { basis: "reference" as const, kind: "missing" as const, currency: "USD" as const, evaluatedLegIds: ["leg"], reason: "価格の不足理由" };
 const {rerender} = render(createElement(BasisMetric, {result: missing, compact: true}));
 expect(screen.getByText("未計算")).toBeTruthy();
 expect(screen.queryByText(missing.reason)).toBeNull();
 rerender(createElement(BasisMetric, {result: missing}));
 expect(screen.getByText(missing.reason)).toBeTruthy();
 const available = {...missing, kind: "available" as const, amount: 120, rateReason: "率の不足理由"};
 rerender(createElement(BasisMetric, {result: available, compact: true}));
 expect(screen.getByText("+$120.00")).toBeTruthy();
 expect(screen.getByText("参考損益率 未計算")).toBeTruthy();
 expect(screen.queryByText(available.rateReason)).toBeNull();
 rerender(createElement(BasisMetric, {result: available}));
 expect(screen.getByText(available.rateReason)).toBeTruthy();
});

it("opens shared whole-portfolio preview from the management bar after capability recovery", () => {
 const simulation=createSimulation(), fetch=vi.fn(), manual=vi.fn();
 const props={simulations:[simulation],selectedId:simulation.id,onSelect:vi.fn(),onEdit:vi.fn(),onDelete:vi.fn(),workspace:"live" as const,accountInputs,historyOpen:false,onHistoryOpenChange:vi.fn(),onFetchBulkOptionPrices:fetch,onCurrentEstimateAction:manual,bulkOptionPriceAvailable:false};
 const {rerender}=render(createElement(Dashboard,props));
 expect(screen.queryByRole("button",{name:"Bid/Ask候補価格を取得"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"価格を一括更新"}));
 expect(fetch).toHaveBeenCalledTimes(1);expect(manual).not.toHaveBeenCalled();expect(screen.getByRole("dialog")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"現在オプション価格の確認を閉じる"}));
 expect(screen.queryByRole("dialog")).toBeNull();
 rerender(createElement(Dashboard,{...props,bulkOptionPriceOpenRequest:1}));
 expect(screen.getByRole("dialog")).toBeTruthy();expect(fetch).toHaveBeenCalledTimes(1);
});

describe("synthetic leg history", () => {
  it("renders four current strategies with one metric order and canonical denominators", () => {
    const spread=createSimulation({id:"spread",ticker:"SPRD",strategyType:"bear_put_spread",entryDate:"2026-09-01",expiryDate:"2026-10-02",optionLegs:[
      {id:"spread-long",type:"put",side:"buy",strikeUSD:100,premiumUSD:4.92,quantity:1,contractSize:100,expiryDate:"2026-10-02",closeCostUSD:4.05,closePlan:{enabled:true,closePriceUSD:4.05,commissionUSD:2.24,priceType:"OldIndicative"}},
      {id:"spread-short",type:"put",side:"sell",strikeUSD:90,premiumUSD:0.92,quantity:1,contractSize:100,expiryDate:"2026-10-02",closeCostUSD:0.79,closePlan:{enabled:true,closePriceUSD:0.79,commissionUSD:2.24,priceType:"OldIndicative"}}],optionEntryExecutions:[
      {id:"spread-entry-long",legId:"spread-long",tradeDate:"2026-09-01",contracts:1,fillPriceUSD:4.92,settlementCurrency:"USD",commissionUSD:2.24,source:"manual",confirmed:true},
      {id:"spread-entry-short",legId:"spread-short",tradeDate:"2026-09-01",contracts:1,fillPriceUSD:0.92,settlementCurrency:"USD",commissionUSD:2.24,source:"manual",confirmed:true}]});
    const nLong=createSimulation({id:"n-long",ticker:"NBUY",strategyType:"long_call",entryDate:"2026-09-01",optionLegs:[{...createSimulation().optionLegs[0],id:"n-long-leg",type:"call",side:"buy",premiumUSD:2.2,closeCostUSD:3,closePlan:{enabled:true,commissionUSD:2.24}}],optionEntryExecutions:[{id:"n-long-entry",legId:"n-long-leg",tradeDate:"2026-09-01",contracts:1,fillPriceUSD:2.2,settlementCurrency:"USD",commissionUSD:2.24,source:"manual",confirmed:true}]});
    const pLong=createSimulation({id:"p-long",ticker:"PJPY",strategyType:"long_call",entryDate:"2026-09-01",accountCode:"P",accountEnvironment:"PROD_P_JPY_SETTLEMENT",accountCurrency:"JPY",referenceFxRateJPY:999,optionLegs:[{...createSimulation().optionLegs[0],id:"p-long-leg",type:"call",side:"buy",premiumUSD:23.85,closeCostUSD:20,closePlan:{enabled:true,commissionUSD:2.24}}],optionEntryExecutions:[{id:"p-long-entry",legId:"p-long-leg",tradeDate:"2026-09-01",contracts:1,fillPriceUSD:23.85,settlementCurrency:"JPY",brokerBookedAmountJPY:-383_934,source:"manual",confirmed:true}]});
    const partial=createSimulation({id:"partial",ticker:"PART",strategyType:"synthetic_forward",entryDate:"2026-09-01",optionLegs:[
      {id:"partial-call",type:"call",side:"buy",strikeUSD:210,premiumUSD:26.25,quantity:1,expiryDate:"2026-12-18",closeCostUSD:8,closePlan:{enabled:true,commissionUSD:2.24}},
      {id:"partial-put",type:"put",side:"sell",strikeUSD:210,premiumUSD:21.05,quantity:1,expiryDate:"2026-12-18",closeCostUSD:2,closePlan:{enabled:true,commissionUSD:2.24}}],optionEntryExecutions:[
      {id:"partial-call-entry",legId:"partial-call",tradeDate:"2026-09-01",contracts:1,fillPriceUSD:26.25,settlementCurrency:"USD",commissionUSD:2.24,source:"manual",confirmed:true},
      {id:"partial-put-entry",legId:"partial-put",tradeDate:"2026-09-01",contracts:1,fillPriceUSD:21.05,settlementCurrency:"USD",commissionUSD:2.24,source:"manual",confirmed:true}],optionCloseExecutions:[{id:"partial-call-close",legId:"partial-call",closeKind:"buyback",closeDate:"2026-09-10",contracts:1,settlementCurrency:"USD",source:"manual",confirmed:true}]});
    [spread,nLong,pLong,partial].forEach(explicitFixtureQuotes);
    const {container}=render(createElement(Dashboard,{simulations:[spread,nLong,pLong,partial],selectedId:spread.id,onSelect:vi.fn(),onEdit:vi.fn(),onDelete:vi.fn(),workspace:"live",accountInputs,historyOpen:false,onHistoryOpenChange:vi.fn(),currentEstimateFxQuote:{pair:"USDJPY",rate:160,date:"2026-09-13",fetchedAt:"2026-09-13T00:00:00Z",source:"frankfurter"}}));
    const rows=["SPRD","NBUY","PJPY","PART"].map((ticker)=>container.querySelector(`tr[aria-label="${ticker}の詳細を表示する"]`)!);
    for (const row of rows) { expect(row.children[8].textContent).toContain("参考損益（中間値）"); expect(row.children[8].textContent).toContain("参考損益率"); expect(row.children[8].textContent).not.toContain("現在決済年率"); expect(row.querySelectorAll("td")).toHaveLength(12); }
    expect(rows[0].children[7].textContent).toContain("$404.48"); expect(rows[1].children[7].textContent).toContain("$222.24"); expect(rows[2].children[7].textContent).toContain("383,934円"); expect(rows[3].children[7].textContent).toContain("$21,000.00");
    expect(container.textContent).not.toContain("開始支払額は左列に表示"); expect(container.textContent).not.toContain("支払総額は左列に表示");
  });

  it("shows bear put spread P/L and period return as the primary dashboard decision", () => {
    const simulation = createSimulation({
      ticker: "TEST", strategyType: "bear_put_spread", entryDate: "2026-09-01", expiryDate: "2026-10-02",
      optionLegs: [
        { id: "long", type: "put", side: "buy", strikeUSD: 100, premiumUSD: 4.92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02", closeCostUSD: 4.5, closePlan: { enabled: true, closePriceUSD: 4.5, commissionUSD: 2.24 } },
        { id: "short", type: "put", side: "sell", strikeUSD: 90, premiumUSD: 0.92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02", closeCostUSD: 0.7, closePlan: { enabled: true, closePriceUSD: 0.7, commissionUSD: 2.24 } },
      ],
      optionEntryExecutions: [
        { id: "el", legId: "long", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 4.92, settlementCurrency: "USD", commissionUSD: 2.24, source: "manual", confirmed: true },
        { id: "es", legId: "short", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 0.92, settlementCurrency: "USD", commissionUSD: 2.24, source: "manual", confirmed: true },
      ],
    });
    explicitFixtureQuotes(simulation);
    const onPositionFocus = vi.fn();
    const { container, rerender } = render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn(), onPositionFocus }));
    expect(screen.getByText("ベア・プット")).toBeTruthy();
    expect(screen.getByText("P100買い／P90売り・1組")).toBeTruthy();
    expect(container.querySelector('tr[aria-label="TESTの詳細を表示する"]')?.children[8].textContent).toContain("-$28.96");
    expect(container.querySelector('tr[aria-label="TESTの詳細を表示する"]')?.children[8].textContent).toContain("-7.2%");
    expect(screen.getByText("参考損益（中間値）")).toBeTruthy();
    expect(screen.queryByText("現在決済年率")).toBeNull();
    expect(container.querySelector('tr[aria-label="TESTの詳細を表示する"]')?.children[7].textContent).toContain("$404.48");
    expect(screen.getAllByText(/期間損益率/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "戦略の決済を確認" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("TESTの詳細を表示する"));
    expect(onPositionFocus).toHaveBeenCalledWith(simulation.id);
    rerender(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn(), positionFocusSimulationId: simulation.id, onPositionFocus }));
    // The real App renders one responsive parent preview outside this wide
    // table; Dashboard must not duplicate that three-card summary.
    expect(screen.queryByTestId("bear-put-spread-focus-detail")).toBeNull();
  });
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
    expect(screen.getByText(/N口座の実現損益は米ドル建て・手数料控除後・税引前/)).toBeTruthy();
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
    expect(row?.textContent).toContain("建玉時支払 -$792.24 / 決済時受取 +$2,297.76（手数料込み）");
    expect(row?.textContent).not.toContain("決済支払 -$2,302.24");
    expect(row?.textContent).toContain("購入時支払総額");
    expect(row?.textContent).toContain("+190.0%");
    expect(row?.textContent).toContain("年率換算（参考）+5,335.6%保有13日");
    expect(row?.textContent).toContain("契約P $195.00");
    expect(row?.textContent).not.toContain("現在株価");
    expect(row?.textContent).not.toContain("税後参考未確定");
    expect(screen.getAllByText(/N口座の実現損益は米ドル建て・手数料控除後・税引前/)).toHaveLength(1);
    const stableHistory = ["実現利益+$1,505.52", "+190.0%", "年率換算（参考）+5,335.6%保有13日"];
    rerender(createElement(Dashboard, {
      simulations: [{ ...simulation, currentPriceUSD: 999 }], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs,
      historyOpen: true, onHistoryOpenChange: vi.fn(), currentEstimateFxQuote: { pair: "USDJPY", rate: 180, date: "2026-09-11", fetchedAt: "2026-09-11T00:00:00Z", source: "frankfurter" },
    }));
    const rerenderedRow = Array.from(container.querySelectorAll("tr")).find((candidate) => candidate.textContent?.includes("XYZ"));
    stableHistory.forEach((text) => expect(rerenderedRow?.textContent).toContain(text));
    expect(rerenderedRow?.textContent).not.toContain("現在株価");
  });

  it("keeps the minus sign and labels an N/USD realized loss explicitly", () => {
    const simulation = createSimulation({
      status: "closed",
      ticker: "LOSS",
      strategyType: "long_put",
      entryDate: "2025-03-10",
      optionLegs: [{ ...createSimulation().optionLegs[0], id: "put", side: "buy", premiumUSD: 1, quantity: 1, assignmentPolicy: "avoid" }],
      optionEntryExecutions: [{ id: "entry", legId: "put", tradeDate: "2025-03-10", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true }],
      optionCloseExecutions: [{ id: "close", legId: "put", closeKind: "buyback", closeDate: "2025-03-23", contracts: 1, closePriceUSD: 0.3, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: -74.48, source: "manual", confirmed: true }],
    });
    const { container } = render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: true, onHistoryOpenChange: vi.fn() }));
    const row = Array.from(container.querySelectorAll("tr")).find((candidate) => candidate.textContent?.includes("LOSS"));
    expect(row?.textContent).toContain("実現損失-$74.48");
    expect(row?.textContent).toContain("建玉時支払 -$102.24 / 決済時受取 +$27.76（手数料込み）");
    expect(row?.textContent).not.toContain("現在株価");
    expect(row?.textContent).toContain("警告なし");
    expect(row?.textContent).not.toContain("出口ルール");
  });

  it("keeps P/JPY realized history primary and hides active market comparisons", () => {
    const simulation = createSimulation({
      status: "closed",
      ticker: "JPYC",
      strategyType: "long_call",
      accountCode: "P",
      accountEnvironment: "PROD_P_JPY_SETTLEMENT",
      accountCurrency: "JPY",
      currentPriceUSD: 300,
      optionLegs: [{ ...createSimulation().optionLegs[0], id: "call", type: "call", side: "buy", strikeUSD: 220, premiumUSD: 2, quantity: 1 }],
      optionEntryExecutions: [{ id: "entry", legId: "call", tradeDate: "2025-03-10", contracts: 1, fillPriceUSD: 2, settlementCurrency: "JPY", brokerBookedAmountJPY: -32_000, source: "manual", confirmed: true }],
      optionCloseExecutions: [{ id: "close", legId: "call", closeKind: "buyback", closeDate: "2025-03-23", contracts: 1, closePriceUSD: 3, settlementCurrency: "JPY", brokerRealizedPnlJPY: 12_345, source: "manual", confirmed: true }],
    });
    const { container } = render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: true, onHistoryOpenChange: vi.fn() }));
    const row = Array.from(container.querySelectorAll("tr")).find((candidate) => candidate.textContent?.includes("JPYC"));
    expect(row?.textContent).toContain("実現利益+12,345円");
    expect(row?.textContent).toContain("契約C $220.00");
    expect(row?.textContent).not.toContain("現在株価");
    expect(row?.textContent).not.toContain("+$80.00");
    expect(row?.querySelector('[data-testid="history-cashflow-display"]')).toBeNull();
  });

  it("labels short-option receipt and buyback payment from the actual direction", () => {
    const value = createSimulation({
      status: "closed",
      ticker: "SHORT",
      strategyType: "short_put",
      optionLegs: [{ ...createSimulation().optionLegs[0], id: "put", side: "sell", premiumUSD: 3.75, quantity: 1 }],
      optionEntryExecutions: [{ id: "entry", legId: "put", tradeDate: "2025-03-10", contracts: 1, fillPriceUSD: 3.75, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true }],
      optionCloseExecutions: [{ id: "close", legId: "put", closeKind: "buyback", closeDate: "2025-03-23", contracts: 1, closePriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: 270.52, source: "manual", confirmed: true }],
    });
    const { container } = render(createElement(Dashboard, { simulations: [value], selectedId: value.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: true, onHistoryOpenChange: vi.fn() }));
    const row = Array.from(container.querySelectorAll("tr")).find((candidate) => candidate.textContent?.includes("SHORT"));
    expect(row?.textContent).toContain("建玉時受取 +$372.76 / 決済時支払 -$102.24（手数料込み）");
  });

  it("shows expiration and unknown cashflow without inventing a sale or zero fee", () => {
    const expired = createSimulation({
      status: "expired",
      ticker: "EXPIRE",
      strategyType: "long_put",
      optionLegs: [{ ...createSimulation().optionLegs[0], id: "put", side: "buy", premiumUSD: 1, quantity: 1 }],
      optionEntryExecutions: [{ id: "entry", legId: "put", tradeDate: "2025-03-10", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true }],
      optionCloseExecutions: [{ id: "close", legId: "put", closeKind: "expired", closeDate: "2025-03-23", contracts: 1, commissionUSD: 0, settlementCurrency: "USD", realizedPnlUSD: -102.24, source: "manual", confirmed: true }],
    });
    const unknown = createSimulation({
      status: "closed",
      id: "unknown",
      ticker: "UNKNOWN",
      strategyType: "long_put",
      optionLegs: [{ ...createSimulation().optionLegs[0], id: "put", side: "buy", premiumUSD: 1, quantity: 1 }],
      optionEntryExecutions: [{ id: "entry", legId: "put", tradeDate: "2025-03-10", contracts: 1, fillPriceUSD: 1, settlementCurrency: "USD", source: "manual", confirmed: true }],
      optionCloseExecutions: [{ id: "close", legId: "put", closeKind: "buyback", closeDate: "2025-03-23", contracts: 1, closePriceUSD: 2, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: 97.76, source: "manual", confirmed: true }],
    });
    const { container } = render(createElement(Dashboard, { simulations: [expired, unknown], selectedId: expired.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: true, onHistoryOpenChange: vi.fn() }));
    const rows = Array.from(container.querySelectorAll("tr"));
    expect(rows.find((candidate) => candidate.textContent?.includes("EXPIRE"))?.textContent).toContain("満期時受払 $0.00");
    expect(rows.find((candidate) => candidate.textContent?.includes("UNKNOWN"))?.textContent).toContain("入出金内訳 未確認");
  });

  it("does not present materially unreconciled auxiliary cashflow as correct", () => {
    const value = createSimulation({
      status: "closed",
      ticker: "CONFLICT",
      strategyType: "long_put",
      optionLegs: [{ ...createSimulation().optionLegs[0], id: "put", side: "buy", premiumUSD: 1, quantity: 1 }],
      optionEntryExecutions: [{ id: "entry", legId: "put", tradeDate: "2025-03-10", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true }],
      optionCloseExecutions: [{ id: "close", legId: "put", closeKind: "buyback", closeDate: "2025-03-23", contracts: 1, closePriceUSD: 2, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: 98.76, source: "manual", confirmed: true }],
    });
    const { container } = render(createElement(Dashboard, { simulations: [value], selectedId: value.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: true, onHistoryOpenChange: vi.fn() }));
    const row = Array.from(container.querySelectorAll("tr")).find((candidate) => candidate.textContent?.includes("CONFLICT"));
    expect(row?.textContent).toContain("入出金と実現損益 不一致");
    expect(row?.textContent).not.toContain("建玉時支払 -$102.24 / 決済時受取 +$197.76");
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
    expect(screen.getByText("Saxo価格取得は利用できません（未接続・未対応または公開版）。")).toBeTruthy();
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
  it("shows a working long-call stop as optional information, not a required confirmation", () => {
    const simulation = createSimulation({ ticker: "SAMPLE", strategyType: "long_call", optionLegs: [{ id: "long-call", type: "call", side: "buy", strikeUSD: 55, premiumUSD: 3.3, quantity: 1, expiryDate: "2026-10-16", saxoAccountKey: "anonymous", saxoUic: 990001 }] });
    const action = vi.fn();
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn(), onSaxoExitOrderAction: action,
      saxoOrders: [{ id: "anonymous-stop", accountKey: "anonymous", accountAssignment: "N", accountCode: "N", symbol: "SAMPLE/16V26C55:XCBF", assetType: "StockOption", quantity: 1, side: "sell", optionType: "call", strike: 55, expiry: "2026-10-16", uic: 990001, status: "Working", orderType: "StopIfTraded", orderRelation: "StandAlone", openClose: "close", stopPrice: 0.5, missingFields: [], fetchedAt: "2026-09-15T01:02:03.000Z" }],
    }));
    expect(screen.getByText(/逆指値注文あり（未約定）/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Saxoの注文を見る（任意）" }));
    expect(action).toHaveBeenCalledWith("sim", "long-call");
  });
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

  it.each(["accept", "unknown"] as const)("uses the common current-close rate and P/L order for %s", (policy) => {
    const simulation = explicitFixtureQuotes(currentShortPut(policy));
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn() }));
    expect(screen.getByText("参考損益（中間値）")).toBeTruthy();
    expect(screen.queryByText("現在決済年率")).toBeNull();
    expect(screen.getByText("+$170.52")).toBeTruthy();
    expect(screen.queryByText("プレミアム年率")).toBeNull();
  });

  it("keeps avoid on current close annual return plus the existing P/L label", () => {
    const simulation = explicitFixtureQuotes(currentShortPut("avoid"));
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn() }));
    expect(screen.getByText("参考損益（中間値）")).toBeTruthy();
    expect(screen.queryByText("現在決済年率")).toBeNull();
    expect(screen.getByText("+$170.52")).toBeTruthy();
    expect(screen.queryByText(/現在買戻し概算損益/)).toBeNull();
  });

  it("does not send missing reference quotes to a manual put input when price preview is unavailable", () => {
    const action = vi.fn();
    const simulation = currentShortPut("accept", false);
    render(createElement(Dashboard, { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn(), onCurrentEstimateAction: action }));
    expect(screen.queryByText("中間値の価格をまだ取得していません")).toBeNull();
    expect(screen.queryByText("Bid/Ask価格取得は利用できません")).toBeNull();
    expect(screen.queryByRole("button", { name: "不足情報を確認" })).toBeNull();
    expect(action).not.toHaveBeenCalled();
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
    expect(screen.getByText("参考損益（中間値）")).toBeTruthy();
    expect(screen.queryByText("現在決済年率")).toBeNull();
    expect(screen.queryByText(/契約倍率 未確認/)).toBeNull();
    expect(screen.getAllByText("未計算").length).toBeGreaterThan(0);
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
    expect(positionRow).toHaveClass("bg-white");
    expect(positionRow).toHaveAttribute("aria-selected", "false");
    fireEvent.click(positionRow);
    expect(onFocus).toHaveBeenCalledWith(selected.id);

    fireEvent.keyDown(positionRow, { key: "Enter" });
    expect(onFocus).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(positionRow, { key: " " });
    expect(onFocus).toHaveBeenCalledTimes(3);

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
    const focusedRow = document.querySelector('tr[aria-label="PGRの詳細を閉じる"]')!;
    expect(focusedRow).toHaveAttribute("aria-selected", "true");
    expect(focusedRow).toHaveClass("bg-emerald-100");
    fireEvent.click(focusedRow);
    expect(onClearPositionFocus).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "全建玉一覧に戻る" }));
    expect(onClearPositionFocus).toHaveBeenCalledTimes(2);
  });

  it("does not toggle position focus from nested edit and delete controls", () => {
    const onFocus = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const simulation = createSimulation({ id: "sim-controls", ticker: "CTRL" });

    render(createElement(Dashboard, {
      simulations: [simulation],
      selectedId: simulation.id,
      onSelect: vi.fn(),
      onEdit,
      onDelete,
      workspace: "live",
      accountInputs,
      historyOpen: false,
      onHistoryOpenChange: vi.fn(),
      onPositionFocus: onFocus,
    }));

    fireEvent.click(screen.getByTitle("この建玉を編集"));
    fireEvent.click(screen.getByTitle("この建玉を削除"));
    fireEvent.keyDown(screen.getByTitle("この建玉を編集"), { key: "Enter" });
    fireEvent.keyDown(screen.getByTitle("この建玉を削除"), { key: " " });
    expect(onEdit).toHaveBeenCalledWith(simulation.id);
    expect(onDelete).toHaveBeenCalledWith(simulation.id);
    expect(onFocus).not.toHaveBeenCalled();
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

  it("keeps rows compact and exposes diagnostics only inside optional bulk details", () => {
    const simulation = createSimulation({ ticker: "TEST", optionLegs: [{ ...createSimulation().optionLegs[0], id: "leg", contractSize: 100 }] });
    const fetch = vi.fn();
    const row = createCurrentOptionPricePreviewRow(getCurrentOptionPriceTargets([simulation])[0], { environment: "live", source: "fixture", status: "available", classification: "available", message: "fixture", fetchedAt: "2026-09-26T00:00:00Z", ask: 2, quoteDiagnostics: { priceTypeBid: "Indicative", priceTypeAsk: "Indicative" } });
    const props = { simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live" as const, accountInputs, historyOpen: false, onHistoryOpenChange: vi.fn(), onFetchBulkOptionPrices: fetch, bulkOptionPricePreview: [row] };
    const mounted = render(createElement(Dashboard, props));
    expect(screen.queryByText("中間値を取得できませんでした")).toBeNull();
    expect(screen.queryByText(/Bidが未取得/)).toBeNull();
    expect(screen.queryByRole("button", { name: "取得結果を確認" })).toBeNull();
    expect(screen.queryByText(/今回の取得結果は未保持です/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "価格を一括更新" }));
    expect(fetch).toHaveBeenCalledExactlyOnceWith();
    const details = screen.getByText("価格の取得根拠・診断").closest("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("Bidが未取得");
    expect(screen.queryByRole("button", { name: "この建玉の残存脚を再取得" })).toBeNull();
    expect(screen.getByRole("dialog").querySelector("tbody")?.textContent).toContain("Bidが未取得");
    mounted.rerender(createElement(Dashboard, { ...props, bulkOptionPriceLoading: true }));
    expect(screen.getByRole("button", { name: "全建玉の価格を再取得" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "現在オプション価格の確認を閉じる" }));
    mounted.rerender(createElement(Dashboard, { ...props, bulkOptionPricePreview: undefined }));
    expect(screen.queryByText(/今回の取得結果は未保持です/)).toBeNull();
    expect(screen.queryByText("中間値を取得できませんでした")).toBeNull();
  });
  it("offers a direct 3-A review for a historical long-option entry conflict", () => {
    const onHistoryEntryAction = vi.fn();
    const simulation = createSimulation({
      status: "closed",
      ticker: "ABC",
      strategyType: "long_put",
      optionLegs: [{ ...createSimulation().optionLegs[0], id: "put", type: "put", side: "buy", quantity: 1 }],
      optionEntryExecutions: [
        { id: "entry-a", legId: "put", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true },
        { id: "entry-b", legId: "put", tradeDate: "2026-08-02", contracts: 1, fillPriceUSD: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true },
      ],
      optionCloseExecutions: [{ id: "close", legId: "put", closeKind: "buyback", closeDate: "2026-08-05", contracts: 1, closePriceUSD: 1.5, commissionUSD: 2.24, settlementCurrency: "USD", realizedPnlUSD: 45.52, source: "manual", confirmed: true }],
    });
    render(createElement(Dashboard, {
      simulations: [simulation], selectedId: simulation.id, onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), workspace: "live", accountInputs,
      historyOpen: true, onHistoryOpenChange: vi.fn(), onHistoryEntryAction,
    }));
    expect(screen.getAllByText("開始約定の数量超過（証跡未照合）").length).toBeGreaterThan(0);
    expect(screen.queryByText("完了（追加操作なし）")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "購入時約定を確認" }));
    expect(onHistoryEntryAction).toHaveBeenCalledWith(simulation.id);
  });
});
