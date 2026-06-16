import type {
  AccountState,
  Currency,
  OptionCloseExecution,
  OptionEntryExecution,
  OptionLeg,
  SaxoAccountCode,
  StockAcquisition,
  TradeSimulation,
} from "@/types/domain";

export type SaxoEnvironment = "sim" | "live";
export type SaxoMappedCode = SaxoAccountCode | "ignore" | "unmapped";

export type SaxoApiStatus = {
  mode: "saxo_readonly";
  connected: boolean;
  connectionState?: "disconnected" | "connected" | "reconnect_required";
  environment: SaxoEnvironment;
  environmentConfigured?: boolean;
  environmentRaw?: string;
  hasToken: boolean;
  tokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  connectionExpiresAt?: string;
  lastSyncedAt?: string;
  readOnly: true;
  orderEndpointsEnabled: false;
  bindAddress: "127.0.0.1";
  oauthConfigured: boolean;
  clientIdConfigured?: boolean;
  redirectUri?: string;
  expectedRedirectUri?: string;
  connectionError?: string;
  configurationWarnings?: { code: string; message: string }[];
  tokenPersistence?: SaxoTokenPersistenceStatus;
  message?: string;
};

export type SaxoTokenPersistenceStatus = {
  supported: boolean;
  enabled: boolean;
  restored: boolean;
  storage: "macOS Keychain" | string;
  status:
    | "not_checked"
    | "unsupported"
    | "not_configured"
    | "not_saved"
    | "saved"
    | "restored"
    | "refreshed"
    | "disabled"
    | "logged_out"
    | "expired"
    | "invalid"
    | "mismatch"
    | "client_changed"
    | string;
  message?: string;
  savedAt?: string;
  restoredAt?: string;
};

export type SaxoConfigStatus = {
  mode: "saxo_readonly";
  readOnly: true;
  bindAddress: "127.0.0.1";
  clientIdConfigured: boolean;
  clientIdMasked?: string;
  environment: SaxoEnvironment;
  environmentConfigured: boolean;
  redirectUri: string;
  expectedRedirectUri: string;
  localUiAllowedOrigin?: string;
  localUiReturnUrl?: string;
  localConfigFile: ".env.local";
  localConfigFileExists: boolean;
  configurationWarnings: { code: string; message: string }[];
  message?: string;
};

export type SaxoApiAccount = {
  accountKey: string;
  accountId?: string;
  displayName?: string;
  currency?: Currency | string;
  environment: SaxoEnvironment;
  isTrialAccount?: boolean;
  raw?: unknown;
};

export type SaxoAccountMapping = {
  workspace: "demo" | "real";
  accountKey: string;
  accountId?: string;
  displayName?: string;
  currency: Currency | string;
  mappedCode: SaxoMappedCode;
  environment: SaxoEnvironment;
  isTrialAccount?: boolean;
  confirmedByUser: boolean;
  confirmedAt?: string;
};

export type SaxoApiAccountSnapshot = {
  accountKey: string;
  accountId?: string;
  displayName?: string;
  currency: Currency | string;
  environment?: SaxoEnvironment;
  isTrialAccount?: boolean;
  values: {
    cashBalance?: number;
    buyingPower?: number;
    accountValue?: number;
    marginAvailable?: number;
    marginUsagePercent?: number;
  };
  missingFields: string[];
  fetchedAt: string;
  raw?: unknown;
};

export type SaxoPositionAccountAssignment = SaxoAccountCode | "unassigned" | "ignored";
export type SaxoPositionKind = "option" | "stock" | "other";
export type SaxoPositionSide = "short" | "long" | "unknown";
export type SaxoPositionMatchStatus =
  | "matched"
  | "quantity_diff"
  | "price_diff"
  | "app_missing"
  | "saxo_missing"
  | "unknown";

export type SaxoApiPositionSnapshot = {
  id: string;
  positionId?: string;
  accountKey: string;
  accountId?: string;
  displayName?: string;
  accountAssignment: SaxoPositionAccountAssignment;
  accountCode?: SaxoAccountCode;
  symbol?: string;
  underlyingName?: string;
  assetType?: string;
  kind: SaxoPositionKind;
  quantity?: number;
  side: SaxoPositionSide;
  currentPrice?: number;
  unrealizedPnl?: number;
  unrealizedPnlCurrency?: Currency | string;
  marketValue?: number;
  marketValueCurrency?: Currency | string;
  currency?: Currency | string;
  optionType?: "call" | "put" | "unknown";
  strike?: number;
  expiry?: string;
  contractSize?: number;
  premiumOpenPrice?: number;
  currentOptionPrice?: number;
  instrumentCode?: string;
  uic?: number;
  shareQuantity?: number;
  averageOpenPrice?: number;
  currentStockPrice?: number;
  missingFields: string[];
  fetchedAt: string;
  raw?: unknown;
};

export type SaxoPositionReconciliationRow = {
  id: string;
  status: SaxoPositionMatchStatus;
  position?: SaxoApiPositionSnapshot;
  simulation?: TradeSimulation;
  leg?: OptionLeg;
  detail: string;
};

export type SaxoApiOrderSnapshot = {
  id: string;
  orderId?: string;
  accountKey: string;
  accountId?: string;
  displayName?: string;
  accountAssignment: SaxoPositionAccountAssignment;
  accountCode?: SaxoAccountCode;
  symbol?: string;
  assetType?: string;
  quantity?: number;
  side?: "buy" | "sell" | "unknown";
  orderType?: string;
  orderRelation?: string;
  status?: string;
  price?: number;
  stopPrice?: number;
  duration?: string;
  currency?: Currency | string;
  optionType?: "call" | "put" | "unknown";
  strike?: number;
  expiry?: string;
  isExitCandidate?: boolean;
  missingFields: string[];
  fetchedAt: string;
  raw?: unknown;
};

