export type SaxoConnectionStatus = {
  environment: "sim" | "live";
  connected: boolean;
  accountKey?: string;
  clientKey?: string;
  lastSyncedAt?: string;
  permissions: Array<"read" | "subscribe" | "write">;
};

export type BrokerAccountSnapshot = {
  accountCurrency: "JPY" | "USD" | string;
  cashBalance: number;
  accountValue: number;
  marginUsed: number;
  marginAvailable: number;
  marginUtilizationPct: number;
  buyingPower?: number;
  raw?: unknown;
};

export type BrokerPositionSnapshot = {
  symbol: string;
  assetType: "Stock" | "StockOption" | "StockIndexOption" | "Other";
  quantity: number;
  averagePrice: number;
  marketValue: number;
  unrealizedPnl: number;
  currency: string;
  raw?: unknown;
};

export type BrokerOrderSnapshot = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  orderType: string;
  price?: number;
  status: string;
  raw?: unknown;
};

export type OptionQuoteSnapshot = {
  bid: number;
  ask: number;
  mid: number;
  last?: number;
  impliedVolatility?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  openInterest?: number;
  volume?: number;
  currency: string;
};

export type BrokerOptionChainSnapshot = {
  underlyingSymbol: string;
  underlyingPrice: number;
  expiries: Array<{
    expiryDate: string;
    strikes: Array<{
      strike: number;
      call?: OptionQuoteSnapshot;
      put?: OptionQuoteSnapshot;
    }>;
  }>;
};
