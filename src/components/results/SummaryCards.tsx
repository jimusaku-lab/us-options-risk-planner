import type { CoveredCallAssignmentPreview } from "@/domain/coveredCallAssignment";
import type { DenominatorResult, RiskWarning, StockTransferEvent, TaxResult, TradeSimulation } from "@/types/domain";
import type { AccountInputs } from "@/store/useOptionsStore";
import {
  calculateNetInitialPremiumJPY,
  calculateNetInitialPremiumUSD,
  calculatePutAssignmentCapitalTotalJPY,
  calculatePutAssignmentCapitalTotalUSD,
  calculateUsedMarginJPY,
  calculateUsedMarginUSD,
} from "@/domain/calculations";
import { calculateDashboardPremiumDisplay, type LongOptionOrderDisplay } from "@/domain/dashboardDisplay";
import { formatJPY, formatPct, formatUSD } from "@/lib/format";

function formatReferenceJPY(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) && Math.abs(value) > 0.5
    ? `参考JPY ${formatJPY(value)}`
    : "参考JPY未計算";
}

function formatSignedUSD(value: number): string {
  return `${value > 0 ? "+" : ""}${formatUSD(value)}`;
}

function buildLongOptionExitProceedsValue(simulation: TradeSimulation, longOptionDisplay: LongOptionOrderDisplay): string {
  const preview = longOptionDisplay.exitProceedsPreview;
  if (!preview) return "現在価格未入力";
  if (simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT") {
    return `手数料後 ${formatUSD(preview.netUSD)}`;
  }
  return preview.netJPY !== undefined ? `手数料後 ${formatJPY(preview.netJPY)}` : "手数料後 参考JPY未計算";
}

function buildLongOptionExitProceedsNote(simulation: TradeSimulation, longOptionDisplay: LongOptionOrderDisplay): string {
  const preview = longOptionDisplay.exitProceedsPreview;
  if (!preview) return "現在オプション価格を入れると、反対売買時の参考受取額を表示します。";
  const grossJpy = preview.grossJPY !== undefined ? formatJPY(preview.grossJPY) : "参考JPY未計算";
  const netJpy = preview.netJPY !== undefined ? formatJPY(preview.netJPY) : "参考JPY未計算";
  if (simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT") {
    return `手数料前 ${formatUSD(preview.grossUSD)} / 手数料後 ${formatUSD(preview.netUSD)}。参考 ${netJpy}。`;
  }
  return `手数料前 ${grossJpy} / ${formatUSD(preview.grossUSD)}。手数料後 ${netJpy} / ${formatUSD(preview.netUSD)}。`;
}

function buildLongOptionExitCashValue(
  simulation: TradeSimulation,
  accountInputs: AccountInputs | undefined,
  longOptionDisplay: LongOptionOrderDisplay,
): string {
  const preview = longOptionDisplay.exitProceedsPreview;
  const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
  const account = accountInputs?.[isN ? "N" : "P"];
  if (!account) return isN ? "N口座USD現金 未取得" : "P口座現金残高 未取得";
  if (!preview) {
    return isN ? `現在 ${formatUSD(account.cashBalance)}` : `現在 ${formatJPY(account.cashBalance)}`;
  }
  if (isN) {
    return `現在 ${formatUSD(account.cashBalance)} / 決済後見込み ${formatUSD(account.cashBalance + preview.netUSD)}`;
  }
  if (preview.netJPY === undefined) {
    return `現在 ${formatJPY(account.cashBalance)} / 決済後見込み 参考JPY未計算`;
  }
  return `現在 ${formatJPY(account.cashBalance)} / 決済後見込み ${formatJPY(account.cashBalance + preview.netJPY)}`;
}

function buildLongOptionExitCashNote(simulation: TradeSimulation): string {
  if (simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT") {
    return "決済前プレビューです。正式なUSD現金残高は決済実績保存後に更新します。";
  }
  return "決済前プレビューです。正式なP口座JPY現金残高は決済実績保存後に更新します。N口座USD残高とは混ぜません。";
}

type FundingSource = {
  amount: number;
  label: string;
};

function getFundingSource(accountInputs: AccountInputs | undefined, simulation: TradeSimulation): FundingSource | undefined {
  const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
  const account = accountInputs?.[isN ? "N" : "P"];
  if (account) {
    if (Number.isFinite(account.cashBalance) && account.cashBalance > 0) {
      return {
        amount: account.cashBalance,
        label: isN ? "N口座USD現金" : "P口座JPY現金",
      };
    }
  }

  if (simulation.availableCashJPY === undefined || simulation.availableCashJPY <= 0) return undefined;
  if (!isN) {
    return { amount: simulation.availableCashJPY, label: "P口座JPY現金" };
  }
  const fxRate = simulation.referenceFxRateJPY ?? simulation.fxRateJPY;
  if (!Number.isFinite(fxRate) || fxRate <= 0) return undefined;
  return { amount: simulation.availableCashJPY / fxRate, label: "N口座USD現金" };
}

