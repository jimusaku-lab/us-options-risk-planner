import type {
  SaxoApiAccount,
  SaxoApiAccountSnapshot,
  SaxoConfigStatus,
  SaxoApiStatus,
  SaxoApiPositionSnapshot,
  SaxoApiOrderSnapshot,
  SaxoHistoryDiscoveryEndpoint,
  SaxoOptionPremiumCandidate,
} from "@/features/saxo/saxoAccountSync";

const SAXO_LOCAL_API_BASE = import.meta.env.VITE_SAXO_LOCAL_API_BASE ?? "http://127.0.0.1:18787";
const PUBLIC_GITHUB_PAGES_ORIGIN = "https://jimusaku-lab.github.io";
const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
const PREMIUM_CANDIDATE_FETCH_TIMEOUT_MS = 20_000;

export type SaxoAccountsResponse = {
  environment: "sim" | "live";
  fetchedAt: string;
  accounts: SaxoApiAccount[];
};

export type SaxoAccountsSnapshotResponse = {
  environment: "sim" | "live";
  fetchedAt: string;
  accounts: SaxoApiAccountSnapshot[];
};

export type SaxoPositionsSnapshotResponse = {
  environment: "sim" | "live";
  fetchedAt: string;
  positions: SaxoApiPositionSnapshot[];
};

export type SaxoOrdersSnapshotResponse = {
  environment: "sim" | "live";
  fetchedAt: string;
  orders: SaxoApiOrderSnapshot[];
};

export type SaxoHistoryDiscoveryResponse = {
  environment: "sim" | "live";
  fetchedAt: string;
  fromDate: string;
  toDate: string;
  endpoints: SaxoHistoryDiscoveryEndpoint[];
};

export async function fetchSaxoStatus(): Promise<SaxoApiStatus> {
  return fetchJson("/api/saxo/status");
}

export async function fetchSaxoConfigStatus(): Promise<SaxoConfigStatus> {
  return fetchJson("/api/saxo/config/status");
}

export async function saveSaxoLocalConfig(input: { clientId: string; environment: "sim" | "live" }): Promise<SaxoConfigStatus> {
  return fetchJson("/api/saxo/config/local", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function logoutSaxo(): Promise<SaxoApiStatus> {
  return fetchJson("/api/saxo/logout", { method: "POST" });
}

export async function enableSaxoPersistence(): Promise<SaxoApiStatus> {
  return fetchJson("/api/saxo/persistence/enable", { method: "POST" });
}

export async function disableSaxoPersistence(): Promise<SaxoApiStatus> {
  return fetchJson("/api/saxo/persistence/disable", { method: "POST" });
}

export async function fetchSaxoAccounts(): Promise<SaxoAccountsResponse> {
  return fetchJson("/api/saxo/accounts");
}

export async function fetchSaxoAccountsSnapshot(): Promise<SaxoAccountsSnapshotResponse> {
  return fetchJson("/api/saxo/accounts/snapshot");
}

export async function fetchSaxoPositionsSnapshot(): Promise<SaxoPositionsSnapshotResponse> {
  return fetchJson("/api/saxo/positions/snapshot");
}

export async function fetchSaxoOrdersSnapshot(): Promise<SaxoOrdersSnapshotResponse> {
  return fetchJson("/api/saxo/orders/snapshot");
}

export async function fetchSaxoHistoryDiscovery(input?: { from?: string; to?: string }): Promise<SaxoHistoryDiscoveryResponse> {
  const params = new URLSearchParams();
  if (input?.from) params.set("from", input.from);
  if (input?.to) params.set("to", input.to);
  return fetchJson(`/api/saxo/history/discovery${params.size ? `?${params.toString()}` : ""}`);
}

export async function fetchSaxoOptionPremiumCandidate(input: {
  symbol: string;
  expiry: string;
  strike: number;
  optionType: "call" | "put";
  accountKey?: string;
  uic?: number;
  assetType?: string;
  positionId?: string;
  instrumentCode?: string;
}): Promise<SaxoOptionPremiumCandidate> {
  const params = new URLSearchParams({
    symbol: input.symbol,
    expiry: input.expiry,
    strike: String(input.strike),
    optionType: input.optionType,
  });
  if (input.accountKey) params.set("accountKey", input.accountKey);
  if (Number.isFinite(input.uic)) params.set("uic", String(input.uic));
  if (input.assetType) params.set("assetType", input.assetType);
  if (input.positionId) params.set("positionId", input.positionId);
  if (input.instrumentCode) params.set("instrumentCode", input.instrumentCode);
  return fetchJson(`/api/saxo/options/premium-candidate?${params.toString()}`, undefined, {
    timeoutMs: PREMIUM_CANDIDATE_FETCH_TIMEOUT_MS,
    timeoutMessage:
      "Saxo価格取得がタイムアウトしました。Saxo側の応答待ちまたはレート制限の可能性があります。少し時間を置いて再試行してください。",
  });
}

export function startSaxoAuth(): void {
  const params = new URLSearchParams({ returnUrl: window.location.href });
  window.location.assign(`${SAXO_LOCAL_API_BASE}/api/saxo/auth/start?${params.toString()}`);
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  options?: { timeoutMs?: number; timeoutMessage?: string },
): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), options?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
  try {
    response = await fetch(`${SAXO_LOCAL_API_BASE}${url}`, { ...init, signal: controller.signal });
  } catch (error) {
    throw new Error(createLocalApiFetchFailureMessage(error, options?.timeoutMessage));
  } finally {
    window.clearTimeout(timeoutId);
  }
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : `${url} の取得に失敗しました。`;
    throw new Error(message);
  }
  return payload as T;
}

function createLocalApiFetchFailureMessage(error: unknown, timeoutMessage?: string): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return timeoutMessage ?? "SaxoローカルAPIの応答がタイムアウトしました。少し時間を置いて再試行してください。";
  }
  if (typeof window !== "undefined" && window.location.origin === PUBLIC_GITHUB_PAGES_ORIGIN) {
    return "SaxoローカルAPIに到達できません。API未起動、公開版Origin許可不足、またはChromeのCORS/Private Network Accessブロックの可能性があります。公開版用の起動コマンドでローカルAPIを起動してください。";
  }
  return "SaxoローカルAPIが起動していません。別ターミナルで `npm run dev:saxo-api` または `npm run dev:all` を起動してください。";
}
