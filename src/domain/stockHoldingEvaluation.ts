export type StockEvaluationSource = "saxo_position" | "app_current_price" | "manual_or_unknown";

export type StockHoldingEvaluationInput = {
  ticker: string;
  shares: number;
  averageCostUSD: number;
  appCurrentPriceUSD?: number;
  fxRateJPY?: number | null;
  saxoPosition?: {
    currentPrice?: number;
    currentStockPrice?: number;
    marketValue?: number;
    unrealizedPnl?: number;
    fetchedAt?: string;
  };
  fallbackUpdatedAt?: string;
};

export type StockHoldingEvaluation = {
  ticker: string;
  shares: number;
  averageCostUSD: number;
  currentPriceUSD?: number;
  costBasisUSD: number;
  marketValueUSD?: number;
  unrealizedPnlUSD?: number;
  unrealizedPnlPct?: number;
  costBasisJPY?: number;
  marketValueJPY?: number;
  unrealizedPnlJPY?: number;
  fxRateJPY?: number;
  source: StockEvaluationSource;
  sourceLabel: string;
  updatedAt?: string;
  saxoMarketValueUSD?: number;
  saxoUnrealizedPnlUSD?: number;
  appCalculatedUnrealizedPnlUSD?: number;
  pnlDifferenceUSD?: number;
};

function positiveNumber(value: number | undefined | null): number | undefined {
  return value !== undefined && value !== null && Number.isFinite(value) && value > 0 ? value : undefined;
}

function finiteNumber(value: number | undefined | null): number | undefined {
  return value !== undefined && value !== null && Number.isFinite(value) ? value : undefined;
}

export function calculateStockHoldingEvaluation(input: StockHoldingEvaluationInput): StockHoldingEvaluation | undefined {
  const shares = positiveNumber(input.shares);
  const averageCostUSD = positiveNumber(input.averageCostUSD);
  if (!shares || !averageCostUSD) return undefined;

  const costBasisUSD = averageCostUSD * shares;
  const saxoCurrentPrice = positiveNumber(input.saxoPosition?.currentStockPrice) ?? positiveNumber(input.saxoPosition?.currentPrice);
  const saxoMarketValueUSD = positiveNumber(input.saxoPosition?.marketValue);
  const saxoPriceFromMarketValue = saxoMarketValueUSD !== undefined ? saxoMarketValueUSD / shares : undefined;
  const appCurrentPrice = positiveNumber(input.appCurrentPriceUSD);
  const currentPriceUSD = saxoCurrentPrice ?? saxoPriceFromMarketValue ?? appCurrentPrice;
  const source: StockEvaluationSource =
    saxoCurrentPrice !== undefined || saxoMarketValueUSD !== undefined
      ? "saxo_position"
      : appCurrentPrice !== undefined
        ? "app_current_price"
        : "manual_or_unknown";
  const sourceLabel =
    source === "saxo_position"
      ? "Saxo現在建玉"
      : source === "app_current_price"
        ? "アプリ株価更新 / 手入力株価"
        : "未取得";

  const appMarketValueUSD = currentPriceUSD !== undefined ? currentPriceUSD * shares : undefined;
  const marketValueUSD = saxoMarketValueUSD ?? appMarketValueUSD;
  const appCalculatedUnrealizedPnlUSD = appMarketValueUSD !== undefined ? appMarketValueUSD - costBasisUSD : undefined;
  const saxoUnrealizedPnlUSD = finiteNumber(input.saxoPosition?.unrealizedPnl);
  const unrealizedPnlUSD = saxoUnrealizedPnlUSD ?? appCalculatedUnrealizedPnlUSD;
  const unrealizedPnlPct = unrealizedPnlUSD !== undefined && costBasisUSD > 0 ? (unrealizedPnlUSD / costBasisUSD) * 100 : undefined;
  const fxRateJPY = positiveNumber(input.fxRateJPY ?? undefined);

  return {
    ticker: input.ticker,
    shares,
    averageCostUSD,
    currentPriceUSD,
    costBasisUSD,
    marketValueUSD,
    unrealizedPnlUSD,
    unrealizedPnlPct,
    costBasisJPY: fxRateJPY !== undefined ? costBasisUSD * fxRateJPY : undefined,
    marketValueJPY: fxRateJPY !== undefined && marketValueUSD !== undefined ? marketValueUSD * fxRateJPY : undefined,
    unrealizedPnlJPY: fxRateJPY !== undefined && unrealizedPnlUSD !== undefined ? unrealizedPnlUSD * fxRateJPY : undefined,
    fxRateJPY,
    source,
    sourceLabel,
    updatedAt: input.saxoPosition?.fetchedAt ?? input.fallbackUpdatedAt,
    saxoMarketValueUSD,
    saxoUnrealizedPnlUSD,
    appCalculatedUnrealizedPnlUSD,
    pnlDifferenceUSD:
      saxoUnrealizedPnlUSD !== undefined && appCalculatedUnrealizedPnlUSD !== undefined
        ? saxoUnrealizedPnlUSD - appCalculatedUnrealizedPnlUSD
        : undefined,
  };
}
