import type { CoveredCallAssignmentPreview } from "@/domain/coveredCallAssignment";
import type { DenominatorResult, TaxResult, TradeSimulation } from "@/types/domain";
import {
  calculateNetInitialPremiumJPY,
  calculatePutAssignmentCapitalTotalJPY,
  calculateUsedMarginJPY,
} from "@/domain/calculations";
import { formatJPY, formatPct } from "@/lib/format";

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
  const putAssignmentJPY = calculatePutAssignmentCapitalTotalJPY(simulation);
  const usedMarginJPY = calculateUsedMarginJPY({
    brokerMarginJPY: simulation.brokerMarginJPY,
    marginBufferMultiplier: simulation.marginBufferMultiplier,
  });

  const cards = [
    {
      title: "受取プレミアム",
      value: formatJPY(premiumJPY),
      note: "C/P売りの合計。手数料・税金は別カードで控除します。",
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
      value: formatJPY(primaryDenominator.amountJPY),
      note: primaryDenominator.label,
    },
    {
      title: "年率",
      value: `${formatPct(primaryDenominator.annualReturnPct)} / ${formatPct(taxResult.netAnnualReturnPct)}`,
      note: `税前 / 税引後。${simulation.dte}日換算。`,
    },
    {
      title: "P権利行使時の追加買付資金",
      value: formatJPY(putAssignmentJPY),
      note: "権利行使された場合に株を買い受けるための概算資金です。",
    },
    {
      title: "最大注意点",
      value: blockingCount > 0 ? `${blockingCount}件NG` : "注文前NGなし",
      note: `チケット証拠金 ${formatJPY(simulation.brokerMarginJPY)} / 使用証拠金 ${formatJPY(usedMarginJPY)}`,
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
