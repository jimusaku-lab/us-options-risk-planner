import type { OptionLeg, TradeSimulation } from "@/types/domain";
import { resolveCurrentEstimateFx } from "./currentEstimateFx";
import { getOptionLegCloseProgress, getOptionLegOperationalCloseProgress } from "./optionCloseExecutions";
import { activeSpreadCloses, activeSpreadEntries, moneyProduct, moneySum, spreadCloseMoney } from "./spreadCashflows";

const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const positiveInteger = (n: unknown): n is number => valid(n) && Number.isSafeInteger(n) && n > 0;
const zero = (n: number) => Math.abs(n) < 1e-8;
const missing = (reason: string) => ({ kind: "missing" as const, reason });

export function getExpiryBreakevenMoves(
  spot: number | undefined,
  breakevens: readonly number[],
  zeroRanges: readonly { start: number; end: number }[],
) {
  if (!breakevens.length && !zeroRanges.length) return { kind: "no-breakeven" as const };
  if (!valid(spot) || spot <= 0) return { kind: "no-spot" as const };
  if (zeroRanges.some(({ start, end }) => spot >= start && spot <= end)) return { kind: "in-range" as const };

  const targets = [...breakevens, ...zeroRanges.map(({ start, end }) => spot < start ? start : end)];
  const moves = [...new Set(targets)].map((target) => {
    const delta = zero(target - spot) ? 0 : target - spot;
    return { target, delta, percent: delta / spot * 100 };
  }).sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || a.target - b.target);
  return { kind: "moves" as const, moves };
}

