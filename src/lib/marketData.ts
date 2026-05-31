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
  source: "stooq" | "local_proxy";
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

export const isExternalQuoteDisabled = import.meta.env.VITE_DISABLE_EXTERNAL_QUOTES === "true" || isGitHubPagesBuild;

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
  const url = `/api/quote?symbol=${encodeURIComponent(ticker)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`株価を取得できませんでした: HTTP ${response.status}`);
  }
  const quote = (await response.json()) as StockQuote & { error?: string };
  if (quote.error || !Number.isFinite(quote.price) || quote.price <= 0) {
    throw new Error("株価が取得できませんでした。ティッカーを確認してください。");
  }
  return quote;
}

export async function fetchUsdJpyRate(): Promise<FxQuote> {
  if (isExternalQuoteDisabled) {
    throw new Error("公開版では外部通信を避けるため、為替取得は無効です。確認したUSD/JPYを手入力してください。");
  }
  const response = await fetch("/api/fx");
  if (!response.ok) {
    throw new Error(`為替を取得できませんでした: HTTP ${response.status}`);
  }
  const quote = (await response.json()) as FxQuote & { error?: string };
  if (quote.error || !Number.isFinite(quote.rate) || quote.rate <= 0) {
    throw new Error("USD/JPYを取得できませんでした。");
  }
  return {
    ...quote,
    pair: "USDJPY",
  };
}
