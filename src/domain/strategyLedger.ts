import type { OptionEntryExecution, OptionLeg, TradeSimulation } from "@/types/domain";
import { allocateMoney } from "./spreadCashflows";

/** Broker identities are internal, never rendered as labels. Different entity
 * kinds are deliberately distinct even when a provider reuses the same ID. */
export type StrategyIdentity = { environment: string; broker: string; accountKey: string; kind: "fill" | "order" | "parent_order" | "position" | "history"; id: string };
export function strategyIdentityKey(identity: StrategyIdentity): string {
  if (Object.values(identity).some(value => !value.trim())) throw new Error("identity_missing");
  return JSON.stringify([identity.environment, identity.broker, identity.accountKey, identity.kind, identity.id]);
}
/** Opaque view key only. Economic identity remains the complete scoped key;
 * commits check references as well, so a view-key collision cannot coalesce fills. */
export function strategyViewKey(value: string): string {
  const hash = (seed: bigint) => { let result = seed; for (const char of value) result = BigInt.asUintN(64, (result ^ BigInt(char.codePointAt(0)!)) * 1099511628211n); return result.toString(16).padStart(16, "0"); };
  return `spread-${hash(14695981039346656037n)}${hash(7809847782465536322n)}`;
}
export type StrategyFill = {
  key: string; revision: string; aliases: string[];
  identity: StrategyIdentity;
  contract: { underlying: string; instrument: string; ticker: string; optionType: "put"; side: "buy" | "sell"; strike: number; expiry: string; multiplier: number; currency: "USD"; settlement: string; deliverable: string; underlyingCategory?: string; specificationSource?: string };
  brokerPositionId?: string;
  /** A previously saved execution stays at its canonical location. */
  existing?: { simulationId: string; executionId: string; legId: string };
  execution?: OptionEntryExecution;
  parentOrderKey?: string; legOrderKey?: string; positionKey?: string;
  voided?: boolean; supersedesKey?: string;
};
export type StrategyAllocation = { strategyId: string; legId: string; eventKey: string; revision: string; contracts: number };
export type StrategyLedger = { schema: 1; revision: number; fills: StrategyFill[]; allocations: StrategyAllocation[]; commits: string[] };
export const emptyStrategyLedger = (): StrategyLedger => ({ schema: 1, revision: 0, fills: [], allocations: [], commits: [] });
export type StrategyCoverage = { source: string; requestedFrom?: string; requestedTo?: string; completedPages: number; asOf: string; status: "complete" | "partial" | "failed" | "pending" };
export type StrategyCandidate = { id: string; fills: [StrategyFill, StrategyFill]; contracts: number; grouping: "broker_link" | "user_confirmation"; coverage: StrategyCoverage[]; requestRevision: number };
export type PreparedStrategyImport = { candidate: StrategyCandidate; ledgerRevision: number; sourceFingerprint: string };
export function strategyContractState(candidate: StrategyCandidate): "verified" | "unknown" | "incompatible" {
  const [a, b] = candidate.fills.map(fill => fill.contract);
  if ([a, b].some(contract => contract.underlyingCategory === "Basket") || (a.settlement && b.settlement && a.settlement !== b.settlement) || (a.deliverable && b.deliverable && a.deliverable !== b.deliverable)) return "incompatible";
  return a.settlement && b.settlement && a.deliverable && b.deliverable ? "verified" : "unknown";
}

