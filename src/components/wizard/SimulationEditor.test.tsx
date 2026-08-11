import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulationEditor } from "./SimulationEditor";
import type { TradeSimulation } from "@/types/domain";
import type { SaxoHistoryDiscoveryItem } from "@/features/saxo/saxoAccountSync";

afterEach(() => {
  cleanup();
});

describe("SimulationEditor", () => {
  it("auto-selects a long-call entry leg created from a Saxo position draft", () => {
    const simulation = buildVisaLongCallSimulation();

    render(
      <SimulationEditor
        simulation={simulation}
        workspace="live"
        canUseExternalQuotes={false}
        externalQuoteModeLabel="無効"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getAllByText("C買い 340 / 2026-11-20 / 1枚").length).toBeGreaterThan(0);
    expect(screen.queryByText("対象脚未選択")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("-396166")).toBeInTheDocument();
    expect(screen.getByDisplayValue("-395797")).toBeInTheDocument();
    expect(screen.getByDisplayValue("-4288")).toBeInTheDocument();

    const targetLegSelect = screen.getByLabelText("対象脚");
    expect(targetLegSelect).toHaveValue("saxo-visa-c340-leg");
    expect(within(targetLegSelect).getByRole("option", { name: "C買い 340 / 2026-11-20 / 1枚" })).toBeInTheDocument();
  });

  it("repairs a missing entry leg id and complements P-account JPY values from Saxo history", async () => {
    const initialSimulation = buildVisaLongCallSimulation({
      optionEntryExecutions: [
        {
          id: "saxo-entry-visa-c340",
          legId: "missing-leg-id",
          tradeDate: "2026-06-30",
          contracts: 1,
          fillPriceUSD: 24.1,
          settlementCurrency: "JPY",
          referenceFxRateJPY: 164.23105,
          inputMode: "P_JPY_BROKER_STATEMENT",
          source: "saxo_api_estimate",
          saxoSourceType: "current_position",
          historyCompletionStatus: "unmatched",
          confirmed: false,
        },
      ],
    });
    function Harness() {
      const [current, setCurrent] = useState(initialSimulation);
      return (
        <SimulationEditor
          simulation={current}
          workspace="live"
          canUseExternalQuotes={false}
          externalQuoteModeLabel="無効"
          onChange={setCurrent}
          saxoHistoryCandidates={[visaEntryHistory]}
        />
      );
    }

    render(<Harness />);

    await waitFor(() => expect(screen.getByLabelText("対象脚")).toHaveValue("saxo-visa-c340-leg"));
    expect(screen.queryByText("対象脚未選択")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "確認して正式保存する" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Saxo取引履歴から補完" }));

    await waitFor(() => expect(screen.getByDisplayValue("-396166")).toBeInTheDocument());
    expect(screen.getByDisplayValue("-395797")).toBeInTheDocument();
    expect(screen.getByDisplayValue("-4288")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("164.23105").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/不足項目: 記帳額JPY/)).not.toBeInTheDocument();
  });

  it("recovers a missing option leg from Saxo draft metadata before history completion", async () => {
    const initialSimulation = buildVisaLongCallSimulation({
      optionLegs: [],
      optionEntryExecutions: [
        {
          id: "saxo-entry-visa-c340",
          legId: "saxo-visa-c340-leg",
          tradeDate: "2026-06-30",
          contracts: 1,
          fillPriceUSD: 24.1,
          settlementCurrency: "JPY",
          referenceFxRateJPY: 164.23105,
          inputMode: "P_JPY_BROKER_STATEMENT",
          source: "saxo_api_estimate",
          saxoSourceType: "current_position",
          historyCompletionStatus: "unmatched",
          historyCandidateIds: ["visa-c340-entry"],
          confirmed: false,
        },
      ],
    });
    function Harness() {
      const [current, setCurrent] = useState(initialSimulation);
      return (
        <SimulationEditor
          simulation={current}
          workspace="live"
          canUseExternalQuotes={false}
          externalQuoteModeLabel="無効"
          onChange={setCurrent}
          saxoHistoryCandidates={[visaEntryHistory]}
        />
      );
    }

    render(<Harness />);

    await waitFor(() => expect(screen.getByLabelText("対象脚")).toHaveValue("saxo-visa-c340-leg"));
    expect(screen.queryByText("対象脚未選択")).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("対象脚")).getByRole("option", { name: "C買い 340 / 2026-11-20 / 1枚" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Saxo取引履歴から補完" }));

    await waitFor(() => expect(screen.getByDisplayValue("-396166")).toBeInTheDocument());
    expect(screen.getByDisplayValue("-395797")).toBeInTheDocument();
    expect(screen.getByDisplayValue("-4288")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("164.23105").length).toBeGreaterThanOrEqual(2);
  });

  it("backfills a missing N-account fee as a standard value without a missing-fee warning", async () => {
    const initialSimulation = buildVisaLongCallSimulation({
      accountCode: "N",
      accountEnvironment: "PROD_N_USD_SETTLEMENT",
      accountCurrency: "USD",
      optionEntryExecutions: [
        {
          id: "n-entry",
          legId: "saxo-visa-c340-leg",
          tradeDate: "2026-06-30",
          contracts: 1,
          fillPriceUSD: 24.1,
          settlementCurrency: "USD",
          inputMode: "USD_EXECUTION_CALC",
          source: "saxo_api_estimate",
          saxoSourceType: "current_position",
          historyCompletionStatus: "unmatched",
          confirmed: false,
        },
      ],
    });
    function Harness() {
      const [current, setCurrent] = useState(initialSimulation);
      return <SimulationEditor simulation={current} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={setCurrent} />;
    }

    render(<Harness />);

    await waitFor(() => expect(screen.getByText(/費用出所: 標準取引費用/)).toBeInTheDocument());
    expect(screen.getAllByDisplayValue("2.25").length).toBeGreaterThan(0);
    expect(screen.queryByText(/不足項目: .*取引費用USD/)).not.toBeInTheDocument();
  });

  it("shows the synthetic-forward saved panel and hides draft actions after both legs are confirmed", () => {
    const onOpenDashboard = vi.fn();
    const simulation = buildVisaLongCallSimulation({
      status: "open", strategyType: "synthetic_forward", accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD",
      optionLegs: [
        { id: "synthetic-call", type: "call", side: "buy", strikeUSD: 210, premiumUSD: 26.25, quantity: 1, expiryDate: "2026-12-18", assignmentPolicy: "unknown" },
        { id: "synthetic-put", type: "put", side: "sell", strikeUSD: 210, premiumUSD: 21.05, quantity: 1, expiryDate: "2026-12-18", putIntent: "accept_assignment", assignmentPolicy: "unknown" },
      ],
      optionEntryExecutions: [
        { id: "synthetic-entry-call", legId: "synthetic-call", tradeDate: "2026-07-16", contracts: 1, fillPriceUSD: 26.25, settlementCurrency: "USD", commissionUSD: 2.25, source: "saxo_api_estimate", historyCandidateIds: ["call-trade"], confirmed: true },
        { id: "synthetic-entry-put", legId: "synthetic-put", tradeDate: "2026-07-16", contracts: 1, fillPriceUSD: 21.05, settlementCurrency: "USD", commissionUSD: 2.25, source: "saxo_api_estimate", historyCandidateIds: ["put-trade"], confirmed: true },
      ],
      syntheticForwardTicket: { orderId: "5425367936", netFillPriceUSD: 5.2, actualTotalCommissionUSD: 4.5, entryCostUSD: 524.5, requiredMarginUSD: 4_000 },
    });
    render(<SimulationEditor simulation={simulation} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={vi.fn()} onOpenDashboard={onOpenDashboard} />);
    expect(screen.getByText("シンセティックフォワードを保存済み")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Saxo取引履歴から補完" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下書きを破棄" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "建玉ダッシュボードで確認" }));
    expect(onOpenDashboard).toHaveBeenCalledOnce();
  });

  it.each(["call", "put"] as const)("shows an anonymous long-%s Saxo close target in the same UI and save set", (type) => {
    const simulation = buildSampleLongOptionCloseSimulation(type);
    render(<SimulationEditor simulation={simulation} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={vi.fn()} />);
    expect(screen.getAllByText(`${type === "call" ? "C" : "P"}買い 100 / 2026-12-18 / 1枚`).length).toBeGreaterThan(0);
    expect(screen.queryByText("対象脚未選択")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("対象脚").some((select) => (select as HTMLSelectElement).value === "sample-long-leg")).toBe(true);
    expect(screen.getByRole("button", { name: "確認して正式保存" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "この決済実績を確認する" })).not.toBeInTheDocument();
  });

  it("confirms a full close and changes status atomically without a legacy status CTA", () => {
    const onChange = vi.fn();
    const simulation = buildSampleLongOptionCloseSimulation("call");
    render(<SimulationEditor simulation={simulation} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "確認して正式保存" }));
    const next = onChange.mock.calls[0][0] as TradeSimulation;
    expect(next.status).toBe("closed");
    expect(next.optionCloseExecutions?.[0]).toMatchObject({ confirmed: true, confirmationStatus: "confirmed" });
    expect(screen.queryByRole("button", { name: "決済済みに変更" })).not.toBeInTheDocument();
  });

  it("blocks an invalid Saxo history close leg before it can change confirmation state", () => {
    const onChange = vi.fn();
    render(<SimulationEditor simulation={buildSampleLongOptionCloseSimulation("call", "missing-leg")} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={onChange} />);
    expect(screen.getByText("対象脚が現在の建玉から見つかりません。正式保存できません。")).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: "確認して正式保存" });
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(onChange).not.toHaveBeenCalled();
  });
});

