import type { AccountInputs, WorkspaceMode } from "@/store/useOptionsStore";
import { NumberInput } from "@/components/ui/NumberInput";
import { formatJPY } from "@/lib/format";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

export function AccountOverview({
  workspace,
  accountInputs,
  onChange,
}: {
  workspace: WorkspaceMode;
  accountInputs: AccountInputs;
  onChange: (accountInputs: Partial<AccountInputs>) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const usageTone =
    accountInputs.marginUsagePercent >= 70
      ? "text-red-700"
      : accountInputs.marginUsagePercent >= 60
        ? "text-amber-700"
        : "text-emerald-700";

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-slate-950">口座全体の余力・証拠金</h2>
            <span
              className={`rounded px-2 py-0.5 text-xs font-bold ${
                workspace === "demo" ? "bg-sky-100 text-sky-800" : "bg-red-100 text-red-800"
              }`}
            >
              {workspace === "demo" ? "DEMO口座" : "REAL口座"}
            </span>
          </div>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">
            Saxo画面下部に出る口座全体の値です。個別銘柄ではなく、全オプション建玉を含む証拠金使用率として警告に使います。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="text-right text-sm">
            <div className="text-slate-500">証拠金使用率</div>
            <div className={`numeric-input text-2xl font-bold ${usageTone}`}>
              {accountInputs.marginUsagePercent.toLocaleString("ja-JP", {
                maximumFractionDigits: 2,
              })}
              %
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="text-slate-500">現金残高</div>
            <div className="numeric-input text-lg font-bold text-slate-950">
              {formatJPY(accountInputs.availableCashJPY)}
            </div>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
            onClick={() => setIsOpen((value) => !value)}
          >
            {isOpen ? (
              <>
                <ChevronUp size={16} />
                入力欄を畳む
              </>
            ) : (
              <>
                <ChevronDown size={16} />
                入力欄を開く
              </>
            )}
          </button>
        </div>
      </div>

      {isOpen ? (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <NumberInput
              label="現金残高（未受渡分込み・口座全体）"
              value={accountInputs.availableCashJPY}
              suffix="JPY"
              onChange={(availableCashJPY) => onChange({ availableCashJPY })}
            />
            <NumberInput
              label="証拠金使用率（口座全体）"
              value={accountInputs.marginUsagePercent}
              suffix="%"
              onChange={(marginUsagePercent) => onChange({ marginUsagePercent })}
            />
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Saxo画面下部の「現金残高（未受渡分込み）」を入力します。P権利行使時の追加買付資金チェックに使う値です。この欄はAMZNやNVDAごとではなく、口座全体で一度だけ入力します。
          </p>
        </div>
      ) : null}
    </section>
  );
}