export function resolveStrategyFillExecution(fill: StrategyFill, simulations: TradeSimulation[]): OptionEntryExecution | undefined {
  if (!fill.existing) return fill.execution;
  return simulations.find(simulation => simulation.id === fill.existing!.simulationId)?.optionEntryExecutions?.find(execution => execution.id === fill.existing!.executionId && execution.legId === fill.existing!.legId);
}
export function validateStrategyCandidate(candidate: StrategyCandidate, ledger: StrategyLedger, simulations: TradeSimulation[]): string[] {
  const reasons: string[] = [];
  const [buy, sell] = candidate.fills;
  if (!candidate.coverage.length || candidate.coverage.some(source => source.status !== "complete" || source.completedPages < 1 || !source.asOf)) reasons.push("今回の取得は未完了。注文・開始約定・現在建玉の取得を完了してください");
  const a = buy.contract, b = sell.contract;
  if (buy.key === sell.key || buy.identity.accountKey !== sell.identity.accountKey || buy.identity.environment !== sell.identity.environment || buy.identity.broker !== sell.identity.broker) reasons.push("口座・約定の同一性が不適合です");
  if (!a.underlying || a.underlying !== b.underlying || a.instrument === b.instrument || a.optionType !== "put" || b.optionType !== "put" || a.side !== "buy" || b.side !== "sell" || !(a.strike > b.strike) || !a.expiry || a.expiry !== b.expiry || a.currency !== b.currency || a.currency !== "USD" || strategyContractState(candidate) === "incompatible" || a.multiplier !== b.multiplier || !Number.isInteger(a.multiplier) || a.multiplier <= 0) reasons.push("原資産・契約・方向・満期・倍率・決済仕様が不適合です");
  if (!Number.isInteger(candidate.contracts) || candidate.contracts <= 0) reasons.push("正の整数組数を確認してください");
  for (const fill of candidate.fills) {
    const execution = resolveStrategyFillExecution(fill, simulations);
    if (fill.existing) {
      const source = simulations.find(simulation => simulation.id === fill.existing!.simulationId);
      if (!source || source.optionLegs.length !== 1 || source.optionCloseExecutions?.some(close => close.confirmed)) reasons.push("既存複合建玉または決済済みロットの割当確認が必要です");
    }
    if (!execution?.confirmed || !Number.isInteger(execution.contracts) || execution.contracts <= 0 || execution.settlementCurrency !== "USD" || !execution.tradeDate || !Number.isFinite(execution.fillPriceUSD) || execution.fillPriceUSD < 0 || execution.commissionUSD === undefined || !Number.isFinite(execution.commissionUSD) || fill.voided) { reasons.push("開始約定日・数量・価格・実費の明示証拠を確認してください"); continue; }
    const existing = ledger.fills.find(item => item.key === fill.key || item.aliases.includes(fill.key) || fill.aliases.includes(item.key));
    if (existing && (existing.revision !== fill.revision || JSON.stringify(existing.contract) !== JSON.stringify(fill.contract))) reasons.push("既存証拠との訂正差分があります。新しい取得日時だけでは上書きしません");
    const used = ledger.allocations.filter(item => item.eventKey === (existing?.key ?? fill.key)).reduce((sum, item) => sum + item.contracts, 0);
    if (used + candidate.contracts > execution.contracts) reasons.push("未割当数量が不足しています");
  }
  return [...new Set(reasons)];
}
export function prepareStrategyImport(candidate: StrategyCandidate, ledger: StrategyLedger, simulations: TradeSimulation[]): PreparedStrategyImport | { reasons: string[] } {
  const reasons = validateStrategyCandidate(candidate, ledger, simulations);
  return reasons.length ? { reasons } : { candidate, ledgerRevision: ledger.revision, sourceFingerprint: JSON.stringify(candidate.fills.map(fill => resolveStrategyFillExecution(fill, simulations))) };
}
export function commitStrategyImport(prepared: PreparedStrategyImport, ledger: StrategyLedger, simulations: TradeSimulation[], latestRequestRevision: number): { ledger: StrategyLedger; strategyId: string; changed: boolean } | { reasons: string[] } {
  const candidate = prepared.candidate;
  if (ledger.commits.includes(candidate.id)) {
    const prior = ledger.allocations.filter(allocation => allocation.strategyId === candidate.id);
    return prior.length === 2 && candidate.fills.every(fill => prior.some(allocation => allocation.eventKey === fill.key && allocation.contracts === candidate.contracts && allocation.revision === fill.revision))
      ? { ledger, strategyId: candidate.id, changed: false } : { reasons: ["戦略参照が競合しています。既存割当は変更しません"] };
  }
  if (prepared.ledgerRevision !== ledger.revision || candidate.requestRevision !== latestRequestRevision || prepared.sourceFingerprint !== JSON.stringify(candidate.fills.map(fill => resolveStrategyFillExecution(fill, simulations)))) return { reasons: ["取得または保存状態が更新されました。組み合わせを再確認してください"] };
  const reasons = validateStrategyCandidate(candidate, ledger, simulations);
  if (reasons.length) return { reasons };
  const fills = [...ledger.fills];
  const allocations = [...ledger.allocations];
  candidate.fills.forEach((fill, index) => {
    const existing = fills.find(item => item.key === fill.key || item.aliases.includes(fill.key) || fill.aliases.includes(item.key));
    if (!existing) fills.push(fill);
    allocations.push({ strategyId: candidate.id, legId: `${candidate.id}:leg:${index}`, eventKey: existing?.key ?? fill.key, revision: fill.revision, contracts: candidate.contracts });
  });
  return { ledger: { schema: 1, revision: ledger.revision + 1, fills, allocations, commits: [...ledger.commits, candidate.id] }, strategyId: candidate.id, changed: true };
}