export type SaxoHistoryDiscoveryEndpoint = {
  endpoint: string;
  label: string;
  classification: string;
  itemCount: number;
  message: string;
  items?: SaxoHistoryDiscoveryItem[];
};

export type SaxoHistoryDiscoveryItem = {
  id: string;
  kind: "closed_position" | "trade" | string;
  sourceIdMasked?: string;
  accountKey?: string;
  accountCode?: SaxoAccountCode;
  symbol?: string;
  assetType?: string;
  optionType?: "call" | "put" | "unknown";
  strike?: number;
  expiry?: string;
  instrumentCode?: string;
  uic?: number;
  quantity?: number;
  buySell?: "buy" | "sell" | "unknown";
  openClose?: "open" | "close" | "unknown";
  price?: number;
  tradeDate?: string;
  currency?: Currency | string;
  profitLoss?: number;
  profitLossBase?: number;
  bookedAmount?: number;
  premiumAmount?: number;
  transactionCost?: number;
  feeAmount?: number;
  exchangeFee?: number;
  exchangeRate?: number;
  taxIncludedFee?: number;
  rawFieldNames?: string[];
  fieldDiagnostics?: SaxoHistoryFieldDiagnostic[];
  sourceStatus?: "draft_candidate" | string;
  missingFields?: string[];
};

function normalizeHistoryKeyPart(value: unknown): string {
  if (value === undefined || value === null || value === "") return "_";
  if (typeof value === "number") return Number.isFinite(value) ? String(Number(value.toFixed(8))) : "_";
  return String(value).trim().toLowerCase();
}

export function getSaxoHistoryStableKey(item: SaxoHistoryDiscoveryItem): string {
  const instrument = item.instrumentCode ?? item.uic ?? item.symbol ?? "_";
  return [
    "saxo-history",
    item.kind,
    item.sourceIdMasked,
    item.accountKey,
    instrument,
    item.tradeDate,
    item.buySell,
    item.openClose,
    item.quantity,
    item.price,
  ]
    .map(normalizeHistoryKeyPart)
    .join("|");
}

export function getSaxoHistoryCandidateKeys(item: SaxoHistoryDiscoveryItem): string[] {
  return Array.from(new Set([getSaxoHistoryStableKey(item), item.id].filter(Boolean)));
}

export type SaxoHistoryFieldDiagnostic = {
  target: string;
  searched: string[];
  matched?: string;
  reason?: string;
};

export type SaxoOptionPremiumCandidate = {
  environment: SaxoEnvironment;
  fetchedAt: string;
  status: "available" | "endpoint_unidentified" | "permission_denied" | "unavailable";
  classification: string;
  source: string;
  symbol?: string;
  expiry?: string;
  strike?: number;
  optionType?: string;
  bid?: number;
  ask?: number;
  last?: number;
  mid?: number;
  message: string;
};

export type SaxoAccountDiffRow = {
  field: keyof SaxoApiAccountSnapshot["values"];
  label: string;
  currentValue?: number;
  saxoValue?: number;
  currency?: Currency | string;
  status: "changed" | "same" | "missing";
};

export const SAXO_READONLY_ENDPOINTS = [
  "GET /api/saxo/status",
  "GET /api/saxo/config/status",
  "POST /api/saxo/config/local",
  "GET /api/saxo/auth/start",
  "GET /api/saxo/auth/callback",
  "POST /api/saxo/logout",
  "POST /api/saxo/persistence/enable",
  "POST /api/saxo/persistence/disable",
  "GET /api/saxo/session/capabilities",
  "GET /api/saxo/client",
  "GET /api/saxo/accounts",
  "GET /api/saxo/accounts/:accountKey/balance",
  "GET /api/saxo/accounts/:accountKey/margin",
  "GET /api/saxo/accounts/snapshot",
  "GET /api/saxo/positions",
  "GET /api/saxo/accounts/:accountKey/positions",
  "GET /api/saxo/positions/snapshot",
  "GET /api/saxo/orders",
  "GET /api/saxo/accounts/:accountKey/orders",
  "GET /api/saxo/orders/snapshot",
  "GET /api/saxo/history/discovery",
  "GET /api/saxo/closed-positions",
  "GET /api/saxo/trades",
  "GET /api/saxo/options/premium-candidate",
] as const;

export const SAXO_FORBIDDEN_ORDER_ROUTE_PATTERNS = [
  /\/trade\/v\d+\/orders?/i,
  /\/api\/saxo\/positions?\/.*\/orders?/i,
] as const;

export function isForbiddenSaxoOrderRoute(path: string, method = "GET"): boolean {
  if (/\/api\/saxo\/orders?/i.test(path) && method !== "GET") return true;
  return SAXO_FORBIDDEN_ORDER_ROUTE_PATTERNS.some((pattern) => pattern.test(path));
}

