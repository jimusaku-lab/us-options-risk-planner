import type { DenominatorResult, TradeSimulation } from "@/types/domain";
import {
  calculateAnnualReturnPercentByCurrency,
  calculateAnnualReturnPercent,
  calculateCallHedgeBuyCapitalJPY,
  calculateCallHedgeBuyCapitalUSD,
  calculatePutAssignmentCapitalTotalJPY,
  calculatePutAssignmentCapitalTotalUSD,
  calculateStockDenominatorForSimulationJPY,
  calculateStockDenominatorForSimulationUSD,
  calculateUsedMarginJPY,
  calculateUsedMarginUSD,
} from "./calculations";
import { getDenominatorExplanation, getDenominatorLabel } from "./strategyLabels";

export function calculateDenominators(
  simulation: TradeSimulation,
  profitJPY: number,
  netProfitJPY?: number,
): DenominatorResult[] {
  if (simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT") {
    return calculateDenominatorsUSD(simulation, profitJPY, netProfitJPY);
  }
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
    currency: "JPY",
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

function calculateDenominatorsUSD(
  simulation: TradeSimulation,
  profitJPY: number,
  netProfitJPY?: number,
): DenominatorResult[] {
  const fx =
    simulation.referenceFxRateJPY !== undefined && simulation.referenceFxRateJPY > 0
      ? simulation.referenceFxRateJPY
      : simulation.fxRateJPY > 0
        ? simulation.fxRateJPY
        : 0;
  const profitUSD = fx > 0 ? profitJPY / fx : 0;
  const netProfitUSD = netProfitJPY === undefined || fx <= 0 ? undefined : netProfitJPY / fx;
  const stockUSD = calculateStockDenominatorForSimulationUSD(simulation);
  const ticketMarginUSD = simulation.brokerMarginUSD ?? (simulation.fxRateJPY > 0 ? simulation.brokerMarginJPY / simulation.fxRateJPY : 0);
  const usedMarginUSD = calculateUsedMarginUSD(simulation);
  const putAssignmentUSD = calculatePutAssignmentCapitalTotalUSD(simulation);
  const callHedgeUSD = calculateCallHedgeBuyCapitalUSD(simulation);
  const directionalAdditionalCapitalUSD = Math.max(putAssignmentUSD, callHedgeUSD);

  const rows: Array<Pick<DenominatorResult, "mode" | "amountJPY" | "amountUSD" | "components">> = [
    {
      mode: "broker_margin_only",
      amountUSD: usedMarginUSD,
      amountJPY: usedMarginUSD * fx,
      components: [{ label: "バッファ後の使用証拠金", amountUSD: usedMarginUSD, amountJPY: usedMarginUSD * fx }],
    },
    {
      mode: "stock_plus_ticket_margin",
      amountUSD: stockUSD + ticketMarginUSD,
      amountJPY: (stockUSD + ticketMarginUSD) * fx,
      components: [
        { label: "現物株時価", amountUSD: stockUSD, amountJPY: stockUSD * fx },
        { label: "チケット表示証拠金", amountUSD: ticketMarginUSD, amountJPY: ticketMarginUSD * fx },
      ],
    },
    {
      mode: "stock_plus_margin",
      amountUSD: stockUSD + usedMarginUSD,
      amountJPY: (stockUSD + usedMarginUSD) * fx,
      components: [
        { label: "現物株時価", amountUSD: stockUSD, amountJPY: stockUSD * fx },
        { label: "バッファ後の使用証拠金", amountUSD: usedMarginUSD, amountJPY: usedMarginUSD * fx },
      ],
    },
    {
      mode: "cash_secured",
      amountUSD: stockUSD + putAssignmentUSD,
      amountJPY: (stockUSD + putAssignmentUSD) * fx,
      components: [
        { label: "現物株時価", amountUSD: stockUSD, amountJPY: stockUSD * fx },
        { label: "P権利行使時の追加買付資金", amountUSD: putAssignmentUSD, amountJPY: putAssignmentUSD * fx },
      ],
    },
    {
      mode: "conservative_common",
      amountUSD: stockUSD + usedMarginUSD + directionalAdditionalCapitalUSD,
      amountJPY: (stockUSD + usedMarginUSD + directionalAdditionalCapitalUSD) * fx,
      components: [
        { label: "現物株時価", amountUSD: stockUSD, amountJPY: stockUSD * fx },
        { label: "バッファ後の使用証拠金", amountUSD: usedMarginUSD, amountJPY: usedMarginUSD * fx },
        { label: "方向別追加資金の大きい方", amountUSD: directionalAdditionalCapitalUSD, amountJPY: directionalAdditionalCapitalUSD * fx },
      ],
    },
  ];

  return rows.map((row) => ({
    ...row,
    currency: "USD",
    label: getDenominatorLabel(row.mode),
    explanation: `${getDenominatorExplanation(row.mode)} N口座ではUSDを主計算にし、JPYは参考換算です。`,
    isPrimary: row.mode === simulation.denominatorMode,
    annualReturnPct: calculateAnnualReturnPercentByCurrency({
      netProfit: profitUSD,
      denominator: row.amountUSD ?? 0,
      dte: simulation.dte,
    }),
    netAnnualReturnPct:
      netProfitUSD === undefined
        ? undefined
        : calculateAnnualReturnPercentByCurrency({
            netProfit: netProfitUSD,
            denominator: row.amountUSD ?? 0,
            dte: simulation.dte,
          }),
  }));
}

export function getPrimaryDenominator(results: DenominatorResult[]): DenominatorResult {
  return results.find((result) => result.isPrimary) ?? results[0];
}
