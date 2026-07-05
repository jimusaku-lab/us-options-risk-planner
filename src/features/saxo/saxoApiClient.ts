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

export const isSaxoLocalApiAvailable = false;
const PUBLIC_SAXO_DISABLED_MESSAGE =
  "公開版ではSaxo自動接続を無効化しています。証券会社画面で確認した価格・履歴・残高を手入力またはCSV/JSON取込で反映してください。";

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
  return rejectPublicSaxoApi();
}

export async function fetchSaxoConfigStatus(): Promise<SaxoConfigStatus> {
  return rejectPublicSaxoApi();
}

export async function saveSaxoLocalConfig(input: { clientId: string; environment: "sim" | "live" }): Promise<SaxoConfigStatus> {
  void input;
  return rejectPublicSaxoApi();
}

export async function logoutSaxo(): Promise<SaxoApiStatus> {
  return rejectPublicSaxoApi();
}

export async function enableSaxoPersistence(): Promise<SaxoApiStatus> {
  return rejectPublicSaxoApi();
}

export async function disableSaxoPersistence(): Promise<SaxoApiStatus> {
  return rejectPublicSaxoApi();
}

export async function fetchSaxoAccounts(): Promise<SaxoAccountsResponse> {
  return rejectPublicSaxoApi();
}

export async function fetchSaxoAccountsSnapshot(): Promise<SaxoAccountsSnapshotResponse> {
  return rejectPublicSaxoApi();
}

export async function fetchSaxoPositionsSnapshot(): Promise<SaxoPositionsSnapshotResponse> {
  return rejectPublicSaxoApi();
}

export async function fetchSaxoOrdersSnapshot(): Promise<SaxoOrdersSnapshotResponse> {
  return rejectPublicSaxoApi();
}

export async function fetchSaxoHistoryDiscovery(input?: { from?: string; to?: string }): Promise<SaxoHistoryDiscoveryResponse> {
  void input;
  return rejectPublicSaxoApi();
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
  void input;
  return rejectPublicSaxoApi(
    "公開版ではSaxo候補価格の自動取得を無効化しています。証券会社画面のBid/Ask/Lastを確認し、現在オプション価格へ手入力してください。",
  );
}

export function startSaxoAuth(): void {
  throw new Error(PUBLIC_SAXO_DISABLED_MESSAGE);
}

async function rejectPublicSaxoApi<T>(message = PUBLIC_SAXO_DISABLED_MESSAGE): Promise<T> {
  throw new Error(message);
}
