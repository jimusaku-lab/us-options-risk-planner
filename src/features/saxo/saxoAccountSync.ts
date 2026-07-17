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
  bindAddress?: string;
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
  bindAddress?: string;
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
  underlyingSymbol?: string;
  underlyingIdentity?: string;
  underlyingIdentitySource?: string;
  underlyingUic?: number;
  underlyingAssetType?: string;
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

export type SaxoSyntheticForwardPair = {
  id: string;
  callPosition: SaxoApiPositionSnapshot;
  putPosition: SaxoApiPositionSnapshot;
  ticker: string;
  underlyingIdentity: string;
  accountCode: SaxoAccountCode;
  accountKey: string;
  expiry: string;
  strike: number;
  quantity: number;
};

export type SaxoSyntheticForwardHold = {
  id: string;
  callPosition: SaxoApiPositionSnapshot;
  putPosition: SaxoApiPositionSnapshot;
  accountCode: SaxoAccountCode;
  expiry: string;
  strike: number;
  quantity: number;
  reason: string;
};

export type SaxoSyntheticForwardPairing = {
  pairs: SaxoSyntheticForwardPair[];
  holds: SaxoSyntheticForwardHold[];
};

export function findSaxoSyntheticForwardPairs(positions: SaxoApiPositionSnapshot[]): SaxoSyntheticForwardPair[] {
  return findSaxoSyntheticForwardPairing(positions).pairs;
}

export function findSaxoSyntheticForwardPairing(positions: SaxoApiPositionSnapshot[]): SaxoSyntheticForwardPairing {
  const calls = positions.filter((position) => isSaxoSyntheticForwardOption(position) && getSaxoSyntheticForwardOptionDetails(position)?.optionType === "call" && resolveSaxoSyntheticForwardSide(position) === "long" && (position.quantity ?? 0) > 0);
  const puts = positions.filter((position) => isSaxoSyntheticForwardOption(position) && getSaxoSyntheticForwardOptionDetails(position)?.optionType === "put" && resolveSaxoSyntheticForwardSide(position) === "short" && (position.quantity ?? 0) < 0);
  const pairedPutIds = new Set<string>();
  const heldPutIds = new Set<string>();
  const pairs: SaxoSyntheticForwardPair[] = [];
  const holds: SaxoSyntheticForwardHold[] = [];
  for (const callPosition of calls) {
    const callContract = getSaxoSyntheticForwardOptionDetails(callPosition);
    if (!callContract?.expiry || callContract.strike === undefined || callPosition.quantity === undefined) continue;
    const matchingPut = puts.find((candidate) =>
      !pairedPutIds.has(candidate.id) && !heldPutIds.has(candidate.id) &&
      candidate.accountKey === callPosition.accountKey &&
      candidate.accountAssignment === callPosition.accountAssignment &&
      getSaxoSyntheticForwardOptionDetails(candidate)?.expiry === callContract.expiry &&
      Math.abs((getSaxoSyntheticForwardOptionDetails(candidate)?.strike ?? Number.NaN) - callContract.strike) < 0.001 &&
      Math.abs(Math.abs(candidate.quantity ?? 0) - Math.abs(callPosition.quantity ?? 0)) < 0.0001,
    );
    if (!matchingPut) continue;
    const callIdentity = callPosition.underlyingIdentity;
    const putIdentity = matchingPut.underlyingIdentity;
    if (!callIdentity || !putIdentity || callIdentity !== putIdentity) {
      heldPutIds.add(matchingPut.id);
      holds.push({
        id: `synthetic-hold:${callPosition.id}:${matchingPut.id}`,
        callPosition,
        putPosition: matchingPut,
        accountCode: callPosition.accountAssignment as SaxoAccountCode,
        expiry: callContract.expiry,
        strike: callContract.strike,
        quantity: Math.abs(callPosition.quantity),
        reason: !callIdentity || !putIdentity ? "原資産識別子をSaxoから取得できませんでした。" : "二脚のSaxo原資産識別子が一致しません。",
      });
      continue;
    }
    const ticker = callPosition.underlyingSymbol ?? matchingPut.underlyingSymbol ?? resolveSaxoPositionSymbol(callPosition) ?? resolveSaxoPositionSymbol(matchingPut) ?? "原資産識別子あり";
    pairedPutIds.add(matchingPut.id);
    pairs.push({
      id: `synthetic:${callPosition.accountKey}:${callIdentity}:${callContract.expiry}:${callContract.strike}:${Math.abs(callPosition.quantity ?? 0)}`,
      callPosition,
      putPosition: matchingPut,
      ticker,
      underlyingIdentity: callIdentity,
      accountCode: callPosition.accountAssignment as SaxoAccountCode,
      accountKey: callPosition.accountKey,
      expiry: callContract.expiry,
      strike: callContract.strike,
      quantity: Math.abs(callPosition.quantity!),
    });
  }
  return { pairs, holds };
}

