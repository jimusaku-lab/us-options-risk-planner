import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import type { TradeSimulation } from "@/types/domain";
import {
  deriveSaxoHistoryRealizedPnlAutofill,
  sanitizeSaxoHistoryCloseExecutions,
  validateSaxoHistoryCloseExecution,
} from "./optionCloseExecutions";

const putLeg = sampleAmznSimulation.optionLegs.find((leg) => leg.type === "put") ?? sampleAmznSimulation.optionLegs[0];

function openPutSimulation(patch: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    ...sampleAmznSimulation,
    id: "sim-p200",
    status: "open",
    accountCode: "P",
    accountEnvironment: "PROD_P_JPY_SETTLEMENT",
    optionLegs: [
      {
        ...putLeg,
        id: "put-p200",
        type: "put",
        side: "sell",
        strikeUSD: 200,
        expiryDate: "2026-06-05",
        quantity: 1,
        premiumUSD: 1.16,
      },
    ],
    ...patch,
  };
}

describe("Saxo history close execution validation", () => {
  it("autofills deterministic N account short put close P/L from the shared calculation", () => {
    const simulation = openPutSimulation({
      accountCode: "N",
      accountEnvironment: "PROD_N_USD_SETTLEMENT",
      optionLegs: [
        {
          ...putLeg,
          id: "put-p195",
          type: "put",
          side: "sell",
          strikeUSD: 195,
          premiumUSD: 5.9,
          quantity: 1,
        },
      ],
      optionEntryExecutions: [
        {
          id: "entry-p195",
          legId: "put-p195",
          tradeDate: "2026-06-01",
          contracts: 1,
          fillPriceUSD: 5.9,
          settlementCurrency: "USD",
          commissionUSD: 2.25,
          source: "saxo_api_estimate",
          confirmed: true,
        },
      ],
    });

    const result = deriveSaxoHistoryRealizedPnlAutofill(simulation, {
      id: "close-p195",
      legId: "put-p195",
      closeKind: "buyback",
      confirmed: false,
      closeDate: "2026-06-10",
      contracts: 1,
      closePriceUSD: 0.75,
      commissionUSD: 2.25,
      settlementCurrency: "USD",
      source: "saxo_history",
      sourceTradeId: "history-p195-close",
      targetPositionId: simulation.id,
    });

    expect(result).toMatchObject({
      available: true,
      realizedPnlUSD: 510.5,
      derivation: {
        sourceTradeId: "history-p195-close",
        targetPositionId: simulation.id,
        entryPremiumUSD: 590,
        closePriceUSD: 0.75,
        openCommissionUSD: 2.25,
        closeCommissionUSD: 2.25,
      },
    });
  });

  it("leaves Saxo autofill empty when an allocation is not deterministic", () => {
    const simulation = openPutSimulation({
      accountCode: "N",
      accountEnvironment: "PROD_N_USD_SETTLEMENT",
      optionLegs: [{ ...putLeg, id: "put-p195", side: "sell", premiumUSD: 5.9, quantity: 2 }],
      optionEntryExecutions: [
        {
          id: "entry-p195",
          legId: "put-p195",
          tradeDate: "2026-06-01",
          contracts: 2,
          fillPriceUSD: 5.9,
          settlementCurrency: "USD",
          commissionUSD: 2.25,
          source: "saxo_api_estimate",
          confirmed: true,
        },
      ],
    });

    const result = deriveSaxoHistoryRealizedPnlAutofill(simulation, {
      id: "partial-close",
      legId: "put-p195",
      confirmed: false,
      closeDate: "2026-06-10",
      contracts: 1,
      closePriceUSD: 0.75,
      commissionUSD: 2.25,
      settlementCurrency: "USD",
      source: "saxo_history",
    });

    expect(result).toMatchObject({ available: false, missingFields: ["一部決済または数量配賦", "建玉時数量"] });
  });

  it("removes stale one-yen Saxo history placeholder drafts without touching confirmed history", () => {
    const simulation = openPutSimulation({
      optionCloseExecutions: [
        {
          id: "bad-draft",
          legId: "put-p200",
          closeKind: "buyback",
          confirmed: false,
          closeDate: "2026-06-02",
          contracts: 1,
          closePriceUSD: 0.13,
          settlementCurrency: "JPY",
          brokerRealizedPnlJPY: 1,
          brokerBookedAmountJPY: 1,
          source: "saxo_history",
          sourceTradeId: "hist-p200-close",
          targetPositionId: "sim-p200",
          confirmationStatus: "pending",
        },
        {
          id: "confirmed-manual",
          legId: "put-p200",
          closeKind: "buyback",
          confirmed: true,
          closeDate: "2026-06-02",
          contracts: 1,
          closePriceUSD: 0.13,
          settlementCurrency: "JPY",
          brokerRealizedPnlJPY: 1,
          brokerBookedAmountJPY: 1,
          source: "manual",
        },
      ],
    });

    const sanitized = sanitizeSaxoHistoryCloseExecutions(simulation);

    expect(sanitized.optionCloseExecutions?.map((execution) => execution.id)).toEqual(["confirmed-manual"]);
  });

  it("marks Saxo history close drafts invalid when their target simulation differs", () => {
    const simulation = openPutSimulation({
      optionCloseExecutions: [
        {
          id: "wrong-target",
          legId: "put-p200",
          closeKind: "buyback",
          confirmed: false,
          closeDate: "2026-06-02",
          contracts: 1,
          closePriceUSD: 0.13,
          settlementCurrency: "JPY",
          brokerRealizedPnlJPY: 15_491,
          source: "saxo_history",
          sourceTradeId: "hist-p200-close",
          targetPositionId: "other-simulation",
          confirmationStatus: "pending",
        },
      ],
    });

    const sanitized = sanitizeSaxoHistoryCloseExecutions(simulation);

    expect(sanitized.optionCloseExecutions?.[0]?.confirmationStatus).toBe("invalid");
    expect(sanitized.optionCloseExecutions?.[0]?.invalidReason).toContain("別の建玉");
  });

  it("does not validate Saxo close drafts without their source history id", () => {
    const validation = validateSaxoHistoryCloseExecution(openPutSimulation(), {
      id: "missing-source",
      legId: "put-p200",
      closeKind: "buyback",
      confirmed: false,
      closeDate: "2026-06-02",
      contracts: 1,
      closePriceUSD: 0.13,
      settlementCurrency: "JPY",
      brokerRealizedPnlJPY: 15_491,
      source: "saxo_history",
      confirmationStatus: "pending",
    });

    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain("Saxo履歴ID");
  });
});
