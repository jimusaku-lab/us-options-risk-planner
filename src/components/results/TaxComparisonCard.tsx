import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { NisaComparison, StockSettlementTaxResult, TaxBucketSummary, TaxResult } from "@/types/domain";
import { formatJPY, formatPct } from "@/lib/format";
import { TaxBucketSummaryCard } from "./TaxBucketSummaryCard";

export function TaxComparisonCard({
  taxResult,
  nisaComparison,
  stockSettlementTax,
  taxBucketSummary,
}: {
  taxResult: TaxResult;
  nisaComparison: NisaComparison;
  stockSettlementTax: StockSettlementTaxResult;
  taxBucketSummary: TaxBucketSummary;
}) {
  const [showHistorySummary, setShowHistorySummary] = useState(false);
  const hasStockSettlement = stockSettlementTax.enabled;
  return (
    <section className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">オプション税引後カード</h2>
        <dl className="mt-4 grid gap-3 text-sm">
          <Row label="税務上の想定区分" value="先物取引に係る雑所得等" />
          <Row label="税前利益" value={formatJPY(taxResult.grossProfitJPY)} />
          <Row label="手数料・費用控除後利益" value={formatJPY(taxResult.feeAdjustedProfitJPY)} />
          <Row label="課税対象利益" value={formatJPY(taxResult.taxableProfitJPY)} />
          <Row label="想定税額" value={formatJPY(taxResult.taxJPY)} tone="red" />
          <Row label="税引後利益" value={formatJPY(taxResult.netProfitJPY)} tone="green" />
          <Row label="税前年率" value={formatPct(taxResult.grossAnnualReturnPct)} />
          <Row label="税引後年率" value={formatPct(taxResult.netAnnualReturnPct)} tone="green" />
        </dl>
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm leading-6 text-amber-950">
          この税額は、オプション損益を「先物取引に係る雑所得等」として扱う前提の概算です。証券会社、口座種別、商品区分、決済方法により確認が必要です。
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">NISA等の非課税口座比較</h2>
        <dl className="mt-4 grid gap-3 text-sm">
          <Row label="NISA等の比較対象年率" value={formatPct(nisaComparison.expectedAnnualReturnPct)} />
          <Row label="NISA等で同じ分母・同じ日数なら" value={formatJPY(nisaComparison.comparisonProfitJPY)} />
          <Row
            label="オプション税引後利益との差額"
            value={formatJPY(nisaComparison.netAdvantageJPY, { signed: true })}
            tone={nisaComparison.netAdvantageJPY >= 0 ? "green" : "red"}
          />
          <Row label="NISA等を上回るための税前利益" value={formatJPY(nisaComparison.requiredGrossProfitToBeatJPY)} />
          <Row label="必要な税前年率（NISA等を上回る目安）" value={formatPct(nisaComparison.requiredGrossAnnualReturnPct)} />
        </dl>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-950">税務区分別の内訳</h2>
          <button
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => setShowHistorySummary((current) => !current)}
          >
            {showHistorySummary ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            履歴集計
          </button>
        </div>
        <dl className="mt-4 grid gap-3 text-sm">
          <Row
            label="先物取引に係る雑所得等"
            value={formatJPY(taxResult.feeAdjustedProfitJPY, { signed: true })}
            tone={taxResult.feeAdjustedProfitJPY >= 0 ? "green" : "red"}
          />
          <Row
            label="上場株式等の譲渡所得等"
            value={hasStockSettlement ? formatJPY(stockSettlementTax.realizedGainJPY, { signed: true }) : "未集計"}
            tone={hasStockSettlement ? (stockSettlementTax.realizedGainJPY >= 0 ? "green" : "red") : undefined}
          />
          <Row label="配当所得・外国税額控除" value="未集計" />
        </dl>
        {hasStockSettlement ? (
          <dl className="mt-4 grid gap-2 rounded-md bg-emerald-50 p-3 text-sm">
            <Row label="現物売却代金" value={formatJPY(stockSettlementTax.grossProceedsJPY)} />
            <Row label="現物取得原価" value={formatJPY(stockSettlementTax.costBasisJPY)} />
            <Row label="売却手数料" value={formatJPY(stockSettlementTax.feesJPY)} />
            <Row label="譲渡益への概算税額" value={formatJPY(stockSettlementTax.estimatedTaxJPY)} tone="red" />
            <Row label="譲渡損益の年率" value={formatPct(stockSettlementTax.annualReturnPct)} />
            <Row label="保有日数" value={`${stockSettlementTax.holdingDays}日`} />
            <Row
              label="税引後の譲渡損益"
              value={formatJPY(stockSettlementTax.afterTaxGainJPY, { signed: true })}
              tone={stockSettlementTax.afterTaxGainJPY >= 0 ? "green" : "red"}
            />
          </dl>
        ) : null}
        <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-700">
          <p className="font-semibold text-slate-950">自動相殺しません</p>
          <p className="mt-1">
            投資管理上は現物株とオプションを同じ戦略で見ますが、税務上は株式売却損益とオプション損益を別区分で扱います。
          </p>
          <p className="mt-1">
            このアプリでは、株式等に係る譲渡所得等と先物取引に係る雑所得等を自動で損益通算しません。
          </p>
        </div>
      </div>
      </div>
      {showHistorySummary ? <TaxBucketSummaryCard summary={taxBucketSummary} /> : null}
    </section>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const toneClass = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "text-slate-950";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
      <dt className="text-slate-600">{label}</dt>
      <dd className={`numeric-input text-right font-bold ${toneClass}`}>{value}</dd>
    </div>
  );
}
