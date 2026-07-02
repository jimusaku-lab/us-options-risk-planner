import { describe, expect, it } from "vitest";
import type { SaxoApiOrderSnapshot } from "@/features/saxo/saxoAccountSync";
import type { OptionLeg, TradeSimulation } from "@/types/domain";
import { buildSaxoOptionPremiumCandidateInput, getLongOptionExitOrderLineCandidate } from "./CloseDecisionCard";

function createOrder(overrides: Partial<SaxoApiOrderSnapshot>): SaxoApiOrderSnapshot {
  return {
    id: overrides.id ?? "order",
    accountKey: "n-key",
    accountAssignment: "N",
    symbol: "V",
    optionType: "call",
    strike: 335,
    expiry: "2026-11-20",
    isExitCandidate: true,
    missingFields: [],
    fetchedAt: "2026-06-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("long option exit order line candidates", () => {
  it("uses Saxo closing limit and stop prices as long call profit and stop lines", () => {
    const candidate = getLongOptionExitOrderLineCandidate([
      createOrder({ id: "limit", orderType: "Limit", price: 33 }),
      createOrder({ id: "stop", orderType: "Stop", stopPrice: 11 }),
    ]);

    expect(candidate.profitTargetPriceUSD).toBe(33);
    expect(candidate.stopLossPriceUSD).toBe(11);
  });

  it("ignores empty or zero-priced orders", () => {
    const candidate = getLongOptionExitOrderLineCandidate([
      createOrder({ id: "zero-limit", price: 0 }),
      createOrder({ id: "empty-stop" }),
    ]);

    expect(candidate.profitTargetPriceUSD).toBeUndefined();
    expect(candidate.stopLossPriceUSD).toBeUndefined();
  });
});

describe("Saxo option premium candidate input", () => {
  it("passes existing position UIC and account identifiers before fallback search", () => {
    const simulation = {
      ticker: "V",
      fixtureMeta: {
        source: "live",
        isRealMoney: true,
        broker: "SaxoBank",
        purpose: "development-fixture",
        createdAt: "2026-07-02",
        notes: "",
        saxoAccountKey: "XLu-live-account-key",
        saxoPositionId: "7655451244",
        saxoInstrumentCode: "V/20X26C340:XCBF",
        saxoUic: 54341397,
      },
    } as TradeSimulation;
    const leg = {
      id: "leg-1",
      type: "call",
      side: "buy",
      strikeUSD: 340,
      premiumUSD: 24.1,
      quantity: 1,
      expiryDate: "2026-11-20",
      brokerSymbol: "V/20X26C340:XCBF",
    } satisfies OptionLeg;

    expect(buildSaxoOptionPremiumCandidateInput(simulation, leg)).toEqual({
      symbol: "V",
      expiry: "2026-11-20",
      strike: 340,
      optionType: "call",
      accountKey: "XLu-live-account-key",
      uic: 54341397,
      assetType: "StockOption",
      positionId: "7655451244",
      instrumentCode: "V/20X26C340:XCBF",
    });
  });
});
