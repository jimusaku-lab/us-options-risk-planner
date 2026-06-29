import { describe, expect, it } from "vitest";
import type { TradeSimulation } from "@/types/domain";
import { calculateDashboardPremiumDisplay, getEffectiveFxRateJPY } from "./dashboardDisplay";

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

  it("calculates N account planned annual return in USD even when reference FX is zero", () => {
    const simulation = createPlannedCoveredCall({
      entryDate: "2026-06-17",
      expiryDate: "2026-07-10",
      dte: 0,
      fxRateJPY: 160.38,
      referenceFxRateJPY: 0,
    });

    const display = calculateDashboardPremiumDisplay(simulation);

    expect(getEffectiveFxRateJPY(simulation)).toBe(160.38);
    expect(display.dte).toBe(23);
    expect(display.premiumUSD).toBeCloseTo(65, 8);
    expect(display.netAfterFeesUSD).toBeCloseTo(62.75, 8);
    expect(display.premiumJPY).toBeCloseTo(10_424.7, 1);
    expect(display.annualReturnPct).toBeCloseTo(5.0, 1);
    expect(display.netAnnualReturnPct).toBeCloseTo(4.8, 1);
  });

  it("calculates covered call assignment estimate separately from premium annual return", () => {
    const simulation = createPlannedCoveredCall({
      entryDate: "2026-06-17",
      expiryDate: "2026-07-10",
      dte: 0,
      fxRateJPY: 160.38,
      referenceFxRateJPY: 0,
    });

    const display = calculateDashboardPremiumDisplay(simulation);

    expect(display.coveredCallAssignmentEstimate?.shares).toBe(100);
    expect(display.coveredCallAssignmentEstimate?.costBasisDenominatorUSD).toBeCloseTo(20_750, 8);
    expect(display.coveredCallAssignmentEstimate?.stockSaleGainUSD).toBeCloseTo(3_250, 8);
    expect(display.coveredCallAssignmentEstimate?.totalWithPremiumUSD).toBeCloseTo(3_315, 8);
    expect(display.coveredCallAssignmentEstimate?.totalAfterFeesUSD).toBeCloseTo(3_312.75, 8);
    expect(display.coveredCallAssignmentEstimate?.annualReturnPct).toBeCloseTo(253.5, 1);
    expect(display.coveredCallAssignmentEstimate?.netAnnualReturnPct).toBeCloseTo(253.4, 1);
  });

  it("calculates confirmed N covered call annual return in USD without requiring JPY reference FX", () => {
    const simulation = createPlannedCoveredCall({
      status: "open",
      entryDate: "2026-06-18",
      expiryDate: "2026-07-10",
      dte: 0,
      fxRateJPY: 0,
      referenceFxRateJPY: 0,
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
          id: "confirmed-entry",
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
    });

    const display = calculateDashboardPremiumDisplay(simulation);

    expect(display.basis).toBe("confirmed");
    expect(display.dte).toBe(22);
    expect(display.premiumUSD).toBeCloseTo(180.75, 8);
    expect(display.annualReturnPct).toBeGreaterThan(0);
    expect(display.coveredCallAssignmentEstimate?.costBasisDenominatorUSD).toBeCloseTo(20_750, 8);
    expect(display.coveredCallAssignmentEstimate?.annualReturnPct).toBeGreaterThan(0);
  });

  it("calculates confirmed N short put annual return from USD premium and cash-secured denominator when FX is zero", () => {
    const simulation: TradeSimulation = {
      ...createPlannedCoveredCall({
        id: "nvda-p195-n",
        status: "open",
        name: "NVDA P195 N short put",
        strategyType: "short_put",
        currentPriceUSD: 201.8,
        fxRateJPY: 0,
        referenceFxRateJPY: 0,
        entryDate: "2026-06-23",
        expiryDate: "2026-07-24",
        dte: 0,
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
          },
        ],
        optionEntryExecutions: [
          {
            id: "confirmed-entry",
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
      }),
    };

    const display = calculateDashboardPremiumDisplay(simulation);

    expect(display.basis).toBe("confirmed");
    expect(display.dte).toBe(31);
    expect(display.premiumUSD).toBeCloseTo(587.75, 8);
    expect(display.premiumJPY).toBe(0);
    expect(display.annualReturnPct).toBeCloseTo(35.5, 1);
  });

  it("uses confirmed entry trade date for open-position DTE display", () => {
    const simulation: TradeSimulation = {
      ...createPlannedCoveredCall({
        id: "nvda-p195-n-shifted-entry",
        status: "open",
        name: "NVDA P195 N short put",
        strategyType: "short_put",
        currentPriceUSD: 201.8,
        fxRateJPY: 0,
        referenceFxRateJPY: 0,
        entryDate: "2026-06-24",
        expiryDate: "2026-07-24",
        dte: 0,
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
          },
        ],
        optionEntryExecutions: [
          {
            id: "confirmed-entry",
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
      }),
    };

    const display = calculateDashboardPremiumDisplay(simulation);

    expect(display.dte).toBe(31);
    expect(display.annualReturnPct).toBeCloseTo(35.5, 1);
  });

  it("shows planned long calls as paid premium with maximum loss and breakeven instead of premium annual return", () => {
    const simulation: TradeSimulation = {
      ...createPlannedCoveredCall({
        id: "v-c335-long-call",
        status: "planned",
        name: "V C335 long call",
        ticker: "V",
        underlyingName: "Visa Inc.",
        strategyType: "long_call",
        currentPriceUSD: 336,
        fxRateJPY: 161.65,
        referenceFxRateJPY: 161.65,
        entryDate: "2026-06-29",
        expiryDate: "2026-11-20",
        dte: 144,
        stockPosition: null,
        denominatorMode: "custom",
        optionLegs: [
          {
            id: "call-leg",
            type: "call",
            side: "buy",
            strikeUSD: 335,
            premiumUSD: 22,
            quantity: 1,
            expiryDate: "2026-11-20",
          },
        ],
        brokerCommissionUSD: 2.25,
      }),
    };

    const display = calculateDashboardPremiumDisplay(simulation);

    expect(display.basis).toBe("planned");
    expect(display.premiumDirection).toBe("paid");
    expect(display.label).toBe("支払予定プレミアム");
    expect(display.primaryAmountLabel).toBe("支払予定額");
    expect(display.denominatorLabel).toBe("最大損失 / 支払額");
    expect(display.annualReturnLabel).toBe("出口ライン確認");
    expect(display.annualReturnPct).toBeUndefined();
    expect(display.netAnnualReturnPct).toBeUndefined();
    expect(display.premiumUSD).toBeCloseTo(-2_200, 8);
    expect(display.premiumJPY).toBeCloseTo(-355_630, 8);
    expect(display.netAfterFeesUSD).toBeCloseTo(-2_202.25, 8);
    expect(display.netAfterFeesJPY).toBeCloseTo(-355_993.7125, 8);
    expect(display.longOptionOrderDisplay?.paidPremiumJPY).toBeCloseTo(355_630, 8);
    expect(display.longOptionOrderDisplay?.totalCostJPY).toBeCloseTo(355_993.7125, 8);
    expect(display.longOptionOrderDisplay?.maximumLossJPY).toBeCloseTo(355_993.7125, 8);
    expect(display.longOptionOrderDisplay?.breakevenUSD).toBeCloseTo(357.0225, 8);
    expect(display.longOptionOrderDisplay?.currentPriceUSD).toBe(336);
    expect(display.longOptionOrderDisplay?.strikeUSD).toBe(335);
    expect(display.dte).toBe(144);
  });
});
