import type { ChecklistItem, RiskWarning } from "@/types/domain";

const severityClasses = {
  info: "border-sky-200 bg-sky-50 text-sky-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  danger: "border-red-200 bg-red-50 text-red-950",
};

export function RiskPanel({
  warnings,
  checklist,
  onChecklistChange,
  onWarningAction,
}: {
  warnings: RiskWarning[];
  checklist: ChecklistItem[];
  onChecklistChange: (id: string, checked: boolean) => void;
  onWarningAction?: (warning: RiskWarning) => void;
}) {
  const blockingWarnings = warnings.filter((warning) => warning.blocking);
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">リスク警告</h2>
        <div className="mt-4 grid gap-2">
          {warnings.length === 0 ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
              現在の入力では重大な警告はありません。
            </div>
          ) : (
            warnings.map((warning) => (
              <div key={warning.id} className={`rounded-md border p-3 text-sm ${severityClasses[warning.severity]}`}>
                <div className="font-bold">
                  {warning.title}
                  {warning.blocking ? <span className="ml-2 rounded bg-red-700 px-2 py-0.5 text-xs text-white">注文前NG</span> : null}
                </div>
                <p className="mt-1 leading-6">{warning.message}</p>
                {warning.actionAnchorId ? (
                  <button
                    className="mt-2 rounded-md border border-current bg-white/60 px-3 py-1.5 text-xs font-bold hover:bg-white"
                    onClick={() => onWarningAction?.(warning)}
                  >
                    {warning.actionLabel ?? "反対売買判断へ"}
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">注文前チェックリスト</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          ここは自動判定ではなく、注文直前にユーザーが自分で確認してチェックする欄です。
        </p>
        <div className="mt-4 grid gap-2">
          {checklist.map((item) => (
            <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 text-sm">
              <input
                className="mt-0.5 h-5 w-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                type="checkbox"
                checked={item.passed}
                onChange={(event) => onChecklistChange(item.id, event.target.checked)}
              />
              <div>
                <div className="font-semibold text-slate-900">{item.label}</div>
                {!item.passed ? <div className="mt-1 text-slate-500">未確認です。注文前に確認してからチェックします。</div> : null}
              </div>
            </label>
          ))}
          {blockingWarnings.length > 0 ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-950">
              注文前NGが{blockingWarnings.length}件あります。チェックリストに進む前に、左側のリスク警告を解消してください。
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
