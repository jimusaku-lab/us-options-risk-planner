import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SaxoApiOrderSnapshot } from "@/features/saxo/saxoAccountSync";
import type { OptionLeg, TradeSimulation } from "@/types/domain";
import type { AccountInputs } from "@/store/useOptionsStore";
import {
  CloseDecisionCard,
  buildLongOptionValueSnapshot,
  buildOptionValueTimeline,
  buildOptionPriceComparison,
  buildSaxoOptionPremiumCandidateInput,
  calculateLongOptionCloseAnnualizedReturnPercent,
  calculateLongOptionExitBreakevenPriceUSD,
  calculateOptionValueProgress,
  getOptionValueProgressMessage,
  getPremiumCandidateManualInputGuidance,
  getLongOptionExitOrderLineCandidate,
  getPremiumCandidatePrice,
  isSaxoPriceFeedNoAccess,
  upsertOptionValueSnapshot,
} from "./CloseDecisionCard";

afterEach(() => cleanup());

function createAccountInputs(): AccountInputs {
  return {
    P: {
      accountCode: "P",
      currency: "JPY",
      cashBalance: 200_224,
      buyingPower: 200_224,
      marginAvailable: 200_224,
      marginUsagePercent: 0,
      updatedAt: "2026-07-05T00:00:00.000Z",
    },
    N: {
      accountCode: "N",
      currency: "USD",
      cashBalance: 10_000,
      buyingPower: 10_000,
      marginAvailable: 10_000,
      marginUsagePercent: 0,
      updatedAt: "2026-07-05T00:00:00.000Z",
    },
  };
}

function createSimulationWithLeg(leg: OptionLeg): TradeSimulation {
  return {
    id: `simulation-${leg.id}`,
    name: "Anonymous option",
    ticker: "ABC",
    strategyType: leg.side === "buy" ? "long_call" : "short_put",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    accountCode: "N",
    accountCurrency: "USD",
    status: "open",
    entryDate: "2026-06-01",
    expiryDate: leg.expiryDate,
    dte: 140,
    currentPriceUSD: 100,
    fxRateJPY: 155,
    brokerCommissionUSD: 2.24,
    denominatorMode: "broker_margin_only",
    nisaExpectedAnnualReturnPct: 5,
    optionLegs: [leg],
  } as TradeSimulation;
}

describe("at-a-glance option price comparison", () => {
  it("compares a short option entry price and buyback price in the same per-share unit", () => {
    expect(buildOptionPriceComparison(3.3, 2.31, "short")).toEqual({
      entryPriceUSD: 3.3,
      currentPriceUSD: 2.31,
      differenceUSD: expect.closeTo(-0.99),
      changePct: expect.closeTo(-30),
      isFavorable: true,
    });
  });

  it("does not calculate a difference when the current price is missing", () => {
    expect(buildOptionPriceComparison(3.3, undefined, "short")).toEqual({
      entryPriceUSD: 3.3,
      currentPriceUSD: null,
      differenceUSD: null,
      changePct: null,
      isFavorable: null,
    });
  });

  it("shows the comparison first and keeps fee totals in a collapsed breakdown", () => {
    const simulation = createSimulationWithLeg({
      id: "short-put-comparison",
      type: "put",
      side: "sell",
      strikeUSD: 320,
      premiumUSD: 3.3,
      closeCostUSD: 2.31,
      quantity: 1,
      expiryDate: "2026-08-21",
      putIntent: "avoid_assignment",
    });
    render(createElement(CloseDecisionCard, { simulation, onChange: vi.fn(), defaultOpen: true }));

    const comparison = screen.getByRole("region", { name: "オプション価格比較" });
    expect(comparison).toHaveTextContent("建玉時");
    expect(comparison).toHaveTextContent("$3.30 / 株");
    expect(comparison).toHaveTextContent("$2.31 / 株");
    expect(comparison).toHaveTextContent("-$0.99 / 株（-30.0%）");
    expect(screen.getByText("計算内訳")).toBeInTheDocument();
    expect(screen.getByText("今閉じた場合の概算損益（手数料後）")).toBeInTheDocument();
  });

  it("keeps a confirmed-closed composite leg read-only and leaves only the remaining leg editable", () => {
    const call = { id: "closed-call", type: "call" as const, side: "buy" as const, strikeUSD: 100, premiumUSD: 2, closeCostUSD: 3, quantity: 1, expiryDate: "2026-12-18" };
    const put = { id: "open-put", type: "put" as const, side: "sell" as const, strikeUSD: 100, premiumUSD: 2, quantity: 1, expiryDate: "2026-12-18", putIntent: "avoid_assignment" as const };
    const simulation = { ...createSimulationWithLeg(call), strategyType: "synthetic_forward" as const, optionLegs: [call, put], optionCloseExecutions: [{ id: "call-close", legId: "closed-call", closeKind: "buyback" as const, confirmed: true, closeDate: "2026-08-20", contracts: 1, settlementCurrency: "USD" as const, source: "manual" as const }] };
    render(createElement(CloseDecisionCard, { simulation, onChange: vi.fn(), defaultOpen: true }));
    const closed = document.getElementById("close-decision-call-closed-call")!;
    expect(closed).toHaveTextContent("決済済み");
    expect(closed.querySelector("input")).toBeNull();
    expect(document.getElementById("close-decision-put-open-put")?.querySelector("input")).not.toBeNull();
  });
});

