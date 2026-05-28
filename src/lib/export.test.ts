import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import { exportSimulationsCsv, exportWorkspaceJson, parseWorkspaceJson } from "./export";

describe("position export", () => {
  it("exports Japanese labels in CSV", () => {
    const csv = exportSimulationsCsv([sampleAmznSimulation]);

    expect(csv).toContain("カバードコール＋追加P売り");
    expect(csv).toContain("注文前");
    expect(csv).not.toContain("covered_call_plus_short_put");
  });

  it("round trips workspace JSON", () => {
    const json = exportWorkspaceJson({
      workspace: "demo",
      simulations: [sampleAmznSimulation],
      exportedAt: "2026-05-28T00:00:00.000Z",
    });

    const parsed = parseWorkspaceJson(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(sampleAmznSimulation.id);
  });
});
