import type { OptionCloseExecution, OptionEntryExecution, OptionLeg, TradeSimulation } from "@/types/domain";

/** Decimal arithmetic for monetary boundaries. Round once, never accumulate
 * binary fractions as money. Signed rebates are not converted with abs(). */
function decimal(value: number): [bigint, bigint] {
  if (!Number.isFinite(value)) throw new Error("finite money evidence required");
  const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e");
  const places = (mantissa.split(".")[1] ?? "").length - Number(exponent);
  const integer = BigInt(mantissa.replace(".", ""));
  return places >= 0 ? [integer, 10n ** BigInt(places)] : [integer * 10n ** BigInt(-places), 1n];
}
function rounded(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator * sign;
  return sign * ((absolute + denominator / 2n) / denominator);
}
export function moneyProduct(...values: number[]): number {
  const [n, d] = values.map(decimal).reduce(([an, ad], [bn, bd]) => [an * bn, ad * bd], [1n, 1n]);
  return Number(rounded(n * 100n, d)) / 100;
}
export function moneySum(...values: number[]): number {
  return Number(values.reduce((sum, value) => sum + BigInt(Math.round(moneyProduct(value) * 100)), 0n)) / 100;
}
/** Cumulative allocation makes the last allocation absorb the cent remainder. */
export function allocateMoney(total: number, original: number, prior: number, contracts: number): number {
  if (![original, prior, contracts].every(Number.isInteger) || original <= 0 || prior < 0 || contracts <= 0 || prior + contracts > original) throw new Error("invalid money allocation");
  const cents = BigInt(Math.round(moneyProduct(total) * 100));
  return Number(rounded(cents * BigInt(prior + contracts), BigInt(original)) - rounded(cents * BigInt(prior), BigInt(original))) / 100;
}

export type EvidenceValue = { state: "known"; value: number } | { state: "missing" | "conflict"; reason: string };
const missing = (reason: string): EvidenceValue => ({ state: "missing", reason });
export function activeSpreadEntries(simulation: TradeSimulation, leg: OptionLeg): OptionEntryExecution[] {
  const all = (simulation.optionEntryExecutions ?? []).filter(entry => entry.legId === leg.id && entry.confirmed);
  const superseded = new Set(all.flatMap(entry => entry.supersedesId ? [entry.supersedesId] : []));
  return all.filter(entry => !entry.voided && !superseded.has(entry.id));
}
export function activeSpreadCloses(simulation: TradeSimulation): OptionCloseExecution[] {
  const all = (simulation.optionCloseExecutions ?? []).filter(close => close.confirmed);
  const superseded = new Set(all.flatMap(close => close.supersedesId ? [close.supersedesId] : []));
  return all.filter(close => !close.voided && !superseded.has(close.id));
}
export function spreadEntryBasis(simulation: TradeSimulation): EvidenceValue {
  if (simulation.accountCurrency !== "USD") return missing("この組み合わせの円決済集計は未対応");
  const amounts: number[] = [];
  for (const leg of simulation.optionLegs) {
    const entries = activeSpreadEntries(simulation, leg);
    if (!Number.isInteger(leg.contractSize) || !(leg.contractSize! > 0) || !entries.length || entries.reduce((sum, entry) => sum + entry.contracts, 0) !== leg.quantity || new Set(entries.map(entry => entry.id)).size !== entries.length) return missing("建玉開始数量・倍率・約定参照 未確認");
    for (const entry of entries) {
      if (entry.settlementCurrency !== "USD" || !Number.isInteger(entry.contracts) || entry.contracts <= 0 || !Number.isFinite(entry.fillPriceUSD) || entry.fillPriceUSD < 0 || entry.commissionUSD === undefined || !Number.isFinite(entry.commissionUSD)) return missing("建玉時実績・開始費用 未確認");
      amounts.push(moneyProduct(leg.side === "buy" ? 1 : -1, entry.fillPriceUSD, entry.contracts, leg.contractSize!), entry.commissionUSD);
    }
  }
  return { state: "known", value: moneySum(...amounts) };
}

export type SpreadCloseMoney = { entryPremiumUSD: number; closeCostUSD: number; openCommissionUSD: number; closeCommissionUSD: number; realizedPnlUSD: number; entryDebitUSD: number; entryDate?: string };
/** Terminal cashflow is independent of an ambiguous intermediate lot order.
 * Do not assign that final amount to a particular year or partial close. */
export function spreadFinalCashflow(simulation: TradeSimulation): number | undefined {
  const basis = spreadEntryBasis(simulation);
  if (basis.state !== "known" || simulation.status === "assigned" || simulation.stockAcquisition?.enabled) return undefined;
  const closes = activeSpreadCloses(simulation);
  if (new Set(closes.map(close => close.id)).size !== closes.length) return undefined;
  const amounts: number[] = [-basis.value];
  for (const leg of simulation.optionLegs) {
    const events = closes.filter(close => close.legId === leg.id);
    if (events.reduce((sum, close) => sum + close.contracts, 0) !== leg.quantity) return undefined;
    for (const close of events) {
      const price = close.closeKind === "expired" ? 0 : close.closePriceUSD;
      if (!Number.isInteger(close.contracts) || close.contracts <= 0 || close.settlementCurrency !== "USD" || price === undefined || !Number.isFinite(price) || price < 0 || close.commissionUSD === undefined || !Number.isFinite(close.commissionUSD)) return undefined;
      amounts.push(moneyProduct(leg.side === "buy" ? 1 : -1, price, close.contracts, leg.contractSize!), -close.commissionUSD);
    }
  }
  return moneySum(...amounts);
}
/** Only explicit lot allocation, or a single possible lot, can allocate partial
 * cost. Full-leg liquidation can sum all lots without inventing a FIFO order. */
