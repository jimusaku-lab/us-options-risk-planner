# 2026-06-15 一般公開版 履歴実績分母・年率のDashboard共通化反映

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- ブランチ: `main`

## 実装内容

- ローカル実用版で対応した履歴実績モードの一覧行修正を、一般公開版へ反映した。
- `closed / assigned / expired` のDashboard履歴行で、注文前・建玉中向けの通常分母ではなく、共通ヘルパー `calculateHistoryPerformance` の履歴実績計算を使う構成であることを確認した。
- Dashboard履歴行の分母列見出しを `使用分母 / 実績分母` に変更し、履歴行では `実績分母` が表示されることを画面上で分かるようにした。
- Dashboard履歴行では、履歴行の年率に `税前 / 税後` の2値が表示される構成であることを確認した。
- P売り権利行使済み + stockAcquisition入力済みでは、現物株の現在時価をオプション実績分母に混ぜない `calculateHistoryPerformance` を使うことを確認した。
- 途中決済済みでは、建玉開始日から決済日までの実績日数を使う `calculateHistoryPerformance` を使うことを確認した。

## 修正ファイル

- `src/components/dashboard/Dashboard.tsx`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 共通化した計算ロジック

- 場所: `src/domain/historyPerformance.ts`
- 関数: `calculateHistoryPerformance(simulation)`
- 参照箇所:
  - `src/App.tsx`
  - `src/components/dashboard/Dashboard.tsx`
- テスト:
  - `src/domain/historyPerformance.test.ts`

## 確認結果

- `npm test`: 通過（13 files / 69 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- Git commit: 済み
- GitHub push: 済み
- GitHub Pages公開URL確認: 済み

## push情報

- 実装commit hash: `d84ab44`
- 報告書commit hash: `818288f`
- Pages deploy commit hash: `e270c4e`
- push branch: `main`
- push状態: 済み
- Pages branch: `gh-pages`
- Pages push状態: 済み
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 公開URL確認:
  - HTMLが `assets/index-Bo3NY2iX.js` を参照することを確認した。
  - 公開bundle内に `使用分母 / 実績分母` と `税前 / 税後` が含まれることを確認した。

## 残課題

- この時点ではなし。

---

# 2026-06-16 一般公開版 ChatGPT/Codex相談文コピー更新

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 対象ブランチ: `main` / `gh-pages`

## 実装内容

- `ChatGPT/Codexに渡す相談文をコピー` のコピー内容を更新した。
- 目的を `GitHub Pages公開版の米国株オプション建玉管理アプリで、Saxo OpenAPI Read-only接続を設定したい` に変更した。
- 前提として、アプリ本体はGitHub Pages公開版を使い続け、Saxo通信だけPC側補助ツールで行うことを明記した。
- 伴走してほしい内容に、OS確認、Developer Portal、OpenAPI application、Redirect URI、LIVE AppKey確認、Node.js/npm、`.env.local`、Mac/Windows別起動コマンド、成功ログ確認、Macの `>` 継続入力時の復旧、アプリ側の `起動できたか確認` と `Saxo接続` / `Saxo再接続` への誘導を追加した。
- 絶対に共有しない情報に、Saxo ID、Saxoパスワード、2FAコード、Client Secret、Saxo Account ID、OAuth token、refresh token、口座番号、口座残高や建玉の詳細スクリーンショットを明記した。
- 共有してよい情報に、OS、一般的な画面文言、Redirect URI、エラー文、個人情報を隠したスクリーンショット、LIVE AppKeyが取得済みかどうかだけを明記した。
- 友人向けガイドと詳細設計書の相談文説明も同じ趣旨に更新した。
- Saxo APIはRead-onlyのままで、発注・注文変更・注文取消endpointは追加していない。

## 修正ファイル

- `src/features/saxo/SaxoReadOnlyPanel.tsx`
- `docs/saxo-api-readonly-detailed-design-2026-06-08.md`
- `docs/友人向けSaxo API接続準備ガイド.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（13 files / 70 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-B3OF-1I8.js`
  - bundle内に `GitHub Pages公開版の米国株オプション建玉管理アプリで、Saxo OpenAPI Read-only接続を設定したいです`、`PC側補助ツールの準備に必要なNode.js/npm、.env.local、起動コマンドの手順を、Mac/Windows別に案内してください`、`Saxo read-only local API listening on http://127.0.0.1:18787`、`口座残高や建玉の詳細スクリーンショット`、`LIVE AppKeyが「取得済みかどうか」だけ`、`Client Secretはこのアプリでは使いません` が含まれることを確認した。

