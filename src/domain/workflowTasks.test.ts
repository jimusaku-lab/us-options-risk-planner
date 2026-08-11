import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import type { TradeSimulation } from "@/types/domain";
import { getPrimaryWorkflowTask } from "./workflowTasks";

const callLeg = sampleAmznSimulation.optionLegs.find((leg) => leg.type === "call")!;
const putLeg = sampleAmznSimulation.optionLegs.find((leg) => leg.type === "put")!;

function createOpenSimulation(patch: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    ...sampleAmznSimulation,
    status: "open",
    optionEntryExecutions: [
      {
        id: "entry-put",
        legId: putLeg.id,
        tradeDate: sampleAmznSimulation.entryDate,
        contracts: putLeg.quantity,
        fillPriceUSD: putLeg.premiumUSD,
        settlementCurrency: "JPY",
        brokerPremiumJPY: 22_260,
        brokerTransactionCostJPY: 384,
        source: "manual",
        confirmed: true,
      },
      {
        id: "entry-call",
        legId: callLeg.id,
        tradeDate: sampleAmznSimulation.entryDate,
        contracts: callLeg.quantity,
        fillPriceUSD: callLeg.premiumUSD,
        settlementCurrency: "JPY",
        brokerPremiumJPY: 48_336,
        brokerTransactionCostJPY: 384,
        source: "manual",
        confirmed: true,
      },
    ],
    ...patch,
  };
}

function createOpenShortPutSimulation(patch: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    ...createOpenSimulation(),
    strategyType: "short_put",
    optionLegs: [putLeg],
    optionEntryExecutions: [
      {
        id: "entry-put",
        legId: putLeg.id,
        tradeDate: sampleAmznSimulation.entryDate,
        contracts: putLeg.quantity,
        fillPriceUSD: putLeg.premiumUSD,
        settlementCurrency: "JPY",
        brokerPremiumJPY: 22_260,
        brokerTransactionCostJPY: 384,
        source: "manual",
        confirmed: true,
      },
    ],
    ...patch,
  };
}

describe("workflow tasks", () => {
  it("shows order review for planned positions", () => {
    expect(getPrimaryWorkflowTask(sampleAmznSimulation).label).toBe("注文内容を確認");
  });

  it("shows entry confirmation while open entry executions are unconfirmed", () => {
    const sim = createOpenSimulation({
      optionEntryExecutions: [
        {
          id: "entry-put",
          legId: putLeg.id,
          tradeDate: sampleAmznSimulation.entryDate,
          contracts: putLeg.quantity,
          fillPriceUSD: putLeg.premiumUSD,
          settlementCurrency: "JPY",
          source: "manual",
          confirmed: false,
        },
      ],
    });

    expect(getPrimaryWorkflowTask(sim).label).toBe("約定確認へ");
  });

  it("shows close decision after entry confirmation is complete", () => {
    expect(getPrimaryWorkflowTask(createOpenSimulation()).label).toBe("反対売買判断");
  });

  it("uses sell-to-close guidance as the primary task for open long options", () => {
    const longCallLeg = {
      ...callLeg,
      id: "long-call",
      side: "buy" as const,
      isCovered: false,
    };
    const sim = createOpenSimulation({
      strategyType: "long_call",
      optionLegs: [longCallLeg],
      optionEntryExecutions: [
        {
          id: "entry-long-call",
          legId: longCallLeg.id,
          tradeDate: sampleAmznSimulation.entryDate,
          contracts: longCallLeg.quantity,
          fillPriceUSD: longCallLeg.premiumUSD,
          settlementCurrency: "JPY",
          source: "manual",
          confirmed: true,
        },
      ],
    });

    const task = getPrimaryWorkflowTask(sim);
    expect(task.label).toBe("反対売買で決済");
    expect(task.detail).toContain("満期前に反対売買で決済");
    expect(task.focusField).toBe("close-decision-call-long-call");
  });

  it("does not offer a second status-change task when a full close is confirmed", () => {
    const sim = createOpenSimulation({
      optionCloseExecutions: [
        {
          id: "close-put",
          legId: putLeg.id,
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

    expect(getPrimaryWorkflowTask(sim).label).not.toBe("決済済みに変更");
  });

  it("keeps buyback close execution drafts as confirmation tasks", () => {
    const sim = createOpenSimulation({
      optionCloseExecutions: [
        {
          id: "close-put",
          legId: putLeg.id,
          closeKind: "buyback",
          confirmed: false,
          closeDate: "2026-06-02",
          contracts: 1,
          closePriceUSD: 0.13,
          settlementCurrency: "JPY",
          brokerRealizedPnlJPY: 15_491,
          source: "manual",
        },
      ],
    });

    expect(getPrimaryWorkflowTask(sim).label).toBe("決済実績を確認");
  });

  it("shows the remaining quantity rather than a second expiry status-change task", () => {
    const sim = createOpenSimulation({
      optionCloseExecutions: [
        {
          id: "expire-put",
          legId: putLeg.id,
          closeKind: "expired",
          confirmed: true,
          closeDate: sampleAmznSimulation.expiryDate,
          contracts: 1,
          settlementCurrency: "JPY",
          source: "manual",
        },
      ],
    });

    expect(getPrimaryWorkflowTask(sim).label).toBe("一部決済済み");
  });

  it("asks for stock acquisition when an assigned short put has no stock acquisition", () => {
    const sim = createOpenShortPutSimulation({
      status: "assigned",
      optionCloseExecutions: [],
      stockAcquisition: undefined,
    });

    expect(getPrimaryWorkflowTask(sim).label).toBe("株式取得を記録");
  });

  it("marks assigned short put complete when stock acquisition is entered", () => {
    const sim = createOpenShortPutSimulation({
      status: "assigned",
      optionCloseExecutions: [],
      stockAcquisition: {
        enabled: true,
        acquisitionDate: "2026-06-12",
        shares: 100,
        priceUSD: 207.5,
        accountEnvironment: "PROD_P_JPY_SETTLEMENT",
        source: "saxo_history",
      },
    });

    expect(getPrimaryWorkflowTask(sim).label).toBe("入力完了");
  });
});
