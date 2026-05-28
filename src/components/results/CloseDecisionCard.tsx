import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { OptionLeg, TradeSimulation } from "@/types/domain";
import { calculateCloseCostJPY, calculatePremiumJPY } from "@/domain/calculations";
import { NumberInput } from "@/components/ui/NumberInput";
import { formatJPY, formatUSD } from "@/lib/format";

export function CloseDecisionCard({
  simulation,
  onChange,
}: {
  simulation: TradeSimulation;
  onChange: (simulation: TradeSimulation) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const shortLegs = simulation.optionLegs.filter((leg) => leg.side === "sell");
  const updateLeg = (id: string, patch: Partial<OptionLeg>) => {
    onChange({
      ...simulation,
      optionLegs: simulation.optionLegs.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)),
    });
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-950">反対売買判断</h2>
        <button
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {isOpen ? "畳む" : "開く"}
        </button>
      </div>
      {isOpen ? (
        <>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            売り建てオプションを途中で閉じる場合は、現在の買戻し価格を入れて、受取済みプレミアムとの差額を見ます。手数料は建てた時と決済時の概算を控除します。
          </p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {shortLegs.map((leg) => (
              <LegCloseCard
                key={leg.id}
                leg={leg}
                simulation={simulation}
                fxRateJPY={simulation.fxRateJPY}
                openCommissionUSD={(simulation.brokerCommissionUSD ?? 0) / Math.max(1, shortLegs.length)}
                onCloseCostChange={(closeCostUSD) => updateLeg(leg.id, { closeCostUSD })}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm leading-6 text-slate-600">
          通常は閉じています。途中決済を検討する時だけ開き、Saxoの決済チケット価格を確認します。
        </p>
      )}
    </section>
  );
}

function LegCloseCard({
  leg,
  simulation,
  fxRateJPY,
  openCommissionUSD,
  onCloseCostChange,
}: {
  leg: OptionLeg;
  simulation: TradeSimulation;
  fxRateJPY: number;
  openCommissionUSD: number;
  onCloseCostChange: (closeCostUSD: number) => void;
}) {
  const receivedJPY = calculatePremiumJPY({
    premiumUSD: leg.premiumUSD,
    quantity: leg.quantity,
    fxRateJPY,
  });
  const closeCostJPY = calculateCloseCostJPY(leg, fxRateJPY);
  const closeCommissionUSD = leg.closePlan?.commissionUSD ?? openCommissionUSD;
  const totalCommissionJPY = (openCommissionUSD + (closeCostJPY === null ? 0 : closeCommissionUSD)) * fxRateJPY;
  const estimatedProfitJPY = closeCostJPY === null ? null : receivedJPY - closeCostJPY - totalCommissionJPY;
  const keepPercent =
    estimatedProfitJPY === null || receivedJPY === 0 ? null : Math.max(0, (estimatedProfitJPY / receivedJPY) * 100);
  const profitTarget = simulation.profitTakeRule?.targetPremiumKeepPercent ?? 60;
  const profitRuleStatus =
    !simulation.profitTakeRule?.enabled
      ? { label: "利確ルールは未使用", tone: undefined as Tone, detail: "必要な場合は建玉入力のルール設定でONにします。" }
      : keepPercent === null
        ? { label: "買戻し価格を入れると判定", tone: undefined as Tone, detail: `目安: プレミアム確保率 ${profitTarget}%以上` }
        : keepPercent >= profitTarget
          ? { label: "利確ルール到達", tone: "green" as Tone, detail: `現在 ${keepPercent.toFixed(1)}% / 目安 ${profitTarget}%` }
          : { label: "利確ルール未到達", tone: undefined as Tone, detail: `現在 ${keepPercent.toFixed(1)}% / 目安 ${profitTarget}%` };
  const stopRuleStatus = getStopRuleStatus({ simulation, leg, estimatedProfitJPY });
  const label = `${leg.type === "call" ? "C" : "P"} ${leg.strikeUSD} ${leg.expiryDate}`;

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="font-bold text-slate-950">{label}</div>
      <div className="mt-3">
        <NumberInput
          label="現在の買戻し価格"
          value={leg.closeCostUSD ?? Number.NaN}
          suffix="USD/株"
          placeholder="Saxo決済チケットの価格"
          min={0}
          onChange={onCloseCostChange}
        />
      </div>
      <dl className="mt-3 grid gap-2 text-sm">
        <Row label="建てた時のプレミアム" value={`${formatUSD(leg.premiumUSD)} / ${formatJPY(receivedJPY)}`} />
        <Row
          label="現在の買戻し価格"
          value={closeCostJPY === null ? "未入力" : `${formatUSD(leg.closeCostUSD ?? leg.closePlan?.closePriceUSD ?? 0)} / ${formatJPY(closeCostJPY)}`}
        />
        <Row
          label="手数料控除"
          value={
            closeCostJPY === null
              ? `${formatUSD(openCommissionUSD)} / ${formatJPY(totalCommissionJPY)}`
              : `${formatUSD(openCommissionUSD + closeCommissionUSD)} / ${formatJPY(totalCommissionJPY)}`
          }
        />
        <Row
          label="今閉じた場合の概算損益（手数料後）"
          value={estimatedProfitJPY === null ? "未計算" : formatJPY(estimatedProfitJPY, { signed: true })}
          tone={estimatedProfitJPY === null ? undefined : estimatedProfitJPY >= 0 ? "green" : "red"}
        />
        <Row
          label="プレミアム確保率"
          value={keepPercent === null ? "未計算" : `${keepPercent.toFixed(1)}%`}
          tone={keepPercent === null ? undefined : keepPercent >= 50 ? "green" : undefined}
        />
        <RuleRow label="利確ルール判定" status={profitRuleStatus.label} detail={profitRuleStatus.detail} tone={profitRuleStatus.tone} />
        <RuleRow label="損切りルール判定" status={stopRuleStatus.label} detail={stopRuleStatus.detail} tone={stopRuleStatus.tone} />
      </dl>
    </div>
  );
}

type Tone = "green" | "red" | "amber" | undefined;

function getStopRuleStatus({
  simulation,
  leg,
  estimatedProfitJPY,
}: {
  simulation: TradeSimulation;
  leg: OptionLeg;
  estimatedProfitJPY: number | null;
}): { label: string; detail: string; tone: Tone } {
  const rule = simulation.stopLossRule;
  if (!rule?.enabled) {
    return { label: "損切りルールは未使用", detail: "必要な場合は建玉入力のルール設定でONにします。", tone: undefined };
  }
  if (rule.value <= 0) {
    return { label: "損切りルール値が未入力", detail: "ルールをONにした場合は基準値を入力します。", tone: "red" };
  }
  if (rule.type === "option_buyback_price") {
    const closePrice = leg.closeCostUSD ?? leg.closePlan?.closePriceUSD;
    if (closePrice === undefined || Number.isNaN(closePrice)) {
      return { label: "買戻し価格を入れると判定", detail: `目安: ${formatUSD(rule.value)}以上`, tone: undefined };
    }
    return closePrice >= rule.value
      ? { label: "損切りルール到達", detail: `現在 ${formatUSD(closePrice)} / 目安 ${formatUSD(rule.value)}`, tone: "red" }
      : { label: "損切りルール未到達", detail: `現在 ${formatUSD(closePrice)} / 目安 ${formatUSD(rule.value)}`, tone: undefined };
  }
  if (rule.type === "stock_price_line") {
    const crossed = leg.type === "put" ? simulation.currentPriceUSD <= rule.value : simulation.currentPriceUSD >= rule.value;
    return crossed
      ? { label: "株価ライン到達", detail: `現在 ${formatUSD(simulation.currentPriceUSD)} / 目安 ${formatUSD(rule.value)}`, tone: "red" }
      : { label: "株価ライン未到達", detail: `現在 ${formatUSD(simulation.currentPriceUSD)} / 目安 ${formatUSD(rule.value)}`, tone: undefined };
  }
  if (estimatedProfitJPY === null) {
    return { label: "買戻し価格を入れると判定", detail: `目安: ${formatJPY(rule.value)}の損失`, tone: undefined };
  }
  return estimatedProfitJPY <= -rule.value
    ? { label: "損失額ルール到達", detail: `現在 ${formatJPY(estimatedProfitJPY, { signed: true })} / 目安 -${formatJPY(rule.value)}`, tone: "red" }
    : { label: "損失額ルール未到達", detail: `現在 ${formatJPY(estimatedProfitJPY, { signed: true })} / 目安 -${formatJPY(rule.value)}`, tone: undefined };
}

function Row({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  const toneClass = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "text-slate-950";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
      <dt className="text-slate-600">{label}</dt>
      <dd className={`numeric-input text-right font-bold ${toneClass}`}>{value}</dd>
    </div>
  );
}

function RuleRow({ label, status, detail, tone }: { label: string; status: string; detail: string; tone?: Tone }) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "red"
        ? "border-red-200 bg-red-50 text-red-900"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <dt className="text-xs font-semibold">{label}</dt>
      <dd className="mt-1 font-bold">{status}</dd>
      <dd className="mt-1 text-xs leading-5">{detail}</dd>
    </div>
  );
}