function createLongCallSimulation(overrides: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    id: "long-call",
    name: "V C340 long call",
    ticker: "V",
    strategyType: "long_call",
    status: "open",
    accountEnvironment: "PROD_P_JPY_SETTLEMENT",
    entryDate: "2026-06-30",
    expiryDate: "2026-11-20",
    dte: 143,
    currentPriceUSD: 360,
    fxRateJPY: 164.23105,
    referenceFxRateJPY: 164.23105,
    brokerCommissionUSD: 2.25,
    brokerCommissionJPY: 0,
    exchangeFeesJPY: 0,
    fxConversionCostJPY: 0,
    carryingCostJPY: 0,
    brokerMarginJPY: 0,
    marginBufferMultiplier: 1,
    availableCashJPY: 0,
    denominatorMode: "custom",
    stockPosition: null,
    optionLegs: [
      {
        id: "long-call-leg",
        type: "call",
        side: "buy",
        strikeUSD: 340,
        premiumUSD: 24.1,
        quantity: 1,
        expiryDate: "2026-11-20",
        closeCostUSD: 36.4,
        closePlan: {
          enabled: true,
          closePriceUSD: 36.4,
          profitTargetPriceUSD: 33,
          stopLossPriceUSD: 11,
          commissionUSD: 2.25,
        },
      },
    ],
    ...overrides,
  } as TradeSimulation;
}

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
    }, "buy")).toBe(21.9);
  });

  it("treats NoAccess as price feed permission missing and never adopts quote fields", () => {
    const candidate = {
      environment: "live" as const,
      fetchedAt: "2026-07-02T00:00:00.000Z",
      status: "unavailable" as const,
      classification: "Saxo API価格フィード権限なし",
      source: "trade/v1/infoprices/list",
      bid: 22,
      ask: 22.5,
      last: 21.75,
      mid: 22.25,
      message: "Saxo API価格フィード権限なし。",
      quoteDiagnostics: {
        reasonLabel: "Saxo API価格フィード権限なし",
        priceTypeBid: "NoAccess",
        priceTypeAsk: "NoAccess",
      },
    };

    expect(isSaxoPriceFeedNoAccess(candidate)).toBe(true);
    expect(getPremiumCandidatePrice(candidate)).toBeNull();
    expect(getPremiumCandidateManualInputGuidance(candidate)).toBe(
      "SaxoTraderGOのBid、または実際に使う売却指値を「現在オプション価格」に手入力してください。既存の手入力値は自動で上書きしません。",
    );
  });
});

