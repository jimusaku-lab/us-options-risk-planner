import type { OptionLeg, PayoffBreakeven, PayoffDisplayMode, PayoffPoint, PayoffSummary, TradeSimulation } from "@/types/domain";
import { calculateTotalFeesJPY } from "./calculations";

const CONTRACT_SIZE = 100;

export function calculatePayoffAtExpiryJPY(simulation: TradeSimulation, stockPriceUSD: number): number {
  const fx = simulation.fxRateJPY;
  const stock = simulation.stockPosition;
  let pnl = 0;

  if (stock) {
    pnl += (stockPriceUSD - stock.averageCostUSD) * stock.shares * fx;
  }

  for (const leg of simulation.optionLegs) {
    pnl += calculateOptionLegPayoffAtExpiryJPY(leg, stockPriceUSD, fx);
  }

  return pnl - calculateTotalFeesJPY(simulation);
}

function calculateOptionOnlyPayoffAtExpiryJPY(simulation: TradeSimulation, stockPriceUSD: number): number {
  const fx = simulation.fxRateJPY;
  const optionPnlJPY = simulation.optionLegs.reduce(
    (sum, leg) => sum + calculateOptionLegPayoffAtExpiryJPY(leg, stockPriceUSD, fx),
    0,
  );
  return optionPnlJPY - calculateTotalFeesJPY(simulation);
}

export function calculateOptionLegPayoffAtExpiryJPY(leg: OptionLeg, stockPriceUSD: number, fxRateJPY: number): number {
  const intrinsicUSD =
    leg.type === "call"
      ? Math.max(0, stockPriceUSD - leg.strikeUSD)
      : Math.max(0, leg.strikeUSD - stockPriceUSD);
  const optionPnlPerShareUSD = leg.side === "buy"
    ? intrinsicUSD - leg.premiumUSD
    : leg.premiumUSD - intrinsicUSD;
  return optionPnlPerShareUSD * CONTRACT_SIZE * leg.quantity * fxRateJPY;
}

export function calculatePayoffSeries(simulation: TradeSimulation, displayMode: PayoffDisplayMode = "theoretical"): PayoffPoint[] {
  const strikes = simulation.optionLegs.map((leg) => leg.strikeUSD);
  const summary = calculatePayoffSummary(simulation, displayMode);
  const breakevens = summary.breakevens.map((item) => item.priceUSD);
  const stockCost = simulation.stockPosition?.averageCostUSD;
  const rangeValues = [simulation.currentPriceUSD, stockCost, ...strikes, ...breakevens]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const minReference = rangeValues.length > 0 ? Math.min(...rangeValues) : Math.min(simulation.currentPriceUSD, ...strikes);
  const maxReference = rangeValues.length > 0 ? Math.max(...rangeValues) : Math.max(simulation.currentPriceUSD, ...strikes);
  const isPracticalPutSell =
    simulation.strategyType === "short_put" && simulation.optionLegs.some((leg) => leg.type === "put" && leg.side === "sell");
  const shouldUsePracticalRange =
    (simulation.strategyType === "covered_call" || isPracticalPutSell) && displayMode !== "theoretical";
  const min = displayMode === "theoretical"
    ? 0
    : isPracticalPutSell
      ? Math.max(1, Math.floor(minReference * 0.65))
      : shouldUsePracticalRange
      ? Math.max(1, Math.floor(minReference * 0.85))
      : Math.max(0, Math.floor(minReference * 0.55));
  const max = isPracticalPutSell
    ? Math.ceil(maxReference * 1.25)
    : shouldUsePracticalRange
      ? Math.ceil(maxReference * 1.15)
      : Math.ceil(maxReference * 1.35);
  const step = Math.max(1, Math.round((max - min) / 48));
  const points: PayoffPoint[] = [];
  for (let price = min; price <= max; price += step) {
    const pnlJPY =
      displayMode === "option_only" || displayMode === "opportunity"
        ? calculateOptionOnlyPayoffAtExpiryJPY(simulation, price)
        : calculatePayoffAtExpiryJPY(simulation, price);
    points.push({
      stockPriceUSD: price,
      pnlJPY,
      profitJPY: Math.max(0, pnlJPY),
      lossJPY: Math.min(0, pnlJPY),
    });
  }
  return points;
}

