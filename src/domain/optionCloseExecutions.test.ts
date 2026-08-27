import { describe, expect, it } from "vitest";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import type { TradeSimulation } from "@/types/domain";
import {
  createOptionCloseExecutionDraft,
  deriveSaxoHistoryRealizedPnlAutofill,
  getOptionCloseCompletion,
  getClosedSyntheticLegHistoryItems,
  getOptionLegCloseProgress,
  getOptionLegOperationalCloseProgress,
  resolveSaxoHistoryCloseDraftCommission,
  sanitizeSaxoHistoryCloseExecutions,
  validateSaxoHistoryCloseExecution,
} from "./optionCloseExecutions";

const putLeg = sampleAmznSimulation.optionLegs.find((leg) => leg.type === "put") ?? sampleAmznSimulation.optionLegs[0];

function openPutSimulation(patch: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    ...sampleAmznSimulation,
    id: "sim-p200",
    status: "open",
    accountCode: "P",
    accountEnvironment: "PROD_P_JPY_SETTLEMENT",
    optionLegs: [
      {
        ...putLeg,
        id: "put-p200",
        type: "put",
        side: "sell",
        strikeUSD: 200,
        expiryDate: "2026-06-05",
        quantity: 1,
        premiumUSD: 1.16,
      },
    ],
    ...patch,
  };
}

