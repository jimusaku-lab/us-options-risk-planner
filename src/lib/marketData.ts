export type StockQuote = {
  symbol: string;
  price: number;
  date?: string;
  time?: string;
  source: "nasdaq" | "stooq" | "local_proxy";
  fetchedAt?: string;
};

export type FxQuote = {
  pair: "USDJPY";
  rate: number;
  date?: string;
  time?: string;
  source: "stooq" | "frankfurter" | "local_proxy";
  fetchedAt?: string;
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

export const isExternalQuoteDisabled = import.meta.env.VITE_DISABLE_EXTERNAL_QUOTES === "true";
export const isExternalQuoteConsentRequired = import.meta.env.VITE_REQUIRE_EXTERNAL_QUOTE_CONSENT === "true";
const MARKET_LOCAL_API_BASE = import.meta.env.VITE_MARKET_LOCAL_API_BASE ?? "http://127.0.0.1:18787";

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
  const payload = await fetchLocalMarketJson(`/api/market/quote?symbol=${encodeURIComponent(ticker)}`, `${ticker} 株価`);
  const quote = payload as StockQuote & { error?: string; message?: string };
  if (quote.error || !Number.isFinite(quote.price) || quote.price <= 0) {
    throw new Error(quote.message ?? `${ticker} の株価が取得できませんでした。取得元=local_market_proxy / 理由=価格が未取得です。`);
  }
  return quote;
}

export async function fetchUsdJpyRate(): Promise<FxQuote> {
  if (isExternalQuoteDisabled) {
    throw new Error("公開版では外部通信を避けるため、為替取得は無効です。確認したUSD/JPYを手入力してください。");
  }
  const payload = await fetchLocalMarketJson("/api/market/fx/usdjpy", "USD/JPY");
  const quote = payload as FxQuote & { error?: string; message?: string };
  if (quote.error || !Number.isFinite(quote.rate) || quote.rate <= 0) {
    throw new Error(quote.message ?? "USD/JPYを取得できませんでした。取得元=local_market_proxy / 理由=レートが未取得です。既存の為替レートは変更していません。");
  }
  return {
    ...quote,
    pair: "USDJPY",
  };
}

async function fetchLocalMarketJson(path: string, label: string): Promise<unknown> {
  const url = `${MARKET_LOCAL_API_BASE}${path}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(`${label}を取得できませんでした。取得元=local_market_proxy / 理由=ローカルAPIが起動していません。既存値は変更していません。`);
  }
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : `${label}を取得できませんでした。取得元=local_market_proxy / HTTP ${response.status} / 理由=${response.statusText}`;
    throw new Error(message);
  }
  return payload;
}
