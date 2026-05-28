import type { TradeSimulation } from "@/types/domain";
import { calculateNetInitialPremiumJPY } from "@/domain/calculations";
import { calculateDenominators, getPrimaryDenominator } from "@/domain/denominators";
import { getStatusLabel, getStrategyLabel } from "@/domain/strategyLabels";

export function exportSimulationJson(simulation: TradeSimulation): string {
  return JSON.stringify(simulation, null, 2);
}

export function exportWorkspaceJson({
  workspace,
  simulations,
  exportedAt,
}: {
  workspace: "demo" | "live";
  simulations: TradeSimulation[];
  exportedAt: string;
}): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      app: "us-options-position-manager",
      workspace,
      exportedAt,
      simulations,
    },
    null,
    2,
  );
}

export function parseWorkspaceJson(text: string): TradeSimulation[] {
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) return parsed as TradeSimulation[];
  if (parsed && typeof parsed === "object" && "simulations" in parsed) {
    const simulations = (parsed as { simulations?: unknown }).simulations;
    if (Array.isArray(simulations)) return simulations as TradeSimulation[];
  }
  throw new Error("建玉バックアップJSONとして読み込めませんでした。");
}

export function exportSimulationsCsv(simulations: TradeSimulation[]): string {
  const header = ["銘柄", "戦略", "満期", "受取プレミアム", "使用分母", "年率", "ステータス", "メモ"];
  const rows = simulations.map((simulation) => {
    const premium = calculateNetInitialPremiumJPY(simulation);
    const primary = getPrimaryDenominator(calculateDenominators(simulation, premium));
    return [
      simulation.ticker,
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
