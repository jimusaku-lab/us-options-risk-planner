import type { AccountInputs, WorkspaceMode } from "@/store/useOptionsStore";
import { NumberInput } from "@/components/ui/NumberInput";
import type { AccountState, SaxoAccountCode } from "@/types/domain";
import { formatJPY, formatUSD } from "@/lib/format";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

export function AccountOverview({
  workspace,
  accountInputs,
  referenceFxRateJPY,
  onChange,
}: {
  workspace: WorkspaceMode;
  accountInputs: AccountInputs;
  referenceFxRateJPY?: number;
  onChange: (accountCode: SaxoAccountCode, accountInputs: Partial<AccountState>) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isDemo = workspace === "demo";

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
            {isDemo
              ? "DEMOはJPYベースの検証用です。本番USD決済口座のUSD残高管理や移管後のホイール管理を完全に再現するものではありません。"
              : "SaxoのP口座とN口座を別々に入力します。余力や証拠金使用率は合算せず、建玉の口座ごとに警告へ使います。"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <AccountMetric account={accountInputs.P} displayName={isDemo ? "DEMO / JPYベース" : "P口座"} />
          {!isDemo ? <AccountMetric account={accountInputs.N} displayName="N口座" referenceFxRateJPY={referenceFxRateJPY} /> : null}
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
          <div className="grid gap-4 lg:grid-cols-2">
            <AccountEditor account={accountInputs.P} displayName={isDemo ? "DEMO / JPYベース" : "P口座 JPY決済"} onChange={(patch) => onChange("P", patch)} />
            {!isDemo ? <AccountEditor account={accountInputs.N} displayName="N口座 USD決済" referenceFxRateJPY={referenceFxRateJPY} onChange={(patch) => onChange("N", patch)} /> : null}
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {isDemo
              ? "DEMO画面下部に表示される口座通貨、現金残高、買付可能額、評価額、証拠金使用率はJPYベースとして入力します。"
              : "N口座のJPY換算は参考表示です。円転または税務上の確定損益とは異なる可能性があります。"}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function AccountMetric({ account, displayName, referenceFxRateJPY }: { account: AccountState; displayName: string; referenceFxRateJPY?: number }) {
  const usageTone =
    account.marginUsagePercent >= 70 ? "text-red-700" : account.marginUsagePercent >= 60 ? "text-amber-700" : "text-emerald-700";
  return (
    <div className="text-right text-sm">
      <div className="font-semibold text-slate-500">{displayName}</div>
      <div className={`numeric-input text-xl font-bold ${usageTone}`}>{account.marginUsagePercent.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}%</div>
      <div className="numeric-input text-sm font-bold text-slate-950">
        {account.currency === "USD" ? formatUSD(account.cashBalance) : formatJPY(account.cashBalance)}
      </div>
      {account.currency === "USD" && referenceFxRateJPY && referenceFxRateJPY > 0 ? (
        <div className="numeric-input text-xs text-slate-500">参考 {formatJPY(account.cashBalance * referenceFxRateJPY)}</div>
      ) : null}
    </div>
  );
}

function AccountEditor({ account, displayName, referenceFxRateJPY, onChange }: { account: AccountState; displayName: string; referenceFxRateJPY?: number; onChange: (patch: Partial<AccountState>) => void }) {
  const referenceNote =
    account.currency === "USD" && referenceFxRateJPY && referenceFxRateJPY > 0
      ? `参考JPY: 現金 ${formatJPY(account.cashBalance * referenceFxRateJPY)} / 余力 ${formatJPY((account.buyingPower ?? 0) * referenceFxRateJPY)} / 必要証拠金 ${formatJPY(account.marginRequirement * referenceFxRateJPY)}`
      : "";
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-sm font-bold text-slate-950">
        {displayName}
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <NumberInput
          label={`現金残高（${account.currency}）`}
          value={account.cashBalance}
          suffix={account.currency}
          onChange={(cashBalance) => onChange({ cashBalance })}
        />
        <NumberInput
          label={`必要証拠金（${account.currency}）`}
          value={account.marginRequirement}
          suffix={account.currency}
          onChange={(marginRequirement) => onChange({ marginRequirement })}
        />
        <NumberInput
          label={`買付可能額・余力（任意・${account.currency}）`}
          value={account.buyingPower ?? 0}
          suffix={account.currency}
          onChange={(buyingPower) => onChange({ buyingPower })}
        />
        <NumberInput
          label="証拠金使用率"
          value={account.marginUsagePercent}
          suffix="%"
          onChange={(marginUsagePercent) => onChange({ marginUsagePercent })}
        />
        <NumberInput
          label={`口座評価額（任意・${account.currency}）`}
          value={account.accountValue ?? 0}
          suffix={account.currency}
          onChange={(accountValue) => onChange({ accountValue })}
        />
      </div>
      {referenceNote ? <p className="mt-2 text-xs leading-5 text-slate-500">{referenceNote}</p> : null}
    </div>
  );
}