function isSaxoSyntheticForwardOption(position: SaxoApiPositionSnapshot): boolean {
  return position.accountAssignment !== "unassigned" && position.accountAssignment !== "ignored" && (position.kind === "option" || position.assetType?.toLowerCase().includes("option") === true || Boolean(getSaxoSyntheticForwardOptionDetails(position)));
}

function resolveSaxoSyntheticForwardSide(position: SaxoApiPositionSnapshot): SaxoPositionSide {
  if (position.side !== "unknown") return position.side;
  return (position.quantity ?? 0) < 0 ? "short" : (position.quantity ?? 0) > 0 ? "long" : "unknown";
}

function getSaxoSyntheticForwardOptionDetails(position: SaxoApiPositionSnapshot): { optionType: "call" | "put"; strike: number; expiry?: string } | undefined {
  const contract = parseSaxoOptionContract(position.instrumentCode ?? "") ?? parseSaxoOptionContract(position.symbol ?? "");
  const optionType = position.optionType === "call" || position.optionType === "put" ? position.optionType : contract?.optionType;
  const strike = position.strike ?? contract?.strike;
  const expiry = position.expiry ?? contract?.expiry;
  return optionType && strike !== undefined && Number.isFinite(strike) ? { optionType, strike, expiry } : undefined;
}

/** Select the broker's composite ticket record without deriving a net fill from either leg. */
export function findSaxoSyntheticForwardParentHistory(
  pair: SaxoSyntheticForwardPair,
  historyItems: SaxoHistoryDiscoveryItem[],
): SaxoHistoryDiscoveryItem | undefined {
  return historyItems
    .filter((item) => item.accountKey === pair.accountKey || item.accountKey === maskSaxoIdentifier(pair.accountKey))
    .filter((item) => !item.accountCode || item.accountCode === pair.accountCode)
    .filter((item) => (item.assetType ?? "").toLowerCase().includes("syntheticunderlying"))
    .filter((item) => (resolveSaxoHistoryUnderlyingSymbol(item) ?? "").toUpperCase() === pair.ticker)
    .sort((left, right) => {
      const leftScore = Number(Boolean(left.orderId)) + Number(left.price !== undefined);
      const rightScore = Number(Boolean(right.orderId)) + Number(right.price !== undefined);
      return rightScore - leftScore;
    })[0];
}

/** Resolve only one exact composite parent. A tie is intentionally left unresolved to avoid opening another position. */
export function findSaxoSyntheticForwardSimulationForPair(pair: SaxoSyntheticForwardPair, simulations: TradeSimulation[], parentOrderId?: string): TradeSimulation | undefined {
  const matches = simulations.filter((simulation) => simulation.strategyType === "synthetic_forward").filter((simulation) => simulation.accountCode === pair.accountCode).filter((simulation) => simulation.ticker.trim().toUpperCase() === pair.ticker.toUpperCase()).map((simulation) => {
    const callLeg = simulation.optionLegs.find((leg) => leg.type === "call" && leg.side === "buy");
    const putLeg = simulation.optionLegs.find((leg) => leg.type === "put" && leg.side === "sell");
    if (!callLeg || !putLeg || callLeg.expiryDate !== pair.expiry || putLeg.expiryDate !== pair.expiry || callLeg.strikeUSD !== pair.strike || putLeg.strikeUSD !== pair.strike || callLeg.quantity !== pair.quantity || putLeg.quantity !== pair.quantity) return undefined;
    const callPositionId = pair.callPosition.positionId ?? pair.callPosition.id; const putPositionId = pair.putPosition.positionId ?? pair.putPosition.id;
    const positionScore = Number(callLeg.saxoPositionId === callPositionId) + Number(putLeg.saxoPositionId === putPositionId);
    const orderScore = Number(Boolean(parentOrderId) && simulation.syntheticForwardTicket?.orderId === parentOrderId);
    return { simulation, score: positionScore * 10 + orderScore };
  }).filter((match): match is { simulation: TradeSimulation; score: number } => Boolean(match)).sort((left, right) => right.score - left.score);
  if (matches.length === 0 || (matches.length > 1 && matches[0].score === matches[1].score)) return undefined;
  return matches[0].simulation;
}

