import type { DenominatorResult, OptionLeg, TaxResult, TradeSimulation } from "@/types/domain";
import { calculateDashboardPremiumDisplay } from "@/domain/dashboardDisplay";
import { calculateCurrentPositionEstimate } from "@/domain/currentPositionEstimate";
import {
  calculateNetInitialPremiumJPY,
  calculateNetInitialPremiumUSD,
  calculatePremiumJPY,
  calculatePremiumUSD,
  calculateTotalFeesJPY,
  calculateTotalFeesUSD,
} from "@/domain/calculations";
import { formatJPY, formatNumber, formatPct, formatUSD } from "@/lib/format";
import type { FxQuote } from "@/lib/marketData";
import { formatCurrentEstimateFxEvidence } from "@/domain/currentEstimateFx";

type AnnualReturnFormulaProps = {
  simulation: TradeSimulation;
  primaryDenominator: DenominatorResult;
  taxResult: TaxResult;
  currentEstimateFxQuote?: FxQuote | null;
};

function legLabel(leg: OptionLeg): string {
  const side = leg.side === "sell" ? "売り" : "買い";
  const type = leg.type === "call" ? "C" : "P";
  return `${side} ${type} ${formatUSD(leg.strikeUSD)}`;
}

function signedLegPremiumJPY(leg: OptionLeg, fxRateJPY: number): number {
  const value = calculatePremiumJPY({
    premiumUSD: leg.premiumUSD,
    quantity: leg.quantity,
    fxRateJPY,
  });
  return leg.side === "sell" ? value : -value;
}

function formatComponent(component: DenominatorResult["components"][number]): string {
  if (component.label === "現物株時価" && component.amountJPY === 0) {
    return "現物株なし";
  }
  return `${component.label}: ${formatJPY(component.amountJPY)}`;
}

