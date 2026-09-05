import type { TradeSimulation } from "@/types/domain";
import { formatUSD } from "@/lib/format";

export type CurrentPriceStrikeLegDisplay = {
  id: string;
  label: string;
  strikeUSD?: number;
  differenceUSD?: number;
  differencePct?: number;
};

export type CurrentPriceStrikeDisplay = {
  currentPriceUSD?: number;
  legs: CurrentPriceStrikeLegDisplay[];
};

/**
 * Presents only stored/current underlying prices alongside option strikes.
 * It deliberately does not infer an underlying price from premium, FX, or
 * another leg: an unavailable current price remains unavailable.
 */
export function getCurrentPriceStrikeDisplay(simulation: TradeSimulation): CurrentPriceStrikeDisplay {
  const currentPriceUSD = Number.isFinite(simulation.currentPriceUSD) && simulation.currentPriceUSD > 0
    ? simulation.currentPriceUSD
    : undefined;
  const legs = simulation.optionLegs
    .filter((leg) => leg.type === "call" || leg.type === "put")
    .map((leg) => {
      const strikeUSD = Number.isFinite(leg.strikeUSD) && leg.strikeUSD > 0 ? leg.strikeUSD : undefined;
      const differenceUSD = currentPriceUSD !== undefined && strikeUSD !== undefined
        ? currentPriceUSD - strikeUSD
        : undefined;
      return {
        id: leg.id,
        label: leg.type === "call" ? "C" : "P",
        strikeUSD,
        differenceUSD,
        differencePct: differenceUSD !== undefined && strikeUSD !== undefined
          ? (differenceUSD / strikeUSD) * 100
          : undefined,
      };
    });
  return { currentPriceUSD, legs };
}

export function formatCurrentPriceStrikeDifference(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const sign = value > 0 ? "+" : value < 0 ? "-" : "±";
  return `${sign}${formatUSD(Math.abs(value))}`;
}

export function formatCurrentPriceStrikePercent(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const sign = value > 0 ? "+" : value < 0 ? "-" : "±";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}
