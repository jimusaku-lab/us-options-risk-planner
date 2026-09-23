import type { OptionValueObservation, OptionValueParentObservation, TradeSimulation } from '@/types/domain';
import { getOperationalRemainingOptionLegs, getOptionLegOperationalCloseProgress } from './optionCloseExecutions';
import { resolveOptionValueEvidenceRevision } from './timeValue';
import { calculateVerticalSpreadEstimate, isManagedTwoLegStrategy, isVerticalSpreadType } from './verticalSpread';
import { moneyProduct, moneySum } from './spreadCashflows';

export type ParentTimeValueObservation = OptionValueParentObservation;
export type ParentTimeValueUpdate = { observations: ParentTimeValueObservation[]; updated: boolean; reason?: string };
const positiveInteger = (value: number | undefined): value is number => value !== undefined && Number.isInteger(value) && value > 0;
const shape = (record: ParentTimeValueObservation) => JSON.stringify(record.legs.map(leg => [leg.legId, leg.side, leg.strikeUSD, leg.expiryDate, leg.quantity, leg.contractSize]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));

/** Records a parent only from all residual legs in the same apply batch. */
export function recordParentTimeValueObservation(simulation: TradeSimulation, previous: ParentTimeValueObservation[] | undefined, batchId: string): ParentTimeValueUpdate {
  const observations = previous ?? [];
  const unchanged = (reason: string): ParentTimeValueUpdate => ({ observations, updated: false, reason });
  if (!isManagedTwoLegStrategy(simulation)) return unchanged('2脚戦略ではありません');
  const progress = getOptionLegOperationalCloseProgress(simulation);
  if (progress.invalidReason) return unchanged(progress.invalidReason);
  const remaining = getOperationalRemainingOptionLegs(simulation);
  if (!remaining.length) return unchanged('全脚決済済みのため履歴を保持しています');
  const legs: OptionValueObservation[] = [];
  for (const { leg, progress: { remainingContracts } } of remaining) {
    const current = leg.valueObservations?.at(-1);
    if (!current || current.batchId !== batchId || current.calculationVersion !== 'r14') return unchanged('全残存脚の価格が揃わないため、前回の組み合わせ履歴を保持しています');
    if (current.legId !== leg.id || current.optionType !== leg.type || current.side !== leg.side || current.strikeUSD !== leg.strikeUSD || current.expiryDate !== leg.expiryDate) return unchanged('脚の契約情報が一致しません');
    if (!positiveInteger(current.quantity) || current.quantity !== remainingContracts || !positiveInteger(current.contractSize) || current.contractSize !== leg.contractSize) return unchanged('残数量・契約倍率が一致しません');
    const revision = resolveOptionValueEvidenceRevision({ legId: leg.id, entryExecutions: simulation.optionEntryExecutions, closeExecutions: simulation.optionCloseExecutions });
    if (current.evidenceRevision !== revision) return unchanged('約定・費用の根拠が変更されているため価格の再反映が必要です');
    const price = leg.closePlan?.closePriceUSD ?? leg.closeCostUSD;
    if (!Number.isFinite(current.optionPriceUSD) || current.optionPriceUSD < 0 || current.optionPriceUSD !== price) return unchanged('保存価格と履歴が一致しません');
    legs.push({ ...current });
  }
  if (new Set(legs.map(leg => leg.snapshotDate)).size !== 1) return unchanged('異なる日付の脚を合算しません');
  const sumSigned = (field: 'optionPriceUSD' | 'intrinsicValueUSD' | 'timeValueUSD') => moneySum(...legs.map(leg => moneyProduct(leg.side === 'buy' ? 1 : -1, leg[field]!, leg.quantity!, leg.contractSize!)));
  const decomposable = legs.every(leg => leg.decompositionState === 'available' && Number.isFinite(leg.intrinsicValueUSD) && Number.isFinite(leg.timeValueUSD));
  const feesKnown = legs.every(leg => leg.feeUSD !== undefined && Number.isFinite(leg.feeUSD) && leg.feeUSD >= 0);
  const positionValueUSD = sumSigned('optionPriceUSD');
  const closeFeeUSD = feesKnown ? moneySum(...legs.map(leg => leg.feeUSD!)) : undefined;
  const times = legs.flatMap(leg => [leg.sourceTimestamp, leg.underlyingSourceTimestamp]).map(time => time ? Date.parse(time) : NaN);
  const synchronized = times.every(Number.isFinite) && new Set(times).size === 1 && new Set(legs.map(leg => leg.underlyingPriceUSD)).size === 1;
  const estimate = isVerticalSpreadType(simulation.strategyType) ? calculateVerticalSpreadEstimate(simulation, legs[0].snapshotDate) : undefined;
  const evidenceRevision = JSON.stringify(legs.map(leg => [leg.legId, leg.evidenceRevision, leg.feeUSD, leg.feeSource]));
  const next: ParentTimeValueObservation = { observationId: `${simulation.id}:${batchId}`, batchId, simulationId: simulation.id, snapshotDate: legs[0].snapshotDate, legs, evidenceRevision, positionValueUSD, intrinsicValueUSD: decomposable ? sumSigned('intrinsicValueUSD') : undefined, timeValueUSD: decomposable ? sumSigned('timeValueUSD') : undefined, closeFeeUSD, closeCashflowUSD: closeFeeUSD === undefined ? undefined : moneySum(positionValueUSD, -closeFeeUSD), estimatedPnlUSD: feesKnown && estimate?.kind === 'available' ? estimate.estimatedPnlUSD : undefined, periodReturnPct: feesKnown && estimate?.kind === 'available' ? estimate.periodReturnPct : undefined, synchronized };
  const prior = observations.at(-1);
  if (prior) { next.quantityChanged = shape(prior) !== shape(next); next.evidenceChanged = prior.evidenceRevision !== evidenceRevision; }
  const sameDay = observations.find(item => item.snapshotDate === next.snapshotDate);
  if (sameDay && sameDay.evidenceRevision !== next.evidenceRevision) next.superseded = [...(sameDay.superseded ?? []), { ...sameDay, superseded: undefined }];
  else if (sameDay?.superseded) next.superseded = sameDay.superseded;
  const byDate = new Map(observations.filter(item => item.observationId !== next.observationId).map(item => [item.snapshotDate, item]));
  byDate.set(next.snapshotDate, next);
  return { observations: [...byDate.values()].sort((a,b) => a.snapshotDate.localeCompare(b.snapshotDate)).slice(-20), updated: true };
}
