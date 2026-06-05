import type { AccountState, ExitOrderPlan, OptionCloseExecution, OptionEntryExecution, StockTransferEvent, TradeSimulation, WheelCycle, WheelEvent } from "@/types/domain";
import { calculateNetInitialPremiumJPY } from "@/domain/calculations";
import { calculateDenominators, getPrimaryDenominator } from "@/domain/denominators";
import { getStatusLabel, getStrategyLabel } from "@/domain/strategyLabels";

export function exportSimulationJson(simulation: TradeSimulation): string {
  return JSON.stringify(simulation, null, 2);
}

export function exportWorkspaceJson({
  workspace,
  simulations,
  accountStates,
  wheelCycles,
  wheelEvents,
  stockTransfers,
  exportedAt,
}: {
  workspace: "demo" | "live";
  simulations: TradeSimulation[];
  accountStates?: AccountState[];
  wheelCycles?: WheelCycle[];
  wheelEvents?: WheelEvent[];
  stockTransfers?: StockTransferEvent[];
  exportedAt: string;
}): string {
  return JSON.stringify(
    {
      schemaVersion: 2,
      app: "us-options-position-manager",
      workspace,
      exportedAt,
      simulations,
      accountStates: accountStates ?? [],
      wheelCycles: wheelCycles ?? [],
      wheelEvents: wheelEvents ?? [],
      fxTransfers: [],
      stockTransfers: stockTransfers ?? [],
      exitOrderPlans: simulations
        .flatMap((simulation) =>
          (simulation.exitOrderPlans ?? (simulation.exitOrderPlan ? [simulation.exitOrderPlan] : [])).map((plan) => ({
            simulationId: simulation.id,
            legId: plan.legId,
            plan,
          })),
        ),
      optionCloseExecutions: simulations.flatMap((simulation) =>
        (simulation.optionCloseExecutions ?? []).map((execution) => ({
          simulationId: simulation.id,
          execution,
        })),
      ),
      optionEntryExecutions: simulations.flatMap((simulation) =>
        (simulation.optionEntryExecutions ?? []).map((execution) => ({
          simulationId: simulation.id,
          execution,
        })),
      ),
    },
    null,
    2,
  );
}

export type ParsedWorkspaceJson = {
  simulations: TradeSimulation[];
  accountStates?: AccountState[];
  wheelCycles?: WheelCycle[];
  wheelEvents?: WheelEvent[];
  stockTransfers?: StockTransferEvent[];
  exitOrderPlans?: Array<{ simulationId: string; legId?: string; plan: ExitOrderPlan }>;
  optionCloseExecutions?: Array<{ simulationId: string; execution: OptionCloseExecution }>;
  optionEntryExecutions?: Array<{ simulationId: string; execution: OptionEntryExecution }>;
};

export function parseWorkspaceJson(text: string): ParsedWorkspaceJson {
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) return { simulations: parsed as TradeSimulation[] };
  if (parsed && typeof parsed === "object" && "simulations" in parsed) {
    const workspace = parsed as {
      simulations?: unknown;
      accountStates?: unknown;
      wheelCycles?: unknown;
      wheelEvents?: unknown;
      stockTransfers?: unknown;
      exitOrderPlans?: unknown;
      optionCloseExecutions?: unknown;
      optionEntryExecutions?: unknown;
    };
    if (Array.isArray(workspace.simulations)) {
      const exitOrderPlans = Array.isArray(workspace.exitOrderPlans)
        ? (workspace.exitOrderPlans as Array<{ simulationId: string; legId?: string; plan: ExitOrderPlan }>)
        : undefined;
      const plansBySimulationId = new Map<string, ExitOrderPlan[]>();
      for (const item of exitOrderPlans ?? []) {
        plansBySimulationId.set(item.simulationId, [...(plansBySimulationId.get(item.simulationId) ?? []), { ...item.plan, legId: item.plan.legId ?? item.legId }]);
      }
      const optionCloseExecutions = Array.isArray(workspace.optionCloseExecutions)
        ? (workspace.optionCloseExecutions as Array<{ simulationId: string; execution: OptionCloseExecution }>)
        : undefined;
      const executionsBySimulationId = new Map<string, OptionCloseExecution[]>();
      for (const item of optionCloseExecutions ?? []) {
        executionsBySimulationId.set(item.simulationId, [...(executionsBySimulationId.get(item.simulationId) ?? []), item.execution]);
      }
      const optionEntryExecutions = Array.isArray(workspace.optionEntryExecutions)
        ? (workspace.optionEntryExecutions as Array<{ simulationId: string; execution: OptionEntryExecution }>)
        : undefined;
      const entryExecutionsBySimulationId = new Map<string, OptionEntryExecution[]>();
      for (const item of optionEntryExecutions ?? []) {
        entryExecutionsBySimulationId.set(item.simulationId, [...(entryExecutionsBySimulationId.get(item.simulationId) ?? []), item.execution]);
      }
      const simulations = (workspace.simulations as TradeSimulation[]).map((simulation) => ({
        ...simulation,
        exitOrderPlans: simulation.exitOrderPlans ?? plansBySimulationId.get(simulation.id),
        exitOrderPlan: simulation.exitOrderPlan ?? plansBySimulationId.get(simulation.id)?.[0],
        optionEntryExecutions: simulation.optionEntryExecutions ?? entryExecutionsBySimulationId.get(simulation.id) ?? [],
        optionCloseExecutions: simulation.optionCloseExecutions ?? executionsBySimulationId.get(simulation.id) ?? [],
      }));
      return {
        simulations,
        accountStates: Array.isArray(workspace.accountStates) ? (workspace.accountStates as AccountState[]) : undefined,
        wheelCycles: Array.isArray(workspace.wheelCycles) ? (workspace.wheelCycles as WheelCycle[]) : undefined,
        wheelEvents: Array.isArray(workspace.wheelEvents) ? (workspace.wheelEvents as WheelEvent[]) : undefined,
        stockTransfers: Array.isArray(workspace.stockTransfers) ? (workspace.stockTransfers as StockTransferEvent[]) : undefined,
        exitOrderPlans,
        optionCloseExecutions,
        optionEntryExecutions,
      };
    }
  }
  throw new Error("建玉バックアップJSONとして読み込めませんでした。");
}

export function exportSimulationsCsv(simulations: TradeSimulation[]): string {
  const header = ["銘柄", "口座", "戦略", "満期", "受取プレミアム", "使用分母", "年率", "ステータス", "メモ"];
  const rows = simulations.map((simulation) => {
    const premium = calculateNetInitialPremiumJPY(simulation);
    const primary = getPrimaryDenominator(calculateDenominators(simulation, premium));
    return [
      simulation.ticker,
      getAccountEnvironmentLabel(simulation.accountEnvironment),
      getStrategyLabel(simulation.strategyType),
      simulation.expiryDate,
      Math.round(premium).toString(),
      Math.round(primary.amountJPY).toString(),
      primary.annualReturnPct.toFixed(2),
      getStatusLabel(simulation.status),
      simulation.notes ?? "",
    ];
  });
  return [header, ...rows]
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
    .join("\n");
}

function getAccountEnvironmentLabel(environment: TradeSimulation["accountEnvironment"]): string {
  if (environment === "DEMO_JPY_BASE") return "DEMO / JPYベース";
  if (environment === "PROD_N_USD_SETTLEMENT") return "本番N口座 / USD決済";
  return "本番P口座 / JPY決済";
}
