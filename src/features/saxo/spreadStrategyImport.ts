import type { TradeSimulation } from "@/types/domain";
import type { SaxoApiPositionSnapshot, SaxoHistoryDiscoveryItem } from "./saxoAccountSync";
import { strategyIdentityKey, strategyViewKey, type StrategyCandidate, type StrategyCoverage, type StrategyFill, type StrategyLedger } from "@/domain/strategyLedger";

/** Orders are relationship evidence, never a replacement for a fill ID. */
export type SpreadOrderRelation = { accountKey: string; orderId: string; parentOrderId: string; sourceField: string };
export type SpreadImportSnapshot = { environment: string; requestRevision: number; positions: SaxoApiPositionSnapshot[]; history: SaxoHistoryDiscoveryItem[]; orders: SpreadOrderRelation[]; coverage: StrategyCoverage[] };

export type SpreadImportIssue = { code: "duplicate_positions" | "lifecycle_history" | "opening_identity" | "multiple_opening_lots" | "quantity_mismatch" | "existing_source"; label: string; reason: string };
const instrumentKey = (position: SaxoApiPositionSnapshot) => JSON.stringify([position.accountKey, position.uic]);
const eligible = (position: SaxoApiPositionSnapshot) => position.kind === "option" && position.assetType === "StockOption" && position.optionType === "put" && ["long", "short"].includes(position.side ?? "") && position.accountAssignment === "N" && position.currency === "USD" && Boolean(position.accountKey && position.uic && position.underlyingIdentity && position.expiry) && position.strike !== undefined && position.contractSize !== undefined;
const matchingHistory = (snapshot: SpreadImportSnapshot, position: SaxoApiPositionSnapshot) => snapshot.history.filter(item => item.kind === "trade" && (item.brokerAccountKey ?? item.accountKey) === position.accountKey && item.uic === position.uic);
const fillIdentity = (snapshot: SpreadImportSnapshot, position: SaxoApiPositionSnapshot, trade: SaxoHistoryDiscoveryItem) => trade.tradeId || trade.brokerHistoryId ? strategyIdentityKey({ environment: snapshot.environment, broker: "saxo", accountKey: position.accountKey, kind: trade.tradeId ? "fill" : "history", id: (trade.tradeId ?? trade.brokerHistoryId)! }) : undefined;

/** The initial importer supports one unambiguous open lot per instrument. A
 * current net position is not evidence that all historical openings remain.
 * Until broker lot/close allocation is available, do not infer FIFO or revive
 * closed lots. These guards do not mutate or discard the retrieved records. */
