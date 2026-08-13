import { normalizeMoomooScreeningRunToCandidateImport, type MoomooScreeningRun } from "@/lib/candidates";
import type { CandidateImportResult } from "@/types/candidates";

const MOOMOO_SCREENING_API_BASE = import.meta.env.VITE_MOOMOO_SCREENING_API_BASE ?? "http://127.0.0.1:18788";
const FETCH_TIMEOUT_MS = 65_000;

export type MoomooScreeningStatusResponse = {
  schemaVersion?: string;
  source?: string;
  asOf?: string;
  readOnly?: boolean;
  status?: {
    state?: "ok" | "error" | string;
    opend?: {
      listening?: boolean;
      message?: string;
    };
    sdk?: {
      status?: "ok" | "missing" | string;
      message?: string | null;
    };
  };
  permissions?: {
    usStock?: "ok" | "permission_missing" | "unknown" | string;
    usOption?: "ok" | "permission_missing" | "unknown" | string;
  };
};

export type MoomooScreeningUniverseMode = "symbols" | "stock_screen";
export type MoomooStockScreenPreset =
  | "large_liquid_core"
  | "upside_reversal_watch"
  | "bullish_pullback"
  | "income_quality_watch";

export type MoomooScreeningRunInput = {
  universeMode?: MoomooScreeningUniverseMode;
  symbols?: string[];
  maxSymbols?: number;
  includeOptions: boolean;
  stockScreenPreset?: MoomooStockScreenPreset;
  maxScreenResults?: number;
  maxHistorySymbols?: number;
  maxOptionSymbols?: number;
};

export type MoomooScreeningImportPreview = {
  raw: MoomooScreeningRun & {
    schemaVersion?: string;
    readOnly?: boolean;
    run?: {
      status?: "ok" | "partial" | "error" | string;
      requestedSymbols?: string[];
      processedSymbols?: number;
      errorCount?: number;
      warningCount?: number;
    };
    permissions?: {
      usStock?: string;
      usOption?: string;
    };
    universe?: {
      mode?: MoomooScreeningUniverseMode | string;
      preset?: string;
      screenMatchedCount?: number;
      screenReturnedCount?: number;
      snapshotRequestedCount?: number;
      historyRequestedCount?: number;
      optionRequestedCount?: number;
      maxScreenResults?: number;
      maxHistorySymbols?: number;
      maxOptionSymbols?: number;
      quota?: {
        used?: number;
        remain?: number;
        status?: "ok" | "unavailable" | "error" | string;
      };
      warnings?: string[];
    };
    warnings?: string[];
  };
  importResult: CandidateImportResult;
};

export type MoomooOptionQuoteLookupInput = {
  underlying: string;
  market?: "US";
  expiry: string;
  strike: number;
  optionType: "call" | "put";
  positionSide: "long" | "short";
  desiredAction: "sell_to_close" | "buy_to_close";
  contractCode?: string;
  positionId?: string;
};

export type MoomooOptionDataProbeSummary = {
  schemaVersion: "us_options_moomoo_option_data_probe.v1";
  readOnly: boolean;
  asOf: string;
  status: "ok" | "permission_missing" | "opend_unavailable" | "sdk_missing" | "error" | string;
  permissions: {
    usStock?: "ok" | "permission_missing" | "unknown" | string;
    usOption?: "ok" | "permission_missing" | "unknown" | string;
  };
  checked: {
    symbols: string[];
    expirationDateApi: "ok" | "permission_missing" | "unavailable" | "error" | "not_checked" | string;
    optionScreenApi: "ok" | "permission_missing" | "unavailable" | "error" | "not_checked" | string;
    optionChainApi: "ok" | "permission_missing" | "unavailable" | "error" | "not_checked" | string;
    optionQuoteApi: "ok" | "permission_missing" | "unavailable" | "error" | "not_checked" | string;
  };
  counts: {
    expirations?: number;
    chainRows?: number;
    normalizedOptionCandidates?: number;
    candidatesWithBidAsk?: number;
    candidatesWithOiVolume?: number;
    candidatesWithIvGreeks?: number;
  };
  sampleFieldPresence: {
    bid: boolean;
    ask: boolean;
    last: boolean;
    volume: boolean;
    openInterest: boolean;
    impliedVolatility: boolean;
    delta: boolean;
    gamma: boolean;
    theta: boolean;
    vega: boolean;
  };
  warnings: string[];
};

