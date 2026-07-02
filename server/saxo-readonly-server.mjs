import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { promisify } from "node:util";
import { URL } from "node:url";

loadLocalEnvFile();

const execFileAsync = promisify(execFile);
const HOST = "127.0.0.1";
const PORT = Number(process.env.SAXO_LOCAL_API_PORT ?? 18787);
const LOCAL_UI_ALLOWED_ORIGIN =
  process.env.SAXO_LOCAL_UI_ALLOWED_ORIGIN ??
  process.env.SAXO_LOCAL_UI_ORIGIN ??
  "http://127.0.0.1:5173";
const LOCAL_UI_RETURN_URL =
  process.env.SAXO_LOCAL_UI_RETURN_URL ??
  process.env.SAXO_LOCAL_UI_ORIGIN ??
  "http://127.0.0.1:5173/";
const PUBLIC_GITHUB_PAGES_ORIGIN = "https://jimusaku-lab.github.io";
const EXPECTED_REDIRECT_URI = `http://localhost:${PORT}/api/saxo/auth/callback`;
const KEYCHAIN_SERVICE = "us-options-risk-planner-saxo-readonly";
const KEYCHAIN_STORAGE_LABEL = "macOS Keychain";

const pendingPkceByState = new Map();
let tokenState = null;
let lastSyncedAt;
let cachedClient = null;
let cachedCapabilities = null;
let lastConnectionError = null;
let tokenPersistenceStatus = {
  supported: process.platform === "darwin",
  enabled: false,
  restored: false,
  storage: KEYCHAIN_STORAGE_LABEL,
  status: process.platform === "darwin" ? "not_checked" : "unsupported",
  message: process.platform === "darwin" ? "Keychain確認前です。" : "macOS以外ではKeychain接続保持は無効です。",
};

await restoreTokenStateFromKeychain();

const server = http.createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    sendJson(response, error instanceof HttpError ? error.status : 500, {
      error: error instanceof HttpError ? error.code : "local_api_error",
      message: error instanceof Error ? error.message : "ローカルAPIでエラーが発生しました。",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Saxo read-only local API listening on http://${HOST}:${PORT}`);
});

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  setCorsHeaders(request, response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const path = requestUrl.pathname;

  if (isForbiddenOrderPath(path, request.method)) {
    sendJson(response, 404, { error: "not_found", message: "注文系API endpointは実装していません。" });
    return;
  }

  if (request.method === "GET" && (path === "/api/market/quote" || path === "/api/quote")) {
    const symbol = requestUrl.searchParams.get("symbol") ?? "";
    const quote = await getMarketQuote(symbol);
    sendJson(response, 200, quote);
    return;
  }

  if (request.method === "GET" && (path === "/api/market/fx/usdjpy" || path === "/api/fx")) {
    const quote = await getUsdJpyQuote();
    sendJson(response, 200, quote);
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/config/status") {
    sendJson(response, 200, getConfigStatus());
    return;
  }

  if (request.method === "POST" && path === "/api/saxo/config/local") {
    const body = await readJsonBody(request);
    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
    const environment = typeof body.environment === "string" ? body.environment.trim() : "";
    if (!clientId) {
      throw new HttpError(400, "missing_client_id", "LIVE AppKey（Client ID）が未入力です。");
    }
    if (environment !== "sim" && environment !== "live") {
      throw new HttpError(400, "invalid_environment", "環境は sim または live を指定してください。");
    }
    saveLocalSaxoConfig({ clientId, environment });
    process.env.SAXO_CLIENT_ID = clientId;
    process.env.SAXO_ENVIRONMENT = environment;
    tokenState = null;
    lastConnectionError = null;
    cachedClient = null;
    cachedCapabilities = null;
    pendingPkceByState.clear();
    tokenPersistenceStatus = {
      ...tokenPersistenceStatus,
      enabled: false,
      restored: false,
      status: tokenPersistenceStatus.supported ? "client_changed" : "unsupported",
      message: "Client IDまたは環境を変更しました。既存のKeychain tokenは使わず、再ログインしてください。",
    };
    sendJson(response, 200, getConfigStatus("ローカル設定を保存しました。Saxo接続を開始できます。"));
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/status") {
    sendJson(response, 200, getStatus());
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/auth/start") {
    await handleAuthStart(request, requestUrl, response);
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/auth/callback") {
    await handleAuthCallback(requestUrl, response);
    return;
  }

  if (request.method === "POST" && path === "/api/saxo/logout") {
    tokenState = null;
    lastConnectionError = null;
    cachedClient = null;
    cachedCapabilities = null;
    pendingPkceByState.clear();
    await deleteTokenStateFromKeychain();
    tokenPersistenceStatus = {
      ...tokenPersistenceStatus,
      enabled: false,
      restored: false,
      status: tokenPersistenceStatus.supported ? "logged_out" : "unsupported",
      message: tokenPersistenceStatus.supported
        ? "Saxo logoutによりKeychainの接続維持情報も削除しました。"
        : "Saxo接続を解除しました。",
    };
    sendJson(response, 200, getStatus("Saxo接続を解除しました。"));
    return;
  }

  if (request.method === "POST" && path === "/api/saxo/persistence/enable") {
    await enableTokenPersistence();
    sendJson(response, 200, getStatus("このMacのKeychainにSaxo接続維持情報を保存しました。"));
    return;
  }

  if (request.method === "POST" && path === "/api/saxo/persistence/disable") {
    await disableTokenPersistence();
    sendJson(response, 200, getStatus("KeychainのSaxo接続維持情報を削除しました。"));
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/session/capabilities") {
    const capabilities = await getSessionCapabilities();
    sendJson(response, 200, capabilities);
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/client") {
    const client = await getClient();
    sendJson(response, 200, client);
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/accounts") {
    const accounts = await getAccounts();
    sendJson(response, 200, accounts);
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/positions") {
    const positions = await getPositions();
    sendJson(response, 200, positions);
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/orders") {
    const orders = await getOrders();
    sendJson(response, 200, orders);
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/orders/snapshot") {
    const snapshot = await getOrdersSnapshot();
    sendJson(response, 200, snapshot);
    return;
  }

  const accountPositionsMatch = path.match(/^\/api\/saxo\/accounts\/([^/]+)\/positions$/);
  if (request.method === "GET" && accountPositionsMatch) {
    const accountKey = decodeURIComponent(accountPositionsMatch[1]);
    const positions = await getPositions(accountKey);
    sendJson(response, 200, positions);
    return;
  }

  const accountOrdersMatch = path.match(/^\/api\/saxo\/accounts\/([^/]+)\/orders$/);
  if (request.method === "GET" && accountOrdersMatch) {
    const accountKey = decodeURIComponent(accountOrdersMatch[1]);
    const orders = await getOrders(accountKey);
    sendJson(response, 200, orders);
    return;
  }

  const balanceMatch = path.match(/^\/api\/saxo\/accounts\/([^/]+)\/balance$/);
  if (request.method === "GET" && balanceMatch) {
    const accountKey = decodeURIComponent(balanceMatch[1]);
    const balance = await getAccountBalance(accountKey);
    sendJson(response, 200, balance);
    return;
  }

  const marginMatch = path.match(/^\/api\/saxo\/accounts\/([^/]+)\/margin$/);
  if (request.method === "GET" && marginMatch) {
    const accountKey = decodeURIComponent(marginMatch[1]);
    const margin = await getAccountMargin(accountKey);
    sendJson(response, 200, margin);
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/accounts/snapshot") {
    const snapshot = await getAccountsSnapshot();
    sendJson(response, 200, snapshot);
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/positions/snapshot") {
    const snapshot = await getPositionsSnapshot();
    sendJson(response, 200, snapshot);
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/history/discovery") {
    const fromDate = requestUrl.searchParams.get("from") ?? defaultHistoryFromDate();
    const toDate = requestUrl.searchParams.get("to") ?? formatDateOnly(new Date());
    const discovery = await getHistoryDiscovery({ fromDate, toDate });
    sendJson(response, 200, discovery);
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/closed-positions") {
    const fromDate = requestUrl.searchParams.get("from") ?? defaultHistoryFromDate();
    const toDate = requestUrl.searchParams.get("to") ?? formatDateOnly(new Date());
    const closed = await getClosedPositions({ fromDate, toDate });
    sendJson(response, 200, closed);
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/trades") {
    const fromDate = requestUrl.searchParams.get("from") ?? defaultHistoryFromDate();
    const toDate = requestUrl.searchParams.get("to") ?? formatDateOnly(new Date());
    const trades = await getTrades({ fromDate, toDate });
    sendJson(response, 200, trades);
    return;
  }

  if (request.method === "GET" && path === "/api/saxo/options/premium-candidate") {
    const candidate = await getOptionPremiumCandidate({
      symbol: requestUrl.searchParams.get("symbol") ?? "",
      expiry: requestUrl.searchParams.get("expiry") ?? "",
      strike: requestUrl.searchParams.get("strike") ?? "",
      optionType: requestUrl.searchParams.get("optionType") ?? "",
      accountKey: requestUrl.searchParams.get("accountKey") ?? "",
      uic: requestUrl.searchParams.get("uic") ?? "",
      assetType: requestUrl.searchParams.get("assetType") ?? "",
      positionId: requestUrl.searchParams.get("positionId") ?? "",
      instrumentCode: requestUrl.searchParams.get("instrumentCode") ?? "",
    });
    sendJson(response, 200, candidate);
    return;
  }

  sendJson(response, 404, { error: "not_found", message: "このSaxo read-only endpointは実装していません。" });
}

