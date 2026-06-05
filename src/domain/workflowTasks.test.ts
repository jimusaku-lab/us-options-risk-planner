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

  it("prioritizes marking closed when a buyback close execution is valid", () => {
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

    expect(getPrimaryWorkflowTask(sim).label).toBe("決済済みに変更");
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

  it("shows marking expired when an expiry execution is valid", () => {
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

    expect(getPrimaryWorkflowTask(sim).label).toBe("満期終了に変更");
  });
});