## commit / push

- 実装commit hash: `b441f44`
- Pages deploy commit hash: `1e2ccba`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-B3OF-1I8.js` を参照することを確認した。
- 公開bundle内に `GitHub Pages公開版の米国株オプション建玉管理アプリで、Saxo OpenAPI Read-only接続を設定したいです`、`PC側補助ツールの準備に必要なNode.js/npm、.env.local、起動コマンドの手順を、Mac/Windows別に案内してください`、`Saxo read-only local API listening on http://127.0.0.1:18787`、`口座残高や建玉の詳細スクリーンショット`、`LIVE AppKeyが「取得済みかどうか」だけ`、`Client Secretはこのアプリでは使いません` が含まれることを確認した。

## 残課題

- この時点ではなし。

---

# 2026-06-16 一般公開版 Saxo接続準備画面の説明順序修正

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 対象ブランチ: `main` / `gh-pages`

## 実装内容

- Saxo API接続準備画面の説明順序を変更した。
- 最初に、アプリ本体はGitHub Pagesの公開版を使い続けること、PCに置くのはSaxo通信を担当する補助ツールだけであることを表示するようにした。
- `なぜ必要か` として、GitHub Pagesが静的Webアプリであり、OAuth tokenの安全な保持、macOS Keychain/Windows側保存領域の利用、Saxo API中継サーバの役割を担えないことを明記した。
- `セキュリティ上の意味` として、Saxo ID、パスワード、2FA、OAuth token、口座情報がGitHub Pagesや作者側に保存されないことを明記した。
- 旧見出し `ローカルAPI補助サーバの準備` を `Saxo接続用のPC側補助ツールを準備` に変更した。
- Mac / Windows選択、Node.js、`.env.local`、起動コマンドは、役割説明・必要理由・セキュリティ説明の後に表示される順序へ整理した。
- 通常導線から `公開版リポジトリをclone`、`jimusaku-lab/us-options-risk-planner`、`ローカル版アプリ` に見える表現が出ないことを確認した。
- Saxo APIはRead-onlyのままで、発注・注文変更・注文取消endpointは追加していない。
- OAuth token、Saxo ID、password、2FA、Client Secretの保存・入力欄は追加していない。

## 修正ファイル

- `src/features/saxo/SaxoReadOnlyPanel.tsx`
- `docs/saxo-api-readonly-detailed-design-2026-06-08.md`
- `docs/友人向けSaxo API接続準備ガイド.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（13 files / 70 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-OLICrsd0.js`
  - bundle内に `ローカルAPI補助サーバの準備`、`公開版リポジトリ`、`jimusaku-lab/us-options-risk-planner`、`ダウンロードまたはclone`、`ローカル版アプリ`、`/Users/motomichi` が含まれないことを確認した。
  - bundle内に `Saxo接続用のPC側補助ツールを準備`、`アプリ本体は、今まで通りGitHub Pagesの公開版を使います`、`GitHub Pagesは静的Webアプリのため`、`Saxo ID、パスワード、2FA、OAuth token、口座情報はGitHub Pagesや作者側には保存されません`、`PowerShell` が含まれることを確認した。

## commit / push