export function calculatePayoffSummary(simulation: TradeSimulation, displayMode: PayoffDisplayMode = "theoretical"): PayoffSummary {
  const totalQuantity = simulation.optionLegs.reduce((sum, leg) => sum + Math.max(0, leg.quantity), 0);
  const feePerContractJPY = totalQuantity > 0 ? calculateTotalFeesJPY(simulation) / totalQuantity : 0;
  const feePerContractUSD = feePerContractJPY / (simulation.fxRateJPY || 1);
  const coveredCallSummary = getCoveredCallPayoffSummary(simulation, feePerContractUSD);
  const breakevens = coveredCallSummary?.breakevens ?? simulation.optionLegs.flatMap((leg) => {
    const feePerShareUSD = feePerContractUSD / CONTRACT_SIZE;
    if (leg.type === "call" && leg.side === "buy") {
      return [{ priceUSD: leg.strikeUSD + leg.premiumUSD + feePerShareUSD, label: `${legLabel(leg)} 損益分岐点` }];
    }
    if (leg.type === "put" && leg.side === "buy") {
      return [{ priceUSD: Math.max(0, leg.strikeUSD - leg.premiumUSD - feePerShareUSD), label: `${legLabel(leg)} 損益分岐点` }];
    }
    if (leg.type === "call" && leg.side === "sell") {
      return [{ priceUSD: leg.strikeUSD + leg.premiumUSD - feePerShareUSD, label: `${legLabel(leg)} 損益分岐点` }];
    }
    return [{ priceUSD: Math.max(0, leg.strikeUSD - leg.premiumUSD + feePerShareUSD), label: `${legLabel(leg)} 損益分岐点` }];
  });
  const series = samplePayoffExtremes(simulation, breakevens.map((item) => item.priceUSD), displayMode);
  const minPnl = Math.min(...series.map((point) => point.pnlJPY));
  const maxPnl = Math.max(...series.map((point) => point.pnlJPY));
  const hasLongCall = simulation.optionLegs.some((leg) => leg.side === "buy" && leg.type === "call");
  const hasShortCallWithoutStock =
    simulation.optionLegs.some((leg) => leg.side === "sell" && leg.type === "call") &&
    (simulation.stockPosition?.shares ?? 0) < simulation.optionLegs
      .filter((leg) => leg.side === "sell" && leg.type === "call")
      .reduce((sum, leg) => sum + leg.quantity * CONTRACT_SIZE, 0);
  const hasLongOption = simulation.optionLegs.some((leg) => leg.side === "buy");

  const coveredCallDisplayLabel = getCoveredCallDisplayModeLabel(displayMode);
  const coveredCallIsTheoretical = coveredCallSummary && displayMode === "theoretical";
  const isPracticalPutSell =
    simulation.strategyType === "short_put" && simulation.optionLegs.some((leg) => leg.type === "put" && leg.side === "sell");
  const putSellIsTheoretical = isPracticalPutSell && displayMode === "theoretical";

  return {
    breakevens,
    secondaryBreakevens: coveredCallSummary?.secondaryBreakevens,
    maxLossLabel: hasShortCallWithoutStock ? "無制限（裸C売りの上昇側）" : formatPayoffJPY(minPnl),
    maxLossTitle: coveredCallSummary
      ? coveredCallIsTheoretical
        ? "理論上の最大評価損"
        : "表示レンジ下限の評価損"
      : isPracticalPutSell
        ? putSellIsTheoretical
          ? "理論最大損失（株価0ドル想定）"
          : "実用レンジ下限の評価損"
        : hasLongOption
          ? "支払済みリスク上限"
        : undefined,
    maxLossNote: coveredCallSummary || isPracticalPutSell
      ? coveredCallIsTheoretical
        ? "株価0ドル想定。保有株込み。実現損ではありません。この価格で自動売却されるという意味ではありません。"
        : putSellIsTheoretical
          ? "株価0ドル想定。プット売りの理論上の最大損失です。満期時に権利行使されると株式取得となり、取得直後に評価損を抱える可能性があります。"
          : isPracticalPutSell
            ? "初期表示は現在株価・権利行使価格・損益分岐点を中心にした実用レンジです。株価0ドルまで含めた理論値は理論最大レンジで確認できます。"
            : "初期表示は短期カバードコール判断に使う実用レンジです。株価0ドルまで含めた理論上の最大評価損は、理論最大レンジで確認できます。"
      : hasLongOption
        ? "支払プレミアムと建玉時手数料の合計です。満期まで放置して無価値になった場合の理論上限で、通常運用では反対売買判断で管理します。"
        : undefined,
    maxProfitLabel: hasLongCall ? "無制限（株価上昇側）" : formatPayoffJPY(maxPnl),
    displayModeLabel: coveredCallSummary || isPracticalPutSell ? coveredCallDisplayLabel : undefined,
    displayModeOptions: coveredCallSummary || isPracticalPutSell ? ["実用レンジ", "理論最大レンジ", "オプション単体", "機会損益"] : undefined,
    hasLongOption,
    formulas: coveredCallSummary
      ? coveredCallSummary.formulas
      : simulation.optionLegs.map((leg) => getBreakevenFormula(leg, feePerContractUSD)),
  };
}

