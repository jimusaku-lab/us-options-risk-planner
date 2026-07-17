import { describe, expect, it } from "vitest";
import { createOptionCloseExecutionDraft } from "@/domain/optionCloseExecutions";
import {
  createAccountPatchFromSaxoSnapshot,
  createSaxoAccountDiffRows,
  createSaxoSetupGuidance,
  createSaxoPositionDraftSummary,
  findEntryHistoryMatches,
  findSaxoAssignmentStockAcquisitionItem,
  findSaxoSyntheticForwardPairing,
  findSaxoSyntheticForwardPairs,
  findSaxoSyntheticForwardParentHistory,
  resolveSaxoSyntheticForwardFillEvidence,
  findOrderCandidatesForLeg,
  getSaxoHistoryCandidateKeys,
  getSaxoHistoryCandidateTarget,
  getSaxoHistoryCandidateTargetForSimulations,
  getSaxoHistoryContractsForLeg,
  getSaxoHistoryOptionLegMatchDiagnostics,
  getSaxoHistoryStableKey,
  getSaxoAccountReflectionBlockReason,
  reconcileSaxoPositions,
  resolveSaxoHistoryOptionLegMatch,
  resolveSaxoPositionSymbol,
  hasAppliedSaxoSnapshot,
  hasConfirmedMappingForAccount,
  isForbiddenSaxoOrderRoute,
  isSaxoHistoryPutAssignmentOptionCandidate,
  isSaxoHistoryMatchingOptionLeg,
  maskSaxoIdentifier,
  SAXO_CLOSE_ACCOUNT_CONFIRMATION_WARNING,
  SAXO_READONLY_ENDPOINTS,
  type SaxoApiOrderSnapshot,
  type SaxoApiPositionSnapshot,
  type SaxoAccountMapping,
  type SaxoApiAccountSnapshot,
  type SaxoHistoryDiscoveryItem,
} from "@/features/saxo/saxoAccountSync";
import type { AccountState, TradeSimulation } from "@/types/domain";

const pAccount: AccountState = {
  accountCode: "P",
  accountEnvironment: "PROD_P_JPY_SETTLEMENT",
  currency: "JPY",
  cashBalance: 100_000,
  buyingPower: 80_000,
  accountValue: 120_000,
  marginAvailable: 70_000,
  marginUsagePercent: 20,
  updatedAt: "2026-06-08T00:00:00.000Z",
};