const visaEntryHistory: SaxoHistoryDiscoveryItem = {
  id: "visa-c340-entry",
  kind: "trade",
  accountKey: "p-key",
  accountCode: "P",
  symbol: "V/20X26C340:XCBF",
  instrumentCode: "V/20X26C340:XCBF",
  assetType: "StockOption",
  buySell: "buy",
  openClose: "unknown",
  quantity: 1,
  price: 24.1,
  tradeDate: "2026-06-30",
  currency: "USD",
  bookedAmount: -396166,
  premiumAmount: -395797,
  transactionCost: -4288,
  exchangeRate: 164.23105,
};

function buildVisaLongCallSimulation(patch: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    id: "saxo-position-draft-visa-c340",
    status: "open",
    name: "V / API取込下書き",
    ticker: "V",
    underlyingName: "Visa Inc.",
    strategyType: "long_call",
    currentPriceUSD: 335,
    fxRateJPY: 164.23105,
    accountCode: "P",
    accountEnvironment: "PROD_P_JPY_SETTLEMENT",
    entryDate: "2026-06-30",
    expiryDate: "2026-11-20",
    dte: 143,
    accountCurrency: "JPY",
    referenceFxRateJPY: 164.23105,
    stockPosition: null,
    optionLegs: [
      {
        id: "saxo-visa-c340-leg",
        type: "call",
        side: "buy",
        strikeUSD: 340,
        premiumUSD: 24.1,
        quantity: 1,
        expiryDate: "2026-11-20",
        isCovered: false,
        assignmentPolicy: "unknown",
        brokerSymbol: "V/20X26C340:XCBF",
      },
    ],
    optionEntryExecutions: [
      {
        id: "saxo-entry-visa-c340",
        legId: "saxo-visa-c340-leg",
        tradeDate: "2026-06-30",
        contracts: 1,
        fillPriceUSD: 24.1,
        settlementCurrency: "JPY",
        brokerBookedAmountJPY: -396166,
        brokerPremiumJPY: -395797,
        brokerTransactionCostJPY: -4288,
        brokerExchangeRateJPY: 164.23105,
        referenceFxRateJPY: 164.23105,
        inputMode: "P_JPY_BROKER_STATEMENT",
        source: "saxo_api_estimate",
        saxoSourceType: "current_position",
        historyCompletionStatus: "matched",
        historyCandidateIds: ["visa-c340-entry"],
        confirmed: false,
      },
    ],
    optionCloseExecutions: [],
    brokerMarginJPY: 0,
    brokerMarginUSD: 0,
    marginBufferMultiplier: 1,
    marginUsagePercent: 0,
    availableCashJPY: 0,
    denominatorMode: "custom",
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    nisaExpectedAnnualReturnPct: 8,
    brokerCommissionUSD: 2.25,
    fixtureMeta: {
      source: "live",
      isRealMoney: true,
      broker: "SaxoBank",
      purpose: "development-fixture",
      createdAt: "2026-06-30",
      notes: "Saxo API read-onlyの現在建玉候補から作成した下書き",
      saxoInstrumentCode: "V/20X26C340:XCBF",
    },
    ...patch,
  };
}

