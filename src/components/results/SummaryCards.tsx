import type { CoveredCallAssignmentPreview } from "@/domain/coveredCallAssignment";
import type { DenominatorResult, TaxResult, TradeSimulation } from "@/types/domain";
import {
  calculateNetInitialPremiumJPY,
  calculateNetInitialPremiumUSD,
  calculatePutAssignmentCapitalTotalJPY,
  calculatePutAssignmentCapitalTotalUSD,
  calculateUsedMarginJPY,
  calculateUsedMarginUSD,
} from "@/domain/calculations";
import { formatJPY, formatPct, formatUSD } from "@/lib/format";

type SummaryCardsProps = {
  simulation: TradeSimulation;
  primaryDenominator: DenominatorResult;
  taxResult: TaxResult;
  blockingCount: number;
  coveredCallAssignmentPreview?: CoveredCallAssignmentPreview | null;
};

export function SummaryCards({
  simulation,
  primaryDenominator,
  taxResult,
  blockingCount,
  coveredCallAssignmentPreview,
}: SummaryCardsProps) {
  const premiumJPY = calculateNetInitialPremiumJPY(simulation);
  const premiumUSD = calculateNetInitialPremiumUSD(simulation);
  const putAssignmentJPY = calculatePutAssignmentCapitalTotalJPY(simulation);
  const putAssignmentUSD = calculatePutAssignmentCapitalTotalUSD(simulation);
  const usedMarginJPY = calculateUsedMarginJPY({
    brokerMarginJPY: simulation.brokerMarginJPY,
    marginBufferMultiplier: simulation.marginBufferMultiplier,
  });
  const usedMarginUSD = calculateUsedMarginUSD(simulation);
  const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";

  const cards = [
    {
      title: "受取プレミアム",
      value: isN ? formatUSD(premiumUSD) : formatJPY(premiumJPY),
      note: isN
        ? `N口座のUSD主計算。参考JPY ${formatJPY(premiumJPY)}。`
        : "P口座JPY決済。手数料・税金は別カードで控除します。",
    },
    ...(coveredCallAssignmentPreview
      ? [
          {
            title: "満期想定損益",
            value: formatJPY(coveredCallAssignmentPreview.combinedBeforeTaxJPY, { signed: true }),
            note: `株を渡す想定: 現物 ${formatJPY(
              coveredCallAssignmentPreview.stockCapitalGainJPY,
              { signed: true },
            )} + プレミアム ${formatJPY(coveredCallAssignmentPreview.optionPremiumBeforeTaxJPY, { signed: true })}`,
          },
        ]
      : []),
    {
      title: "使用分母",
      value: primaryDenominator.currency === "USD" ? formatUSD(primaryDenominator.amountUSD ?? 0) : formatJPY(primaryDenominator.amountJPY),
      note: primaryDenominator.currency === "USD" ? `${primaryDenominator.label}。参考JPY ${formatJPY(primaryDenominator.amountJPY)}。` : primaryDenominator.label,
    },
    {
      title: "年率",
      value: `${formatPct(primaryDenominator.annualReturnPct)} / ${formatPct(taxResult.netAnnualReturnPct)}`,
      note: `税前 / 税引後。${simulation.dte}日換算。`,
    },
    {
      title: "P権利行使時の追加買付資金",
      value: isN ? formatUSD(putAssignmentUSD) : formatJPY(putAssignmentJPY),
      note: isN ? `N口座内のUSD買付資金。参考JPY ${formatJPY(putAssignmentJPY)}。` : "権利行使された場合に株を買い受けるための概算資金です。",
    },
    {
      title: "最大注意点",
      value: blockingCount > 0 ? `${blockingCount}件NG` : "注文前NGなし",
      note: isN
        ? `チケット証拠金 ${formatUSD(simulation.brokerMarginUSD ?? 0)} / 使用証拠金 ${formatUSD(usedMarginUSD)}`
        : `チケット証拠金 ${formatJPY(simulation.brokerMarginJPY)} / 使用証拠金 ${formatJPY(usedMarginJPY)}`,
    },
  ];

  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <div key={card.title} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500">{card.title}</div>
          <div className="mt-2 text-2xl font-bold tracking-normal text-slate-950">{card.value}</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{card.note}</p>
        </div>
      ))}
    </section>
  );
}
