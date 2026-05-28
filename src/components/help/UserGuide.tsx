import { ShieldCheck } from "lucide-react";

export function UserGuide({ onClose }: { onClose: () => void }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">使い方</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            このアプリは、米国株オプションの建玉を手入力で記録し、注文前・保有中・決済前の確認をするための道具です。投資助言や自動売買は行いません。
          </p>
        </div>
        <button
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          onClick={onClose}
        >
          閉じる
        </button>
      </div>

      <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">
        <div className="flex items-center gap-2 font-bold">
          <ShieldCheck size={18} />
          データ保存について
        </div>
        <p className="mt-1">
          入力した建玉・口座情報は、このブラウザ内の保存領域に自動保存されます。GitHubや作者側のサーバーへ送信しません。
          別PC・別ブラウザには共有されません。外部バックアップが必要な場合だけ、JSONボタンで利用者自身がファイル保存します。
          GitHub Pages公開版では、外部通信を避けるため株価・為替の自動取得は無効にし、手入力で使う前提にしています。
          使い終わったら「データ」画面から、この端末の入力データを削除できます。
        </p>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <GuideBlock
          title="1. 最初に確認すること"
          items={[
            "DEMOは練習用、REALは実資金の管理用です。データは別々に保存されます。",
            "口座全体の余力・証拠金には、Saxo画面下部の現金残高と証拠金使用率を入力します。",
            "公開版ではデータ外部送信を避けるため、株価・為替はSaxo等で確認した値を手入力してください。",
          ]}
        />
        <GuideBlock
          title="2. 建玉を登録する"
          items={[
            "新規建玉を押し、戦略、銘柄ティッカー、株価、為替、満期、権利行使価格、プレミアム、手数料を入力します。",
            "カバードコールでは保有株数と取得単価を入れます。プット売り単体では現物株の入力は使いません。",
            "建玉状態は、注文前、建玉中、決済済み、権利行使済み、満期終了から選びます。",
          ]}
        />
        <GuideBlock
          title="3. 注文前に見るところ"
          items={[
            "受取プレミアム、使用分母、税前年率、税引後年率を確認します。",
            "分母比較で、どの資金を分母にした利回りなのかを確認します。",
            "リスク警告と注文前チェックリストを見て、警告が残っていないか確認します。",
          ]}
        />
        <GuideBlock
          title="4. 建玉中に見るところ"
          items={[
            "反対売買判断を開き、Saxoの決済チケットに出る買戻し価格を入力します。",
            "利確ルール・損切りルールに到達しているかを確認します。",
            "満期ペイオフチャートとシナリオで、満期時の見え方を確認します。",
          ]}
        />
        <GuideBlock
          title="5. 履歴とバックアップ"
          items={[
            "決済済み、権利行使済み、満期終了にした建玉は履歴として残ります。通常は折りたたまれます。",
            "CSVは一覧確認用です。表計算ソフトで見るために使います。",
            "JSONはアプリに戻せるバックアップです。重要な入力後やPC変更前に保存してください。",
          ]}
        />
        <GuideBlock
          title="6. 注意点"
          items={[
            "このアプリからSaxoへ発注する機能はありません。",
            "税額や年率は試算です。確定申告や税務判断には使わず、必要に応じて専門家に確認してください。",
            "ブラウザのサイトデータを削除すると自動保存データも消えるため、必要に応じてJSONで退避してください。",
          ]}
        />
      </div>
    </section>
  );
}

function GuideBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-sm font-bold text-slate-950">{title}</h3>
      <ul className="mt-2 grid gap-2 text-sm leading-6 text-slate-600">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
