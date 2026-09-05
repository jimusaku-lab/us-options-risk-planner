# Windows向け Saxo API Read-only ローカル補助ツール起動ガイド

GitHub Pages公開版の米国株オプション建玉管理アプリは、Saxo OpenAPIへ直接接続しません。

Saxo API接続を使う場合は、自分のWindows PC上でRead-onlyのローカル補助ツールを起動し、公開版アプリからその補助ツールへ接続します。

この仕組みはMac専用ではありません。Windowsでも利用できます。

## よくあるエラー

Windowsのコマンドプロンプトに、次のようなMac/Linux用の1行コマンドを貼ると失敗します。

```bash
SAXO_LOCAL_UI_ALLOWED_ORIGIN=https://jimusaku-lab.github.io SAXO_LOCAL_UI_RETURN_URL=https://jimusaku-lab.github.io/us-options-risk-planner/ npm run dev:saxo-api
```

この形式はWindowsの `cmd.exe` では使えません。

スクリーンショットのように、

```text
'SAXO_LOCAL_UI_ALLOWED_ORIGIN' は、内部コマンドまたは外部コマンド、
操作可能なプログラムまたはバッチ ファイルとして認識されていません。
```

と出る場合は、Windows用の環境変数指定に直してください。

## PowerShellで起動する場合

PowerShellを開き、ローカル補助ツールのフォルダへ移動します。

```powershell
cd "C:\path\to\us-options-risk-planner"
```

次に、環境変数を設定してから起動します。

```powershell
$env:SAXO_LOCAL_UI_ALLOWED_ORIGIN="https://jimusaku-lab.github.io"
$env:SAXO_LOCAL_UI_RETURN_URL="https://jimusaku-lab.github.io/us-options-risk-planner/"
$env:SAXO_CLIENT_ID="自分のSaxo LIVE AppKey"
$env:SAXO_ENVIRONMENT="live"

npm run dev:saxo-api
```

## コマンドプロンプトで起動する場合

コマンドプロンプトを開き、ローカル補助ツールのフォルダへ移動します。

```cmd
cd C:\path\to\us-options-risk-planner
```

次に、環境変数を設定してから起動します。

```cmd
set SAXO_LOCAL_UI_ALLOWED_ORIGIN=https://jimusaku-lab.github.io
set SAXO_LOCAL_UI_RETURN_URL=https://jimusaku-lab.github.io/us-options-risk-planner/
set SAXO_CLIENT_ID=自分のSaxo LIVE AppKey
set SAXO_ENVIRONMENT=live

npm run dev:saxo-api
```

## 起動成功の目安

成功すると、ターミナルに次のような表示が出ます。

```text
Saxo read-only local API listening on http://127.0.0.1:18787
```

この表示が出たら、ターミナルは閉じずにそのまま置いてください。

その後、公開版アプリに戻り、`Saxo API詳細` から接続確認またはSaxo接続へ進みます。

公開版アプリ:

```text
https://jimusaku-lab.github.io/us-options-risk-planner/
```

## 注意点

- `SAXO_CLIENT_ID` はSaxo Developer Portalで取得するAppKeyです。
- `SAXO_CLIENT_ID` はSaxoログインIDや口座番号ではありません。
- `SAXO_ENVIRONMENT` は本番口座なら `live`、検証環境なら `sim` を指定します。
- Saxo ID、パスワード、2FAコード、OAuth token、refresh token、口座番号、Account IDはChatGPT/Codexにもアプリ作者にも共有しないでください。
- この補助ツールはRead-onlyです。発注、注文変更、注文取消、権利行使操作は行いません。
- 取得値はアプリへ自動上書きされません。画面上のプレビューを確認し、明示的に反映する操作をした場合だけ反映されます。