export type SaxoSyntheticForwardFillEvidence = {
  status: "filled" | "incomplete";
  parentHistory?: SaxoHistoryDiscoveryItem;
  callHistory?: SaxoHistoryDiscoveryItem;
  putHistory?: SaxoHistoryDiscoveryItem;
  missing: ("parent" | "call" | "put")[];
};

function isSaxoFilledTradeHistory(item: SaxoHistoryDiscoveryItem | undefined): item is SaxoHistoryDiscoveryItem {
  if (!item || item.kind !== "trade" || item.price === undefined || !Number.isFinite(item.price)) return false;
  const status = (item.sourceStatus ?? "").toLowerCase();
  return !/(cancel|reject|unfilled|working|pending)/.test(status);
}

/** Require a composite parent trade and a matching entry trade for each leg. */
export function resolveSaxoSyntheticForwardFillEvidence(
  pair: SaxoSyntheticForwardPair,
  historyItems: SaxoHistoryDiscoveryItem[],
): SaxoSyntheticForwardFillEvidence {
  const parentHistory = findSaxoSyntheticForwardParentHistory(pair, historyItems);
  const callHistory = findEntryHistoryMatches(pair.callPosition, historyItems).map((match) => match.item).find(isSaxoFilledTradeHistory);
  const putHistory = findEntryHistoryMatches(pair.putPosition, historyItems).map((match) => match.item).find(isSaxoFilledTradeHistory);
  const missing: SaxoSyntheticForwardFillEvidence["missing"] = [];
  if (!isSaxoFilledTradeHistory(parentHistory)) missing.push("parent");
  if (!callHistory) missing.push("call");
  if (!putHistory) missing.push("put");
  return { status: missing.length === 0 ? "filled" : "incomplete", parentHistory, callHistory, putHistory, missing };
}

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
  orderId?: string;
  ticketId?: string;
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
  accountKey?: string;
  optionRootId?: number;
  optionUic?: number;
  assetType?: string;
  positionId?: string;
  instrumentCode?: string;
  bid?: number;
  ask?: number;
  last?: number;
  mid?: number;
  referencePriceUSD?: number;
  referencePriceLabel?: string;
  manualInputGuidance?: string;
  quoteDiagnostics?: {
    reasonLabel?: string;
    errorCode?: string;
    priceTypeBid?: string;
    priceTypeAsk?: string;
    delayedByMinutes?: number;
    isMarketOpen?: boolean;
    calculationReliability?: string;
    selectedSource?: string;
    attemptedSources?: string[];
    details?: string[];
  };
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
  const activeSimulations = simulations.filter((simulation) => simulation.status === "planned" || simulation.status === "entry_confirmation" || simulation.status === "open");
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
    const fallbackCandidates = candidates.length === 0 ? findPlannedCoveredCallCandidates(activeSimulations, position) : [];
    const effectiveCandidates = candidates.length > 0 ? candidates : fallbackCandidates;
    if (effectiveCandidates.length === 0) {
      rows.push({
        id: `position-${position.id}`,
        status: "app_missing",
        position,
        detail: "Saxo側にありますが、アプリ側の既存建玉に一致候補がありません。",
      });
      continue;
    }

    const candidate = effectiveCandidates[0];
    matchedLegIds.add(`${candidate.simulation.id}:${candidate.leg.id}`);
    const quantityDiff = getQuantityDiff(position, candidate.leg);
    const priceDiff = getPriceDiff(position, candidate.leg);
    const shapeDiff = hasOptionShapeDiff(position, candidate.leg);
    const status: SaxoPositionMatchStatus =
      quantityDiff !== undefined && Math.abs(quantityDiff) > 0.0001
        ? "quantity_diff"
        : shapeDiff || (priceDiff !== undefined && Math.abs(priceDiff) > 0.01)
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
            : [
                position.strike !== undefined && Math.abs(candidate.leg.strikeUSD - position.strike) > 0.001
                  ? `権利行使価格差 Saxo ${formatComparableNumber(position.strike)} / アプリ ${formatComparableNumber(candidate.leg.strikeUSD)}`
                  : undefined,
                position.expiry && normalizeDate(candidate.leg.expiryDate) !== normalizeDate(position.expiry)
                  ? `満期差 Saxo ${position.expiry} / アプリ ${candidate.leg.expiryDate}`
                  : undefined,
                priceDiff !== undefined && Math.abs(priceDiff) > 0.01
                  ? `価格差 Saxo ${formatComparableNumber(position.premiumOpenPrice ?? position.currentOptionPrice)} / アプリ ${formatComparableNumber(candidate.leg.premiumUSD)}`
                  : undefined,
              ].filter(Boolean).join("、") || "Saxo実約定値と注文前入力値に差分があります。",
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

