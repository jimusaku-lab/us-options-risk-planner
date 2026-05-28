import type { BrokerAccountSnapshot, BrokerPositionSnapshot } from "@/types/broker";

export const saxoDemoFixtureMeta = {
  source: "demo",
  isRealMoney: false,
  broker: "SaxoBank",
  purpose: "development-fixture",
  createdAt: "2026-05-26",
  notes: "Saxo TraderGO DEMOスクリーンショットから読み取った開発用fixture。実績集計・税務集計には使用しない。",
} as const;

export const demoAccountSnapshot: BrokerAccountSnapshot = {
  accountCurrency: "JPY",
  cashBalance: 1_836_474.61,
  accountValue: 10_165_236.18,
  marginUsed: 754_414,
  marginAvailable: 333_475,
  marginUtilizationPct: 69.35,
  buyingPower: 333_475.42,
};

export const demoPositions: BrokerPositionSnapshot[] = [
  {
    symbol: "AMZN",
    assetType: "Stock",
    quantity: 100,
    averagePrice: 270.39,
    marketValue: 4_242_887,
    unrealizedPnl: -10_558,
    currency: "JPY",
  },
  {
    symbol: "AMZN/12M26C280:xcbf",
    assetType: "StockOption",
    quantity: -1,
    averagePrice: 6.3,
    marketValue: -41_994,
    unrealizedPnl: 56_284,
    currency: "JPY",
  },
];