export function getPayoffDisplayModeLabel(displayMode: PayoffDisplayMode): string {
  return getCoveredCallDisplayModeLabel(displayMode);
}

export function getPayoffDisplayModeFromLabel(label: string): PayoffDisplayMode {
  if (label === "理論最大レンジ") return "theoretical";
  if (label === "オプション単体") return "option_only";
  if (label === "機会損益") return "opportunity";
  return "practical";
}

function getCoveredCallDisplayModeLabel(displayMode: PayoffDisplayMode): string {
  if (displayMode === "theoretical") return "理論最大レンジ";
  if (displayMode === "option_only") return "オプション単体";
  if (displayMode === "opportunity") return "機会損益";
  return "実用レンジ";
}

function getCoveredCallPayoffSummary(
  simulation: TradeSimulation,
  feePerContractUSD: number,
): { breakevens: PayoffBreakeven[]; secondaryBreakevens: PayoffBreakeven[]; formulas: string[] } | undefined {
  if (simulation.strategyType !== "covered_call") return undefined;
  const stock = simulation.stockPosition;
  const callLeg = simulation.optionLegs.find((leg) => leg.type === "call" && leg.side === "sell");
  if (!stock || !callLeg || stock.averageCostUSD <= 0 || callLeg.quantity <= 0) return undefined;
  const coveredShares = Math.min(stock.shares, callLeg.quantity * CONTRACT_SIZE);
  if (coveredShares <= 0) return undefined;
  const feePerShareUSD = feePerContractUSD / CONTRACT_SIZE;
  const premiumPerShareUSD = callLeg.premiumUSD;
  const stockBreakevenUSD = Math.max(0, stock.averageCostUSD - premiumPerShareUSD + feePerShareUSD);
  const shortCallBreakevenUSD = callLeg.strikeUSD + premiumPerShareUSD - feePerShareUSD;
  return {
    breakevens: [
      {
        priceUSD: stockBreakevenUSD,
        label: "保有株込みの損益分岐点",
      },
    ],
    secondaryBreakevens: [
      {
        priceUSD: shortCallBreakevenUSD,
        label: "コール売り単体の上側損益分岐点",
      },
    ],
    formulas: [
      `保有株込み: 取得単価 ${formatPayoffUSD(stock.averageCostUSD)} - 受取プレミアム ${formatPayoffUSD(premiumPerShareUSD)} + 手数料按分 ${formatPayoffUSD(feePerShareUSD)} = ${formatPayoffUSD(stockBreakevenUSD)}`,
      `コール売り単体の上側損益分岐点: 権利行使価格 ${formatPayoffUSD(callLeg.strikeUSD)} + 受取プレミアム ${formatPayoffUSD(premiumPerShareUSD)} - 手数料按分 ${formatPayoffUSD(feePerShareUSD)} = ${formatPayoffUSD(shortCallBreakevenUSD)}。保有株込みの損益分岐点ではありません。`,
    ],
  };
}

