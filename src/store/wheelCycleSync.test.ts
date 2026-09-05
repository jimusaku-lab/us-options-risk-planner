import { describe, expect, it } from "vitest";
import type { TradeSimulation, WheelCycle, WheelEvent } from "@/types/domain";
import { syncWheelCycleWithCoveredCallSimulation, syncWheelCycleWithNShortPutSimulation } from "./useOptionsStore";

function createCoveredCall(overrides: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    id: "cc-nvda",
    status: "closed",
    name: "NVDA N covered call",
    ticker: "NVDA",
    underlyingName: "",
    strategyType: "covered_call",
    currentPriceUSD: 220,
    fxRateJPY: 160,
    referenceFxRateJPY: 160,
    accountCode: "N",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    accountCurrency: "USD",
    entryDate: "2026-06-18",
    expiryDate: "2026-07-10",
    dte: 22,
    stockPosition: {
      shares: 100,
      averageCostUSD: 207.5,
      denominatorPriceMode: "average_cost",
    },
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
    optionCloseExecutions: [
      {
        id: "close",
        legId: "call-leg",
        closeKind: "buyback",
        confirmed: true,
        closeDate: "2026-06-23",
        contracts: 1,
        closePriceUSD: 0.79,
        commissionUSD: 2.25,
        settlementCurrency: "USD",
        inputMode: "USD_EXECUTION_CALC",
        source: "saxo_history",
        confirmationStatus: "confirmed",
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
    nisaExpectedAnnualReturnPct: 9,
    brokerCommissionUSD: 2.25,
    beginnerMode: false,
    ...overrides,
  };
}

function createNShortPut(overrides: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    ...createCoveredCall({
      id: "put-nvda",
      status: "open",
      name: "NVDA N short put",
      strategyType: "short_put",
      entryDate: "2026-06-23",
      expiryDate: "2026-07-24",
      dte: 31,
      stockPosition: null,
      denominatorMode: "cash_secured",
      optionLegs: [
        {
          id: "put-leg",
          type: "put",
          side: "sell",
          strikeUSD: 195,
          premiumUSD: 5.9,
          quantity: 1,
          expiryDate: "2026-07-24",
          putIntent: "want_to_buy",
          assignmentPolicy: "accept",
        },
      ],
      optionEntryExecutions: [
        {
          id: "put-entry",
          legId: "put-leg",
          tradeDate: "2026-06-23",
          contracts: 1,
          fillPriceUSD: 5.9,
          settlementCurrency: "USD",
          commissionUSD: 2.25,
          inputMode: "USD_EXECUTION_CALC",
          source: "saxo_api_estimate",
          confirmed: true,
        },
      ],
      optionCloseExecutions: [],
    }),
    ...overrides,
  };
}

function createWheelCycle(overrides: Partial<WheelCycle> = {}): WheelCycle {
  return {
    id: "wheel-nvda",
    ticker: "NVDA",
    primaryAccountCode: "N",
    currentPhase: "n_covered_call",
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
    linkedSimulationIds: ["cc-nvda"],
    openedAt: "2026-06-18",
    ...overrides,
  };
}

