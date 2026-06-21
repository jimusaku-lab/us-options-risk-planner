import { describe, expect, it } from "vitest";
import type { StockTransferEvent, TradeSimulation, WheelCycle } from "@/types/domain";
import {
  applyCoveredCallCoverageToSimulation,
  resolveEffectiveCoveredCallSimulation,
  resolveCoveredCallCoverage,
} from "./coveredCallCoverage";
import { calculateStockDenominatorForSimulationUSD } from "./calculations";
import { calculateDashboardPremiumDisplay } from "./dashboardDisplay";
import { calculateDenominators, getPrimaryDenominator } from "./denominators";
import { calculatePayoffSummary } from "./payoff";
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
        commissionUSD: 2.25,
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

  it("uses recorded P-to-N stock transfers when the matching wheel cycle is missing", () => {
    const simulation = createNAccountCoveredCall();
    const coverage = resolveCoveredCallCoverage(simulation, {
      wheelCycles: [],
      stockTransfers: [createStockTransfer()],
    });
    const displaySimulation = applyCoveredCallCoverageToSimulation(simulation, coverage);
    const warnings = generateRiskWarnings(displaySimulation, { coveredCallCoverage: coverage });

    expect(coverage.source).toBe("n_stock_transfer");
    expect(coverage.coveredShares).toBe(100);
    expect(coverage.missingShares).toBe(0);
    expect(warnings.some((warning) => warning.id === "n-covered-call-share-shortage")).toBe(false);
    expect(warnings.some((warning) => warning.id === "missing-call-hedge")).toBe(false);
    expect(calculateStockDenominatorForSimulationUSD(displaySimulation)).toBeCloseTo(20_750, 8);
  });

  it("does not treat missing USDJPY as a blocking NG for N account USD calculations", () => {
    const simulation = createNAccountCoveredCall({ fxRateJPY: 0, referenceFxRateJPY: 0 });
    const coverage = resolveCoveredCallCoverage(simulation, {
      wheelCycles: [],
      stockTransfers: [createStockTransfer()],
    });
    const displaySimulation = applyCoveredCallCoverageToSimulation(simulation, coverage);
    const warnings = generateRiskWarnings(displaySimulation, { coveredCallCoverage: coverage });
    const missingFx = warnings.find((warning) => warning.id === "missing-fx-rate");

    expect(missingFx?.severity).toBe("info");
    expect(warnings.filter((warning) => warning.severity !== "info").some((warning) => warning.id === "missing-fx-rate")).toBe(false);
  });

  it("uses N-phase wheel shares even when legacy currentAccountCode is stale", () => {
    const simulation = createNAccountCoveredCall();
    const coverage = resolveCoveredCallCoverage(simulation, {
      wheelCycles: [
        createWheelCycle({
          currentPhase: "n_stock_holding",
          currentAccountCode: "P",
          currentShares: 100,
          averageCostUSD: 207.5,
        }),
      ],
      stockTransfers: [],
    });
    const displaySimulation = applyCoveredCallCoverageToSimulation(simulation, coverage);
    const warnings = generateRiskWarnings(displaySimulation, { coveredCallCoverage: coverage });

    expect(coverage.coveredShares).toBe(100);
    expect(coverage.missingShares).toBe(0);
    expect(warnings.some((warning) => warning.id === "n-covered-call-share-shortage")).toBe(false);
    expect(warnings.some((warning) => warning.id === "missing-call-hedge")).toBe(false);
    expect(calculateStockDenominatorForSimulationUSD(displaySimulation)).toBeCloseTo(20_750, 8);
  });

  it("does not use p_to_n_transfer_pending stock as N account covered call coverage", () => {
    const simulation = createNAccountCoveredCall();
    const coverage = resolveCoveredCallCoverage(simulation, {
      wheelCycles: [
        createWheelCycle({
          currentPhase: "p_to_n_transfer_pending",
          currentAccountCode: "P",
          currentShares: 100,
          averageCostUSD: 207.5,
        }),
      ],
      stockTransfers: [],
    });

    expect(coverage.coveredShares).toBe(0);
    expect(coverage.missingShares).toBe(100);
  });

  it("builds one effective model for dashboard, warnings, denominators, annual return, and payoff", () => {
    const simulation = createNAccountCoveredCall({
      fxRateJPY: 0,
      referenceFxRateJPY: 0,
      stockPosition: null,
    });
    const { simulation: effectiveSimulation, coverage } = resolveEffectiveCoveredCallSimulation(simulation, {
      wheelCycles: [
        createWheelCycle({
          currentPhase: "n_stock_holding",
          currentAccountCode: "P",
          currentShares: 100,
          averageCostUSD: 207.5,
          linkedSimulationIds: [simulation.id],
        }),
      ],
      stockTransfers: [],
    });
    const warnings = generateRiskWarnings(effectiveSimulation, { coveredCallCoverage: coverage });
    const blockingOrDangerWarnings = warnings.filter((warning) => warning.blocking || warning.severity === "danger");
    const premiumDisplay = calculateDashboardPremiumDisplay(effectiveSimulation);
    const primaryDenominator = getPrimaryDenominator(calculateDenominators(effectiveSimulation, premiumDisplay.premiumJPY));
    const payoffSummary = calculatePayoffSummary(effectiveSimulation, "practical");

    expect(coverage.coveredShares).toBe(100);
    expect(coverage.missingShares).toBe(0);
    expect(effectiveSimulation.stockPosition?.shares).toBe(100);
    expect(effectiveSimulation.stockPosition?.averageCostUSD).toBe(207.5);
    expect(blockingOrDangerWarnings).toEqual([]);
    expect(primaryDenominator.amountUSD).toBeCloseTo(20_750, 8);
    expect(premiumDisplay.premiumUSD).toBeCloseTo(180.75, 8);
    expect(premiumDisplay.annualReturnPct).toBeGreaterThan(0);
    expect(payoffSummary.maxLossLabel).not.toContain("無制限");
    expect(payoffSummary.breakevens[0].label).toBe("保有株込みの損益分岐点");
  });

  it("uses the only N wheel holding when the covered call ticker is not yet captured", () => {
    const simulation = createNAccountCoveredCall({
      ticker: "",
      fxRateJPY: 0,
      referenceFxRateJPY: 0,
      stockPosition: null,
    });
    const { simulation: effectiveSimulation, coverage } = resolveEffectiveCoveredCallSimulation(simulation, {
      wheelCycles: [
        createWheelCycle({
          ticker: "NVDA",
          currentPhase: "n_stock_holding",
          currentAccountCode: "N",
          currentShares: 100,
          averageCostUSD: 207.5,
        }),
      ],
      stockTransfers: [],
    });
    const warnings = generateRiskWarnings(effectiveSimulation, { coveredCallCoverage: coverage });
    const blockingOrDangerWarnings = warnings.filter((warning) => warning.blocking || warning.severity === "danger");
    const premiumDisplay = calculateDashboardPremiumDisplay(effectiveSimulation);
    const payoffSummary = calculatePayoffSummary(effectiveSimulation, "practical");

    expect(coverage.source).toBe("n_wheel_cycle");
    expect(coverage.coveredShares).toBe(100);
    expect(coverage.missingShares).toBe(0);
    expect(effectiveSimulation.stockPosition?.shares).toBe(100);
    expect(blockingOrDangerWarnings).toEqual([]);
    expect(premiumDisplay.annualReturnPct).toBeGreaterThan(0);
    expect(payoffSummary.maxLossLabel).not.toContain("無制限");
  });

  it("does not guess coverage from multiple N wheel holdings when ticker is missing", () => {
    const simulation = createNAccountCoveredCall({ ticker: "", stockPosition: null });
    const coverage = resolveCoveredCallCoverage(simulation, {
      wheelCycles: [
        createWheelCycle({ id: "wheel-nvda", ticker: "NVDA", currentShares: 100, averageCostUSD: 207.5 }),
        createWheelCycle({ id: "wheel-aapl", ticker: "AAPL", currentShares: 100, averageCostUSD: 180 }),
      ],
      stockTransfers: [],
    });

    expect(coverage.coveredShares).toBe(0);
    expect(coverage.missingShares).toBe(100);
  });
});
