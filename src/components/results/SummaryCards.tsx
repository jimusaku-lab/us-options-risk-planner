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
import { calculateDashboardPremiumDisplay } from "@/domain/dashboardDisplay";
import { formatJPY, formatPct, formatUSD } from "@/lib/format";

function formatReferenceJPY(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) && Math.abs(value) > 0.5
    ? `参考JPY ${formatJPY(value)}`
    : "参考JPY未計算";
}

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
  hidePutAssignmentCard?: boolean;
  statusCardTitle?: string;
  okStatusValue?: string;
  okStatusNote?: string;
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
  hidePutAssignmentCard = false,
  statusCardTitle,
  okStatusValue,
  okStatusNote,
}: SummaryCardsProps) {
  const premiumDisplay = calculateDashboardPremiumDisplay(simulation);
  const usePremiumDisplay = !historyMode && premiumDisplay.basis !== "history";
  const premiumJPY = usePremiumDisplay ? premiumDisplay.premiumJPY : calculateNetInitialPremiumJPY(simulation);
  const premiumUSD = usePremiumDisplay ? premiumDisplay.premiumUSD : calculateNetInitialPremiumUSD(simulation);
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
  const historyDenominatorValue =
    primaryDenominator.currency === "USD" ? formatUSD(primaryDenominator.amountUSD ?? 0) : formatJPY(primaryDenominator.amountJPY);
  const historyAnnualFormula = `${formatJPY(taxResult.grossProfitJPY)} ÷ ${formatJPY(primaryDenominator.amountJPY)} × 365 ÷ ${Math.max(
    1,
    simulation.dte,
  )}日。左が税前、右が税引後。`;
  const historyModeNotice =
    "現在のN口座株式の損益ではありません。現物株の現在時価や移管後の損益は、この年率計算に含めていません。";
  const summaryDenominatorUSD =
    usePremiumDisplay && premiumDisplay.coveredCallAssignmentEstimate
      ? premiumDisplay.coveredCallAssignmentEstimate.costBasisDenominatorUSD
      : primaryDenominator.amountUSD;
  const summaryDenominatorJPY =
    usePremiumDisplay && premiumDisplay.coveredCallAssignmentEstimate && premiumDisplay.effectiveFxRateJPY
      ? premiumDisplay.coveredCallAssignmentEstimate.costBasisDenominatorUSD * premiumDisplay.effectiveFxRateJPY
      : primaryDenominator.amountJPY;
  const summaryDenominatorCurrency =
    usePremiumDisplay && premiumDisplay.coveredCallAssignmentEstimate ? "USD" : primaryDenominator.currency;
  const premiumCardNote = usePremiumDisplay
    ? [
        `${premiumDisplay.label}。`,
        premiumDisplay.netAfterFeesUSD !== undefined && Math.abs(premiumDisplay.netAfterFeesUSD - premiumDisplay.premiumUSD) > 0.005
          ? `手数料後 ${isN ? formatUSD(premiumDisplay.netAfterFeesUSD) : formatJPY(premiumDisplay.netAfterFeesJPY ?? 0)}。`
          : "",
        isN
          ? `${formatReferenceJPY(premiumDisplay.premiumJPY)}。`
          : "",
      ].filter(Boolean).join(" ")
    : isN
      ? `N口座のUSD主計算。${formatReferenceJPY(premiumJPY)}。`
      : historyMode
        ? "終了済みのP口座プット売りで確定したオプション収入です。"
        : "P口座JPY決済。手数料・税金は別カードで控除します。";
  const denominatorCardValue =
    summaryDenominatorCurrency === "USD" ? formatUSD(summaryDenominatorUSD ?? 0) : formatJPY(summaryDenominatorJPY);
  const denominatorCardNote = usePremiumDisplay && premiumDisplay.coveredCallAssignmentEstimate
    ? [
        `取得原価ベース。${formatUSD(premiumDisplay.coveredCallAssignmentEstimate.costBasisDenominatorUSD)}。`,
        `${formatReferenceJPY(summaryDenominatorJPY)}。`,
        premiumDisplay.coveredCallAssignmentEstimate.currentPriceDenominatorUSD !== undefined &&
        Math.abs(premiumDisplay.coveredCallAssignmentEstimate.currentPriceDenominatorUSD - premiumDisplay.coveredCallAssignmentEstimate.costBasisDenominatorUSD) > 0.005
          ? `参考: 現在株価ベース ${formatUSD(premiumDisplay.coveredCallAssignmentEstimate.currentPriceDenominatorUSD)}。`
          : "",
        denominatorFormula,
      ].filter(Boolean).join(" ")
    : [
        primaryDenominator.currency === "USD"
          ? `${primaryDenominator.label}。${formatReferenceJPY(primaryDenominator.amountJPY)}。`
          : primaryDenominator.label,
        denominatorFormula,
      ].filter(Boolean).join(" / ");
  const annualCardValue =
    usePremiumDisplay && premiumDisplay.annualReturnPct !== undefined
      ? `予定 ${formatPct(premiumDisplay.annualReturnPct)}${
          premiumDisplay.netAnnualReturnPct !== undefined ? ` / 手数料後 ${formatPct(premiumDisplay.netAnnualReturnPct)}` : ""
        }`
      : `${formatPct(primaryDenominator.annualReturnPct)} / ${formatPct(taxResult.netAnnualReturnPct)}`;
  const annualCardNote = usePremiumDisplay && premiumDisplay.annualReturnPct !== undefined
    ? `プレミアム年率。${premiumDisplay.dte}日換算。権利行使時想定は別カードで確認します。`
    : historyMode
      ? historyAnnualFormula
      : `税前 / 税引後。${simulation.dte}日換算。`;
  const assignmentEstimate = usePremiumDisplay ? premiumDisplay.coveredCallAssignmentEstimate : undefined;

  const cards = [
    {
      title: historyMode ? "この履歴の確定オプション収入" : "受取プレミアム",
      value: isN ? formatUSD(premiumUSD) : formatJPY(premiumJPY),
      note: premiumCardNote,
    },
    ...(!historyMode && coveredCallAssignmentPreview && !assignmentEstimate
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
      title: historyMode ? "この履歴の年率分母" : "使用分母",
      value: usePremiumDisplay ? denominatorCardValue : historyDenominatorValue,
      note: denominatorCardNote,
    },
    {
      title: historyMode ? "この履歴のオプション年率" : "年率",
      value: annualCardValue,
      note: annualCardNote,
    },
    ...(!historyMode && assignmentEstimate
      ? [
          {
            title: "権利行使時想定",
            value: assignmentEstimate.annualReturnPct !== undefined
              ? `想定年率 ${formatPct(assignmentEstimate.annualReturnPct)}${
                  assignmentEstimate.netAnnualReturnPct !== undefined ? ` / 手数料後 ${formatPct(assignmentEstimate.netAnnualReturnPct)}` : ""
                }`
              : "想定年率 未計算",
            note: [
              `株式売却益 ${formatUSD(assignmentEstimate.stockSaleGainUSD)}。`,
              `プレミアム込み想定益 ${formatUSD(assignmentEstimate.totalWithPremiumUSD)}。`,
              `手数料後想定益 ${formatUSD(assignmentEstimate.totalAfterFeesUSD)}。`,
              "満期時に株価が権利行使価格以上となり、株式が売却された場合の想定です。実績には含めません。",
            ].join(" "),
          },
        ]
      : []),
    ...(!historyMode && !hidePutAssignmentCard && (putAssignmentJPY > 0 || putAssignmentUSD > 0)
      ? [
          {
            title: "P権利行使時の追加買付資金",
            value: isN ? formatUSD(putAssignmentUSD) : formatJPY(putAssignmentJPY),
            note: isN ? `N口座内のUSD買付資金。${formatReferenceJPY(putAssignmentJPY)}。` : "権利行使された場合に株を買い受けるための概算資金です。",
          },
        ]
      : []),
    {
      title: historyMode ? "状態確認" : statusCardTitle ?? "最大注意点",
      value: historyMode ? statusCardValue : blockingCount > 0 ? `${blockingCount}件NG` : okStatusValue ?? "注文前NGなし",
      note: historyMode
        ? statusCardNote
        : primaryWarning
          ? primaryWarning.message
          : okStatusNote
            ? okStatusNote
          : isN
            ? (simulation.brokerMarginUSD ?? 0) > 0 || usedMarginUSD > 0
              ? `チケット証拠金 ${formatUSD(simulation.brokerMarginUSD ?? 0)} / 使用証拠金 ${formatUSD(usedMarginUSD)}`
              : "証拠金: 対象外または未計算"
            : simulation.brokerMarginJPY > 0 || usedMarginJPY > 0
              ? `チケット証拠金 ${formatJPY(simulation.brokerMarginJPY)} / 使用証拠金 ${formatJPY(usedMarginJPY)}`
              : "証拠金: 対象外または未計算",
      warning: primaryWarning,
    },
  ];

  return (
    <section className={historyMode ? "rounded-lg border border-amber-200 bg-amber-50/70 p-3" : ""}>
      {historyMode ? (
        <div className="mb-3">
          <h3 className="text-sm font-bold text-amber-950">終了済みプット売りの実績</h3>
          <p className="mt-1 text-xs leading-5 text-amber-900">
            下のカードは、この履歴のオプション実績です。現在保有中のN口座株式とは分けて確認します。
          </p>
          {stockHoldingMode && isTransferredToN ? (
            <p className="mt-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-semibold leading-5 text-amber-950">
              {historyModeNotice}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
      </div>
    </section>
  );
}
