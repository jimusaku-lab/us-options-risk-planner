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

export function normalizeTicker(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase().replace(/\s+/g, " ");
  return tickerAliases[upper] ?? tickerAliases[trimmed] ?? upper;
}

export async function fetchStooqQuote(symbol: string): Promise<StockQuote> {
  const ticker = normalizeTicker(symbol);
  throw new Error(`${ticker} の自動株価取得は公開版では無効です。証券会社画面等で確認した現在株価を手入力してください。`);
}

export async function fetchUsdJpyRate(): Promise<FxQuote> {
  throw new Error("USD/JPYの自動取得は公開版では無効です。確認した為替レートを手入力してください。");
}