describe("long option close annualized return", () => {
  it("calculates the offset-sale option price breakeven including entry and close fees", () => {
    expect(calculateLongOptionExitBreakevenPriceUSD({
      paidPremiumUSD: 2410,
      openCommissionUSD: 2.25,
      closeCommissionUSD: 2.25,
      quantity: 1,
    })).toBeCloseTo(24.145, 8);
  });

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

describe("long option exit proceeds preview", () => {
  it("shows P account JPY exit proceeds and projected P cash after close", () => {
    render(
      createElement(CloseDecisionCard, {
        simulation: createLongCallSimulation(),
        onChange: () => undefined,
        defaultOpen: true,
        accountInputs: createAccountInputs(),
      }),
    );

    expect(screen.getAllByText("反対売買時の参考受取額").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/手数料後 597,432円 \/ \$3,637.75/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("P口座現金残高").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/現在 200,224円 \/ 決済後見込み 797,656円/).length).toBeGreaterThan(0);
  });

  it("does not mix P account cash into an N account long option", () => {
    render(
      createElement(CloseDecisionCard, {
        simulation: createLongCallSimulation({
          id: "long-call-n",
          accountEnvironment: "PROD_N_USD_SETTLEMENT",
        }),
        onChange: () => undefined,
        defaultOpen: true,
        accountInputs: createAccountInputs(),
      }),
    );

    expect(screen.queryByText("P口座現金残高")).toBeNull();
    expect(screen.getAllByText("N口座USD現金残高").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/現在 \$10,000.00 \/ 決済後見込み \$13,637.75/).length).toBeGreaterThan(0);
  });
});

