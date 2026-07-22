import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import type { TradeSimulation } from "@/types/domain";
import {
  applySaxoActualEntryCommission,
  calculateOptionEntryExecutionSummary,
  createOptionEntryExecutionDraft,
  ensureNOptionEntryStandardCommission,
  updateStandardEntryCommissionForContracts,
} from "./optionEntryExecutions";

function buildNOptionSimulation(quantity = 1): TradeSimulation {
  const putLeg = sampleAmznSimulation.optionLegs.find((leg) => leg.type === "put")!;
  return {
    ...sampleAmznSimulation,
    id: `n-option-${quantity}`,
    accountCode: "N",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    accountCurrency: "USD",
    optionLegs: [{ ...putLeg, id: "n-put", quantity }],
    optionEntryExecutions: [],
  };
}

describe("N-account option entry commission sources", () => {
  it("prefills the configurable standard USD fee per contract", () => {
    const simulation = buildNOptionSimulation(2);
    const draft = createOptionEntryExecutionDraft({ simulation, leg: simulation.optionLegs[0], standardCommissionUSD: 2.25 });
    expect(draft).toMatchObject({ commissionUSD: 4.5, commissionSource: "standard_default" });
  });

  it("only recalculates the standard fee when quantity changes", () => {
    const simulation = buildNOptionSimulation(1);
    const standardDraft = createOptionEntryExecutionDraft({ simulation, leg: simulation.optionLegs[0] });
    const manualDraft = { ...standardDraft, commissionUSD: 7.75, commissionSource: "manual" as const };
    expect(updateStandardEntryCommissionForContracts(standardDraft, 3)).toMatchObject({ contracts: 3, commissionUSD: 6.75, commissionSource: "standard_default" });
    expect(updateStandardEntryCommissionForContracts(manualDraft, 3)).toMatchObject({ contracts: 3, commissionUSD: 7.75, commissionSource: "manual" });
  });

  it("replaces only the standard fee with a Saxo actual fee", () => {
    const simulation = buildNOptionSimulation(1);
    const standardDraft = createOptionEntryExecutionDraft({ simulation, leg: simulation.optionLegs[0] });
    const manualDraft = { ...standardDraft, commissionUSD: 5, commissionSource: "manual" as const };
    expect(applySaxoActualEntryCommission(standardDraft, -3.1)).toMatchObject({ commissionUSD: 3.1, commissionSource: "saxo_actual" });
    expect(applySaxoActualEntryCommission(manualDraft, -3.1)).toMatchObject({ commissionUSD: 5, commissionSource: "manual" });
  });

  it("backfills only missing N-account draft fees and keeps P-account JPY entries unchanged", () => {
    const nSimulation = buildNOptionSimulation(2);
    const blankNEntry = { ...createOptionEntryExecutionDraft({ simulation: nSimulation, leg: nSimulation.optionLegs[0] }), commissionUSD: undefined, commissionSource: undefined };
    const pSimulation = { ...nSimulation, accountCode: "P" as const, accountEnvironment: "PROD_P_JPY_SETTLEMENT" as const, accountCurrency: "JPY" as const };
    const pEntry = { ...blankNEntry, settlementCurrency: "JPY" as const };
    expect(ensureNOptionEntryStandardCommission(nSimulation, blankNEntry)).toMatchObject({ commissionUSD: 4.5, commissionSource: "standard_default" });
    expect(ensureNOptionEntryStandardCommission(pSimulation, pEntry)).toEqual(pEntry);
  });

  it("uses both synthetic-forward leg fees in the common entry summary", () => {
    const simulation = buildNOptionSimulation(1);
    simulation.strategyType = "synthetic_forward";
    simulation.optionLegs = [
      { ...simulation.optionLegs[0], id: "call", type: "call", side: "buy", premiumUSD: 5 },
      { ...simulation.optionLegs[0], id: "put", type: "put", side: "sell", premiumUSD: 3 },
    ];
    simulation.optionEntryExecutions = simulation.optionLegs.map((leg) => createOptionEntryExecutionDraft({ simulation, leg }));
    expect(calculateOptionEntryExecutionSummary(simulation)).toMatchObject({ commissionUSD: 4.5, netPremiumUSD: -204.5 });
  });
});