async function handleAuthStart(request, requestUrl, response) {
  const clientId = getClientId();
  if (!clientId) {
    sendJson(response, 400, {
      error: "missing_client_id",
      message: "SAXO_CLIENT_ID または SAXO_APP_KEY が未設定です。",
      readOnly: true,
    });
    return;
  }

  const state = randomUrlSafe(32);
  const codeVerifier = randomUrlSafe(64);
  const codeChallenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());
  pendingPkceByState.set(state, {
    codeVerifier,
    createdAt: Date.now(),
    returnUrl: resolveAuthReturnUrl(request, requestUrl),
  });

  const authorizeUrl = new URL(`${getAuthBaseUrl()}/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("redirect_uri", getRedirectUri());
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  response.writeHead(302, { Location: authorizeUrl.toString() });
  response.end();
}

async function handleAuthCallback(requestUrl, response) {
  const state = requestUrl.searchParams.get("state") ?? "";
  const code = requestUrl.searchParams.get("code") ?? "";
  const error = requestUrl.searchParams.get("error");
  const pkce = pendingPkceByState.get(state);

  if (error) {
    sendHtml(response, 400, `Saxo認証がキャンセルまたは失敗しました: ${escapeHtml(error)}`);
    return;
  }
  if (!state || !code || !pkce) {
    sendHtml(response, 400, "Saxo認証stateを検証できませんでした。もう一度接続してください。");
    return;
  }

  pendingPkceByState.delete(state);
  const token = await exchangeToken({
    grant_type: "authorization_code",
    code,
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    code_verifier: pkce.codeVerifier,
  });

  tokenState = normalizeToken(token, pkce.codeVerifier);
  lastConnectionError = null;
  lastSyncedAt = new Date().toISOString();
  sendAuthSuccessHtml(response, pkce.returnUrl);
}

async function exchangeToken(params) {
  const body = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
  const tokenResponse = await fetch(`${getAuthBaseUrl()}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    throw new Error(`Saxo token exchange failed: ${tokenResponse.status} ${text.slice(0, 200)}`);
  }
  return tokenResponse.json();
}

async function ensureAccessToken() {
  if (!tokenState?.accessToken) {
    throw new HttpError(401, "not_connected", "Saxoに未接続です。");
  }
  if (tokenState.expiresAt && Date.now() < tokenState.expiresAt - 60_000) {
    return tokenState.accessToken;
  }
  if (!tokenState.refreshToken) {
    lastConnectionError = "Saxo接続の期限が切れました。再接続してください。";
    throw new HttpError(401, "token_expired", lastConnectionError);
  }
  if (tokenState.refreshExpiresAt && Date.now() >= tokenState.refreshExpiresAt) {
    tokenState = null;
    cachedClient = null;
    cachedCapabilities = null;
    await markKeychainTokenInvalid("Saxo接続の期限が切れました。Saxo公式画面で再ログインしてください。");
    lastConnectionError = "Saxo接続の期限が切れました。再接続してください。";
    throw new HttpError(401, "token_expired", lastConnectionError);
  }

  try {
    const wasPersisted = Boolean(tokenState.persisted);
    const token = await exchangeToken({
      grant_type: "refresh_token",
      refresh_token: tokenState.refreshToken,
    });
    tokenState = normalizeToken(token, tokenState.codeVerifier);
    tokenState.persisted = wasPersisted;
    if (wasPersisted) {
      await saveTokenStateToKeychain("refresh");
    }
    lastConnectionError = null;
    return tokenState.accessToken;
  } catch {
    tokenState = null;
    cachedClient = null;
    cachedCapabilities = null;
    await markKeychainTokenInvalid("Saxo接続の期限が切れました。Saxo公式画面で再ログインしてください。");
    lastConnectionError = "Saxo接続の期限が切れました。再接続してください。";
    throw new HttpError(401, "token_expired", lastConnectionError);
  }
}