describe("long call time value decay snapshots", () => {
  it("breaks current option price into intrinsic and time value", () => {
    const snapshot = buildLongOptionValueSnapshot({
      snapshotDate: "2026-07-03",
      underlyingPrice: 360,
      optionExitPrice: 36.4,
      strike: 340,
      expiry: "2026-11-20",
      dte: 140,
      optionType: "call",
      source: "manual",
    });

    expect(snapshot?.intrinsicValue).toBeCloseTo(20, 8);
    expect(snapshot?.timeValue).toBeCloseTo(16.4, 8);
    expect(snapshot?.timeValueRatio).toBeCloseTo(16.4 / 36.4, 8);
  });

  it("compares intrinsic progress against time value decay", () => {
    const previous = buildLongOptionValueSnapshot({
      snapshotDate: "2026-07-01",
      underlyingPrice: 352,
      optionExitPrice: 31,
      strike: 340,
      expiry: "2026-11-20",
      dte: 142,
      optionType: "call",
      source: "manual",
    });
    const current = buildLongOptionValueSnapshot({
      snapshotDate: "2026-07-03",
      underlyingPrice: 360,
      optionExitPrice: 36.4,
      strike: 340,
      expiry: "2026-11-20",
      dte: 140,
      optionType: "call",
      source: "manual",
    });
    const progress = calculateOptionValueProgress([previous, current].filter(Boolean) as NonNullable<typeof previous>[]);

    expect(progress?.elapsedDays).toBe(2);
    expect(progress?.intrinsicGain).toBeCloseTo(8, 8);
    expect(progress?.timeValueChange).toBeCloseTo(-2.6, 8);
    expect(progress?.timeValueDecay).toBeCloseTo(2.6, 8);
    expect(progress?.netOptionMove).toBeCloseTo(5.4, 8);
    expect(progress?.decayPerDay).toBeCloseTo(1.3, 8);
    expect(progress?.intrinsicGainPerDay).toBeCloseTo(4, 8);
  });

  it("keeps the Visa observed time-value increase out of the decay warning", () => {
    const previous = buildLongOptionValueSnapshot({
      snapshotDate: "2026-07-28",
      capturedAt: "2026-07-28T14:00:00.000Z",
      underlyingPrice: 362.54,
      optionExitPrice: 36.63,
      strike: 340,
      expiry: "2026-11-20",
      dte: 115,
      optionType: "call",
      source: "manual",
    });
    const current = buildLongOptionValueSnapshot({
      snapshotDate: "2026-07-29",
      capturedAt: "2026-07-29T14:00:00.000Z",
      underlyingPrice: 361.42,
      optionExitPrice: 39.8,
      strike: 340,
      expiry: "2026-11-20",
      dte: 114,
      optionType: "call",
      source: "manual",
    });

    const progress = calculateOptionValueProgress([previous, current].filter(Boolean) as NonNullable<typeof previous>[]);

    expect(progress?.timeValueChange).toBeCloseTo(4.29, 8);
    expect(progress?.netOptionMove).toBeCloseTo(3.17, 8);
    expect(progress?.timeValueDirection).toBe("increase");
    expect(getOptionValueProgressMessage(progress ?? null)).toBe("前回観測比で時間価値は増加しています。");
  });

  it("reports decrease, unchanged put value, and insufficient comparison data distinctly", () => {
    const callPrevious = buildLongOptionValueSnapshot({
      snapshotDate: "2026-07-28", underlyingPrice: 360, optionExitPrice: 30, strike: 340, expiry: "2026-11-20", dte: 115, optionType: "call", source: "saxo",
    });
    const callCurrent = buildLongOptionValueSnapshot({
      snapshotDate: "2026-07-29", underlyingPrice: 360, optionExitPrice: 28, strike: 340, expiry: "2026-11-20", dte: 114, optionType: "call", source: "saxo",
    });
    const putPrevious = buildLongOptionValueSnapshot({
      snapshotDate: "2026-07-28", underlyingPrice: 90, optionExitPrice: 13, strike: 100, expiry: "2026-11-20", dte: 115, optionType: "put", source: "manual",
    });
    const putCurrent = buildLongOptionValueSnapshot({
      snapshotDate: "2026-07-29", underlyingPrice: 92, optionExitPrice: 11, strike: 100, expiry: "2026-11-20", dte: 114, optionType: "put", source: "manual",
    });

    const decrease = calculateOptionValueProgress([callPrevious, callCurrent].filter(Boolean) as NonNullable<typeof callPrevious>[]);
    const unchangedPut = calculateOptionValueProgress([putPrevious, putCurrent].filter(Boolean) as NonNullable<typeof putPrevious>[]);
    const incomplete = { ...putCurrent!, source: "unknown" as never };

    expect(decrease?.timeValueDirection).toBe("decrease");
    expect(getOptionValueProgressMessage(decrease ?? null)).toContain("時間価値は減少しています");
    expect(unchangedPut?.timeValueChange).toBe(0);
    expect(unchangedPut?.timeValueDirection).toBe("unchanged");
    expect(getOptionValueProgressMessage(unchangedPut ?? null)).toBe("前回観測比で時間価値に大きな変化はありません。");
    expect(calculateOptionValueProgress([putPrevious!, incomplete])).toBeNull();
    expect(getOptionValueProgressMessage(null)).toBe("比較データ不足");
  });

  it("updates the same-day snapshot and keeps the timeline sorted", () => {
    const first = buildLongOptionValueSnapshot({
      snapshotDate: "2026-07-03",
      underlyingPrice: 358,
      optionExitPrice: 34,
      strike: 340,
      expiry: "2026-11-20",
      dte: 140,
      optionType: "call",
      source: "manual",
    });
    const replacement = buildLongOptionValueSnapshot({
      snapshotDate: "2026-07-03",
      underlyingPrice: 360,
      optionExitPrice: 36.4,
      strike: 340,
      expiry: "2026-11-20",
      dte: 140,
      optionType: "call",
      source: "saxo",
    });
    const earlier = buildLongOptionValueSnapshot({
      snapshotDate: "2026-07-01",
      underlyingPrice: 352,
      optionExitPrice: 31,
      strike: 340,
      expiry: "2026-11-20",
      dte: 142,
      optionType: "call",
      source: "manual",
    });

    const snapshots = upsertOptionValueSnapshot([earlier, first].filter(Boolean) as OptionLeg["valueSnapshots"], replacement!);
    const timeline = buildOptionValueTimeline(snapshots, null);

    expect(timeline.map((snapshot) => snapshot.snapshotDate)).toEqual(["2026-07-01", "2026-07-03"]);
    expect(timeline[1].optionExitPrice).toBe(36.4);
    expect(timeline[1].source).toBe("saxo");
  });

  it("confirms a close-fee candidate without creating a close execution or changing status", () => {
    const leg: OptionLeg = { id: "fee-leg", type: "put", side: "sell", strikeUSD: 100, premiumUSD: 2, quantity: 2, expiryDate: "2026-11-20", closeCostUSD: 1 };
    const simulation = createLongCallSimulation({ accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD", optionLegs: [leg] });
    const onChange = vi.fn();
    render(createElement(CloseDecisionCard, { simulation, onChange, defaultOpen: true }));
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent?.includes("Saxo決済チケット確認済み標準 / 2契約 / 2026-08-14確認") === true)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /この標準手数料で見込み計算/ })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(simulation.status).toBe("open");
    expect(simulation.optionCloseExecutions).toBeUndefined();
    expect(simulation.optionLegs[0].closePlan).toBeUndefined();
  });
});
