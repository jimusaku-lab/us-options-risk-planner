import type { AccountState, OptionLeg, TradeSimulation } from "@/types/domain";

const CONTRACT_SIZE = 100;

export type CompositeLifecycleState = "planned" | "partial_entry" | "open" | "partial_close" | "closed" | "invalid";

export type CompositeOptionPositionValidation = {
  valid: boolean;
  reasons: string[];
  callLeg?: OptionLeg;
  putLeg?: OptionLeg;
};

export type CompositeOptionLifecycle = {
  state: CompositeLifecycleState;
  label: string;
  callEntryContracts: number;
  putEntryContracts: number;
  callCloseContracts: number;
  putCloseContracts: number;
  entryComplete: boolean;
  closeComplete: boolean;
};

export function isCompositeOptionStrategy(simulation: Pick<TradeSimulation, "strategyType">): boolean {
  return simulation.strategyType === "synthetic_forward" || simulation.strategyType === "combo";
}

export function isSyntheticForwardEntryConfirmation(simulation: Pick<TradeSimulation, "strategyType" | "status">): boolean {
  return simulation.strategyType === "synthetic_forward" && simulation.status === "entry_confirmation";
}

/** Preserve user-entered fields while repairing only imported, unconfirmed Saxo synthetic forwards. */
export function shouldRecoverSaxoSyntheticForwardEntryConfirmation(simulation: TradeSimulation, hasFilledSaxoEvidence: boolean): boolean {
  if (!hasFilledSaxoEvidence || simulation.strategyType !== "synthetic_forward") return false;
  if (simulation.status === "planned") return true;
  const importedSynthetic = (simulation.fixtureMeta?.notes ?? "").includes("Saxo SyntheticUnderlying");
  const entryExecutions = simulation.optionEntryExecutions ?? [];
  return simulation.status === "open" && importedSynthetic && (entryExecutions.length === 0 || entryExecutions.every((execution) => !execution.confirmed));
}

export function validateCompositeOptionPosition(simulation: TradeSimulation): CompositeOptionPositionValidation {
  if (!isCompositeOptionStrategy(simulation)) return { valid: true, reasons: [] };
  const callLegs = simulation.optionLegs.filter((leg) => leg.type === "call" && leg.side === "buy");
  const putLegs = simulation.optionLegs.filter((leg) => leg.type === "put" && leg.side === "sell");
  const reasons: string[] = [];
  if (callLegs.length !== 1) reasons.push("C買い脚は1本必要です。");
  if (putLegs.length !== 1) reasons.push("P売り脚は1本必要です。");
  if (simulation.optionLegs.length !== 2) reasons.push("この親建玉はC買いとP売りの二脚で管理します。");
  const callLeg = callLegs[0];
  const putLeg = putLegs[0];
  if (!callLeg || !putLeg) return { valid: false, reasons, callLeg, putLeg };
  if (callLeg.expiryDate !== putLeg.expiryDate) reasons.push("二脚の満期日は同一にしてください。");
  if (callLeg.quantity !== putLeg.quantity) reasons.push("二脚の枚数は同一にしてください。");
  if (simulation.strategyType === "synthetic_forward" && callLeg.strikeUSD !== putLeg.strikeUSD) {
    reasons.push("シンセティックフォワードは二脚の権利行使価格を同一にしてください。");
  }
  if (simulation.strategyType === "combo" && putLeg.strikeUSD > callLeg.strikeUSD) {
    reasons.push("コンボではP売りの権利行使価格をC買い以下にしてください。");
  }
  const accountKeys = [callLeg.saxoAccountKey, putLeg.saxoAccountKey].filter((value): value is string => Boolean(value));
  if (accountKeys.length === 2 && accountKeys[0] !== accountKeys[1]) reasons.push("二脚のSaxo口座が一致していません。");
  return { valid: reasons.length === 0, reasons, callLeg, putLeg };
}

function confirmedContracts(simulation: TradeSimulation, legId: string, kind: "entry" | "close"): number {
  const executions = kind === "entry" ? simulation.optionEntryExecutions ?? [] : simulation.optionCloseExecutions ?? [];
  return executions.filter((execution) => execution.legId === legId && execution.confirmed).reduce((sum, execution) => sum + Math.max(0, execution.contracts || 0), 0);
}

