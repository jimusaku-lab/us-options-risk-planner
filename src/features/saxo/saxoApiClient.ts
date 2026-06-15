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
}): Promise<SaxoOptionPremiumCandidate> {
  const params = new URLSearchParams({
    symbol: input.symbol,
    expiry: input.expiry,
    strike: String(input.strike),
    optionType: input.optionType,
  });
  if (input.accountKey) params.set("accountKey", input.accountKey);
  return fetchJson(`/api/saxo/options/premium-candidate?${params.toString()}`);
}

export function startSaxoAuth(): void {
  window.location.assign(`${SAXO_LOCAL_API_BASE}/api/saxo/auth/start`);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);
  try {
    response = await fetch(`${SAXO_LOCAL_API_BASE}${url}`, { ...init, signal: controller.signal });
  } catch {
    throw new Error(
      "SaxoローカルAPIが起動していません。別ターミナルで `npm run dev:saxo-api` または `npm run dev:all` を起動してください。",
    );
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
