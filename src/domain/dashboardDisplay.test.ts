import { describe, expect, it } from "vitest";
import type { TradeSimulation } from "@/types/domain";
import { calculateDashboardPremiumDisplay } from "./dashboardDisplay";

function createPlannedCoveredCall(overrides: Partial<TradeSimulation> = {}): TradeSimulation {
  const simulation: TradeSimulation = {
    id: "cc-draft",
    status: "planned",
    name: "NVDA N covered call draft",
    ticker: "NVDA",
    underlyingName: "",
    strategyType: "covered_call",
    currentPriceUSD: 207.5,
    fxRateJPY: 160,
    referenceFxRateJPY: 160,
    accountCode: "N",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    accountCurrency: "USD",
    entryDate: "2026-06-17",
    expiryDate: "2026-07-17",
    dte: 30,
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
        strikeUSD: 240,
        premiumUSD: 0.65,
        quantity: 1,
        expiryDate: "2026-07-17",
        isCovered: true,
      },
    ],
    brokerMarginJPY: 0,
    brokerMarginUSD: 0,
    marginBufferMultiplier: 1,
    marginUsagePercent: 0,
    availableCashJPY: 0,
    denominatorMode: "stock_plus_margin",
    profitTakeRule: {
      enabled: false,
      targetPremiumKeepPercent: 60,
      latestCloseDaysBeforeExpiry: 7,
    },
    stopLossRule: {
      enabled: false,
      type: "option_buyback_price",
      value: 0,
    },
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    nisaExpectedAnnualReturnPct: 6,
    brokerCommissionUSD: 2.25,
    beginnerMode: false,
    ...overrides,
  };
  return simulation;
}

describe("dashboard premium display", () => {
  it("uses planned option leg premium for planned N covered calls even when stale unconfirmed execution is zero", () => {
    const simulation = createPlannedCoveredCall({
      optionEntryExecutions: [
        {
          id: "stale-entry",
          legId: "call-leg",
          tradeDate: "2026-06-17",
          contracts: 1,
          fillPriceUSD: 0,
          settlementCurrency: "USD",
          commissionUSD: 2.25,
          inputMode: "USD_EXECUTION_CALC",
          source: "manual",
          confirmed: false,
        },
      ],
    });

    const display = calculateDashboardPremiumDisplay(simulation);

    expect(display.basis).toBe("planned");
    expect(display.label).toBe("予定プレミアム");
    expect(display.hasPremiumInput).toBe(true);
    expect(display.premiumUSD).toBeCloseTo(65, 8);
    expect(display.netAfterFeesUSD).toBeCloseTo(62.75, 8);
    expect(display.premiumJPY).toBeCloseTo(10_400, 8);
  });

  it("marks truly empty planned premiums as missing instead of a confirmed zero value", () => {
    const simulation = createPlannedCoveredCall({
      optionLegs: [
        {
          id: "call-leg",
          type: "call",
          side: "sell",
          strikeUSD: 240,
          premiumUSD: 0,
          quantity: 1,
          expiryDate: "2026-07-17",
          isCovered: true,
        },
      ],
    });

    const display = calculateDashboardPremiumDisplay(simulation);

    expect(display.basis).toBe("planned");
    expect(display.hasPremiumInput).toBe(false);
    expect(display.premiumUSD).toBe(0);
  });
});