describe("wheel cycle covered call synchronization", () => {
  it("returns a closed covered call cycle to N stock holding when shares are still held", () => {
    const result = syncWheelCycleWithCoveredCallSimulation({
      simulation: createCoveredCall(),
      wheelCycles: [createWheelCycle()],
      wheelEvents: [],
      workspace: "live",
    });

    expect(result.wheelCycles[0].currentPhase).toBe("n_stock_holding");
    expect(result.wheelCycles[0].currentShares).toBe(100);
    expect(result.wheelEvents).toHaveLength(2);
    expect(result.wheelEvents[0].type).toBe("covered_call_closed");
    expect(result.wheelEvents[0].feeUSD).toBe(2.25);
    expect(result.wheelEvents[1].type).toBe("covered_call_opened");
    expect(result.wheelEvents[1].feeUSD).toBe(2.25);
    expect(result.wheelCycles[0].cumulativeFeesUSD).toBe(4.5);
  });

  it("moves a sold N stock cycle to called-away state and zero shares", () => {
    const result = syncWheelCycleWithCoveredCallSimulation({
      simulation: createCoveredCall({
        stockSettlement: {
          enabled: true,
          kind: "manual_sale",
          settlementDate: "2026-06-24",
          shares: 100,
          sellPriceUSD: 230,
          costBasisUSD: 207.5,
          commissionUSD: 1.25,
        },
      }),
      wheelCycles: [createWheelCycle()],
      wheelEvents: [],
      workspace: "live",
    });

    expect(result.wheelCycles[0].currentPhase).toBe("n_called_away");
    expect(result.wheelCycles[0].currentShares).toBe(0);
    expect(result.wheelCycles[0].cumulativeStockRealizedPnlUSD).toBeCloseTo(2248.75, 8);
    expect(result.wheelCycles[0].cumulativeFeesUSD).toBeCloseTo(5.75, 8);
    expect(result.wheelEvents.map((event) => event.type)).toEqual(["stock_sold", "covered_call_closed", "covered_call_opened"]);
  });

  it("does not duplicate close or stock-sold events on repeated saves", () => {
    const simulation = createCoveredCall({
      stockSettlement: {
        enabled: true,
        kind: "manual_sale",
        settlementDate: "2026-06-24",
        shares: 100,
        sellPriceUSD: 230,
        costBasisUSD: 207.5,
        commissionUSD: 1.25,
      },
    });
    const first = syncWheelCycleWithCoveredCallSimulation({
      simulation,
      wheelCycles: [createWheelCycle()],
      wheelEvents: [],
      workspace: "live",
    });
    const second = syncWheelCycleWithCoveredCallSimulation({
      simulation,
      wheelCycles: first.wheelCycles,
      wheelEvents: first.wheelEvents as WheelEvent[],
      workspace: "live",
    });

    expect(second.wheelEvents.filter((event) => event.type === "covered_call_closed")).toHaveLength(1);
    expect(second.wheelEvents.filter((event) => event.type === "stock_sold")).toHaveLength(1);
    expect(second.wheelEvents.filter((event) => event.type === "covered_call_opened")).toHaveLength(1);
    expect(second.wheelCycles[0].cumulativeStockRealizedPnlUSD).toBeCloseTo(2248.75, 8);
    expect(second.wheelCycles[0].cumulativeFeesUSD).toBeCloseTo(5.75, 8);
    expect(second.wheelCycles[0].currentShares).toBe(0);
  });

  it("rebuilds cumulative fees from covered call entry, close, stock sale, and the next N short put without duplication", () => {
    const coveredCall = createCoveredCall({
      stockSettlement: {
        enabled: true,
        kind: "manual_sale",
        settlementDate: "2026-06-24",
        shares: 100,
        sellPriceUSD: 202.76,
        costBasisUSD: 207.5,
        commissionUSD: 18.26,
        source: "manual",
        confirmationStatus: "confirmed",
        completionStatus: "complete",
        confirmedAt: "2026-06-24T10:00:00.000Z",
      },
    });
    const shortPut = createNShortPut();
    const coveredCallSynced = syncWheelCycleWithCoveredCallSimulation({
      simulation: coveredCall,
      wheelCycles: [createWheelCycle({ cumulativeFeesUSD: 20.51 })],
      wheelEvents: [],
      workspace: "live",
      simulations: [coveredCall, shortPut],
    });
    const shortPutSynced = syncWheelCycleWithNShortPutSimulation({
      simulation: shortPut,
      wheelCycles: coveredCallSynced.wheelCycles,
      wheelEvents: coveredCallSynced.wheelEvents,
      workspace: "live",
      simulations: [coveredCall, shortPut],
    });
    const repeated = syncWheelCycleWithNShortPutSimulation({
      simulation: shortPut,
      wheelCycles: shortPutSynced.wheelCycles,
      wheelEvents: shortPutSynced.wheelEvents,
      workspace: "live",
      simulations: [coveredCall, shortPut],
    });

    const shortPutCycle = shortPutSynced.wheelCycles.find((cycle) => cycle.linkedSimulationIds.includes(shortPut.id));
    const repeatedShortPutCycle = repeated.wheelCycles.find((cycle) => cycle.linkedSimulationIds.includes(shortPut.id));
    expect(shortPutCycle?.cumulativeFeesUSD).toBeCloseTo(2.25, 8);
    expect(repeatedShortPutCycle?.cumulativeFeesUSD).toBeCloseTo(2.25, 8);
    expect(repeated.wheelEvents.filter((event) => event.type === "covered_call_opened")).toHaveLength(1);
    expect(repeated.wheelEvents.filter((event) => event.type === "covered_call_closed")).toHaveLength(1);
    expect(repeated.wheelEvents.filter((event) => event.type === "stock_sold")).toHaveLength(1);
    expect(repeated.wheelEvents.filter((event) => event.type === "short_put_opened")).toHaveLength(1);
    expect(repeated.wheelEvents.reduce((sum, event) => sum + (event.feeUSD ?? 0), 0)).toBeCloseTo(25.01, 8);
  });
});

