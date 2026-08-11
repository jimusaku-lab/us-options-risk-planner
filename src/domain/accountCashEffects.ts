import type { AccountInputs } from "@/store/useOptionsStore";
import type { AccountCashAdjustment, AccountState, Currency, OptionCloseExecution, OptionLeg, SaxoAccountCode, TradeSimulation } from "@/types/domain";
import { calculateOptionCloseExecutionResults } from "./optionCloseExecutions";

export type PendingAccountCashEffect = {
  id: string;
  sourceSimulationId: string;
  sourceExecutionId: string;
  accountCode: SaxoAccountCode;
  currency: Currency;
  amount?: number;
  label: string;
  detail: string;
  closeDate: string;
  canApply: boolean;
  coverage: "manual_apply" | "same_day_uncertain";
  missingReason?: string;
};

export type SaxoCashCoverage = "manual_apply" | "saxo_covered" | "same_day_uncertain";

function formatTokyoCalendarDate(value: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const valueFor = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = valueFor("year");
  const month = valueFor("month");
  const day = valueFor("day");
  return year && month && day ? `${year}-${month}-${day}` : undefined;
}

/** Uses only applied Saxo cash snapshots and Tokyo dates; never amounts or balance deltas. */
export function getSaxoCashCoverage(account: AccountState, closeDate: string): SaxoCashCoverage {
  const snapshotDates = (account.saxoSyncHistory ?? [])
    .filter((history) => history.source === "saxo_api" && history.appliedFields.includes("cashBalance"))
    .map((history) => formatTokyoCalendarDate(history.fetchedAt))
    .filter((date): date is string => Boolean(date));
  if (snapshotDates.some((snapshotDate) => snapshotDate > closeDate)) return "saxo_covered";
  if (snapshotDates.some((snapshotDate) => snapshotDate === closeDate)) return "same_day_uncertain";
  return "manual_apply";
}

function getCashEffectId(simulationId: string, executionId: string): string {
  return `option-close-cash:${simulationId}:${executionId}`;
}

function getLegLabel(leg: OptionLeg): string {
  const side = leg.type === "put" ? "P" : "C";
  return `${side} ${leg.strikeUSD} ${leg.expiryDate}`;
}

function isApplied(accountInputs: AccountInputs, effectId: string, accountCode: SaxoAccountCode): boolean {
  return Boolean(accountInputs[accountCode].cashAdjustments?.some((adjustment) => adjustment.id === effectId));
}

function getExecutionCashAmount(simulation: TradeSimulation, execution: OptionCloseExecution): {
  amount?: number;
  currency: Currency;
  missingReason?: string;
} {
  const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
  if (execution.closeKind === "expired") {
    return { amount: 0, currency: isN ? "USD" : "JPY" };
  }

  if (isN) {
    const closePriceUSD = execution.closePriceUSD ?? 0;
    const contracts = execution.contracts ?? 0;
    if (closePriceUSD <= 0 || contracts <= 0) {
      return { currency: "USD", missingReason: "N口座の現金反映には約定価格USDと数量が必要です。" };
    }
    const closeCostUSD = closePriceUSD * 100 * contracts;
    const commissionUSD = Math.abs(execution.commissionUSD ?? 0);
    return { amount: -(closeCostUSD + commissionUSD), currency: "USD" };
  }

  if (execution.brokerBookedAmountJPY === undefined || Number.isNaN(execution.brokerBookedAmountJPY)) {
    return {
      currency: "JPY",
      missingReason: "記帳額JPYが未入力のため、現金残高へ反映できません。",
    };
  }

  return { amount: execution.brokerBookedAmountJPY, currency: "JPY" };
}

export function calculatePendingAccountCashEffects(
  simulations: TradeSimulation[],
  accountInputs: AccountInputs,
): PendingAccountCashEffect[] {
  return simulations.flatMap((simulation) => {
    const accountCode: SaxoAccountCode = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "N" : "P";
    const results = calculateOptionCloseExecutionResults(simulation);
    return (simulation.optionCloseExecutions ?? []).flatMap((execution) => {
      if (!execution.confirmed) return [];
      const effectId = getCashEffectId(simulation.id, execution.id);
      if (isApplied(accountInputs, effectId, accountCode)) return [];
      const coverage = getSaxoCashCoverage(accountInputs[accountCode], execution.closeDate);
      if (coverage === "saxo_covered") return [];

      const leg = simulation.optionLegs.find((item) => item.id === execution.legId);
      const result = results.find((item) => item.execution.id === execution.id);
      const cashEffect = getExecutionCashAmount(simulation, execution);
      if (cashEffect.amount === 0 && !cashEffect.missingReason) return [];

      const label = `${simulation.ticker || simulation.name} ${leg ? getLegLabel(leg) : "決済実績"}`;
      const detail =
        accountCode === "P"
          ? cashEffect.missingReason
            ? "現金残高へ反映する場合は、Saxo履歴の記帳額JPYが必要です。反映しない場合は未入力のままで問題ありません。"
            : "Saxoの記帳額JPYを現金残高へ反映します。実現損益JPYではありません。"
          : cashEffect.missingReason
            ? "N口座の現金残高へ反映するための決済情報が不足しています。"
            : "N口座の買戻しコストとUSD手数料をUSD現金残高へ反映します。";

      return [
        {
          id: effectId,
          sourceSimulationId: simulation.id,
          sourceExecutionId: execution.id,
          accountCode,
          currency: cashEffect.currency,
          amount: cashEffect.amount,
          label,
          detail,
          closeDate: execution.closeDate,
          canApply: coverage === "manual_apply" && cashEffect.amount !== undefined && !cashEffect.missingReason && Boolean(result || cashEffect.amount),
          coverage,
          missingReason: coverage === "same_day_uncertain" ? "同日のSaxo残高反映は時刻順序を確認できません。Saxo残高を再取得して確認してください。" : cashEffect.missingReason,
        },
      ];
    });
  });
}

export function createAccountCashAdjustment(effect: PendingAccountCashEffect): AccountCashAdjustment {
  if (effect.amount === undefined) {
    throw new Error("現金反映額が未入力です。");
  }
  return {
    id: effect.id,
    sourceType: "option_close_execution",
    sourceSimulationId: effect.sourceSimulationId,
    sourceExecutionId: effect.sourceExecutionId,
    accountCode: effect.accountCode,
    currency: effect.currency,
    amount: effect.amount,
    label: effect.label,
    appliedAt: new Date().toISOString(),
    memo: effect.detail,
  };
}