export function spreadCloseMoney(simulation: TradeSimulation, execution: OptionCloseExecution): SpreadCloseMoney | undefined {
  const leg = simulation.optionLegs.find(leg => leg.id === execution.legId);
  if (!leg || !execution.confirmed || execution.voided || simulation.accountCurrency !== "USD" || execution.settlementCurrency !== "USD" || !Number.isInteger(execution.contracts) || execution.contracts <= 0 || execution.contracts > leg.quantity || !Number.isInteger(leg.contractSize) || !(leg.contractSize! > 0)) return undefined;
  const entries = activeSpreadEntries(simulation, leg);
  const closes = activeSpreadCloses(simulation).filter(close => close.legId === leg.id).sort((a, b) => a.closeDate.localeCompare(b.closeDate) || a.id.localeCompare(b.id));
  if (new Set(closes.map(close => close.id)).size !== closes.length || closes.reduce((sum, close) => sum + close.contracts, 0) > leg.quantity || !closes.some(close => close.id === execution.id)) return undefined;
  const allocations = execution.entryAllocations ?? (entries.length === 1 ? [{ entryExecutionId: entries[0].id, contracts: execution.contracts }] : execution.contracts === leg.quantity ? entries.map(entry => ({ entryExecutionId: entry.id, contracts: entry.contracts })) : undefined);
  if (!allocations || new Set(allocations.map(item => item.entryExecutionId)).size !== allocations.length || allocations.reduce((sum, item) => sum + item.contracts, 0) !== execution.contracts) return undefined;
  const premiums: number[] = [], fees: number[] = [], dates: string[] = [];
  for (const allocation of allocations) {
    const entry = entries.find(entry => entry.id === allocation.entryExecutionId);
    if (!entry || entry.settlementCurrency !== "USD" || entry.commissionUSD === undefined || !Number.isFinite(entry.commissionUSD) || !Number.isFinite(entry.fillPriceUSD) || entry.fillPriceUSD < 0) return undefined;
    const priorCloses = closes.slice(0, closes.findIndex(close => close.id === execution.id));
    if (entries.length > 1 && priorCloses.some(close => !close.entryAllocations)) return undefined;
    const prior = priorCloses.reduce((sum, close) => sum + (entries.length === 1 ? close.contracts : close.entryAllocations?.filter(item => item.entryExecutionId === entry.id).reduce((n, item) => n + item.contracts, 0) ?? 0), 0);
    if (!Number.isInteger(allocation.contracts) || allocation.contracts <= 0 || prior + allocation.contracts > entry.contracts) return undefined;
    premiums.push(allocateMoney(moneyProduct(entry.fillPriceUSD, entry.contracts, leg.contractSize!), entry.contracts, prior, allocation.contracts));
    fees.push(allocateMoney(entry.commissionUSD, entry.contracts, prior, allocation.contracts));
    dates.push(entry.tradeDate);
  }
  if (execution.commissionUSD === undefined || !Number.isFinite(execution.commissionUSD)) return undefined;
  const price = execution.closeKind === "expired" ? 0 : execution.closePriceUSD;
  if (price === undefined || !Number.isFinite(price) || price < 0) return undefined;
  const entryPremiumUSD = moneySum(...premiums), openCommissionUSD = moneySum(...fees);
  const closeCostUSD = moneyProduct(price, leg.contractSize!, execution.contracts);
  const realizedPnlUSD = moneySum(leg.side === "buy" ? closeCostUSD - entryPremiumUSD : entryPremiumUSD - closeCostUSD, -openCommissionUSD, -execution.commissionUSD);
  const explicit = execution.realizedPnlUSD;
  // Broker P/L needs scope evidence and must agree with its component cashflows.
  if (explicit !== undefined && execution.realizedPnlSource !== "user_override" && execution.realizedPnlEvidence && (execution.realizedPnlEvidence.contracts !== execution.contracts || !execution.realizedPnlEvidence.entryFeesIncluded || !execution.realizedPnlEvidence.closeFeesIncluded || Math.abs(explicit - realizedPnlUSD) > 0.01)) return undefined;
  return { entryPremiumUSD, closeCostUSD, openCommissionUSD, closeCommissionUSD: execution.commissionUSD,
    realizedPnlUSD: execution.realizedPnlSource === "user_override" && explicit !== undefined ? explicit : realizedPnlUSD,
    entryDebitUSD: moneySum(leg.side === "buy" ? entryPremiumUSD : -entryPremiumUSD, openCommissionUSD),
    entryDate: dates.every(date => date && date === dates[0]) ? dates[0] : undefined };
}