describe("Saxo history close execution validation", () => {
  it("derives one confirmed closed-leg history row while the synthetic parent remains open", () => {
    const simulation = openPutSimulation({ id: "synthetic-partial", strategyType: "synthetic_forward", accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", optionLegs: [{ ...putLeg, id: "call-leg", type: "call", side: "buy", premiumUSD: 5, quantity: 1 }, { ...putLeg, id: "put-leg", type: "put", side: "sell", premiumUSD: 4, quantity: 1 }], optionEntryExecutions: [{ id: "entry-call", legId: "call-leg", tradeDate: "2026-06-01", contracts: 1, fillPriceUSD: 5, settlementCurrency: "USD", commissionUSD: 2.24, source: "manual", confirmed: true }, { id: "entry-put", legId: "put-leg", tradeDate: "2026-06-01", contracts: 1, fillPriceUSD: 4, settlementCurrency: "USD", commissionUSD: 2.24, source: "manual", confirmed: true }], optionCloseExecutions: [{ id: "close-call", legId: "call-leg", closeKind: "buyback", closePriceUSD: 6, closeDate: "2026-06-10", contracts: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true }] });
    expect(getClosedSyntheticLegHistoryItems([simulation])).toEqual([expect.objectContaining({ legId: "call-leg", executionIds: ["close-call"], closedContracts: 1 })]);
    expect(getClosedSyntheticLegHistoryItems([{ ...simulation, status: "closed" }])).toEqual([]);
    expect(getClosedSyntheticLegHistoryItems([{ ...simulation, optionCloseExecutions: [{ ...simulation.optionCloseExecutions![0], contracts: 2 }] }])).toEqual([]);
  });
  it("uses only the confirmed N/USD close standard for a new buyback draft", () => {
    const nSimulation = openPutSimulation({
      accountCode: "N",
      accountEnvironment: "PROD_N_USD_SETTLEMENT",
      optionLegs: [{ ...putLeg, id: "n-one", quantity: 1 }],
    });
    const one = createOptionCloseExecutionDraft({ simulation: nSimulation, leg: nSimulation.optionLegs[0], closePriceUSD: 1.56 });
    expect(one).toMatchObject({ commissionUSD: 2.24, commissionSource: "saxo_ticket_confirmed_standard" });

    const twoSimulation = { ...nSimulation, optionLegs: [{ ...nSimulation.optionLegs[0], id: "n-two", quantity: 2 }] };
    expect(createOptionCloseExecutionDraft({ simulation: twoSimulation, leg: twoSimulation.optionLegs[0] })).toMatchObject({ commissionUSD: 4.49, commissionSource: "saxo_ticket_confirmed_standard" });

    const pSimulation = openPutSimulation();
    expect(createOptionCloseExecutionDraft({ simulation: pSimulation, leg: pSimulation.optionLegs[0] }).commissionUSD).toBeUndefined();
  });

  it("uses actual accounting cost over the standard and leaves order-activity accounting pending without a fee", () => {
    const nSimulation = openPutSimulation({ accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT" });
    const standard = createOptionCloseExecutionDraft({ simulation: nSimulation, leg: nSimulation.optionLegs[0] });
    const actual = resolveSaxoHistoryCloseDraftCommission({ accountEnvironment: nSimulation.accountEnvironment, accountingPending: false, transactionCost: -3.1, draft: standard });
    expect(actual).toMatchObject({ commissionUSD: 3.1, commissionSource: "saxo_actual" });
    const activityPending = resolveSaxoHistoryCloseDraftCommission({ accountEnvironment: nSimulation.accountEnvironment, accountingPending: true, transactionCost: -3.1, draft: standard });
    expect(activityPending.commissionUSD).toBeUndefined();
    expect(activityPending.commissionSource).toBeUndefined();
  });

  it("recalculates Saxo-derived close P/L with the 2.24 close fee without overwriting user values", () => {
    const simulation = openPutSimulation({
      accountCode: "N",
      accountEnvironment: "PROD_N_USD_SETTLEMENT",
      optionLegs: [{ ...putLeg, id: "n-p270", side: "sell", premiumUSD: 3.3, quantity: 1 }],
      optionEntryExecutions: [{
        id: "entry-n-p270", legId: "n-p270", tradeDate: "2026-08-20", contracts: 1, fillPriceUSD: 3.3,
        settlementCurrency: "USD", commissionUSD: 2.24, commissionSource: "saxo_ticket_confirmed_standard", source: "saxo_api_estimate", confirmed: true,
      }],
    });
    const execution = createOptionCloseExecutionDraft({ simulation, leg: simulation.optionLegs[0], closePriceUSD: 1.56 });
    const derived = deriveSaxoHistoryRealizedPnlAutofill(simulation, execution);
    expect(derived).toMatchObject({ available: true, realizedPnlUSD: 169.52 });
    const override = { ...execution, realizedPnlUSD: 91.23, realizedPnlSource: "user_override" as const };
    expect(override.realizedPnlUSD).toBe(91.23);
  });

  it("closes only after every leg is fully confirmed and is idempotent on reload", () => {
    const partial = openPutSimulation({ optionLegs: [{ ...putLeg, id: "two", quantity: 2 }], optionCloseExecutions: [{ id: "first", legId: "two", closeKind: "buyback", confirmed: true, closeDate: "2026-06-02", contracts: 1, settlementCurrency: "JPY", source: "manual" }] });
    expect(getOptionCloseCompletion(partial)).toMatchObject({ state: "partial", remainingContracts: 1 });
    const full = { ...partial, optionCloseExecutions: [...partial.optionCloseExecutions!, { id: "second", legId: "two", closeKind: "buyback" as const, confirmed: true, closeDate: "2026-06-03", contracts: 1, settlementCurrency: "JPY" as const, source: "manual" as const }] };
    expect(getOptionCloseCompletion(full)).toMatchObject({ state: "complete", terminalStatus: "closed" });
    const normalized = sanitizeSaxoHistoryCloseExecutions(full);
    expect(normalized.status).toBe("closed");
    expect(sanitizeSaxoHistoryCloseExecutions(normalized)).toBe(normalized);
  });

  it("requires each leg and rejects over-close while distinguishing expiry and mixed closes", () => {
    const twoLegs = openPutSimulation({ optionLegs: [{ ...putLeg, id: "a", quantity: 1 }, { ...putLeg, id: "b", type: "call", quantity: 1 }], optionCloseExecutions: [{ id: "a-close", legId: "a", closeKind: "expired", confirmed: true, closeDate: "2026-06-05", contracts: 1, settlementCurrency: "JPY", source: "manual" }] });
    expect(getOptionCloseCompletion(twoLegs)).toMatchObject({ state: "partial", remainingContracts: 1 });
    expect(getOptionCloseCompletion({ ...twoLegs, optionCloseExecutions: [{ ...twoLegs.optionCloseExecutions![0], contracts: 2 }] })).toMatchObject({ state: "invalid" });
    const completeExpired = openPutSimulation({ optionCloseExecutions: [{ id: "expire", legId: "put-p200", closeKind: "expired", confirmed: true, closeDate: "2026-06-05", contracts: 1, settlementCurrency: "JPY", source: "manual" }] });
    expect(getOptionCloseCompletion(completeExpired)).toMatchObject({ state: "complete", terminalStatus: "expired" });
  });
  it("exposes confirmed quantities per leg and leaves unconfirmed drafts out of progress", () => {
    const simulation = openPutSimulation({ optionLegs: [{ ...putLeg, id: "call", type: "call", side: "buy", quantity: 1 }, { ...putLeg, id: "put", type: "put", side: "sell", quantity: 2 }], optionCloseExecutions: [{ id: "call-close", legId: "call", closeKind: "buyback", confirmed: true, closeDate: "2026-08-20", contracts: 1, settlementCurrency: "JPY", source: "manual" }, { id: "put-draft", legId: "put", closeKind: "buyback", confirmed: false, closeDate: "2026-08-20", contracts: 1, settlementCurrency: "JPY", source: "manual" }] });
    expect(getOptionLegCloseProgress(simulation).legs).toEqual(expect.arrayContaining([expect.objectContaining({ legId: "call", state: "closed", remainingContracts: 0 }), expect.objectContaining({ legId: "put", state: "open", remainingContracts: 2 })]));
  });
  it("autofills deterministic N account short put close P/L from the shared calculation", () => {
    const simulation = openPutSimulation({
      accountCode: "N",
      accountEnvironment: "PROD_N_USD_SETTLEMENT",
      optionLegs: [
        {
          ...putLeg,
          id: "put-p195",
          type: "put",
          side: "sell",
          strikeUSD: 195,
          premiumUSD: 5.9,
          quantity: 1,
        },
      ],
      optionEntryExecutions: [
        {
          id: "entry-p195",
          legId: "put-p195",
          tradeDate: "2026-06-01",
          contracts: 1,
          fillPriceUSD: 5.9,
          settlementCurrency: "USD",
          commissionUSD: 2.25,
          source: "saxo_api_estimate",
          confirmed: true,
        },
      ],
    });

    const result = deriveSaxoHistoryRealizedPnlAutofill(simulation, {
      id: "close-p195",
      legId: "put-p195",
      closeKind: "buyback",
      confirmed: false,
      closeDate: "2026-06-10",
      contracts: 1,
      closePriceUSD: 0.75,
      commissionUSD: 2.25,
      settlementCurrency: "USD",
      source: "saxo_history",
      sourceTradeId: "history-p195-close",
      targetPositionId: simulation.id,
    });

    expect(result).toMatchObject({
      available: true,
      realizedPnlUSD: 510.5,
      derivation: {
        sourceTradeId: "history-p195-close",
        targetPositionId: simulation.id,
        entryPremiumUSD: 590,
        closePriceUSD: 0.75,
        openCommissionUSD: 2.25,
        closeCommissionUSD: 2.25,
      },
    });
  });

  it("leaves Saxo autofill empty when an allocation is not deterministic", () => {
    const simulation = openPutSimulation({
      accountCode: "N",
      accountEnvironment: "PROD_N_USD_SETTLEMENT",
      optionLegs: [{ ...putLeg, id: "put-p195", side: "sell", premiumUSD: 5.9, quantity: 2 }],
      optionEntryExecutions: [
        {
          id: "entry-p195",
          legId: "put-p195",
          tradeDate: "2026-06-01",
          contracts: 2,
          fillPriceUSD: 5.9,
          settlementCurrency: "USD",
          commissionUSD: 2.25,
          source: "saxo_api_estimate",
          confirmed: true,
        },
      ],
    });

    const result = deriveSaxoHistoryRealizedPnlAutofill(simulation, {
      id: "partial-close",
      legId: "put-p195",
      confirmed: false,
      closeDate: "2026-06-10",
      contracts: 1,
      closePriceUSD: 0.75,
      commissionUSD: 2.25,
      settlementCurrency: "USD",
      source: "saxo_history",
    });

    expect(result).toMatchObject({ available: false, missingFields: ["一部決済または数量配賦", "建玉時数量"] });
  });

  it("removes stale one-yen Saxo history placeholder drafts without touching confirmed history", () => {
    const simulation = openPutSimulation({
      optionCloseExecutions: [
        {
          id: "bad-draft",
          legId: "put-p200",
          closeKind: "buyback",
          confirmed: false,
          closeDate: "2026-06-02",
          contracts: 1,
          closePriceUSD: 0.13,
          settlementCurrency: "JPY",
          brokerRealizedPnlJPY: 1,
          brokerBookedAmountJPY: 1,
          source: "saxo_history",
          sourceTradeId: "hist-p200-close",
          targetPositionId: "sim-p200",
          confirmationStatus: "pending",
        },
        {
          id: "confirmed-manual",
          legId: "put-p200",
          closeKind: "buyback",
          confirmed: true,
          closeDate: "2026-06-02",
          contracts: 1,
          closePriceUSD: 0.13,
          settlementCurrency: "JPY",
          brokerRealizedPnlJPY: 1,
          brokerBookedAmountJPY: 1,
          source: "manual",
        },
      ],
    });

    const sanitized = sanitizeSaxoHistoryCloseExecutions(simulation);

    expect(sanitized.optionCloseExecutions?.map((execution) => execution.id)).toEqual(["confirmed-manual"]);
  });

  it("marks Saxo history close drafts invalid when their target simulation differs", () => {
    const simulation = openPutSimulation({
      optionCloseExecutions: [
        {
          id: "wrong-target",
          legId: "put-p200",
          closeKind: "buyback",
          confirmed: false,
          closeDate: "2026-06-02",
          contracts: 1,
          closePriceUSD: 0.13,
          settlementCurrency: "JPY",
          brokerRealizedPnlJPY: 15_491,
          source: "saxo_history",
          sourceTradeId: "hist-p200-close",
          targetPositionId: "other-simulation",
          confirmationStatus: "pending",
        },
      ],
    });

    const sanitized = sanitizeSaxoHistoryCloseExecutions(simulation);

    expect(sanitized.optionCloseExecutions?.[0]?.confirmationStatus).toBe("invalid");
    expect(sanitized.optionCloseExecutions?.[0]?.invalidReason).toContain("別の建玉");
  });

  it("keeps activity-confirmed quantity operational only until accounting is formally confirmed", () => {
    const simulation = openPutSimulation({
      optionLegs: [{ ...putLeg, id: "activity-put", quantity: 1 }],
      optionCloseExecutions: [{
        id: "activity-close", legId: "activity-put", confirmed: false, closeDate: "2026-06-02", contracts: 1,
        settlementCurrency: "JPY", source: "saxo_order_activity", confirmationStatus: "pending",
        executionEvidenceStatus: "user_confirmed_pending_accounting", accountingStatus: "pending",
      }],
    });
    expect(getOptionLegCloseProgress(simulation).legs[0]).toMatchObject({ state: "open", remainingContracts: 1 });
    expect(getOptionLegOperationalCloseProgress(simulation).legs[0]).toMatchObject({ state: "closed", remainingContracts: 0 });
    expect(getOptionCloseCompletion(simulation)).toMatchObject({ state: "none" });
  });

  it("does not validate Saxo close drafts without their source history id", () => {
    const validation = validateSaxoHistoryCloseExecution(openPutSimulation(), {
      id: "missing-source",
      legId: "put-p200",
      closeKind: "buyback",
      confirmed: false,
      closeDate: "2026-06-02",
      contracts: 1,
      closePriceUSD: 0.13,
      settlementCurrency: "JPY",
      brokerRealizedPnlJPY: 15_491,
      source: "saxo_history",
      confirmationStatus: "pending",
    });

    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain("Saxo履歴ID");
  });
});
