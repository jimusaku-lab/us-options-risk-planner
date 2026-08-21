import type { OptionLeg, OptionType, OptionValueSnapshot, OptionValueSnapshotSource, TradeSimulation } from "@/types/domain";

export function calculateRemainingDaysUntilExpiry(expiryDate: string, now = new Date()): number {
  const expiry = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return 0;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const expiryDay = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
  return Math.max(0, Math.ceil((expiryDay.getTime() - today.getTime()) / 86_400_000));
}

export function buildLongOptionValueSnapshot({ snapshotDate, underlyingPrice, optionExitPrice, strike, expiry, dte, optionType, source, capturedAt }: { snapshotDate: string; underlyingPrice: number; optionExitPrice: number; strike: number; expiry: string; dte: number; optionType: OptionType; source: OptionValueSnapshotSource; capturedAt?: string }): OptionValueSnapshot | null {
  if (!Number.isFinite(underlyingPrice) || underlyingPrice <= 0 || !Number.isFinite(optionExitPrice) || optionExitPrice <= 0 || !Number.isFinite(strike) || strike <= 0) return null;
  const intrinsicValue = optionType === "call" ? Math.max(0, underlyingPrice - strike) : Math.max(0, strike - underlyingPrice);
  const timeValue = Math.max(0, optionExitPrice - intrinsicValue);
  return { snapshotDate, capturedAt, underlyingPrice, optionExitPrice, strike, expiry, dte, intrinsicValue, timeValue, timeValueRatio: timeValue / optionExitPrice, source };
}

export function upsertOptionValueSnapshot(snapshots: OptionValueSnapshot[] | undefined, nextSnapshot: OptionValueSnapshot): OptionValueSnapshot[] {
  const byDate = new Map<string, OptionValueSnapshot>();
  for (const snapshot of snapshots ?? []) if (snapshot.snapshotDate) byDate.set(snapshot.snapshotDate, snapshot);
  byDate.set(nextSnapshot.snapshotDate, nextSnapshot);
  return [...byDate.values()].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate)).slice(-20);
}

export function buildSaxoOptionValueSnapshot(simulation: Pick<TradeSimulation, "currentPriceUSD">, leg: OptionLeg, optionExitPrice: number, capturedAt: string): OptionValueSnapshot | null {
  return buildLongOptionValueSnapshot({ snapshotDate: capturedAt.slice(0, 10), underlyingPrice: simulation.currentPriceUSD, optionExitPrice, strike: leg.strikeUSD, expiry: leg.expiryDate, dte: calculateRemainingDaysUntilExpiry(leg.expiryDate, new Date(capturedAt)), optionType: leg.type, source: "saxo", capturedAt });
}
