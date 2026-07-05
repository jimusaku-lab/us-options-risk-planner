import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import { getPrimaryWorkflowTask } from "@/domain/workflowTasks";
import { exportSimulationsCsv, exportWorkspaceJson, parseWorkspaceJson } from "./export";

describe("position export", () => {
  it("exports Japanese labels in CSV", () => {
    const csv = exportSimulationsCsv([sampleAmznSimulation]);

    expect(csv).toContain("カバードコール＋追加P売り");
    expect(csv).toContain("注文前");
    expect(csv).not.toContain("covered_call_plus_short_put");
  });

  it("round trips workspace JSON", () => {
    const simulationWithExecution = {
      ...sampleAmznSimulation,
      optionCloseExecutions: [
        {
          id: "close-json",
          legId: sampleAmznSimulation.optionLegs[0].id,
          confirmed: true,
          closeDate: "2026-06-02",
          contracts: 1,
          closePriceUSD: 0.17,
          commissionUSD: 2.25,
          fxRateJPY: 150,
          settlementCurrency: "JPY" as const,
          source: "manual" as const,
          orderId: "order-1",
        },
      ],
    };
    const json = exportWorkspaceJson({
      workspace: "demo",
      simulations: [simulationWithExecution],
      exportedAt: "2026-05-28T00:00:00.000Z",
    });

    const parsed = parseWorkspaceJson(json);
    expect(parsed.simulations).toHaveLength(1);
    expect(parsed.simulations[0].id).toBe(sampleAmznSimulation.id);
    expect(parsed.simulations[0].accountEnvironment).toBe("DEMO_JPY_BASE");
    expect(parsed.simulations[0].optionCloseExecutions).toHaveLength(1);
    expect(parsed.simulations[0].optionCloseExecutions?.[0].orderId).toBe("order-1");
    expect(parsed.simulations[0].optionCloseExecutions?.[0].confirmed).toBe(true);
    expect(parsed.optionCloseExecutions).toHaveLength(1);
    expect(parsed.accountStates).toEqual([]);
    expect(parsed.wheelCycles).toEqual([]);
    expect(parsed.stockTransfers).toEqual([]);
  });

  it("keeps old JSON readable without converting closeCostUSD into executions", () => {
    const legacyJson = JSON.stringify({
      simulations: [
        {
          ...sampleAmznSimulation,
          optionCloseExecutions: undefined,
          optionLegs: sampleAmznSimulation.optionLegs.map((leg, index) => index === 0 ? { ...leg, closeCostUSD: 0.17 } : leg),
        },
      ],
    });

    const parsed = parseWorkspaceJson(legacyJson);
    expect(parsed.simulations[0].optionCloseExecutions).toEqual([]);
    expect(parsed.simulations[0].optionLegs[0].closeCostUSD).toBe(0.17);
  });

  it("migrates old close executions to drafts while positions are open", () => {
    const legacyJson = JSON.stringify({
      simulations: [
        {
          ...sampleAmznSimulation,
          status: "open",
          optionEntryExecutions: sampleAmznSimulation.optionLegs.map((leg) => ({
            id: `entry-${leg.id}`,
            legId: leg.id,
            tradeDate: sampleAmznSimulation.entryDate,
            contracts: leg.quantity,
            fillPriceUSD: leg.premiumUSD,
            settlementCurrency: "JPY",
            source: "manual",
            confirmed: true,
          })),
          optionCloseExecutions: [
            {
              id: "legacy-close-open",
              legId: sampleAmznSimulation.optionLegs[0].id,
              closeDate: "2026-06-02",
              contracts: 1,
              closePriceUSD: 0.17,
              settlementCurrency: "JPY",
              source: "manual",
            },
          ],
        },
      ],
    });

    const parsed = parseWorkspaceJson(legacyJson);
    expect(parsed.simulations[0].optionCloseExecutions?.[0].confirmed).toBe(false);
    expect(getPrimaryWorkflowTask(parsed.simulations[0]).label).toBe("決済実績を確認");
  });

  it("preserves old close executions as confirmed for ended positions", () => {
    const legacyJson = JSON.stringify({
      simulations: [
        {
          ...sampleAmznSimulation,
          status: "closed",
          optionCloseExecutions: [
            {
              id: "legacy-close-closed",
              legId: sampleAmznSimulation.optionLegs[0].id,
              closeDate: "2026-06-02",
              contracts: 1,
              closePriceUSD: 0.17,
              settlementCurrency: "JPY",
              source: "manual",
            },
          ],
        },
      ],
    });

    const parsed = parseWorkspaceJson(legacyJson);
    expect(parsed.simulations[0].optionCloseExecutions?.[0].confirmed).toBe(true);
  });

  it("round trips candidate review journal details without dangerous local fields", () => {
    const simulationWithJournal = {
      ...sampleAmznSimulation,
      entryRationaleJournal: {
        id: "journal-review",
        candidateId: "candidate-AMZN",
        positionId: sampleAmznSimulation.id,
        symbol: sampleAmznSimulation.ticker,
        underlyingName: sampleAmznSimulation.underlyingName,
        strategy: sampleAmznSimulation.strategyType,
        accountCode: "DEMO" as const,
        status: "planned" as const,
        entryDate: sampleAmznSimulation.entryDate,
        createdAt: "2026-07-05T00:00:00.000Z",
        updatedAt: "2026-07-05T01:00:00.000Z",
        entryReason: "候補レビュー: AMZN / カバードコール\n確認済み:\n- チャート根拠を確認した",
        technicalTags: ["候補レビュー確認", "レビュー準備"],
        technicalMemo: "チャート最終ゲート: pass",
        expectedScenario: "入力候補として確認可",
        profitTakingPlan: "",
        stopLossPlan: "",
        invalidationCondition: "",
        chartEvidence: [],
        review: { outcome: "not_reviewed" as const },
      },
    };
    const json = exportWorkspaceJson({
      workspace: "demo",
      simulations: [simulationWithJournal],
      exportedAt: "2026-07-05T00:00:00.000Z",
    });

    const parsed = parseWorkspaceJson(json);
    const serialized = JSON.stringify(parsed);

    expect(parsed.simulations[0].entryRationaleJournal?.entryReason).toContain("候補レビュー: AMZN / カバードコール");
    expect(parsed.simulations[0].entryRationaleJournal?.technicalTags).toContain("候補レビュー確認");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("accountId");
    expect(serialized).not.toContain("localPath");
    expect(serialized).not.toContain("apiKey");
  });
});
