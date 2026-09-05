import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import type { TradeSimulation } from "@/types/domain";
import { getPrimaryWorkflowTask, getWorkflowTasks } from "./workflowTasks";

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

  it("does not offer a second status-change task when a full buyback close is confirmed", () => {
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

  it("does not offer a second expiry status-change task when an expiry execution is confirmed", () => {
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

    expect(getPrimaryWorkflowTask(sim).label).toBe("残存脚を反対売買判断");
  });

  it("routes a partially closed synthetic to the remaining P sell close decision", () => {
    const call = { ...callLeg, id: "call-closed", type: "call" as const, side: "buy" as const, quantity: 1 };
    const put = { ...putLeg, id: "put-open", type: "put" as const, side: "sell" as const, quantity: 1 };
    const sim = createOpenSimulation({
      strategyType: "synthetic_forward",
      optionLegs: [call, put],
      optionEntryExecutions: [
        { ...createOpenSimulation().optionEntryExecutions![0], legId: call.id },
        { ...createOpenSimulation().optionEntryExecutions![1], legId: put.id },
      ],
      optionCloseExecutions: [{ id: "close-call", legId: call.id, closeKind: "buyback", confirmed: true, closeDate: "2026-06-02", contracts: 1, settlementCurrency: "JPY", source: "manual" }],
    });
    expect(getPrimaryWorkflowTask(sim)).toMatchObject({ label: "P売りを反対売買判断", targetAnchor: "close-decision", focusField: "close-decision-put-put-open" });
  });

  it("routes a partially closed synthetic to the remaining C buy close decision", () => {
    const call = { ...callLeg, id: "call-open", type: "call" as const, side: "buy" as const, quantity: 1 };
    const put = { ...putLeg, id: "put-closed", type: "put" as const, side: "sell" as const, quantity: 1 };
    const sim = createOpenSimulation({
      strategyType: "synthetic_forward",
      optionLegs: [call, put],
      optionEntryExecutions: [
        { ...createOpenSimulation().optionEntryExecutions![0], legId: call.id },
        { ...createOpenSimulation().optionEntryExecutions![1], legId: put.id },
      ],
      optionCloseExecutions: [{ id: "close-put", legId: put.id, closeKind: "buyback", confirmed: true, closeDate: "2026-06-02", contracts: 1, settlementCurrency: "JPY", source: "manual" }],
    });
    expect(getPrimaryWorkflowTask(sim)).toMatchObject({ label: "C買いを反対売買で決済", targetAnchor: "close-decision", focusField: "close-decision-call-call-open" });
  });

  it("keeps each remaining leg reachable and prioritizes drafts or invalid quantities", () => {
    const sim = createOpenSimulation({
      optionLegs: [{ ...putLeg, id: "two-put", quantity: 2 }],
      optionEntryExecutions: [{ ...createOpenSimulation().optionEntryExecutions![0], legId: "two-put", contracts: 2 }],
      optionCloseExecutions: [{ id: "first", legId: "two-put", closeKind: "buyback", confirmed: true, closeDate: "2026-06-02", contracts: 1, settlementCurrency: "JPY", source: "manual" }],
    });
    expect(getWorkflowTasks(sim)[0]).toMatchObject({ label: "P売りを反対売買判断", detail: expect.stringContaining("残り1枚") });
    const draft = { ...sim, optionCloseExecutions: [...sim.optionCloseExecutions!, { id: "draft", legId: "two-put", closeKind: "buyback" as const, confirmed: false, closeDate: "2026-06-03", contracts: 1, settlementCurrency: "JPY" as const, source: "manual" as const }] };
    expect(getPrimaryWorkflowTask(draft).label).toBe("決済実績を確認");
    expect(getPrimaryWorkflowTask({ ...sim, optionCloseExecutions: [{ ...sim.optionCloseExecutions![0], contracts: 3 }] }).label).toBe("決済数量を確認");
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
