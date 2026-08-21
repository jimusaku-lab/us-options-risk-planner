import type { OptionLeg, StockSettlement, TradeSimulation, WheelCycle, WheelEvent, WheelPhase } from "@/types/domain";
import { calculateOptionCloseExecutionResults } from "@/domain/optionCloseExecutions";

export const WHEEL_RECONCILIATION_VERSION = 2;

export type WheelReconciliationResult = {
  cycles: WheelCycle[];
  events: WheelEvent[];
  changed: boolean;
  unresolvedEventIds: string[];
  version: number;
};

export type WheelPutRelation = {
  simulation: TradeSimulation;
  leg: OptionLeg;
  simulationId: string;
  legId: string;
};

export function normalizeWheelTicker(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function isNAccount(simulation: TradeSimulation): boolean {
  return simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" || simulation.accountCode === "N";
}

function isPotentialWheelPutSimulation(simulation: TradeSimulation): boolean {
  return isNAccount(simulation) &&
    (simulation.strategyType === "short_put" || simulation.strategyType === "synthetic_forward") &&
    simulation.optionLegs.some((leg) => leg.type === "put" && leg.side === "sell");
}

export function resolveWheelPutRelation(simulation: TradeSimulation): WheelPutRelation | undefined {
  if (!isPotentialWheelPutSimulation(simulation)) return undefined;
  const accepted = simulation.optionLegs.filter(
    (leg) => leg.type === "put" && leg.side === "sell" && leg.assignmentPolicy === "accept",
  );
  if (accepted.length !== 1) return undefined;
  return { simulation, leg: accepted[0], simulationId: simulation.id, legId: accepted[0].id };
}

export function isNShortPutWheelSimulation(simulation: TradeSimulation): boolean {
  return resolveWheelPutRelation(simulation) !== undefined;
}

export function isOpenNShortPutWheelSimulation(simulation: TradeSimulation): boolean {
  const relation = resolveWheelPutRelation(simulation);
  if (!relation || simulation.status !== "open" || !hasConfirmedFullEntry(relation)) return false;
  const terminal = resolveConfirmedNShortPutTerminal(simulation);
  return terminal.kind === "none" || terminal.kind === "partial";
}

export type ConfirmedNShortPutTerminal =
  | { kind: "none" | "partial" | "invalid" }
  | { kind: "closed"; legId: string; closeDate: string; closeFeeUSD?: number; realizedPnlUSD?: number; terminalStatus: "closed" | "expired" }
  | { kind: "assigned"; legId: string; acquisitionDate: string; shares: number; acquisitionFeeUSD?: number };

export function resolveConfirmedNShortPutTerminal(simulation: TradeSimulation): ConfirmedNShortPutTerminal {
  const relation = resolveWheelPutRelation(simulation);
  if (!relation) return { kind: "none" };
  const acquisition = simulation.stockAcquisition;
  if (acquisition?.enabled && acquisition.confirmationStatus === "confirmed" &&
      Number.isFinite(acquisition.shares) && acquisition.shares > 0 && acquisition.acquisitionDate) {
    return { kind: "assigned", legId: relation.legId, acquisitionDate: acquisition.acquisitionDate,
      shares: acquisition.shares, acquisitionFeeUSD: finiteNumber(acquisition.commissionUSD) };
  }

  const confirmed = (simulation.optionCloseExecutions ?? []).filter(
    (execution) => execution.confirmed && execution.legId === relation.legId,
  );
  const closedContracts = confirmed.reduce(
    (sum, execution) => sum + (Number.isFinite(execution.contracts) ? execution.contracts : 0), 0,
  );
  if (closedContracts > relation.leg.quantity) return { kind: "invalid" };
  if (closedContracts > 0 && closedContracts < relation.leg.quantity) return { kind: "partial" };
  if (closedContracts !== relation.leg.quantity || confirmed.length === 0) return { kind: "none" };
  const closeDate = confirmed.map((execution) => execution.closeDate).filter(Boolean).sort().at(-1);
  if (!closeDate) return { kind: "invalid" };
  const allFeesKnown = confirmed.every((execution) => finiteNumber(execution.commissionUSD) !== undefined);
  const results = new Map(calculateOptionCloseExecutionResults(simulation)
    .filter((result) => result.execution.confirmed && result.execution.legId === relation.legId)
    .map((result) => [result.execution.id, result]));
  const realizedValues = confirmed.map((execution) => finiteNumber(results.get(execution.id)?.realizedPnlUSD))
    .filter((value): value is number => value !== undefined);
  return {
    kind: "closed",
    legId: relation.legId,
    closeDate,
    closeFeeUSD: allFeesKnown ? confirmed.reduce((sum, execution) => sum + Math.abs(execution.commissionUSD as number), 0) : undefined,
    realizedPnlUSD: realizedValues.length === confirmed.length ? realizedValues.reduce((sum, value) => sum + value, 0) : undefined,
    terminalStatus: confirmed.every((execution) => execution.closeKind === "expired") ? "expired" : "closed",
  };
}

export function reconcileWheelDerivedState(params: {
  cycles: WheelCycle[];
  events: WheelEvent[];
  simulations: TradeSimulation[];
  workspace: "demo" | "live";
}): WheelReconciliationResult {
  const originalCycles = params.cycles;
  const originalEvents = params.events;
  const simulationsById = new Map(params.simulations.map((simulation) => [simulation.id, simulation]));
  const relations = params.simulations.map(resolveWheelPutRelation)
    .filter((item): item is WheelPutRelation => Boolean(item))
    .filter(hasConfirmedWheelEvidence);
  let cycles = originalCycles.map((cycle) => ({ ...cycle, eventIds: [...cycle.eventIds], linkedSimulationIds: [...cycle.linkedSimulationIds] }));
  let events = originalEvents.map((event) => ({ ...event }));
  const unresolvedEventIds = new Set<string>();
  const managedCycleIds = new Set(cycles.filter((cycle) => cycle.reconciliationVersion !== undefined).map((cycle) => cycle.id));

  events = events.filter((event) => {
    if (!event.linkedSimulationId || event.type === "manual_adjustment") return true;
    const simulation = simulationsById.get(event.linkedSimulationId);
    if (!simulation || !isPotentialWheelPutSimulation(simulation)) return true;
    const relation = resolveWheelPutRelation(simulation);
    if (relation && hasConfirmedWheelEvidence(relation)) return true;
    return !isRemovableAutomaticOpenEvent(event, simulation);
  });

  const ensureCycle = (relation: WheelPutRelation): WheelCycle | undefined => {
    const ticker = normalizeWheelTicker(relation.simulation.ticker);
    if (!ticker) return undefined;
    const linked = cycles.filter(
      (cycle) => cycle.linkedSimulationIds.includes(relation.simulationId) && normalizeWheelTicker(cycle.ticker) === ticker,
    );
    if (linked.length === 1) return linked[0];
    if (linked.length > 1) return undefined;
    const created: WheelCycle = {
      id: `wheel-${params.workspace}-${relation.simulationId}-${relation.legId}`, ticker, primaryAccountCode: "N", currentPhase: "n_cash",
      currentAccountCode: "N", currentShares: 0, averageCostUSD: 0, usdCashImpact: 0,
      cumulativePremiumUSD: 0, cumulativeStockRealizedPnlUSD: 0, cumulativeFeesUSD: 0, cumulativeTotalPnlUSD: 0,
      referenceFxRateJPY: relation.simulation.referenceFxRateJPY ?? relation.simulation.fxRateJPY,
      eventIds: [], linkedSimulationIds: [], openedAt: relation.simulation.entryDate,
      reconciliationVersion: WHEEL_RECONCILIATION_VERSION,
    };
    cycles.push(created);
    managedCycleIds.add(created.id);
    return created;
  };

  for (const event of events) {
    if (!event.linkedSimulationId || event.type === "manual_adjustment") continue;
    const simulation = simulationsById.get(event.linkedSimulationId);
    const relation = simulation ? resolveWheelPutRelation(simulation) : undefined;
    if (!relation) continue;
    if (event.linkedOptionLegId && event.linkedOptionLegId !== relation.legId) {
      unresolvedEventIds.add(event.id);
      continue;
    }
    const target = ensureCycle(relation);
    if (!target) { unresolvedEventIds.add(event.id); continue; }
    event.wheelCycleId = target.id;
    if (isWheelPutEvent(event)) event.linkedOptionLegId = relation.legId;
  }

  for (const relation of relations) {
    const ticker = normalizeWheelTicker(relation.simulation.ticker);
    if (!ticker) continue;
    const target = ensureCycle(relation);
    if (!target) continue;
    for (const cycle of cycles) {
      cycle.linkedSimulationIds = cycle.linkedSimulationIds.filter((id) => id !== relation.simulationId || cycle.id === target.id);
    }
    if (!target.linkedSimulationIds.includes(relation.simulationId)) target.linkedSimulationIds.push(relation.simulationId);

    const entries = getConfirmedPutEntries(relation);
    if (hasConfirmedFullEntry(relation)) ensureEvent(events, {
      id: `wheel-event-short-put-opened-${relation.simulationId}-${relation.legId}`,
      wheelCycleId: target.id, type: "short_put_opened",
      occurredAt: entries.map((execution) => execution.tradeDate).filter(Boolean).sort()[0] ?? relation.simulation.entryDate,
      accountCode: "N", description: `${ticker} N口座プット売りを建玉開始`,
      feeUSD: sumKnownFees(entries.map((execution) => execution.commissionUSD)), phaseAfter: "n_short_put",
      linkedSimulationId: relation.simulationId, linkedOptionLegId: relation.legId, derivationSource: "wheel_reconciliation",
    });

    const terminal = resolveConfirmedNShortPutTerminal(relation.simulation);
    if (terminal.kind === "closed") ensureEvent(events, {
      id: `wheel-event-short-put-closed-${relation.simulationId}-${relation.legId}`,
      wheelCycleId: target.id, type: "short_put_closed", occurredAt: terminal.closeDate, accountCode: "N",
      description: `${ticker} N口座プット売りを決済`, feeUSD: terminal.closeFeeUSD, usdPnl: terminal.realizedPnlUSD,
      phaseAfter: "n_cash", linkedSimulationId: relation.simulationId, linkedOptionLegId: relation.legId,
      derivationSource: "wheel_reconciliation",
    });
    else if (terminal.kind === "assigned") ensureEvent(events, {
      id: `wheel-event-put-assigned-${relation.simulationId}-${relation.legId}`,
      wheelCycleId: target.id, type: "put_assigned", occurredAt: terminal.acquisitionDate, accountCode: "N",
      description: `${ticker} N口座プット割当で株式取得`, feeUSD: terminal.acquisitionFeeUSD,
      sharesChange: terminal.shares, phaseAfter: "n_stock_holding", linkedSimulationId: relation.simulationId,
      linkedOptionLegId: relation.legId, derivationSource: "wheel_reconciliation",
    });
  }

  for (const cycle of cycles) {
    const ticker = normalizeWheelTicker(cycle.ticker);
    cycle.ticker = ticker || cycle.ticker;
    const preservedLinkedIds = new Set(events.filter((event) => event.wheelCycleId === cycle.id && event.linkedSimulationId)
      .map((event) => event.linkedSimulationId as string));
    cycle.linkedSimulationIds = unique(cycle.linkedSimulationIds.filter((id) => {
      const simulation = simulationsById.get(id);
      if (!simulation || !isPotentialWheelPutSimulation(simulation)) return true;
      const relation = resolveWheelPutRelation(simulation);
      if (!relation) return preservedLinkedIds.has(id);
      return ticker !== "" && normalizeWheelTicker(simulation.ticker) === ticker;
    })).sort();
    cycle.eventIds = unique(events.filter((event) => event.wheelCycleId === cycle.id).map((event) => event.id)).sort();
    const linked = cycle.linkedSimulationIds.map((id) => simulationsById.get(id)).filter((item): item is TradeSimulation => Boolean(item));
    const linkedRelations = linked.map(resolveWheelPutRelation).filter((item): item is WheelPutRelation => Boolean(item));
    const cycleEvents = events.filter((event) => event.wheelCycleId === cycle.id);
    const phase = resolveCyclePhase(cycle, cycleEvents, linkedRelations, simulationsById);
    const assigned = linkedRelations.map((relation) => resolveConfirmedNShortPutTerminal(relation.simulation)).find((item) => item.kind === "assigned");
    const totals = calculateCanonicalWheelAggregates(linked, cycleEvents);
    Object.assign(cycle, {
      currentPhase: phase,
      currentAccountCode: phase.startsWith("n_") ? "N" : cycle.currentAccountCode,
      currentShares: phase === "n_stock_holding" && assigned?.kind === "assigned" ? assigned.shares : phase === "n_short_put" || phase === "n_cash" ? 0 : cycle.currentShares,
      cumulativePremiumUSD: totals.premiumUSD, cumulativeFeesUSD: totals.feesUSD,
      cumulativeStockRealizedPnlUSD: totals.stockRealizedPnlUSD, cumulativeTotalPnlUSD: totals.realizedPnlUSD,
      reconciliationVersion: WHEEL_RECONCILIATION_VERSION,
    });
  }

  cycles = cycles.filter((cycle) => cycle.eventIds.length > 0 || cycle.linkedSimulationIds.length > 0 || !managedCycleIds.has(cycle.id));
  const orderedEvents = events.sort(compareWheelEvents);
  return { cycles, events: orderedEvents,
    changed: JSON.stringify(cycles) !== JSON.stringify(originalCycles) || JSON.stringify(orderedEvents) !== JSON.stringify(originalEvents),
    unresolvedEventIds: [...unresolvedEventIds], version: WHEEL_RECONCILIATION_VERSION };
}

function resolveCyclePhase(
  cycle: WheelCycle,
  events: WheelEvent[],
  relations: WheelPutRelation[],
  simulationsById: Map<string, TradeSimulation>,
): WheelPhase {
  if (relations.some((relation) => isOpenNShortPutWheelSimulation(relation.simulation))) return "n_short_put";
  if (relations.some((relation) => resolveConfirmedNShortPutTerminal(relation.simulation).kind === "assigned")) return "n_stock_holding";
  const activeIds = new Set(relations.filter((relation) => isOpenNShortPutWheelSimulation(relation.simulation)).map((relation) => relation.simulationId));
  const latest = events.filter((event) => {
    if (event.type !== "short_put_opened" || !event.linkedSimulationId) return true;
    const simulation = simulationsById.get(event.linkedSimulationId);
    return !simulation || !isPotentialWheelPutSimulation(simulation) || activeIds.has(event.linkedSimulationId);
  }).sort(compareWheelEvents)[0];
  if (latest) return latest.phaseAfter;
  return cycle.currentPhase === "n_short_put" ? "n_cash" : cycle.currentPhase;
}

function getConfirmedPutEntries(relation: WheelPutRelation) {
  return (relation.simulation.optionEntryExecutions ?? []).filter(
    (execution) => execution.confirmed && execution.legId === relation.legId,
  );
}

function hasConfirmedFullEntry(relation: WheelPutRelation): boolean {
  const entries = getConfirmedPutEntries(relation);
  const contracts = entries.reduce((sum, execution) => sum + (Number.isFinite(execution.contracts) ? execution.contracts : 0), 0);
  return entries.length > 0 && contracts === relation.leg.quantity;
}

function hasConfirmedWheelEvidence(relation: WheelPutRelation): boolean {
  if (hasConfirmedFullEntry(relation)) return true;
  const terminal = resolveConfirmedNShortPutTerminal(relation.simulation);
  return terminal.kind === "closed" || terminal.kind === "assigned";
}

function calculateCanonicalWheelAggregates(simulations: TradeSimulation[], events: WheelEvent[]) {
  let premiumUSD = 0, feesUSD = 0, stockRealizedPnlUSD = 0, optionRealizedPnlUSD = 0;
  for (const simulation of simulations) {
    const relation = resolveWheelPutRelation(simulation);
    const historicalPutLegIds = getHistoricalWheelPutLegIds(simulation, events);
    const optionLegIds = relation ? new Set([relation.legId]) : historicalPutLegIds.size > 0 ? historicalPutLegIds : new Set(
      simulation.strategyType === "covered_call" ? simulation.optionLegs.filter((leg) => leg.type === "call" && leg.side === "sell").map((leg) => leg.id) : [],
    );
    for (const execution of simulation.optionEntryExecutions ?? []) {
      if (!execution.confirmed || !optionLegIds.has(execution.legId)) continue;
      const leg = simulation.optionLegs.find((item) => item.id === execution.legId);
      if (leg?.side === "sell" && Number.isFinite(execution.fillPriceUSD) && execution.fillPriceUSD > 0 &&
          Number.isFinite(execution.contracts) && execution.contracts > 0) {
        premiumUSD += execution.fillPriceUSD * execution.contracts * 100;
      }
      const fee = finiteNumber(execution.commissionUSD); if (fee !== undefined) feesUSD += Math.abs(fee);
    }
    for (const execution of simulation.optionCloseExecutions ?? []) {
      if (!execution.confirmed || !optionLegIds.has(execution.legId)) continue;
      const fee = finiteNumber(execution.commissionUSD); if (fee !== undefined) feesUSD += Math.abs(fee);
    }
    for (const result of calculateOptionCloseExecutionResults(simulation)) {
      if (result.execution.confirmed && optionLegIds.has(result.execution.legId) && Number.isFinite(result.realizedPnlUSD)) {
        optionRealizedPnlUSD += result.realizedPnlUSD;
      }
    }
    if (relation) {
      const acquisition = simulation.stockAcquisition;
      if (acquisition?.enabled && acquisition.confirmationStatus === "confirmed") {
        const fee = finiteNumber(acquisition.commissionUSD); if (fee !== undefined) feesUSD += Math.abs(fee);
      }
    }
    const settlement = simulation.stockSettlement;
    if (isConfirmedStockSettlement(settlement)) {
      const fee = finiteNumber(settlement.commissionUSD); if (fee !== undefined) feesUSD += Math.abs(fee);
      stockRealizedPnlUSD += (settlement.sellPriceUSD - settlement.costBasisUSD) * settlement.shares - Math.abs(fee ?? 0);
    }
  }
  return { premiumUSD, feesUSD, stockRealizedPnlUSD, realizedPnlUSD: optionRealizedPnlUSD + stockRealizedPnlUSD };
}

function getHistoricalWheelPutLegIds(simulation: TradeSimulation, events: WheelEvent[]): Set<string> {
  if (!isPotentialWheelPutSimulation(simulation) || simulation.status === "open") return new Set();
  const terminalEvents = events.filter((event) => event.linkedSimulationId === simulation.id &&
    (event.type === "short_put_closed" || event.type === "put_assigned"));
  if (terminalEvents.length === 0) return new Set();
  const explicit = unique(terminalEvents.map((event) => event.linkedOptionLegId).filter((id): id is string => Boolean(id)));
  if (explicit.length > 0) return new Set(explicit);
  const putLegs = simulation.optionLegs.filter((leg) => leg.type === "put" && leg.side === "sell");
  return putLegs.length === 1 ? new Set([putLegs[0].id]) : new Set();
}

function isConfirmedStockSettlement(value: StockSettlement | undefined): value is StockSettlement {
  return Boolean(value?.enabled && value.confirmationStatus === "confirmed" && value.completionStatus === "complete" &&
    Number.isFinite(value.shares) && value.shares > 0 && Number.isFinite(value.sellPriceUSD) && Number.isFinite(value.costBasisUSD));
}

function isWheelPutEvent(event: WheelEvent): boolean {
  return event.type === "short_put_opened" || event.type === "short_put_closed" || event.type === "put_assigned";
}

function isRemovableAutomaticOpenEvent(event: WheelEvent, simulation: TradeSimulation): boolean {
  if (event.type !== "short_put_opened" || simulation.status !== "open") return false;
  if (event.derivationSource === "history" || event.derivationSource === "manual") return false;
  const ticker = normalizeWheelTicker(simulation.ticker);
  return event.derivationSource === "wheel_reconciliation" || event.id.startsWith("wheel-event-short-put-opened-") ||
    event.description === `${ticker} N口座プット売りを建玉開始`;
}

function ensureEvent(events: WheelEvent[], desired: WheelEvent): void {
  const existing = events.find((event) => event.type === desired.type && event.linkedSimulationId === desired.linkedSimulationId &&
    (!event.linkedOptionLegId || event.linkedOptionLegId === desired.linkedOptionLegId));
  if (existing) Object.assign(existing, { ...desired, id: existing.id }); else events.push(desired);
}

function sumKnownFees(values: Array<number | undefined>): number | undefined {
  if (values.length === 0 || values.some((value) => finiteNumber(value) === undefined)) return undefined;
  let total = 0; for (const value of values) total += Math.abs(value as number); return total;
}
function finiteNumber(value: number | undefined): number | undefined { return value !== undefined && Number.isFinite(value) ? value : undefined; }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function compareWheelEvents(a: WheelEvent, b: WheelEvent): number { return b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id); }
