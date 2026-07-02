import { describe, expect, it } from "vitest";
import type { SaxoApiOrderSnapshot } from "@/features/saxo/saxoAccountSync";
import type { OptionLeg, TradeSimulation } from "@/types/domain";
import {
  buildSaxoOptionPremiumCandidateInput,
  calculateLongOptionCloseAnnualizedReturnPercent,
  getLongOptionExitOrderLineCandidate,
  getPremiumCandidatePrice,
} from "./CloseDecisionCard";

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

describe("Saxo premium candidate price selection", () => {
  it("does not treat zero or reference-only prices as adoptable current option prices", () => {
    expect(getPremiumCandidatePrice({
      environment: "live",
      fetchedAt: "2026-07-02T00:00:00.000Z",
      status: "unavailable",
      classification: "市場外または価格なし / NoMarket",
      source: "trade/v1/infoprices (existing position UIC)",
      bid: 0,
      ask: 0,
      mid: 0,
      referencePriceUSD: 21.5,
      referencePriceLabel: "PriceInfo.LastClose",
      message: "参考価格のみです。",
    })).toBeNull();
  });

  it("uses live bid ask mid or last values when they are positive", () => {
    expect(getPremiumCandidatePrice({
      environment: "live",
      fetchedAt: "2026-07-02T00:00:00.000Z",
      status: "available",
      classification: "取得可能",
      source: "trade/v1/infoprices/list",
      bid: 21.9,
      message: "候補価格を取得しました。",
    })).toBe(21.9);
  });
});

describe("long option close annualized return", () => {
  it("uses fee-included profit divided by entry cost and elapsed holding days", () => {
    const annualized = calculateLongOptionCloseAnnualizedReturnPercent({
      profit: 1000,
      entryCost: 2400 + 2.25,
      elapsedDays: 10,
    });

    expect(annualized).toBeCloseTo((1000 / 2402.25) * (365 / 10) * 100, 8);
  });

  it("uses at least one holding day and returns null when current close profit or entry cost is unavailable", () => {
    expect(calculateLongOptionCloseAnnualizedReturnPercent({
      profit: 100,
      entryCost: 1000,
      elapsedDays: 0,
    })).toBeCloseTo(3650, 8);
    expect(calculateLongOptionCloseAnnualizedReturnPercent({
      profit: null,
      entryCost: 1000,
      elapsedDays: 5,
    })).toBeNull();
    expect(calculateLongOptionCloseAnnualizedReturnPercent({
      profit: 100,
      entryCost: 0,
      elapsedDays: 5,
    })).toBeNull();
  });
});