async function saxoGet(path, query) {
  const accessToken = await ensureAccessToken();
  const url = new URL(path.replace(/^\//, ""), getOpenApiBaseUrl());
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const apiResponse = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  if (!apiResponse.ok) {
    const text = await apiResponse.text();
    throw new HttpError(apiResponse.status, "saxo_api_error", `Saxo API取得に失敗しました: ${apiResponse.status} ${text.slice(0, 200)}`);
  }
  lastSyncedAt = new Date().toISOString();
  return apiResponse.json();
}

async function getClient() {
  if (cachedClient) return cachedClient;
  cachedClient = await saxoGet("port/v1/clients/me");
  return cachedClient;
}

async function getSessionCapabilities() {
  if (cachedCapabilities) return cachedCapabilities;
  cachedCapabilities = await saxoGet("root/v1/sessions/capabilities");
  return cachedCapabilities;
}

async function getAccounts() {
  const client = await getClient();
  const clientKey = client.ClientKey ?? client.ClientId ?? client.ClientKeyId;
  const payload = await saxoGet("port/v1/accounts", {
    ...(clientKey ? { ClientKey: clientKey, IncludeSubAccounts: true } : { IncludeSubAccounts: true }),
  });
  const accounts = payload.Data ?? payload.Accounts ?? [];
  return {
    environment: getEnvironment(),
    fetchedAt: new Date().toISOString(),
    accounts: accounts.map(normalizeAccount),
    raw: payload,
  };
}

async function getAccountBalance(accountKey) {
  const client = await getClient();
  const clientKey = client.ClientKey ?? client.ClientId ?? client.ClientKeyId;
  const payload = await saxoGet("port/v1/balances", { ClientKey: clientKey, AccountKey: accountKey });
  return { accountKey, fetchedAt: new Date().toISOString(), raw: payload };
}

async function getAccountMargin(accountKey) {
  const client = await getClient();
  const clientKey = client.ClientKey ?? client.ClientId ?? client.ClientKeyId;
  const payload = await saxoGet("port/v1/balances/marginoverview", { ClientKey: clientKey, AccountKey: accountKey });
  return { accountKey, fetchedAt: new Date().toISOString(), raw: payload };
}

async function getAccountsSnapshot() {
  const accountsResponse = await getAccounts();
  const snapshots = [];
  for (const account of accountsResponse.accounts) {
    const [balanceResult, marginResult] = await Promise.allSettled([
      getAccountBalance(account.accountKey),
      getAccountMargin(account.accountKey),
    ]);
    const balance = balanceResult.status === "fulfilled" ? balanceResult.value.raw : undefined;
    const margin = marginResult.status === "fulfilled" ? marginResult.value.raw : undefined;
    snapshots.push(normalizeAccountSnapshot(account, balance, margin));
  }
  return {
    environment: getEnvironment(),
    fetchedAt: new Date().toISOString(),
    accounts: snapshots,
  };
}

async function getPositions(accountKey) {
  const client = await getClient();
  const clientKey = client.ClientKey ?? client.ClientId ?? client.ClientKeyId;
  const payload = await saxoGet("port/v1/positions", {
    ...(clientKey ? { ClientKey: clientKey } : {}),
    ...(accountKey ? { AccountKey: accountKey } : {}),
  });
  const rawPositions = Array.isArray(payload.Data) ? payload.Data : Array.isArray(payload.Positions) ? payload.Positions : [];
  const accountsResponse = await getAccounts();
  const accountsByKey = new Map(accountsResponse.accounts.map((account) => [account.accountKey, account]));
  const fetchedAt = new Date().toISOString();
  return {
    environment: getEnvironment(),
    fetchedAt,
    positions: rawPositions.map((raw, index) => normalizePosition(raw, accountsByKey, fetchedAt, index)),
    raw: payload,
  };
}

async function getPositionsSnapshot() {
  const response = await getPositions();
  return {
    environment: response.environment,
    fetchedAt: response.fetchedAt,
    positions: response.positions,
  };
}

async function getOrders(accountKey) {
  const client = await getClient();
  const clientKey = getClientKey(client);
  const payload = await saxoGet("port/v1/orders", {
    ...(clientKey ? { ClientKey: clientKey } : {}),
    ...(accountKey ? { AccountKey: accountKey } : {}),
    Status: "Working",
    FieldGroups: "DisplayAndFormat,ExchangeInfo",
  });
  const rawOrders = Array.isArray(payload.Data) ? payload.Data : Array.isArray(payload.Orders) ? payload.Orders : [];
  const accountsResponse = await getAccounts();
  const accountsByKey = new Map(accountsResponse.accounts.map((account) => [account.accountKey, account]));
  const fetchedAt = new Date().toISOString();
  return {
    environment: getEnvironment(),
    fetchedAt,
    orders: rawOrders.map((raw, index) => normalizeOrder(raw, accountsByKey, fetchedAt, index)),
    raw: payload,
  };
}

async function getOrdersSnapshot() {
  const response = await getOrders();
  return {
    environment: response.environment,
    fetchedAt: response.fetchedAt,
    orders: response.orders,
  };
}

async function getClosedPositions({ fromDate, toDate }) {
  const client = await getClient();
  const clientKey = getClientKey(client);
  const payload = await saxoGet("port/v1/closedpositions", {
    ...(clientKey ? { ClientKey: clientKey } : {}),
    $top: 100,
    FieldGroups: "ClosedPosition,DisplayAndFormat",
  });
  const rawItems = Array.isArray(payload.Data) ? payload.Data : [];
  return {
    endpoint: "port/v1/closedpositions",
    status: "available",
    fromDate,
    toDate,
    fetchedAt: new Date().toISOString(),
    items: rawItems.map((raw, index) => normalizeHistoryItem(raw, "closed_position", index)),
    raw: payload,
  };
}

async function getTrades({ fromDate, toDate }) {
  const client = await getClient();
  const clientKey = getClientKey(client);
  if (!clientKey) {
    throw new HttpError(422, "client_key_unavailable", "ClientKeyが未取得のため、取引履歴候補を取得できません。");
  }
  const payload = await saxoGet(`cs/v1/reports/trades/${encodeURIComponent(clientKey)}`, {
    FromDate: fromDate,
    ToDate: toDate,
    $top: 100,
  });
  const rawItems = Array.isArray(payload.Data) ? payload.Data : Array.isArray(payload.Trades) ? payload.Trades : [];
  return {
    endpoint: "cs/v1/reports/trades/{ClientKey}",
    status: "available",
    fromDate,
    toDate,
    fetchedAt: new Date().toISOString(),
    items: rawItems.map((raw, index) => normalizeHistoryItem(raw, "trade", index)),
    raw: payload,
  };
}

async function getHistoryDiscovery({ fromDate, toDate }) {
  const results = await Promise.allSettled([
    getClosedPositions({ fromDate, toDate }),
    getTrades({ fromDate, toDate }),
  ]);
  const endpoints = [
    normalizeDiscoveryResult("port/v1/closedpositions", "決済済み建玉候補", results[0]),
    normalizeDiscoveryResult("cs/v1/reports/trades/{ClientKey}", "約定・取引履歴候補", results[1]),
  ];
  return {
    environment: getEnvironment(),
    fetchedAt: new Date().toISOString(),
    fromDate,
    toDate,
    endpoints,
  };
}

async function getOptionPremiumCandidate({ symbol, expiry, strike, optionType, accountKey, uic, assetType, positionId, instrumentCode }) {
  const normalizedSymbol = normalizeTicker(symbol);
  const normalizedExpiry = normalizeSaxoDate(expiry);
  const numericStrike = Number(strike);
  const normalizedOptionType = String(optionType ?? "").toLowerCase();
  if (!normalizedSymbol || !normalizedExpiry || !Number.isFinite(numericStrike) || (normalizedOptionType !== "put" && normalizedOptionType !== "call")) {
    throw new HttpError(400, "invalid_option_query", "銘柄、満期、権利行使価格、call/putを指定してください。");
  }

  const selectedAccountKey = String(accountKey ?? "").trim();
  const requestedUic = Number(uic);
  const requestedAssetType = String(assetType ?? "").trim() || "StockOption";
  const requestedPositionId = String(positionId ?? "").trim();
  const requestedInstrumentCode = String(instrumentCode ?? "").trim();
  const fetchedAt = new Date().toISOString();
  const directSource = "trade/v1/infoprices (existing position UIC)";
  const positionSource = "port/v1/positions + trade/v1/infoprices";
  const rootSource = "ref/v1/instruments + ref/v1/instruments/contractoptionspaces + trade/v1/infoprices";

  if (Number.isFinite(requestedUic) && requestedUic > 0) {
    if (!selectedAccountKey) {
      return createUnavailableOptionCandidate({
        symbol: normalizedSymbol,
        expiry: normalizedExpiry,
        strike: numericStrike,
        optionType: normalizedOptionType,
        accountKey: selectedAccountKey,
        fetchedAt,
        source: directSource,
        classification: "Saxo accountKey未取得",
        status: "unavailable",
        message: "既存建玉のSaxo accountKeyが未取得のため、UIC指定のInfoPriceを取得できません。建玉候補のSaxo識別情報を確認してください。",
        optionUic: requestedUic,
        assetType: requestedAssetType,
        positionId: requestedPositionId,
        instrumentCode: requestedInstrumentCode,
      });
    }
    try {
      const price = await getInfoPriceForOption({
        accountKey: selectedAccountKey,
        uic: requestedUic,
        assetType: requestedAssetType,
      });
      return normalizeOptionPremiumCandidate({
        symbol: normalizedSymbol,
        expiry: normalizedExpiry,
        strike: numericStrike,
        optionType: normalizedOptionType,
        accountKey: selectedAccountKey,
        fetchedAt,
        source: directSource,
        contract: {
          uic: requestedUic,
          assetType: requestedAssetType,
          positionId: requestedPositionId,
          instrumentCode: requestedInstrumentCode,
        },
        price,
        messageSourceLabel: "既存建玉のUIC",
      });
    } catch (error) {
      return createUnavailableOptionCandidate({
        symbol: normalizedSymbol,
        expiry: normalizedExpiry,
        strike: numericStrike,
        optionType: normalizedOptionType,
        accountKey: selectedAccountKey,
        fetchedAt,
        source: directSource,
        classification: classifyOptionPremiumFailure(error),
        status: "unavailable",
        message: `既存建玉のUICでInfoPriceを取得できませんでした。${error instanceof Error ? error.message : "取得失敗"}`,
        optionUic: requestedUic,
        assetType: requestedAssetType,
        positionId: requestedPositionId,
        instrumentCode: requestedInstrumentCode,
      });
    }
  }

  if (selectedAccountKey && (requestedPositionId || requestedInstrumentCode)) {
    const matchedPosition = await findOptionPremiumPositionCandidate({
      accountKey: selectedAccountKey,
      positionId: requestedPositionId,
      instrumentCode: requestedInstrumentCode,
      symbol: normalizedSymbol,
      expiry: normalizedExpiry,
      strike: numericStrike,
      optionType: normalizedOptionType,
    });
    if (matchedPosition?.uic) {
      const matchedAssetType = matchedPosition.assetType || requestedAssetType;
      try {
        const price = await getInfoPriceForOption({
          accountKey: selectedAccountKey,
          uic: matchedPosition.uic,
          assetType: matchedAssetType,
        });
        return normalizeOptionPremiumCandidate({
          symbol: normalizedSymbol,
          expiry: normalizedExpiry,
          strike: numericStrike,
          optionType: normalizedOptionType,
          accountKey: selectedAccountKey,
          fetchedAt,
          source: positionSource,
          contract: {
            uic: matchedPosition.uic,
            assetType: matchedAssetType,
            positionId: matchedPosition.positionId,
            instrumentCode: matchedPosition.instrumentCode,
          },
          price,
          messageSourceLabel: "現在建玉スナップショットのUIC",
        });
      } catch (error) {
        return createUnavailableOptionCandidate({
          symbol: normalizedSymbol,
          expiry: normalizedExpiry,
          strike: numericStrike,
          optionType: normalizedOptionType,
          accountKey: selectedAccountKey,
          fetchedAt,
          source: positionSource,
          classification: classifyOptionPremiumFailure(error),
          status: "unavailable",
          message: `現在建玉スナップショットのUICでInfoPriceを取得できませんでした。${error instanceof Error ? error.message : "取得失敗"}`,
          optionUic: matchedPosition.uic,
          assetType: matchedAssetType,
          positionId: matchedPosition.positionId,
          instrumentCode: matchedPosition.instrumentCode,
        });
      }
    }
  }

  if (!selectedAccountKey) {
    return createUnavailableOptionCandidate({
      symbol: normalizedSymbol,
      expiry: normalizedExpiry,
      strike: numericStrike,
      optionType: normalizedOptionType,
      accountKey,
      fetchedAt,
      source: rootSource,
      classification: "Saxo accountKey未取得",
      status: "unavailable",
      message: "価格取得に使うSaxo accountKeyが未取得です。P/N口座を誤らないため、先頭口座への自動フォールバックは行いません。",
    });
  }

  const client = await getClient();
  const clientKey = getClientKey(client);
  const roots = await findContractOptionRoots({ symbol: normalizedSymbol, accountKey: selectedAccountKey });
  if (roots.length === 0) {
    return createUnavailableOptionCandidate({
      symbol: normalizedSymbol,
      expiry: normalizedExpiry,
      strike: numericStrike,
      optionType: normalizedOptionType,
      accountKey: selectedAccountKey,
      fetchedAt,
      source: rootSource,
      classification: getOptionRootMissingClassification(),
      status: "unavailable",
      message: `${normalizedSymbol} のContract Option Rootが見つかりません。${getEnvironment() === "live" ? "LIVE接続の契約ルート取得条件またはSaxo権限を確認してください。" : "SIM環境の取扱銘柄または検索条件を確認してください。"}`,
    });
  }

  const errors = [];
  for (const root of roots) {
    try {
      const optionSpace = await getContractOptionSpace({
        root,
        clientKey,
        expiry: normalizedExpiry,
      });
      const contract = findOptionContractInSpace(optionSpace, {
        expiry: normalizedExpiry,
        strike: numericStrike,
        optionType: normalizedOptionType,
      });
      if (!contract?.uic) continue;
      const price = await getInfoPriceForOption({
        accountKey: selectedAccountKey,
        uic: contract.uic,
        assetType: contract.assetType ?? optionSpace.AssetType ?? root.AssetType ?? "StockOption",
      });
      return normalizeOptionPremiumCandidate({
        symbol: normalizedSymbol,
        expiry: normalizedExpiry,
        strike: numericStrike,
        optionType: normalizedOptionType,
        accountKey: selectedAccountKey,
        fetchedAt,
        source: rootSource,
        root,
        contract,
        price,
        messageSourceLabel: "OptionSpaceで特定したUIC",
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "取得失敗");
    }
  }

  return createUnavailableOptionCandidate({
    symbol: normalizedSymbol,
    expiry: normalizedExpiry,
    strike: numericStrike,
    optionType: normalizedOptionType,
    accountKey: selectedAccountKey,
    fetchedAt,
    source: rootSource,
    classification: errors.length > 0 ? classifyOptionPremiumFailure(new Error(errors.join(" / "))) : getOptionRootMissingClassification(),
    status: "unavailable",
    message:
      errors.length > 0
        ? `OptionSpaceまたはInfoPriceを取得できませんでした。${errors.slice(0, 2).join(" / ")}`
        : `${normalizedSymbol} ${normalizedExpiry} ${numericStrike} ${normalizedOptionType.toUpperCase()} に一致するオプションUicが見つかりません。`,
  });
}

async function findOptionPremiumPositionCandidate({ accountKey, positionId, instrumentCode, symbol, expiry, strike, optionType }) {
  const response = await getPositions(accountKey);
  const normalizedInstrumentCode = normalizeComparableInstrument(instrumentCode);
  return response.positions.find((position) => {
    if (position.kind !== "option") return false;
    if (position.accountKey && position.accountKey !== accountKey) return false;
    if (positionId && position.positionId !== positionId && position.id !== positionId) return false;
    if (normalizedInstrumentCode) {
      const positionInstrument = normalizeComparableInstrument(position.instrumentCode);
      if (positionInstrument && positionInstrument !== normalizedInstrumentCode) return false;
    }
    if (position.optionType && position.optionType !== "unknown" && position.optionType !== optionType) return false;
    if (position.strike !== undefined && Math.abs(position.strike - strike) > 0.001) return false;
    if (position.expiry && normalizeSaxoDate(position.expiry) !== normalizeSaxoDate(expiry)) return false;
    const positionSymbol = normalizeTicker(position.symbol ?? "");
    if (positionSymbol && positionSymbol !== symbol) return false;
    return true;
  });
}

function normalizeComparableInstrument(value) {
  return String(value ?? "").trim().toUpperCase();
}

function getOptionRootMissingClassification() {
  return getEnvironment() === "live" ? "LIVEで契約ルート未取得" : "SIMで契約ルート未取得";
}

function classifyOptionPremiumFailure(error) {
  const classified = classifySaxoFailure(error);
  return classified === "取得失敗" ? "Saxo価格候補を取得できません" : classified;
}

async function findContractOptionRoots({ symbol, accountKey }) {
  const payload = await saxoGet("ref/v1/instruments", {
    Keywords: symbol,
    AssetTypes: "StockOption,StockIndexOption",
    IncludeNonTradable: true,
    $top: 50,
    ...(accountKey ? { AccountKey: accountKey } : {}),
  });
  const rows = Array.isArray(payload.Data) ? payload.Data : [];
  return rows
    .filter((row) => {
      const summaryType = String(row.SummaryType ?? "").toLowerCase();
      const assetType = String(row.AssetType ?? "").toLowerCase();
      const rowSymbol = normalizeTicker(String(row.Symbol ?? row.Description ?? ""));
      return (
        summaryType.includes("optionroot") ||
        summaryType.includes("contractoptionroot") ||
        (assetType.includes("option") && row.Identifier !== undefined && rowSymbol.includes(symbol))
      );
    })
    .map((row) => ({
      optionRootId: Number(row.Identifier),
      assetType: row.AssetType,
      symbol: row.Symbol,
      description: row.Description,
      primaryListing: row.PrimaryListing,
      raw: row,
    }))
    .filter((row) => Number.isFinite(row.optionRootId));
}

async function getContractOptionSpace({ root, clientKey, expiry }) {
  return saxoGet(`ref/v1/instruments/contractoptionspaces/${encodeURIComponent(root.optionRootId)}`, {
    ...(clientKey ? { ClientKey: clientKey } : {}),
    ExpiryDates: expiry,
    OptionSpaceSegment: "SpecificDates",
    ...(root.primaryListing ? { UnderlyingUic: root.primaryListing } : {}),
  });
}

async function getInfoPriceForOption({ accountKey, uic, assetType }) {
  return saxoGet("trade/v1/infoprices", {
    AccountKey: accountKey,
    Uic: uic,
    AssetType: assetType,
    Amount: 1,
    FieldGroups: "Quote,PriceInfo,PriceInfoDetails,DisplayAndFormat,Greeks",
    ToOpenClose: "ToClose",
  });
}

function findOptionContractInSpace(optionSpace, target) {
  const matches = [];
  walkOptionSpace(optionSpace, {}, (node, inherited) => {
    const uic = firstNumber(node, ["Uic"]);
    const strike = firstNumber(node, ["StrikePrice", "Strike", "ExercisePrice"]);
    const optionType = inferOptionType(node);
    const expiry = normalizeSaxoDate(firstString(node, ["ExpiryDate", "Expiry", "Date"]) ?? inherited.expiry);
    if (!uic || strike === undefined || !expiry) return;
    if (optionType !== target.optionType) return;
    if (normalizeSaxoDate(expiry) !== normalizeSaxoDate(target.expiry)) return;
    if (Math.abs(strike - target.strike) > 0.001) return;
    matches.push({
      uic,
      strike,
      expiry,
      optionType,
      assetType: firstString(node, ["AssetType"]) ?? optionSpace.AssetType,
      raw: node,
    });
  });
  return matches[0];
}

function walkOptionSpace(value, inherited, visit) {
  if (!value || typeof value !== "object") return;
  const nextInherited = {
    ...inherited,
    expiry: normalizeSaxoDate(firstString(value, ["ExpiryDate", "Expiry", "Date"])) ?? inherited.expiry,
  };
  if (!Array.isArray(value)) visit(value, nextInherited);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    if (child && typeof child === "object") walkOptionSpace(child, nextInherited, visit);
  }
}

function normalizeOptionPremiumCandidate({ symbol, expiry, strike, optionType, accountKey, fetchedAt, source, root, contract, price, messageSourceLabel }) {
  const quote = price.Quote ?? {};
  const priceInfoDetails = price.PriceInfoDetails ?? {};
  const bid = firstNumber(quote, ["Bid"]);
  const ask = firstNumber(quote, ["Ask"]);
  const mid = firstNumber(quote, ["Mid"]);
  const last = firstNumber(priceInfoDetails, ["LastTraded", "Last", "Close"]) ?? firstNumber(price.PriceInfo ?? {}, ["Last", "Close"]);
  const hasPrice = [bid, ask, mid, last].some((value) => value !== undefined && Number.isFinite(value));
  return {
    environment: getEnvironment(),
    fetchedAt,
    status: hasPrice ? "available" : "unavailable",
    classification: hasPrice ? "取得可能" : "Saxo価格候補を取得できません",
    source,
    symbol,
    expiry,
    strike,
    optionType,
    accountKey: maskSecret(accountKey),
    optionRootId: root?.optionRootId,
    optionUic: contract.uic,
    assetType: contract.assetType ?? root?.assetType,
    positionId: contract.positionId,
    instrumentCode: contract.instrumentCode,
    bid,
    ask,
    last,
    mid,
    message: hasPrice
      ? `${messageSourceLabel ?? "InfoPrice"}から候補価格を取得しました。自動入力はしません。`
      : `該当オプションUicは見つかりましたが、InfoPriceにbid/ask/last/midがありません。未取得値は0扱いしません。`,
  };
}

function createUnavailableOptionCandidate({
  symbol,
  expiry,
  strike,
  optionType,
  accountKey,
  fetchedAt,
  source,
  classification,
  status,
  message,
  optionUic,
  assetType,
  positionId,
  instrumentCode,
}) {
  return {
    environment: getEnvironment(),
    fetchedAt,
    status,
    classification,
    source,
    symbol,
    expiry,
    strike,
    optionType,
    accountKey: accountKey ? maskSecret(accountKey) : undefined,
    optionUic,
    assetType,
    positionId,
    instrumentCode,
    bid: undefined,
    ask: undefined,
    last: undefined,
    mid: undefined,
    message,
  };
}

async function getMarketQuote(symbol) {
  const normalized = normalizeTicker(symbol);
  if (!normalized) {
    throw new HttpError(400, "missing_symbol", "ティッカーが未入力です。");
  }
  const source = "nasdaq";
  const upstreamUrl = `https://api.nasdaq.com/api/quote/${encodeURIComponent(normalized)}/info?assetclass=stocks`;
  const payload = await fetchUpstreamJson(upstreamUrl, source, normalized, {
    "user-agent": "Mozilla/5.0",
    accept: "application/json,text/plain,*/*",
  });
  const data = payload?.data;
  const price = parseMoney(data?.primaryData?.lastSalePrice ?? data?.secondaryData?.lastSalePrice);
  if (!Number.isFinite(price) || price <= 0) {
    throw new HttpError(502, "quote_missing_price", `株価を取得できませんでした。symbol=${normalized} source=${source} reason=価格が未取得です。`);
  }
  return {
    symbol: normalized,
    price,
    date: data?.primaryData?.lastTradeTimestamp ?? data?.secondaryData?.lastTradeTimestamp,
    source,
    fetchedAt: new Date().toISOString(),
  };
}

async function getUsdJpyQuote() {
  const source = "frankfurter";
  const upstreamUrl = "https://api.frankfurter.app/latest?from=USD&to=JPY";
  const payload = await fetchUpstreamJson(upstreamUrl, source, "USDJPY");
  const rate = Number(payload?.rates?.JPY ?? 0);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new HttpError(502, "fx_missing_rate", `USD/JPYを取得できませんでした。source=${source} reason=レートが未取得です。`);
  }
  return {
    pair: "USDJPY",
    rate,
    date: payload?.date,
    source,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchUpstreamJson(url, source, symbol, headers) {
  let upstreamResponse;
  try {
    upstreamResponse = await fetch(url, { headers });
  } catch (error) {
    throw new HttpError(
      502,
      "market_upstream_network_error",
      `${symbol} の取得に失敗しました。取得元=${source} / 理由=${error instanceof Error ? error.message : "ネットワークエラー"}`,
    );
  }
  if (!upstreamResponse.ok) {
    throw new HttpError(
      502,
      "market_upstream_http_error",
      `${symbol} の取得に失敗しました。取得元=${source} / HTTP ${upstreamResponse.status} / 理由=${upstreamResponse.statusText}`,
    );
  }
  try {
    return await upstreamResponse.json();
  } catch {
    throw new HttpError(502, "market_upstream_json_error", `${symbol} の取得に失敗しました。取得元=${source} / 理由=JSONとして読めません。`);
  }
}

function parseMoney(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;
  const normalized = value.replace(/[$,\s]/g, "");
  return Number(normalized);
}

function normalizeAccount(raw) {
  return {
    accountKey: raw.AccountKey ?? raw.AccountId ?? raw.AccountNumber ?? "",
    accountId: raw.AccountId ?? raw.AccountNumber,
    displayName: raw.DisplayName ?? raw.Name ?? raw.AccountId ?? raw.AccountNumber,
    currency: raw.Currency ?? raw.AccountCurrency ?? raw.BaseCurrency,
    environment: getEnvironment(),
    isTrialAccount: Boolean(raw.IsTrialAccount),
    raw,
  };
}

function normalizeTicker(input) {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeAccountSnapshot(account, balance, margin) {
  const values = {
    cashBalance: firstNumber(balance, ["CashBalance", "Cash", "CashAvailableForTrading", "AccountBalance"]),
    buyingPower: firstNumber(balance, ["CashAvailableForTrading", "BuyingPower", "AvailableForTrading", "AvailableCash"]),
    accountValue: firstNumber(balance, ["AccountValue", "NetEquityForMargin", "TotalValue", "NetLiquidationValue"]),
    marginAvailable: firstNumber(margin, ["MarginAvailable", "AvailableMargin", "MarginCollateralAvailable"]) ??
      firstNumber(balance, ["MarginAvailable", "AvailableMargin", "MarginAvailableForTrading"]),
    marginUsagePercent: firstNumber(margin, ["MarginUtilizationPct", "MarginUtilization", "MarginUsedByCurrentPositionsPct"]) ??
      firstNumber(balance, ["MarginUtilizationPct", "MarginUtilization"]),
  };
  const missingFields = Object.entries(values)
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);
  return {
    accountKey: account.accountKey,
    accountId: account.accountId,
    displayName: account.displayName,
    currency: account.currency ?? "JPY",
    environment: account.environment,
    isTrialAccount: Boolean(account.raw?.IsTrialAccount),
    values,
    missingFields,
    fetchedAt: new Date().toISOString(),
    raw: { account: account.raw, balance, margin },
  };
}

function normalizePosition(raw, accountsByKey, fetchedAt, index) {
  const accountKey = firstString(raw, ["AccountKey", "AccountId", "AccountNumber"]) ?? "";
  const account = accountsByKey.get(accountKey);
  const assetType = firstString(raw, ["AssetType", "InstrumentType", "ProductType"]);
  const quantity = firstNumber(raw, ["Amount", "Quantity", "NetPosition", "PositionAmount", "HoldingAmount"]);
  const symbol = inferSymbol(raw);
  const optionType = inferOptionType(raw);
  const kind = inferPositionKind(assetType, optionType);
  const currentPrice = firstNumber(raw, ["CurrentPrice", "MarketPrice", "Price", "LastTraded", "LastPrice"]);
  const premiumOpenPrice = firstNumber(raw, ["OpenPrice", "AverageOpenPrice", "PriceOpen", "TradePrice"]);
  const currentOptionPrice = kind === "option" ? currentPrice : undefined;
  const currentStockPrice = kind === "stock" ? currentPrice : undefined;
  const averageOpenPrice = kind === "stock" ? premiumOpenPrice : undefined;
  const strike = firstNumber(raw, ["Strike", "StrikePrice", "ExercisePrice"]);
  const expiry = normalizeSaxoDate(firstString(raw, ["ExpiryDate", "Expiry", "ExpirationDate", "MaturityDate"]));
  const contractSize = firstNumber(raw, ["ContractSize", "LotSize", "Multiplier"]);
  const marketValue = firstNumber(raw, ["MarketValue", "Value", "MarketValueInBaseCurrency"]);
  const unrealizedPnl = firstNumber(raw, ["ProfitLossOnTrade", "UnrealizedProfitLoss", "ProfitLoss", "Pnl", "P/L"]);
  const currency = firstString(raw, ["Currency", "TradeCurrency", "InstrumentCurrency", "DisplayCurrency"]);
  const positionId = firstString(raw, ["PositionId", "PositionID", "Id", "PositionKey"]);
  const instrumentCode = firstString(raw, ["InstrumentCode", "Identifier", "Symbol", "Description"]);
  const uic = firstNumber(raw, ["Uic", "UIC"]);
  const missingFields = [];
  for (const [field, value] of Object.entries({
    accountKey,
    symbol,
    assetType,
    quantity,
    currentPrice,
    currency,
  })) {
    if (value === undefined || value === "") missingFields.push(field);
  }
  if (kind === "option") {
    for (const [field, value] of Object.entries({ optionType, strike, expiry, contractSize })) {
      if (value === undefined || value === "" || value === "unknown") missingFields.push(field);
    }
  }
  return {
    id: positionId ?? `${accountKey || "unknown"}-${index}`,
    positionId,
    accountKey,
    accountId: account?.accountId,
    displayName: account?.displayName,
    accountAssignment: "unassigned",
    symbol,
    underlyingName: firstString(raw, ["Description", "UnderlyingAssetDescription", "InstrumentName"]),
    assetType,
    kind,
    quantity,
    side: quantity === undefined ? "unknown" : quantity < 0 ? "short" : quantity > 0 ? "long" : "unknown",
    currentPrice,
    unrealizedPnl,
    unrealizedPnlCurrency: currency,
    marketValue,
    marketValueCurrency: currency,
    currency,
    optionType,
    strike,
    expiry,
    contractSize,
    premiumOpenPrice: kind === "option" ? premiumOpenPrice : undefined,
    currentOptionPrice,
    instrumentCode,
    uic,
    shareQuantity: kind === "stock" ? quantity : undefined,
    averageOpenPrice,
    currentStockPrice,
    missingFields,
    fetchedAt,
    raw,
  };
}

function normalizeOrder(raw, accountsByKey, fetchedAt, index) {
  const accountKey = firstString(raw, ["AccountKey", "AccountId", "AccountNumber"]) ?? "";
  const account = accountsByKey.get(accountKey);
  const orderId = firstString(raw, ["OrderId", "OrderID", "Id"]) ?? `${accountKey || "unknown"}-order-${index}`;
  const assetType = firstString(raw, ["AssetType", "InstrumentType", "ProductType"]);
  const quantity = firstNumber(raw, ["Amount", "Quantity", "OrderAmount"]);
  const price = firstNumber(raw, ["OrderPrice", "Price", "StopLimitPrice", "LimitPrice"]);
  const stopPrice = firstNumber(raw, ["StopPrice", "TriggerPrice"]);
  const orderType = firstString(raw, ["OrderType", "OrderTypeName", "Type"]);
  const duration = firstString(raw, ["DurationType", "Duration", "TimeInForce"]);
  const status = firstString(raw, ["Status", "OrderStatus"]);
  const symbol = inferSymbol(raw);
  const optionType = inferOptionType(raw);
  const relation = firstString(raw, ["OrderRelation", "Relation", "RelatedOrderType", "MultiLegOrderId"]);
  const missingFields = [];
  for (const [field, value] of Object.entries({ accountKey, symbol, assetType, quantity, orderType, status })) {
    if (value === undefined || value === "") missingFields.push(field);
  }
  return {
    id: orderId,
    orderId,
    accountKey,
    accountId: account?.accountId,
    displayName: account?.displayName,
    accountAssignment: "unassigned",
    symbol,
    assetType,
    quantity,
    side: inferBuySell(raw),
    orderType,
    orderRelation: relation,
    status,
    price,
    stopPrice,
    duration,
    currency: firstString(raw, ["Currency", "TradeCurrency", "InstrumentCurrency"]),
    optionType,
    strike: firstNumber(raw, ["Strike", "StrikePrice", "ExercisePrice"]),
    expiry: normalizeSaxoDate(firstString(raw, ["ExpiryDate", "Expiry", "ExpirationDate", "MaturityDate"])),
    isExitCandidate: inferExitOrderCandidate(raw),
    missingFields,
    fetchedAt,
    raw,
  };
}

function normalizeHistoryItem(raw, kind, index) {
  const accountKey = firstString(raw, ["AccountKey", "AccountId", "AccountNumber"]);
  const sourceId = firstString(raw, ["ClosedPositionId", "TradeId", "PositionId", "OrderId", "Id"]);
  const profitLoss = firstNumber(raw, ["ClosedProfitLoss", "ProfitLossOnTrade", "RealizedPnl", "ProfitLoss"]);
  const profitLossBase = firstNumber(raw, ["ClosedProfitLossInBaseCurrency", "ProfitLossOnTradeInBaseCurrency", "BookedAmountUSD", "BookedAmountAccountCurrency", "BookedAmount", "Amount"]);
  const optionTypeRaw = firstString(raw, ["PutCall", "CallPut", "OptionType", "OptionRootType"]);
  const instrumentForOption = firstString(raw, ["Symbol", "DisplayAndFormat.Symbol", "InstrumentSymbol", "InstrumentCode", "Description", "InstrumentDescription"]);
  const inferredContract = parseSaxoOptionContract(instrumentForOption);
  const optionType = inferOptionTypeFromValue(optionTypeRaw) ?? inferOptionTypeFromInstrument(instrumentForOption);
  const bookedAmountAliases = ["BookedAmountAccountCurrency", "BookedAmountUSD", "BookedAmountClientCurrency", "BookedAmount", "NetAmount", "SettlementAmount", "Amount"];
  const premiumAmountAliases = ["Premium", "PremiumAmount", "GrossAmount", "TradeAmount"];
  const transactionCostAliases = ["TransactionCost", "Costs", "Cost", "Commission", "Commissions", "SpreadCostAccountCurrency", "SpreadCostUSD", "SpreadCostClientCurrency"];
  const exchangeRateAliases = ["ExchangeRate", "FxRate", "ConversionRate"];
  const bookedAmountMatch = firstNumberMatch(raw, bookedAmountAliases);
  const premiumAmountMatch = firstNumberMatch(raw, premiumAmountAliases);
  const explicitTransactionCostMatch = firstNumberMatch(raw, transactionCostAliases);
  const transactionCostMatch =
    explicitTransactionCostMatch && Math.abs(explicitTransactionCostMatch.value) > 0.0001
      ? explicitTransactionCostMatch
      : inferTransactionCostFromTradeValue(raw);
  const exchangeRateMatch = firstNumberMatch(raw, exchangeRateAliases);
  return {
    id: `${kind}-${index}`,
    kind,
    sourceIdMasked: sourceId ? maskSecret(sourceId) : undefined,
    accountKey: accountKey ? maskSecret(accountKey) : undefined,
    symbol: inferSymbol(raw),
    assetType: firstString(raw, ["AssetType", "InstrumentType", "ProductType"]),
    optionType,
    strike: firstNumber(raw, ["Strike", "StrikePrice", "ExercisePrice"]) ?? inferredContract?.strike,
    expiry: normalizeSaxoDate(firstString(raw, ["ExpiryDate", "Expiry", "ExpirationDate", "MaturityDate"])) ?? inferredContract?.expiry,
    instrumentCode: firstString(raw, ["InstrumentCode", "Symbol", "DisplayAndFormat.Symbol", "InstrumentSymbol"]),
    uic: firstNumber(raw, ["Uic", "UIC"]),
    quantity: firstNumber(raw, ["Amount", "Quantity"]),
    buySell: inferBuySell(raw),
    openClose: inferOpenClose(raw),
    price: firstNumber(raw, ["Price", "OpenPrice", "ClosePrice", "TradePrice"]),
    tradeDate: normalizeSaxoDate(firstString(raw, ["TradeDate", "ExecutionTime", "ActivityTime", "ValueDate", "Date"])),
    currency: firstString(raw, ["Currency", "TradeCurrency", "InstrumentCurrency"]),
    profitLoss,
    profitLossBase,
    bookedAmount: bookedAmountMatch?.value,
    premiumAmount: premiumAmountMatch?.value,
    transactionCost: transactionCostMatch?.value,
    feeAmount: firstNumber(raw, ["Fee", "Fees", "Commission", "Commissions"]),
    exchangeFee: firstNumber(raw, ["ExchangeFee", "CurrencyConversionFee", "FxConversionCost", "ExchangeCommission"]),
    exchangeRate: exchangeRateMatch?.value,
    taxIncludedFee: firstNumber(raw, ["TaxIncludedFee", "CommissionTax", "FeeTax", "ConsumptionTax"]),
    rawFieldNames: collectRawFieldNames(raw).slice(0, 120),
    fieldDiagnostics: [
      createFieldDiagnostic("記帳額", bookedAmountAliases, bookedAmountMatch),
      createFieldDiagnostic("プレミアム", premiumAmountAliases, premiumAmountMatch),
      createFieldDiagnostic("取引費用", transactionCostAliases, transactionCostMatch),
      createFieldDiagnostic("為替", exchangeRateAliases, exchangeRateMatch),
    ],
    sourceStatus: "draft_candidate",
    missingFields: [],
  };
}

function inferTransactionCostFromTradeValue(raw) {
  const tradedValue = firstNumber(raw, ["TradedValue"]);
  const accountCurrency = firstString(raw, ["AccountCurrency"]);
  const clientCurrency = firstString(raw, ["ClientCurrency"]);
  if (accountCurrency === "JPY" || clientCurrency === "JPY") return undefined;
  const bookedAmount =
    firstNumber(raw, ["BookedAmountUSD"]) ??
    (accountCurrency === "USD" ? firstNumber(raw, ["BookedAmountAccountCurrency"]) : undefined);
  if (!Number.isFinite(tradedValue) || !Number.isFinite(bookedAmount)) return undefined;
  if (Math.abs(bookedAmount) <= 0.0001) return undefined;
  const inferredCost = Math.abs(Math.abs(tradedValue) - Math.abs(bookedAmount));
  if (!Number.isFinite(inferredCost) || inferredCost <= 0.0001) return undefined;
  return { value: inferredCost, matchedName: "abs(TradedValue) - abs(BookedAmountUSD)" };
}

function inferOptionTypeFromValue(value) {
  if (!value) return undefined;
  const normalized = String(value).toLowerCase();
  if (normalized.includes("put") || normalized === "p") return "put";
  if (normalized.includes("call") || normalized === "c") return "call";
  return undefined;
}

function inferOptionTypeFromInstrument(value) {
  const contract = parseSaxoOptionContract(value);
  if (contract?.optionType) return contract.optionType;
  if (!value) return undefined;
  const normalized = String(value).toUpperCase();
  if (/(^|[^A-Z])P\d/.test(normalized) || /\dP($|[^A-Z0-9])/.test(normalized)) return "put";
  if (/(^|[^A-Z])C\d/.test(normalized) || /\dC($|[^A-Z0-9])/.test(normalized)) return "call";
  return undefined;
}

function parseSaxoOptionContract(value) {
  if (!value) return undefined;
  const normalized = String(value).trim().toUpperCase();
  const match = normalized.match(/(?:^|[/:\s_-])(\d{1,2})([FGHJKMNQUVXZ])(\d{2})([CP])(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const [, dayRaw, monthCode, yearRaw, optionCode, strikeRaw] = match;
  const strike = Number(strikeRaw);
  if (!Number.isFinite(strike)) return undefined;
  const month = SAXO_OPTION_MONTH_CODES[monthCode];
  const day = Number(dayRaw);
  const expiry = month && Number.isFinite(day) && day >= 1 && day <= 31
    ? `20${yearRaw.padStart(2, "0")}-${month}-${String(day).padStart(2, "0")}`
    : undefined;
  return {
    optionType: optionCode === "P" ? "put" : "call",
    strike,
    expiry,
  };
}

const SAXO_OPTION_MONTH_CODES = {
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

function normalizeDiscoveryResult(endpoint, label, result) {
  if (result.status === "fulfilled") {
    return {
      endpoint,
      label,
      classification: "取得可能",
      itemCount: result.value.items?.length ?? 0,
      message: `${endpoint} から候補を取得しました。正式保存はしていません。`,
      items: result.value.items ?? [],
    };
  }
  const reason = result.reason;
  return {
    endpoint,
    label,
    classification: classifySaxoFailure(reason),
    itemCount: 0,
    message: reason instanceof Error ? reason.message : "取得できませんでした。",
  };
}

function classifySaxoFailure(error) {
  const message = error instanceof Error ? error.message : "";
  if (/not_connected|未接続/.test(message)) return "未接続";
  if (error instanceof HttpError) {
    if (error.status === 401) return "権限不足または再接続必要";
    if (error.status === 403) return "権限不足";
    if (error.status === 404) return "未対応";
    if (error.status === 422) return "未取得項目あり";
  }
  if (/403|permission|権限/i.test(message)) return "権限不足";
  if (/404|not found/i.test(message)) return "未対応";
  return "取得失敗";
}

function inferBuySell(raw) {
  const value = String(firstString(raw, ["BuySell", "BuyOrSell", "Side", "OrderSide"]) ?? "").toLowerCase();
  if (value.includes("buy")) return "buy";
  if (value.includes("sell")) return "sell";
  const amount = firstNumber(raw, ["Amount", "Quantity", "OrderAmount"]);
  if (amount !== undefined) return amount < 0 ? "sell" : "buy";
  return "unknown";
}

function inferOpenClose(raw) {
  const value = String(
    firstString(raw, [
      "OpenClose",
      "OpenOrClose",
      "NewOrClose",
      "TradeOpenClose",
      "PositionEffect",
      "PositionStatus",
      "TradeType",
      "EventType",
      "ActivityType",
      "TransactionType",
      "Status",
    ]) ?? "",
  ).toLowerCase();
  if (/close|closing|closed|settle|settlement|liquidat|offset|決済|返済/.test(value)) return "close";
  if (/open|opening|opened|new|entry|建玉|新規/.test(value)) return "open";
  return "unknown";
}

function inferExitOrderCandidate(raw) {
  const text = JSON.stringify(raw ?? {}).toLowerCase();
  return /related|oco|ifd|stop|limit|closing|close|positionid|multi/.test(text);
}

function inferPositionKind(assetType, optionType) {
  const normalized = String(assetType ?? "").toLowerCase();
  if (normalized.includes("option") || optionType === "call" || optionType === "put") return "option";
  if (normalized.includes("stock") || normalized.includes("equity") || normalized.includes("share")) return "stock";
  return "other";
}

function inferOptionType(source) {
  const rawValue = firstString(source, ["PutCall", "PutCallType", "OptionType", "OptionRoot"]);
  const value = String(rawValue ?? "").toLowerCase();
  if (value.includes("put")) return "put";
  if (value.includes("call")) return "call";
  const text = JSON.stringify(source ?? {}).toLowerCase();
  if (/\bput\b|[_\s-]p(?:\s|$)/i.test(text)) return "put";
  if (/\bcall\b|[_\s-]c(?:\s|$)/i.test(text)) return "call";
  return "unknown";
}

function inferSymbol(source) {
  const direct = firstString(source, ["Symbol", "InstrumentSymbol", "Ticker", "UnderlyingSymbol"]);
  if (direct) return normalizePositionSymbol(direct);
  const text = firstString(source, ["Description", "InstrumentCode", "Identifier"]);
  if (!text) return undefined;
  const match = text.match(/^([A-Z0-9.]+)\b/i);
  return match ? normalizePositionSymbol(match[1]) : undefined;
}

function normalizePositionSymbol(value) {
  return String(value).trim().toUpperCase().replace(/\s+.*$/, "");
}

function normalizeSaxoDate(value) {
  if (!value) return undefined;
  const text = String(value);
  const match = text.match(/\d{4}[-/]\d{2}[-/]\d{2}/);
  return match ? match[0].replace(/\//g, "-") : text;
}

function firstNumber(source, names) {
  if (!source || typeof source !== "object") return undefined;
  for (const name of names) {
    const value = source[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  for (const value of Object.values(source)) {
    if (value && typeof value === "object") {
      const nested = firstNumber(value, names);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function firstNumberMatch(source, names, prefix = "") {
  if (!source || typeof source !== "object") return undefined;
  for (const name of names) {
    const value = source[name];
    const path = prefix ? `${prefix}.${name}` : name;
    if (typeof value === "number" && Number.isFinite(value)) return { value, matchedName: path };
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value.replace(/,/g, ""));
      if (Number.isFinite(parsed)) return { value: parsed, matchedName: path };
    }
  }
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object") {
      const nested = firstNumberMatch(value, names, prefix ? `${prefix}.${key}` : key);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function collectRawFieldNames(source, prefix = "", output = []) {
  if (!source || typeof source !== "object") return output;
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    output.push(path);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      collectRawFieldNames(value, path, output);
    }
  }
  return Array.from(new Set(output)).sort();
}

function createFieldDiagnostic(target, searched, match) {
  return {
    target,
    searched,
    matched: match?.matchedName,
    reason: match ? "候補項目名に一致しました。" : "候補項目名に一致する数値項目がありませんでした。",
  };
}

function firstString(source, names) {
  if (!source || typeof source !== "object") return undefined;
  for (const name of names) {
    const value = source[name];
    if (typeof value === "string" && value.trim() !== "") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  for (const value of Object.values(source)) {
    if (value && typeof value === "object") {
      const nested = firstString(value, names);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function getEnvironment() {
  return process.env.SAXO_ENVIRONMENT === "live" ? "live" : "sim";
}

function getClientKey(client) {
  return client.ClientKey ?? client.ClientId ?? client.ClientKeyId;
}

function isEnvironmentConfigured() {
  return process.env.SAXO_ENVIRONMENT === "sim" || process.env.SAXO_ENVIRONMENT === "live";
}

function getAuthBaseUrl() {
  return stripTrailingSlash(
    process.env.SAXO_AUTH_BASE_URL ?? (getEnvironment() === "live" ? "https://live.logonvalidation.net" : "https://sim.logonvalidation.net"),
  );
}

function getOpenApiBaseUrl() {
  return ensureTrailingSlash(
    process.env.SAXO_OPENAPI_BASE_URL ??
      (getEnvironment() === "live" ? "https://gateway.saxobank.com/openapi/" : "https://gateway.saxobank.com/sim/openapi/"),
  );
}

function getClientId() {
  return process.env.SAXO_CLIENT_ID ?? process.env.SAXO_APP_KEY ?? "";
}

function getRedirectUri() {
  return process.env.SAXO_REDIRECT_URI ?? EXPECTED_REDIRECT_URI;
}

function getConfigStatus(message) {
  const clientId = getClientId();
  return {
    mode: "saxo_readonly",
    readOnly: true,
    bindAddress: HOST,
    clientIdConfigured: Boolean(clientId),
    clientIdMasked: maskSecret(clientId),
    environment: getEnvironment(),
    environmentConfigured: isEnvironmentConfigured(),
    redirectUri: getRedirectUri(),
    expectedRedirectUri: EXPECTED_REDIRECT_URI,
    localUiAllowedOrigin: LOCAL_UI_ALLOWED_ORIGIN,
    localUiReturnUrl: LOCAL_UI_RETURN_URL,
    localConfigFile: ".env.local",
    localConfigFileExists: fs.existsSync(getLocalEnvPath()),
    configurationWarnings: getConfigurationWarnings(),
    message,
  };
}

function getStatus(message) {
  const connectionState = getConnectionState();
  return {
    mode: "saxo_readonly",
    connected: connectionState === "connected",
    connectionState,
    environment: getEnvironment(),
    environmentConfigured: isEnvironmentConfigured(),
    environmentRaw: process.env.SAXO_ENVIRONMENT,
    hasToken: Boolean(tokenState?.accessToken),
    tokenExpiresAt: tokenState?.expiresAt ? new Date(tokenState.expiresAt).toISOString() : undefined,
    refreshTokenExpiresAt: tokenState?.refreshExpiresAt ? new Date(tokenState.refreshExpiresAt).toISOString() : undefined,
    connectionExpiresAt: tokenState?.refreshExpiresAt
      ? new Date(tokenState.refreshExpiresAt).toISOString()
      : tokenState?.expiresAt
        ? new Date(tokenState.expiresAt).toISOString()
        : undefined,
    lastSyncedAt,
    readOnly: true,
    orderEndpointsEnabled: false,
    bindAddress: HOST,
    oauthConfigured: Boolean(getClientId()),
    clientIdConfigured: Boolean(getClientId()),
    redirectUri: getRedirectUri(),
    expectedRedirectUri: EXPECTED_REDIRECT_URI,
    connectionError: connectionState === "reconnect_required" ? lastConnectionError ?? "Saxo接続の期限が切れました。再接続してください。" : undefined,
    configurationWarnings: getConfigurationWarnings(),
    tokenPersistence: getTokenPersistenceStatus(),
    message,
  };
}

function getConnectionState() {
  if (lastConnectionError) return "reconnect_required";
  if (!tokenState?.accessToken) return "disconnected";
  if (tokenState.refreshExpiresAt && Date.now() >= tokenState.refreshExpiresAt) {
    lastConnectionError = "Saxo接続の期限が切れました。再接続してください。";
    return "reconnect_required";
  }
  if (tokenState.expiresAt && Date.now() >= tokenState.expiresAt && !tokenState.refreshToken) {
    lastConnectionError = "Saxo接続の期限が切れました。再接続してください。";
    return "reconnect_required";
  }
  return "connected";
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 16_384) {
      throw new HttpError(413, "request_too_large", "設定リクエストが大きすぎます。");
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "JSONとして読めません。");
  }
}

function saveLocalSaxoConfig({ clientId, environment }) {
  const envPath = getLocalEnvPath();
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const next = upsertEnvValues(current, {
    SAXO_CLIENT_ID: clientId,
    SAXO_ENVIRONMENT: environment,
  });
  fs.writeFileSync(envPath, next, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
}

function upsertEnvValues(text, values) {
  const seen = new Set();
  const lines = text.split(/\r?\n/).filter((line, index, array) => !(line === "" && index === array.length - 1));
  const updated = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !(match[1] in values)) return line;
    const key = match[1];
    seen.add(key);
    return `${key}=${quoteEnvValue(values[key])}`;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) updated.push(`${key}=${quoteEnvValue(value)}`);
  }
  return `${updated.join("\n")}\n`;
}

function quoteEnvValue(value) {
  return JSON.stringify(String(value));
}

function maskSecret(value) {
  if (!value) return undefined;
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function getConfigurationWarnings() {
  const warnings = [];
  if (!getClientId()) {
    warnings.push({
      code: "missing_client_id",
      message: "SAXO_CLIENT_ID が未設定です。実Saxo接続にはClient IDを環境変数または.gitignore済みの.env.localへ設定してください。",
    });
  }
  if (!isEnvironmentConfigured()) {
    warnings.push({
      code: "missing_environment",
      message: "SAXO_ENVIRONMENT が未設定です。現在はsim扱いですが、実検証では SAXO_ENVIRONMENT=sim または live を明示してください。",
    });
  }
  if (getRedirectUri() !== EXPECTED_REDIRECT_URI) {
    warnings.push({
      code: "custom_redirect_uri",
      message: `redirect URI が既定値と異なります。Saxoアプリ設定と一致しているか確認してください。既定値: ${EXPECTED_REDIRECT_URI}`,
    });
  }
  return warnings;
}

function normalizeToken(token, codeVerifier) {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: token.token_type,
    expiresAt: token.expires_in ? Date.now() + Number(token.expires_in) * 1000 : undefined,
    refreshExpiresAt: token.refresh_token_expires_in ? Date.now() + Number(token.refresh_token_expires_in) * 1000 : undefined,
    codeVerifier,
  };
}

function getTokenPersistenceStatus() {
  return {
    ...tokenPersistenceStatus,
    enabled: Boolean(tokenState?.persisted) || tokenPersistenceStatus.enabled,
  };
}

async function enableTokenPersistence() {
  if (!tokenPersistenceStatus.supported) {
    throw new HttpError(400, "keychain_unsupported", "macOS Keychainが使えない環境です。");
  }
  if (!tokenState?.refreshToken) {
    throw new HttpError(400, "not_connected", "Saxo接続後に接続保持を有効化してください。");
  }
  await saveTokenStateToKeychain("manual_enable");
  tokenState.persisted = true;
}

async function disableTokenPersistence() {
  await deleteTokenStateFromKeychain();
  if (tokenState) tokenState.persisted = false;
  tokenPersistenceStatus = {
    ...tokenPersistenceStatus,
    enabled: false,
    restored: false,
    status: tokenPersistenceStatus.supported ? "disabled" : "unsupported",
    message: tokenPersistenceStatus.supported
      ? "Keychainの接続維持情報を削除しました。現在のメモリ上接続はlogoutまで維持されます。"
      : "macOS以外ではKeychain接続保持は無効です。",
  };
}

async function restoreTokenStateFromKeychain() {
  if (!tokenPersistenceStatus.supported) return;
  const clientIdHash = getClientIdHash();
  const environment = getEnvironment();
  if (!clientIdHash || !isEnvironmentConfigured()) {
    tokenPersistenceStatus = {
      ...tokenPersistenceStatus,
      enabled: false,
      restored: false,
      status: "not_configured",
      message: "Client IDまたは環境が未設定のため、Keychain復元は行いません。",
    };
    return;
  }
  const payload = await readKeychainTokenPayload();
  if (!payload) {
    tokenPersistenceStatus = {
      ...tokenPersistenceStatus,
      enabled: false,
      restored: false,
      status: "not_saved",
      message: "このClient IDと環境のKeychain接続維持情報はありません。",
    };
    return;
  }
  if (payload.clientIdHash !== clientIdHash || payload.environment !== environment) {
    tokenPersistenceStatus = {
      ...tokenPersistenceStatus,
      enabled: false,
      restored: false,
      status: "mismatch",
      message: "Keychainの接続維持情報は現在のClient IDまたは環境と一致しません。",
    };
    return;
  }
  if (payload.refreshExpiresAt && Date.now() >= Number(payload.refreshExpiresAt)) {
    await deleteTokenStateFromKeychain();
    tokenPersistenceStatus = {
      ...tokenPersistenceStatus,
      enabled: false,
      restored: false,
      status: "expired",
      message: "KeychainのSaxo接続期限が切れました。Saxo公式画面で再ログインしてください。",
    };
    lastConnectionError = "Saxo接続の期限が切れました。再接続してください。";
    return;
  }

  tokenState = {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    tokenType: payload.tokenType,
    expiresAt: payload.expiresAt,
    refreshExpiresAt: payload.refreshExpiresAt,
    persisted: true,
  };

  try {
    if (!tokenState.accessToken || (tokenState.expiresAt && Date.now() >= tokenState.expiresAt - 60_000)) {
      await ensureAccessToken();
    }
    tokenPersistenceStatus = {
      ...tokenPersistenceStatus,
      enabled: true,
      restored: true,
      status: "restored",
      message: "macOS KeychainからSaxo接続を復元しました。パスワードは保存していません。",
      savedAt: payload.savedAt,
      restoredAt: new Date().toISOString(),
    };
    lastConnectionError = null;
  } catch {
    tokenState = null;
    await markKeychainTokenInvalid("KeychainのSaxo接続情報をrefreshできませんでした。Saxo公式画面で再ログインしてください。");
    lastConnectionError = "Saxo接続の期限が切れました。再接続してください。";
  }
}

async function saveTokenStateToKeychain(reason) {
  if (!tokenPersistenceStatus.supported || !tokenState?.refreshToken) return;
  const payload = {
    version: 1,
    environment: getEnvironment(),
    clientIdHash: getClientIdHash(),
    accessToken: tokenState.accessToken,
    refreshToken: tokenState.refreshToken,
    tokenType: tokenState.tokenType,
    expiresAt: tokenState.expiresAt,
    refreshExpiresAt: tokenState.refreshExpiresAt,
    savedAt: new Date().toISOString(),
  };
  await writeKeychainPassword(JSON.stringify(payload));
  tokenPersistenceStatus = {
    ...tokenPersistenceStatus,
    enabled: true,
    restored: Boolean(tokenPersistenceStatus.restored),
    status: reason === "refresh" ? "refreshed" : "saved",
    message:
      reason === "refresh"
        ? "KeychainのSaxo接続情報を更新しました。"
        : "このMacのKeychainにSaxo接続維持情報を保存しました。Saxo ID、パスワード、2FAコードは保存していません。",
    savedAt: payload.savedAt,
  };
}

async function markKeychainTokenInvalid(message) {
  if (!tokenPersistenceStatus.supported) return;
  await deleteTokenStateFromKeychain();
  tokenPersistenceStatus = {
    ...tokenPersistenceStatus,
    enabled: false,
    restored: false,
    status: "invalid",
    message,
  };
}

async function readKeychainTokenPayload() {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      getKeychainAccountName(),
      "-w",
    ]);
    const text = stdout.trim();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeKeychainPassword(payload) {
  await execFileAsync("security", [
    "add-generic-password",
    "-U",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    getKeychainAccountName(),
    "-w",
    payload,
  ]);
}

async function deleteTokenStateFromKeychain() {
  if (!tokenPersistenceStatus.supported) return;
  try {
    await execFileAsync("security", [
      "delete-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      getKeychainAccountName(),
    ]);
  } catch {
    // Missing Keychain items are fine; logout and disable should be idempotent.
  }
}

function getKeychainAccountName() {
  return `${getEnvironment()}:${getClientIdHash() || "unconfigured"}`;
}

function getClientIdHash() {
  const clientId = getClientId();
  if (!clientId) return "";
  return crypto.createHash("sha256").update(`${getEnvironment()}:${clientId}`).digest("hex").slice(0, 16);
}

function isForbiddenOrderPath(path, method = "GET") {
  if (/\/trade\/v\d+\/orders?/i.test(path)) return true;
  if (/\/api\/saxo\/positions?\/.*\/orders?/i.test(path)) return true;
  if (/\/api\/saxo\/orders?/i.test(path) && method !== "GET") return true;
  return false;
}

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (origin && isAllowedCorsOrigin(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "origin");
    response.setHeader("access-control-allow-private-network", "true");
  }
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-max-age", "600");
}

function isAllowedCorsOrigin(origin) {
  return (
    origin === LOCAL_UI_ALLOWED_ORIGIN ||
    origin === `http://${HOST}:5173` ||
    origin === "http://localhost:5173" ||
    origin === PUBLIC_GITHUB_PAGES_ORIGIN
  );
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, status, message) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>Saxo API Read-only</title><body><main style="font-family:sans-serif;line-height:1.7;margin:32px"><h1>Saxo API Read-only版</h1><p>${message}</p><p>このローカルAPIには発注機能はありません。</p></main></body></html>`);
}

function sendAuthSuccessHtml(response, returnUrl) {
  const appUrl = buildReturnUrlWithConnectedFlag(returnUrl);
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="3; url=${escapeHtml(appUrl)}">
    <title>Saxo API Read-only接続完了</title>
    <style>
      body { margin: 0; background: #f8fafc; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { max-width: 720px; margin: 48px auto; padding: 32px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 10px 30px rgba(15, 23, 42, .08); line-height: 1.75; }
      h1 { margin: 0 0 16px; font-size: 28px; }
      p { margin: 10px 0; }
      .notice { margin-top: 18px; padding: 12px 14px; border-radius: 8px; background: #ecfeff; border: 1px solid #a5f3fc; color: #155e75; }
      .actions { margin-top: 24px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
      a.button { display: inline-block; padding: 10px 18px; border-radius: 8px; background: #0f172a; color: #fff; font-weight: 700; text-decoration: none; }
      .sub { color: #475569; font-size: 14px; }
      code { background: #f1f5f9; border-radius: 4px; padding: 1px 4px; }
    </style>
    <script>
      window.setTimeout(function () {
        window.location.replace(${JSON.stringify(appUrl)});
      }, 3000);
    </script>
  </head>
  <body>
    <main>
      <h1>Saxo API Read-only接続が完了しました</h1>
      <p>認証は完了しました。アプリ画面に戻って、接続状態を更新してください。</p>
      <p>この接続はRead-onlyです。発注、注文変更、注文取消はできません。</p>
      <div class="notice">3秒後にアプリ画面へ戻ります。自動で戻らない場合は、下のボタンを押してください。</div>
      <div class="actions">
        <a class="button" href="${escapeHtml(appUrl)}">アプリに戻る</a>
        <span class="sub">このタブは閉じてもかまいません。</span>
      </div>
      <p class="sub">アプリ側で接続状態が変わらない場合は、Saxo APIパネルの「接続状態を再確認」または「まとめて取得」を押してください。</p>
      <p class="sub">このローカルAPIには発注機能はありません。</p>
    </main>
  </body>
</html>`);
}

function resolveAuthReturnUrl(request, requestUrl) {
  const candidates = [requestUrl.searchParams.get("returnUrl"), request.headers.referer, request.headers.origin];
  for (const candidate of candidates) {
    const returnUrl = normalizeReturnUrl(candidate);
    if (returnUrl) return returnUrl;
  }
  return LOCAL_UI_RETURN_URL;
}

function normalizeReturnUrl(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (!isAllowedReturnUrl(url)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function isAllowedReturnUrl(url) {
  if (url.origin === LOCAL_UI_ALLOWED_ORIGIN) return true;
  if (url.origin === `http://${HOST}:5173`) return true;
  if (url.origin === "http://localhost:5173") return true;
  return url.origin === PUBLIC_GITHUB_PAGES_ORIGIN && url.pathname.startsWith("/us-options-risk-planner");
}

function buildReturnUrlWithConnectedFlag(returnUrl = LOCAL_UI_RETURN_URL) {
  const url = new URL(returnUrl);
  url.searchParams.set("saxoConnected", "1");
  return url.toString();
}

function randomUrlSafe(size) {
  return base64Url(crypto.randomBytes(size));
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function formatDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultHistoryFromDate() {
  const date = new Date();
  date.setDate(date.getDate() - 90);
  return formatDateOnly(date);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] ?? char);
}

function loadLocalEnvFile() {
  const envPath = getLocalEnvPath();
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

function getLocalEnvPath() {
  return new URL("../.env.local", import.meta.url);
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
