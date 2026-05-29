import type { TradeSimulation } from "@/types/domain";
import { calculateDte } from "@/domain/calculations";

const entryDate = "2026-05-26";
const expiryDate = "2026-06-12";

export const sampleAmznSimulation: TradeSimulation = {
  id: "sample-amzn-covered-call-plus-put",
  status: "planned",
  name: "AMZN 280C + 250P demo",
  ticker: "AMZN",
  underlyingName: "Amazon.com Inc.",
  strategyType: "covered_call_plus_short_put",
  currentPriceUSD: 266.32,
  fxRateJPY: 159,
  entryDate,
  expiryDate,
  dte: calculateDte(entryDate, expiryDate),
  accountCurrency: "JPY",
  stockPosition: {
    shares: 100,
    averageCostUSD: 270.39,
    denominatorPriceMode: "current_price",
    canSellAtStrike: true,
  },
  optionLegs: [
    {
      id: "amzn-20260612-280c",
      type: "call",
      side: "sell",
      strikeUSD: 280,
      premiumUSD: 3.04,
      quantity: 1,
      expiryDate,
      isCovered: true,
      assignmentPolicy: "accept",
      brokerSymbol: "AMZN/12M26C280:xcbf",
    },
    {
      id: "amzn-20260612-250p",
      type: "put",
      side: "sell",
      strikeUSD: 250,
      premiumUSD: 1.4,
      quantity: 1,
      expiryDate,
      putIntent: "can_buy",
      assignmentPolicy: "accept",
      brokerSymbol: "AMZN/12M26P250:xcbf",
    },
  ],
  brokerMarginJPY: 317_902,
  marginBufferMultiplier: 2,
  marginUsagePercent: 69.35,
  availableCashJPY: 333_466,
  denominatorMode: "stock_plus_margin",
  profitTakeRule: {
    enabled: true,
    targetPremiumKeepPercent: 60,
    latestCloseDaysBeforeExpiry: 7,
  },
  stopLossRule: {
    enabled: true,
    type: "option_buyback_price",
    value: 14,
  },
  taxProfileId: "japan_derivative_separate_tax_user_confirm",
  nisaExpectedAnnualReturnPct: 6,
  beginnerMode: true,
  fixtureMeta: {
    source: "demo",
    isRealMoney: false,
    broker: "SaxoBank",
    purpose: "development-fixture",
    createdAt: "2026-05-26",
    notes: "これは実取引ではなく、Saxo TraderGO DEMO画面仕様・計算仕様確認用のサンプルです。",
  },
};
