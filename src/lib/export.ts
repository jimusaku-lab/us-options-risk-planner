import type { AccountState, StockTransferEvent, TradeSimulation, WheelCycle, WheelEvent } from "@/types/domain";
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
    };
    if (Array.isArray(workspace.simulations)) {
      return {
        simulations: workspace.simulations as TradeSimulation[],
        accountStates: Array.isArray(workspace.accountStates) ? (workspace.accountStates as AccountState[]) : undefined,
        wheelCycles: Array.isArray(workspace.wheelCycles) ? (workspace.wheelCycles as WheelCycle[]) : undefined,
        wheelEvents: Array.isArray(workspace.wheelEvents) ? (workspace.wheelEvents as WheelEvent[]) : undefined,
        stockTransfers: Array.isArray(workspace.stockTransfers) ? (workspace.stockTransfers as StockTransferEvent[]) : undefined,
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
