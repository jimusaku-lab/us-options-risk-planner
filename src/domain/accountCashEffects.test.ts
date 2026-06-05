import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import type { AccountInputs } from "@/store/useOptionsStore";
import type { TradeSimulation } from "@/types/domain";
import { calculatePendingAccountCashEffects } from "./accountCashEffects";

const baseAccountInputs: AccountInputs = {
  P: {
    accountCode: "P",
    accountEnvironment: "PROD_P_JPY_SETTLEMENT",
    currency: "JPY",
    cashBalance: 3_417_848,
    marginAvailable: 2_906_857,
    marginUsagePercent: 14.52,
    updatedAt: "2026-06-04T00:00:00.000Z",
  },
  N: {
    accountCode: "N",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    currency: "USD",
    cashBalance: 0,
    marginAvailable: 0,
    marginUsagePercent: 0,
    updatedAt: "2026-06-04T00:00:00.000Z",
  },
};

function createClosedPutSimulation(overrides?: Partial<TradeSimulation>): TradeSimulation {
  return {
    ...sampleAmznSimulation,
    id: "p-close-test",
    status: "closed",
    accountCode: "P",
    accountEnvironment: "PROD_P_JPY_SETTLEMENT",
    accountCurrency: "JPY",
    ticker: "NVDA",
    entryDate: "2026-05-27",
    expiryDate: "2026-06-05",
    fxRateJPY: 159.9745,
    optionLegs: [
      {
        id: "put-200",
        type: "put",
        side: "sell",
        strikeUSD: 200,
        premiumUSD: 1.16,
        quantity: 1,
        expiryDate: "2026-06-05",
        putIntent: "can_buy",
      },
    ],
    optionCloseExecutions: [
      {
        id: "close-put-200",
        legId: "put-200",
        closeKind: "buyback",
        closeDate: "2026-06-02",
        contracts: 1,
        closePriceUSD: 0.13,
        settlementCurrency: "JPY",
        brokerBookedAmountJPY: -2_461,
        brokerRealizedPnlJPY: 15_491,
        brokerTransactionCostJPY: 384,
        brokerExchangeRateJPY: 161.39194,
        source: "manual",
      },
    ],
    ...overrides,
  };
}

describe("account cash effects", () => {
  it("uses the P account broker booked amount for cash balance reflection, not realized P/L", () => {
    const [effect] = calculatePendingAccountCashEffects([createClosedPutSimulation()], baseAccountInputs);

    expect(effect.accountCode).toBe("P");
    expect(effect.currency).toBe("JPY");
    expect(effect.amount).toBe(-2_461);
    expect(effect.amount).not.toBe(15_491);
    expect(effect.canApply).toBe(true);
    expect(effect.detail).toContain("実現損益JPYではありません");
  });

  it("does not show an already-applied close execution again", () => {
    const accountInputs: AccountInputs = {
      ...baseAccountInputs,
      P: {
        ...baseAccountInputs.P,
        cashAdjustments: [
          {
            id: "option-close-cash:p-close-test:close-put-200",
            sourceType: "option_close_execution",
            sourceSimulationId: "p-close-test",
            sourceExecutionId: "close-put-200",
            accountCode: "P",
            currency: "JPY",
            amount: -2_461,
            label: "NVDA P 200 2026-06-05",
            appliedAt: "2026-06-04T00:00:00.000Z",
          },
        ],
      },
    };

    expect(calculatePendingAccountCashEffects([createClosedPutSimulation()], accountInputs)).toEqual([]);
  });

  it("requires broker booked amount before applying a P account cash effect", () => {
    const simulation = createClosedPutSimulation({
      optionCloseExecutions: [
        {
          id: "close-put-200",
          legId: "put-200",
          closeKind: "buyback",
          closeDate: "2026-06-02",
          contracts: 1,
          closePriceUSD: 0.13,
          settlementCurrency: "JPY",
          brokerRealizedPnlJPY: 15_491,
          source: "manual",
        },
      ],
    });

    const [effect] = calculatePendingAccountCashEffects([simulation], baseAccountInputs);

    expect(effect.amount).toBeUndefined();
    expect(effect.canApply).toBe(false);
    expect(effect.missingReason).toContain("記帳額JPY");
  });
});
