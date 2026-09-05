import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import type { TradeSimulation } from "@/types/domain";
import {
  applySaxoActualEntryCommission,
  calculateOptionEntryExecutionSummary,
  createOptionEntryExecutionDraft,
  ensureNOptionEntryStandardCommission,
  migrateNOptionEntryStandardCommissions,
  needsOptionEntryConfirmation,
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
    const draft = createOptionEntryExecutionDraft({
      simulation,
      leg: simulation.optionLegs[0],
      standardCommissionUSD: 2.25,
    });

    expect(draft).toMatchObject({ commissionUSD: 4.5, commissionSource: "saxo_ticket_confirmed_standard" });
  });

  it("only recalculates the standard fee when quantity changes", () => {
    const simulation = buildNOptionSimulation(1);
    const standardDraft = createOptionEntryExecutionDraft({ simulation, leg: simulation.optionLegs[0] });
    const manualDraft = { ...standardDraft, commissionUSD: 7.75, commissionSource: "manual" as const };

    expect(updateStandardEntryCommissionForContracts(standardDraft, 3)).toMatchObject({ contracts: 3, commissionUSD: 6.72, commissionSource: "saxo_ticket_confirmed_standard" });
    expect(updateStandardEntryCommissionForContracts(manualDraft, 3)).toMatchObject({ contracts: 3, commissionUSD: 7.75, commissionSource: "manual" });
  });

  it("replaces only the standard fee with a Saxo actual fee", () => {
    const simulation = buildNOptionSimulation(1);
    const standardDraft = createOptionEntryExecutionDraft({ simulation, leg: simulation.optionLegs[0] });
    const manualDraft = { ...standardDraft, commissionUSD: 5, commissionSource: "manual" as const };

    expect(applySaxoActualEntryCommission(standardDraft, -3.1)).toMatchObject({ commissionUSD: 3.1, commissionSource: "saxo_actual" });
    expect(applySaxoActualEntryCommission(manualDraft, -3.1)).toMatchObject({ commissionUSD: 5, commissionSource: "manual" });
  });

  it("updates a legacy standard source on quantity change and still lets Saxo actual override it", () => {
    const simulation = buildNOptionSimulation(1);
    const legacy = { ...createOptionEntryExecutionDraft({ simulation, leg: simulation.optionLegs[0] }), commissionUSD: 2.25, commissionSource: "standard_default" as const };
    const resized = updateStandardEntryCommissionForContracts(legacy, 2);
    expect(resized).toMatchObject({ contracts: 2, commissionUSD: 4.48, commissionSource: "saxo_ticket_confirmed_standard" });
    expect(applySaxoActualEntryCommission(resized, -3.75)).toMatchObject({ commissionUSD: 3.75, commissionSource: "saxo_actual" });
  });

  it("backfills only missing N-account draft fees and keeps P-account JPY entries unchanged", () => {
    const nSimulation = buildNOptionSimulation(2);
    const blankNEntry = {
      ...createOptionEntryExecutionDraft({ simulation: nSimulation, leg: nSimulation.optionLegs[0] }),
      commissionUSD: undefined,
      commissionSource: undefined,
    };
    const pSimulation = { ...nSimulation, accountCode: "P" as const, accountEnvironment: "PROD_P_JPY_SETTLEMENT" as const, accountCurrency: "JPY" as const };
    const pEntry = { ...blankNEntry, settlementCurrency: "JPY" as const };

    expect(ensureNOptionEntryStandardCommission(nSimulation, blankNEntry)).toMatchObject({ commissionUSD: 4.48, commissionSource: "saxo_ticket_confirmed_standard" });
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

    expect(calculateOptionEntryExecutionSummary(simulation)).toMatchObject({ commissionUSD: 4.48, netPremiumUSD: -204.48 });
  });

  it("migrates only confirmed legacy standard entries and is idempotent", () => {
    const simulation = buildNOptionSimulation(1);
    simulation.optionEntryExecutions = [
      { id: "confirmed", legId: "n-put", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 2, commissionUSD: 2.25, commissionSource: "standard_default", settlementCurrency: "USD", source: "manual", confirmed: true },
      { id: "draft", legId: "n-put", tradeDate: "", contracts: 1, fillPriceUSD: 2, commissionUSD: 2.25, commissionSource: "standard_default", settlementCurrency: "USD", source: "manual", confirmed: false },
      { id: "manual", legId: "n-put", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 2, commissionUSD: 3, commissionSource: "manual", settlementCurrency: "USD", source: "manual", confirmed: true },
    ];
    const migrated = migrateNOptionEntryStandardCommissions(simulation);
    expect(migrated.optionEntryExecutions).toMatchObject([
      { id: "confirmed", commissionUSD: 2.24, commissionSource: "saxo_ticket_confirmed_standard" },
      { id: "draft", commissionUSD: 2.25, commissionSource: "standard_default" },
      { id: "manual", commissionUSD: 3, commissionSource: "manual" },
    ]);
    expect(migrateNOptionEntryStandardCommissions(migrated)).toBe(migrated);
  });
});

