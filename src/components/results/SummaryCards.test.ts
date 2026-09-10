import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { AccountInputs } from "@/store/useOptionsStore";
import type { TradeSimulation } from "@/types/domain";
import { calculateCurrentPositionEstimate } from "@/domain/currentPositionEstimate";
import { buildPutAssignmentFundingNote, SummaryCards } from "./SummaryCards";

afterEach(() => cleanup());

function createShortPutSimulation(overrides: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    id: "nvda-p195",
    status: "open",
    name: "NVDA P195",
    ticker: "NVDA",
    strategyType: "short_put",
    currentPriceUSD: 202,
    fxRateJPY: 160,
    referenceFxRateJPY: 160,
    accountCode: "N",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    entryDate: "2026-06-23",
    expiryDate: "2026-07-10",
    dte: 17,
    accountCurrency: "USD",
    stockPosition: null,
    optionLegs: [
      {
        id: "put-leg",
        type: "put",
        side: "sell",
        strikeUSD: 195,
        premiumUSD: 1,
        quantity: 1,
        expiryDate: "2026-07-10",
      },
    ],
    brokerMarginJPY: 0,
    brokerMarginUSD: 0,
    marginBufferMultiplier: 1,
    marginUsagePercent: 0,
    denominatorMode: "cash_secured",
    profitTakeRule: { enabled: false, targetPremiumKeepPercent: 60 },
    stopLossRule: { enabled: false, type: "option_buyback_price", value: 0 },
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    nisaExpectedAnnualReturnPct: 9,
    beginnerMode: false,
    ...overrides,
  };
}

function createAccountInputs(overrides: Partial<AccountInputs> = {}): AccountInputs {
  return {
    P: {
      accountCode: "P",
      accountEnvironment: "PROD_P_JPY_SETTLEMENT",
      currency: "JPY",
      cashBalance: 0,
      marginAvailable: 0,
      marginUsagePercent: 0,
      updatedAt: "2026-07-02",
    },
    N: {
      accountCode: "N",
      accountEnvironment: "PROD_N_USD_SETTLEMENT",
      currency: "USD",
      cashBalance: 20_953.74,
      marginAvailable: 0,
      marginUsagePercent: 0,
      updatedAt: "2026-07-02",
    },
    ...overrides,
  };
}

function createLongCallSimulation(overrides: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    ...createShortPutSimulation({
      id: "long-call",
      name: "ABC C100",
      ticker: "ABC",
      strategyType: "long_call",
      entryDate: "2026-08-01",
      expiryDate: "2026-12-18",
      dte: 139,
      optionLegs: [{ id: "call-leg", type: "call", side: "buy", strikeUSD: 100, premiumUSD: 7.9, quantity: 1, expiryDate: "2026-12-18", closeCostUSD: 7.7, closePlan: { enabled: true, commissionUSD: 2.24, commissionSource: "manual" } }],
      optionEntryExecutions: [{ id: "entry-call", legId: "call-leg", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 7.9, settlementCurrency: "USD", commissionUSD: 2.24, source: "manual", confirmed: true }],
    }),
    ...overrides,
  };
}

