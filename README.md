# 米国株オプション建玉管理・リスク確認

米国株オプションの建玉、プレミアム、分母別年率、税引後比較、権利行使時資金、反対売買判断、決済実績、スクリーニング候補を手入力またはファイル取込で確認する公開版Webアプリです。

## 公開版の位置づけ

この公開版はGitHub Pagesで動く静的アプリです。

- 証券会社やローカルAPIへ直接接続しません。
- 手入力、CSV/JSON取込、`us_options_screening_package.v1` 取込で使います。
- チャート分析、戦略適性、オプション候補、資金条件、建玉案レビューを確認できます。
- 発注、注文変更、注文取消、権利行使操作は実装していません。
- 戦略適性は売買推奨ではなく、持ち込みデータを分類するための参考表示です。

ローカル版だけにある外部取得・参考価格取得機能は、この公開版には含めません。

## データ保存方針

入力データは利用者本人のブラウザ内 `localStorage` に保存されます。

- GitHub Pagesへ入力データは送信しません。
- 作者や他の利用者へ入力データは共有されません。
- 別PC・別ブラウザには自動同期されません。
- ブラウザのサイトデータを削除すると、保存データも消えます。
- バックアップが必要な場合は、アプリ内の `JSON` ボタンで保存してください。

認証情報、APIキー、口座ID完全値、注文パスワードを候補JSONやバックアップJSONへ入れないでください。`us_options_screening_package.v1` 取込では、危険フィールドを検出して除外します。

## スクリーニング候補を試す

アプリ画面の `候補` パネルから `サンプルを読み込む` を押すと、配布済みの合成サンプルJSONをそのまま読み込めます。ファイルを保存して選び直す必要はありません。

配布サンプル:

```text
public/samples/us-options-screening-sample-v1.json
```

公開URLでは次のパスから取得できます。

```text
https://jimusaku-lab.github.io/us-options-risk-planner/samples/us-options-screening-sample-v1.json
```

使い方:

1. アプリを開く。
2. `候補` を開く。
3. `サンプルを読み込む` を押す。
4. Level 1からLevel 4の候補、チャート分析、戦略適性、オプション候補、資金条件、建玉案レビュー前チェックを確認する。

詳細は以下を参照してください。

- [公開版スクリーニング利用ガイド](docs/public-screening-user-guide-2026-07-05.md)
- [友人向けクイックスタート](docs/public-screening-friend-quickstart-2026-07-05.md)
- [共有用メッセージ](docs/public-screening-share-message-2026-07-05.md)
- [フィードバックテンプレート](docs/public-screening-feedback-template-2026-07-05.md)
- [初回フィードバック記録台帳](docs/public-screening-feedback-log-2026-07-05.md)
- [配布前QAチェックリスト](docs/public-screening-release-checklist-2026-07-05.md)
- [us_options_screening_package.v1 仕様メモ](docs/public-screening-package-spec-2026-07-05.md)

## 公開URL

```text
https://jimusaku-lab.github.io/us-options-risk-planner/
```

## 開発コマンド

```bash
npm run dev
npm test
npm run build
GITHUB_PAGES=true npm run build
npm run preview
```

## 注意

- 投資助言ではありません。
- サンプルJSONは合成データであり、実相場データではありません。
- 税額・年率・損益は試算です。
- 認証情報、APIキー、口座ID完全値、注文パスワードを入力データに入れないでください。
- 最終判断と実際の操作は、利用者本人が証券会社画面で確認して行ってください。
