import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Eye, FileUp, ListFilter, Plus, Trash2 } from "lucide-react";
import type { CandidateSymbol } from "@/types/candidates";
import type { TradeSimulation } from "@/types/domain";
import { parseCandidateImport } from "@/lib/candidates";
import { formatUSD } from "@/lib/format";

function formatCompact(value?: number): string {
  if (value === undefined) return "-";
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercentValue(value?: number): string {
  if (value === undefined) return "-";
  return `${value.toFixed(2)}%`;
}

export function CandidatePanel({
  candidates,
  importWarnings,
  simulations,
  onImport,
  onClear,
  onWatchOnly,
  onCreateSimulation,
}: {
  candidates: CandidateSymbol[];
  importWarnings: string[];
  simulations: TradeSimulation[];
  onImport: (candidates: CandidateSymbol[], warnings: string[]) => void;
  onClear: () => void;
  onWatchOnly: (id: string, watchOnly: boolean) => void;
  onCreateSimulation: (candidate: CandidateSymbol, strategy: "covered_call" | "short_put") => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState("");
  const [showWatchOnly, setShowWatchOnly] = useState(true);
  const [showNearEarnings, setShowNearEarnings] = useState(true);
  const [query, setQuery] = useState("");
  const existingSymbols = useMemo(
    () => new Set(simulations.map((simulation) => simulation.ticker.trim().toUpperCase()).filter(Boolean)),
    [simulations],
  );
  const visibleCandidates = candidates.filter((candidate) => {
    if (!showWatchOnly && candidate.watchOnly) return false;
    if (!showNearEarnings && candidate.earningsWarning) return false;
    if (!query.trim()) return true;
    const normalizedQuery = query.trim().toUpperCase();
    return (
      candidate.symbol.includes(normalizedQuery) ||
      candidate.company.toUpperCase().includes(normalizedQuery) ||
      candidate.sector?.toUpperCase().includes(normalizedQuery)
    );
  });

  const importFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const result = parseCandidateImport(text, file.name);
      onImport(result.candidates, result.warnings);
      setStatus(`${result.candidates.length}件の候補を読み込みました。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "候補ファイルを読み込めませんでした。");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">候補リスト</h2>
          <p className="mt-1 text-sm text-slate-600">
            TradingViewの候補JSON/CSVを読み込み、Saxo APIなしで建玉案の入口を作ります。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp size={16} />
            候補取込
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 disabled:opacity-40"
            disabled={candidates.length === 0}
            onClick={onClear}
          >
            <Trash2 size={16} />
            クリア
          </button>
          <input
            ref={fileInputRef}
            className="hidden"
            type="file"
            accept="application/json,text/csv,.json,.csv"
            onChange={(event) => void importFile(event.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">候補 {visibleCandidates.length}/{candidates.length}件</span>
          {status ? <span className="text-slate-600">{status}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={showWatchOnly} onChange={(event) => setShowWatchOnly(event.target.checked)} />
            Watch only
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={showNearEarnings} onChange={(event) => setShowNearEarnings(event.target.checked)} />
            決算注意
          </label>
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
            <ListFilter size={14} />
            <input
              className="h-8 w-40 rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-teal-600"
              value={query}
              placeholder="銘柄/会社/セクター"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
      </div>

      {importWarnings.length > 0 ? (
        <details className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <summary className="cursor-pointer font-bold">取込時の確認事項 {importWarnings.length}件</summary>
          <ul className="mt-2 grid max-h-36 gap-1 overflow-auto text-xs leading-5">
            {importWarnings.slice(0, 80).map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {candidates.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
          tradingview_candidates.json またはCSVを取り込むと、候補銘柄をここで確認できます。
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2 pr-3 text-right">Rank</th>
                <th className="py-2 pr-3">銘柄</th>
                <th className="py-2 pr-3">会社</th>
                <th className="py-2 pr-3 text-right">価格</th>
                <th className="py-2 pr-3 text-right">変化率</th>
                <th className="py-2 pr-3 text-right">出来高</th>
                <th className="py-2 pr-3 text-right">時価総額</th>
                <th className="py-2 pr-3">Sector</th>
                <th className="py-2 pr-3">注意</th>
                <th className="py-2 pr-3 text-right">Score</th>
                <th className="py-2 pr-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleCandidates.map((candidate) => {
                const hasPosition = existingSymbols.has(candidate.symbol);
                const hasWarnings = (candidate.parseWarnings?.length ?? 0) > 0 || Boolean(candidate.earningsWarning);
                return (
                  <tr key={candidate.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="numeric-input py-3 pr-3 text-right font-semibold text-slate-700">{candidate.rank}</td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-slate-950">{candidate.symbol}</span>
                        {hasPosition ? <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[11px] font-bold text-teal-800">建玉あり</span> : null}
                        {candidate.watchOnly ? <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-700">Watch</span> : null}
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-slate-700">{candidate.company}</td>
                    <td className="numeric-input py-3 pr-3 text-right font-semibold">{candidate.priceUSD === undefined ? "-" : formatUSD(candidate.priceUSD)}</td>
                    <td className="numeric-input py-3 pr-3 text-right font-semibold">{formatPercentValue(candidate.changePercent)}</td>
                    <td className="numeric-input py-3 pr-3 text-right font-semibold">{formatCompact(candidate.volume)}</td>
                    <td className="numeric-input py-3 pr-3 text-right font-semibold">{formatCompact(candidate.marketCapUSD)}</td>
                    <td className="py-3 pr-3 text-slate-700">{candidate.sector ?? "-"}</td>
                    <td className={`py-3 pr-3 text-xs font-semibold ${hasWarnings ? "text-amber-700" : "text-slate-500"}`}>
                      {candidate.earningsWarning || candidate.parseWarnings?.[0] || "-"}
                    </td>
                    <td className="numeric-input py-3 pr-3 text-right font-bold text-slate-900">{candidate.score}</td>
                    <td className="py-3 pr-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-2 text-slate-600 hover:border-slate-400 hover:bg-slate-50"
                          title={candidate.watchOnly ? "Watch onlyを解除" : "Watch onlyにする"}
                          onClick={() => onWatchOnly(candidate.id, !candidate.watchOnly)}
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white p-2 text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"
                          title="カバードコール候補として建玉案を作成"
                          onClick={() => onCreateSimulation(candidate, "covered_call")}
                        >
                          <Plus size={15} />
                          <span className="sr-only">Covered Call</span>
                        </button>
                        <button
                          className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
                          title="Cash Secured Put候補として建玉案を作成"
                          onClick={() => onCreateSimulation(candidate, "short_put")}
                        >
                          P
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex items-center gap-2 text-xs leading-5 text-slate-500">
            <AlertTriangle size={14} />
            建玉案作成後も、権利行使価格・満期・プレミアム・証拠金は手入力で確認します。Saxo発注機能はありません。
          </div>
        </div>
      )}
    </section>
  );
}