describe("wheel cycle N short put synchronization", () => {
  it("creates an isolated current N short put cycle without reusing an unlinked sold-stock cycle", () => {
    const result = syncWheelCycleWithNShortPutSimulation({
      simulation: createNShortPut(),
      wheelCycles: [createWheelCycle({ currentPhase: "n_called_away", currentShares: 0, linkedSimulationIds: ["cc-nvda"] })],
      wheelEvents: [],
      workspace: "live",
    });

    const active = result.wheelCycles.find((cycle) => cycle.linkedSimulationIds.includes("put-nvda"));
    expect(active?.currentPhase).toBe("n_short_put");
    expect(active?.currentShares).toBe(0);
    expect(result.wheelCycles[0].linkedSimulationIds).toEqual(["cc-nvda"]);
    expect(result.wheelEvents).toHaveLength(1);
    expect(result.wheelEvents[0].type).toBe("short_put_opened");
    expect(result.wheelEvents[0].feeUSD).toBe(2.25);
    expect(active?.cumulativeFeesUSD).toBe(2.25);
  });

  it("does not duplicate short_put_opened events on repeated saves", () => {
    const simulation = createNShortPut();
    const first = syncWheelCycleWithNShortPutSimulation({
      simulation,
      wheelCycles: [createWheelCycle({ currentPhase: "n_called_away", currentShares: 0, linkedSimulationIds: ["cc-nvda"] })],
      wheelEvents: [],
      workspace: "live",
    });
    const second = syncWheelCycleWithNShortPutSimulation({
      simulation,
      wheelCycles: first.wheelCycles,
      wheelEvents: first.wheelEvents,
      workspace: "live",
    });

    expect(second.wheelEvents.filter((event) => event.type === "short_put_opened")).toHaveLength(1);
    const active = second.wheelCycles.find((cycle) => cycle.linkedSimulationIds.includes(simulation.id));
    expect(active?.currentPhase).toBe("n_short_put");
    expect(active?.cumulativeFeesUSD).toBe(2.25);
  });

  it("does not infer the only cycle when the imported N short put has a blank ticker", () => {
    const result = syncWheelCycleWithNShortPutSimulation({
      simulation: createNShortPut({ ticker: "" }),
      wheelCycles: [createWheelCycle({ currentPhase: "n_called_away", currentShares: 0, linkedSimulationIds: ["cc-nvda"] })],
      wheelEvents: [],
      workspace: "live",
    });

    expect(result.wheelCycles[0].ticker).toBe("NVDA");
    expect(result.wheelCycles[0].linkedSimulationIds).not.toContain("put-nvda");
    expect(result.wheelEvents).toHaveLength(0);
  });
});
