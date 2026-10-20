# Windows向け Saxo API read-only helper ガイド

GitHub Pages版アプリはSaxo OpenAPIへ直接接続しません。Saxoとの通信は、ご自身のPC上で起動するread-only helperが担当します。この案内はWindows向けですが、同じNode.jsコマンドはNode.js対応の端末でも使えます。

## 1. helperを準備する

1. [公開リポジトリ](https://github.com/jimusaku-lab/us-options-risk-planner)を開き、`Code` → `Download ZIP` でソースZIPを取得します。
2. ZIPを任意のフォルダーへ展開します。
3. [Node.js 24公式ダウンロード](https://nodejs.org/en/download/archive/v24)から、ご利用のWindowsに合ったInstallerをインストールします。helperはNode.js標準機能で動くため、`npm install`や画面アプリのbuildは不要です。
4. 展開したフォルダーの中で、`package.json`、`scripts`、`server`が並んでいる場所を確認します。
5. そのフォルダーをPowerShell、コマンドプロンプト、またはTerminalで開き、次を実行します。

```text
node scripts/start-saxo-readonly-local.mjs --public
```

フォルダーが違う、Node.jsが見つからない、または既にloopbackポートが使用中の場合、helperは起動を止めて理由を表示します。既存listenerを自動終了・置換することはありません。画面アプリも同時にローカル起動する必要はありません。

起動後、ブラウザーから次を開いてread-only statusが返ることを確認できます。

```text
http://127.0.0.1:18787/api/saxo/status
```

helperを終了する時は、そのhelperを起動したターミナルで`Ctrl+C`を押してください。別のプロセスは停止しません。

## 2. Saxo LIVE AppKeyを設定する

GitHub Pages版アプリの「Saxo API詳細」→「設定・診断」→接続セットアップで、ご自身のSaxo Developer Portalが発行したLIVE AppKeyを入力し、環境を`LIVE`にして保存します。AppKeyはブラウザーのshell commandへ貼り付けず、他人へ共有しないでください。保存先はhelperフォルダーの`.env.local`で、Git管理対象外です。コード、ブラウザーlocalStorage、公開サイトへは保存しません。

Saxo Developer Portalでご自身のOpenAPIアプリを作成し、PKCE（Authorization Code Grant）を使う設定にします。まずSIMアプリを作成・確認し、その後LIVE利用資格を申請します。LIVE資格にはSaxo側の審査・承認が必要な場合があります。詳細は公式の[OpenAPIアプリ作成案内](https://www.developer.saxo/openapi/learn/writing-an-openapi-application)、[LIVE資格申請案内](https://www.developer.saxo/openapi/learn/direct-clients-request-for-openapi-application-credentials-for-the-live-environ)、[環境説明](https://www.developer.saxo/openapi/learn/environments)を参照してください。

OAuthの**callback/redirect URI**と、ログイン完了後に戻る**アプリ画面のURL**は別です。Saxoの[PKCE案内](https://www.developer.saxo/openapi/learn/oauth-authorization-code-grant-pkce)に合わせ、Saxo Developer Portalにはcallbackのportを登録しません。PortalのRedirect URI登録欄には、次を登録してください。

```text
http://localhost/api/saxo/auth/callback
```

実行中helperがcallbackを受信するURLは、port付きの次のURLです。

```text
http://localhost:18787/api/saxo/auth/callback
```

つまり、Portal登録用URLはportなし、実行時callback URLはhelperのport付きです。hostとpathは一致させます。アプリ画面へ戻るURLは別設定で、`--public`起動では`https://jimusaku-lab.github.io/us-options-risk-planner/`です。これはPortal登録用callback URIではありません。

公開サイトから初めて`127.0.0.1`へ接続する時、ブラウザーがローカルネットワーク/loopback接続の許可を尋ねることがあります。接続元がこの公開サイトであることを確認して許可してください。許可がない場合はサイト単位のブラウザー権限、helperの起動状態、ローカル通信を確認します。ファイアウォール、証明書検証、ブラウザーの安全機能を無効化する必要はありません。

## 3. 公式ログインとプレビュー

1. GitHub Pages版アプリの上部で`DEMO`から`REAL`へ切り替えます。SIM用AppKeyとLIVE用AppKeyは別です。
2. 「Saxo接続」を選び、Saxo LIVE公式ログイン画面で本人が認証します。Saxo ID、パスワード、2FAコードはこのアプリや作者に共有しないでください。
3. 取得した口座一覧を確認し、実際に存在し、通貨と用途を確認できた口座だけを割り当てます。JPY口座をP、USD口座をNとして使う場合は、口座表示と通貨を照合してから選びます。口座が1つだけなら、その口座だけを割り当て、存在しないもう一方の口座を作成・設定する必要はありません。
4. 「まとめて取得」で取得結果をプレビューします。値・出所・対象口座を確認したうえで、必要な項目だけ手動で反映します。取得だけで建玉、現金、成績、注文内容を自動変更しません。

この機能はread-onlyです。注文、注文変更・取消、exerciseは行いません。全イベントや履歴を完全に取得できる保証はなく、バックグラウンドの自動取得・常時同期も行いません。個別候補の取得可否や欠損は画面で確認してください。

## 接続保持と再ログイン

helperの状態表示が接続保持能力を返す場合に限り、その機能を利用できます。macOSの対応環境ではKeychainを使います。Windowsでは現在、接続tokenはhelper稼働中のメモリ内だけにあり、helperまたはPCを終了・再起動するとSaxo公式画面で再ログインが必要です。tokenをWindows Credential Managerやファイルへ新たに保存する機能はありません。

## 安全に関する注意

- `127.0.0.1`にbindするread-only helperです。注文系endpointは提供しません。
- Saxoのログイン情報、token、口座番号、Account ID、注文/建玉識別子をチャット、公開Issue、画面共有へ貼らないでください。
- helperが停止したか通信できない場合、画面だけでは原因を断定できません。status endpoint、ブラウザーloopback許可、helper起動ターミナルを確認してください。
- 公開アプリから取得値を反映する場合は、毎回画面の内容を確認して手動操作してください。