describe("entry confirmation coverage", () => {
  it("does not reopen a fully confirmed leg because a duplicate Saxo draft is present", () => {
    const simulation = buildNOptionSimulation(1);
    simulation.optionEntryExecutions = [
      { id: "official", legId: "n-put", tradeDate: "2026-08-12", canonicalTradeDate: "2026-08-12", contracts: 1, fillPriceUSD: 2, settlementCurrency: "USD", commissionUSD: 2.24, source: "saxo_api_estimate", confirmed: true },
      { id: "duplicate", legId: "n-put", tradeDate: "2026-08-11", sourceTradeDate: "2026-08-11", contracts: 1, fillPriceUSD: 2, settlementCurrency: "USD", commissionUSD: 2.24, source: "saxo_api_estimate", confirmed: false },
    ];
    expect(needsOptionEntryConfirmation(simulation)).toBe(false);
  });

  it("still requires confirmation for a real partial quantity", () => {
    const simulation = buildNOptionSimulation(2);
    simulation.optionEntryExecutions = [
      { id: "official-partial", legId: "n-put", tradeDate: "2026-08-12", contracts: 1, fillPriceUSD: 2, settlementCurrency: "USD", commissionUSD: 2.24, source: "saxo_api_estimate", confirmed: true },
    ];
    expect(needsOptionEntryConfirmation(simulation)).toBe(true);
  });
});

