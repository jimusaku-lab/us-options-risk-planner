import { describe, expect, it } from "vitest";
import { applySyntheticPutAssignmentPolicy, calculateCurrentPositionEstimate, getSyntheticPutAssignmentPolicy } from "./currentPositionEstimate";
import type { TradeSimulation } from "@/types/domain";

function synthetic(): TradeSimulation {
  return {
    id: "synthetic", status: "open", name: "synthetic", ticker: "ALFA", strategyType: "synthetic_forward", currentPriceUSD: 100,
    fxRateJPY: 150, accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD", entryDate: "2026-08-01", expiryDate: "2026-12-18", dte: 139,
    stockPosition: null, brokerMarginJPY: 0, brokerMarginUSD: 0, marginBufferMultiplier: 1, denominatorMode: "cash_secured", taxProfileId: "japan_derivative_separate_tax_user_confirm", syntheticForwardTicket: { actualTotalCommissionUSD: 9 },
    optionLegs: [
      { id: "call", type: "call", side: "buy", strikeUSD: 100, premiumUSD: 5, quantity: 1, expiryDate: "2026-12-18", closeCostUSD: 7, closePlan: { enabled: true, commissionUSD: 1 } },
      { id: "put", type: "put", side: "sell", strikeUSD: 100, premiumUSD: 4, quantity: 1, expiryDate: "2026-12-18", closeCostUSD: 3, closePlan: { enabled: true, commissionUSD: 1 }, assignmentPolicy: "unknown", putIntent: "can_buy" },
    ],
    optionEntryExecutions: [
      { id: "call-entry", legId: "call", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 5, settlementCurrency: "USD", commissionUSD: 1, inputMode: "USD_EXECUTION_CALC", source: "manual", confirmed: true },
      { id: "put-entry", legId: "put", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 4, settlementCurrency: "USD", commissionUSD: 1, inputMode: "USD_EXECUTION_CALC", source: "manual", confirmed: true },
    ],
  };
}

function standalone(kind: "long_call" | "long_put" | "short_put"): TradeSimulation {
  const isShortPut = kind === "short_put";
  const type = kind === "long_put" || isShortPut ? "put" : "call";
  return {
    id: kind, status: "open", name: kind, ticker: "BETA", strategyType: kind, currentPriceUSD: 100,
    fxRateJPY: 150, accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD", entryDate: "2026-08-01", expiryDate: "2026-12-18", dte: 139,
    stockPosition: null, brokerMarginJPY: 0, brokerMarginUSD: 0, marginBufferMultiplier: 1, denominatorMode: "cash_secured", taxProfileId: "japan_derivative_separate_tax_user_confirm",
    optionLegs: [{ id: "leg", type, side: isShortPut ? "sell" : "buy", strikeUSD: 100, premiumUSD: 5, quantity: 1, expiryDate: "2026-12-18", closeCostUSD: 4, closePlan: { enabled: true, commissionUSD: 0 }, assignmentPolicy: isShortPut ? "avoid" : undefined }],
    optionEntryExecutions: [{ id: "entry", legId: "leg", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 5, settlementCurrency: "USD", commissionUSD: 0, inputMode: "USD_EXECUTION_CALC", source: "manual", confirmed: true }],
  };
}

