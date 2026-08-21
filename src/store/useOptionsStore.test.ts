import { describe, expect, it } from "vitest";
import type { TradeSimulation } from "@/types/domain";
import { migrateStoredLiveSimulation, normalizeSimulation, normalizeStoredSettings } from "./useOptionsStore";

describe("stored N-option standard setting migration", () => {
  it("migrates only the legacy 2.25 setting and preserves explicit custom settings", () => {
    const base = { beginnerMode: true, defaultMarginBufferMultiplier: 2, defaultNisaExpectedAnnualReturnPct: 9 };
    expect(normalizeStoredSettings({ ...base, defaultNOptionCommissionUSD: 2.25 }).defaultNOptionCommissionUSD).toBe(2.24);
    expect(normalizeStoredSettings({ ...base, defaultNOptionCommissionUSD: 3.1 }).defaultNOptionCommissionUSD).toBe(3.1);
  });
  it("persists the corresponding aggregate parent correction once for a confirmed N synthetic", () => {
    const synthetic = {
      id: "stored-nvda-synthetic", status: "open", ticker: "MNO", strategyType: "synthetic_forward", accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD", fxRateJPY: 150, expiryDate: "2026-12-18",
      optionLegs: [
        { id: "call", type: "call", side: "buy", strikeUSD: 210, premiumUSD: 26.25, quantity: 1, expiryDate: "2026-12-18" },
        { id: "put", type: "put", side: "sell", strikeUSD: 210, premiumUSD: 21.05, quantity: 1, expiryDate: "2026-12-18", putIntent: "accept_assignment" },
      ],
      optionEntryExecutions: [
        { id: "call-entry", legId: "call", tradeDate: "2026-08-13", contracts: 1, fillPriceUSD: 26.25, settlementCurrency: "USD", commissionUSD: 2.25, commissionSource: "standard_default", source: "manual", confirmed: true },
        { id: "put-entry", legId: "put", tradeDate: "2026-08-13", contracts: 1, fillPriceUSD: 21.05, settlementCurrency: "USD", commissionUSD: 2.25, commissionSource: "standard_default", source: "manual", confirmed: true },
      ],
      optionCloseExecutions: [],
      syntheticForwardTicket: { netFillPriceUSD: 5.2, actualTotalCommissionUSD: 4.5, entryCostUSD: 524.5, netFillSource: "leg_aggregate", actualTotalCommissionSource: "leg_aggregate", entryCostSource: "leg_aggregate" },
    } as unknown as TradeSimulation;
    const migrated = migrateStoredLiveSimulation(synthetic);
    expect(migrated.syntheticForwardTicket).toMatchObject({ actualTotalCommissionUSD: 4.48, entryCostUSD: 524.48 });
    expect(migrateStoredLiveSimulation(migrated)).toBe(migrated);
  });
});

