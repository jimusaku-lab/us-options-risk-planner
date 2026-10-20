# 友人向けSaxo API接続準備ガイド

このガイドは、GitHub Pages版の米国株オプション建玉管理アプリで、Saxo OpenAPIをRead-only接続するための準備手順です。

Windowsで初めて準備する方は、先に[Windows向けhelperガイド](saxo-api-windows-local-helper-guide-2026-07-08.md)を開いてください。入手・起動・本人認証までを順番に説明しています。

このアプリは発注、注文変更、注文取消を行いません。Saxoの値を読み取り、アプリ内の手入力候補や差分プレビューとして使うだけです。

GitHub Pages版は静的UIです。Saxo read-onlyを使う場合も、公開サーバーを経由せず、同じPCで利用者が起動した `127.0.0.1:18787` のローカルhelperへ固定Originで接続します。helperが起動していない、接続状態またはbulk capabilityが確認できない場合は価格取得を有効化しません。候補価格は明示的な確認・反映まで保存されません。

password、2FA、AppKey/Secret、access token、AccountKey/UIC等の識別子、未マスクのraw応答はGitHub、ChatGPT、Codex、メール、チャット、Gemini等の外部AIへ貼り付けないでください。相談時は銘柄・口座・ID・金額を匿名化した一般情報だけを使ってください。

## 1. 何を作るのか

Saxo OpenAPIを使うには、Saxo Developer PortalでOpenAPI applicationを作ります。

- SIM application: Developer Portalで最初に作成・検証するアプリです。
- LIVE app: 本番口座へRead-only接続するために申請または取得するアプリ資格情報です。
- LIVE AppKey（Client ID）: このアプリをSaxo OpenAPIへ接続するための識別子です。この値だけを自分のPCのhelper設定欄に入れます。
- Redirect URI: Saxoで認証が終わった後に、ローカルAPIへ戻るためのURLです。

このアプリが認証要求に使うRedirect URI（実行時）:

```text
http://localhost:18787/api/saxo/auth/callback
```

PKCE用のSaxo Portal登録値は、公式仕様に従いportを含めず `http://localhost/api/saxo/auth/callback` とします。実行時は上記18787番へ戻ります。ログイン成功後に表示する公開アプリURLとは別です。公開アプリのhelperポートは既定の18787を使用してください。

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

- 自分のPCのhelper設定欄に入力します。
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
- LIVE appにも、PKCE用のローカルAPI callbackを登録してください（登録時はportなし、実行時は18787番）。
- アプリの上部をREALに切り替え、接続環境はLIVEにします。
- 接続後、P口座がJPY、N口座がUSDであることを確認してから反映してください。
- SIM / Trial / 通貨不一致の値をREALワークスペースへ反映しないでください。

## 5. ローカルAPIの起動

GitHub Pages自体はSaxoへ接続しません。Saxoとの通信は、自分のPCで起動したローカルAPI補助ツールだけが行います。

友人が普段使うアプリ本体は、GitHub Pagesの公開版です。
更新も今まで通りGitHub Pages側で反映されます。
PCに置く必要があるのは、Saxoと通信するためのローカルAPI補助ツールだけです。

なぜ補助ツールが必要か:

- GitHub Pagesは静的Webアプリであり、SaxoのOAuth tokenを安全に保存する場所にはできません。
- macOSの対応環境では、本人が選択した場合にKeychainで接続を保持できます。Windowsでは現状tokenはhelper稼働中のメモリ内のみで、helperやPCの再起動後はSaxo公式画面で再ログインが必要です。
- GitHub PagesはSaxo APIの中継サーバにはなりません。
- この仕組みにより、Saxo ID、パスワード、2FAコード、OAuth token、口座情報はGitHub Pagesや作者側には保存されません。

