import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { StockTransferEvent, WheelCycle, WheelEvent, WheelPhase } from "@/types/domain";
import { formatJPY, formatUSD } from "@/lib/format";

const phaseLabels: Record<WheelPhase, string> = {
  n_cash: "N現金待機",
  n_short_put: "Nプット売り",
  n_stock_holding: "N株式保有",
  n_covered_call: "Nカバードコール",
  n_called_away: "N株式売却",
  p_short_put: "Pプット売り",
  p_assigned_stock: "P株式取得",
  p_to_n_transfer_pending: "P→N移管待ち",
  cycle_closed: "サイクル終了",
};

const nRoute: WheelPhase[] = ["n_cash", "n_short_put", "n_stock_holding", "n_covered_call", "n_called_away"];
const pRoute: WheelPhase[] = ["p_short_put", "p_assigned_stock", "p_to_n_transfer_pending", "n_stock_holding", "n_covered_call"];

export function WheelPanel({
  cycles,
  events = [],
  stockTransfers = [],
  focusRequest,
  onCreateFromSelected,
  onCreateTransferFromSelected,
  selectedTransferRecorded,
}: {
  cycles: WheelCycle[];
  events?: WheelEvent[];
  stockTransfers?: StockTransferEvent[];
  focusRequest?: { ticker?: string; requestId: number } | null;
  onCreateFromSelected?: () => void;
  onCreateTransferFromSelected?: () => void;
  selectedTransferRecorded?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedTicker, setHighlightedTicker] = useState("");
  const sectionRef = useRef<HTMLElement | null>(null);
  const hasCycles = cycles.length > 0;
  useEffect(() => {
    if (!focusRequest) return;
    setIsOpen(true);
    const ticker = focusRequest.ticker?.toUpperCase() ?? "";
    setHighlightedTicker(ticker);
    window.setTimeout(() => {
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
    const timer = window.setTimeout(() => setHighlightedTicker(""), 5000);
    return () => window.clearTimeout(timer);
  }, [focusRequest]);
  return (
    <section id="wheel-management" ref={sectionRef} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-950">ホイール管理 {cycles.length}件</h2>
          {isOpen ? (
            <p className="mt-1 text-sm leading-6 text-slate-600">
              P口座段階はN口座ホイールへの合流準備として表示し、P→N移管後またはN口座建玉開始後だけN口座ホイール管理として扱います。
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedTransferRecorded ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
              P→N株式移管は記録済み
              <span className="ml-2 text-xs font-bold text-emerald-700">次: C売り候補を確認</span>
            </div>
          ) : onCreateTransferFromSelected ? (
            <button
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
              onClick={onCreateTransferFromSelected}
            >
              P→N株式移管を記録
            </button>
          ) : null}
          {onCreateFromSelected ? (
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={onCreateFromSelected}
            >
              選択建玉からサイクル作成
            </button>
          ) : null}
          <button
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => setIsOpen((current) => !current)}
          >
            {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {isOpen ? "畳む" : "開く"}
          </button>
        </div>
      </div>
      {isOpen && !hasCycles ? (
        <p className="mt-3 text-sm leading-6 text-slate-600">
          ホイールサイクルは未登録です。必要な場合だけ「選択建玉からサイクル作成」を押して登録します。
        </p>
      ) : null}
      {isOpen && hasCycles ? (
        <div className="mt-4 grid gap-3">
          {cycles.map((cycle) => (
            <WheelCycleCard
              key={cycle.id}
              cycle={cycle}
              events={events.filter((event) => event.wheelCycleId === cycle.id)}
              stockTransfers={stockTransfers.filter((transfer) => transfer.destinationWheelCycleId === cycle.id)}
              highlighted={Boolean(highlightedTicker) && cycle.ticker.toUpperCase() === highlightedTicker}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function WheelCycleCard({
  cycle,
  events,
  stockTransfers,
  highlighted,
}: {
  cycle: WheelCycle;
  events: WheelEvent[];
  stockTransfers: StockTransferEvent[];
  highlighted?: boolean;
}) {
  const fx = cycle.referenceFxRateJPY ?? 0;
  const isNWheelActive = cycle.currentPhase.startsWith("n_");
  const cameFromPTransfer = stockTransfers.length > 0 || cycle.linkedSimulationIds.some((id) => id.includes("transfer"));
  const route = !isNWheelActive || cameFromPTransfer ? pRoute : nRoute;
  return (
    <div className={`rounded-md border p-3 text-sm ${highlighted ? "border-teal-500 bg-teal-50 ring-2 ring-teal-200" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-bold text-slate-950">
            {cycle.ticker} / {isNWheelActive ? "N口座ホイール管理" : "ホイール準備中（P口座）"}
          </div>
          <div className="mt-1 text-slate-600">現在: {phaseLabels[cycle.currentPhase]}</div>
        </div>
        <div className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
          {currentAccountStatusLabel(cycle.currentPhase)}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <Metric label="累積プレミアム" value={formatUSD(cycle.cumulativePremiumUSD)} />
        <Metric label="株式売買損益" value={formatUSD(cycle.cumulativeStockRealizedPnlUSD)} />
        <Metric label="累積手数料" value={formatUSD(cycle.cumulativeFeesUSD)} />
        <Metric
          label="累積損益"
          value={`${formatUSD(cycle.cumulativeTotalPnlUSD)}${fx > 0 ? ` / 参考 ${formatJPY(cycle.cumulativeTotalPnlUSD * fx)}` : ""}`}
        />
        <Metric label="現在株数" value={`${cycle.currentShares}株`} />
        <Metric label="平均取得単価" value={formatUSD(cycle.averageCostUSD)} />
        <Metric label="未実現株式評価" value="実現損益に未反映" />
        <Metric label="次の候補" value={nextActionLabel(cycle.currentPhase)} />
      </div>
      <PhaseStepper route={route} currentPhase={cycle.currentPhase} />
      {stockTransfers.length > 0 ? (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs leading-5 text-emerald-950">
          {stockTransfers.map((transfer) => (
            <div key={transfer.id}>
              {transfer.transferDate}: P口座からN口座へ {transfer.shares}株を移管。取得単価 {formatUSD(transfer.costBasisUSD)}。売却損益には含めません。
            </div>
          ))}
        </div>
      ) : null}
      {events.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-1 pr-2">日付</th>
                <th className="py-1 pr-2">イベント</th>
                <th className="py-1 pr-2">口座</th>
                <th className="py-1 pr-2">内容</th>
                <th className="py-1 pr-2 text-right">USD損益</th>
                <th className="py-1 pr-2 text-right">株数変化</th>
                <th className="py-1 pr-2">フェーズ</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-slate-100">
                  <td className="py-1 pr-2">{event.occurredAt}</td>
                  <td className="py-1 pr-2">{event.type}</td>
                  <td className="py-1 pr-2">{event.accountCode}</td>
                  <td className="py-1 pr-2">{event.description}</td>
                  <td className="numeric-input py-1 pr-2 text-right">{event.usdPnl === undefined ? "-" : formatUSD(event.usdPnl)}</td>
                  <td className="numeric-input py-1 pr-2 text-right">{event.sharesChange ?? "-"}</td>
                  <td className="py-1 pr-2">{phaseLabels[event.phaseAfter]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function PhaseStepper({ route, currentPhase }: { route: WheelPhase[]; currentPhase: WheelPhase }) {
  const currentIndex = route.indexOf(currentPhase);
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-5">
      {route.map((phase, index) => {
        const state = index < currentIndex ? "済" : index === currentIndex ? "現在" : "未";
        const className =
          index < currentIndex
            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
            : index === currentIndex
              ? phase.startsWith("p_")
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-sky-300 bg-sky-50 text-sky-800"
              : "border-slate-200 bg-slate-50 text-slate-500";
        return (
          <div key={phase} className={`rounded-md border px-2 py-2 text-center ${className}`}>
            <div className="text-xs font-bold">{phaseLabels[phase]}</div>
            <div className="mt-1 text-[11px] font-semibold">{state}</div>
          </div>
        );
      })}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="numeric-input font-bold text-slate-950">{value}</div>
    </div>
  );
}

function nextActionLabel(phase: WheelPhase): string {
  if (phase === "p_assigned_stock" || phase === "p_to_n_transfer_pending") return "P→N移管を確認";
  if (phase === "n_stock_holding") return "C売り候補を確認";
  if (phase === "n_covered_call") return "満期保有か買戻し";
  if (phase === "n_short_put" || phase === "p_short_put") return "権利行使時の資金確認";
  if (phase === "n_called_away") return "N現金待機へ戻す";
  return "次のP売り候補を確認";
}

function currentAccountStatusLabel(phase: WheelPhase): string {
  if (phase === "p_short_put") return "現在: P口座でプット売り中 / N口座合流前";
  if (phase === "p_assigned_stock") return "現在: P口座で株式取得済み / N口座合流前";
  if (phase === "p_to_n_transfer_pending") return "現在: P口座 / N口座へ移管待ち";
  if (phase.startsWith("n_")) return "現在: N口座ホイール";
  return "現在: サイクル終了";
}
