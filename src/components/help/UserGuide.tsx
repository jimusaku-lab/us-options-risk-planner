import { ShieldCheck } from "lucide-react";

export function UserGuide({ onClose }: { onClose: () => void }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">使い方</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Saxo画面を見ながら、米国株式・米国株式オプションの建玉、口座余力、証拠金、プレミアム、年率、税務区分、反対売買、ホイール管理を手入力で確認するためのツールです。投資助言、税務助言、自動売買、発注代行は行いません。
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
          データ保存とバックアップ
        </div>
        <p className="mt-1">
          入力データはこのブラウザのlocalStorageに自動保存され、GitHub Pagesや作成者側へ自動送信されません。別PC・別ブラウザには同期されず、ブラウザのサイトデータを削除すると消えます。CSVは一覧確認用、JSONは復元できるバックアップ用です。重要な入力後、PC変更前、ブラウザ整理前にはJSONを保存してください。
        </p>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <GuideBlock
          title="1. DEMO / REAL"
          items={[
            "DEMOは練習・検証用で、表示名はDEMO / JPYベースです。米国株やオプション価格はUSDでも、画面下部の口座通貨、現金残高、買付可能額、評価額、証拠金使用率はJPYベースとして扱います。",
            "DEMOは本番N口座相当ではありません。N口座のUSD残高管理、JPY→USD資金振替、USD取得レート、USDホイール台帳の完全検証には使いません。",
            "REALは実資金管理用です。P口座はJPY決済、N口座はUSD決済として分け、余力・証拠金・現金残高・建玉は合算しません。",
          ]}
        />
        <GuideBlock
          title="2. 口座全体の余力・証拠金"
          items={[
            "Saxo画面下部に出る口座全体の数値を入力します。個別銘柄ごとの値ではありません。",
            "DEMOではDEMO / JPYベースの現金残高、買付可能額、口座純資産、必要証拠金余力、証拠金使用率を入力します。",
            "REALではP口座とN口座を別々に入力します。P口座余力をN口座建玉に使う前提、またはその逆の前提では計算しません。",
          ]}
        />
        <GuideBlock
          title="3. 建玉ダッシュボード"
          items={[
            "銘柄、状態、口座、戦略、権利行使価格、満期、プレミアム、使用分母、年率、警告を一覧できます。",
            "行をクリックすると下のカード群へ反映されます。鉛筆アイコンで編集、削除アイコンで建玉削除です。",
            "決済済み、権利行使済み、満期終了は履歴として残り、必要な時に表示できます。",
          ]}
        />
        <GuideBlock
          title="4. 建玉入力"
          items={[
            "新規建玉または鉛筆アイコンから、口座、状態、戦略、銘柄、株価、為替、建玉日、満期日、権利行使価格、プレミアム、手数料を入力します。",
            "カバードコールでは保有株数と取得単価を入力します。プット売り単体では現物株入力は使わず、権利行使時に必要な買付資金と資金確認の充足/不足/未確認を確認します。",
            "利確ルール、損切りルール、主分母、NISA等比較年率は注文前の判断目安です。入力しても自動発注されません。",
          ]}
        />
        <GuideBlock
          title="5. 反対売買判断"
          items={[
            "建玉中に途中決済を検討するときだけ開きます。Saxoの決済チケットに出る買戻し価格を入力します。",
            "建てた時のプレミアム、現在の買戻し価格、手数料控除、今閉じた場合の概算損益、プレミアム確保率、利確・損切りルール判定を確認できます。",
            "これは発注画面ではありません。最終判断と注文操作は利用者本人が証券会社画面で行います。",
          ]}
        />
        <GuideBlock
          title="6. 分母・年率"
          items={[
            "年率換算は、受取プレミアムまたは税引後利益を使用分母で割り、建玉日から満期日までの暦日数で年換算します。営業日数ではありません。",
            "分母比較では、証拠金のみ、現物株＋チケット証拠金、現物株＋使用証拠金、キャッシュセキュアード、保守的共通分母を比較できます。",
            "N口座ではUSD同士で主計算します。USD/JPYを更新してもUSD建て年率は変わりません。JPY表示は参考換算です。",
          ]}
        />
        <GuideBlock
          title="7. 税務・譲渡記録"
          items={[
            "税務表示は概算で、確定申告用の税額ではありません。必要に応じて専門家に確認してください。",
            "オプション損益は先物取引に係る雑所得等、現物株売却損益は上場株式等の譲渡所得等として別区分で表示します。",
            "現物株を売却した、またはカバードコールで株を渡した場合だけ、現物株の譲渡記録をONにして譲渡日、株数、売却単価、取得単価、為替、手数料を入力します。",
          ]}
        />
        <GuideBlock
          title="8. シナリオとチャート"
          items={[
            "シナリオカードは、満期時の株価位置ごとに、株を取得せず終わる、株取得に近づく、株を渡すなどの状態を整理します。",
            "満期ペイオフチャートは、満期時の株価ごとの概算損益を可視化します。含み損益が直ちに実現損益として確定するわけではありません。",
            "リスク警告と注文前チェックリストは、注文前に利用者が確認するためのものです。発注を自動で止める機能ではありません。",
          ]}
        />
        <GuideBlock
          title="9. N口座ホイール管理"
          items={[
            "ホイール管理はREALのN口座内でUSDベースで回す前提です。DEMOはUSDホイール台帳の検証済みデータとして扱いません。",
            "基本ルートは、N口座USD保有、Nプット売り、N株式取得、Nカバードコール、株式売却または権利行使、N口座USDへ戻る流れです。",
            "P口座で取得した株式は、P→N株式移管として記録できます。移管は売却ではないため、オプション損益、現物譲渡損益、為替損益には含めません。",
          ]}
        />
        <GuideBlock
          title="10. 候補リストとデータ管理"
          items={[
            "候補リスト機能では、画面のサンプル読込、または自分で用意した候補JSON/CSVから、チャート分析、戦略適性、オプション候補、資金条件、建玉案レビュー前チェックを確認できます。",
            "サンプルは合成データです。候補は売買推奨ではなく、持ち込みデータを確認しやすく分類したものです。",
            "チェック済みは確認記録です。建玉案レビューへ進む場合も、最終的な数値は証券会社画面で確認してください。",
            "JSON復元は現在のワークスペースデータを置き換えます。必要に応じて先にJSONを保存してください。",
            "データ画面では、この端末のブラウザ内に保存された入力データを削除できます。端末共有時や試用後に利用してください。",
          ]}
        />
      </div>

      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600">
        <h3 className="text-sm font-bold text-slate-950">基本手順</h3>
        <p className="mt-2">
          DEMOまたはREALを選ぶ → 口座全体の余力・証拠金を入力 → 新規建玉を作る → 口座、状態、戦略、銘柄、株価、為替、オプション脚、プレミアム、手数料を入力 → 必要に応じて利確・損切りルールや譲渡記録を設定 → サマリー、分母比較、年率根拠、税務区分、シナリオ、チャート、警告を確認 → 途中決済時は反対売買判断を開く → 重要な入力後はJSONでバックアップ。
        </p>
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