describe("normalizeSimulation manual opening total cost persistence", () => {
  const baseSimulation: TradeSimulation = {
    id: "manual-total-cost-simulation",
    status: "entry_confirmation",
    name: "ALFA / API取込下書き",
    ticker: "ALFA",
    underlyingName: "Alpha Test",
    strategyType: "long_call",
    currentPriceUSD: 125,
    fxRateJPY: 123.456789,
    accountCode: "P",
    accountEnvironment: "PROD_P_JPY_SETTLEMENT",
    accountCurrency: "JPY",
    entryDate: "2026-08-12",
    expiryDate: "2027-01-15",
    dte: 156,
    referenceFxRateJPY: 123.456789,
    stockPosition: null,
    optionLegs: [
      {
        id: "alfa-leg",
        type: "call",
        side: "buy",
        strikeUSD: 125,
        premiumUSD: 12.34,
        quantity: 1,
        expiryDate: "2027-01-15",
        assignmentPolicy: "unknown",
      },
    ],
    optionEntryExecutions: [
      {
        id: "alfa-entry",
        legId: "alfa-leg",
        tradeDate: "2026-08-12",
        contracts: 1,
        fillPriceUSD: 12.34,
        settlementCurrency: "JPY",
        brokerBookedAmountJPY: -152817,
        brokerPremiumJPY: -152500,
        brokerTransactionCostJPY: 317,
        brokerCurrencyConversionCostJPY: -2000,
        brokerTotalTransactionCostJPY: -2317,
        brokerExchangeRateJPY: 123.456789,
        inputMode: "P_JPY_BROKER_STATEMENT",
        source: "saxo_api_estimate",
        confirmed: false,
        openingFieldSources: {
          brokerCurrencyConversionCostJPY: "manual",
          brokerTotalTransactionCostJPY: "manual",
        },
        openingFieldEvidence: {
          brokerCurrencyConversionCostJPY: {
            source: "manual",
            sourceField: "manual",
            capturedAt: "2026-08-12T05:17:58.499Z",
            completeness: "direct",
          },
          brokerTotalTransactionCostJPY: {
            source: "manual",
            sourceField: "manual",
            capturedAt: "2026-08-12T05:19:36.638Z",
            completeness: "direct",
          },
        },
      },
    ],
    optionCloseExecutions: [],
    brokerMarginJPY: 0,
    brokerMarginUSD: 0,
    marginBufferMultiplier: 1,
    marginUsagePercent: 0,
    availableCashJPY: 0,
    denominatorMode: "custom",
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    nisaExpectedAnnualReturnPct: 8,
    brokerCommissionUSD: 2.25,
  };

  it("preserves a manual negative total transaction cost through JSON serialize/deserialize and normalization", () => {
    const reloaded = normalizeSimulation(JSON.parse(JSON.stringify(baseSimulation)), "live");

    expect(reloaded.optionEntryExecutions?.[0]).toMatchObject({
      brokerCurrencyConversionCostJPY: -2000,
      brokerTotalTransactionCostJPY: -2317,
      openingFieldSources: {
        brokerCurrencyConversionCostJPY: "manual",
        brokerTotalTransactionCostJPY: "manual",
      },
    });
  });

  it("preserves a manually evidenced trade date through JSON serialize/deserialize and normalization", () => {
    const reloaded = normalizeSimulation(JSON.parse(JSON.stringify({
      ...baseSimulation,
      optionEntryExecutions: [{
        ...baseSimulation.optionEntryExecutions?.[0],
        tradeDate: "2026-08-13",
        openingFieldSources: { ...(baseSimulation.optionEntryExecutions?.[0].openingFieldSources ?? {}), tradeDate: "manual" },
        openingFieldEvidence: {
          ...(baseSimulation.optionEntryExecutions?.[0].openingFieldEvidence ?? {}),
          tradeDate: { source: "manual", sourceField: "manual", capturedAt: "2026-08-13T00:00:00.000Z", completeness: "direct" },
        },
      }],
    })), "live");

    expect(reloaded.optionEntryExecutions?.[0]).toMatchObject({
      tradeDate: "2026-08-13",
      openingFieldSources: { tradeDate: "manual" },
      openingFieldEvidence: { tradeDate: { source: "manual", sourceField: "manual" } },
    });
  });

  it("keeps an explicit zero distinct from an undefined missing value", () => {
    const explicitZero = normalizeSimulation(
      JSON.parse(JSON.stringify({
        ...baseSimulation,
        optionEntryExecutions: [
          {
            ...baseSimulation.optionEntryExecutions?.[0],
            brokerTotalTransactionCostJPY: 0,
          },
        ],
      })),
      "live",
    );
    const missing = normalizeSimulation(
      JSON.parse(JSON.stringify({
        ...baseSimulation,
        optionEntryExecutions: [
          {
            ...baseSimulation.optionEntryExecutions?.[0],
            brokerTotalTransactionCostJPY: undefined,
            openingFieldSources: {
              brokerCurrencyConversionCostJPY: "manual",
            },
            openingFieldEvidence: {
              brokerCurrencyConversionCostJPY: {
                source: "manual",
                sourceField: "manual",
                capturedAt: "2026-08-12T05:17:58.499Z",
                completeness: "direct",
              },
            },
          },
        ],
      })),
      "live",
    );

    expect(explicitZero.optionEntryExecutions?.[0].brokerTotalTransactionCostJPY).toBe(0);
    expect(missing.optionEntryExecutions?.[0].brokerTotalTransactionCostJPY).toBeUndefined();
  });
});

describe("normalizeSimulation stock settlement migration", () => {
  const baseSimulation: TradeSimulation = {
    id: "legacy-stock-settlement-simulation",
    status: "closed",
    name: "MNO covered call",
    ticker: "MNO",
    underlyingName: "NVIDIA",
    strategyType: "covered_call",
    currentPriceUSD: 202.76,
    fxRateJPY: 0,
    accountCode: "N",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    accountCurrency: "USD",
    entryDate: "2026-06-12",
    expiryDate: "2026-07-10",
    dte: 28,
    stockPosition: {
      shares: 0,
      averageCostUSD: 207.5,
      denominatorPriceMode: "average_cost",
    },
    optionLegs: [],
    optionEntryExecutions: [],
    optionCloseExecutions: [],
    brokerMarginJPY: 0,
    brokerMarginUSD: 0,
    marginBufferMultiplier: 1,
    marginUsagePercent: 0,
    availableCashJPY: 0,
    denominatorMode: "custom",
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    nisaExpectedAnnualReturnPct: 8,
    brokerCommissionUSD: 2.25,
  };

  it("migrates legacy memo-linked stock settlements into typed history linkage without returning them to pending", () => {
    const normalized = normalizeSimulation(JSON.parse(JSON.stringify({
      ...baseSimulation,
      stockSettlement: {
        enabled: true,
        kind: "manual_sale",
        settlementDate: "2026-06-23",
        shares: 100,
        sellPriceUSD: 202.76,
        costBasisUSD: 207.5,
        commissionUSD: 18.26,
        memo: "Saxo N口座 Stock売却履歴から作成。取引ID masked-trade。sourceCandidateId stable-stock-sale。既存の株式譲渡記録を更新。",
      },
    })), "live");

    expect(normalized.stockSettlement).toMatchObject({
      source: "saxo_history",
      sourceCandidateId: "stable-stock-sale",
      sourceTradeId: "masked-trade",
      confirmationStatus: "confirmed",
      completionStatus: "complete",
    });
  });

  it("keeps incomplete stock settlement records pending instead of auto-confirming them", () => {
    const normalized = normalizeSimulation(JSON.parse(JSON.stringify({
      ...baseSimulation,
      stockSettlement: {
        enabled: true,
        kind: "manual_sale",
        settlementDate: "",
        shares: 100,
        sellPriceUSD: 202.76,
        costBasisUSD: 0,
      },
    })), "live");

    expect(normalized.stockSettlement).toMatchObject({
      source: "manual",
      confirmationStatus: "pending",
      completionStatus: "incomplete",
    });
  });
});
