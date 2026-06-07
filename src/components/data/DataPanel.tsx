import { AlertTriangle, Database, Trash2 } from "lucide-react";

const appStoragePrefixes = ["us-options-"];

export function DataPanel({ externalQuoteModeLabel, onClose }: { externalQuoteModeLabel: string; onClose: () => void }) {
  const clearLocalData = () => {
    const keysToRemove: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && appStoragePrefixes.some((prefix) => key.startsWith(prefix))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
    window.location.reload();
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Database className="text-slate-700" size={20} />
            <h2 className="text-lg font-bold text-slate-950">データ</h2>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            入力内容は、この端末のブラウザ内に保存されています。作成者へ自動送信されません。
          </p>
        </div>
        <button
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          onClick={onClose}
        >
          閉じる
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">
          <h3 className="font-bold">保存される場所</h3>
          <p className="mt-1">
            DEMO/REALの建玉、チェックリスト、口座全体の入力値は、利用者本人のブラウザ内 `localStorage` に保存されます。
            GitHubや作成者のサーバーには保存されません。
          </p>
        </div>
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
          <div className="flex items-center gap-2 font-bold">
            <AlertTriangle size={18} />
            削除前の注意
          </div>
          <p className="mt-1">
            下の削除を実行すると、このブラウザに保存された米国株オプション建玉管理アプリの入力データが消えます。
            必要なら先にJSONでバックアップしてください。
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm leading-6 text-sky-950">
        <h3 className="font-bold">外部株価・為替取得</h3>
        <p className="mt-1">{externalQuoteModeLabel}</p>
        <p className="mt-1">
          株価更新で送信するのは銘柄ティッカー、為替更新で送信するのはUSD/JPY取得リクエストだけです。
          保有株数、建玉数量、プレミアム、口座残高、証拠金使用率、JSONバックアップ、localStorageの保存内容は送信しません。
        </p>
      </div>

      <button
        className="mt-4 inline-flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800 hover:bg-red-100"
        onClick={() => {
          const ok = window.confirm("この端末の入力データを削除します。必要なJSONバックアップは保存済みですか？");
          if (ok) clearLocalData();
        }}
      >
        <Trash2 size={16} />
        この端末の入力データを削除
      </button>
    </section>
  );
}