export type MoomooOptionQuoteLookupResult = {
  source: "moomoo_opend" | string;
  purpose: "exit_price_reference" | string;
  readOnly?: boolean;
  fetchedAt: string;
  underlying: string;
  market: string;
  expiry: string;
  strike: number;
  optionType: "call" | "put" | string;
  positionSide: "long" | "short" | string;
  desiredAction: "sell_to_close" | "buy_to_close" | string;
  contractCode?: string | null;
  permissionStatus: "ok" | "permission_missing" | "no_quote" | "error" | string;
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  mid?: number | null;
  iv?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  rho?: number | null;
  openInterest?: number | null;
  volume?: number | null;
  recommendedReference?: {
    field: "bid" | "ask" | string;
    price: number;
    reason: string;
  } | null;
  warnings?: string[];
};

export class MoomooScreeningApiError extends Error {
  userMessage: string;

  constructor(message: string, options?: { cause?: unknown; userMessage?: string }) {
    super(message);
    this.name = "MoomooScreeningApiError";
    this.cause = options?.cause;
    this.userMessage = options?.userMessage ?? message;
  }
}

export async function fetchMoomooScreeningStatus(): Promise<MoomooScreeningStatusResponse> {
  return fetchJson<MoomooScreeningStatusResponse>("/api/moomoo/screening/status", { method: "GET" });
}

export async function runMoomooScreening(input: MoomooScreeningRunInput): Promise<MoomooScreeningImportPreview> {
  const raw = await fetchJson<MoomooScreeningImportPreview["raw"]>("/api/moomoo/screening/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return {
    raw,
    importResult: normalizeMoomooScreeningRunToCandidateImport(raw),
  };
}

export async function fetchLastMoomooScreeningResult(): Promise<MoomooScreeningImportPreview> {
  const raw = await fetchJson<MoomooScreeningImportPreview["raw"]>("/api/moomoo/screening/last-result", { method: "GET" });
  return {
    raw,
    importResult: normalizeMoomooScreeningRunToCandidateImport(raw),
  };
}

export async function lookupMoomooOptionQuote(input: MoomooOptionQuoteLookupInput): Promise<MoomooOptionQuoteLookupResult> {
  return fetchJson<MoomooOptionQuoteLookupResult>("/api/moomoo/option-quote/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ market: "US", ...input }),
  });
}

export async function probeMoomooOptionData(input: { symbols: string[]; maxSymbols?: number }): Promise<MoomooOptionDataProbeSummary> {
  return fetchJson<MoomooOptionDataProbeSummary>("/api/moomoo/option-data/probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

async function fetchJson<T>(path: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${MOOMOO_SCREENING_API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload.message === "string" ? payload.message : `moomoo screening API returned ${response.status}`;
      throw new MoomooScreeningApiError(message, { userMessage: message });
    }
    return payload as T;
  } catch (error) {
    if (error instanceof MoomooScreeningApiError) throw error;
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    throw new MoomooScreeningApiError(
      isAbort ? "moomoo screening API request timed out." : "moomoo screening API is not reachable.",
      {
        cause: error,
        userMessage: isAbort
          ? "moomooスクリーニングAPIの応答がタイムアウトしました。"
          : "moomooスクリーニングAPIが起動していません。ローカル版で `npm run dev:moomoo-screening-api` を起動してください。",
      },
    );
  } finally {
    window.clearTimeout(timer);
  }
}