function findPlannedCoveredCallCandidates(
  simulations: TradeSimulation[],
  position: SaxoApiPositionSnapshot,
): Array<{ simulation: TradeSimulation; leg: OptionLeg }> {
  if (position.kind !== "option") return [];
  if (position.accountAssignment !== "N") return [];
  if (position.optionType !== "call") return [];
  if (position.side !== "short") return [];
  const resolvedSymbol = resolveSaxoPositionSymbol(position, simulations);
  return simulations.flatMap((simulation) =>
    simulation.optionLegs
      .filter((leg) => {
        if (simulation.status !== "planned") return false;
        if (simulation.strategyType !== "covered_call") return false;
        if (simulation.accountCode !== "N" || simulation.accountEnvironment !== "PROD_N_USD_SETTLEMENT") return false;
        if (resolvedSymbol && normalizeSymbol(simulation.ticker) !== resolvedSymbol) return false;
        if (leg.type !== "call" || leg.side !== "sell") return false;
        if (position.quantity !== undefined && leg.quantity > 0 && Math.abs(Math.abs(position.quantity) - leg.quantity) > 0.0001) return false;
        return true;
      })
      .map((leg) => ({ simulation, leg })),
  );
}

function hasOptionShapeDiff(position: SaxoApiPositionSnapshot, leg: OptionLeg): boolean {
  if (position.strike !== undefined && Math.abs(leg.strikeUSD - position.strike) > 0.001) return true;
  if (position.expiry && normalizeDate(leg.expiryDate) !== normalizeDate(position.expiry)) return true;
  return false;
}