function buildSampleLongOptionCloseSimulation(type: "call" | "put", executionLegId = "sample-long-leg"): TradeSimulation {
  const simulationId = "sample-long-option";
  return {
    id: simulationId, status: "open", name: "SAMPLE", ticker: "SAMPLE", strategyType: type === "call" ? "long_call" : "long_put", currentPriceUSD: 100, fxRateJPY: 150, accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD", entryDate: "2026-08-01", expiryDate: "2026-12-18", dte: 139, referenceFxRateJPY: 150, stockPosition: null,
    optionLegs: [{ id: "sample-long-leg", type, side: "buy", strikeUSD: 100, premiumUSD: 10, quantity: 1, expiryDate: "2026-12-18", isCovered: false, assignmentPolicy: "unknown" }],
    optionEntryExecutions: [{ id: "sample-entry", legId: "sample-long-leg", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 10, commissionUSD: 1, settlementCurrency: "USD", inputMode: "USD_EXECUTION_CALC", source: "manual", confirmed: true }],
    optionCloseExecutions: [{ id: "sample-close", legId: executionLegId, closeDate: "2026-08-10", contracts: 1, closePriceUSD: 12, commissionUSD: 1, settlementCurrency: "USD", source: "saxo_history", sourceCandidateId: "anonymous-candidate", sourceTradeId: "anonymous-trade", targetPositionId: simulationId, confirmationStatus: "pending", confirmed: false }],
    brokerMarginJPY: 0, brokerMarginUSD: 0, marginBufferMultiplier: 1, marginUsagePercent: 0, availableCashJPY: 0, denominatorMode: "custom", taxProfileId: "japan_derivative_separate_tax_user_confirm", nisaExpectedAnnualReturnPct: 8, brokerCommissionUSD: 1,
  };
}
