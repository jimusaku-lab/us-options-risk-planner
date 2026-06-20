import { describe, expect, it } from "vitest";
import type { StockTransferEvent, TradeSimulation, WheelCycle } from "@/types/domain";
import {
  applyCoveredCallCoverageToSimulation,
  resolveCoveredCallCoverage,
} from "./coveredCallCoverage";
import { calculateStockDenominatorForSimulationUSD } from "./calculations";
import { generateRiskWarnings } from "./riskRules";

function createNAccountCoveredCall(overrides: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    id: "cc-nvda",
    status: "open",
    name: "NVDA N covered call",
    ticker: "NVDA",
    underlyingName: "",
    strategyType: "covered_call",
    currentPriceUSD: 210,
    fxRateJPY: 160,
    referenceFxRateJPY: 160,
    accountCode: "N",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    accountCurrency: "USD",
    entryDate: "2026-06-18",
    expiryDate: "2026-07-10",
    dte: 22,
    stockPosition: null,
    optionLegs: [
      {
        id: "call-leg",
        type: "call",
        side: "sell",
        strikeUSD: 225,
        premiumUSD: 1.83,
        quantity: 1,
        expiryDate: "2026-07-10",
        isCovered: true,
      },
    ],
    optionEntryExecutions: [
      {
        id: "entry",
        legId: "call-leg",
        tradeDate: "2026-06-18",
        contracts: 1,
        fillPriceUSD: 1.83,
        settlementCurrency: "USD",
        inputMode: "USD_EXECUTION_CALC",
        source: "saxo_api_estimate",
        confirmed: true,
      },
    ],
    brokerMarginJPY: 0,
    brokerMarginUSD: 0,
    marginBufferMultiplier: 1,
    marginUsagePercent: 0,
    availableCashJPY: 0,
    denominatorMode: "stock_plus_margin",
    profitTakeRule: { enabled: false, targetPremiumKeepPercent: 60 },
    stopLossRule: { enabled: false, type: "option_buyback_price", value: 0 },
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    nisaExpectedAnnualReturnPct: 6,
    brokerCommissionUSD: 2.25,
    beginnerMode: true,
    ...overrides,
  };
}

function createWheelCycle(overrides: Partial<WheelCycle> = {}): WheelCycle {
  return {
    id: "wheel-nvda",
    ticker: "NVDA",
    primaryAccountCode: "N",
    currentPhase: "n_stock_holding",
    currentAccountCode: "N",
    currentShares: 100,
    averageCostUSD: 207.5,
    usdCashImpact: 0,
    cumulativePremiumUSD: 0,
    cumulativeStockRealizedPnlUSD: 0,
    cumulativeFeesUSD: 0,
    cumulativeTotalPnlUSD: 0,
    referenceFxRateJPY: 160,
    eventIds: [],
    linkedSimulationIds: [],
    openedAt: "2026-06-16",
    ...overrides,
  };
}

function createStockTransfer(overrides: Partial<StockTransferEvent> = {}): StockTransferEvent {
  return {
    id: "transfer-nvda",
    ticker: "NVDA",
    fromAccountCode: "P",
    toAccountCode: "N",
    shares: 100,
    transferDate: "2026-06-16",
    costBasisUSD: 207.5,
    destinationWheelCycleId: "wheel-nvda",
    sourceSimulationId: "assigned-put",
    ...overrides,
  };
}

describe("covered call coverage resolution", () => {
  it("uses transferred N account wheel shares to cover one short call", () => {
    const simulation = createNAccountCoveredCall();
    const coverage = resolveCoveredCallCoverage(simulation, {
      wheelCycles: [createWheelCycle()],
      stockTransfers: [createStockTransfer()],
    });
    const displaySimulation = applyCoveredCallCoverageToSimulation(simulation, coverage);
    const warnings = generateRiskWarnings(displaySimulation, { coveredCallCoverage: coverage });
    const denominatorUSD = calculateStockDenominatorForSimulationUSD(displaySimulation);

    expect(coverage.requiredShares).toBe(100);
    expect(coverage.coveredShares).toBe(100);
    expect(coverage.missingShares).toBe(0);
    expect(warnings.some((warning) => warning.id === "n-covered-call-share-shortage")).toBe(false);
    expect(warnings.some((warning) => warning.id === "missing-call-hedge")).toBe(false);
    expect(denominatorUSD).toBeCloseTo(20_750, 8);
  });

  it("keeps uncovered warnings when there is no N account stock", () => {
    const simulation = createNAccountCoveredCall();
    const coverage = resolveCoveredCallCoverage(simulation, { wheelCycles: [], stockTransfers: [] });
    const warnings = generateRiskWarnings(simulation, { coveredCallCoverage: coverage });

    expect(coverage.missingShares).toBe(100);
    expect(warnings.some((warning) => warning.id === "n-covered-call-share-shortage")).toBe(true);
    expect(warnings.some((warning) => warning.id === "missing-call-hedge")).toBe(true);
  });

  it("does not use P account stock to cover an N account covered call", () => {
    const simulation = createNAccountCoveredCall({
      stockPosition: {
        shares: 0,
        averageCostUSD: 207.5,
        denominatorPriceMode: "average_cost",
      },
    });
    const coverage = resolveCoveredCallCoverage(simulation, {
      wheelCycles: [
        createWheelCycle({
          currentAccountCode: "P",
          currentPhase: "p_assigned_stock",
          currentShares: 100,
        }),
      ],
      stockTransfers: [],
    });

    expect(coverage.coveredShares).toBe(0);
    expect(coverage.missingShares).toBe(100);
  });

  it("uses linked N wheel shares and marks them as already linked", () => {
    const simulation = createNAccountCoveredCall();
    const coverage = resolveCoveredCallCoverage(simulation, {
      wheelCycles: [createWheelCycle({ currentPhase: "n_covered_call", linkedSimulationIds: [simulation.id] })],
      stockTransfers: [],
    });

    expect(coverage.coveredShares).toBe(100);
    expect(coverage.linkedToSimulation).toBe(true);
    expect(coverage.linkNeeded).toBe(false);
  });
});
