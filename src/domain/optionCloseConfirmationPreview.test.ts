import { describe, expect, it } from "vitest";
import type { OptionCloseExecution, TradeSimulation } from "@/types/domain";
import {
  calculateOptionCloseExecutionResult,
  getOptionCloseCompletion,
  previewOptionCloseExecutionConfirmation,
} from "./optionCloseExecutions";

function spread(): TradeSimulation {
  return {
    id: "R11-spread", name: "Anonymous bear put", ticker: "TEST", status: "open", strategyType: "bear_put_spread",
    accountCode: "N", accountCurrency: "USD", accountEnvironment: "PROD_N_USD_SETTLEMENT",
    currentPriceUSD: 95, fxRateJPY: 0, entryDate: "2026-09-01", expiryDate: "2026-10-02", dte: 31,
    stockPosition: null, brokerMarginJPY: 0, marginBufferMultiplier: 1, denominatorMode: "custom",
    taxProfileId: "none_nisa_or_tax_free_comparison",
    optionLegs: [
      { id: "R11-long", type: "put", side: "buy", strikeUSD: 100, premiumUSD: 4.92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02" },
      { id: "R11-short", type: "put", side: "sell", strikeUSD: 90, premiumUSD: 0.92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02" },
    ],
    optionEntryExecutions: [
      { id: "R11-entry-long", legId: "R11-long", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 4.92, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true },
      { id: "R11-entry-short", legId: "R11-short", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 0.92, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true },
    ],
  };
}

function draft(legId = "R11-short", patch: Partial<OptionCloseExecution> = {}): OptionCloseExecution {
  return {
    id: `R11-close-${legId}`, legId, closeKind: "buyback", confirmed: false, confirmationStatus: "pending",
    closeDate: "2026-09-10", contracts: 1, closePriceUSD: legId === "R11-short" ? 0.84 : 4.5,
    commissionUSD: 2.24, settlementCurrency: "USD", source: "saxo_history", sourceCandidateId: `R11-candidate-${legId}`,
    ...patch,
  };
}

describe("SAXO-SPREAD-CLOSE-CONFIRM-20260915-R11 preview", () => {
  it("previews the unconfirmed P90 close at $3.52 without mutating formal progress or requiring FX", () => {
    const execution = draft();
    const simulation = { ...spread(), optionCloseExecutions: [execution] };
    const before = JSON.stringify(simulation);
    expect(calculateOptionCloseExecutionResult(simulation, execution)).toBeNull();
    const preview = previewOptionCloseExecutionConfirmation(simulation, execution);
    expect(preview).toMatchObject({ valid: true, result: { realizedPnlUSD: 3.52, currency: "USD" } });
    expect(preview.valid && Number.isNaN(preview.result.realizedPnlJPY)).toBe(true);
    expect(getOptionCloseCompletion(simulation)).toMatchObject({ state: "none", remainingContracts: 2 });
    expect(JSON.stringify(simulation)).toBe(before);
  });

  it("allows the second leg after the first is formally confirmed and closes only after confirmation", () => {
    const first = draft("R11-short", { confirmed: true, confirmationStatus: "confirmed" });
    const second = draft("R11-long");
    const simulation = { ...spread(), optionCloseExecutions: [first, second] };
    expect(getOptionCloseCompletion(simulation)).toMatchObject({ state: "partial", remainingContracts: 1 });
    expect(previewOptionCloseExecutionConfirmation(simulation, second)).toMatchObject({ valid: true });
    expect(getOptionCloseCompletion({ ...simulation, optionCloseExecutions: [first, { ...second, confirmed: true }] })).toMatchObject({ state: "complete", terminalStatus: "closed" });
  });

  it.each([
    ["unknown leg", draft("R11-missing")],
    ["over-close", draft("R11-short", { contracts: 2 })],
    ["void", draft("R11-short", { voided: true })],
    ["missing fee", draft("R11-short", { commissionUSD: undefined })],
  ])("blocks %s without inventing a result", (_name, execution) => {
    const simulation = { ...spread(), optionCloseExecutions: [execution] };
    expect(previewOptionCloseExecutionConfirmation(simulation, execution)).toMatchObject({ valid: false });
  });

  it("blocks duplicate identities, invalid contract size, and ambiguous entry allocation", () => {
    const execution = draft();
    expect(previewOptionCloseExecutionConfirmation({ ...spread(), optionCloseExecutions: [execution, { ...execution }] }, execution)).toMatchObject({ valid: false });
    const missingMultiplier = spread();
    missingMultiplier.optionLegs[1].contractSize = undefined;
    missingMultiplier.optionCloseExecutions = [execution];
    expect(previewOptionCloseExecutionConfirmation(missingMultiplier, execution)).toMatchObject({ valid: false });
    const ambiguous = spread();
    ambiguous.optionEntryExecutions = [
      { ...ambiguous.optionEntryExecutions![1], id: "R11-entry-a" },
      { ...ambiguous.optionEntryExecutions![1], id: "R11-entry-b" },
      ambiguous.optionEntryExecutions![0],
    ];
    ambiguous.optionCloseExecutions = [execution];
    expect(previewOptionCloseExecutionConfirmation(ambiguous, execution)).toMatchObject({ valid: false });
  });

  it("blocks a stale rendered candidate when the stored execution changed", () => {
    const rendered = draft();
    const simulation = {
      ...spread(),
      optionCloseExecutions: [{ ...rendered, realizedPnlUSD: 3.52, realizedPnlSource: "saxo_derived" as const }],
    };
    expect(previewOptionCloseExecutionConfirmation(simulation, rendered)).toEqual({
      valid: false,
      reason: "画面表示後に決済実績が更新されています。最新内容を再確認してください。",
    });
  });
});
