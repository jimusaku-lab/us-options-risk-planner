import type { TradeSimulation } from "@/types/domain";
import type { AccountInputs, WorkspaceMode } from "@/store/useOptionsStore";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import { calculateNetInitialPremiumJPY } from "@/domain/calculations";
import { calculateDenominators, getPrimaryDenominator } from "@/domain/denominators";
import { generateRiskWarnings } from "@/domain/riskRules";
import { getStatusLabel, getStrategyLabel } from "@/domain/strategyLabels";
import { formatJPY, formatPct, formatUSD } from "@/lib/format";

const statusClassName = {
  planned: "bg-sky-100 text-sky-800",
  open: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-200 text-slate-700",
  assigned: "bg-violet-100 text-violet-800",
  expired: "bg-amber-100 text-amber-800",
};

const endedStatuses = new Set(["closed", "assigned", "expired"]);

export function Dashboard({
  simulations,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  workspace,
  accountInputs,
}: {
  simulations: TradeSimulation[];
  selectedId: string;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  workspace: WorkspaceMode;
  accountInputs: AccountInputs;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const currentSimulations = simulations.filter((simulation) => simulation.status === "planned" || simulation.status === "open");
  const historySimulations = simulations.filter((simulation) => endedStatuses.has(simulation.status));
  const visibleSimulations = [...currentSimulations, ...(showHistory ? historySimulations : [])];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-slate-950">建玉ダッシュボード</h2>
          <span
            className={`rounded px-2 py-0.5 text-xs font-bold ${
              workspace === "demo" ? "bg-sky-100 text-sky-800" : "bg-red-100 text-red-800"
            }`}
          >
            {workspace === "demo" ? "DEMO 実取引ではありません" : "REAL 実資金管理"}
          </span>
        </div>
        <span className="text-sm text-slate-500">登録済み {simulations.length}件</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">現在管理中 {currentSimulations.length}件</span>
          <span className="text-slate-500">注文前・建玉中を優先表示</span>
        </div>
        <button
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          onClick={() => setShowHistory((current) => !current)}
        >
          {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          履歴 {historySimulations.length}件を{showHistory ? "畳む" : "表示"}
        </button>
      </div>
      {simulations.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
          このワークスペースにはまだ建玉がありません。上部の「新規建玉」から、Saxo画面を見ながら建玉を登録できます。
        </div>
      ) : null}
      {simulations.length > 0 && currentSimulations.length === 0 ? (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          現在の注文前・建玉中の建玉はありません。過去の結果は「履歴を表示」から確認できます。
        </div>
      ) : null}
      {visibleSimulations.length > 0 ? <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-3">銘柄</th>
              <th className="py-2 pr-3">状態</th>
              <th className="py-2 pr-3">戦略</th>
              <th className="py-2 pr-3 text-right">権利行使価格</th>
              <th className="py-2 pr-3">満期</th>
              <th className="py-2 pr-3 text-right">プレミアム</th>
              <th className="py-2 pr-3 text-right">使用分母</th>
              <th className="py-2 pr-3 text-right">年率</th>
              <th className="py-2 pr-3 text-right">警告</th>
              <th className="py-2 pr-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleSimulations.map((simulation, index) => {
              const simulationWithAccount = {
                ...simulation,
                availableCashJPY: accountInputs.availableCashJPY,
                marginUsagePercent: accountInputs.marginUsagePercent,
              };
              const premium = calculateNetInitialPremiumJPY(simulationWithAccount);
              const primary = getPrimaryDenominator(calculateDenominators(simulationWithAccount, premium));
              const warnings = generateRiskWarnings(simulationWithAccount);
              const callLeg = simulation.optionLegs.find((leg) => leg.type === "call");
              const putLeg = simulation.optionLegs.find((leg) => leg.type === "put");
              const strikeLabel = [
                callLeg ? `C ${formatUSD(callLeg.strikeUSD)}` : "",
                putLeg ? `P ${formatUSD(putLeg.strikeUSD)}` : "",
              ].filter(Boolean).join(" / ") || "-";
              const blockingCount = warnings.filter((warning) => warning.blocking).length;
              const warningLabel =
                warnings.length === 0
                  ? "警告なし"
                  : `${blockingCount > 0 ? `NG${blockingCount}件` : "NGなし"}・注意${warnings.length}件`;
              const isFirstHistory = showHistory && index === currentSimulations.length && historySimulations.length > 0;
              return (
                <Fragment key={simulation.id}>
                {isFirstHistory ? (
                  <tr className="bg-slate-100">
                    <td colSpan={10} className="py-2 pr-3 text-xs font-bold text-slate-600">
                      履歴: 決済済み・権利行使済み・満期終了
                    </td>
                  </tr>
                ) : null}
                <tr
                  key={simulation.id}
                  className={`cursor-pointer border-b border-slate-100 ${
                    simulation.id === selectedId
                      ? "bg-teal-50"
                      : endedStatuses.has(simulation.status)
                        ? "bg-slate-50 text-slate-500 hover:bg-slate-100"
                        : "hover:bg-slate-50"
                  }`}
                  onClick={() => onSelect(simulation.id)}
                >
                  <td className="py-3 pr-3 font-bold text-slate-950">{simulation.ticker}</td>
                  <td className="py-3 pr-3">
                    <span className={`rounded px-2 py-1 text-xs font-bold ${statusClassName[simulation.status]}`}>
                      {getStatusLabel(simulation.status)}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-slate-700">{getStrategyLabel(simulation.strategyType)}</td>
                  <td className="numeric-input py-3 pr-3 text-right font-semibold text-slate-700">{strikeLabel}</td>
                  <td className="py-3 pr-3 text-slate-700">{simulation.expiryDate}</td>
                  <td className="numeric-input py-3 pr-3 text-right font-semibold">{formatJPY(premium)}</td>
                  <td className="numeric-input py-3 pr-3 text-right font-semibold">{formatJPY(primary.amountJPY)}</td>
                  <td className="numeric-input py-3 pr-3 text-right font-semibold">{formatPct(primary.annualReturnPct)}</td>
                  <td
                    className={`py-3 pr-3 text-right text-xs font-bold ${
                      blockingCount > 0 ? "text-red-700" : warnings.length > 0 ? "text-amber-700" : "text-emerald-700"
                    }`}
                    title="NGは注文前に解消すべき重大警告、注意は確認項目です。"
                  >
                    {warningLabel}
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <button
                      className="mr-2 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-2 text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"
                      title="この建玉を編集"
                      onClick={(event) => {
                        event.stopPropagation();
                        onEdit(simulation.id);
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-2 text-slate-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                      title="この建玉を削除"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(simulation.id);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div> : null}
    </section>
  );
}