export function createSaxoAccountDiffRows(
  account: AccountState,
  snapshot: SaxoApiAccountSnapshot,
): SaxoAccountDiffRow[] {
  const rows: SaxoAccountDiffRow[] = [
    {
      field: "cashBalance",
      label: account.currency === "USD" ? "USD現金残高" : "現金残高",
      currentValue: account.cashBalance,
      saxoValue: snapshot.values.cashBalance,
      currency: account.currency,
      status: getDiffStatus(account.cashBalance, snapshot.values.cashBalance),
    },
    {
      field: "buyingPower",
      label: account.currency === "USD" ? "USD買付可能額" : "買付可能額",
      currentValue: account.buyingPower,
      saxoValue: snapshot.values.buyingPower,
      currency: account.currency,
      status: getDiffStatus(account.buyingPower, snapshot.values.buyingPower),
    },
    {
      field: "accountValue",
      label: account.currency === "USD" ? "USD口座純資産" : "口座純資産",
      currentValue: account.accountValue,
      saxoValue: snapshot.values.accountValue,
      currency: account.currency,
      status: getDiffStatus(account.accountValue, snapshot.values.accountValue),
    },
    {
      field: "marginAvailable",
      label: "必要証拠金余力",
      currentValue: account.marginAvailable,
      saxoValue: snapshot.values.marginAvailable,
      currency: account.currency,
      status: getDiffStatus(account.marginAvailable, snapshot.values.marginAvailable),
    },
    {
      field: "marginUsagePercent",
      label: "証拠金使用率",
      currentValue: account.marginUsagePercent,
      saxoValue: snapshot.values.marginUsagePercent,
      currency: "%",
      status: getDiffStatus(account.marginUsagePercent, snapshot.values.marginUsagePercent),
    },
  ];
  return rows;
}

export function createAccountPatchFromSaxoSnapshot(snapshot: SaxoApiAccountSnapshot): Partial<AccountState> {
  return {
    ...(snapshot.values.cashBalance !== undefined ? { cashBalance: snapshot.values.cashBalance } : {}),
    ...(snapshot.values.buyingPower !== undefined ? { buyingPower: snapshot.values.buyingPower } : {}),
    ...(snapshot.values.accountValue !== undefined ? { accountValue: snapshot.values.accountValue } : {}),
    ...(snapshot.values.marginAvailable !== undefined ? { marginAvailable: snapshot.values.marginAvailable } : {}),
    ...(snapshot.values.marginUsagePercent !== undefined ? { marginUsagePercent: snapshot.values.marginUsagePercent } : {}),
    updatedAt: snapshot.fetchedAt,
  };
}

export function getSaxoAccountReflectionBlockReason({
  workspace,
  account,
  mapping,
  snapshot,
}: {
  workspace: "demo" | "live";
  account: AccountState;
  mapping?: SaxoAccountMapping;
  snapshot?: SaxoApiAccountSnapshot;
}): string | undefined {
  if (!mapping) return "残高反映には、この口座のP/N割当が必要です。";
  if (!snapshot) return "残高取得後に差分を表示します。";
  const snapshotEnvironment = snapshot.environment ?? mapping.environment;
  const isTrialAccount = Boolean(snapshot.isTrialAccount ?? mapping.isTrialAccount);
  if (workspace === "live" && snapshotEnvironment !== "live") {
    return "REALワークスペースにはSaxo SIM口座の値を反映できません。LIVE環境で接続し直してください。";
  }
  if (workspace === "live" && isTrialAccount) {
    return "REALワークスペースにはTrial口座の値を反映できません。本番口座を取得してください。";
  }
  if (snapshot.currency !== account.currency) {
    return `口座通貨が一致しません。アプリ側は${account.currency}、Saxo取得口座は${snapshot.currency}です。換算せずに反映すると誤った残高になります。`;
  }
  return undefined;
}

export function hasConfirmedMappingForAccount(
  mappings: SaxoAccountMapping[],
  accountCode: SaxoAccountCode,
): boolean {
  return mappings.some((mapping) => mapping.confirmedByUser && mapping.mappedCode === accountCode);
}

export function getConfirmedMappingForAccount(
  mappings: SaxoAccountMapping[],
  accountCode: SaxoAccountCode,
): SaxoAccountMapping | undefined {
  return mappings.find((mapping) => mapping.confirmedByUser && mapping.mappedCode === accountCode);
}

