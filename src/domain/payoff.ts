import type { PayoffPoint, TradeSimulation } from "@/types/domain";
import { calculateTotalFeesJPY, getShortCallLegs, getShortPutLegs } from "./calculations";

export function calculatePayoffAtExpiryJPY(simulation: TradeSimulation, stockPriceUSD: number): number {
  const fx = simulation.fxRateJPY;
  const stock = simulation.stockPosition;
  let pnl = 0;

  if (stock) {
    pnl += (stockPriceUSD - stock.averageCostUSD) * stock.shares * fx;
  }

  for (const call of getShortCallLegs(simulation)) {
    pnl += call.premiumUSD * 100 * call.quantity * fx;
    pnl -= Math.max(0, stockPriceUSD - call.strikeUSD) * 100 * call.quantity * fx;
  }

  for (const put of getShortPutLegs(simulation)) {
    pnl += put.premiumUSD * 100 * put.quantity * fx;
    pnl -= Math.max(0, put.strikeUSD - stockPriceUSD) * 100 * put.quantity * fx;
  }

  return pnl - calculateTotalFeesJPY(simulation);
}

export function calculatePayoffSeries(simulation: TradeSimulation): PayoffPoint[] {
  const strikes = simulation.optionLegs.map((leg) => leg.strikeUSD);
  const minStrike = Math.min(simulation.currentPriceUSD, ...strikes);
  const maxStrike = Math.max(simulation.currentPriceUSD, ...strikes);
  const min = Math.max(1, Math.floor(minStrike * 0.55));
  const max = Math.ceil(maxStrike * 1.35);
  const step = Math.max(1, Math.round((max - min) / 48));
  const points: PayoffPoint[] = [];
  for (let price = min; price <= max; price += step) {
    points.push({
      stockPriceUSD: price,
      pnlJPY: calculatePayoffAtExpiryJPY(simulation, price),
    });
  }
  return points;
}