describe("buildPutAssignmentFundingNote", () => {
  it("uses N account USD cash directly and shows sufficient funding with surplus", () => {
    const note = buildPutAssignmentFundingNote(
      createShortPutSimulation({ availableCashJPY: undefined }),
      3_120_000,
      19_500,
      createAccountInputs(),
    );

    expect(note).toContain("資金確認: 充足");
    expect(note).toBe("P195 × 100株。資金確認: 充足。N口座USD現金 $20,953.74 / 余裕 $1,453.74。");
  });

  it("uses N account USD cash balance even when buying power is lower", () => {
    const note = buildPutAssignmentFundingNote(
      createShortPutSimulation({ availableCashJPY: undefined }),
      3_120_000,
      19_500,
      createAccountInputs({
        N: {
          accountCode: "N",
          accountEnvironment: "PROD_N_USD_SETTLEMENT",
          currency: "USD",
          cashBalance: 20_953.74,
          buyingPower: 18_000,
          marginAvailable: 0,
          marginUsagePercent: 0,
          updatedAt: "2026-07-02",
        },
      }),
    );

    expect(note).toContain("資金確認: 充足");
    expect(note).toContain("N口座USD現金 $20,953.74 / 余裕 $1,453.74");
  });

  it("uses P account JPY cash for P account puts", () => {
    const note = buildPutAssignmentFundingNote(
      createShortPutSimulation({
        accountCode: "P",
        accountEnvironment: "PROD_P_JPY_SETTLEMENT",
        accountCurrency: "JPY",
        availableCashJPY: undefined,
      }),
      3_120_000,
      19_500,
      createAccountInputs({
        P: {
          accountCode: "P",
          accountEnvironment: "PROD_P_JPY_SETTLEMENT",
          currency: "JPY",
          cashBalance: 3_500_000,
          buyingPower: 3_500_000,
          marginAvailable: 0,
          marginUsagePercent: 0,
          updatedAt: "2026-07-02",
        },
      }),
    );

    expect(note).toContain("資金確認: 充足");
    expect(note).toContain("P口座JPY現金 3,500,000円 / 余裕 380,000円");
  });
});

describe("SummaryCards current price and strike comparison", () => {
  const primaryDenominator = {
    mode: "cash_secured" as const,
    label: "証拠金",
    currency: "USD" as const,
    amountJPY: 16_000,
    amountUSD: 100,
    annualReturnPct: 10,
    isPrimary: true,
    explanation: "fixture",
    components: [],
  };
  const taxResult = {
    grossProfitJPY: 0,
    feeAdjustedProfitJPY: 0,
    taxableProfitJPY: 0,
    taxJPY: 0,
    netProfitJPY: 0,
    grossAnnualReturnPct: 0,
    netAnnualReturnPct: 0,
    netMonthlyReturnPct: 0,
    requiresUserConfirmation: false,
  };

  it("does not duplicate the focused row price and strike comparison in the summary", () => {
    const simulation = createShortPutSimulation({ currentPriceUSD: 200 });
    render(createElement(SummaryCards, { simulation, primaryDenominator, taxResult, blockingCount: 0 }));

    expect(screen.queryByText("現在株価 / 権利行使価格")).toBeNull();
  });

  it("does not add a second missing-price prompt to the summary", () => {
    const simulation = createShortPutSimulation({ currentPriceUSD: 0 });
    render(createElement(SummaryCards, { simulation, primaryDenominator, taxResult, blockingCount: 0 }));

    expect(screen.queryByText("現在株価 未取得")).toBeNull();
    expect(screen.queryByText("現在株価 $0.00")).toBeNull();
  });
});

describe("SummaryCards payment-first long option summary", () => {
  const primaryDenominator = { mode: "cash_secured" as const, label: "証拠金", currency: "USD" as const, amountJPY: 16_000, amountUSD: 100, annualReturnPct: 10, isPrimary: true, explanation: "fixture", components: [] };
  const taxResult = { grossProfitJPY: 0, feeAdjustedProfitJPY: 0, taxableProfitJPY: 0, taxJPY: 0, netProfitJPY: 0, grossAnnualReturnPct: 0, netAnnualReturnPct: 0, netMonthlyReturnPct: 0, requiresUserConfirmation: false };

  it("places the entry payment, current sale proceeds, and difference side by side", () => {
    const simulation = createLongCallSimulation();
    const estimate = calculateCurrentPositionEstimate(simulation, new Date("2026-08-11T00:00:00Z"));
    render(createElement(SummaryCards, { simulation, primaryDenominator, taxResult, blockingCount: 0, currentEstimate: estimate }));
    expect(screen.getByRole("region", { name: "この建玉のお金" })).toBeTruthy();
    expect(screen.getByText("支払プレミアム $790.00")).toBeTruthy();
    expect(screen.getByText(/購入時手数料 \$2.24 \/ 支払総額 \$792.24/)).toBeTruthy();
    expect(screen.getByText("売却受取見込み $767.76")).toBeTruthy();
    expect(screen.getByText("概算損益 $-24.48")).toBeTruthy();
    expect(screen.getByText("価格・出口ルール")).toBeTruthy();
  });
});
