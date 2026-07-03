import type { CandidateSymbol } from "@/types/candidates";
import type { EntryRationaleJournal } from "@/types/domain";
import type { StrategyFitLevel } from "@/types/screening";
import type { ReactNode } from "react";
import { EntryRationaleJournalPanel } from "@/components/journal/EntryRationaleJournalPanel";
import { formatUSD } from "@/lib/format";

type CandidateDetailCardProps = {
  candidate: CandidateSymbol;
  onJournalChange?: (journal: EntryRationaleJournal) => void;
  getDefaultJournal?: () => EntryRationaleJournal;
};

function formatValue(value: unknown, fallback = "-"): string {
  if (typeof value === "number" && Number.isFinite(value)) return Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "boolean") return value ? "確認済み" : "未確認";
  return fallback;
}

function formatPercent(value?: number): string {
  return value === undefined ? "-" : `${value.toFixed(2)}%`;
}

function fitLabel(level: StrategyFitLevel): string {
  if (level === "fit") return "候補";
  if (level === "watch") return "確認対象";
  if (level === "avoid") return "要確認";
  return "データ不足";
}

function fitClass(level: StrategyFitLevel): string {
  if (level === "fit") return "border-teal-200 bg-teal-50 text-teal-800";
  if (level === "watch") return "border-sky-200 bg-sky-50 text-sky-800";
  if (level === "avoid") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function strategyLabel(strategy: string): string {
  const labels: Record<string, string> = {
    cash_secured_put_buy_to_own: "CSP取得前提",
    cash_secured_put_avoid_assignment: "CSP反対売買前提",
    covered_call: "Covered Call",
    long_call: "Long Call",
    short_strangle: "Short Strangle",
    synthetic_forward: "Synthetic Forward",
    combo: "Combo",
  };
  return labels[strategy] ?? strategy;
}

function ListBlock({ title, items, tone = "slate" }: { title: string; items?: string[]; tone?: "slate" | "amber" | "rose" | "teal" }) {
  if (!items?.length) return null;
  const toneClass =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-950"
      : tone === "rose"
        ? "border-rose-200 bg-rose-50 text-rose-950"
        : tone === "teal"
          ? "border-teal-200 bg-teal-50 text-teal-950"
          : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <div className={`rounded-md border px-3 py-2 text-xs leading-5 ${toneClass}`}>
      <div className="font-bold">{title}</div>
      <ul className="mt-1 grid gap-1">
        {items.map((item, index) => (
          <li key={`${title}-${item}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] font-bold uppercase tracking-normal text-slate-500">{label}</div>
      <div className="mt-1 break-words text-xs font-semibold text-slate-900">{formatValue(value)}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
      <h4 className="text-sm font-bold text-slate-950">{title}</h4>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function CandidateDetailCard({ candidate, onJournalChange, getDefaultJournal }: CandidateDetailCardProps) {
  const screening = candidate.screeningCandidate;
  const technical = screening?.technicalSnapshot;
  const optionQuality = screening?.optionChainQuality;
  const warningItems = [
    candidate.earningsWarning,
    ...(candidate.parseWarnings ?? []),
    ...(screening?.riskFlags ?? []),
    ...(optionQuality?.qualityWarnings ?? []),
  ].filter((item): item is string => Boolean(item));
  const missingItems = screening?.missingFields ?? [];

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold text-slate-500">候補詳細</div>
          <h3 className="mt-1 text-base font-bold text-slate-950">
            {candidate.symbol} <span className="font-semibold text-slate-600">{screening?.name ?? candidate.company}</span>
          </h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {candidate.strategyFitResults?.slice(0, 4).map((result) => (
            <span key={result.strategy} className={`rounded-full border px-2 py-1 text-xs font-bold ${fitClass(result.fitLevel)}`}>
              {strategyLabel(result.strategy)}: {fitLabel(result.fitLevel)}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Section title="基本情報">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label="symbol" value={candidate.symbol} />
            <Metric label="name" value={screening?.name ?? candidate.company} />
            <Metric label="market" value={screening?.market} />
            <Metric label="sector" value={screening?.sector ?? candidate.sector} />
            <Metric label="dataSource" value={screening?.dataSource ?? candidate.source} />
            <Metric label="delayStatus" value={screening?.delayStatus} />
            <Metric label="price" value={candidate.priceUSD === undefined ? screening?.underlyingPrice : formatUSD(candidate.priceUSD)} />
            <Metric label="priceAsOf" value={screening?.priceAsOf} />
            <Metric label="importedAt" value={candidate.importedAt} />
          </div>
        </Section>

        <Section title="株価・テクニカル">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label="dailyClose" value={technical?.dailyClose} />
            <Metric label="SMA25" value={technical?.sma25} />
            <Metric label="SMA50" value={technical?.sma50} />
            <Metric label="SMA200" value={technical?.sma200} />
            <Metric label="MA25 slope" value={technical?.movingAverageSlopes?.ma25} />
            <Metric label="MA50 slope" value={technical?.movingAverageSlopes?.ma50} />
            <Metric label="MA200 slope" value={technical?.movingAverageSlopes?.ma200} />
            <Metric label="MACD" value={technical?.macdSignal} />
            <Metric label="SlowKD" value={technical?.slowKdSignal} />
            <Metric label="RSI" value={technical?.rsi} />
          </div>
          <ListBlock title="trendNotes" items={technical?.trendNotes} />
          {technical?.signalEvents?.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2 pr-3">signalEvents</th>
                    <th className="py-2 pr-3">occurredAt</th>
                    <th className="py-2 pr-3">lookback</th>
                    <th className="py-2 pr-3">strength</th>
                    <th className="py-2 pr-3">notes</th>
                  </tr>
                </thead>
                <tbody>
                  {technical.signalEvents.map((event, index) => (
                    <tr key={`${event.type}-${index}`} className="border-b border-slate-100">
                      <td className="py-2 pr-3 font-semibold text-slate-900">{event.type}</td>
                      <td className="py-2 pr-3">{event.occurredAt}</td>
                      <td className="py-2 pr-3">{event.lookbackTradingDays}</td>
                      <td className="py-2 pr-3">{event.strength}</td>
                      <td className="py-2 pr-3">{event.notes ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Section>

        <Section title="オプション品質">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label="hasOptionChain" value={optionQuality?.hasOptionChain} />
            <Metric label="expirationCount" value={optionQuality?.expirationCount} />
            <Metric label="targetDteAvailable" value={optionQuality?.targetDteAvailable} />
            <Metric label="bidAskSpreadRate" value={formatPercent(optionQuality?.bidAskSpreadRate)} />
            <Metric label="volume" value={optionQuality?.volume} />
            <Metric label="openInterest" value={optionQuality?.openInterest} />
            <Metric label="IV" value={optionQuality?.iv} />
            <Metric label="delta" value={optionQuality?.delta} />
            <Metric label="gamma" value={optionQuality?.gamma} />
            <Metric label="theta" value={optionQuality?.theta} />
            <Metric label="vega" value={optionQuality?.vega} />
          </div>
          <ListBlock title="qualityWarnings" items={optionQuality?.qualityWarnings} tone="amber" />
        </Section>

        <Section title="データ不足・警告">
          <div className="grid gap-2">
            <ListBlock title="missingFields" items={missingItems} tone="amber" />
            <ListBlock title="warnings / riskFlags" items={warningItems} tone="rose" />
            {!missingItems.length && !warningItems.length ? <p className="text-xs text-slate-500">表示対象の不足・警告はありません。</p> : null}
          </div>
        </Section>
      </div>

      <Section title="戦略別判定">
        {candidate.strategyFitResults?.length ? (
          <div className="grid gap-3">
            {candidate.strategyFitResults.map((result) => (
              <div key={result.strategy} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-950">{strategyLabel(result.strategy)}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${fitClass(result.fitLevel)}`}>{fitLabel(result.fitLevel)}</span>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <ListBlock title="reasons" items={result.reasons} tone="teal" />
                  <ListBlock title="warnings" items={result.warnings} tone="amber" />
                  <ListBlock title="missingFields" items={result.missingFields} tone="rose" />
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div>
                    <div className="text-xs font-bold text-slate-700">requiredChecks</div>
                    <div className="mt-1 grid gap-1">
                      {result.requiredChecks.length ? result.requiredChecks.map((check) => (
                        <div key={check.id} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1 text-xs">
                          <span>{check.label}</span>
                          <span className="font-bold">{check.passed === undefined ? "未確認" : check.passed ? "OK" : "要確認"}</span>
                        </div>
                      )) : <p className="text-xs text-slate-500">requiredChecksなし</p>}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-700">numericChecks</div>
                    <div className="mt-1 grid gap-1">
                      {result.numericChecks.length ? result.numericChecks.map((check) => (
                        <div key={check.id} className="rounded bg-slate-50 px-2 py-1 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span>{check.label}</span>
                            <span className="font-bold">{check.passed ? "OK" : "要確認"}</span>
                          </div>
                          <div className="mt-1 text-slate-600">
                            value {formatValue(check.value)} / min {formatValue(check.min)} / max {formatValue(check.max)}
                          </div>
                        </div>
                      )) : <p className="text-xs text-slate-500">numericChecksなし</p>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">戦略別判定はありません。</p>
        )}
      </Section>

      <Section title="上昇転換コンボ候補">
        {candidate.technicalTimingPatterns?.length ? (
          <div className="grid gap-3">
            {candidate.technicalTimingPatterns.map((pattern, index) => (
              <div key={`${pattern.kind}-${index}`} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-950">{pattern.kind}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${fitClass(pattern.fitLevel)}`}>{fitLabel(pattern.fitLevel)}</span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="signalOrder" value={pattern.signalOrder.join(" -> ")} />
                  <Metric label="slowKdCrossDate" value={pattern.timing.slowKdCrossDate} />
                  <Metric label="macdCrossDate" value={pattern.timing.macdCrossDate} />
                  <Metric label="ma25Ma50CrossDate" value={pattern.timing.ma25Ma50CrossDate} />
                  <Metric label="ma25Ma50DistancePct" value={formatPercent(pattern.timing.ma25Ma50DistancePct)} />
                  <Metric label="MA25 slope" value={pattern.timing.movingAverageSlopes.ma25} />
                  <Metric label="MA50 slope" value={pattern.timing.movingAverageSlopes.ma50} />
                  <Metric label="MA200 slope" value={pattern.timing.movingAverageSlopes.ma200} />
                  <Metric label="aboveMa25" value={pattern.timing.priceLocation.aboveMa25} />
                  <Metric label="aboveMa50" value={pattern.timing.priceLocation.aboveMa50} />
                  <Metric label="aboveMa200" value={pattern.timing.priceLocation.aboveMa200} />
                  <Metric label="comboModes" value={pattern.timing.optionComboReadiness.modes.join(", ")} />
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <ListBlock title="reasons" items={pattern.reasons} tone="teal" />
                  <ListBlock title="warnings" items={pattern.warnings} tone="amber" />
                  <ListBlock title="missingFields" items={pattern.missingFields} tone="rose" />
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <ListBlock title="timingNotes" items={pattern.timing.timingNotes} />
                  <ListBlock title="comboReadiness notes" items={pattern.timing.optionComboReadiness.notes} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">上昇転換コンボ候補はありません。</p>
        )}
      </Section>

      <Section title="シンセティックフォワード候補">
        {candidate.syntheticForwardCandidates?.length ? (
          <div className="grid gap-3">
            {candidate.syntheticForwardCandidates.map((item, index) => (
              <div key={`${item.kind}-${index}`} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-950">Synthetic Forward</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${fitClass(item.fitLevel)}`}>{fitLabel(item.fitLevel)}</span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="expiry" value={item.expiry} />
                  <Metric label="dte" value={item.dte} />
                  <Metric label="strike" value={item.strike} />
                  <Metric label="netPremium" value={item.netPremium} />
                  <Metric label="breakEvenPrice" value={item.breakEvenPrice} />
                  <Metric label="assignmentCapitalRequired" value={item.assignmentCapitalRequired} />
                  <Metric label="assignmentCapitalAvailable" value={item.assignmentCapitalAvailable} />
                  <Metric label="syntheticDelta" value={item.syntheticDelta} />
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <div className="font-bold text-slate-800">long_call leg</div>
                    <div className="mt-1 text-slate-700">
                      expiry {formatValue(item.longCallLeg?.expiry)} / strike {formatValue(item.longCallLeg?.strikePrice)} / mid {formatValue(item.longCallLeg?.mid)}
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <div className="font-bold text-slate-800">short_put leg</div>
                    <div className="mt-1 text-slate-700">
                      expiry {formatValue(item.shortPutLeg?.expiry)} / strike {formatValue(item.shortPutLeg?.strikePrice)} / mid {formatValue(item.shortPutLeg?.mid)}
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <ListBlock title="reasons" items={item.reasons} tone="teal" />
                  <ListBlock title="warnings" items={item.warnings} tone="amber" />
                  <ListBlock title="missingFields" items={item.missingFields} tone="rose" />
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <ListBlock title="riskFlags" items={item.riskFlags} tone="rose" />
                  <ListBlock title="capitalEfficiencyNotes" items={item.capitalEfficiencyNotes} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">シンセティックフォワード候補はありません。</p>
        )}
      </Section>
      {onJournalChange ? (
        <EntryRationaleJournalPanel
          title="候補のエントリー根拠メモ"
          subtitle="候補理由と、実際にエントリーすると判断した理由を分けて保存します。"
          journal={candidate.entryRationaleJournal ?? getDefaultJournal?.() ?? {
            id: `journal-${candidate.id}`,
            candidateId: candidate.id,
            symbol: candidate.symbol,
            underlyingName: candidate.company,
            strategy: "custom",
            status: "candidate",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            entryReason: "",
            technicalTags: [],
            chartEvidence: [],
            review: { outcome: "not_reviewed" },
          }}
          onChange={onJournalChange}
          candidateReason={
            <div className="grid gap-1">
              <div>候補スコア: {candidate.score}</div>
              <div>候補用途: {candidate.suggestedUse || "-"}</div>
              <div>
                {candidate.strategyFitResults?.slice(0, 3).map((result) => `${strategyLabel(result.strategy)} ${fitLabel(result.fitLevel)}`).join(" / ") || "戦略判定なし"}
              </div>
            </div>
          }
        />
      ) : null}
    </div>
  );
}
