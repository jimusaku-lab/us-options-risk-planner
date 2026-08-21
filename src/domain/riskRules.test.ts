import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import { generateRiskWarnings } from "./riskRules";

describe("risk rules", () => {
  it("aggregates missing exit rules into one blocking warning before entry", () => {
    const sim = {
      ...sampleAmznSimulation,
      optionLegs: sampleAmznSimulation.optionLegs.map((leg) =>
        leg.type === "put" ? { ...leg, putIntent: "cannot_buy" as const } : leg,
      ),
      profitTakeRule: { enabled: false, targetPremiumKeepPercent: 60 },
      stopLossRule: { enabled: false, type: "option_buyback_price" as const, value: 10 },
    };

    const warnings = generateRiskWarnings(sim);
    const exitWarning = warnings.find((warning) => warning.id === "avoid-put-exit-rule-missing");
    expect(exitWarning).toMatchObject({
      severity: "danger",
      blocking: true,
      actionLabel: "出口ルールを設定",
      actionAnchorId: `exit-rule-${sim.optionLegs.find((leg) => leg.type === "put")?.id}`,
    });
    expect(exitWarning?.message).toContain("利確ルール");
    expect(exitWarning?.message).toContain("損切りルール");
    expect(exitWarning?.message).toContain("満期前判断期限");
    expect(warnings.filter((warning) => warning.id.startsWith("avoid-put-")).length).toBe(1);
  });

  it("lists an enabled but valueless stop loss within the same warning", () => {
    const sim = {
      ...sampleAmznSimulation,
      optionLegs: sampleAmznSimulation.optionLegs.map((leg) =>
        leg.type === "put" ? { ...leg, putIntent: "avoid_assignment" as const } : leg,
      ),
      profitTakeRule: { enabled: true, targetPremiumKeepPercent: 60, latestCloseDaysBeforeExpiry: 7 },
      stopLossRule: { enabled: true, type: "option_buyback_price" as const, value: 0 },
    };

    const warnings = generateRiskWarnings(sim);
    const exitWarning = warnings.find((warning) => warning.id === "avoid-put-exit-rule-missing");
    expect(exitWarning).toMatchObject({ severity: "danger", blocking: true });
    expect(exitWarning?.message).toContain("損切りラインの値");
  });

  it("keeps missing avoid-put exit rules nonblocking while open and hides them after completion", () => {
    const avoidPut = {
      ...sampleAmznSimulation,
      optionLegs: sampleAmznSimulation.optionLegs.map((leg) =>
        leg.type === "put" ? { ...leg, putIntent: "avoid_assignment" as const } : leg,
      ),
      profitTakeRule: { enabled: false, targetPremiumKeepPercent: 60 },
      stopLossRule: { enabled: false, type: "option_buyback_price" as const, value: 0 },
    };

    const openWarning = generateRiskWarnings({ ...avoidPut, status: "open" }).find((warning) => warning.id === "avoid-put-exit-rule-missing");
    expect(openWarning).toMatchObject({ severity: "warning", blocking: false });

    for (const status of ["closed", "assigned", "expired"] as const) {
      expect(generateRiskWarnings({ ...avoidPut, status }).some((warning) => warning.id.startsWith("avoid-put-exit-rule-missing"))).toBe(false);
    }
  });

  it("does not require exit rules for a put that may be assigned", () => {
    const sim = {
      ...sampleAmznSimulation,
      optionLegs: sampleAmznSimulation.optionLegs.map((leg) =>
        leg.type === "put" ? { ...leg, putIntent: "want_to_buy" as const } : leg,
      ),
    };

    expect(generateRiskWarnings(sim).some((warning) => warning.id.startsWith("avoid-put-exit-rule-missing"))).toBe(false);
  });

  it("blocks uncovered calls in beginner mode", () => {
    const sim = {
      ...sampleAmznSimulation,
      stockPosition: { ...sampleAmznSimulation.stockPosition!, shares: 0 },
      beginnerMode: true,
    };

    const warnings = generateRiskWarnings(sim);
    expect(warnings.some((warning) => warning.id === "uncovered-call" && warning.blocking)).toBe(true);
  });

  it("never turns an account-level margin usage value into a position warning", () => {
    const warnings = generateRiskWarnings({ ...sampleAmznSimulation, marginUsagePercent: 75 });
    expect(warnings.some((warning) => warning.id === "high-margin-usage")).toBe(false);
    expect(warnings.some((warning) => warning.id === "put-assignment-cash-shortage")).toBe(true);
  });
});