[公開リポジトリ](https://github.com/jimusaku-lab/us-options-risk-planner)のCode → Download ZIPから取得・展開し、[Node.js 24 LTS](https://nodejs.org/en/download)を準備します。`package.json`・`scripts`・`server`が並ぶフォルダで、次を実行します。helperだけなら`npm install`や画面アプリのbuildは不要です。

```text
node scripts/start-saxo-readonly-local.mjs --public
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

### Mac / Windows の違い

上のNode.jsコマンドは両方のOSで共通です。

- Mac: ターミナルで起動します。
- Windows: 展開したhelperフォルダでPowerShellまたはコマンドプロンプトを開いて起動します。

公開版では`--public`が公開サイト向けの設定を選ぶため、Mac用の環境変数コマンドをWindowsへ貼り付ける必要はありません。PowerShellの実行ポリシーや、ファイアウォール・ブラウザの安全機能を無効化しないでください。ローカル通信の許可を尋ねられた場合だけ、接続元がこの公開サイトであることを確認してサイト単位で許可します。

以前のhelperを持っている場合も、今回の起動修理を使うには最新版のソースが必要です。既存の`.env.local`を削除・公開せず保持し、起動中の旧helperは本人がそのターミナルで終了してから更新してください。二重起動して既存プロセスを置き換える機能はありません。

### 起動できたかどうかの見方

ローカルAPIの起動に成功すると、ターミナルまたはPowerShellに次のような表示が出ます。

```text
Saxo read-only local API listening on http://127.0.0.1:18787
```

この表示が出たら、ターミナル/PowerShellは閉じずに置いてください。
その後、アプリ画面に戻って `起動できたか確認` を押します。

取得・確認・保存の間はPC、helper、アプリを開いておきます。閉じたままの自動取得・常時同期・無確認のREAL自動保存は実装していません。新規・決済・満期等のイベントも取得範囲と根拠を確認して反映します。

Macでコマンド貼り付け後に `>` だけが表示されて止まった場合は、まだ実行されていません。
`Control + C` でキャンセルし、アプリが表示する1行コマンドを貼り直してください。

### `.env.local` が必要な理由

公開版GitHub PagesはClient IDやOAuth tokenを保存しません。
そのため、ローカルAPIを起動するフォルダに `.env.local` が必要です。

既に自分のローカル版でSaxo接続できている場合は、その `.env.local` をローカルAPI補助ツールのフォルダへコピーして使えます。
初めて使う場合は、helperを起動後、アプリの設定・診断内で本人のLIVE AppKeyとLIVE環境を保存すると、helperの`.env.local`へ記録されます。tokenをこのファイルへ書き込む必要はありません。

`.env.local` はGitHubにpushしてはいけません。
このリポジトリでは `.gitignore` で除外します。

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

Client ID / AppKeyは秘密鍵ではありませんが、チャットに貼らず、自分のPCのhelper設定欄へだけ入力してください。

## 7. ChatGPT/Codexへ相談する時の文例

```text
目的:
GitHub Pages公開版の米国株オプション建玉管理アプリで、Saxo OpenAPI Read-only接続を設定したいです。

前提:
アプリ本体はGitHub Pagesの公開版を使い続けます。
Saxo API接続を使う場合だけ、Saxoとの通信を担当するPC側補助ツールを自分のPC上で起動する必要があります。
この補助ツールは発注を行わず、Read-only取得だけを行います。

あなたに伴走してほしいこと:
1. 私のPCがMacかWindowsかを確認してください。
2. Saxo Developer Portalに入る手順を案内してください。
3. OpenAPI applicationを作る手順を案内してください。
4. PKCE用Redirect URIをSaxo公式仕様に従って登録するよう案内してください。
   Portal登録: http://localhost/api/saxo/auth/callback
   このアプリの実行時callback: http://localhost:18787/api/saxo/auth/callback
5. LIVE AppKey（Client ID）を確認する手順を案内してください。
6. 最新helperのZIPを展開し、Node.js 24を準備し、正しいフォルダで次の共通コマンドを実行する手順を案内してください。npm installは不要です。
   node scripts/start-saxo-readonly-local.mjs --public
7. ローカルAPI起動後、次の成功ログが出ているか確認するよう案内してください。
   Saxo read-only local API listening on http://127.0.0.1:18787
8. Macでターミナルに `>` だけが出て止まった場合は、Control + Cでキャンセルして1行コマンドを貼り直すよう案内してください。
9. アプリをREALに切り替えて「起動できたか確認」を押し、本人のLIVE AppKey設定、Saxo公式認証、口座割当、取得・確認・保存へ順に進むよう案内してください。
10. Windowsではhelper終了後の再ログインが必要です。無確認の自動保存やブラウザを閉じた常時同期があるとは案内しないでください。

絶対に共有しない情報:
- Saxo ID
- Saxoパスワード
- 2FAコード
- Client Secret
- Saxo Account ID
- OAuth token
- refresh token
- 口座番号
- 口座残高や建玉の詳細スクリーンショット

共有してよい情報:
- OSがMacかWindowsか
- 画面上の一般的な文言
- Redirect URI
- エラー文
- 個人情報を隠したスクリーンショット
- LIVE AppKeyが「取得済みかどうか」だけ

重要:
Client Secretはこのアプリでは使いません。
Saxo ID、パスワード、2FAコード、OAuth tokenは、ChatGPT/Codexにもアプリ作者にも貼りません。
このアプリは発注・注文変更・注文取消を行わないRead-only用途です。
```

## 8. 公式参考

- [Authorization Code Grant (PKCE)](https://www.developer.saxo/openapi/learn/oauth-authorization-code-grant-pkce)
- [How do I get started with OpenAPI](https://openapi.help.saxo/hc/en-us/articles/5231611647517-How-do-I-get-started-with-OpenAPI)
- [What redirect URL should I use](https://openapi.help.saxo/hc/en-us/articles/4416527810065-What-redirect-URL-should-I-use)
- [How do I find keys for setting up OAuth](https://openapi.help.saxo/hc/en-us/articles/4416514219409-How-do-I-find-keys-for-setting-up-OAuth)
- [Direct clients: request for OpenAPI application credentials for the LIVE environment](https://www.developer.saxo/openapi/learn/direct-clients-request-for-openapi-application-credentials-for-the-live-environ)
