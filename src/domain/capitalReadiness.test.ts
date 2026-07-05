import { describe, expect, it } from "vitest";
import type { OptionLegDraft } from "@/types/screening";
import {
  calculateLongCallCapital,
  calculateShortPutCapital,
  evaluateCapitalReadiness,
  resolveAvailableCapital,
} from "./capitalReadiness";

describe("capital readiness", () => {
  it("uses available cash before buying power and assignment capital unless assignment is preferred", () => {
    const capital = { availableCashUSD: 1_000, buyingPowerUSD: 2_000, assignmentCapitalAvailableUSD: 3_000 };

    expect(resolveAvailableCapital(capital)).toBe(1_000);
    expect(resolveAvailableCapital(capital, true)).toBe(3_000);
  });

  it("calculates long call required capital and max loss from Ask x 100", () => {
    const result = calculateLongCallCapital(callBuy({ conservativePrice: 5.25 }));

    expect(result.requiredCapitalUSD).toBe(525);
    expect(result.maxLossUSD).toBe(525);
  });

  it("marks long call not ready when available cash is insufficient", () => {
    const result = evaluateCapitalReadiness({
      strategy: "long_call",
      legs: [callBuy({ conservativePrice: 5 })],
      capital: { availableCashUSD: 400, maxLossToleranceUSD: 1_000 },
    });

    expect(result.level).toBe("not_ready");
    expect(result.requiredCapitalUSD).toBe(500);
  });

  it("marks long call not ready when max loss exceeds tolerance", () => {
    const result = evaluateCapitalReadiness({
      strategy: "long_call",
      legs: [callBuy({ conservativePrice: 5 })],
      capital: { availableCashUSD: 1_000, maxLossToleranceUSD: 300 },
    });

    expect(result.level).toBe("not_ready");
    expect(result.warnings.join(" ")).toContain("許容損失");
  });

  it("calculates short put capital from strike x 100 and premium offset", () => {
    const result = calculateShortPutCapital(putSell({ strikePrice: 95, conservativePrice: 2.5 }));

    expect(result.requiredCapitalUSD).toBe(9_500);
    expect(result.maxLossUSD).toBe(9_250);
  });

  it("marks buy-to-own put not ready when assignment capital is insufficient", () => {
    const result = evaluateCapitalReadiness({
      strategy: "cash_secured_put_buy_to_own",
      legs: [putSell({ strikePrice: 95, conservativePrice: 2.5 })],
      capital: { assignmentCapitalAvailableUSD: 8_000 },
    });

    expect(result.level).toBe("not_ready");
    expect(result.requiredCapitalUSD).toBe(9_500);
  });

  it("marks covered call not ready when shares are below 100", () => {
    const result = evaluateCapitalReadiness({
      strategy: "covered_call",
      legs: [callSell({ conservativePrice: 2.5 })],
      capital: { stockShares: 50, stockCostBasisUSD: 90 },
    });

    expect(result.level).toBe("not_ready");
  });

  it("passes covered call capital when 100 shares are covered", () => {
    const result = evaluateCapitalReadiness({
      strategy: "covered_call",
      legs: [callSell({ conservativePrice: 2.5 })],
      capital: { stockShares: 100, stockCostBasisUSD: 90 },
    });

    expect(result.level).toBe("ok");
    expect(result.requiredCapitalUSD).toBe(0);
  });
});

function callBuy(overrides: Partial<OptionLegDraft> = {}): OptionLegDraft {
  return leg({ optionType: "call", side: "buy", conservativePriceField: "ask", ...overrides });
}

function callSell(overrides: Partial<OptionLegDraft> = {}): OptionLegDraft {
  return leg({ optionType: "call", side: "sell", conservativePriceField: "bid", ...overrides });
}

function putSell(overrides: Partial<OptionLegDraft> = {}): OptionLegDraft {
  return leg({ optionType: "put", side: "sell", conservativePriceField: "bid", ...overrides });
}

function leg(overrides: Partial<OptionLegDraft>): OptionLegDraft {
  return {
    id: "leg",
    optionType: "call",
    side: "buy",
    expiry: "2027-01-15",
    dte: 180,
    strikePrice: 105,
    conservativePrice: 5,
    conservativePriceField: "ask",
    quantity: 1,
    liquidityWarnings: [],
    missingFields: [],
    ...overrides,
  };
}
