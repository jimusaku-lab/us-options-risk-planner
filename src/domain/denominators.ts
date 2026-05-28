import type { DenominatorResult, TradeSimulation } from "@/types/domain";
import {
  calculateAnnualReturnPercent,
  calculateCallHedgeBuyCapitalJPY,
  calculatePutAssignmentCapitalTotalJPY,
  calculateStockDenominatorForSimulationJPY,
  calculateUsedMarginJPY,
} from "./calculations";
import { getDenominatorExplanation, getDenominatorLabel } from "./strategyLabels";

export function calculateDenominators(
  simulation: TradeSimulation,
  profitJPY: number,
  netProfitJPY?: number,
): DenominatorResult[] {
  const stockJPY = calculateStockDenominatorForSimulationJPY(simulation);
  const ticketMarginJPY = simulation.brokerMarginJPY;
  const usedMarginJPY = calculateUsedMarginJPY({
    brokerMarginJPY: simulation.brokerMarginJPY,
    marginBufferMultiplier: simulation.marginBufferMultiplier,
  });
  const putAssignmentJPY = calculatePutAssignmentCapitalTotalJPY(simulation);
  const callHedgeJPY = calculateCallHedgeBuyCapitalJPY(simulation);
  const directionalAdditionalCapitalJPY = Math.max(putAssignmentJPY, callHedgeJPY);

  const rows: Array<Pick<DenominatorResult, "mode" | "amountJPY" | "components">> = [
    {
      mode: "broker_margin_only",
      amountJPY: usedMarginJPY,
      components: [{ label: "バッファ後の使用証拠金", amountJPY: usedMarginJPY }],
    },
    {
      mode: "stock_plus_ticket_margin",
      amountJPY: stockJPY + ticketMarginJPY,
      components: [
        { label: "現物株時価", amountJPY: stockJPY },
        { label: "チケット表示証拠金", amountJPY: ticketMarginJPY },
      ],
    },
    {
      mode: "stock_plus_margin",
      amountJPY: stockJPY + usedMarginJPY,
      components: [
        { label: "現物株時価", amountJPY: stockJPY },
        { label: "バッファ後の使用証拠金", amountJPY: usedMarginJPY },
      ],
    },
    {
      mode: "cash_secured",
      amountJPY: stockJPY + putAssignmentJPY,
      components: [
        { label: "現物株時価", amountJPY: stockJPY },
        { label: "P権利行使時の追加買付資金", amountJPY: putAssignmentJPY },
      ],
    },
    {
      mode: "conservative_common",
      amountJPY: stockJPY + usedMarginJPY + directionalAdditionalCapitalJPY,
      components: [
        { label: "現物株時価", amountJPY: stockJPY },
        { label: "バッファ後の使用証拠金", amountJPY: usedMarginJPY },
        { label: "方向別追加資金の大きい方", amountJPY: directionalAdditionalCapitalJPY },
      ],
    },
  ];

  if (simulation.customDenominatorJPY !== undefined) {
    rows.push({
      mode: "custom",
      amountJPY: simulation.customDenominatorJPY,
      components: [{ label: "カスタム分母", amountJPY: simulation.customDenominatorJPY }],
    });
  }

  return rows.map((row) => ({
    ...row,
    label: getDenominatorLabel(row.mode),
    explanation: getDenominatorExplanation(row.mode),
    isPrimary: row.mode === simulation.denominatorMode,
    annualReturnPct: calculateAnnualReturnPercent({
      netProfitJPY: profitJPY,
      denominatorJPY: row.amountJPY,
      dte: simulation.dte,
    }),
    netAnnualReturnPct:
      netProfitJPY === undefined
        ? undefined
        : calculateAnnualReturnPercent({
            netProfitJPY,
            denominatorJPY: row.amountJPY,
            dte: simulation.dte,
          }),
  }));
}

export function getPrimaryDenominator(results: DenominatorResult[]): DenominatorResult {
  return results.find((result) => result.isPrimary) ?? results[0];
}