export function maskSaxoIdentifier(value?: string): string {
  if (!value) return "未取得";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function hasAppliedSaxoSnapshot(account: AccountState, snapshot: SaxoApiAccountSnapshot): boolean {
  return (account.saxoSyncHistory ?? []).some(
    (history) => history.source === "saxo_api" && history.accountKey === snapshot.accountKey && history.fetchedAt === snapshot.fetchedAt,
  );
}

export function applyPositionAccountMappings(
  positions: SaxoApiPositionSnapshot[],
  mappings: SaxoAccountMapping[],
): SaxoApiPositionSnapshot[] {
  return positions.map((position) => {
    const mapping = mappings.find((item) => item.accountKey === position.accountKey);
    if (!mapping || mapping.mappedCode === "unmapped") {
      return { ...position, accountAssignment: "unassigned", accountCode: undefined };
    }
    if (mapping.mappedCode === "ignore") {
      return { ...position, accountAssignment: "ignored", accountCode: undefined };
    }
    return { ...position, accountAssignment: mapping.mappedCode, accountCode: mapping.mappedCode };
  });
}

export function applyOrderAccountMappings(
  orders: SaxoApiOrderSnapshot[],
  mappings: SaxoAccountMapping[],
): SaxoApiOrderSnapshot[] {
  return orders.map((order) => {
    const mapping = mappings.find((item) => item.accountKey === order.accountKey);
    if (!mapping || mapping.mappedCode === "unmapped") {
      return { ...order, accountAssignment: "unassigned", accountCode: undefined };
    }
    if (mapping.mappedCode === "ignore") {
      return { ...order, accountAssignment: "ignored", accountCode: undefined };
    }
    return { ...order, accountAssignment: mapping.mappedCode, accountCode: mapping.mappedCode };
  });
}

export function findOrderCandidatesForLeg(
  simulation: TradeSimulation,
  leg: OptionLeg,
  orders: SaxoApiOrderSnapshot[],
): SaxoApiOrderSnapshot[] {
  return orders.filter((order) => {
    if (order.accountAssignment !== simulation.accountCode) return false;
    if (normalizeSymbol(order.symbol ?? "") !== normalizeSymbol(simulation.ticker)) return false;
    if (order.optionType && order.optionType !== "unknown" && order.optionType !== leg.type) return false;
    if (order.strike !== undefined && Math.abs(order.strike - leg.strikeUSD) > 0.001) return false;
    if (order.expiry && normalizeDate(order.expiry) !== normalizeDate(leg.expiryDate)) return false;
    return true;
  });
}

export function reconcileSaxoPositions(
  simulations: TradeSimulation[],
  positions: SaxoApiPositionSnapshot[],
): SaxoPositionReconciliationRow[] {
  const activeSimulations = simulations.filter((simulation) => simulation.status === "planned" || simulation.status === "open");
  const matchedLegIds = new Set<string>();
  const rows: SaxoPositionReconciliationRow[] = [];

  for (const position of positions) {
    if (position.accountAssignment !== "P" && position.accountAssignment !== "N") {
      rows.push({
        id: `position-${position.id}`,
        status: "unknown",
        position,
        detail: position.accountAssignment === "ignored" ? "使わない口座のため照合対象外です。" : "P/N未割当口座のため照合対象外です。",
      });
      continue;
    }

    if (position.kind !== "option") {
      rows.push({
        id: `position-${position.id}`,
        status: "unknown",
        position,
        detail: position.kind === "stock" ? "株式建玉です。現物株記録との照合は候補表示に留めます。" : "未対応の建玉種別です。",
      });
      continue;
    }

    const candidates = findMatchingOptionLegs(activeSimulations, position);
    if (candidates.length === 0) {
      rows.push({
        id: `position-${position.id}`,
        status: "app_missing",
        position,
        detail: "Saxo側にありますが、アプリ側の既存建玉に一致候補がありません。",
      });
      continue;
    }

    const candidate = candidates[0];
    matchedLegIds.add(`${candidate.simulation.id}:${candidate.leg.id}`);
    const quantityDiff = getQuantityDiff(position, candidate.leg);
    const priceDiff = getPriceDiff(position, candidate.leg);
    const status: SaxoPositionMatchStatus =
      quantityDiff !== undefined && Math.abs(quantityDiff) > 0.0001
        ? "quantity_diff"
        : priceDiff !== undefined && Math.abs(priceDiff) > 0.01
          ? "price_diff"
          : "matched";
    rows.push({
      id: `position-${position.id}`,
      status,
      position,
      simulation: candidate.simulation,
      leg: candidate.leg,
      detail:
        status === "matched"
          ? "既存建玉と一致しています。"
          : status === "quantity_diff"
            ? `数量差があります。Saxo ${formatComparableNumber(Math.abs(position.quantity ?? 0))} / アプリ ${formatComparableNumber(candidate.leg.quantity)}`
            : `価格差があります。Saxo ${formatComparableNumber(position.premiumOpenPrice ?? position.currentOptionPrice)} / アプリ ${formatComparableNumber(candidate.leg.premiumUSD)}`,
    });
  }

  for (const simulation of activeSimulations) {
    for (const leg of simulation.optionLegs) {
      if (leg.side !== "sell") continue;
      if (matchedLegIds.has(`${simulation.id}:${leg.id}`)) continue;
      rows.push({
        id: `app-${simulation.id}-${leg.id}`,
        status: "saxo_missing",
        simulation,
        leg,
        detail: "アプリ側にありますが、今回取得したSaxo建玉には一致候補がありません。",
      });
    }
  }

  return rows;
}

export function resolveSaxoPositionSymbol(position: SaxoApiPositionSnapshot, simulations: TradeSimulation[] = []): string | undefined {
  const direct = normalizeSymbol(position.symbol ?? "");
  if (direct) return direct;

  const textCandidates = [position.instrumentCode, position.underlyingName, position.displayName].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  for (const candidate of textCandidates) {
    const parsed = parseLikelyTicker(candidate);
    if (parsed) return parsed;
  }

  const matchingTickers = new Set(
    simulations
      .filter((simulation) => simulation.status === "planned" || simulation.status === "open")
      .filter((simulation) => simulationOptionShapeMatchesPosition(simulation, position))
      .map((simulation) => normalizeSymbol(simulation.ticker))
      .filter(Boolean),
  );

  return matchingTickers.size === 1 ? [...matchingTickers][0] : undefined;
}

export function createSaxoPositionDraftSummary(position: SaxoApiPositionSnapshot, simulations: TradeSimulation[] = []): {
  name: string;
  accountCode?: SaxoAccountCode;
  accountEnvironment?: "PROD_P_JPY_SETTLEMENT" | "PROD_N_USD_SETTLEMENT";
  strategyType: "short_put" | "covered_call" | "custom";
  ticker: string;
  side: string;
  optionType?: string;
  strike?: number;
  expiry?: string;
  quantity?: number;
  premiumOpenPrice?: number;
  currentPrice?: number;
  settlementCurrency?: Currency;
} {
  const accountCode = position.accountAssignment === "P" || position.accountAssignment === "N" ? position.accountAssignment : undefined;
  const ticker = resolveSaxoPositionSymbol(position, simulations) ?? "";
  return {
    name: `${ticker || "未取得"} / Saxo取込下書き`,
    accountCode,
    accountEnvironment: accountCode === "N" ? "PROD_N_USD_SETTLEMENT" : accountCode === "P" ? "PROD_P_JPY_SETTLEMENT" : undefined,
    strategyType: position.kind === "option" && position.optionType === "put" ? "short_put" : position.kind === "option" && position.optionType === "call" ? "covered_call" : "custom",
    ticker,
    side: position.side,
    optionType: position.optionType,
    strike: position.strike,
    expiry: position.expiry,
    quantity: position.quantity !== undefined ? Math.abs(position.quantity) : undefined,
    premiumOpenPrice: position.premiumOpenPrice,
    currentPrice: position.currentPrice ?? position.currentStockPrice,
    settlementCurrency: accountCode === "N" ? "USD" : accountCode === "P" ? "JPY" : undefined,
  };
}

export type SaxoEntryHistoryMatch = {
  item: SaxoHistoryDiscoveryItem;
  score: number;
  reasons: string[];
};

export type SaxoHistoryCandidateTarget = "entry" | "close" | "assignment" | "unknown";

export function getSaxoHistoryCandidateTarget(item: SaxoHistoryDiscoveryItem): SaxoHistoryCandidateTarget {
  if (isSaxoHistoryPutAssignmentOptionCandidate(item)) return "assignment";
  if (item.kind === "closed_position") return "close";
  if (item.openClose === "close") return "close";
  if (item.openClose === "open") return "entry";
  if (item.buySell === "sell") return "entry";
  if (item.buySell === "buy" && (item.profitLoss !== undefined || item.profitLossBase !== undefined)) return "close";
  return "unknown";
}

export function isSaxoHistoryPutAssignmentOptionCandidate(item: SaxoHistoryDiscoveryItem): boolean {
  if (resolveSaxoHistoryOptionType(item) !== "put") return false;
  if (item.buySell !== "buy") return false;
  if (item.openClose && item.openClose !== "close" && item.openClose !== "unknown") return false;
  if (item.price === undefined || !Number.isFinite(item.price) || Math.abs(item.price) > 0.0001) return false;
  const assetType = (item.assetType ?? "").toLowerCase();
  return assetType.includes("option") || Boolean(resolveSaxoHistoryOptionContract(item));
}

export function resolveSaxoHistoryUnderlyingSymbol(item: SaxoHistoryDiscoveryItem): string | undefined {
  return parseLikelyTicker(item.symbol ?? "") ?? parseLikelyTicker(item.instrumentCode ?? "");
}

export function findSaxoAssignmentStockAcquisitionItem(
  optionItem: SaxoHistoryDiscoveryItem,
  historyItems: SaxoHistoryDiscoveryItem[],
): SaxoHistoryDiscoveryItem | undefined {
  const optionSymbol = resolveSaxoHistoryUnderlyingSymbol(optionItem);
  const expectedShares = Math.abs(optionItem.quantity ?? 1) * 100;
  const expectedPrice = resolveSaxoHistoryStrike(optionItem);
  const optionDate = optionItem.tradeDate ? Date.parse(normalizeDate(optionItem.tradeDate)) : Number.NaN;
  const scored = historyItems
    .filter((candidate) => candidate.id !== optionItem.id)
    .filter((candidate) => {
      const assetType = (candidate.assetType ?? "").toLowerCase();
      if (!assetType.includes("stock") || assetType.includes("option")) return false;
      if (candidate.buySell !== "buy") return false;
      if (optionItem.accountCode && candidate.accountCode && optionItem.accountCode !== candidate.accountCode) return false;
      if (optionItem.accountKey && candidate.accountKey && optionItem.accountKey !== candidate.accountKey) return false;
      const stockSymbol = resolveSaxoHistoryUnderlyingSymbol(candidate);
      if (optionSymbol && stockSymbol && optionSymbol !== stockSymbol) return false;
      if (candidate.quantity !== undefined && Math.abs(Math.abs(candidate.quantity) - expectedShares) > 0.0001) return false;
      if (expectedPrice !== undefined && candidate.price !== undefined && Math.abs(candidate.price - expectedPrice) > 0.001) return false;
      if (Number.isFinite(optionDate) && candidate.tradeDate) {
        const stockDate = Date.parse(normalizeDate(candidate.tradeDate));
        if (Number.isFinite(stockDate)) {
          const diffDays = Math.abs(stockDate - optionDate) / 86_400_000;
          if (diffDays > 5) return false;
        }
      }
      return true;
    })
    .map((candidate) => {
      let score = 0;
      if (optionSymbol && resolveSaxoHistoryUnderlyingSymbol(candidate) === optionSymbol) score += 4;
      if (candidate.quantity !== undefined && Math.abs(Math.abs(candidate.quantity) - expectedShares) < 0.0001) score += 3;
      if (expectedPrice !== undefined && candidate.price !== undefined && Math.abs(candidate.price - expectedPrice) < 0.001) score += 3;
      if (optionItem.accountKey && candidate.accountKey && optionItem.accountKey === candidate.accountKey) score += 2;
      if (optionItem.tradeDate && candidate.tradeDate && normalizeDate(optionItem.tradeDate) === normalizeDate(candidate.tradeDate)) score += 1;
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.candidate;
}

export function isSaxoHistoryMatchingOptionLeg(
  simulation: TradeSimulation,
  leg: OptionLeg,
  item: SaxoHistoryDiscoveryItem,
  target: SaxoHistoryCandidateTarget = getSaxoHistoryCandidateTarget(item),
): boolean {
  if (target === "unknown") return false;
  if (item.accountCode && simulation.accountCode && item.accountCode !== simulation.accountCode) return false;
  if (item.accountKey && simulation.fixtureMeta?.saxoAccountKey && item.accountKey !== simulation.fixtureMeta.saxoAccountKey && item.accountKey !== maskSaxoIdentifier(simulation.fixtureMeta.saxoAccountKey)) return false;
  const itemOptionType = resolveSaxoHistoryOptionType(item);
  const itemStrike = resolveSaxoHistoryStrike(item);
  const itemExpiry = resolveSaxoHistoryExpiry(item);
  if (itemOptionType === undefined || itemOptionType !== leg.type) return false;
  if (itemStrike === undefined || Math.abs(itemStrike - leg.strikeUSD) > 0.001) return false;
  if (!itemExpiry || normalizeDate(itemExpiry) !== normalizeDate(leg.expiryDate)) return false;
  const itemSymbol = resolveSaxoHistoryUnderlyingSymbol(item) ?? normalizeSymbol(item.symbol ?? "");
  if (itemSymbol && normalizeSymbol(simulation.ticker) !== itemSymbol) return false;
  if (item.quantity !== undefined && Math.abs(Math.abs(item.quantity) - leg.quantity) > 0.0001) return false;

  if (target === "entry") {
    if (leg.side === "sell" && item.buySell !== "sell") return false;
    if (leg.side === "buy" && item.buySell !== "buy") return false;
    return getSaxoHistoryCandidateTarget(item) === "entry";
  }

  if (leg.side === "sell" && item.buySell !== "buy") return false;
  if (leg.side === "buy" && item.buySell !== "sell") return false;
  return ["close", "assignment"].includes(getSaxoHistoryCandidateTarget(item));
}

export function getSaxoHistoryContractsForLeg(item: SaxoHistoryDiscoveryItem, leg: OptionLeg): number {
  return item.quantity !== undefined ? Math.max(1, Math.abs(item.quantity)) : leg.quantity;
}

export function isSaxoHistoryMatchingEntryExecution(
  simulation: TradeSimulation,
  leg: OptionLeg,
  execution: OptionEntryExecution,
  item: SaxoHistoryDiscoveryItem,
): boolean {
  if (!isSaxoHistoryMatchingOptionLeg(simulation, leg, item, "entry")) return false;
  if (execution.legId !== leg.id) return false;
  if (!dateMatches(execution.tradeDate, item.tradeDate)) return false;
  if (!numberMatches(execution.fillPriceUSD, item.price, 0.0001)) return false;
  if (!numberMatches(execution.contracts, getSaxoHistoryContractsForLeg(item, leg), 0.0001)) return false;
  return true;
}

export function isSaxoHistoryMatchingCloseExecution(
  simulation: TradeSimulation,
  leg: OptionLeg,
  execution: OptionCloseExecution,
  item: SaxoHistoryDiscoveryItem,
): boolean {
  if (!isSaxoHistoryMatchingOptionLeg(simulation, leg, item, "close")) return false;
  if (execution.legId !== leg.id) return false;
  if (!dateMatches(execution.closeDate, item.tradeDate)) return false;
  if (!numberMatches(execution.closePriceUSD, item.price, 0.0001)) return false;
  if (!numberMatches(execution.contracts, getSaxoHistoryContractsForLeg(item, leg), 0.0001)) return false;
  return true;
}

export function isSaxoHistoryMatchingStockAcquisition(
  simulation: TradeSimulation,
  acquisition: StockAcquisition | undefined,
  item: SaxoHistoryDiscoveryItem,
): boolean {
  if (!acquisition?.enabled) return false;
  const leg = simulation.optionLegs.find((candidate) => isSaxoHistoryMatchingOptionLeg(simulation, candidate, item, "assignment"));
  if (!leg) return false;
  const expectedShares = getSaxoHistoryContractsForLeg(item, leg) * 100;
  const expectedPriceUSD = resolveSaxoHistoryStrike(item) ?? leg.strikeUSD;
  if (!numberMatches(acquisition.shares, expectedShares, 0.0001)) return false;
  if (!numberMatches(acquisition.priceUSD, expectedPriceUSD, 0.001)) return false;
  return true;
}

export function findEntryHistoryMatches(
  position: SaxoApiPositionSnapshot,
  historyItems: SaxoHistoryDiscoveryItem[],
): SaxoEntryHistoryMatch[] {
  if (position.kind !== "option") return [];
  const matches = historyItems
    .filter((item) => getSaxoHistoryCandidateTarget(item) === "entry")
    .filter((item) => isStrictEntryHistoryCandidate(position, item))
    .map((item) => scoreEntryHistoryMatch(position, item))
    .filter((match) => match.score >= 5)
    .sort((a, b) => b.score - a.score);
  const bestScore = matches[0]?.score;
  return bestScore === undefined ? [] : matches.filter((match) => match.score >= Math.max(5, bestScore - 2)).slice(0, 5);
}

function isStrictEntryHistoryCandidate(position: SaxoApiPositionSnapshot, item: SaxoHistoryDiscoveryItem): boolean {
  if (item.accountCode && position.accountAssignment !== item.accountCode) return false;
  if (item.accountKey && position.accountKey && item.accountKey !== position.accountKey && item.accountKey !== maskSaxoIdentifier(position.accountKey)) return false;
  const itemOptionType = resolveSaxoHistoryOptionType(item);
  const itemStrike = resolveSaxoHistoryStrike(item);
  const itemExpiry = resolveSaxoHistoryExpiry(item);
  if (position.optionType && position.optionType !== "unknown" && itemOptionType !== position.optionType) return false;
  if (position.strike !== undefined && (itemStrike === undefined || Math.abs(itemStrike - position.strike) > 0.001)) return false;
  if (position.expiry && (!itemExpiry || normalizeDate(itemExpiry) !== normalizeDate(position.expiry))) return false;
  if (position.side === "short" && item.buySell !== "sell") return false;
  if (position.side === "long" && item.buySell !== "buy") return false;
  if (position.quantity !== undefined && item.quantity !== undefined && Math.abs(Math.abs(item.quantity) - Math.abs(position.quantity)) > 0.0001) return false;
  const positionSymbol = normalizeSymbol(position.symbol ?? "");
  const itemSymbol = resolveSaxoHistoryUnderlyingSymbol(item) ?? normalizeSymbol(item.symbol ?? "");
  if (positionSymbol && itemSymbol && positionSymbol !== itemSymbol) return false;
  if (position.uic !== undefined && item.uic !== undefined && position.uic !== item.uic) return false;
  if (position.instrumentCode && item.instrumentCode && position.instrumentCode !== item.instrumentCode) return false;
  return true;
}

function scoreEntryHistoryMatch(position: SaxoApiPositionSnapshot, item: SaxoHistoryDiscoveryItem): SaxoEntryHistoryMatch {
  let score = 0;
  const reasons: string[] = [];
  const itemSymbol = resolveSaxoHistoryUnderlyingSymbol(item) ?? normalizeSymbol(item.symbol ?? "");
  const itemOptionType = resolveSaxoHistoryOptionType(item);
  const itemStrike = resolveSaxoHistoryStrike(item);
  const itemExpiry = resolveSaxoHistoryExpiry(item);
  if (itemSymbol && normalizeSymbol(position.symbol ?? "") === itemSymbol) {
    score += 4;
    reasons.push("銘柄一致");
  }
  if (itemOptionType && position.optionType && position.optionType !== "unknown" && itemOptionType === position.optionType) {
    score += 3;
    reasons.push("Put/Call一致");
  }
  if (itemStrike !== undefined && position.strike !== undefined && Math.abs(itemStrike - position.strike) < 0.001) {
    score += 3;
    reasons.push("権利行使価格一致");
  }
  if (itemExpiry && position.expiry && normalizeDate(itemExpiry) === normalizeDate(position.expiry)) {
    score += 3;
    reasons.push("満期一致");
  }
  if (item.quantity !== undefined && position.quantity !== undefined && Math.abs(Math.abs(item.quantity) - Math.abs(position.quantity)) < 0.0001) {
    score += 2;
    reasons.push("数量一致");
  }
  if (item.price !== undefined && position.premiumOpenPrice !== undefined && Math.abs(item.price - position.premiumOpenPrice) < 0.01) {
    score += 2;
    reasons.push("約定価格一致");
  }
  if (item.instrumentCode && position.instrumentCode && item.instrumentCode === position.instrumentCode) {
    score += 4;
    reasons.push("Instrument一致");
  }
  if (item.uic !== undefined && position.uic !== undefined && item.uic === position.uic) {
    score += 4;
    reasons.push("UIC一致");
  }
  if (item.tradeDate && position.fetchedAt && Date.parse(item.tradeDate) <= Date.parse(position.fetchedAt)) {
    score += 1;
    reasons.push("取引日確認");
  }
  return { item, score, reasons };
}

function findMatchingOptionLegs(
  simulations: TradeSimulation[],
  position: SaxoApiPositionSnapshot,
): Array<{ simulation: TradeSimulation; leg: OptionLeg }> {
  const resolvedSymbol = resolveSaxoPositionSymbol(position, simulations);
  return simulations.flatMap((simulation) =>
    simulation.optionLegs
      .filter((leg) => isMatchingOptionLeg(simulation, leg, position, resolvedSymbol))
      .map((leg) => ({ simulation, leg })),
  );
}

function isMatchingOptionLeg(simulation: TradeSimulation, leg: OptionLeg, position: SaxoApiPositionSnapshot, resolvedSymbol?: string): boolean {
  if (simulation.accountCode !== position.accountAssignment) return false;
  if (resolvedSymbol && normalizeSymbol(simulation.ticker) !== resolvedSymbol) return false;
  if (position.optionType && position.optionType !== "unknown" && leg.type !== position.optionType) return false;
  if (position.side !== "unknown" && leg.side !== (position.side === "short" ? "sell" : "buy")) return false;
  if (position.strike !== undefined && Math.abs(leg.strikeUSD - position.strike) > 0.001) return false;
  if (position.expiry && normalizeDate(leg.expiryDate) !== normalizeDate(position.expiry)) return false;
  return true;
}

function simulationOptionShapeMatchesPosition(simulation: TradeSimulation, position: SaxoApiPositionSnapshot): boolean {
  if (simulation.accountCode !== position.accountAssignment) return false;
  if (position.kind !== "option") return false;
  return simulation.optionLegs.some((leg) => {
    if (position.optionType && position.optionType !== "unknown" && leg.type !== position.optionType) return false;
    if (position.side !== "unknown" && leg.side !== (position.side === "short" ? "sell" : "buy")) return false;
    if (position.strike !== undefined && Math.abs(leg.strikeUSD - position.strike) > 0.001) return false;
    if (position.expiry && normalizeDate(leg.expiryDate) !== normalizeDate(position.expiry)) return false;
    if (position.quantity !== undefined && Math.abs(Math.abs(position.quantity) - leg.quantity) > 0.0001) return false;
    return true;
  });
}

function getQuantityDiff(position: SaxoApiPositionSnapshot, leg: OptionLeg): number | undefined {
  if (position.quantity === undefined) return undefined;
  return Math.abs(position.quantity) - leg.quantity;
}

function getPriceDiff(position: SaxoApiPositionSnapshot, leg: OptionLeg): number | undefined {
  const saxoPrice = position.premiumOpenPrice ?? position.currentOptionPrice;
  if (saxoPrice === undefined) return undefined;
  return saxoPrice - leg.premiumUSD;
}

function resolveSaxoHistoryOptionType(item: SaxoHistoryDiscoveryItem): "call" | "put" | undefined {
  if (item.optionType === "call" || item.optionType === "put") return item.optionType;
  return resolveSaxoHistoryOptionContract(item)?.optionType;
}

function resolveSaxoHistoryStrike(item: SaxoHistoryDiscoveryItem): number | undefined {
  return item.strike ?? resolveSaxoHistoryOptionContract(item)?.strike;
}

function resolveSaxoHistoryExpiry(item: SaxoHistoryDiscoveryItem): string | undefined {
  return item.expiry ?? resolveSaxoHistoryOptionContract(item)?.expiry;
}

function resolveSaxoHistoryOptionContract(
  item: SaxoHistoryDiscoveryItem,
): { optionType: "call" | "put"; strike: number; expiry?: string } | undefined {
  return parseSaxoOptionContract(item.symbol ?? "") ?? parseSaxoOptionContract(item.instrumentCode ?? "");
}

function parseSaxoOptionContract(value: string): { optionType: "call" | "put"; strike: number; expiry?: string } | undefined {
  const text = value.trim().toUpperCase();
  const match = text.match(/(?:^|[/:\s_-])(\d{1,2})([FGHJKMNQUVXZ])(\d{2})([CP])(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const [, dayRaw, monthCode, yearRaw, optionCode, strikeRaw] = match;
  const strike = Number(strikeRaw);
  if (!Number.isFinite(strike)) return undefined;
  const month = SAXO_OPTION_MONTH_CODES[monthCode];
  const day = Number(dayRaw);
  const year = Number(yearRaw);
  const expiry = month && Number.isFinite(day) && day >= 1 && day <= 31 && Number.isFinite(year)
    ? `20${yearRaw.padStart(2, "0")}-${month}-${String(day).padStart(2, "0")}`
    : undefined;
  return {
    optionType: optionCode === "P" ? "put" : "call",
    strike,
    expiry,
  };
}

const SAXO_OPTION_MONTH_CODES: Record<string, string> = {
  F: "01",
  G: "02",
  H: "03",
  J: "04",
  K: "05",
  M: "06",
  N: "07",
  Q: "08",
  U: "09",
  V: "10",
  X: "11",
  Z: "12",
};

function normalizeSymbol(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9.]/g, "");
}

function parseLikelyTicker(value: string): string | undefined {
  const text = value.trim();
  const firstToken = text.match(/^([A-Z][A-Z0-9.]{0,9})(?:[\s/:_-]|$)/i)?.[1];
  const normalized = firstToken ? normalizeSymbol(firstToken) : "";
  if (normalized && !["PUT", "CALL", "STOCKOPTION", "OVERSEAS", "LISTED", "EQUITIES", "OPTION"].includes(normalized)) {
    return normalized;
  }

  const knownNames: Array<[RegExp, string]> = [
    [/NVIDIA|NVIDIA CORP/i, "NVDA"],
    [/AMAZON|AMAZON\.COM/i, "AMZN"],
    [/NETFLIX/i, "NFLX"],
    [/APPLE/i, "AAPL"],
    [/TESLA/i, "TSLA"],
    [/MICROSOFT/i, "MSFT"],
  ];
  return knownNames.find(([pattern]) => pattern.test(text))?.[1];
}

function normalizeDate(value: string): string {
  return value.replace(/\//g, "-").slice(0, 10);
}

function dateMatches(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && normalizeDate(left) === normalizeDate(right));
}

function numberMatches(left: number | undefined, right: number | undefined, tolerance: number): boolean {
  return left !== undefined && right !== undefined && Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function formatComparableNumber(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "未取得" : value.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

export type SaxoSetupGuidance = {
  code: "local_api_down" | "missing_client_id" | "missing_environment" | "ready" | "connected" | "reconnect_required";
  tone: "danger" | "warning" | "info" | "success";
  title: string;
  detail: string;
  command?: string;
};

export function createSaxoSetupGuidance(status: SaxoApiStatus | null, apiErrorMessage?: string): SaxoSetupGuidance {
  if (!status) {
    return {
      code: "local_api_down",
      tone: "danger",
      title: "SaxoローカルAPIが起動していません",
      detail: apiErrorMessage ?? "別ターミナルでローカルAPIを起動してから、状態更新を押してください。",
      command: "SAXO_CLIENT_ID=... SAXO_ENVIRONMENT=sim npm run dev:all",
    };
  }
  if (!status.oauthConfigured) {
    return {
      code: "missing_client_id",
      tone: "danger",
      title: "LIVE AppKey（Client ID）が未設定です",
      detail: "Saxo Developer Portalで作成したLIVE AppKeyを、設定・診断内の接続セットアップからこの端末内に保存してください。SaxoTraderGOのログインIDやP/N口座番号ではありません。",
      command: "SAXO_CLIENT_ID=... SAXO_ENVIRONMENT=sim npm run dev:all",
    };
  }
  if (status.environmentConfigured === false) {
    return {
      code: "missing_environment",
      tone: "warning",
      title: "SAXO_ENVIRONMENT が未設定です",
      detail: "現在はsim扱いですが、実検証では sim / live を明示してください。",
      command: "SAXO_CLIENT_ID=... SAXO_ENVIRONMENT=sim npm run dev:all",
    };
  }
  if (status.connectionState === "reconnect_required") {
    return {
      code: "reconnect_required",
      tone: "warning",
      title: "Saxo再接続が必要です",
      detail: status.connectionError ?? "Saxo接続の期限が切れました。Saxo公式ログイン画面で再接続してください。",
    };
  }
  if (status.connected) {
    return {
      code: "connected",
      tone: "success",
      title: "Saxo接続中です",
      detail: "口座一覧、残高・証拠金の取得へ進めます。発注機能はありません。",
    };
  }
  return {
    code: "ready",
    tone: "info",
    title: "Saxo接続準備は完了しています",
    detail: "Saxo接続を押すとOAuth認証を開始します。Saxo側ログインと同意はユーザー本人が行ってください。",
  };
}

function getDiffStatus(currentValue?: number, saxoValue?: number): SaxoAccountDiffRow["status"] {
  if (saxoValue === undefined || !Number.isFinite(saxoValue)) return "missing";
  if (currentValue === undefined || !Number.isFinite(currentValue)) return "changed";
  return Math.abs(currentValue - saxoValue) < 0.000001 ? "same" : "changed";
}
