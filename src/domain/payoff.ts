import type { OptionLeg, PayoffPoint, PayoffSummary, TradeSimulation } from "@/types/domain";
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

export function calculatePayoffSeries(simulation: TradeSimulation): PayoffPoint[] {
  const strikes = simulation.optionLegs.map((leg) => leg.strikeUSD);
  const summary = calculatePayoffSummary(simulation);
  const breakevens = summary.breakevens.map((item) => item.priceUSD);
  const minStrike = Math.min(simulation.currentPriceUSD, ...strikes, ...breakevens);
  const maxStrike = Math.max(simulation.currentPriceUSD, ...strikes, ...breakevens);
  const min = Math.max(1, Math.floor(minStrike * 0.55));
  const max = Math.ceil(maxStrike * 1.35);
  const step = Math.max(1, Math.round((max - min) / 48));
  const points: PayoffPoint[] = [];
  for (let price = min; price <= max; price += step) {
    const pnlJPY = calculatePayoffAtExpiryJPY(simulation, price);
    points.push({
      stockPriceUSD: price,
      pnlJPY,
      profitJPY: Math.max(0, pnlJPY),
      lossJPY: Math.min(0, pnlJPY),
    });
  }
  return points;
}

export function calculatePayoffSummary(simulation: TradeSimulation): PayoffSummary {
  const totalQuantity = simulation.optionLegs.reduce((sum, leg) => sum + Math.max(0, leg.quantity), 0);
  const feePerContractJPY = totalQuantity > 0 ? calculateTotalFeesJPY(simulation) / totalQuantity : 0;
  const feePerContractUSD = feePerContractJPY / (simulation.fxRateJPY || 1);
  const breakevens = simulation.optionLegs.flatMap((leg) => {
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
  const series = samplePayoffExtremes(simulation, breakevens.map((item) => item.priceUSD));
  const minPnl = Math.min(...series.map((point) => point.pnlJPY));
  const maxPnl = Math.max(...series.map((point) => point.pnlJPY));
  const hasLongCall = simulation.optionLegs.some((leg) => leg.side === "buy" && leg.type === "call");
  const hasShortCallWithoutStock =
    simulation.optionLegs.some((leg) => leg.side === "sell" && leg.type === "call") &&
    (simulation.stockPosition?.shares ?? 0) < simulation.optionLegs
      .filter((leg) => leg.side === "sell" && leg.type === "call")
      .reduce((sum, leg) => sum + leg.quantity * CONTRACT_SIZE, 0);
  const hasLongOption = simulation.optionLegs.some((leg) => leg.side === "buy");

  return {
    breakevens,
    maxLossLabel: hasShortCallWithoutStock ? "無制限（裸C売りの上昇側）" : formatPayoffJPY(minPnl),
    maxProfitLabel: hasLongCall ? "無制限（株価上昇側）" : formatPayoffJPY(maxPnl),
    hasLongOption,
    formulas: simulation.optionLegs.map((leg) => getBreakevenFormula(leg, feePerContractUSD)),
  };
}

function samplePayoffExtremes(simulation: TradeSimulation, breakevens: number[]): PayoffPoint[] {
  const strikes = simulation.optionLegs.map((leg) => leg.strikeUSD);
  const prices = [
    0,
    simulation.currentPriceUSD,
    ...strikes,
    ...breakevens,
    Math.max(simulation.currentPriceUSD, ...strikes, ...breakevens, 1) * 3,
  ].filter((value) => Number.isFinite(value) && value >= 0);
  return prices.map((price) => ({
    stockPriceUSD: price,
    pnlJPY: calculatePayoffAtExpiryJPY(simulation, price),
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
