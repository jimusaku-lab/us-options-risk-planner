export function FirstRunNotice({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
      <section className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
        <div className="rounded-md bg-sky-50 px-3 py-2 text-sm font-bold text-sky-900">限定テスト版</div>
        <h2 className="mt-4 text-xl font-bold text-slate-950">ご利用前の確認</h2>
        <ul className="mt-4 grid gap-3 text-sm leading-6 text-slate-700">
          <li className="rounded-md border border-slate-200 bg-slate-50 p-3">これは限定テスト版です。</li>
          <li className="rounded-md border border-slate-200 bg-slate-50 p-3">
            入力内容は利用者本人のパソコン・ブラウザ内に保存されます。
          </li>
          <li className="rounded-md border border-slate-200 bg-slate-50 p-3">作成者へ自動送信されません。</li>
          <li className="rounded-md border border-slate-200 bg-slate-50 p-3">試算は概算です。</li>
          <li className="rounded-md border border-slate-200 bg-slate-50 p-3">
            使い終わったら「データ」画面からこの端末の入力データを削除できます。
          </li>
        </ul>
        <button
          className="mt-5 w-full rounded-md bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
          onClick={onAccept}
        >
          確認して使い始める
        </button>
      </section>
    </div>
  );
}