- 実装commit hash: `17a230d`
- Pages deploy commit hash: `6769b95`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-OLICrsd0.js` を参照することを確認した。
- 公開bundle内に `ローカルAPI補助サーバの準備`、`公開版リポジトリ`、`jimusaku-lab/us-options-risk-planner`、`ダウンロードまたはclone`、`ローカル版アプリ`、`/Users/motomichi` が含まれないことを確認した。
- 公開bundle内に `Saxo接続用のPC側補助ツールを準備`、`アプリ本体は、今まで通りGitHub Pagesの公開版を使います`、`GitHub Pagesは静的Webアプリのため`、`Saxo ID、パスワード、2FA、OAuth token、口座情報はGitHub Pagesや作者側には保存されません`、`PowerShell` が含まれることを確認した。

## 残課題

- この時点ではなし。

---

# 2026-06-16 一般公開版 Saxo API Read-only オンボーディング文言修正

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 対象ブランチ: `main` / `gh-pages`

## 実装内容

- 公開版UIから、友人利用者に公開版リポジトリのcloneやローカル版アプリ利用を促すように見える文言を削除した。
- 準備チェックの `公開版リポジトリをダウンロード/clone済み` を `ローカルAPI補助ツールを準備済み` に変更した。
- 導入手順を、アプリ本体はGitHub Pagesの公開版を使い続け、Saxo API接続を使う場合だけPCにローカルAPI補助ツールを準備する説明へ変更した。
- ローカルAPI補助ツールはSaxoとの通信だけを担当し、GitHub Pagesや作者側にClient ID、OAuth token、口座情報を保存しないことを明記した。
- Mac / Windows の起動案内は、公開版リポジトリではなくローカルAPI補助ツールのフォルダを開く説明に変更した。
- 公開版アプリの更新はGitHub Pages側で反映され、ローカルAPI補助ツールはSaxo API接続に必要な補助機能であることをUIと設計書に明記した。
- 将来的に補助ツールのバージョン確認や古い場合の更新案内を出す方針を設計書側に維持した。
- Saxo APIはRead-onlyのままで、発注・注文変更・注文取消endpointは追加していない。
- Client Secret、Saxo ID、password、2FA、OAuth tokenの入力欄や保存処理は追加していない。

## 修正ファイル

- `src/features/saxo/SaxoReadOnlyPanel.tsx`
- `docs/saxo-api-readonly-detailed-design-2026-06-08.md`
- `docs/友人向けSaxo API接続準備ガイド.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（13 files / 70 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-C9H6MPWh.js`
  - bundle内に `公開版リポジトリ`、`jimusaku-lab/us-options-risk-planner`、`ダウンロードまたはclone`、`ローカル版アプリ`、`/Users/motomichi` が含まれないことを確認した。
  - bundle内に `ローカルAPI補助ツール`、`アプリ本体はGitHub Pagesの公開版を使います`、`PowerShell` が含まれることを確認した。

## commit / push

- 実装commit hash: `536b877`
- Pages deploy commit hash: `8411086`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-C9H6MPWh.js` を参照することを確認した。
- 公開bundle内に `公開版リポジトリ`、`jimusaku-lab/us-options-risk-planner`、`ダウンロードまたはclone`、`ローカル版アプリ`、`/Users/motomichi` が含まれないことを確認した。
- 公開bundle内に `ローカルAPI補助ツール`、`アプリ本体はGitHub Pagesの公開版を使います`、`PowerShell` が含まれることを確認した。

## 残課題

- この時点ではなし。

---

# 2026-06-16 一般公開版 Saxo API Read-only 接続導線修正

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 対象ブランチ: `main` / `gh-pages`

## 実装内容

- GitHub Pages公開版からMac上のSaxoローカルAPIへ接続するため、公開版用の起動コマンドをUIに表示・コピーできるようにした。
- 公開版用起動コマンドに `SAXO_LOCAL_UI_ALLOWED_ORIGIN=https://jimusaku-lab.github.io` と `SAXO_LOCAL_UI_RETURN_URL=https://jimusaku-lab.github.io/us-options-risk-planner/` を含めた。
- ローカルAPIのCORSを公開版Origin対応にし、`https://jimusaku-lab.github.io` からの `GET /api/saxo/status` と `OPTIONS` preflight で `access-control-allow-origin` を返すようにした。
- Chrome Private Network Access対策として、許可Originには `access-control-allow-private-network: true` を返すようにした。
- Saxo APIパネルの未起動表示を改善し、API未起動、公開版Origin/CORS/PNAブロック疑い、API起動済みだがSaxo未接続、Saxo接続済みを画面メッセージで区別できるようにした。
- 「起動できたか確認」押下時に、確認中・起動済み・未起動・公開版Origin/CORS/PNA疑いの結果が画面上に出るようにした。
- 「詳しい設定を見る」はAPI未起動時でも必ず開閉でき、開いた後は「詳しい設定を閉じる」と表示されるようにした。
- ローカルAPI到達後は、公開版でも黒い `Saxo接続` / `Saxo再接続` ボタンが表示される導線を維持した。
- Read-only方針は維持し、注文系endpointは引き続き未実装。

## 修正ファイル

- `server/saxo-readonly-server.mjs`
- `src/features/saxo/SaxoReadOnlyPanel.tsx`
- `src/features/saxo/saxoApiClient.ts`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証コマンド

- `npm test`: 通過（13 files / 70 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- `curl -i -H "Origin: https://jimusaku-lab.github.io" http://127.0.0.1:18787/api/saxo/status`
  - `access-control-allow-origin: https://jimusaku-lab.github.io` を確認
  - `access-control-allow-private-network: true` を確認
- `curl -i -X OPTIONS -H "Origin: https://jimusaku-lab.github.io" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Private-Network: true" http://127.0.0.1:18787/api/saxo/status`
  - `204 No Content` を確認
  - `access-control-allow-origin: https://jimusaku-lab.github.io` を確認
  - `access-control-allow-private-network: true` を確認

