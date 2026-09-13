import type { TradeSimulation } from "@/types/domain";
import type { OptionCloseExecutionResult } from "./optionCloseExecutions";
import { getCanonicalOptionEntryExecutions } from "./optionEntryExecutions";

export type HistoryCashflowLine = {
  amountUSD: number;
  label: "建玉時支払" | "建玉時受取" | "建玉時受払" | "決済時支払" | "決済時受取" | "決済時受払" | "満期時支払" | "満期時受取" | "満期時受払";
};

export type HistoryCashflowDisplay =
  | {
      available: true;
      entry: HistoryCashflowLine;
      close: HistoryCashflowLine;
      realizedPnlUSD: number;
      reconciles: boolean;
      executionCount: number;
    }
  | { available: false; reason: "入出金内訳 未確認" | "入出金と実現損益 不一致" | "JPY入出金は確定JPY実績を使用" };

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

function lineLabel(stage: "entry" | "close", amountUSD: number, allExpired: boolean): HistoryCashflowLine["label"] {
  if (stage === "close" && allExpired) {
    if (amountUSD < 0) return "満期時支払";
    if (amountUSD > 0) return "満期時受取";
    return "満期時受払";
  }
  if (amountUSD < 0) return stage === "entry" ? "建玉時支払" : "決済時支払";
  if (amountUSD > 0) return stage === "entry" ? "建玉時受取" : "決済時受取";
  return stage === "entry" ? "建玉時受払" : "決済時受払";
}

/**
 * Builds a display-only, fee-inclusive USD cashflow for the same confirmed
 * execution results already used by history P/L. It does not create missing
 * fees, convert P/JPY evidence, or change the canonical performance result.
 */
export function calculateHistoryCashflowDisplay(
  simulation: TradeSimulation,
  results: OptionCloseExecutionResult[],
): HistoryCashflowDisplay {
  if (simulation.accountEnvironment !== "PROD_N_USD_SETTLEMENT") {
    return { available: false, reason: "JPY入出金は確定JPY実績を使用" };
  }
  if (results.length === 0) return { available: false, reason: "入出金内訳 未確認" };

  const entries = getCanonicalOptionEntryExecutions(simulation).filter((entry) => entry.confirmed);
  const closedByLeg = new Map<string, number>();
  let entryAmountUSD = 0;
  let closeAmountUSD = 0;
  let realizedPnlUSD = 0;
  let allExpired = true;

  for (const result of results) {
    const matchingEntries = entries.filter((entry) => entry.legId === result.leg.id);
    const entry = matchingEntries.length === 1 ? matchingEntries[0] : undefined;
    const closeKind = result.execution.closeKind ?? "buyback";
    const explicitEntry = entry
      && Number.isFinite(entry.fillPriceUSD)
      && Number.isFinite(entry.contracts)
      && entry.contracts > 0
      && entry.commissionUSD !== undefined
      && Number.isFinite(entry.commissionUSD);
    const explicitClose = closeKind === "expired"
      ? result.execution.commissionUSD !== undefined && Number.isFinite(result.execution.commissionUSD)
      : (result.execution.closePriceUSD !== undefined
        && Number.isFinite(result.execution.closePriceUSD)
        && result.execution.commissionUSD !== undefined
        && Number.isFinite(result.execution.commissionUSD));
    const valuesFinite = [result.entryPremiumUSD, result.closeCostUSD, result.openCommissionUSD, result.closeCommissionUSD, result.realizedPnlUSD]
      .every(Number.isFinite);
    const nextClosed = (closedByLeg.get(result.leg.id) ?? 0) + result.execution.contracts;
    if (!explicitEntry || !explicitClose || !valuesFinite || !result.execution.confirmed || !Number.isFinite(result.execution.contracts) || result.execution.contracts <= 0 || nextClosed > entry.contracts + 1e-9) {
      return { available: false, reason: "入出金内訳 未確認" };
    }
    closedByLeg.set(result.leg.id, nextClosed);

    entryAmountUSD += result.leg.side === "buy"
      ? -(result.entryPremiumUSD + result.openCommissionUSD)
      : result.entryPremiumUSD - result.openCommissionUSD;
    if (closeKind === "expired") {
      closeAmountUSD -= result.closeCommissionUSD;
    } else {
      allExpired = false;
      closeAmountUSD += result.leg.side === "buy"
        ? result.closeCostUSD - result.closeCommissionUSD
        : -(result.closeCostUSD + result.closeCommissionUSD);
    }
    realizedPnlUSD += result.realizedPnlUSD;
  }

  const entryAmount = cents(entryAmountUSD);
  const closeAmount = cents(closeAmountUSD);
  const realized = cents(realizedPnlUSD);
  const reconciliationDelta = Math.abs(cents(entryAmount + closeAmount) - realized);
  if (reconciliationDelta > 0.0100001) {
    return { available: false, reason: "入出金と実現損益 不一致" };
  }
  return {
    available: true,
    entry: { amountUSD: entryAmount, label: lineLabel("entry", entryAmount, false) },
    close: { amountUSD: closeAmount, label: lineLabel("close", closeAmount, allExpired) },
    realizedPnlUSD: realized,
    reconciles: true,
    executionCount: results.length,
  };
}