export function buildPutAssignmentFundingNote(
  simulation: TradeSimulation,
  putAssignmentJPY: number,
  putAssignmentUSD: number,
  accountInputs?: AccountInputs,
): string {
  const fxRate = simulation.referenceFxRateJPY ?? simulation.fxRateJPY;
  const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
  const shortPutLeg = simulation.optionLegs.find((leg) => leg.type === "put" && leg.side === "sell");
  const strikeText = shortPutLeg ? `P${shortPutLeg.strikeUSD} × ${shortPutLeg.quantity * 100}株。` : "";
  const baseNote = strikeText;
  const fundingSource = getFundingSource(accountInputs, simulation);
  if (isN) {
    if (!fundingSource || putAssignmentUSD <= 0) return `${baseNote}資金確認: 未確認。N口座USD現金を取得してください。`;
    const differenceUSD = fundingSource.amount - putAssignmentUSD;
    return differenceUSD >= 0
      ? `${baseNote}資金確認: 充足。${fundingSource.label} ${formatUSD(fundingSource.amount)} / 余裕 ${formatUSD(differenceUSD)}。`
      : `${baseNote}資金確認: 不足。${fundingSource.label} ${formatUSD(fundingSource.amount)} / 不足 ${formatUSD(Math.abs(differenceUSD))}。`;
  }
  const requiredJPY = putAssignmentJPY > 0
    ? putAssignmentJPY
    : putAssignmentUSD > 0 && Number.isFinite(fxRate) && fxRate > 0
      ? putAssignmentUSD * fxRate
      : 0;
  if (!fundingSource || requiredJPY <= 0) {
    return `${baseNote}資金確認: 未確認。P口座JPY現金を取得してください。`;
  }
  const differenceJPY = fundingSource.amount - requiredJPY;
  return differenceJPY >= 0
    ? `${baseNote}資金確認: 充足。${fundingSource.label} ${formatJPY(fundingSource.amount)} / 余裕 ${formatJPY(differenceJPY)}。`
    : `${baseNote}資金確認: 不足。${fundingSource.label} ${formatJPY(fundingSource.amount)} / 不足 ${formatJPY(Math.abs(differenceJPY))}。`;
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
  accountInputs?: AccountInputs;
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
  accountInputs,
}: SummaryCardsProps) {
  const premiumDisplay = calculateDashboardPremiumDisplay(simulation);
  const usePremiumDisplay = !historyMode && premiumDisplay.basis !== "history";
  const isSyntheticAnnualRateNotApplicable = premiumDisplay.annualReturnApplicability === "not_applicable_synthetic";
  const longOptionDisplay = usePremiumDisplay ? premiumDisplay.longOptionOrderDisplay : undefined;
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
    ? longOptionDisplay
      ? [
          `${premiumDisplay.label} ${formatUSD(longOptionDisplay.paidPremiumUSD)}。`,
          `手数料込み ${formatUSD(longOptionDisplay.totalCostUSD)}。`,
          isN ? `${formatReferenceJPY(longOptionDisplay.totalCostJPY)}。` : "",
        ].filter(Boolean).join(" ")
      : [
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
    longOptionDisplay
      ? `-${formatUSD(longOptionDisplay.totalCostUSD)}`
      : summaryDenominatorCurrency === "USD" ? formatUSD(summaryDenominatorUSD ?? 0) : formatJPY(summaryDenominatorJPY);
  const denominatorCardNote = longOptionDisplay
    ? `支払プレミアムと建玉時手数料の合計です。${formatReferenceJPY(longOptionDisplay.totalCostJPY)}。`
    : usePremiumDisplay && premiumDisplay.coveredCallAssignmentEstimate
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
    isSyntheticAnnualRateNotApplicable
      ? "適用外"
      : longOptionDisplay
      ? formatUSD(longOptionDisplay.breakevenUSD)
      : usePremiumDisplay && premiumDisplay.annualReturnPct !== undefined
      ? `予定 ${formatPct(premiumDisplay.annualReturnPct)}${
          premiumDisplay.netAnnualReturnPct !== undefined ? ` / 手数料後 ${formatPct(premiumDisplay.netAnnualReturnPct)}` : ""
        }`
      : `${formatPct(primaryDenominator.annualReturnPct)} / ${formatPct(taxResult.netAnnualReturnPct)}`;
  const annualCardNote = longOptionDisplay
    ? [
        `${longOptionDisplay.currentPriceUSD !== undefined ? `現在株価 ${formatUSD(longOptionDisplay.currentPriceUSD)}` : "現在株価未取得"} / 権利行使価格 ${formatUSD(longOptionDisplay.strikeUSD)}。`,
        `満期まで${premiumDisplay.dte}日。`,
        `利確/損切りライン ${formatUSD(longOptionDisplay.profitTargetPriceUSD)} / ${formatUSD(longOptionDisplay.stopLossPriceUSD)}。`,
      ].join(" ")
    : isSyntheticAnnualRateNotApplicable
    ? "シンセティックは建玉時ネット支払額をプレミアム年率として評価しません。現在損益ではありません。"
    : usePremiumDisplay && premiumDisplay.annualReturnPct !== undefined
    ? `プレミアム年率。${premiumDisplay.dte}日換算。権利行使時想定は別カードで確認します。`
    : historyMode
      ? historyAnnualFormula
      : `税前 / 税引後。${simulation.dte}日換算。`;
  const assignmentEstimate = usePremiumDisplay ? premiumDisplay.coveredCallAssignmentEstimate : undefined;

  const cards = [
    {
      title: longOptionDisplay
        ? "反対売買損益分岐価格"
        : isSyntheticAnnualRateNotApplicable ? premiumDisplay.label : historyMode ? "この履歴の確定オプション収入" : "受取プレミアム",
      value: longOptionDisplay
        ? longOptionDisplay.exitBreakevenPriceUSD === undefined ? "未計算（決済想定手数料 未確認）" : `${formatUSD(longOptionDisplay.exitBreakevenPriceUSD)} / 株`
        : isN ? formatUSD(premiumUSD) : formatJPY(premiumJPY),
      note: longOptionDisplay
        ? longOptionDisplay.closeCommissionUSD === undefined ? "決済想定手数料が未確認のため、損益分岐価格は計算しません。" : `この価格以上で売却できれば、建玉時支払額と想定決済手数料を回収できます。建玉時支払額 ${formatUSD(longOptionDisplay.totalCostUSD)} / 想定決済手数料 ${formatUSD(longOptionDisplay.closeCommissionUSD)}。`
        : premiumCardNote,
    },
    ...(longOptionDisplay
      ? [
          {
            title: "現在オプション価格",
            value: longOptionDisplay.closePriceUSD !== undefined ? `${formatUSD(longOptionDisplay.closePriceUSD)} / 株` : "未入力",
            note: [
              longOptionDisplay.exitBreakevenBufferUSD !== undefined
                ? `損益分岐までの余裕 ${formatSignedUSD(longOptionDisplay.exitBreakevenBufferUSD)} / 株。`
                : "SaxoTraderGOのBid、または実際に使う売却指値を手入力してください。",
              `利確/損切りライン ${formatUSD(longOptionDisplay.profitTargetPriceUSD)} / ${formatUSD(longOptionDisplay.stopLossPriceUSD)}。`,
            ].join(" "),
          },
          {
            title: "反対売買時の参考受取額",
            value: buildLongOptionExitProceedsValue(simulation, longOptionDisplay),
            note: buildLongOptionExitProceedsNote(simulation, longOptionDisplay),
          },
          {
            title: simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "N口座USD現金残高" : "P口座現金残高",
            value: buildLongOptionExitCashValue(simulation, accountInputs, longOptionDisplay),
            note: buildLongOptionExitCashNote(simulation),
          },
          {
            title: "現在決済ベース",
            value:
              longOptionDisplay.estimatedProfitUSD === undefined
                ? "未計算"
                : `${formatSignedUSD(longOptionDisplay.estimatedProfitUSD)} / ${
                    longOptionDisplay.currentCloseAnnualizedReturnPct !== undefined
                      ? `${longOptionDisplay.currentCloseAnnualizedReturnPct > 0 ? "+" : ""}${formatPct(longOptionDisplay.currentCloseAnnualizedReturnPct)}`
                      : "年率未計算"
                  }`,
            note: [
              longOptionDisplay.profitPct !== undefined
                ? `評価損益率 ${longOptionDisplay.profitPct > 0 ? "+" : ""}${formatPct(longOptionDisplay.profitPct)}。`
                : "評価損益率 未計算。",
              `残存日数 ${longOptionDisplay.remainingDays}日。`,
            ].join(" "),
          },
        ]
      : []),
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
      title: longOptionDisplay
        ? "支払済みリスク上限"
        : historyMode ? "この履歴の年率分母" : "使用分母",
      value: usePremiumDisplay ? denominatorCardValue : historyDenominatorValue,
      note: longOptionDisplay
        ? `${denominatorCardNote} 満期まで放置して無価値になった場合の理論上限で、通常運用では反対売買判断で管理します。`
        : denominatorCardNote,
    },
    {
      title: longOptionDisplay
        ? "満期損益分岐点（参考）"
        : isSyntheticAnnualRateNotApplicable ? "年率" : historyMode ? "この履歴のオプション年率" : "年率",
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
            title: "権利行使時に必要な買付資金",
            value: isN ? formatUSD(putAssignmentUSD) : formatJPY(putAssignmentJPY),
            note: buildPutAssignmentFundingNote(simulation, putAssignmentJPY, putAssignmentUSD, accountInputs),
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
