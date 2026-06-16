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