function currentLotIssues(snapshot: SpreadImportSnapshot, simulations: TradeSimulation[] = []): Map<string, SpreadImportIssue> {
  const issues = new Map<string, SpreadImportIssue>();
  for (const position of snapshot.positions.filter(eligible)) {
    const key = instrumentKey(position);
    const history = matchingHistory(snapshot, position);
    const label = `${position.underlyingSymbol ?? position.symbol ?? "オプション"} P${position.strike} / ${position.expiry}`;
    const issue = (code: SpreadImportIssue["code"], reason: string) => issues.set(key, { code, label, reason: `${reason}。今回は新しいスプレッドにまとめません。取得明細と既存記録は保持しています。` });
    if (snapshot.positions.filter(item => instrumentKey(item) === key).length !== 1) { issue("duplicate_positions", "同じ商品の現在建玉が複数行あり、開始約定との数量対応が一意ではありません"); continue; }
    const side = position.side === "long" ? "buy" : "sell";
    if (history.some(item => item.openClose !== "open" || item.buySell !== side || item.duplicateResolution)) { issue("lifecycle_history", "この商品には決済済み・売買方向違い・未照合の履歴があり、現在保有する購入分を確定できません"); continue; }
    const identities = history.map(trade => fillIdentity(snapshot, position, trade));
    if (!history.length || identities.some(identity => !identity)) { issue("opening_identity", "現在保有分に対応する開始約定の識別情報が不足しています"); continue; }
    const unique = new Map<string, SaxoHistoryDiscoveryItem>();
    let conflicting = false;
    history.forEach((trade, index) => {
      const previous = unique.get(identities[index]!);
      if (previous && JSON.stringify([previous.tradeDate, previous.price, previous.quantity, previous.transactionCost, previous.accountCurrency]) !== JSON.stringify([trade.tradeDate, trade.price, trade.quantity, trade.transactionCost, trade.accountCurrency])) conflicting = true;
      unique.set(identities[index]!, trade);
    });
    if (conflicting) { issue("opening_identity", "同じ開始約定に異なる数量・金額があり、正本を一意に確認できません"); continue; }
    if (unique.size !== 1) { issue("multiple_opening_lots", "開始約定が複数に分かれており、どの購入分を組み合わせるか自動では確定できません"); continue; }
    const opened = Math.abs([...unique.values()][0].quantity ?? Number.NaN);
    const current = Math.abs(position.quantity ?? Number.NaN);
    if (!Number.isInteger(opened) || opened <= 0 || !Number.isInteger(current) || current <= 0 || opened !== current) { issue("quantity_mismatch", "開始約定の数量と現在の保有数量が一致しない、または数量を確認できません"); continue; }
    const sources = simulations.filter(simulation => !simulation.strategyGroupId && simulation.accountCode === "N" && simulation.optionLegs.some(leg => leg.saxoAccountKey === position.accountKey && leg.saxoUic === position.uic));
    if (sources.length) {
      const trade = [...unique.values()][0];
      const entries = sources.flatMap(source => (source.optionEntryExecutions ?? []).filter(entry => entry.confirmed && source.optionLegs.some(leg => leg.id === entry.legId && leg.saxoAccountKey === position.accountKey && leg.saxoUic === position.uic)));
      const matches = entries.filter(entry => Boolean(trade.tradeId && entry.saxoFillId === trade.tradeId) || Boolean(trade.brokerHistoryId && entry.historyCandidateIds?.includes(trade.brokerHistoryId)));
      if (sources.length !== 1 || entries.length !== 1 || matches.length !== 1) { issue("existing_source", "同じ商品の既存記録がありますが、取得した開始約定と一対一に照合できません。既存記録を重複して追加することはしません"); continue; }
      const entry = matches[0];
      if (entry.tradeDate !== trade.tradeDate || entry.contracts !== opened || entry.fillPriceUSD !== trade.price || entry.commissionUSD !== trade.transactionCost || entry.settlementCurrency !== "USD") issue("existing_source", "既存の確認済み開始約定と取得明細の日時・数量・金額が一致しません。確認済み記録を上書きすることはしません");
    }
  }
  return issues;
}

/** User-facing diagnostics only for possible new two-leg groups, not every
 * standalone put. Already allocated sources do not demand repeated action. */
export function getSpreadImportIssues(snapshot: SpreadImportSnapshot, ledger?: StrategyLedger, simulations: TradeSimulation[] = []): SpreadImportIssue[] {
  const positions = snapshot.positions.filter(eligible);
  const issues = currentLotIssues(snapshot, simulations);
  const visible = new Map<string, SpreadImportIssue>();
  for (const position of positions) {
    const issue = issues.get(instrumentKey(position));
    if (!issue || !positions.some(other => other.accountKey === position.accountKey && other.underlyingIdentity === position.underlyingIdentity && other.expiry === position.expiry && other.side !== position.side && other.contractSize === position.contractSize && (position.side === "long" ? position.strike! > other.strike! : other.strike! > position.strike!))) continue;
    const opens = matchingHistory(snapshot, position).filter(item => item.openClose === "open");
    if (ledger && opens.length && opens.every(trade => { const key = fillIdentity(snapshot, position, trade); return key && ledger.allocations.filter(allocation => allocation.eventKey === key).reduce((sum, allocation) => sum + allocation.contracts, 0) >= Math.abs(trade.quantity ?? Number.NaN); })) continue;
    visible.set(instrumentKey(position), issue);
  }
  return [...visible.values()];
}

export function reconcileStrategyCandidates(snapshot: SpreadImportSnapshot, ledger: StrategyLedger, simulations: TradeSimulation[]): StrategyCandidate[] {
  const fills: StrategyFill[] = [];
  const unsafe = currentLotIssues(snapshot, simulations);
  for (const position of snapshot.positions) {
    if (!eligible(position) || unsafe.has(instrumentKey(position))) continue;
    if (position.strike === undefined || position.contractSize === undefined || !position.underlyingIdentity || !position.expiry || !position.uic) continue;
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
