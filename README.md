# 米国株オプション建玉管理・リスク確認

Saxo TraderGOの画面を見ながら手入力で、米国株オプション取引の建玉、プレミアム、分母別年率、税引後比較、権利行使時資金、注文前NG、反対売買判断、決済実績、当年成績を確認するWebアプリです。

## 現在の位置づけ

この版は、2026-06-08時点の **手入力MVP** を土台に、任意で使える **Saxo API Read-onlyローカル接続** を追加した公開版です。

- Saxo TraderGO等の画面を見ながら、利用者が数値を手入力して管理します。
- GitHub Pagesだけで使う場合は、従来どおりブラウザ内保存の手入力アプリとして動作します。
- Saxo API Read-onlyを使う場合は、利用者本人のMacでローカルAPIを起動します。GitHub Pages自体はSaxoへ直接接続しません。
- 注文作成、注文変更、注文取消、自動発注は実装していません。

## データ保存方針

入力データは利用者本人のブラウザ内 `localStorage` に保存されます。

- GitHub Pagesへ入力データは送信しません。
- 作者や他の利用者へ入力データは共有されません。
- 別PC・別ブラウザには自動同期されません。
- ブラウザのサイトデータを削除すると、保存データも消えます。
- 外部バックアップが必要な場合は、アプリ内の `JSON` ボタンで利用者本人がファイル保存します。
- 株価更新では銘柄ティッカー、為替更新ではUSD/JPY取得リクエストだけを外部の価格取得サービスへ送信します。
- 建玉数量、口座残高、証拠金、JSONバックアップ、localStorageの保存内容は送信しません。
- Saxo API Read-onlyで使うClient ID、OAuth token、refresh token、Saxo ID、パスワード、2FAコード、口座データ、JSONバックアップはGitHubへ保存しません。

GitHubに置くのはアプリ本体の静的ファイルだけです。利用者が入力した建玉、口座残高、証拠金使用率、CSV/JSONバックアップはリポジトリに含めません。

## Saxo API Read-onlyを使う場合

公開URLからSaxo API Read-onlyを使う場合も、Saxoとの通信は各自のMacで起動したローカルAPIが行います。友人テスターが使う場合も、その人自身のSaxo Developer Portal LIVE AppKeyを、その人のMac内で設定してください。

初めてSaxo OpenAPIを使う場合は、先に [友人向けSaxo API接続準備ガイド](docs/友人向けSaxo%20API接続準備ガイド.md) を確認してください。Developer Portal、OpenAPI application、LIVE AppKey、Redirect URI、ローカルAPI起動の関係を整理しています。

1. このリポジトリを各自のMacにcloneする。
2. `.env.example` を `.env.local` にコピーする。
3. `.env.local` に自分の `SAXO_CLIENT_ID` を入力する。
4. `SAXO_ENVIRONMENT=live` を確認する。
5. 次の値を確認する。

```text
SAXO_LOCAL_UI_ALLOWED_ORIGIN=https://jimusaku-lab.github.io
SAXO_LOCAL_UI_RETURN_URL=https://jimusaku-lab.github.io/us-options-risk-planner/
```

6. ローカルAPIを起動する。

```bash
npm run dev:saxo-api
```

7. 公開URL [https://jimusaku-lab.github.io/us-options-risk-planner/](https://jimusaku-lab.github.io/us-options-risk-planner/) を開き、Saxo API Read-onlyパネルから接続する。

OAuth redirect URIは以下です。Saxo Developer Portalのアプリ設定に登録してください。

```text
http://localhost:18787/api/saxo/auth/callback
```

保存しない情報:

- Saxo Account ID
- password
- 2FAコード
- Client Secret
- OAuth token / refresh tokenのブラウザlocalStorage保存
- 口座番号や氏名の未マスク表示

Read-only制限:

- 発注API endpointはありません。
- 注文変更API endpointはありません。
- 注文取消API endpointはありません。
- Saxo取得値は候補表示または差分プレビューに留め、利用者の確認なしに既存入力へ自動上書きしません。

## 使い方

1. `DEMO` または `REAL` を選ぶ。
2. `新規建玉` からSaxo画面の数値を手入力する。
3. `口座全体の余力・証拠金` にSaxo画面下部の現金残高と証拠金使用率を入れる。
4. ダッシュボードで現在の建玉を選ぶ。
5. 分母比較、税引後比較、シナリオ、満期ペイオフ、リスク警告を確認する。
6. 途中決済を検討するときは `反対売買判断` にSaxo決済チケットの買戻し価格を入れる。
7. 必要に応じて `CSV` で一覧出力、`JSON` でバックアップする。

アプリ内の `使い方` ボタンからも説明を確認できます。

## 公開URL

GitHub Pagesでは以下のパスに配置します。

```text
https://jimusaku-lab.github.io/us-options-risk-planner/
```

## 注意

- 投資助言ではありません。
- 税額・年率・損益は試算です。
- 発注機能はありません。
- 最終判断と注文操作は、利用者本人が証券会社画面で行います。

## Commands

```bash
npm run dev
npm run dev:saxo-api
npm run dev:all
npm run test
npm run build
GITHUB_PAGES=true npm run build
```