describe("Saxo read-only account sync", () => {
  it("only allows read-only local order endpoints", () => {
    expect(SAXO_READONLY_ENDPOINTS).toContain("GET /api/saxo/orders");
    expect(SAXO_READONLY_ENDPOINTS).toContain("GET /api/saxo/orders/snapshot");
    expect(isForbiddenSaxoOrderRoute("/api/saxo/orders")).toBe(false);
    expect(isForbiddenSaxoOrderRoute("/api/saxo/orders", "POST")).toBe(true);
    expect(isForbiddenSaxoOrderRoute("/trade/v2/orders")).toBe(true);
    expect(isForbiddenSaxoOrderRoute("/api/saxo/accounts/snapshot")).toBe(false);
    expect(isForbiddenSaxoOrderRoute("/api/saxo/positions")).toBe(false);
    expect(SAXO_READONLY_ENDPOINTS).toContain("GET /api/saxo/positions");
    expect(SAXO_READONLY_ENDPOINTS).toContain("GET /api/saxo/positions/snapshot");
  });

  it("creates a diff preview without treating missing Saxo values as zero", () => {
    const snapshot: SaxoApiAccountSnapshot = {
      accountKey: "account-p",
      currency: "JPY",
      values: {
        cashBalance: 110_000,
        marginUsagePercent: undefined,
      },
      missingFields: ["marginUsagePercent"],
      fetchedAt: "2026-06-08T10:00:00.000Z",
    };

    const rows = createSaxoAccountDiffRows(pAccount, snapshot);

    expect(rows.find((row) => row.field === "cashBalance")?.status).toBe("changed");
    expect(rows.find((row) => row.field === "marginUsagePercent")?.status).toBe("missing");
    expect(rows.find((row) => row.field === "marginUsagePercent")?.saxoValue).toBeUndefined();
  });

  it("only applies fields that were fetched from Saxo", () => {
    const snapshot: SaxoApiAccountSnapshot = {
      accountKey: "account-p",
      currency: "JPY",
      values: {
        cashBalance: 110_000,
        marginAvailable: undefined,
      },
      missingFields: ["marginAvailable"],
      fetchedAt: "2026-06-08T10:00:00.000Z",
    };

    const patch = createAccountPatchFromSaxoSnapshot(snapshot);

    expect(patch.cashBalance).toBe(110_000);
    expect(patch.marginAvailable).toBeUndefined();
    expect(patch.updatedAt).toBe(snapshot.fetchedAt);
  });

  it("requires user-confirmed P/N mapping before account reflection", () => {
    const mappings: SaxoAccountMapping[] = [
      {
        workspace: "real",
        accountKey: "p-key",
        currency: "JPY",
        mappedCode: "P",
        environment: "live",
        confirmedByUser: true,
      },
      {
        workspace: "real",
        accountKey: "n-key",
        currency: "USD",
        mappedCode: "N",
        environment: "live",
        confirmedByUser: false,
      },
    ];

    expect(hasConfirmedMappingForAccount(mappings, "P")).toBe(true);
    expect(hasConfirmedMappingForAccount(mappings, "N")).toBe(false);
  });

  it("blocks reflecting SIM trial or mismatched currency accounts into the real workspace", () => {
    const mapping: SaxoAccountMapping = {
      workspace: "real",
      accountKey: "sim-trial-key",
      currency: "EUR",
      mappedCode: "P",
      environment: "sim",
      isTrialAccount: true,
      confirmedByUser: true,
    };
    const snapshot: SaxoApiAccountSnapshot = {
      accountKey: "sim-trial-key",
      currency: "EUR",
      environment: "sim",
      isTrialAccount: true,
      values: {
        cashBalance: 1_000_000,
        buyingPower: 1_000_000,
        accountValue: 1_000_000,
        marginAvailable: 1_000_000,
        marginUsagePercent: 0,
      },
      missingFields: [],
      fetchedAt: "2026-06-09T07:27:41.133Z",
    };

    expect(getSaxoAccountReflectionBlockReason({ workspace: "live", account: pAccount, mapping, snapshot })).toContain(
      "REALワークスペースにはSaxo SIM口座の値を反映できません",
    );
  });

  it("blocks reflecting a Saxo account when its currency differs from the app account currency", () => {
    const mapping: SaxoAccountMapping = {
      workspace: "demo",
      accountKey: "eur-key",
      currency: "EUR",
      mappedCode: "P",
      environment: "sim",
      confirmedByUser: true,
    };
    const snapshot: SaxoApiAccountSnapshot = {
      accountKey: "eur-key",
      currency: "EUR",
      environment: "sim",
      values: { cashBalance: 1_000_000 },
      missingFields: [],
      fetchedAt: "2026-06-09T07:27:41.133Z",
    };

    expect(getSaxoAccountReflectionBlockReason({ workspace: "demo", account: pAccount, mapping, snapshot })).toContain(
      "口座通貨が一致しません",
    );
  });

  it("masks Saxo identifiers before they are shown in reports or UI", () => {
    expect(maskSaxoIdentifier("1234567890abcdef")).toBe("1234...cdef");
    expect(maskSaxoIdentifier("short")).toBe("****");
    expect(maskSaxoIdentifier()).toBe("未取得");
  });

  it("detects already-applied Saxo snapshots to prevent double reflection", () => {
    const snapshot: SaxoApiAccountSnapshot = {
      accountKey: "account-p",
      currency: "JPY",
      values: { cashBalance: 110_000 },
      missingFields: [],
      fetchedAt: "2026-06-08T10:00:00.000Z",
    };
    const account: AccountState = {
      ...pAccount,
      saxoSyncHistory: [
        {
          id: "history-1",
          source: "saxo_api",
          accountKey: "account-p",
          fetchedAt: "2026-06-08T10:00:00.000Z",
          appliedAt: "2026-06-08T10:01:00.000Z",
          appliedFields: ["cashBalance"],
        },
      ],
    };

    expect(hasAppliedSaxoSnapshot(account, snapshot)).toBe(true);
  });

  it("separates local API down, missing client id, and missing environment guidance", () => {
    expect(createSaxoSetupGuidance(null).code).toBe("local_api_down");

    expect(
      createSaxoSetupGuidance({
        mode: "saxo_readonly",
        connected: false,
        environment: "sim",
        environmentConfigured: true,
        hasToken: false,
        readOnly: true,
        orderEndpointsEnabled: false,
        oauthConfigured: false,
      }).code,
    ).toBe("missing_client_id");

    expect(
      createSaxoSetupGuidance({
        mode: "saxo_readonly",
        connected: false,
        environment: "sim",
        environmentConfigured: false,
        hasToken: false,
        readOnly: true,
        orderEndpointsEnabled: false,
        oauthConfigured: true,
      }).code,
    ).toBe("missing_environment");
  });

  it("matches assigned Saxo option positions against existing app legs", () => {
    const simulation = createOpenPutSimulation();
    const position: SaxoApiPositionSnapshot = {
      id: "pos-1",
      accountKey: "p-key",
      accountAssignment: "P",
      accountCode: "P",
      symbol: "NVDA",
      assetType: "StockOption",
      kind: "option",
      quantity: -1,
      side: "short",
      optionType: "put",
      strike: 200,
      expiry: "2026-06-05",
      premiumOpenPrice: 1.16,
      currentOptionPrice: 0.17,
      currency: "USD",
      missingFields: [],
      fetchedAt: "2026-06-09T00:00:00.000Z",
    };

    const rows = reconcileSaxoPositions([simulation], [position]);

    expect(rows[0].status).toBe("matched");
    expect(rows[0].simulation?.id).toBe(simulation.id);
  });

  it("groups NVDA C210 long and P210 short into one synthetic-forward candidate and uses its parent fill", () => {
    const base = {
      accountKey: "n-account-1234",
      accountAssignment: "N" as const,
      accountCode: "N" as const,
      symbol: "NVDA",
      underlyingSymbol: "NVDA",
      underlyingIdentity: "uic:12345:stock",
      assetType: "StockOption",
      kind: "option" as const,
      quantity: 1,
      expiry: "2026-12-18",
      strike: 210,
      currency: "USD",
      missingFields: [],
      fetchedAt: "2026-07-16T00:00:00.000Z",
    };
    const call: SaxoApiPositionSnapshot = { ...base, id: "nvda-c210", positionId: "call-position", side: "long", optionType: "call" };
    const put: SaxoApiPositionSnapshot = { ...base, id: "nvda-p210", positionId: "put-position", quantity: -1, side: "short", optionType: "put" };

    const pairs = findSaxoSyntheticForwardPairs([call, put]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ ticker: "NVDA", accountCode: "N", expiry: "2026-12-18", strike: 210, quantity: 1 });
    expect(findSaxoSyntheticForwardParentHistory(pairs[0], [
      { id: "other", kind: "trade", accountKey: "n-ac...1234", accountCode: "N", symbol: "NVDA", assetType: "StockOption", price: 99 },
      { id: "parent", orderId: "5425367936", kind: "trade", accountKey: "n-ac...1234", accountCode: "N", symbol: "NVDA SyntheticUnderlying", assetType: "SyntheticUnderlying", price: 5.85 },
    ])).toMatchObject({ orderId: "5425367936", price: 5.85 });
    expect(findSaxoSyntheticForwardPairs([{ ...put, strike: 211 }, call])).toHaveLength(0);
    expect(findSaxoSyntheticForwardPairs([
      { ...call, optionType: "unknown", strike: undefined, expiry: undefined, symbol: "NVDA/18Z26C210:XCBF" },
      { ...put, optionType: "unknown", strike: undefined, expiry: undefined, symbol: "NVDA/18Z26P210:XCBF" },
    ])).toMatchObject([{ expiry: "2026-12-18", strike: 210, ticker: "NVDA" }]);
    const held = findSaxoSyntheticForwardPairing([
      { ...call, underlyingIdentity: undefined, underlyingSymbol: undefined, symbol: "" },
      { ...put, underlyingIdentity: undefined, underlyingSymbol: undefined, symbol: "" },
    ]);
    expect(held.pairs).toHaveLength(0);
    expect(held.holds).toMatchObject([{ reason: "原資産識別子をSaxoから取得できませんでした。" }]);
  });

  it("requires the parent and both leg trades before treating a synthetic forward as filled", () => {
    const base = { accountKey: "n-account-1234", accountAssignment: "N" as const, accountCode: "N" as const, symbol: "NVDA", underlyingSymbol: "NVDA", underlyingIdentity: "uic:12345:stock", assetType: "StockOption", kind: "option" as const, expiry: "2026-12-18", strike: 210, currency: "USD", missingFields: [], fetchedAt: "2026-07-17T00:00:00.000Z" };
    const call: SaxoApiPositionSnapshot = { ...base, id: "call", positionId: "call-position", quantity: 1, side: "long", optionType: "call", premiumOpenPrice: 26.25 };
    const put: SaxoApiPositionSnapshot = { ...base, id: "put", positionId: "put-position", quantity: -1, side: "short", optionType: "put", premiumOpenPrice: 21.05 };
    const pair = findSaxoSyntheticForwardPairs([call, put])[0];
    const parent: SaxoHistoryDiscoveryItem = { id: "parent-trade", orderId: "5425367936", kind: "trade", accountKey: "n-ac...1234", accountCode: "N", symbol: "NVDA SyntheticUnderlying", assetType: "SyntheticUnderlying", quantity: 1, buySell: "buy", price: 5.85, tradeDate: "2026-07-16", currency: "USD" };
    const callTrade: SaxoHistoryDiscoveryItem = { id: "call-trade", kind: "trade", accountKey: "n-ac...1234", accountCode: "N", symbol: "NVDA", assetType: "StockOption", optionType: "call", strike: 210, expiry: "2026-12-18", quantity: 1, buySell: "buy", openClose: "open", price: 26.25, tradeDate: "2026-07-16", currency: "USD" };
    const putTrade: SaxoHistoryDiscoveryItem = { id: "put-trade", kind: "trade", accountKey: "n-ac...1234", accountCode: "N", symbol: "NVDA", assetType: "StockOption", optionType: "put", strike: 210, expiry: "2026-12-18", quantity: 1, buySell: "sell", openClose: "open", price: 21.05, tradeDate: "2026-07-16", currency: "USD" };
    expect(resolveSaxoSyntheticForwardFillEvidence(pair, [parent, callTrade, putTrade])).toMatchObject({ status: "filled", parentHistory: { orderId: "5425367936", price: 5.85 }, callHistory: { price: 26.25 }, putHistory: { price: 21.05 }, missing: [] });
    expect(resolveSaxoSyntheticForwardFillEvidence(pair, [parent, callTrade])).toMatchObject({ status: "incomplete", missing: ["put"] });
  });

  it("links an executed Saxo covered call to the existing planned covered call even when strike and premium differ", () => {
    const simulation = createOpenPutSimulation({
      id: "planned-covered-call",
      status: "planned",
      name: "NVDA covered call planned",
      strategyType: "covered_call",
      accountCode: "N",
      accountEnvironment: "PROD_N_USD_SETTLEMENT",
      accountCurrency: "USD",
      entryDate: "2026-06-18",
      expiryDate: "2026-07-10",
      denominatorMode: "stock_plus_margin",
      stockPosition: {
        shares: 100,
        averageCostUSD: 207.5,
        denominatorPriceMode: "average_cost",
      },
      optionLegs: [
        {
          id: "leg-call",
          type: "call",
          side: "sell",
          strikeUSD: 230,
          premiumUSD: 1.4,
          quantity: 0,
          expiryDate: "2026-07-10",
          isCovered: true,
        },
      ],
    });
    const position: SaxoApiPositionSnapshot = {
      id: "saxo-covered-call-225",
      accountKey: "n-key",
      accountAssignment: "N",
      accountCode: "N",
      symbol: "NVDA",
      assetType: "StockOption",
      kind: "option",
      quantity: -1,
      side: "short",
      optionType: "call",
      strike: 225,
      expiry: "2026-07-10",
      premiumOpenPrice: 1.83,
      currentOptionPrice: 1.57,
      currency: "USD",
      missingFields: [],
      fetchedAt: "2026-06-18T13:34:40.000Z",
    };

    const rows = reconcileSaxoPositions([simulation], [position]);

    expect(rows[0].status).toBe("price_diff");
    expect(rows[0].simulation?.id).toBe(simulation.id);
    expect(rows[0].detail).toContain("権利行使価格差");
    expect(rows[0].detail).toContain("価格差");
  });

  it("resolves a missing Saxo position symbol from a unique matching app leg", () => {
    const simulation = createOpenPutSimulation();
    const position: SaxoApiPositionSnapshot = {
      id: "pos-missing-symbol",
      accountKey: "p-key",
      accountAssignment: "P",
      accountCode: "P",
      assetType: "StockOption",
      kind: "option",
      quantity: -1,
      side: "short",
      optionType: "put",
      strike: 200,
      expiry: "2026-06-05",
      premiumOpenPrice: 1.16,
      currency: "USD",
      missingFields: ["symbol"],
      fetchedAt: "2026-06-09T00:00:00.000Z",
    };

    expect(resolveSaxoPositionSymbol(position, [simulation])).toBe("NVDA");

    const draft = createSaxoPositionDraftSummary(position, [simulation]);
    expect(draft.ticker).toBe("NVDA");
    expect(draft.name).toContain("NVDA");
  });

  it("resolves the underlying ticker from a Saxo option instrument code when position symbol is blank", () => {
    const position: SaxoApiPositionSnapshot = {
      id: "pos-nvda-p195",
      accountKey: "n-key",
      accountAssignment: "N",
      accountCode: "N",
      symbol: "",
      instrumentCode: "NVDA/24N26P195:XCBF",
      assetType: "StockOption",
      kind: "option",
      quantity: -1,
      side: "short",
      optionType: "put",
      strike: 195,
      expiry: "2026-07-24",
      premiumOpenPrice: 3.75,
      currency: "USD",
      missingFields: [],
      fetchedAt: "2026-07-01T00:00:00.000Z",
    };

    expect(resolveSaxoPositionSymbol(position)).toBe("NVDA");
    expect(createSaxoPositionDraftSummary(position).ticker).toBe("NVDA");
  });

  it("reconciles assigned Saxo option positions even when Saxo omits the symbol but the option shape is unique", () => {
    const simulation = createOpenPutSimulation();
    const position: SaxoApiPositionSnapshot = {
      id: "pos-missing-symbol",
      accountKey: "p-key",
      accountAssignment: "P",
      accountCode: "P",
      assetType: "StockOption",
      kind: "option",
      quantity: -1,
      side: "short",
      optionType: "put",
      strike: 200,
      expiry: "2026-06-05",
      premiumOpenPrice: 1.16,
      currency: "USD",
      missingFields: ["symbol"],
      fetchedAt: "2026-06-09T00:00:00.000Z",
    };

    const rows = reconcileSaxoPositions([simulation], [position]);

    expect(rows[0].status).toBe("matched");
    expect(rows[0].simulation?.id).toBe(simulation.id);
  });

  it("does not reconcile unassigned Saxo accounts", () => {
    const rows = reconcileSaxoPositions([createOpenPutSimulation()], [
      {
        id: "pos-1",
        accountKey: "unknown-key",
        accountAssignment: "unassigned",
        symbol: "NVDA",
        assetType: "StockOption",
        kind: "option",
        quantity: -1,
        side: "short",
        optionType: "put",
        strike: 200,
        expiry: "2026-06-05",
        missingFields: [],
        fetchedAt: "2026-06-09T00:00:00.000Z",
      },
    ]);

    expect(rows[0].status).toBe("unknown");
    expect(rows[0].detail).toContain("P/N未割当");
  });

  it("finds Saxo exit order candidates for the matching option leg only", () => {
    const simulation = createOpenPutSimulation();
    const orders: SaxoApiOrderSnapshot[] = [
      {
        id: "order-1",
        accountKey: "p-key",
        accountAssignment: "P",
        accountCode: "P",
        symbol: "NVDA",
        assetType: "StockOption",
        quantity: 1,
        side: "buy",
        optionType: "put",
        strike: 200,
        expiry: "2026-06-05",
        orderType: "Limit",
        price: 0.2,
        isExitCandidate: true,
        missingFields: [],
        fetchedAt: "2026-06-09T00:00:00.000Z",
      },
      {
        id: "order-2",
        accountKey: "n-key",
        accountAssignment: "N",
        accountCode: "N",
        symbol: "NVDA",
        assetType: "StockOption",
        quantity: 1,
        side: "buy",
        optionType: "put",
        strike: 200,
        expiry: "2026-06-05",
        orderType: "Limit",
        price: 0.2,
        isExitCandidate: true,
        missingFields: [],
        fetchedAt: "2026-06-09T00:00:00.000Z",
      },
    ];

    const matches = findOrderCandidatesForLeg(simulation, simulation.optionLegs[0], orders);

    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("order-1");
  });

  it("classifies Saxo option history by open/close instead of buy/sell alone", () => {
    expect(
      getSaxoHistoryCandidateTarget({
        id: "open-sell",
        kind: "trade",
        assetType: "StockOption",
        buySell: "sell",
        openClose: "open",
      }),
    ).toBe("entry");
    expect(
      getSaxoHistoryCandidateTarget({
        id: "close-buy",
        kind: "trade",
        assetType: "StockOption",
        buySell: "buy",
        openClose: "close",
      }),
    ).toBe("close");
    expect(
      getSaxoHistoryCandidateTarget({
        id: "open-buy",
        kind: "trade",
        assetType: "StockOption",
        buySell: "buy",
        openClose: "open",
      }),
    ).toBe("entry");
    expect(
      getSaxoHistoryCandidateTarget({
        id: "unknown-buy",
        kind: "trade",
        assetType: "StockOption",
        buySell: "buy",
      }),
    ).toBe("entry");
    expect(
      getSaxoHistoryCandidateTarget({
        id: "covered-call-unknown-close-buy",
        kind: "trade",
        assetType: "StockOption",
        symbol: "NVDA/10N26C225:XCBF",
        buySell: "buy",
        openClose: "unknown",
        quantity: 1,
        price: 0.79,
      }),
    ).toBe("close");
    expect(
      getSaxoHistoryCandidateTarget({
        id: "unknown-sell-with-pnl",
        kind: "trade",
        assetType: "StockOption",
        buySell: "sell",
        profitLoss: 120,
      }),
    ).toBe("entry");
    expect(
      getSaxoHistoryCandidateTarget({
        id: "covered-call-open-sell",
        kind: "trade",
        assetType: "StockOption",
        symbol: "NVDA/10N26C225:XCBF",
        buySell: "sell",
        quantity: 1,
        price: 1.83,
        profitLoss: 183,
      }),
    ).toBe("entry");
    expect(
      getSaxoHistoryCandidateTarget({
        id: "stock-transfer-sell",
        kind: "trade",
        assetType: "Stock",
        symbol: "NVDA",
        buySell: "sell",
        openClose: "open",
        quantity: 100,
        price: 207.5,
      }),
    ).toBe("unknown");
    expect(
      getSaxoHistoryCandidateTarget({
        id: "stock-transfer-buy",
        kind: "trade",
        assetType: "Stock",
        symbol: "NVDA",
        buySell: "buy",
        openClose: "close",
        quantity: 100,
        price: 207.5,
      }),
    ).toBe("unknown");
    expect(
      getSaxoHistoryCandidateTarget({
        id: "n-stock-sale",
        kind: "trade",
        accountCode: "N",
        assetType: "Stock",
        symbol: "NVDA",
        buySell: "sell",
        quantity: 100,
        price: 202.76,
        transactionCost: 18.26,
        tradeDate: "2026-06-23",
      }),
    ).toBe("stock_settlement");
    expect(
      getSaxoHistoryCandidateTarget({
        id: "n-stock-sale-no-account-code",
        kind: "trade",
        assetType: "Stock",
        symbol: "NVIDIA Corp.",
        buySell: "sell",
        quantity: 100,
        price: 202.76,
        bookedAmount: 20257.74,
        transactionCost: -18.26,
        tradeDate: "2026-06-23",
      }),
    ).toBe("stock_settlement");
  });

  it("creates a stable Saxo history key independent of list index ids", () => {
    const first = {
      id: "trade-0",
      kind: "trade",
      sourceIdMasked: "1234...abcd",
      accountKey: "7780...5082",
      instrumentCode: "NVDA/05M26P200:XCBF",
      tradeDate: "2026-06-02",
      buySell: "buy",
      openClose: "close",
      quantity: 1,
      price: 0.13,
    } as const;
    const second = { ...first, id: "trade-2" };

    expect(getSaxoHistoryStableKey(first)).toBe(getSaxoHistoryStableKey(second));
    expect(getSaxoHistoryCandidateKeys(second)).toContain("trade-2");
    expect(getSaxoHistoryCandidateKeys(second)).toContain(getSaxoHistoryStableKey(first));
  });

  it("classifies zero-price put close as assignment instead of buyback close", () => {
    const item: SaxoHistoryDiscoveryItem = {
      id: "assignment-option",
      kind: "trade",
      accountKey: "p-key",
      accountCode: "P",
      symbol: "NVDA",
      assetType: "StockOption",
      optionType: "put",
      strike: 207.5,
      expiry: "2026-06-12",
      instrumentCode: "NVDA/12M26P207.5:XCBF",
      quantity: 1,
      buySell: "buy",
      openClose: "close",
      price: 0,
      tradeDate: "2026-06-12",
      currency: "USD",
    };

    expect(isSaxoHistoryPutAssignmentOptionCandidate(item)).toBe(true);
    expect(getSaxoHistoryCandidateTarget(item)).toBe("assignment");
  });

  it("classifies zero-price Saxo put history with unknown open/close as assignment from instrument code", () => {
    const item: SaxoHistoryDiscoveryItem = {
      id: "assignment-option-unknown-open-close",
      kind: "trade",
      accountKey: "p-key",
      accountCode: "P",
      symbol: "NVDA/12M26P207.5:XCBF",
      assetType: "StockOption",
      quantity: 1,
      buySell: "buy",
      openClose: "unknown",
      price: 0,
      tradeDate: "2026-06-12",
      currency: "USD",
    };

    expect(isSaxoHistoryPutAssignmentOptionCandidate(item)).toBe(true);
    expect(getSaxoHistoryCandidateTarget(item)).toBe("assignment");
  });

  it("pairs put assignment option history with stock acquisition history", () => {
    const optionItem: SaxoHistoryDiscoveryItem = {
      id: "assignment-option",
      kind: "trade",
      accountKey: "p-key",
      accountCode: "P",
      symbol: "NVDA",
      assetType: "StockOption",
      optionType: "put",
      strike: 207.5,
      expiry: "2026-06-12",
      instrumentCode: "NVDA/12M26P207.5:XCBF",
      quantity: 1,
      buySell: "buy",
      openClose: "close",
      price: 0,
      tradeDate: "2026-06-12",
      currency: "USD",
    };
    const stockItem: SaxoHistoryDiscoveryItem = {
      id: "assignment-stock",
      kind: "trade",
      accountKey: "p-key",
      accountCode: "P",
      symbol: "NVDA:XNAS",
      assetType: "Stock",
      quantity: 100,
      buySell: "buy",
      price: 207.5,
      tradeDate: "2026-06-13",
      currency: "USD",
    };
    const wrongStockItem: SaxoHistoryDiscoveryItem = {
      ...stockItem,
      id: "wrong-stock",
      symbol: "AMZN:XNAS",
    };

    expect(findSaxoAssignmentStockAcquisitionItem(optionItem, [wrongStockItem, stockItem])?.id).toBe("assignment-stock");
  });

  it("matches Saxo option instrument symbols to the underlying ticker for entry history", () => {
    const simulation = createOpenPutSimulation();
    const entryHistory: SaxoHistoryDiscoveryItem = {
      id: "entry-p200-option-symbol",
      kind: "trade",
      accountCode: "P",
      symbol: "NVDA/05M26P200:XCBF",
      assetType: "StockOption",
      optionType: "put",
      strike: 200,
      expiry: "2026-06-05",
      instrumentCode: "NVDA/05M26P200:XCBF",
      buySell: "sell",
      openClose: "open",
      quantity: -1,
      price: 1.16,
      bookedAmount: 17952,
    };

    expect(isSaxoHistoryMatchingOptionLeg(simulation, simulation.optionLegs[0], entryHistory, "entry")).toBe(true);
  });

  it("matches a Saxo call buy history draft to an open N covered call close", () => {
    const simulation = createOpenCoveredCallSimulation();
    const closeHistory: SaxoHistoryDiscoveryItem = {
      id: "nvda-c225-buyback",
      kind: "trade",
      accountCode: "N",
      symbol: "NVDA/10N26C225:XCBF",
      assetType: "StockOption",
      instrumentCode: "NVDA/10N26C225:XCBF",
      buySell: "buy",
      openClose: "unknown",
      quantity: 1,
      price: 0.79,
      tradeDate: "2026-06-23",
    };
    const leg = simulation.optionLegs[0];

    expect(getSaxoHistoryCandidateTarget(closeHistory)).toBe("close");
    expect(isSaxoHistoryMatchingOptionLeg(simulation, leg, closeHistory, "close")).toBe(true);

    const draft = createOptionCloseExecutionDraft({
      simulation,
      leg,
      closeKind: "buyback",
      closePriceUSD: closeHistory.price,
    });
    const execution = {
      ...draft,
      closeDate: closeHistory.tradeDate ?? draft.closeDate,
      contracts: getSaxoHistoryContractsForLeg(closeHistory, leg),
      closePriceUSD: closeHistory.price ?? draft.closePriceUSD,
      settlementCurrency: "USD" as const,
      source: "saxo_history" as const,
      sourceTradeId: closeHistory.id,
      confirmationStatus: "pending" as const,
      confirmed: false,
    };

    expect(execution.legId).toBe("leg-call-225");
    expect(execution.contracts).toBe(1);
    expect(execution.closeDate).toBe("2026-06-23");
    expect(execution.closePriceUSD).toBe(0.79);
    expect(execution.source).toBe("saxo_history");
    expect(execution.confirmationStatus).toBe("pending");
  });

  it("uses app context to route a Saxo call buy history to long-call entry instead of close", () => {
    const longCallSimulation = createOpenCoveredCallSimulation({
      id: "sim-v-long-call",
      name: "V long call",
      ticker: "V",
      strategyType: "long_call",
      accountCode: "P",
      accountEnvironment: "PROD_P_JPY_SETTLEMENT",
      currentPriceUSD: 0,
      expiryDate: "2026-11-20",
      stockPosition: null,
      optionLegs: [
        {
          id: "leg-v-c340",
          type: "call",
          side: "buy",
          strikeUSD: 340,
          premiumUSD: 24.1,
          quantity: 1,
          expiryDate: "2026-11-20",
        },
      ],
    });
    const history: SaxoHistoryDiscoveryItem = {
      id: "v-c340-entry",
      kind: "trade",
      accountCode: "P",
      symbol: "V/20X26C340:XCBF",
      assetType: "StockOption",
      instrumentCode: "V/20X26C340:XCBF",
      buySell: "buy",
      openClose: "unknown",
      quantity: 1,
      price: 24.1,
      tradeDate: "2026-06-30",
    };

    expect(getSaxoHistoryCandidateTargetForSimulations(history, [longCallSimulation])).toBe("entry");
    expect(isSaxoHistoryMatchingOptionLeg(longCallSimulation, longCallSimulation.optionLegs[0], history, "entry")).toBe(true);
  });

  it("routes synthetic-forward C-buy and P-sell history to their individual legs", () => {
    const simulation = createOpenCoveredCallSimulation({
      id: "sim-synthetic",
      strategyType: "synthetic_forward",
      optionLegs: [
        { id: "synthetic-call", type: "call", side: "buy", strikeUSD: 205, premiumUSD: 8, quantity: 1, expiryDate: "2026-09-18" },
        { id: "synthetic-put", type: "put", side: "sell", strikeUSD: 205, premiumUSD: 7, quantity: 1, expiryDate: "2026-09-18" },
      ],
    });
    const callEntry: SaxoHistoryDiscoveryItem = { id: "synthetic-call-entry", kind: "trade", accountCode: "N", symbol: "NVDA/18U26C205:XCBF", assetType: "StockOption", buySell: "buy", openClose: "unknown", quantity: 1, price: 8, tradeDate: "2026-07-16" };
    const callClose: SaxoHistoryDiscoveryItem = { ...callEntry, id: "synthetic-call-close", buySell: "sell", price: 9, tradeDate: "2026-07-17" };
    const putEntry: SaxoHistoryDiscoveryItem = { ...callEntry, id: "synthetic-put-entry", symbol: "NVDA/18U26P205:XCBF", buySell: "sell", price: 7 };

    expect(getSaxoHistoryCandidateTargetForSimulations(callEntry, [simulation])).toBe("entry");
    expect(isSaxoHistoryMatchingOptionLeg(simulation, simulation.optionLegs[0], callEntry, "entry")).toBe(true);
    expect(getSaxoHistoryCandidateTargetForSimulations(callClose, [simulation])).toBe("close");
    expect(isSaxoHistoryMatchingOptionLeg(simulation, simulation.optionLegs[0], callClose, "close")).toBe(true);
    expect(isSaxoHistoryMatchingOptionLeg(simulation, simulation.optionLegs[1], putEntry, "entry")).toBe(true);
  });

  it("keeps context-matched short call buybacks routed to close", () => {
    const simulation = createOpenCoveredCallSimulation();
    const history: SaxoHistoryDiscoveryItem = {
      id: "nvda-c225-buyback",
      kind: "trade",
      accountCode: "N",
      symbol: "NVDA/10N26C225:XCBF",
      assetType: "StockOption",
      instrumentCode: "NVDA/10N26C225:XCBF",
      buySell: "buy",
      openClose: "unknown",
      quantity: 1,
      price: 0.79,
      tradeDate: "2026-06-23",
    };

    expect(getSaxoHistoryCandidateTargetForSimulations(history, [simulation])).toBe("close");
  });

  it("does not match a Saxo covered-call close history from a clearly different P/N account", () => {
    const simulation = createOpenCoveredCallSimulation({ accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT" });
    const closeHistory: SaxoHistoryDiscoveryItem = {
      id: "nvda-c225-p-account",
      kind: "trade",
      accountCode: "P",
      symbol: "NVDA/10N26C225:XCBF",
      assetType: "StockOption",
      buySell: "buy",
      openClose: "unknown",
      quantity: 1,
      price: 0.79,
    };

    const diagnostics = getSaxoHistoryOptionLegMatchDiagnostics(simulation, simulation.optionLegs[0], closeHistory, "close");

    expect(isSaxoHistoryMatchingOptionLeg(simulation, simulation.optionLegs[0], closeHistory, "close")).toBe(false);
    expect(diagnostics.mismatches.join(" ")).toContain("P/N口座が不一致");
  });

  it("resolves a unique covered-call close candidate with an account mismatch as an unconfirmed warning match", () => {
    const simulation = createOpenCoveredCallSimulation({ accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT" });
    const closeHistory: SaxoHistoryDiscoveryItem = {
      id: "nvda-c225-p-account-relaxed",
      kind: "trade",
      accountCode: "P",
      symbol: "NVDA/10N26C225:XCBF",
      instrumentCode: "NVDA/10N26C225:XCBF",
      assetType: "StockOption",
      buySell: "buy",
      openClose: "unknown",
      quantity: 1,
      price: 0.79,
      tradeDate: "2026-06-23",
    };

    const strictDiagnostics = getSaxoHistoryOptionLegMatchDiagnostics(simulation, simulation.optionLegs[0], closeHistory, "close");
    const resolved = resolveSaxoHistoryOptionLegMatch([simulation], closeHistory, "close", undefined, {
      allowCloseAccountMismatch: true,
    });

    expect(strictDiagnostics.matched).toBe(false);
    expect(strictDiagnostics.accountMismatches.join(" ")).toContain("P/N口座が不一致");
    expect(strictDiagnostics.nonAccountMismatches).toEqual([]);
    expect(resolved?.simulation.id).toBe("sim-covered-call");
    expect(resolved?.leg.id).toBe("leg-call-225");
    expect(resolved?.accountConfirmationWarning).toBe(SAXO_CLOSE_ACCOUNT_CONFIRMATION_WARNING);
  });

  it("does not auto-resolve an account-mismatched close history when multiple identical leg shapes exist", () => {
    const nSimulation = createOpenCoveredCallSimulation({ id: "sim-n", accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT" });
    const pSimulation = createOpenCoveredCallSimulation({ id: "sim-p", accountCode: "P", accountEnvironment: "PROD_P_JPY_SETTLEMENT" });
    const closeHistory: SaxoHistoryDiscoveryItem = {
      id: "nvda-c225-ambiguous",
      kind: "trade",
      accountCode: "P",
      symbol: "NVDA/10N26C225:XCBF",
      assetType: "StockOption",
      buySell: "buy",
      openClose: "unknown",
      quantity: 1,
      price: 0.79,
    };

    const unresolved = resolveSaxoHistoryOptionLegMatch([nSimulation, pSimulation], closeHistory, "close", undefined, {
      allowCloseAccountMismatch: true,
    });
    const selected = resolveSaxoHistoryOptionLegMatch([nSimulation, pSimulation], closeHistory, "close", "sim-n", {
      allowCloseAccountMismatch: true,
    });

    expect(unresolved).toBeUndefined();
    expect(selected?.simulation.id).toBe("sim-n");
    expect(selected?.accountConfirmationWarning).toBe(SAXO_CLOSE_ACCOUNT_CONFIRMATION_WARNING);
  });

  it("does not relax account mismatch when close history differs by strike", () => {
    const simulation = createOpenCoveredCallSimulation({ accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT" });
    const closeHistory: SaxoHistoryDiscoveryItem = {
      id: "nvda-c220-p-account",
      kind: "trade",
      accountCode: "P",
      symbol: "NVDA/10N26C220:XCBF",
      assetType: "StockOption",
      buySell: "buy",
      openClose: "unknown",
      quantity: 1,
      price: 0.79,
    };

    const resolved = resolveSaxoHistoryOptionLegMatch([simulation], closeHistory, "close", undefined, {
      allowCloseAccountMismatch: true,
    });

    expect(resolved).toBeUndefined();
  });

  it("allows a Saxo covered-call close history when account mapping is missing but the leg shape is unique", () => {
    const simulation = createOpenCoveredCallSimulation();
    const closeHistory: SaxoHistoryDiscoveryItem = {
      id: "nvda-c225-unmapped",
      kind: "trade",
      symbol: "NVDA/10N26C225:XCBF",
      assetType: "StockOption",
      buySell: "buy",
      openClose: "unknown",
      quantity: 1,
      price: 0.79,
    };

    expect(isSaxoHistoryMatchingOptionLeg(simulation, simulation.optionLegs[0], closeHistory, "close")).toBe(true);
  });

  it("reports the mismatched field when a similar Saxo covered-call close history differs by strike", () => {
    const simulation = createOpenCoveredCallSimulation();
    const closeHistory: SaxoHistoryDiscoveryItem = {
      id: "nvda-c220-buyback",
      kind: "trade",
      accountCode: "N",
      symbol: "NVDA/10N26C220:XCBF",
      assetType: "StockOption",
      buySell: "buy",
      openClose: "unknown",
      quantity: 1,
      price: 0.79,
    };

    const diagnostics = getSaxoHistoryOptionLegMatchDiagnostics(simulation, simulation.optionLegs[0], closeHistory, "close");

    expect(isSaxoHistoryMatchingOptionLeg(simulation, simulation.optionLegs[0], closeHistory, "close")).toBe(false);
    expect(diagnostics.mismatches.join(" ")).toContain("権利行使価格が不一致");
  });

  it("matches Saxo option instrument symbols to the underlying ticker for assignment history", () => {
    const simulation = createOpenPutSimulation({
      optionLegs: [
        {
          id: "leg-put-2075",
          type: "put",
          side: "sell",
          strikeUSD: 207.5,
          premiumUSD: 1.21,
          quantity: 1,
          expiryDate: "2026-06-12",
          isCovered: false,
          putIntent: "accept_assignment",
        },
      ],
    });
    const assignmentHistory: SaxoHistoryDiscoveryItem = {
      id: "assignment-2075",
      kind: "trade",
      accountCode: "P",
      symbol: "NVDA/12M26P207.5:XCBF",
      assetType: "StockOption",
      optionType: "put",
      strike: 207.5,
      expiry: "2026-06-12",
      instrumentCode: "NVDA/12M26P207.5:XCBF",
      buySell: "buy",
      openClose: "close",
      quantity: 1,
      price: 0,
    };

    expect(isSaxoHistoryMatchingOptionLeg(simulation, simulation.optionLegs[0], assignmentHistory, "assignment")).toBe(true);
  });

  it("matches assignment history even when Saxo omits option type, strike, expiry, and open/close", () => {
    const simulation = createOpenPutSimulation({
      optionLegs: [
        {
          id: "leg-put-2075",
          type: "put",
          side: "sell",
          strikeUSD: 207.5,
          premiumUSD: 1.21,
          quantity: 1,
          expiryDate: "2026-06-12",
          isCovered: false,
          putIntent: "accept_assignment",
        },
      ],
    });
    const assignmentHistory: SaxoHistoryDiscoveryItem = {
      id: "assignment-2075-implicit",
      kind: "trade",
      accountCode: "P",
      symbol: "NVDA/12M26P207.5:XCBF",
      assetType: "StockOption",
      buySell: "buy",
      openClose: "unknown",
      quantity: 1,
      price: 0,
    };

    expect(getSaxoHistoryCandidateTarget(assignmentHistory)).toBe("assignment");
    expect(isSaxoHistoryMatchingOptionLeg(simulation, simulation.optionLegs[0], assignmentHistory, "assignment")).toBe(true);
  });

  it("does not match a P200 close history to a P207.5 app leg", () => {
    const simulation = createOpenPutSimulation({
      optionLegs: [
        {
          id: "leg-put-2075",
          type: "put",
          side: "sell",
          strikeUSD: 207.5,
          premiumUSD: 1.21,
          quantity: 1,
          expiryDate: "2026-06-05",
          isCovered: false,
          putIntent: "accept_assignment",
        },
      ],
    });
    const closeHistory = {
      id: "close-p200",
      kind: "trade",
      symbol: "NVDA",
      optionType: "put",
      strike: 200,
      expiry: "2026-06-05",
      buySell: "buy",
      openClose: "close",
      quantity: 1,
      price: 0.13,
      bookedAmount: -2461,
    } as const;

    expect(isSaxoHistoryMatchingOptionLeg(simulation, simulation.optionLegs[0], closeHistory, "close")).toBe(false);
  });

  it("does not match Saxo history from a different P/N account", () => {
    const simulation = createOpenPutSimulation({ accountCode: "P" });
    const nAccountHistory = {
      id: "n-account-entry",
      kind: "trade",
      accountCode: "N",
      symbol: "NVDA",
      optionType: "put",
      strike: 200,
      expiry: "2026-06-05",
      buySell: "sell",
      openClose: "open",
      quantity: -1,
      price: 1.16,
      bookedAmount: 17952,
    } as const;

    expect(isSaxoHistoryMatchingOptionLeg(simulation, simulation.optionLegs[0], nAccountHistory, "entry")).toBe(false);
  });

  it("uses Saxo option instrument symbols when matching current positions to entry history", () => {
    const position: SaxoApiPositionSnapshot = {
      id: "pos-2075",
      accountKey: "p-key",
      accountAssignment: "P",
      accountCode: "P",
      symbol: "NVDA",
      assetType: "StockOption",
      kind: "option",
      quantity: -1,
      side: "short",
      optionType: "put",
      strike: 207.5,
      expiry: "2026-06-12",
      premiumOpenPrice: 1.21,
      currency: "USD",
      missingFields: [],
      fetchedAt: "2026-06-13T00:00:00.000Z",
    };

    const matches = findEntryHistoryMatches(position, [
      {
        id: "entry-2075",
        kind: "trade",
        symbol: "NVDA/12M26P207.5:XCBF",
        instrumentCode: "NVDA/12M26P207.5:XCBF",
        optionType: "put",
        strike: 207.5,
        expiry: "2026-06-12",
        buySell: "sell",
        openClose: "open",
        quantity: -1,
        price: 1.21,
        bookedAmount: 18792,
      },
    ]);

    expect(matches.map((match) => match.item.id)).toEqual(["entry-2075"]);
  });

  it("matches a Visa long call current position to one P-account JPY entry history and keeps broker statement values", () => {
    const position: SaxoApiPositionSnapshot = {
      id: "visa-c340-position",
      accountKey: "p-key",
      accountAssignment: "P",
      accountCode: "P",
      symbol: "Visa Inc. Nov2026 340 C",
      underlyingName: "Visa Inc.",
      displayName: "Visa Inc. Nov2026 340 C",
      assetType: "StockOption",
      kind: "option",
      quantity: 1,
      side: "long",
      optionType: "call",
      strike: 340,
      expiry: "2026-11-20",
      premiumOpenPrice: 24.1,
      currency: "USD",
      missingFields: [],
      fetchedAt: "2026-07-01T00:00:00.000Z",
    };
    const history: SaxoHistoryDiscoveryItem = {
      id: "visa-c340-entry",
      kind: "trade",
      accountKey: "p-key",
      accountCode: "P",
      symbol: "V/20X26C340:XCBF",
      instrumentCode: "V/20X26C340:XCBF",
      assetType: "StockOption",
      buySell: "buy",
      openClose: "unknown",
      quantity: 1,
      price: 24.1,
      tradeDate: "2026-06-30",
      currency: "USD",
      bookedAmount: -396166,
      premiumAmount: -395797,
      transactionCost: -4288,
      exchangeRate: 164.23105,
    };

    expect(resolveSaxoPositionSymbol(position)).toBe("V");

    const matches = findEntryHistoryMatches(position, [history]);

    expect(matches).toHaveLength(1);
    expect(matches[0].item.id).toBe("visa-c340-entry");
    expect(matches[0].item.bookedAmount).toBe(-396166);
    expect(matches[0].item.premiumAmount).toBe(-395797);
    expect(matches[0].item.transactionCost).toBe(-4288);
    expect(matches[0].item.exchangeRate).toBe(164.23105);
  });

  it("only uses strict sell/open history for entry matching", () => {
    const position: SaxoApiPositionSnapshot = {
      id: "pos-2075",
      accountKey: "p-key",
      accountAssignment: "P",
      accountCode: "P",
      symbol: "NVDA",
      assetType: "StockOption",
      kind: "option",
      quantity: -1,
      side: "short",
      optionType: "put",
      strike: 207.5,
      expiry: "2026-06-05",
      premiumOpenPrice: 1.21,
      currency: "USD",
      missingFields: [],
      fetchedAt: "2026-06-10T00:00:00.000Z",
    };

    const matches = findEntryHistoryMatches(position, [
      {
        id: "entry-2075",
        kind: "trade",
        assetType: "StockOption",
        symbol: "NVDA",
        optionType: "put",
        strike: 207.5,
        expiry: "2026-06-05",
        buySell: "sell",
        openClose: "open",
        quantity: -1,
        price: 1.21,
        bookedAmount: 18792,
      },
      {
        id: "close-200",
        kind: "trade",
        assetType: "StockOption",
        symbol: "NVDA",
        optionType: "put",
        strike: 200,
        expiry: "2026-06-05",
        buySell: "buy",
        openClose: "close",
        quantity: 1,
        price: 0.13,
        bookedAmount: -2461,
      },
    ]);

    expect(matches.map((match) => match.item.id)).toEqual(["entry-2075"]);
  });
});

function createOpenPutSimulation(patch: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    id: "sim-1",
    status: "open",
    name: "NVDA short put",
    ticker: "NVDA",
    strategyType: "short_put",
    currentPriceUSD: 142,
    fxRateJPY: 157,
    accountCode: "P",
    accountEnvironment: "PROD_P_JPY_SETTLEMENT",
    entryDate: "2026-05-27",
    expiryDate: "2026-06-05",
    dte: 9,
    accountCurrency: "JPY",
    stockPosition: null,
    optionLegs: [
      {
        id: "leg-put",
        type: "put",
        side: "sell",
        strikeUSD: 200,
        premiumUSD: 1.16,
        quantity: 1,
        expiryDate: "2026-06-05",
        isCovered: false,
        putIntent: "accept_assignment",
      },
    ],
    brokerMarginJPY: 0,
    marginBufferMultiplier: 1,
    denominatorMode: "cash_secured",
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    ...patch,
  };
}

function createOpenCoveredCallSimulation(patch: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    id: "sim-covered-call",
    status: "open",
    name: "NVDA covered call",
    ticker: "NVDA",
    strategyType: "covered_call",
    currentPriceUSD: 210,
    fxRateJPY: 157,
    accountCode: "N",
    accountEnvironment: "PROD_N_USD_SETTLEMENT",
    entryDate: "2026-06-12",
    expiryDate: "2026-07-10",
    dte: 28,
    accountCurrency: "USD",
    stockPosition: {
      shares: 100,
      averageCostUSD: 207.5,
      denominatorPriceMode: "average_cost",
    },
    optionLegs: [
      {
        id: "leg-call-225",
        type: "call",
        side: "sell",
        strikeUSD: 225,
        premiumUSD: 1.83,
        quantity: 1,
        expiryDate: "2026-07-10",
        isCovered: true,
        callExitIntent: "covered_keep_stock",
      },
    ],
    brokerMarginJPY: 0,
    marginBufferMultiplier: 1,
    denominatorMode: "cash_secured",
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    ...patch,
  };
}