export function calculateAccountExpiryPayoff(simulation: TradeSimulation) {
  if (simulation.status !== "open") return missing("確定した建玉のみ表示します。");
  const imported = (simulation as TradeSimulation & { saxoSyntheticImport?: { accountingStatus?: string } }).saxoSyntheticImport;
  if (imported && imported.accountingStatus !== "matched") {
    return missing("開始約定の照合が済んでいません。");
  }
  if (new Set(simulation.optionLegs.map((leg) => leg.id)).size !== simulation.optionLegs.length) {
    return missing("オプション脚を一意に確認できません。");
  }
  const currency = simulation.accountCurrency;
  const fx = resolveCurrentEstimateFx(simulation);
  const rate = currency === "USD" ? 1 : fx.kind === "resolved" ? fx.rateJPYPerUSD : undefined;
  if (rate === undefined) return missing("円換算に使う保存為替が未確認です。");
  const formal = getOptionLegCloseProgress(simulation);
  const operational = getOptionLegOperationalCloseProgress(simulation);
  if (formal.invalidReason || operational.invalidReason) return missing("決済実績と残り枚数を確認できません。");
  const legs: { leg: OptionLeg; remaining: number; shares: number }[] = [];
  const cashflows: number[] = [];
  let partial = false;
  let estimated = false;
  const entryIds = new Set<string>();
  for (const leg of simulation.optionLegs) {
    const remaining = formal.legs.find((row) => row.legId === leg.id)?.remainingContracts;
    if (!valid(remaining) || !Number.isSafeInteger(remaining) || remaining < 0 ||
        remaining !== operational.legs.find((row) => row.legId === leg.id)?.remainingContracts) {
      return missing("残り枚数または決済の精算情報が未確認です。");
    }
    partial ||= remaining !== leg.quantity;
    if (!remaining) continue;
    if (!positiveInteger(leg.quantity) || !positiveInteger(leg.contractSize) || !Number.isSafeInteger(leg.contractSize * remaining) ||
        !valid(leg.strikeUSD) || leg.strikeUSD <= 0 || !["call", "put"].includes(leg.type) || !["buy", "sell"].includes(leg.side)) {
      return missing("契約倍率・行使価格・枚数のいずれかが未確認です。");
    }
    const entries = activeSpreadEntries(simulation, leg);
    if (!entries.length || entries.some((e) => !positiveInteger(e.contracts)) ||
        entries.reduce((sum, e) => sum + e.contracts, 0) !== leg.quantity) {
      return missing("残存脚の開始約定が未確認です。");
    }
    for (const entry of entries) {
      if (!entry.id || entryIds.has(entry.id) || entry.settlementCurrency !== currency) {
        return missing("開始約定の重複または通貨の不一致があります。");
      }
      entryIds.add(entry.id);
      estimated ||= entry.source === "saxo_api_estimate";
      if (currency === "JPY") {
        if (remaining !== leg.quantity || !valid(entry.brokerBookedAmountJPY)) {
          return missing("残存脚の円の開始記帳額を確認できません。");
        }
        cashflows.push(entry.brokerBookedAmountJPY);
      } else {
        if (!valid(entry.fillPriceUSD) || entry.fillPriceUSD < 0 || !valid(entry.commissionUSD)) {
          return missing("開始約定価格または手数料が未確認です。");
        }
        cashflows.push(moneyProduct(leg.side === "buy" ? -1 : 1, entry.fillPriceUSD, entry.contracts, leg.contractSize), -entry.commissionUSD);
      }
    }
    if (remaining !== leg.quantity) {
      const closes = activeSpreadCloses(simulation).filter((item) => item.legId === leg.id);
      if (closes.reduce((sum, item) => sum + item.contracts, 0) !== leg.quantity - remaining) {
        return missing("決済済み分と残存分の枚数が一致しません。");
      }
      for (const close of closes) {
        const allocation = spreadCloseMoney(simulation, close);
        if (!allocation) return missing("決済済み分と残存分の開始費用を分けられません。");
        cashflows.push(allocation.entryDebitUSD);
      }
    }
    legs.push({ leg, remaining, shares: remaining * leg.contractSize });
  }
  if (!legs.length) return missing("満期損益を計算する残存脚がありません。");
  const expiry = legs[0].leg.expiryDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || legs.some(({ leg }) => leg.expiryDate !== expiry)) {
    return missing("残存脚に共通する満期日を確認できません。");
  }
  const stock = simulation.stockPosition;
  const shares = stock?.shares ?? 0;
  if (!Number.isSafeInteger(shares) || shares < 0 ||
      (shares > 0 && (currency !== "USD" || !stock || !valid(stock.averageCostUSD) || stock.averageCostUSD <= 0))) {
    return missing("現物株を含む建玉の同一通貨での取得原価が未確認です。");
  }
  if (simulation.strategyType === "covered_call" && shares === 0) {
    return missing("カバードコールに対応する現物株と取得原価を確認できません。");
  }
  const openingCashflow = moneySum(...cashflows, shares > 0 ? -moneyProduct(shares, stock!.averageCostUSD) : 0);
  const atPrice = (price: number) => openingCashflow + rate * (shares * price + legs.reduce((sum, { leg, shares }) => {
    const intrinsic = leg.type === "call" ? Math.max(0, price - leg.strikeUSD) : Math.max(0, leg.strikeUSD - price);
    return sum + (leg.side === "buy" ? 1 : -1) * shares * intrinsic;
  }, 0));
  const strikes = [...new Set(legs.map(({ leg }) => leg.strikeUSD))].sort((a, b) => a - b);
  const nodes = [0, ...strikes].map((price) => ({ price, pnl: atPrice(price) }));
  const tail = rate * (shares + legs.reduce((sum, { leg, shares }) =>
    sum + (leg.type === "call" ? (leg.side === "buy" ? shares : -shares) : 0), 0));
  const breakevens = nodes.filter(({ pnl }) => zero(pnl)).map(({ price }) => price);
  const zeroRanges: { start: number; end: number }[] = [];
  function addZeroRange(start: number, end: number) {
    const prior = zeroRanges.at(-1);
    if (prior?.end === start) prior.end = end;
    else zeroRanges.push({ start, end });
  }
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1], b = nodes[i];
    if (zero(a.pnl) && zero(b.pnl)) addZeroRange(a.price, b.price);
    else if (!zero(a.pnl) && !zero(b.pnl) && Math.sign(a.pnl) !== Math.sign(b.pnl)) {
      breakevens.push(a.price - a.pnl / (b.pnl - a.pnl) * (b.price - a.price));
    }
  }
  const last = nodes[nodes.length - 1];
  if (tail === 0 && zero(last.pnl)) addZeroRange(last.price, Infinity);
  if (tail !== 0 && !zero(last.pnl) && Math.sign(tail) !== Math.sign(last.pnl)) breakevens.push(last.price - last.pnl / tail);
  const spot = valid(simulation.currentPriceUSD) && simulation.currentPriceUSD > 0 ? simulation.currentPriceUSD : undefined;
  return {
    kind: "available" as const, currency, expiry, legs, strikes, atPrice, spot, partial, estimated, shares,
    fxRate: currency === "JPY" ? rate : undefined,
    breakevens: breakevens.filter((price) => !zeroRanges.some(({ start, end }) => price >= start && price <= end)).sort((a, b) => a - b),
    zeroRanges,
    maxLoss: tail < 0 ? -Infinity : Math.min(0, ...nodes.map(({ pnl }) => pnl)),
    maxProfit: tail > 0 ? Infinity : Math.max(0, ...nodes.map(({ pnl }) => pnl)),
  };
}
