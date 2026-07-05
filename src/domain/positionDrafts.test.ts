import { describe, expect, it } from "vitest";
import type { OptionLegDraft, PublicScreeningCandidateInput, StrategySuitability } from "@/types/screening";
import { detectScreeningCompleteness } from "./screeningCompleteness";
import {
  buildAvoidAssignmentPutDraft,
  buildBuyToOwnPutDraft,
  buildCoveredCallDraft,
  buildLongCallDraft,
  buildPositionDraft,
  buildPositionDraftsForCandidate,
} from "./positionDrafts";

describe("position draft builders", () => {
  it("creates draft_ready when strategy fit, leg, and capital are ready", () => {
    const draft = buildLongCallDraft({
      symbol: "MSFT",
      strategySuitability: suitability("long_call", "fit"),
      legs: [callBuy({ conservativePrice: 5 })],
      capital: { availableCashUSD: 1_000, maxLossToleranceUSD: 700 },
    });

    expect(draft.status).toBe("draft_ready");
    expect(draft.requiredCapitalUSD).toBe(500);
    expect(draft.maxLossUSD).toBe(500);
    expect(draft.availableCashUSD).toBe(1_000);
  });

  it("keeps watch strategy at manual_review_required even when capital is ready", () => {
    const draft = buildLongCallDraft({
      symbol: "MSFT",
      strategySuitability: suitability("long_call", "watch"),
      legs: [callBuy({ conservativePrice: 5 })],
      capital: { availableCashUSD: 1_000, maxLossToleranceUSD: 700 },
    });

    expect(draft.status).toBe("manual_review_required");
  });

  it("keeps avoid strategy at not_ready", () => {
    const draft = buildLongCallDraft({
      symbol: "MSFT",
      strategySuitability: suitability("long_call", "avoid"),
      legs: [callBuy({ conservativePrice: 5 })],
      capital: { availableCashUSD: 1_000, maxLossToleranceUSD: 700 },
    });

    expect(draft.status).toBe("not_ready");
  });

  it("keeps missing legs at not_ready", () => {
    const draft = buildPositionDraft({
      symbol: "MSFT",
      strategy: "long_call",
      strategySuitability: suitability("long_call", "fit"),
      legs: [],
      capital: { availableCashUSD: 1_000, maxLossToleranceUSD: 700 },
    });

    expect(draft.status).toBe("not_ready");
    expect(draft.missingFields).toContain("legs");
  });

  it("keeps conservative price missing at not_ready", () => {
    const draft = buildLongCallDraft({
      symbol: "MSFT",
      strategySuitability: suitability("long_call", "fit"),
      legs: [callBuy({ conservativePrice: undefined })],
      capital: { availableCashUSD: 1_000, maxLossToleranceUSD: 700 },
    });

    expect(draft.status).toBe("not_ready");
    expect(draft.missingFields.join(" ")).toContain("conservativePrice");
  });

  it("builds cash secured put buy-to-own draft with strike capital", () => {
    const draft = buildBuyToOwnPutDraft({
      symbol: "MSFT",
      strategySuitability: suitability("cash_secured_put_buy_to_own", "fit"),
      legs: [putSell({ strikePrice: 95, conservativePrice: 2.5 })],
      capital: { assignmentCapitalAvailableUSD: 10_000 },
    });

    expect(draft.status).toBe("draft_ready");
    expect(draft.requiredCapitalUSD).toBe(9_500);
    expect(draft.maxLossUSD).toBe(9_250);
  });

  it("keeps avoid-assignment put at manual review when capital is otherwise ready", () => {
    const draft = buildAvoidAssignmentPutDraft({
      symbol: "MSFT",
      strategySuitability: suitability("cash_secured_put_avoid_assignment", "fit"),
      legs: [putSell({ strikePrice: 70, conservativePrice: 1.2 })],
      capital: { assignmentCapitalAvailableUSD: 10_000 },
    });

    expect(draft.status).toBe("manual_review_required");
    expect(draft.warnings.join(" ")).toContain("出口ルール");
  });

  it("keeps covered call not ready when stock shares are insufficient", () => {
    const draft = buildCoveredCallDraft({
      symbol: "MSFT",
      strategySuitability: suitability("covered_call", "fit"),
      legs: [callSell({ strikePrice: 104, conservativePrice: 2.3 })],
      capital: { stockShares: 50, stockCostBasisUSD: 90 },
    });

    expect(draft.status).toBe("not_ready");
  });

  it("builds multiple drafts for candidate leg selections", () => {
    const drafts = buildPositionDraftsForCandidate({
      symbol: "MSFT",
      strategySuitabilities: [suitability("long_call", "fit"), suitability("covered_call", "watch")],
      legSelections: [
        { strategy: "long_call", legs: [callBuy({ conservativePrice: 5 })] },
        { strategy: "covered_call", legs: [callSell({ conservativePrice: 2.3 })] },
      ],
      capital: { availableCashUSD: 1_000, maxLossToleranceUSD: 700, stockShares: 100, stockCostBasisUSD: 90 },
    });

    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.strategy)).toEqual(["long_call", "covered_call"]);
  });

  it("makes completeness Level 4 only when a draft_ready PositionDraft exists", () => {
    const readyCandidate = candidateWithDraft("draft_ready");
    const reviewCandidate = candidateWithDraft("manual_review_required");

    expect(detectScreeningCompleteness(readyCandidate).level).toBe("level_4_draft_ready");
    expect(detectScreeningCompleteness(reviewCandidate).level).toBe("level_3_option_ready");
  });
});

function candidateWithDraft(status: "draft_ready" | "manual_review_required"): PublicScreeningCandidateInput {
  return {
    symbol: "MSFT",
    market: "US",
    underlyingPrice: 100,
    chartAnalysis: {
      regime: "bullish_continuation",
      confidence: "high",
      primaryTimeframe: "daily",
      timeframes: [],
      reasons: ["chart ok"],
      warnings: [],
      missingFields: [],
    },
    optionCandidates: [
      {
        optionType: "call",
        expiry: "2027-01-15",
        dte: 180,
        strike: 103,
        bid: 4.8,
        ask: 5.2,
        volume: 100,
        openInterest: 500,
        iv: 0.32,
      },
    ],
    positionDrafts: [
      {
        id: "draft",
        strategy: "long_call",
        status,
        symbol: "MSFT",
        legs: [callBuy({ conservativePrice: 5.2 })],
        requiredCapitalUSD: 520,
        maxLossUSD: 520,
        availableCashUSD: 1_000,
        warnings: [],
        missingFields: [],
      },
    ],
  };
}

function suitability(strategy: StrategySuitability["strategy"], level: StrategySuitability["level"]): StrategySuitability {
  return {
    strategy,
    level,
    reasons: [],
    warnings: [],
    missingFields: [],
    nextChecks: [],
  };
}

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
