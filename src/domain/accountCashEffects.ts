import type { AccountInputs } from "@/store/useOptionsStore";
import type { AccountCashAdjustment, Currency, OptionCloseExecution, OptionLeg, SaxoAccountCode, TradeSimulation } from "@/types/domain";
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
  missingReason?: string;
};

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
      missingReason: "P口座の現金残高へ反映するには、Saxo履歴の記帳額JPYを照合用詳細に入力してください。",
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
      const effectId = getCashEffectId(simulation.id, execution.id);
      if (isApplied(accountInputs, effectId, accountCode)) return [];

      const leg = simulation.optionLegs.find((item) => item.id === execution.legId);
      const result = results.find((item) => item.execution.id === execution.id);
      const cashEffect = getExecutionCashAmount(simulation, execution);
      if (cashEffect.amount === 0 && !cashEffect.missingReason) return [];

      const label = `${simulation.ticker || simulation.name} ${leg ? getLegLabel(leg) : "決済実績"}`;
      const detail =
        cashEffect.missingReason ??
        (accountCode === "P"
          ? "Saxoの記帳額JPYを現金残高へ反映します。実現損益JPYではありません。"
          : "N口座の買戻しコストとUSD手数料をUSD現金残高へ反映します。");

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
          canApply: cashEffect.amount !== undefined && !cashEffect.missingReason && Boolean(result || cashEffect.amount),
          missingReason: cashEffect.missingReason,
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
