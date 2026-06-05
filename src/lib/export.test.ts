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
});