describe("current position estimate", () => {
  it("shows a synthetic estimate only when both explicit exit candidates and fees are available", () => {
    expect(calculateCurrentPositionEstimate(synthetic(), new Date("2026-08-11T00:00:00"))).toMatchObject({ kind: "available", primaryLabel: "現在決済年率", profitUSD: 296 });
  });
  it("uses the confirmed close standard rather than actual entry total commission", () => {
    const value = synthetic();
    value.optionLegs = value.optionLegs.map((leg) => ({ ...leg, closePlan: { enabled: true } }));
    expect(calculateCurrentPositionEstimate(value)).toMatchObject({ kind: "available", profitUSD: 293.52 });
  });
  it("distinguishes missing synthetic entry evidence from missing close-plan fees", () => {
    const value = synthetic();
    value.optionEntryExecutions = [value.optionEntryExecutions![0]];
    expect(calculateCurrentPositionEstimate(value)).toMatchObject({ kind: "missing", reason: "建玉時実績 未確認" });
  });
  it("requires confirmed entry evidence for long calls, long puts, and short puts without defaulting fees to zero", () => {
    for (const kind of ["long_call", "long_put", "short_put"] as const) {
      const value = standalone(kind);
      expect(calculateCurrentPositionEstimate(value)).toMatchObject({ kind: "available" });
      value.optionEntryExecutions = [];
      expect(calculateCurrentPositionEstimate(value)).toMatchObject({ kind: "missing", reason: "建玉時実績 未確認" });
    }
  });
  it("does not convert P/JPY execution values into a USD estimate without direct JPY evidence", () => {
    const value = standalone("long_call");
    value.accountEnvironment = "PROD_P_JPY_SETTLEMENT";
    value.accountCurrency = "JPY";
    value.optionEntryExecutions![0].settlementCurrency = "JPY";
    expect(calculateCurrentPositionEstimate(value)).toMatchObject({ kind: "missing", reason: "建玉時実績 未確認" });
  });
  it("requires an explicit P/JPY close fee and preserves explicit zero without reusing entry fees", () => {
    const value = standalone("long_call");
    value.accountEnvironment = "PROD_P_JPY_SETTLEMENT";
    value.accountCode = "P";
    value.accountCurrency = "JPY";
    value.optionEntryExecutions![0] = { ...value.optionEntryExecutions![0], settlementCurrency: "JPY", brokerBookedAmountJPY: -75_000 };
    value.optionLegs[0].quantity = 1.5;
    value.optionLegs[0].closePlan = { enabled: true };
    expect(calculateCurrentPositionEstimate(value)).toMatchObject({ kind: "missing", reason: "決済想定手数料 未確認", missingRequirements: [{ legId: "leg", field: "close_fee" }] });
    value.optionLegs[0].closePlan = { enabled: true, commissionUSD: 0, commissionSource: "manual" };
    expect(calculateCurrentPositionEstimate(value)).toMatchObject({ kind: "available", currency: "JPY" });
  });
  it("uses an eligible read-only USD/JPY quote for P/JPY without saving or reusing opening FX", () => {
    const value = standalone("long_call");
    value.accountEnvironment = "PROD_P_JPY_SETTLEMENT";
    value.accountCode = "P";
    value.accountCurrency = "JPY";
    value.fxRateJPY = 0;
    value.referenceFxRateJPY = undefined;
    value.optionEntryExecutions![0] = { ...value.optionEntryExecutions![0], settlementCurrency: "JPY", brokerBookedAmountJPY: -75_000 };
    const quote = { pair: "USDJPY" as const, rate: 150, date: "2026-08-14", source: "local_proxy" as const, fetchedAt: "2026-08-14T00:00:00.000Z" };
    expect(calculateCurrentPositionEstimate(value, new Date("2026-08-11"))).toMatchObject({ kind: "missing", reason: "為替レート 未確認" });
    expect(calculateCurrentPositionEstimate(value, new Date("2026-08-11"), quote)).toMatchObject({ kind: "available", currency: "JPY", fx: { source: "readonly_current_quote", rateJPYPerUSD: 150 } });
    expect(value.fxRateJPY).toBe(0);
    expect(value.referenceFxRateJPY).toBeUndefined();
  });
  it("does not infer policy from historical defaults or assignment confirmation", () => {
    const value = synthetic(); value.syntheticForwardTicket!.assignmentAccepted = true;
    expect(getSyntheticPutAssignmentPolicy(value)).toBe("unknown");
    expect(applySyntheticPutAssignmentPolicy(value, "avoid").optionLegs[1]).toMatchObject({ assignmentPolicy: "avoid", putIntent: "avoid_assignment" });
  });
});
