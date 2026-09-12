import type { TradeSimulation } from "@/types/domain";
import type { SaxoApiPositionSnapshot, SaxoHistoryDiscoveryItem } from "./saxoAccountSync";
import { strategyIdentityKey, strategyViewKey, type StrategyCandidate, type StrategyCoverage, type StrategyFill, type StrategyLedger } from "@/domain/strategyLedger";

/** Orders are relationship evidence, never a replacement for a fill ID. */
export type SpreadOrderRelation = { accountKey: string; orderId: string; parentOrderId: string; sourceField: string };
export type SpreadImportSnapshot = { environment: string; requestRevision: number; positions: SaxoApiPositionSnapshot[]; history: SaxoHistoryDiscoveryItem[]; orders: SpreadOrderRelation[]; coverage: StrategyCoverage[] };

export function reconcileStrategyCandidates(snapshot: SpreadImportSnapshot, ledger: StrategyLedger, simulations: TradeSimulation[]): StrategyCandidate[] {
  const fills: StrategyFill[] = [];
  for (const position of snapshot.positions) {
    if (position.kind !== "option" || position.assetType !== "StockOption" || position.optionType !== "put" || !["long", "short"].includes(position.side ?? "") || position.accountAssignment !== "N" || position.currency !== "USD" || !position.accountKey || !position.uic || !position.underlyingIdentity || !position.expiry || position.strike === undefined || position.contractSize === undefined) continue;
    const side = position.side === "long" ? "buy" : "sell";
    const trades = snapshot.history.filter(item => item.kind === "trade" && item.openClose === "open" && item.buySell === side && (item.brokerAccountKey ?? item.accountKey) === position.accountKey && item.uic === position.uic && item.optionType === "put" && item.strike === position.strike && item.expiry === position.expiry && item.accountCurrency === "USD" && !item.duplicateResolution);
    for (const trade of trades) {
      if (!(trade.tradeId || trade.brokerHistoryId) || !trade.tradeDate || trade.price === undefined || !Number.isFinite(trade.price) || trade.quantity === undefined || !Number.isInteger(Math.abs(trade.quantity)) || Math.abs(trade.quantity) <= 0) continue;
      const identity = { environment: snapshot.environment, broker: "saxo", accountKey: position.accountKey, kind: trade.tradeId ? "fill" as const : "history" as const, id: (trade.tradeId ?? trade.brokerHistoryId)! };
      const key = strategyIdentityKey(identity);
      if (fills.some(fill => fill.key === key)) continue;
      const existing = simulations.filter(simulation => !simulation.strategyGroupId).flatMap(simulation => (simulation.optionEntryExecutions ?? []).filter(entry => entry.confirmed && (entry.saxoFillId === trade.tradeId && Boolean(trade.tradeId) || Boolean(trade.brokerHistoryId && entry.historyCandidateIds?.includes(trade.brokerHistoryId))) && simulation.accountCode === "N" && simulation.optionLegs.some(leg => leg.id === entry.legId && leg.saxoAccountKey === position.accountKey && leg.saxoUic === position.uic)).map(entry => ({ simulationId: simulation.id, executionId: entry.id, legId: entry.legId })));
      if (existing.length > 1) continue;
      const order = snapshot.orders.find(order => order.accountKey === position.accountKey && order.orderId === trade.orderId);
      const parentOrderId = order?.parentOrderId ?? position.multiLegOrderId;
      const idKey = (kind: "parent_order" | "order" | "position", id: string) => strategyIdentityKey({ ...identity, kind, id });
      fills.push({ key, identity, revision: JSON.stringify([trade.tradeDate, trade.price, trade.quantity, trade.transactionCost, trade.accountCurrency]), aliases: [],
        contract: { underlying: position.underlyingIdentity, instrument: String(position.uic), ticker: position.underlyingSymbol ?? position.symbol ?? "", optionType: "put", side, strike: position.strike, expiry: position.expiry, multiplier: position.contractSize, currency: "USD", settlement: position.settlementType ?? "", deliverable: position.deliverableIdentity ?? "", underlyingCategory: position.underlyingTypeCategory, specificationSource: position.contractSpecificationSource },
        brokerPositionId: position.positionId,
        existing: existing[0],
        execution: existing.length ? undefined : { id: key, legId: String(position.uic), saxoFillId: trade.tradeId, historyCandidateIds: [identity.id], tradeDate: trade.tradeDate, contracts: Math.abs(trade.quantity), fillPriceUSD: trade.price, commissionUSD: trade.transactionCost, commissionSource: trade.transactionCost === undefined ? undefined : "saxo_actual", settlementCurrency: "USD", source: "broker_statement", confirmed: true },
        parentOrderKey: parentOrderId ? idKey("parent_order", parentOrderId) : undefined,
        legOrderKey: trade.orderId ? idKey("order", trade.orderId) : undefined,
        positionKey: position.positionId ? idKey("position", position.positionId) : undefined });
    }
  }
  const candidates: StrategyCandidate[] = [];
  for (const buy of fills.filter(fill => fill.contract.side === "buy")) for (const sell of fills.filter(fill => fill.contract.side === "sell")) {
    const a = buy.contract, b = sell.contract;
    if (buy.identity.accountKey !== sell.identity.accountKey || a.underlying !== b.underlying || a.expiry !== b.expiry || a.multiplier !== b.multiplier || a.currency !== b.currency || a.settlement && b.settlement && a.settlement !== b.settlement || a.deliverable && b.deliverable && a.deliverable !== b.deliverable || !(a.strike > b.strike)) continue;
    const executionFor = (fill: StrategyFill) => fill.existing ? simulations.find(simulation => simulation.id === fill.existing!.simulationId)?.optionEntryExecutions?.find(entry => entry.id === fill.existing!.executionId) : fill.execution;
    const available = [buy, sell].map(fill => (executionFor(fill)?.contracts ?? 0) - ledger.allocations.filter(allocation => allocation.eventKey === fill.key).reduce((sum, allocation) => sum + allocation.contracts, 0));
    if (!available.every(quantity => Number.isInteger(quantity) && quantity > 0)) continue;
    const contracts = Math.min(...available);
    const id = strategyViewKey(JSON.stringify([buy.key, sell.key, available]));
    candidates.push({ id, fills: [buy, sell], contracts, grouping: buy.parentOrderKey && buy.parentOrderKey === sell.parentOrderKey && buy.legOrderKey && sell.legOrderKey ? "broker_link" : "user_confirmation", coverage: snapshot.coverage, requestRevision: snapshot.requestRevision });
  }
  return candidates;
}
