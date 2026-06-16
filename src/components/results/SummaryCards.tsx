import type { CoveredCallAssignmentPreview } from "@/domain/coveredCallAssignment";
import type { DenominatorResult, RiskWarning, StockTransferEvent, TaxResult, TradeSimulation } from "@/types/domain";
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
  primaryWarning?: RiskWarning;
  onWarningAction?: (warning: RiskWarning) => void;
  historyMode?: boolean;
  stockHoldingMode?: boolean;
  denominatorFormula?: string;
  stockTransfer?: StockTransferEvent;
};

export function SummaryCards({
  simulation,
  primaryDenominator,
  taxResult,
  blockingCount,
  coveredCallAssignmentPreview,
  primaryWarning,
  onWarningAction,
  historyMode = false,
  stockHoldingMode = false,
  denominatorFormula,
  stockTransfer,
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
  const isTransferredToN = Boolean(stockTransfer);
  const statusCardValue = stockHoldingMode
    ? isTransferredToN
      ? "P→N移管済み / N口座で株式保有中"
      : "P口座で株式取得済み"
    : primaryWarning
      ? "入力要確認"
      : "入力完了";
  const statusCardNote = stockHoldingMode
    ? isTransferredToN
      ? `P→N株式移管は記録済みです。現在はN口座で${simulation.ticker} ${stockTransfer?.shares ?? simulation.stockAcquisition?.shares ?? 0}株を保有しています。JSONバックアップを保存してください。カバードコールを始める場合はC売り候補を確認します。`
      : "P→N移管記録待ち。N口座へ移管した場合だけ移管記録へ進みます。"
    : primaryWarning
      ? primaryWarning.message
      : "必要な実績入力は完了しています。JSONバックアップを保存してください。";

  const cards = [
    {
      title: historyMode ? "確定プレミアム" : "受取プレミアム",
      value: isN ? formatUSD(premiumUSD) : formatJPY(premiumJPY),
      note: isN
        ? `N口座のUSD主計算。参考JPY ${formatJPY(premiumJPY)}。`
        : "P口座JPY決済。手数料・税金は別カードで控除します。",
    },
    ...(!historyMode && coveredCallAssignmentPreview
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
      title: historyMode ? "実績分母" : "使用分母",
      value: primaryDenominator.currency === "USD" ? formatUSD(primaryDenominator.amountUSD ?? 0) : formatJPY(primaryDenominator.amountJPY),
      note: [
        primaryDenominator.currency === "USD"
          ? `${primaryDenominator.label}。参考JPY ${formatJPY(primaryDenominator.amountJPY)}。`
          : primaryDenominator.label,
        denominatorFormula,
      ].filter(Boolean).join(" / "),
    },
    {
      title: "年率",
      value: `${formatPct(primaryDenominator.annualReturnPct)} / ${formatPct(taxResult.netAnnualReturnPct)}`,
      note: `税前 / 税引後。${simulation.dte}日換算。`,
    },
    ...(!historyMode
      ? [
          {
            title: "P権利行使時の追加買付資金",
            value: isN ? formatUSD(putAssignmentUSD) : formatJPY(putAssignmentJPY),
            note: isN ? `N口座内のUSD買付資金。参考JPY ${formatJPY(putAssignmentJPY)}。` : "権利行使された場合に株を買い受けるための概算資金です。",
          },
        ]
      : []),
    {
      title: historyMode ? "状態確認" : "最大注意点",
      value: historyMode ? statusCardValue : blockingCount > 0 ? `${blockingCount}件NG` : "注文前NGなし",
      note: historyMode
        ? statusCardNote
        : primaryWarning
          ? primaryWarning.message
          : isN
            ? `チケット証拠金 ${formatUSD(simulation.brokerMarginUSD ?? 0)} / 使用証拠金 ${formatUSD(usedMarginUSD)}`
            : `チケット証拠金 ${formatJPY(simulation.brokerMarginJPY)} / 使用証拠金 ${formatJPY(usedMarginJPY)}`,
      warning: primaryWarning,
    },
  ];

  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <div key={card.title} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500">{card.title}</div>
          <div className="mt-2 text-2xl font-bold tracking-normal text-slate-950">{card.value}</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{card.note}</p>
          {!historyMode && "warning" in card && card.warning?.actionAnchorId ? (
            <button
              className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              onClick={() => {
                if ("warning" in card && card.warning) onWarningAction?.(card.warning);
              }}
            >
              {card.warning.actionLabel ?? "反対売買判断へ"}
            </button>
          ) : null}
        </div>
      ))}
    </section>
  );
}
