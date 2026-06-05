import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import { createSimulationFromCandidate } from "@/domain/candidateConversion";
import { createOptionCloseExecutionDraft } from "@/domain/optionCloseExecutions";
import { createOptionEntryExecutionDraft } from "@/domain/optionEntryExecutions";

const putLeg = sampleAmznSimulation.optionLegs.find((leg) => leg.type === "put")!;

describe("date defaults", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the browser local date for new candidate positions without overwriting expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 5, 1, 30));

    const simulation = createSimulationFromCandidate({
      candidate: {
        id: "nvda",
        source: "manual",
        importedAt: "2026-05-01T00:00:00.000Z",
        rank: 1,
        symbol: "NVDA",
        company: "NVIDIA Corporation",
        priceUSD: 200,
        score: 80,
        suggestedUse: "short_put",
      },
      workspace: "live",
      settings: {
        beginnerMode: true,
        defaultMarginBufferMultiplier: 2,
        defaultNisaExpectedAnnualReturnPct: 9,
      },
      strategyType: "short_put",
      fxRateJPY: 160,
    });

    expect(simulation.entryDate).toBe("2026-06-05");
    expect(simulation.expiryDate).toBe("2026-07-20");
    expect(simulation.expiryDate).not.toBe(simulation.entryDate);
  });

  it("uses the browser local date for entry and close execution drafts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 5, 1, 30));

    const entry = createOptionEntryExecutionDraft({ simulation: sampleAmznSimulation, leg: putLeg });
    const close = createOptionCloseExecutionDraft({ simulation: sampleAmznSimulation, leg: putLeg, closeKind: "buyback" });
    const expired = createOptionCloseExecutionDraft({ simulation: sampleAmznSimulation, leg: putLeg, closeKind: "expired" });

    expect(entry.tradeDate).toBe("2026-06-05");
    expect(close.closeDate).toBe("2026-06-05");
    expect(expired.closeDate).toBe("2026-06-05");
    expect(close.confirmed).toBe(false);
    expect(expired.confirmed).toBe(false);
    expect(expired.closeDate).not.toBe(sampleAmznSimulation.expiryDate);
  });

  it("preserves broker-provided execution dates when supplied", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 5, 1, 30));

    const entry = createOptionEntryExecutionDraft({
      simulation: sampleAmznSimulation,
      leg: putLeg,
      tradeDate: "2026-06-02",
    });
    const close = createOptionCloseExecutionDraft({
      simulation: sampleAmznSimulation,
      leg: putLeg,
      closeDate: "2026-06-03",
      closeKind: "buyback",
    });

    expect(entry.tradeDate).toBe("2026-06-02");
    expect(close.closeDate).toBe("2026-06-03");
  });
});