## commit / push

- 実装commit hash: `41c21b9`
- 報告書commit hash: `2c9a6f9`
- Pages deploy commit hash: `0efa6cd`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-BXf4p-6U.js` を参照することを確認した。
- 公開bundle内に `SAXO_LOCAL_UI_ALLOWED_ORIGIN=https://jimusaku-lab.github.io`、`SAXO_LOCAL_UI_RETURN_URL=https://jimusaku-lab.github.io/us-options-risk-planner/`、`詳しい設定を閉じる` が含まれることを確認した。
- in-app browserで公開URLを開き、Saxo APIパネルのヘッダー、起動手順、推奨コマンド、詳細トグル文言が表示されることを確認した。
- Chromeでも公開URLを新規タブで開いた。Chrome側は `Apple Events からの JavaScript を許可` が無効のためDOM自動検査はできなかったが、公開HTML/bundleとMac上のCORS curl検証で反映を確認した。

## 残課題

- Chrome画面上でボタンを押す最終目視は、ChromeのAppleScript JavaScript実行が無効だったため自動化できなかった。公開URLは新bundleへ切り替わり、CORS/preflightはMac上のcurlで通過確認済み。

---

# 2026-06-16 一般公開版 Saxo API Read-only オンボーディングUX再設計

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 対象ブランチ: `main` / `gh-pages`

## 実装内容

- 公開版Saxo APIパネルから作者PC固有の `/Users/motomichi/...` パスを削除した。
- OS選択UIを追加し、`Mac` / `Windows` / `まだ分からない` を利用者が切り替えられるようにした。
- ローカルAPI補助サーバの導入状態チェックを追加した。
  - 公開版リポジトリをダウンロード/clone済み
  - Node.js/npm導入済み
  - `.env.local` 作成済み
  - ローカルAPI起動済み
- 未導入状態では、いきなり起動コマンドを出さず、Node.js LTS、公開版リポジトリ、`.env.local`、OS別起動の順に案内する構成にした。
- Mac向けの主表示は1行コマンドにし、複数行バックスラッシュ形式は詳細表示へ移した。
- Windows向けにはPowerShell形式だけを表示し、Mac形式の `SAXO_LOCAL_UI_ALLOWED_ORIGIN=... npm run ...` を出さないようにした。
- `>` 継続入力で止まった場合の `Control + C` 案内と、成功ログ `Saxo read-only local API listening on http://127.0.0.1:18787` の確認案内を追加した。
- `起動できたか確認` の結果を、API未起動、CORS/PNA疑い、LIVE AppKey未設定、Saxo未接続、接続済みなどの次アクションへ変換して表示するようにした。
- API未起動時は取得・反映系カードを標準表示から隠し、主操作を導入/起動手順へ絞った。
- `.env.local` はGitHub Pagesへ保存しない、GitHubへpushしない、`.gitignore`対象であることをUIとガイドに明記した。
- Client Secret、Saxo ID、password、2FA、OAuth tokenの入力欄や保存処理は追加していない。
- Saxo APIはRead-onlyのままで、発注・注文変更・注文取消endpointは追加していない。

## 修正ファイル

- `src/features/saxo/SaxoReadOnlyPanel.tsx`
- `docs/saxo-api-readonly-detailed-design-2026-06-08.md`
- `docs/友人向けSaxo API接続準備ガイド.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（13 files / 70 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-8WmtP93z.js`
  - bundle内に `PowerShell`、`$env:SAXO_LOCAL_UI_ALLOWED_ORIGIN`、`導入手順を見る`、`起動コマンドをコピー`、`Control + C` が含まれることを確認した。
  - bundle内に `/Users/motomichi`、`SAXO_PUBLIC_REPO_PATH`、作者PC固定パスが含まれないことを確認した。

## commit / push

- 実装commit hash: `754c993`
- Pages deploy commit hash: `23c04d3`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-8WmtP93z.js` を参照することを確認した。
- 公開bundle内に `/Users/motomichi` が含まれないことを確認した。
- 公開bundle内に `PowerShell`、`$env:SAXO_LOCAL_UI_ALLOWED_ORIGIN`、`導入手順を見る`、`起動コマンドをコピー`、`Control + C` が含まれることを確認した。
- 公開URLの通常表示では作者PC固有パスを出さず、Windows選択時にはPowerShell手順を表示できる構成であることを確認した。

## 残課題

- この時点ではなし。