describe("P-account option entry fee semantics", () => {
  it("keeps transaction cost undefined when no direct fee evidence exists", () => {
    const simulation: TradeSimulation = {
      ...sampleAmznSimulation,
      id: "p-option-missing-fee",
      accountCode: "P",
      accountEnvironment: "PROD_P_JPY_SETTLEMENT",
      accountCurrency: "JPY",
      optionLegs: [
        {
          ...sampleAmznSimulation.optionLegs[0],
          id: "p-leg",
          type: "call",
          side: "buy",
          premiumUSD: 23.85,
          quantity: 1,
        },
      ],
      optionEntryExecutions: [
        {
          id: "p-entry",
          legId: "p-leg",
          tradeDate: "2026-08-12",
          contracts: 1,
          fillPriceUSD: 23.85,
          settlementCurrency: "JPY",
          brokerBookedAmountJPY: -383934,
          brokerPremiumJPY: -383574,
          brokerTransactionCostJPY: undefined,
          brokerFeeJPY: undefined,
          brokerExchangeFeeJPY: undefined,
          brokerTaxIncludedFeeJPY: undefined,
          brokerExchangeRateJPY: 160.827855,
          referenceFxRateJPY: 160.827855,
          inputMode: "P_JPY_BROKER_STATEMENT",
          source: "saxo_api_estimate",
          confirmed: false,
          memo: "",
        },
      ],
    };

    expect(calculateOptionEntryExecutionSummary(simulation)).toMatchObject({
      basis: "saxo_broker_statement",
      cashBookedAmountJPY: -383934,
      netPremiumJPY: -383934,
      grossPremiumJPY: -383574,
      cashTransactionCostJPY: undefined,
      transactionCostJPY: undefined,
    });
  });

  it("uses direct Saxo total transaction cost without re-adding cash or FX components", () => {
    const simulation: TradeSimulation = {
      ...sampleAmznSimulation,
      id: "p-option-total-cost",
      accountCode: "P",
      accountEnvironment: "PROD_P_JPY_SETTLEMENT",
      accountCurrency: "JPY",
      optionLegs: [
        {
          ...sampleAmznSimulation.optionLegs[0],
          id: "p-leg-total",
          type: "call",
          side: "buy",
          premiumUSD: 23.85,
          quantity: 1,
        },
      ],
      optionEntryExecutions: [
        {
          id: "p-entry-total",
          legId: "p-leg-total",
          tradeDate: "2026-08-12",
          contracts: 1,
          fillPriceUSD: 23.85,
          settlementCurrency: "JPY",
          brokerBookedAmountJPY: -383934,
          brokerPremiumJPY: -383574,
          brokerTransactionCostJPY: 360,
          brokerCurrencyConversionCostJPY: 3801,
          brokerTotalTransactionCostJPY: 4157,
          brokerFeeJPY: 322,
          brokerExchangeFeeJPY: 6,
          brokerTaxIncludedFeeJPY: 32,
          brokerExchangeRateJPY: 160.827855,
          referenceFxRateJPY: 160.827855,
          inputMode: "P_JPY_BROKER_STATEMENT",
          source: "saxo_api_estimate",
          confirmed: false,
          memo: "",
        },
      ],
    };

    expect(calculateOptionEntryExecutionSummary(simulation)).toMatchObject({
      basis: "saxo_broker_statement",
      cashBookedAmountJPY: -383934,
      grossPremiumJPY: -383574,
      cashTransactionCostJPY: 360,
      currencyConversionCostJPY: 3801,
      transactionCostJPY: 4157,
      netPremiumJPY: -387731,
    });
  });

  it("treats a negative manual Saxo total transaction cost as explicit evidence instead of missing or zero", () => {
    const simulation: TradeSimulation = {
      ...sampleAmznSimulation,
      id: "p-option-manual-total-cost",
      accountCode: "P",
      accountEnvironment: "PROD_P_JPY_SETTLEMENT",
      accountCurrency: "JPY",
      optionLegs: [
        {
          ...sampleAmznSimulation.optionLegs[0],
          id: "p-leg-manual-total",
          type: "call",
          side: "buy",
          premiumUSD: 23.85,
          quantity: 1,
        },
      ],
      optionEntryExecutions: [
        {
          id: "p-entry-manual-total",
          legId: "p-leg-manual-total",
          tradeDate: "2026-08-12",
          contracts: 1,
          fillPriceUSD: 23.85,
          settlementCurrency: "JPY",
          brokerBookedAmountJPY: -383934,
          brokerPremiumJPY: -383574,
          brokerTransactionCostJPY: 360,
          brokerCurrencyConversionCostJPY: -3801,
          brokerTotalTransactionCostJPY: -4157,
          brokerExchangeRateJPY: 160.827855,
          inputMode: "P_JPY_BROKER_STATEMENT",
          source: "manual",
          confirmed: false,
          memo: "",
        },
      ],
    };

    expect(calculateOptionEntryExecutionSummary(simulation)).toMatchObject({
      basis: "saxo_broker_statement",
      cashTransactionCostJPY: 360,
      currencyConversionCostJPY: 3801,
      transactionCostJPY: 4157,
      netPremiumJPY: -387731,
    });
  });

  it("sums only non-overlapping explicit costs when Saxo total transaction cost is unavailable", () => {
    const simulation: TradeSimulation = {
      ...sampleAmznSimulation,
      id: "p-option-component-cost",
      accountCode: "P",
      accountEnvironment: "PROD_P_JPY_SETTLEMENT",
      accountCurrency: "JPY",
      optionLegs: [
        {
          ...sampleAmznSimulation.optionLegs[0],
          id: "p-leg-component",
          type: "call",
          side: "buy",
          premiumUSD: 23.85,
          quantity: 1,
        },
      ],
      optionEntryExecutions: [
        {
          id: "p-entry-component",
          legId: "p-leg-component",
          tradeDate: "2026-08-12",
          contracts: 1,
          fillPriceUSD: 23.85,
          settlementCurrency: "JPY",
          brokerBookedAmountJPY: -383934,
          brokerPremiumJPY: -383574,
          brokerTransactionCostJPY: 360,
          brokerCurrencyConversionCostJPY: 3801,
          brokerExchangeRateJPY: 160.827855,
          referenceFxRateJPY: 160.827855,
          inputMode: "P_JPY_BROKER_STATEMENT",
          source: "saxo_api_estimate",
          confirmed: false,
          memo: "",
        },
      ],
    };

    expect(calculateOptionEntryExecutionSummary(simulation)).toMatchObject({
      basis: "saxo_broker_statement",
      cashBookedAmountJPY: -383934,
      cashTransactionCostJPY: 360,
      currencyConversionCostJPY: 3801,
      transactionCostJPY: 4161,
      netPremiumJPY: -387735,
    });
  });
});
