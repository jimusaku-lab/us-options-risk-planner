export type StockQuote = {
  symbol: string;
  price: number;
  date?: string;
  time?: string;
  source: "stooq" | "local_proxy";
};

export type FxQuote = {
  pair: "USDJPY";
  rate: number;
  date?: string;
  time?: string;
  source: "stooq" | "frankfurter" | "local_proxy";
};

const tickerAliases: Record<string, string> = {
  AMAZON: "AMZN",
  "AMAZON.COM": "AMZN",
  アマゾン: "AMZN",
  NVIDIA: "NVDA",
  "NVIDIA CORP": "NVDA",
  "NVIDIA CORPORATION": "NVDA",
  エヌビディア: "NVDA",
  NETFLIX: "NFLX",
  ネットフリックス: "NFLX",
  APPLE: "AAPL",
  アップル: "AAPL",
  TESLA: "TSLA",
  テスラ: "TSLA",
  MICROSOFT: "MSFT",
  マイクロソフト: "MSFT",
  META: "META",
  "META PLATFORMS": "META",
  FACEBOOK: "META",
  メタ: "META",
  GOOGLE: "GOOGL",
  ALPHABET: "GOOGL",
  アルファベット: "GOOGL",
};

const isGitHubPagesBuild = import.meta.env.BASE_URL === "/us-options-risk-planner/";

export const isExternalQuoteDisabled = import.meta.env.VITE_DISABLE_EXTERNAL_QUOTES === "true";
export const isExternalQuoteConsentRequired = isGitHubPagesBuild || import.meta.env.VITE_REQUIRE_EXTERNAL_QUOTE_CONSENT === "true";

export function normalizeTicker(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase().replace(/\s+/g, " ");
  return tickerAliases[upper] ?? tickerAliases[trimmed] ?? upper;
}

export async function fetchStooqQuote(symbol: string): Promise<StockQuote> {
  if (isExternalQuoteDisabled) {
    throw new Error("公開版では外部通信を避けるため、株価取得は無効です。Saxo等で確認した現在株価を手入力してください。");
  }
  const ticker = normalizeTicker(symbol);
  const url = isGitHubPagesBuild
    ? `https://stooq.com/q/l/?s=${encodeURIComponent(`${ticker.toLowerCase()}.us`)}&f=sd2t2ohlcv&h&e=json`
    : `/api/quote?symbol=${encodeURIComponent(ticker)}`;
  const payload = isGitHubPagesBuild ? await fetchPublicJson(url) : await fetchLocalJson(url, "株価");
  const quote = isGitHubPagesBuild ? parseStooqQuote(ticker, payload) : (payload as StockQuote & { error?: string });
  if (quote.error || !Number.isFinite(quote.price) || quote.price <= 0) {
    throw new Error("株価が取得できませんでした。ティッカーを確認してください。");
  }
  return quote;
}

export async function fetchUsdJpyRate(): Promise<FxQuote> {
  if (isExternalQuoteDisabled) {
    throw new Error("公開版では外部通信を避けるため、為替取得は無効です。確認したUSD/JPYを手入力してください。");
  }
  const url = isGitHubPagesBuild ? "https://api.frankfurter.app/latest?from=USD&to=JPY" : "/api/fx";
  const payload = isGitHubPagesBuild ? await fetchPublicJson(url) : await fetchLocalJson(url, "為替");
  const quote = isGitHubPagesBuild ? parseFrankfurterUsdJpy(payload) : (payload as FxQuote & { error?: string });
  if (quote.error || !Number.isFinite(quote.rate) || quote.rate <= 0) {
    throw new Error("USD/JPYを取得できませんでした。");
  }
  return {
    ...quote,
    pair: "USDJPY",
  };
}

async function fetchLocalJson(url: string, label: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${label}を取得できませんでした: HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchPublicJson(url: string): Promise<unknown> {
  try {
    return await fetchJson(url);
  } catch {
    // GitHub Pages has no same-origin API. Use a read-only CORS bridge as a fallback;
    // the bridged URL contains only the ticker or USD/JPY request, never position details.
    return fetchJson(`https://r.jina.ai/http://r.jina.ai/http://${url}`);
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`価格を取得できませんでした: HTTP ${response.status}`);
  }
  const text = await response.text();
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    throw new Error("価格データをJSONとして読めませんでした。");
  }
  return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
}

function parseStooqQuote(ticker: string, payload: unknown): StockQuote & { error?: string } {
  const symbols = (payload as { symbols?: Array<{ close?: number; date?: string; time?: string }> }).symbols;
  const row = symbols?.[0];
  return {
    symbol: ticker,
    price: Number(row?.close ?? 0),
    date: row?.date,
    time: row?.time,
    source: "stooq",
  };
}

function parseFrankfurterUsdJpy(payload: unknown): FxQuote & { error?: string } {
  const data = payload as { rates?: { JPY?: number }; date?: string };
  return {
    pair: "USDJPY",
    rate: Number(data.rates?.JPY ?? 0),
    date: data.date,
    source: "frankfurter",
  };
}
