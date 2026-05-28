import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import { generateRiskWarnings } from "./riskRules";

describe("risk rules", () => {
  it("blocks avoid-put trades without stop, profit take, and close deadline", () => {
    const sim = {
      ...sampleAmznSimulation,
      optionLegs: sampleAmznSimulation.optionLegs.map((leg) =>
        leg.type === "put" ? { ...leg, putIntent: "cannot_buy" as const } : leg,
      ),
      profitTakeRule: { enabled: false, targetPremiumKeepPercent: 60 },
      stopLossRule: { enabled: false, type: "option_buyback_price" as const, value: 10 },
    };

    const warnings = generateRiskWarnings(sim);
    expect(warnings.some((warning) => warning.id === "avoid-put-no-stop" && warning.blocking)).toBe(true);
    expect(warnings.some((warning) => warning.id === "avoid-put-no-profit-take" && warning.blocking)).toBe(true);
    expect(warnings.some((warning) => warning.id === "avoid-put-no-close-deadline" && warning.blocking)).toBe(true);
  });

  it("blocks avoid-put trades when stop rule is enabled but empty", () => {
    const sim = {
      ...sampleAmznSimulation,
      optionLegs: sampleAmznSimulation.optionLegs.map((leg) =>
        leg.type === "put" ? { ...leg, putIntent: "avoid_assignment" as const } : leg,
      ),
      profitTakeRule: { enabled: true, targetPremiumKeepPercent: 60, latestCloseDaysBeforeExpiry: 7 },
      stopLossRule: { enabled: true, type: "option_buyback_price" as const, value: 0 },
    };

    const warnings = generateRiskWarnings(sim);
    expect(warnings.some((warning) => warning.id === "avoid-put-empty-stop-value" && warning.blocking)).toBe(true);
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
});
