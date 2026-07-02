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

    fireEvent.click(screen.getByRole("button", { name: "Saxo取引履歴から補完" }));

    await waitFor(() => expect(screen.getByDisplayValue("-396166")).toBeInTheDocument());
    expect(screen.getByDisplayValue("-395797")).toBeInTheDocument();
    expect(screen.getByDisplayValue("-4288")).toBeInTheDocument();
    expect(screen.getByDisplayValue("164.23105")).toBeInTheDocument();
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
    expect(screen.getByDisplayValue("164.23105")).toBeInTheDocument();
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
