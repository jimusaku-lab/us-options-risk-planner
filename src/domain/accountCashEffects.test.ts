import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import type { AccountInputs } from "@/store/useOptionsStore";
import type { TradeSimulation } from "@/types/domain";
import { calculatePendingAccountCashEffects } from "./accountCashEffects";
import { sanitizeSaxoHistoryCloseExecutions } from "./optionCloseExecutions";
import { calculateYearlyPerformanceSummary } from "./yearlyPerformance";

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
        confirmed: true,
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
  it("suppresses a close after a later same-account Saxo cash snapshot without changing performance", () => {
    const simulation = createClosedPutSimulation();
    const withLaterSaxoCash = { ...baseAccountInputs, P: { ...baseAccountInputs.P, saxoSyncHistory: [{ id: "anonymous-next-day", source: "saxo_api" as const, accountKey: "anonymous", fetchedAt: "2026-06-03T01:00:00.000Z", appliedAt: "2026-06-03T01:00:00.000Z", appliedFields: ["cashBalance"] }] } };
    const before = calculateYearlyPerformanceSummary([simulation], 2026);
    expect(calculatePendingAccountCashEffects([simulation], withLaterSaxoCash)).toEqual([]);
    expect(calculateYearlyPerformanceSummary([simulation], 2026)).toEqual(before);
  });
  it("keeps manual apply for older, other-account, or non-cash snapshots", () => {
    const variants: AccountInputs[] = [
      { ...baseAccountInputs, P: { ...baseAccountInputs.P, saxoSyncHistory: [{ id: "before", source: "saxo_api", accountKey: "anonymous", fetchedAt: "2026-06-01T01:00:00.000Z", appliedAt: "2026-06-01T01:00:00.000Z", appliedFields: ["cashBalance"] }] } },
      { ...baseAccountInputs, N: { ...baseAccountInputs.N, saxoSyncHistory: [{ id: "other", source: "saxo_api", accountKey: "anonymous", fetchedAt: "2026-06-03T01:00:00.000Z", appliedAt: "2026-06-03T01:00:00.000Z", appliedFields: ["cashBalance"] }] } },
      { ...baseAccountInputs, P: { ...baseAccountInputs.P, saxoSyncHistory: [{ id: "margin-only", source: "saxo_api", accountKey: "anonymous", fetchedAt: "2026-06-03T01:00:00.000Z", appliedAt: "2026-06-03T01:00:00.000Z", appliedFields: ["marginAvailable"] }] } },
    ];
    variants.forEach((accountInputs) => expect(calculatePendingAccountCashEffects([createClosedPutSimulation()], accountInputs)[0]).toMatchObject({ coverage: "manual_apply", canApply: true }));
  });
  it("blocks manual apply when the Saxo cash snapshot is on the close date", () => {
    const accountInputs: AccountInputs = { ...baseAccountInputs, P: { ...baseAccountInputs.P, saxoSyncHistory: [{ id: "same-day", source: "saxo_api", accountKey: "anonymous", fetchedAt: "2026-06-02T01:00:00.000Z", appliedAt: "2026-06-02T01:00:00.000Z", appliedFields: ["cashBalance"] }] } };
    expect(calculatePendingAccountCashEffects([createClosedPutSimulation()], accountInputs)[0]).toMatchObject({ coverage: "same_day_uncertain", canApply: false });
  });
  it("does not duplicate a close cash effect when a legacy open record is normalized on reload", () => {
    const normalized = sanitizeSaxoHistoryCloseExecutions(createClosedPutSimulation({ status: "open" }));
    expect(normalized.status).toBe("closed");
    expect(normalized.optionCloseExecutions).toHaveLength(1);
    expect(calculatePendingAccountCashEffects([normalized], baseAccountInputs)).toHaveLength(1);
    expect(calculatePendingAccountCashEffects([sanitizeSaxoHistoryCloseExecutions(normalized)], baseAccountInputs)).toHaveLength(1);
  });
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
          confirmed: true,
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