export function resolveSaxoPositionSymbol(position: SaxoApiPositionSnapshot, simulations: TradeSimulation[] = []): string | undefined {
  const directText = position.symbol?.trim() ?? "";
  const directTicker = directText ? parseLikelyTicker(directText) : undefined;
  if (directTicker) return directTicker;
  const direct = normalizeSymbol(directText);
  if (direct && /^[A-Z][A-Z0-9.]{0,9}$/.test(direct)) return direct;

  const textCandidates = [position.underlyingSymbol, position.instrumentCode, position.underlyingName, position.displayName].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  for (const candidate of textCandidates) {
    const parsed = parseLikelyTicker(candidate);
    if (parsed) return parsed;
  }

  const matchingTickers = new Set(
    simulations
      .filter((simulation) => simulation.status === "planned" || simulation.status === "entry_confirmation" || simulation.status === "open")
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

export type SaxoHistoryCandidateTarget = "entry" | "close" | "assignment" | "stock_settlement" | "unknown";
export const SAXO_CLOSE_ACCOUNT_CONFIRMATION_WARNING =
  "Saxo履歴側の口座情報が建玉側と一致しない、または信頼できないため、正式保存前にN/P口座を確認してください。";

export function getSaxoHistoryCandidateTarget(item: SaxoHistoryDiscoveryItem): SaxoHistoryCandidateTarget {
  if (isSaxoHistoryPutAssignmentOptionCandidate(item)) return "assignment";
  if (isSaxoHistoryStockSettlementCandidate(item)) return "stock_settlement";
  if (!isSaxoOptionHistoryItem(item)) return "unknown";
  if (item.kind === "closed_position") return "close";
  if (item.openClose === "close") return "close";
  if (item.openClose === "open") return "entry";
  if (item.buySell === "buy" && resolveSaxoHistoryOptionType(item) === "call" && resolveSaxoHistoryOptionContract(item)) return "close";
  if (item.buySell === "buy" && (item.profitLoss !== undefined || item.profitLossBase !== undefined)) return "close";
  if (item.buySell === "sell") return "entry";
  if (item.buySell === "buy") return "entry";
  return "unknown";
}

export function getSaxoHistoryCandidateTargetForSimulations(
  item: SaxoHistoryDiscoveryItem,
  simulations: TradeSimulation[],
): SaxoHistoryCandidateTarget {
  const baseTarget = getSaxoHistoryCandidateTarget(item);
  if (baseTarget === "assignment" || baseTarget === "stock_settlement") return baseTarget;
  if (!isSaxoOptionHistoryItem(item)) return "unknown";
  if (item.kind === "closed_position") return "close";
  if (item.openClose === "close") return "close";
  if (item.openClose === "open") return "entry";

  const optionType = resolveSaxoHistoryOptionType(item);
  if (item.buySell === "buy" && optionType === "call") {
    const entryMatches = findSaxoHistoryOptionLegMatches(simulations, item, "entry")
      .filter(({ simulation, leg }) => ["long_call", "synthetic_forward", "combo"].includes(simulation.strategyType) && leg.type === "call" && leg.side === "buy");
    if (entryMatches.length > 0) return "entry";

    const closeMatches = findSaxoHistoryOptionLegMatches(simulations, item, "close")
      .filter(({ leg }) => leg.type === "call" && leg.side === "sell");
    if (closeMatches.length > 0) return "close";

    return "unknown";
  }

  if (item.buySell === "sell" && optionType === "call") {
    const closeMatches = findSaxoHistoryOptionLegMatches(simulations, item, "close")
      .filter(({ leg }) => leg.type === "call" && leg.side === "buy");
    if (closeMatches.length > 0) return "close";
  }

  return baseTarget;
}

function isSaxoOptionHistoryItem(item: SaxoHistoryDiscoveryItem): boolean {
  const assetType = (item.assetType ?? "").toLowerCase();
  return assetType.includes("option") || Boolean(resolveSaxoHistoryOptionContract(item));
}

export function isSaxoHistoryStockSettlementCandidate(item: SaxoHistoryDiscoveryItem): boolean {
  const assetType = (item.assetType ?? "").toLowerCase();
  if (!assetType.includes("stock") || assetType.includes("option")) return false;
  if (item.buySell !== "sell") return false;
  if (item.accountCode === "P") return false;
  const quantity = item.quantity !== undefined ? Math.abs(item.quantity) : undefined;
  if (quantity === undefined || quantity < 1) return false;
  if (item.price === undefined || !Number.isFinite(item.price) || item.price <= 0) return false;
  if (item.accountCode !== "N") {
    const hasNonZeroBooking = item.bookedAmount !== undefined && Math.abs(item.bookedAmount) > 0.0001;
    const hasTransactionCost = item.transactionCost !== undefined && Math.abs(item.transactionCost) > 0.0001;
    if (!hasNonZeroBooking && !hasTransactionCost) return false;
  }
  return Boolean(resolveSaxoHistoryUnderlyingSymbol(item));
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
  return getSaxoHistoryOptionLegMatchDiagnostics(simulation, leg, item, target).matched;
}

export type SaxoHistoryOptionLegMatchDiagnostics = {
  matched: boolean;
  mismatches: string[];
  accountMismatches: string[];
  nonAccountMismatches: string[];
  history: {
    target: SaxoHistoryCandidateTarget;
    accountCode?: SaxoAccountCode;
    accountKey?: string;
    symbol?: string;
    instrumentCode?: string;
    optionType?: "call" | "put";
    strike?: number;
    expiry?: string;
    quantity?: number;
    buySell?: SaxoHistoryDiscoveryItem["buySell"];
    openClose?: SaxoHistoryDiscoveryItem["openClose"];
  };
  app: {
    simulationId: string;
    accountCode?: SaxoAccountCode;
    accountKey?: string;
    ticker: string;
    legId: string;
    optionType: OptionLeg["type"];
    strike: number;
    expiry: string;
    quantity: number;
    side: OptionLeg["side"];
  };
};

export function getSaxoHistoryOptionLegMatchDiagnostics(
  simulation: TradeSimulation,
  leg: OptionLeg,
  item: SaxoHistoryDiscoveryItem,
  target: SaxoHistoryCandidateTarget = getSaxoHistoryCandidateTarget(item),
): SaxoHistoryOptionLegMatchDiagnostics {
  const accountMismatches: string[] = [];
  const nonAccountMismatches: string[] = [];
  const inferredHistoryTarget = getSaxoHistoryCandidateTarget(item);
  // A C-buy leg is ambiguous without Saxo OpenClose. The parent-level resolver has
  // already selected its leg direction, so retain that direction for diagnostics.
  const resolvedHistoryTarget =
    target === "entry" && leg.side === "buy" && item.buySell === "buy"
      ? "entry"
      : target === "close" && leg.side === "buy" && item.buySell === "sell"
        ? "close"
        : inferredHistoryTarget;
  if (target === "unknown") nonAccountMismatches.push("履歴候補の移動先を判定できません。");
  if (item.accountCode && simulation.accountCode && item.accountCode !== simulation.accountCode) {
    accountMismatches.push(`P/N口座が不一致です（履歴: ${item.accountCode} / 建玉: ${simulation.accountCode}）。`);
  }
  if (
    item.accountKey &&
    (leg.saxoAccountKey ?? simulation.fixtureMeta?.saxoAccountKey) &&
    item.accountKey !== (leg.saxoAccountKey ?? simulation.fixtureMeta?.saxoAccountKey) &&
    item.accountKey !== maskSaxoIdentifier(leg.saxoAccountKey ?? simulation.fixtureMeta?.saxoAccountKey ?? "")
  ) {
    accountMismatches.push("Saxo accountKeyが不一致です。");
  }
  const itemOptionType = resolveSaxoHistoryOptionType(item);
  const itemStrike = resolveSaxoHistoryStrike(item);
  const itemExpiry = resolveSaxoHistoryExpiry(item);
  if (itemOptionType === undefined) {
    nonAccountMismatches.push("履歴からPut/Callを取得できません。");
  } else if (itemOptionType !== leg.type) {
    nonAccountMismatches.push(`Put/Callが不一致です（履歴: ${itemOptionType} / 建玉: ${leg.type}）。`);
  }
  if (itemStrike === undefined) {
    nonAccountMismatches.push("履歴から権利行使価格を取得できません。");
  } else if (Math.abs(itemStrike - leg.strikeUSD) > 0.001) {
    nonAccountMismatches.push(`権利行使価格が不一致です（履歴: ${itemStrike} / 建玉: ${leg.strikeUSD}）。`);
  }
  if (!itemExpiry) {
    nonAccountMismatches.push("履歴から満期を取得できません。");
  } else if (normalizeDate(itemExpiry) !== normalizeDate(leg.expiryDate)) {
    nonAccountMismatches.push(`満期が不一致です（履歴: ${normalizeDate(itemExpiry)} / 建玉: ${normalizeDate(leg.expiryDate)}）。`);
  }
  const itemSymbol = resolveSaxoHistoryUnderlyingSymbol(item) ?? normalizeSymbol(item.symbol ?? "");
  if (itemSymbol && normalizeSymbol(simulation.ticker) !== itemSymbol) {
    nonAccountMismatches.push(`原資産が不一致です（履歴: ${itemSymbol} / 建玉: ${normalizeSymbol(simulation.ticker)}）。`);
  }
  if (item.quantity !== undefined && Math.abs(Math.abs(item.quantity) - leg.quantity) > 0.0001) {
    nonAccountMismatches.push(`数量が不一致です（履歴: ${Math.abs(item.quantity)} / 建玉: ${leg.quantity}）。`);
  }

  if (target === "entry") {
    if (leg.side === "sell" && item.buySell !== "sell") nonAccountMismatches.push("建玉開始候補ですが、売り建て脚に対応する履歴の売買区分が売ではありません。");
    if (leg.side === "buy" && item.buySell !== "buy") nonAccountMismatches.push("建玉開始候補ですが、買い建て脚に対応する履歴の売買区分が買ではありません。");
    if (item.kind === "closed_position" || item.openClose === "close") {
      nonAccountMismatches.push(`履歴候補の判定が建玉開始ではありません（判定: ${resolvedHistoryTarget}）。`);
    }
  } else if (target !== "unknown") {
    if (leg.side === "sell" && item.buySell !== "buy") nonAccountMismatches.push("決済候補ですが、売り建て脚に対する反対売買の買履歴ではありません。");
    if (leg.side === "buy" && item.buySell !== "sell") nonAccountMismatches.push("決済候補ですが、買い建て脚に対する反対売買の売履歴ではありません。");
    if (!["close", "assignment"].includes(resolvedHistoryTarget)) {
      nonAccountMismatches.push(`履歴候補の判定が決済または権利行使ではありません（判定: ${resolvedHistoryTarget}）。`);
    }
  }
  const mismatches = [...accountMismatches, ...nonAccountMismatches];

  return {
    matched: mismatches.length === 0,
    mismatches,
    accountMismatches,
    nonAccountMismatches,
    history: {
      target: resolvedHistoryTarget,
      accountCode: item.accountCode,
      accountKey: item.accountKey,
      symbol: item.symbol,
      instrumentCode: item.instrumentCode,
      optionType: itemOptionType,
      strike: itemStrike,
      expiry: itemExpiry ? normalizeDate(itemExpiry) : undefined,
      quantity: item.quantity !== undefined ? Math.abs(item.quantity) : undefined,
      buySell: item.buySell,
      openClose: item.openClose,
    },
    app: {
      simulationId: simulation.id,
      accountCode: simulation.accountCode,
      accountKey: leg.saxoAccountKey ?? simulation.fixtureMeta?.saxoAccountKey,
      ticker: simulation.ticker,
      legId: leg.id,
      optionType: leg.type,
      strike: leg.strikeUSD,
      expiry: normalizeDate(leg.expiryDate),
      quantity: leg.quantity,
      side: leg.side,
    },
  };
}

export type SaxoHistoryResolvedOptionLegMatch = {
  simulation: TradeSimulation;
  leg: OptionLeg;
  diagnostics: SaxoHistoryOptionLegMatchDiagnostics;
  accountConfirmationWarning?: string;
};

export function findSaxoHistoryOptionLegMatches(
  simulations: TradeSimulation[],
  item: SaxoHistoryDiscoveryItem,
  target: SaxoHistoryCandidateTarget = getSaxoHistoryCandidateTarget(item),
  options: { allowCloseAccountMismatch?: boolean } = {},
): SaxoHistoryResolvedOptionLegMatch[] {
  if (target === "unknown") return [];
  const allMatches = simulations.flatMap((simulation) =>
    simulation.optionLegs.map((leg) => ({
      simulation,
      leg,
      diagnostics: getSaxoHistoryOptionLegMatchDiagnostics(simulation, leg, item, target),
    })),
  );
  const strictMatches = allMatches
    .filter((match) => match.diagnostics.matched)
    .map((match) => ({ ...match, accountConfirmationWarning: undefined }));
  if (!options.allowCloseAccountMismatch || target !== "close" || getSaxoHistoryCandidateTarget(item) !== "close") {
    return strictMatches;
  }
  return allMatches
    .filter((match) => match.diagnostics.nonAccountMismatches.length === 0)
    .map((match) => ({
      ...match,
      accountConfirmationWarning:
        match.diagnostics.accountMismatches.length > 0 ? SAXO_CLOSE_ACCOUNT_CONFIRMATION_WARNING : undefined,
    }));
}

export function resolveSaxoHistoryOptionLegMatch(
  simulations: TradeSimulation[],
  item: SaxoHistoryDiscoveryItem,
  target: SaxoHistoryCandidateTarget = getSaxoHistoryCandidateTarget(item),
  selectedSimulationId?: string,
  options: { allowCloseAccountMismatch?: boolean } = {},
): SaxoHistoryResolvedOptionLegMatch | undefined {
  const matches = findSaxoHistoryOptionLegMatches(simulations, item, target, options);
  const selectedMatch = selectedSimulationId ? matches.find((match) => match.simulation.id === selectedSimulationId) : undefined;
  if (selectedMatch) return selectedMatch;
  return matches.length === 1 ? matches[0] : undefined;
}

export function describeBestSaxoHistoryOptionLegMismatch(
  simulations: TradeSimulation[],
  item: SaxoHistoryDiscoveryItem,
  target: SaxoHistoryCandidateTarget = getSaxoHistoryCandidateTarget(item),
): string | undefined {
  const diagnostics = simulations
    .flatMap((simulation) =>
      simulation.optionLegs.map((leg) => getSaxoHistoryOptionLegMatchDiagnostics(simulation, leg, item, target)),
    )
    .sort((a, b) => a.mismatches.length - b.mismatches.length);
  const best = diagnostics[0];
  if (!best || best.mismatches.length === 0) return undefined;
  const historyShape = [
    best.history.accountCode ? `履歴口座 ${best.history.accountCode}` : "履歴口座 未取得",
    best.history.symbol ?? best.history.instrumentCode ? `履歴銘柄 ${best.history.symbol ?? best.history.instrumentCode}` : "履歴銘柄 未取得",
    best.history.optionType ? `履歴種別 ${best.history.optionType}` : "履歴種別 未取得",
    best.history.strike !== undefined ? `履歴権利行使価格 ${best.history.strike}` : "履歴権利行使価格 未取得",
    best.history.expiry ? `履歴満期 ${best.history.expiry}` : "履歴満期 未取得",
    best.history.quantity !== undefined ? `履歴数量 ${best.history.quantity}` : "履歴数量 未取得",
    best.history.buySell ? `履歴売買 ${best.history.buySell}` : "履歴売買 未取得",
  ].join(" / ");
  const appShape = [
    best.app.accountCode ? `建玉口座 ${best.app.accountCode}` : "建玉口座 未取得",
    `建玉銘柄 ${best.app.ticker}`,
    `建玉種別 ${best.app.optionType}`,
    `建玉権利行使価格 ${best.app.strike}`,
    `建玉満期 ${best.app.expiry}`,
    `建玉数量 ${best.app.quantity}`,
    `建玉売買 ${best.app.side}`,
  ].join(" / ");
  return `${historyShape}。${appShape}。不一致: ${best.mismatches.join(" ")}`;
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
    .filter((item) => isStrictEntryHistoryCandidate(position, item))
    .map((item) => scoreEntryHistoryMatch(position, item))
    .filter((match) => match.score >= 5)
    .sort((a, b) => b.score - a.score);
  const bestScore = matches[0]?.score;
  return bestScore === undefined ? [] : matches.filter((match) => match.score >= Math.max(5, bestScore - 2)).slice(0, 5);
}

function isStrictEntryHistoryCandidate(position: SaxoApiPositionSnapshot, item: SaxoHistoryDiscoveryItem): boolean {
  if (item.kind === "closed_position" || item.openClose === "close") return false;
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
  const positionSymbol = resolveSaxoPositionSymbol(position) ?? normalizeSymbol(position.symbol ?? "");
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
  const positionSymbol = resolveSaxoPositionSymbol(position) ?? normalizeSymbol(position.symbol ?? "");
  if (itemSymbol && positionSymbol === itemSymbol) {
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
  if (leg.quantity <= 0) return undefined;
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

export function parseSaxoOptionContract(value: string): { optionType: "call" | "put"; strike: number; expiry?: string } | undefined {
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
  const knownNames: Array<[RegExp, string]> = [
    [/NVIDIA|NVIDIA CORP/i, "NVDA"],
    [/AMAZON|AMAZON\.COM/i, "AMZN"],
    [/NETFLIX/i, "NFLX"],
    [/APPLE/i, "AAPL"],
    [/TESLA/i, "TSLA"],
    [/MICROSOFT/i, "MSFT"],
    [/VISA(?:\s+INC|\s+CLASS|\b)/i, "V"],
  ];
  const known = knownNames.find(([pattern]) => pattern.test(text))?.[1];
  if (known) return known;

  const firstToken = text.match(/^([A-Z][A-Z0-9.]{0,9})(?:[\s/:_-]|$)/i)?.[1];
  const normalized = firstToken ? normalizeSymbol(firstToken) : "";
  if (normalized && !["PUT", "CALL", "STOCKOPTION", "OVERSEAS", "LISTED", "EQUITIES", "OPTION"].includes(normalized)) {
    return normalized;
  }
  return undefined;
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
      detail: apiErrorMessage ?? "別ターミナルでローカルAPI補助ツールを起動してから、状態更新を押してください。",
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
