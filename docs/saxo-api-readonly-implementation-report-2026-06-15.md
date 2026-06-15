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
- Git commit: 実行予定
- GitHub push: 実行予定
- GitHub Pages公開URL確認: 実行予定

## push情報

- commit hash: 追記予定
- push branch: `main`
- push状態: 追記予定

## 残課題

- この時点ではなし。