function samplePayoffExtremes(simulation: TradeSimulation, breakevens: number[], displayMode: PayoffDisplayMode): PayoffPoint[] {
  const strikes = simulation.optionLegs.map((leg) => leg.strikeUSD);
  const stockCost = simulation.stockPosition?.averageCostUSD;
  const rangeValues = [simulation.currentPriceUSD, stockCost, ...strikes, ...breakevens]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const minReference = rangeValues.length > 0 ? Math.min(...rangeValues) : Math.min(simulation.currentPriceUSD, ...strikes);
  const maxReference = rangeValues.length > 0 ? Math.max(...rangeValues) : Math.max(simulation.currentPriceUSD, ...strikes);
  const isPracticalPutSell =
    simulation.strategyType === "short_put" && simulation.optionLegs.some((leg) => leg.type === "put" && leg.side === "sell");
  const isPracticalRange =
    (simulation.strategyType === "covered_call" || isPracticalPutSell) && displayMode !== "theoretical";
  const lowerBound = isPracticalPutSell && displayMode !== "theoretical"
    ? Math.max(1, minReference * 0.65)
    : isPracticalRange
      ? Math.max(1, minReference * 0.85)
      : 0;
  const upperBound = isPracticalPutSell && displayMode !== "theoretical"
    ? maxReference * 1.25
    : isPracticalRange
      ? maxReference * 1.15
      : Math.max(simulation.currentPriceUSD, ...strikes, ...breakevens, 1) * 3;
  const prices = [lowerBound, simulation.currentPriceUSD, stockCost, ...strikes, ...breakevens, upperBound]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  return prices.map((price) => ({
    stockPriceUSD: price,
    pnlJPY:
      displayMode === "option_only" || displayMode === "opportunity"
        ? calculateOptionOnlyPayoffAtExpiryJPY(simulation, price)
        : calculatePayoffAtExpiryJPY(simulation, price),
  }));
}

function legLabel(leg: OptionLeg): string {
  return `${leg.type === "call" ? "C" : "P"} ${leg.strikeUSD}`;
}

function getBreakevenFormula(leg: OptionLeg, feePerContractUSD: number): string {
  const feePerShareUSD = feePerContractUSD / CONTRACT_SIZE;
  if (leg.type === "call" && leg.side === "buy") {
    return `${legLabel(leg)}買い: 権利行使価格 ${formatPayoffUSD(leg.strikeUSD)} + 支払プレミアム ${formatPayoffUSD(leg.premiumUSD)} + 手数料按分 ${formatPayoffUSD(feePerShareUSD)} = ${formatPayoffUSD(leg.strikeUSD + leg.premiumUSD + feePerShareUSD)}`;
  }
  if (leg.type === "put" && leg.side === "buy") {
    return `${legLabel(leg)}買い: 権利行使価格 ${formatPayoffUSD(leg.strikeUSD)} - 支払プレミアム ${formatPayoffUSD(leg.premiumUSD)} - 手数料按分 ${formatPayoffUSD(feePerShareUSD)} = ${formatPayoffUSD(Math.max(0, leg.strikeUSD - leg.premiumUSD - feePerShareUSD))}`;
  }
  if (leg.type === "call" && leg.side === "sell") {
    return `${legLabel(leg)}売り: 権利行使価格 ${formatPayoffUSD(leg.strikeUSD)} + 受取プレミアム ${formatPayoffUSD(leg.premiumUSD)} - 手数料按分 ${formatPayoffUSD(feePerShareUSD)} = ${formatPayoffUSD(leg.strikeUSD + leg.premiumUSD - feePerShareUSD)}`;
  }
  return `${legLabel(leg)}売り: 権利行使価格 ${formatPayoffUSD(leg.strikeUSD)} - 受取プレミアム ${formatPayoffUSD(leg.premiumUSD)} + 手数料按分 ${formatPayoffUSD(feePerShareUSD)} = ${formatPayoffUSD(Math.max(0, leg.strikeUSD - leg.premiumUSD + feePerShareUSD))}`;
}

function formatPayoffUSD(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPayoffJPY(value: number): string {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}
