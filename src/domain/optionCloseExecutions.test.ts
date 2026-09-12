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
  repairLegacySaxoHistoryRealizedPnl,
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
    const simulation = openPutSimulation({
      id: "synthetic-partial",
      strategyType: "synthetic_forward",
      accountCode: "N",
      accountEnvironment: "PROD_N_USD_SETTLEMENT",
      optionLegs: [
        { ...putLeg, id: "call-leg", type: "call", side: "buy", premiumUSD: 5, quantity: 1 },
        { ...putLeg, id: "put-leg", type: "put", side: "sell", premiumUSD: 4, quantity: 1 },
      ],
      optionEntryExecutions: [
        { id: "entry-call", legId: "call-leg", tradeDate: "2026-06-01", contracts: 1, fillPriceUSD: 5, settlementCurrency: "USD", commissionUSD: 2.24, source: "manual", confirmed: true },
        { id: "entry-put", legId: "put-leg", tradeDate: "2026-06-01", contracts: 1, fillPriceUSD: 4, settlementCurrency: "USD", commissionUSD: 2.24, source: "manual", confirmed: true },
      ],
      optionCloseExecutions: [{ id: "close-call", legId: "call-leg", closeKind: "buyback", closePriceUSD: 6, closeDate: "2026-06-10", contracts: 1, commissionUSD: 2.24, settlementCurrency: "USD", source: "manual", confirmed: true }],
    });
    const rows = getClosedSyntheticLegHistoryItems([simulation]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ simulationId: "synthetic-partial", legId: "call-leg", closedContracts: 1, remainingContracts: 0, executionIds: ["close-call"] });
    expect(getClosedSyntheticLegHistoryItems([{ ...simulation, status: "closed" }])).toEqual([]);
    expect(getClosedSyntheticLegHistoryItems([{ ...simulation, optionCloseExecutions: [{ ...simulation.optionCloseExecutions![0], confirmed: false }] }])).toEqual([]);
    expect(getClosedSyntheticLegHistoryItems([{ ...simulation, optionCloseExecutions: [{ ...simulation.optionCloseExecutions![0], contracts: 2 }] }])).toEqual([]);
  });

  it("keeps a confirmed N/USD leg history row when reference JPY or realised P/L is unavailable", () => {
    const base = openPutSimulation({ id: "synthetic-entry-confirmation", status: "entry_confirmation", strategyType: "synthetic_forward", accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", optionLegs: [{ ...putLeg, id: "call", type: "call", side: "buy", quantity: 1 }, { ...putLeg, id: "put", type: "put", side: "sell", quantity: 1 }], optionCloseExecutions: [{ id: "close", legId: "call", closeKind: "buyback", closeDate: "2026-06-10", closePriceUSD: 2, contracts: 1, settlementCurrency: "USD", source: "manual", confirmed: true }] });
    const rows = getClosedSyntheticLegHistoryItems([base]);
    expect(rows).toEqual([expect.objectContaining({ legId: "call", executionIds: ["close"] })]);
    expect(rows[0].closeResults).toHaveLength(1);
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

  it("repairs only a confirmed Saxo history P/L exactly equal to the candidate USD booked amount", () => {
    const simulation = openPutSimulation({ optionCloseExecutions: [{ id: "close", legId: "put-p200", confirmed: true, closeDate: "2026-08-10", contracts: 1, settlementCurrency: "JPY", source: "saxo_history", sourceCandidateId: "candidate", brokerRealizedPnlJPY: 3235.23 }] });
    const candidates = [{ id: "candidate", kind: "trade", accountCode: "P" as const, accountCurrency: "JPY", bookedAmountUSD: 3235.23, profitLossAccountCurrency: 119265 }];
    const repaired = repairLegacySaxoHistoryRealizedPnl(simulation, candidates);
    expect(repaired.optionCloseExecutions?.[0]?.brokerRealizedPnlJPY).toBe(119265);
    expect(repairLegacySaxoHistoryRealizedPnl(repaired, candidates)).toBe(repaired);
    expect(repairLegacySaxoHistoryRealizedPnl({ ...simulation, optionCloseExecutions: [{ ...simulation.optionCloseExecutions![0], source: "manual" }] }, candidates)).toBeTruthy();
  });
  it("closes only when every option leg has a full valid confirmed close, and normalizes once on reload", () => {
    const oneOfTwo = openPutSimulation({
      optionLegs: [{ ...putLeg, id: "quantity-two", quantity: 2 }],
      optionCloseExecutions: [{
        id: "first-close", legId: "quantity-two", closeKind: "buyback", confirmed: true,
        closeDate: "2026-06-02", contracts: 1, settlementCurrency: "JPY", source: "manual",
      }],
    });
    expect(getOptionCloseCompletion(oneOfTwo)).toMatchObject({ state: "partial", remainingContracts: 1 });

    const completed = {
      ...oneOfTwo,
      optionCloseExecutions: [...oneOfTwo.optionCloseExecutions!, {
        id: "second-close", legId: "quantity-two", closeKind: "buyback" as const, confirmed: true,
        closeDate: "2026-06-03", contracts: 1, settlementCurrency: "JPY" as const, source: "manual" as const,
      }],
    };
    expect(getOptionCloseCompletion(completed)).toMatchObject({ state: "complete", terminalStatus: "closed", remainingContracts: 0 });
    const normalized = sanitizeSaxoHistoryCloseExecutions(completed);
    expect(normalized.status).toBe("closed");
    expect(sanitizeSaxoHistoryCloseExecutions(normalized)).toBe(normalized);
  });

  it("requires every leg and rejects over-close or invalid confirmed quantities", () => {
    const twoLegs = openPutSimulation({
      optionLegs: [{ ...putLeg, id: "leg-a", quantity: 1 }, { ...putLeg, id: "leg-b", type: "call", quantity: 1 }],
      optionCloseExecutions: [{
        id: "only-a", legId: "leg-a", confirmed: true, closeKind: "buyback", closeDate: "2026-06-02",
        contracts: 1, settlementCurrency: "JPY", source: "manual",
      }],
    });
    expect(getOptionCloseCompletion(twoLegs)).toMatchObject({ state: "partial", remainingContracts: 1 });
    expect(getOptionCloseCompletion({ ...twoLegs, optionCloseExecutions: [{ ...twoLegs.optionCloseExecutions![0], contracts: 2 }] })).toMatchObject({ state: "invalid" });
    expect(getOptionCloseCompletion({ ...twoLegs, optionCloseExecutions: [{ ...twoLegs.optionCloseExecutions![0], contracts: 0 }] })).toMatchObject({ state: "invalid" });
  });

  it("returns confirmed close progress per leg without treating unconfirmed drafts as closed", () => {
    const composite = openPutSimulation({
      optionLegs: [
        { ...putLeg, id: "closed-call", type: "call", side: "buy", quantity: 1 },
        { ...putLeg, id: "remaining-put", type: "put", side: "sell", quantity: 2 },
      ],
      optionCloseExecutions: [
        { id: "close-call", legId: "closed-call", closeKind: "buyback", confirmed: true, closeDate: "2026-06-02", contracts: 1, settlementCurrency: "JPY", source: "manual" },
        { id: "draft-put", legId: "remaining-put", closeKind: "buyback", confirmed: false, closeDate: "2026-06-03", contracts: 1, settlementCurrency: "JPY", source: "manual" },
      ],
    });
    expect(getOptionLegCloseProgress(composite).legs).toEqual(expect.arrayContaining([
      expect.objectContaining({ legId: "closed-call", state: "closed", openedContracts: 1, confirmedClosedContracts: 1, remainingContracts: 0 }),
      expect.objectContaining({ legId: "remaining-put", state: "open", openedContracts: 2, confirmedClosedContracts: 0, remainingContracts: 2 }),
    ]));
  });

  it("keeps an activity-confirmed close out of formal completion while removing only that leg operationally", () => {
    const composite = openPutSimulation({
      optionLegs: [
        { ...putLeg, id: "activity-call", type: "call", side: "buy", quantity: 1 },
        { ...putLeg, id: "remaining-put", type: "put", side: "sell", quantity: 1 },
      ],
      optionCloseExecutions: [{
        id: "activity-close", legId: "activity-call", confirmed: false, closeDate: "2026-06-02", contracts: 1,
        settlementCurrency: "JPY", source: "saxo_order_activity", confirmationStatus: "pending",
        executionEvidenceStatus: "user_confirmed_pending_accounting", accountingStatus: "pending",
      }],
    });
    expect(getOptionLegCloseProgress(composite).legs.find((leg) => leg.legId === "activity-call")).toMatchObject({ state: "open", remainingContracts: 1 });
    expect(getOptionLegOperationalCloseProgress(composite).legs).toEqual(expect.arrayContaining([
      expect.objectContaining({ legId: "activity-call", state: "closed", remainingContracts: 0 }),
      expect.objectContaining({ legId: "remaining-put", state: "open", remainingContracts: 1 }),
    ]));
    expect(getOptionCloseCompletion(composite)).toMatchObject({ state: "none" });
  });

  it("marks a fully expired position expired and a mixed close closed", () => {
    const expired = openPutSimulation({ optionCloseExecutions: [{ id: "expired", legId: "put-p200", closeKind: "expired", confirmed: true, closeDate: "2026-06-05", contracts: 1, settlementCurrency: "JPY", source: "manual" }] });
    expect(getOptionCloseCompletion(expired)).toMatchObject({ state: "complete", terminalStatus: "expired" });
    const mixed = openPutSimulation({
      optionLegs: [{ ...putLeg, id: "put-a", quantity: 1 }, { ...putLeg, id: "call-b", type: "call", quantity: 1 }],
      optionCloseExecutions: [
        { id: "expired-a", legId: "put-a", closeKind: "expired", confirmed: true, closeDate: "2026-06-05", contracts: 1, settlementCurrency: "JPY", source: "manual" },
        { id: "buyback-b", legId: "call-b", closeKind: "buyback", confirmed: true, closeDate: "2026-06-05", contracts: 1, settlementCurrency: "JPY", source: "manual" },
      ],
    });
    expect(getOptionCloseCompletion(mixed)).toMatchObject({ state: "complete", terminalStatus: "closed" });
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