/** Runtime projection only: allocated executions are references to one source,
 * not a second persisted economic event. Never serialize these projected copies. */
export function materializeStrategyEntries(strategyId: string, ledger: StrategyLedger, simulations: TradeSimulation[]): { legs: OptionLeg[]; entries: OptionEntryExecution[] } {
  const allocations = ledger.allocations.filter(item => item.strategyId === strategyId);
  const legs: OptionLeg[] = [], entries: OptionEntryExecution[] = [];
  for (const allocation of allocations) {
    const fill = ledger.fills.find(item => item.key === allocation.eventKey && item.revision === allocation.revision && !item.voided);
    const source = fill && resolveStrategyFillExecution(fill, simulations);
    if (!fill || !source) continue;
    const prior = ledger.allocations.slice(0, ledger.allocations.indexOf(allocation)).filter(item => item.eventKey === allocation.eventKey).reduce((sum, item) => sum + item.contracts, 0);
    const c = fill.contract;
    legs.push({ id: allocation.legId, type: "put", side: c.side, strikeUSD: c.strike, premiumUSD: source.fillPriceUSD, quantity: allocation.contracts, contractSize: c.multiplier, expiryDate: c.expiry, saxoAccountKey: fill.identity.accountKey,
      saxoUic: /^\d+$/.test(c.instrument) ? Number(c.instrument) : undefined, saxoPositionId: fill.brokerPositionId });
    entries.push({ ...source, id: fill.key, legId: allocation.legId, contracts: allocation.contracts, commissionUSD: source.commissionUSD === undefined ? undefined : allocateMoney(source.commissionUSD, source.contracts, prior, allocation.contracts) });
  }
  return { legs, entries };
}

/** Display-only remainder of canonical standalone lots. Economic records and
 * their IDs remain intact in simulationsByWorkspace and the storage envelope. */
export function projectStrategyWorkspace(simulations: TradeSimulation[], ledger: StrategyLedger): TradeSimulation[] {
  return simulations.flatMap(simulation => {
    if (simulation.strategyGroupId) return [simulation];
    const references = ledger.fills.filter(fill => fill.existing?.simulationId === simulation.id);
    if (!references.length) return [simulation];
    const entries = (simulation.optionEntryExecutions ?? []).flatMap(entry => {
      const source = references.find(fill => fill.existing!.executionId === entry.id);
      if (!source) return [entry];
      const used = ledger.allocations.filter(allocation => allocation.eventKey === source.key).reduce((sum, allocation) => sum + allocation.contracts, 0);
      if (!used) return [entry];
      const remaining = entry.contracts - used;
      if (remaining <= 0) return [];
      return [{ ...entry, contracts: remaining, commissionUSD: entry.commissionUSD === undefined ? undefined : allocateMoney(entry.commissionUSD, entry.contracts, used, remaining) }];
    });
    const legs = simulation.optionLegs.flatMap(leg => {
      if (!references.some(fill => fill.existing!.legId === leg.id)) return [leg];
      const remaining = entries.filter(entry => entry.legId === leg.id && entry.confirmed).reduce((sum, entry) => sum + entry.contracts, 0);
      return remaining > 0 ? [{ ...leg, quantity: remaining }] : [];
    });
    return legs.length ? [{ ...simulation, optionLegs: legs, optionEntryExecutions: entries }] : [];
  });
}

/** Current-price batches operate on view rows. Restore hidden source records
 * and canonical quantities before saving, rather than persisting the projection. */
export function mergeStrategyViewUpdates(originals: TradeSimulation[], updates: TradeSimulation[], ledger: StrategyLedger): TradeSimulation[] {
  const sourceIds = new Set(ledger.fills.flatMap(fill => fill.existing ? [fill.existing.simulationId] : []));
  const merged = updates.map(update => {
    const original = originals.find(item => item.id === update.id);
    if (!original || !sourceIds.has(update.id)) return update;
    return { ...update, optionEntryExecutions: original.optionEntryExecutions, optionLegs: original.optionLegs.map(leg => ({ ...leg, ...update.optionLegs.find(item => item.id === leg.id), quantity: leg.quantity, premiumUSD: leg.premiumUSD })) };
  });
  return [...merged, ...originals.filter(original => sourceIds.has(original.id) && !merged.some(item => item.id === original.id))];
}