export function getCompositeOptionLifecycle(simulation: TradeSimulation): CompositeOptionLifecycle | undefined {
  if (!isCompositeOptionStrategy(simulation)) return undefined;
  const validation = validateCompositeOptionPosition(simulation);
  if (!validation.valid || !validation.callLeg || !validation.putLeg) return { state: "invalid", label: "二脚要確認", callEntryContracts: 0, putEntryContracts: 0, callCloseContracts: 0, putCloseContracts: 0, entryComplete: false, closeComplete: false };
  const callEntryContracts = confirmedContracts(simulation, validation.callLeg.id, "entry");
  const putEntryContracts = confirmedContracts(simulation, validation.putLeg.id, "entry");
  const callCloseContracts = confirmedContracts(simulation, validation.callLeg.id, "close");
  const putCloseContracts = confirmedContracts(simulation, validation.putLeg.id, "close");
  const entryComplete = callEntryContracts >= validation.callLeg.quantity && putEntryContracts >= validation.putLeg.quantity;
  const closeComplete = entryComplete && callCloseContracts >= validation.callLeg.quantity && putCloseContracts >= validation.putLeg.quantity;
  const hasPartialClose = callCloseContracts > 0 || putCloseContracts > 0;
  const hasPartialEntry = callEntryContracts > 0 || putEntryContracts > 0;
  const hasReportedEntry = (simulation.optionEntryExecutions ?? []).some((execution) => execution.legId === validation.callLeg?.id || execution.legId === validation.putLeg?.id);
  const state = closeComplete ? "closed" : hasPartialClose ? "partial_close" : entryComplete ? "open" : hasPartialEntry ? "partial_entry" : "planned";
  const label = state === "closed" ? "二脚決済済み" : state === "partial_close" ? "一部決済・要確認" : state === "open" ? "二脚建玉中" : state === "partial_entry" ? "一部約定・要確認" : (simulation.status === "open" || simulation.status === "entry_confirmation") && hasReportedEntry ? "二脚約定確認待ち" : "二脚約定待ち";
  return { state, label, callEntryContracts, putEntryContracts, callCloseContracts, putCloseContracts, entryComplete, closeComplete };
}

/** A saved synthetic forward is the parent record with both entry legs formally confirmed. */
export function isSyntheticForwardEntrySaved(simulation: TradeSimulation): boolean {
  return simulation.strategyType === "synthetic_forward" && simulation.status === "open" && getCompositeOptionLifecycle(simulation)?.entryComplete === true;
}

export function shouldIncludeCompositeCloseResultsInPerformance(simulation: TradeSimulation): boolean {
  return !isCompositeOptionStrategy(simulation) || getCompositeOptionLifecycle(simulation)?.closeComplete === true;
}

export function getCompositeNetEntryPremiumUSD(simulation: TradeSimulation): number | undefined {
  const validation = validateCompositeOptionPosition(simulation);
  if (!isCompositeOptionStrategy(simulation) || !validation.callLeg || !validation.putLeg) return undefined;
  return (validation.putLeg.premiumUSD - validation.callLeg.premiumUSD) * CONTRACT_SIZE * validation.callLeg.quantity;
}

export function getSyntheticForwardTicketNetPremiumUSD(simulation: TradeSimulation): number | undefined {
  if (simulation.strategyType !== "synthetic_forward") return undefined;
  const ticket = simulation.syntheticForwardTicket;
  const price = ticket?.netFillPriceUSD ?? ticket?.netOrderPriceUSD;
  const quantity = validateCompositeOptionPosition(simulation).callLeg?.quantity;
  if (price === undefined || !Number.isFinite(price) || !quantity || quantity <= 0) return undefined;
  return price * CONTRACT_SIZE * quantity;
}

export function getSyntheticForwardMarginCheck(simulation: TradeSimulation) {
  if (simulation.strategyType !== "synthetic_forward") return undefined;
  const ticket = simulation.syntheticForwardTicket;
  const requiredUSD = ticket?.requiredMarginUSD;
  const availableUSD = ticket?.marginAvailableUSD;
  if (requiredUSD === undefined || !Number.isFinite(requiredUSD) || requiredUSD < 0) return { status: "unconfirmed" as const, requiredUSD, availableUSD };
  if (availableUSD === undefined || !Number.isFinite(availableUSD) || availableUSD < 0) return { status: "unconfirmed" as const, requiredUSD, availableUSD };
  return { status: availableUSD >= requiredUSD ? "sufficient" as const : "insufficient" as const, requiredUSD, availableUSD, surplusUSD: availableUSD - requiredUSD };
}

export function validateSyntheticForwardTicketForOpen(simulation: TradeSimulation): string[] {
  if (simulation.strategyType !== "synthetic_forward") return [];
  const validation = validateCompositeOptionPosition(simulation);
  const ticket = simulation.syntheticForwardTicket;
  const reasons = [...validation.reasons];
  if (!ticket || !Number.isFinite(ticket.netFillPriceUSD) || ticket.netFillPriceUSD === 0) reasons.push("ネット約定価格を入力してください。");
  if (!ticket || !Number.isFinite(ticket.actualTotalCommissionUSD) || (ticket.actualTotalCommissionUSD ?? 0) <= 0) reasons.push("実績総手数料を入力してください。");
  if (!ticket?.assignmentAccepted) reasons.push("P売りの割当受容と同一口座の現金確認を明示してください。");
  return reasons;
}

export function getCompositeAssignmentFunding(simulation: TradeSimulation, account?: Pick<AccountState, "cashBalance" | "currency">) {
  const validation = validateCompositeOptionPosition(simulation);
  if (!isCompositeOptionStrategy(simulation) || !validation.putLeg) return undefined;
  const requiredUSD = validation.putLeg.strikeUSD * CONTRACT_SIZE * validation.putLeg.quantity;
  const availableUSD = account?.currency === "USD" && Number.isFinite(account.cashBalance) ? account.cashBalance : undefined;
  return { requiredUSD, availableUSD, surplusUSD: availableUSD === undefined ? undefined : availableUSD - requiredUSD, status: availableUSD === undefined ? "unconfirmed" as const : availableUSD >= requiredUSD ? "sufficient" as const : "insufficient" as const };
}
