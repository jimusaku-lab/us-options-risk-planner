# 友人向けSaxo API接続準備ガイド

このガイドは、GitHub Pages版の米国株オプション建玉管理アプリで、Saxo OpenAPIをRead-only接続するための準備手順です。

このアプリは発注、注文変更、注文取消を行いません。Saxoの値を読み取り、アプリ内の手入力候補や差分プレビューとして使うだけです。

## 1. 何を作るのか

Saxo OpenAPIを使うには、Saxo Developer PortalでOpenAPI applicationを作ります。

- SIM application: Developer Portalで最初に作成・検証するアプリです。
- LIVE app: 本番口座へRead-only接続するために申請または取得するアプリ資格情報です。
- LIVE AppKey（Client ID）: このアプリをSaxo OpenAPIへ接続するための識別子です。この値だけを自分のMacのローカル設定に入れます。
- Redirect URI: Saxoで認証が終わった後に、ローカルAPIへ戻るためのURLです。

このアプリで使うRedirect URI:

```text
http://127.0.0.1:18787/api/saxo/auth/callback
```

## 2. 似ている情報の違い

### SaxoTraderGOのログインID

通常のSaxo公式ログイン画面でだけ入力するIDです。

- このアプリには保存しません。
- GitHub、ChatGPT、Codex、メール、チャットへ貼らないでください。

### Saxo Developer Portal

OpenAPI applicationを作成・管理するSaxoの開発者向け画面です。

- SIM applicationを作ります。
- LIVE appの申請や取得を行います。
- Redirect URIを登録します。
- LIVE AppKey（Client ID）を確認します。

### OpenAPI application

Saxo OpenAPIを使うためのアプリ登録です。

- AppKey / Client IDが発行されます。
- このアプリではPKCE方式を使います。
- このアプリではClient Secretを使いません。

### LIVE AppKey（Client ID）

このアプリをSaxo APIへ接続するための識別子です。

- 自分のMacのローカルAPI設定に入力します。
- Saxo Account IDやP/N口座番号ではありません。
- Client Secretではありません。

## 3. 準備チェックリスト

アプリ内の「Saxo API接続準備」でも同じ項目を確認できます。

1. Saxo Developer Portalに入れる
2. SIM applicationを作成した
3. Redirect URIを登録した
4. LIVE appを申請または取得した
5. Client ID / AppKeyを確認した
6. ローカルAPIを起動した
7. Read-only接続できた

## 4. LIVE利用時の注意

LIVE接続は本番口座のRead-only接続です。SIM / Trial口座ではありません。

- SIM applicationだけでは本番口座の値は取得できません。
- LIVE appを使う場合は、Developer PortalのLive Apps側で申請または取得します。
- LIVE appのRedirect URIにも、上記のローカルAPI callback URLを登録してください。
- アプリ側の環境はLIVEにします。
- 接続後、P口座がJPY、N口座がUSDであることを確認してから反映してください。
- SIM / Trial / 通貨不一致の値をREALワークスペースへ反映しないでください。

## 5. ローカルAPIの起動

GitHub Pages自体はSaxoへ接続しません。Saxoとの通信は、自分のMacで起動したローカルAPIだけが行います。

公開版リポジトリをcloneしたディレクトリで、次を実行します。

```bash
npm run dev:saxo-api
```

`.env.local` の例:

```text
SAXO_CLIENT_ID=自分のLIVE AppKey
SAXO_ENVIRONMENT=live
SAXO_LOCAL_UI_ALLOWED_ORIGIN=https://jimusaku-lab.github.io
SAXO_LOCAL_UI_RETURN_URL=https://jimusaku-lab.github.io/us-options-risk-planner/
SAXO_LOCAL_API_PORT=18787
```

`.env.local` はGit管理に入れません。

## 6. ChatGPT/Codexに貼ってよい情報

貼ってよいもの:

- 画面の一般的な文言
- エラー名やHTTP status
- Redirect URI
- 操作に迷っている画面の説明
- 個人情報や識別子を隠したスクリーンショット

貼ってはいけないもの:

- Saxo Account ID
- password
- 2FAコード
- Client Secret
- OAuth access token
- OAuth refresh token
- 口座番号、AccountKey、ClientKey、氏名
- 未マスクの取引明細や口座残高
- JSONバックアップの中身

Client ID / AppKeyは秘密鍵ではありませんが、チャットに貼らず、自分のMacのローカル設定欄へだけ入力してください。

## 7. ChatGPT/Codexへ相談する時の文例

```text
目的: Saxo OpenAPI Read-only接続を設定したいです。
秘密情報は貼りません。
Saxo Developer Portal、OpenAPI application、Redirect URI、LIVE AppKey（Client ID）、ローカルAPI起動の画面操作だけ伴走してください。
Client Secret、Saxo Account ID、password、2FAコード、OAuth token、refresh tokenは絶対に共有しません。
このアプリは発注・注文変更・注文取消を行わないRead-only用途です。
redirect URIは http://127.0.0.1:18787/api/saxo/auth/callback を使います。
```

## 8. 公式参考

- [How do I get started with OpenAPI](https://openapi.help.saxo/hc/en-us/articles/5231611647517-How-do-I-get-started-with-OpenAPI)
- [What redirect URL should I use](https://openapi.help.saxo/hc/en-us/articles/4416527810065-What-redirect-URL-should-I-use)
- [How do I find keys for setting up OAuth](https://openapi.help.saxo/hc/en-us/articles/4416514219409-How-do-I-find-keys-for-setting-up-OAuth)
- [Direct clients: request for OpenAPI application credentials for the LIVE environment](https://www.developer.saxo/openapi/learn/direct-clients-request-for-openapi-application-credentials-for-the-live-environ)