export function AnnualReturnFormula({
  simulation,
  primaryDenominator,
  taxResult,
  currentEstimateFxQuote,
}: AnnualReturnFormulaProps) {
  const premiumDisplay = calculateDashboardPremiumDisplay(simulation);
  const currentEstimate = calculateCurrentPositionEstimate(simulation, new Date(), currentEstimateFxQuote);
  if (currentEstimate.kind === "available") return <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"><h2 className="text-base font-bold text-slate-950">現在決済年率</h2><p className="mt-1 text-sm leading-6 text-slate-600">現在の反対売買候補価格による概算です。{currentEstimate.currency === "JPY" ? `概算損益 ${formatJPY(currentEstimate.profitJPY, { signed: true })}` : `合算概算損益 ${formatUSD(currentEstimate.profitUSD)}`} / {formatPct(currentEstimate.profitPct)}、年率 {formatPct(currentEstimate.annualizedReturnPct)}。{currentEstimate.currency === "JPY" ? formatCurrentEstimateFxEvidence(currentEstimate.fx) : ""}</p></section>;
  if (currentEstimate.kind === "missing") return <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"><h2 className="text-base font-bold text-slate-950">現在決済年率: 未計算</h2><p className="mt-1 text-sm leading-6 text-slate-600">{currentEstimate.reason}。建玉時ネット額を現在損益やプレミアム年率へ代用しません。</p></section>;
  if (premiumDisplay.annualReturnApplicability === "not_applicable_synthetic") {
    return (
      <section className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <h2 className="text-base font-bold text-slate-950">年率: 適用外</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          シンセティックは建玉時ネット支払額をプレミアム年率として評価しません。建玉時ネット額は現在損益ではありません。
        </p>
      </section>
    );
  }
  const usePremiumDisplay = premiumDisplay.basis !== "history";
  const premiumJPY = usePremiumDisplay ? premiumDisplay.premiumJPY : calculateNetInitialPremiumJPY(simulation);
  const premiumUSD = usePremiumDisplay ? premiumDisplay.premiumUSD : calculateNetInitialPremiumUSD(simulation);
  const totalFeesJPY = calculateTotalFeesJPY(simulation);
  const totalFeesUSD = calculateTotalFeesUSD(simulation);
  const denominatorJPY = primaryDenominator.amountJPY;
  const denominatorUSD = primaryDenominator.amountUSD ?? 0;
  const isN = simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT";
  const days = usePremiumDisplay ? premiumDisplay.dte : simulation.dte;
  const annualReturnPct =
    usePremiumDisplay && premiumDisplay.annualReturnPct !== undefined
      ? premiumDisplay.annualReturnPct
      : primaryDenominator.annualReturnPct;
  const periodReturnPct = isN ? (denominatorUSD > 0 ? (premiumUSD / denominatorUSD) * 100 : 0) : denominatorJPY > 0 ? (premiumJPY / denominatorJPY) * 100 : 0;
  const netProfitUSD =
    usePremiumDisplay && premiumDisplay.netAfterFeesUSD !== undefined
      ? premiumDisplay.netAfterFeesUSD
      : (simulation.referenceFxRateJPY ?? simulation.fxRateJPY) > 0
        ? taxResult.netProfitJPY / (simulation.referenceFxRateJPY ?? simulation.fxRateJPY)
        : 0;
  const netAnnualReturnPct =
    usePremiumDisplay && premiumDisplay.netAnnualReturnPct !== undefined
      ? premiumDisplay.netAnnualReturnPct
      : taxResult.netAnnualReturnPct;
  const netPeriodReturnPct = isN ? (denominatorUSD > 0 ? (netProfitUSD / denominatorUSD) * 100 : 0) : denominatorJPY > 0 ? (taxResult.netProfitJPY / denominatorJPY) * 100 : 0;

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <details>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
          <span>
            <span className="block text-base font-bold text-slate-950">年率換算の計算根拠</span>
            <span className="mt-1 block text-sm text-slate-600">
              {isN
                ? `${formatUSD(premiumUSD)} ÷ ${formatUSD(denominatorUSD)} × 365 ÷ ${days}日 = ${formatPct(annualReturnPct)}`
                : `${formatJPY(premiumJPY)} ÷ ${formatJPY(denominatorJPY)} × 365 ÷ ${days}日 = ${formatPct(annualReturnPct)}`}
            </span>
          </span>
          <span className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700">
            開く
          </span>
        </summary>
        <div className="border-t border-slate-200 px-4 py-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border border-slate-200 p-3">
              <h3 className="text-sm font-bold text-slate-900">使っている式</h3>
              <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                <p>
                  税前年率 = 受取プレミアム ÷ 使用分母 × 365 ÷ 建玉日から満期日までの日数 × 100
                </p>
                <p className="numeric-input font-semibold text-slate-950">
                  {isN ? formatUSD(premiumUSD) : formatJPY(premiumJPY)} ÷ {isN ? formatUSD(denominatorUSD) : formatJPY(denominatorJPY)} × 365 ÷ {days}日 × 100
                  = {formatPct(annualReturnPct)}
                </p>
                <p className="text-slate-600">
                  日数は {simulation.entryDate} から {simulation.expiryDate} までの暦日数です。営業日数ではありません。
                </p>
              </div>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <h3 className="text-sm font-bold text-slate-900">税引後年率の式</h3>
              <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                <p>
                  税引後年率 = 税引後利益 ÷ 使用分母 × 365 ÷ 日数 × 100
                </p>
                <p className="numeric-input font-semibold text-slate-950">
                  {isN ? formatUSD(netProfitUSD) : formatJPY(taxResult.netProfitJPY)} ÷ {isN ? formatUSD(denominatorUSD) : formatJPY(denominatorJPY)} × 365 ÷ {days}日 × 100
                  = {formatPct(netAnnualReturnPct)}
                </p>
                <p className="text-slate-600">
                  税引後利益は、受取プレミアムから手数料等 {isN ? `${formatUSD(totalFeesUSD)} / 参考 ${formatJPY(totalFeesJPY)}` : formatJPY(totalFeesJPY)} と概算税額 {formatJPY(taxResult.taxJPY)} を差し引いた値です。
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">分子: 受取プレミアム</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="py-2 pr-3">脚</th>
                      <th className="py-2 pr-3 text-right">計算</th>
                      <th className="py-2 pr-3 text-right">{isN ? "USD主計算" : "円換算"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simulation.optionLegs.map((leg) => {
                      const amountJPY = signedLegPremiumJPY(leg, simulation.fxRateJPY);
                      const amountUSD = calculatePremiumUSD({ premiumUSD: leg.premiumUSD, quantity: leg.quantity });
                      return (
                        <tr key={leg.id} className="border-b border-slate-100">
                          <td className="py-2 pr-3 font-semibold text-slate-900">{legLabel(leg)}</td>
                          <td className="numeric-input py-2 pr-3 text-right text-slate-600">
                            {formatUSD(leg.premiumUSD)} × 100 × {leg.quantity}{isN ? "" : ` × ${formatNumber(simulation.fxRateJPY)}`}
                          </td>
                          <td className="numeric-input py-2 pr-3 text-right font-semibold">{isN ? formatUSD(leg.side === "sell" ? amountUSD : -amountUSD) : formatJPY(amountJPY)}</td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td className="py-2 pr-3 font-bold text-slate-950">合計</td>
                      <td />
                      <td className="numeric-input py-2 pr-3 text-right font-bold text-slate-950">{isN ? formatUSD(premiumUSD) : formatJPY(premiumJPY)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">分母: {primaryDenominator.label}</h3>
              <dl className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
                {primaryDenominator.components.map((component) => (
                  <div key={`${component.label}-${component.amountJPY}`} className="flex justify-between gap-4 px-3 py-2">
                    <dt className="text-slate-600">{formatComponent(component).split(": ")[0]}</dt>
                    <dd className="numeric-input font-semibold text-slate-950">
                      {component.label === "現物株時価" && component.amountJPY === 0
                        ? "なし"
                        : component.amountUSD !== undefined
                          ? formatUSD(component.amountUSD)
                          : formatJPY(component.amountJPY)}
                    </dd>
                  </div>
                ))}
                <div className="flex justify-between gap-4 px-3 py-2">
                  <dt className="font-bold text-slate-950">合計分母</dt>
                  <dd className="numeric-input font-bold text-slate-950">{isN ? formatUSD(denominatorUSD) : formatJPY(denominatorJPY)}</dd>
                </div>
              </dl>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                分母を変えると年率は大きく変わります。現在の主分母は「{primaryDenominator.label}」です。
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                期間利回りは税前 {formatPct(periodReturnPct)}、税引後 {formatPct(netPeriodReturnPct)} です。これを年換算しています。
              </p>
              {isN ? (
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  N口座の式はUSD同士で計算しています。USD/JPYを更新しても、USD建て年率は変わりません。
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </details>
    </section>
  );
}
