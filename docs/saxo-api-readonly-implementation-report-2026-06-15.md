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

# 2026-06-20 N口座保有株の現在評価額・含み損益表示

## 実装内容

- `StockHoldingEvaluation` 表示用ヘルパーを追加し、N口座保有株の取得原価、現在評価額、含み損益、含み損益率をUSDと参考JPYで計算するようにした。
- 現在株価の優先順位を、Saxo現在建玉APIの `currentPrice/currentStockPrice/marketValue`、アプリの現在株価、未取得の順にした。
- Saxoの `marketValue` と `unrealizedPnl` が取得できる場合はSaxo値を優先し、アプリ計算との差がある場合は差分を併記するようにした。
- 履歴実績モードの黄色い現在状態カード直下に `N口座保有株の現在評価` カードを追加した。
- ホイール管理カードにも同じ `N口座保有株の現在評価` カードを表示し、`未実現株式評価` に具体的な含み損益USDを表示するようにした。
- 含み損益は未売却の時価評価であり、オプション実績・当年成績には含めない旨を明記した。

## 修正ファイル

- `src/domain/stockHoldingEvaluation.ts`
- `src/domain/stockHoldingEvaluation.test.ts`
- `src/components/results/StockHoldingEvaluationCard.tsx`
- `src/features/saxo/SaxoReadOnlyPanel.tsx`
- `src/components/wheel/WheelPanel.tsx`
- `src/App.tsx`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npx tsc --noEmit`: 通過
- `npm test -- src/domain/stockHoldingEvaluation.test.ts`: 通過（1 file / 3 tests）
- `npm test`: 通過（16 files / 84 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-Cf2r9dC2.js`
  - bundle内に `N口座保有株の現在評価`、`含み損益`、`オプション実績・当年成績には含めません` が含まれることを確認した。

## commit / push

- 実装commit hash: `e50da31`
- Pages deploy commit hash: `3d44cc5`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-Cf2r9dC2.js` を参照することを確認した。
- 公開bundle内に `N口座保有株の現在評価`、`含み損益`、`オプション実績・当年成績には含めません` が含まれることを確認した。

## 残課題

- この時点ではなし。

---

# 2026-06-20 Saxo約定済みC売り候補から3-Aへ進まない問題

## 実装内容

- 既存の注文前カバードコール下書きが未完成で、数量が `0` または未確定に近い状態でも、N口座C売りのSaxo約定済み建玉と紐づけ候補にできるようにした。
- 注文前下書きの数量未入力状態を、数量差分だけで `quantity_diff` 扱いにしないようにした。
- `linkedPositionIds` だけが残っていて `linkedPositionTargets` が壊れている場合でも、現在の照合で有効な `row.simulation` がある場合は、壊れた紐づけ表示を優先しないようにした。
- これにより、`既存建玉と一致候補があります` と `紐づけ先が見つかりません` が同時に出る矛盾表示を避けた。
- `注文前建玉に紐づけて3-Aへ進む` または `新規下書きとして作成して3-Aへ進む` の押下後、建玉入力カードを開き、React再描画後にも `3-A. 建玉開始の約定確認` へ `scrollIntoView` する保険を追加した。
- 紐づけ時は注文前の旧入力値ではなく、Saxo実約定値の `C225 / 2026-07-10 / 1.83 USD / 1枚` を優先して3-A確認下書きへ反映する導線を維持した。

## 修正ファイル

- `src/App.tsx`
- `src/features/saxo/SaxoReadOnlyPanel.tsx`
- `src/features/saxo/saxoAccountSync.ts`
- `src/features/saxo/saxoAccountSync.test.ts`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test -- src/features/saxo/saxoAccountSync.test.ts`: 通過（1 file / 27 tests）
- `npm test`: 通過（15 files / 81 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-CYnWlxKd.js`
  - bundle内に `注文前建玉に紐づけて3-Aへ進む`、`新規下書きとして作成して3-Aへ進む`、`Saxo実約定値を優先` が含まれることを確認した。

## commit / push

- 実装commit hash: `ca4d5f5`
- Pages deploy commit hash: `f53ea06`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-CYnWlxKd.js` を参照することを確認した。
- 公開bundle内に `注文前建玉に紐づけて3-Aへ進む`、`新規下書きとして作成して3-Aへ進む`、`Saxo実約定値を優先` が含まれることを確認した。

## 残課題

- この時点ではなし。

---

# 2026-06-18 Saxo約定済みカバードコール建玉の注文前候補紐づけ

## 実装内容

- Saxo現在建玉にN口座のC売り建玉が出た場合、N口座Stock候補より先に通常の建玉候補として表示するようにした。
- 既存の注文前カバードコール候補がある場合、主ボタンを `注文前建玉に紐づけて3-Aへ進む` にした。
- 注文前入力値とSaxo実約定値が異なる場合、候補行に差分を表示するようにした。
  - 例: `C230 → C225`
  - 例: `$1.40 → $1.83`
- 紐づけ時に、既存の注文前下書きのオプション脚と3-A建玉開始確認下書きをSaxo実約定値で更新するようにした。
- 紐づけ後は建玉入力カードを開き、`3-A. 建玉開始の約定確認` へ移動するようにした。
- 正式保存時に確認対象となる値は、注文前の予定値ではなくSaxo実約定値を優先する。

## 修正ファイル

- `src/features/saxo/saxoAccountSync.ts`
- `src/features/saxo/SaxoReadOnlyPanel.tsx`
- `src/App.tsx`
- `src/features/saxo/saxoAccountSync.test.ts`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npx tsc --noEmit`: 通過
- `npm test`: 通過（15 files / 81 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-4NauL3Xq.js`
  - bundle内に `注文前建玉に紐づけて3-Aへ進む`、`Saxo実約定値を優先`、`注文前カバードコール候補` が含まれることを確認した。

## commit / push

- 実装commit hash: `720e103`
- Pages deploy commit hash: `160d609`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-4NauL3Xq.js` を参照することを確認した。
- 公開bundle内に `注文前建玉に紐づけて3-Aへ進む`、`Saxo実約定値を優先`、`注文前カバードコール候補` が含まれることを確認した。

## 確認できたこと

- 注文前にC230 / `$1.40` と入力していても、Saxo実建玉がC225 / `$1.83` であれば、C225 / `$1.83` を正式確認対象として3-Aへ進められる。
- Saxo実約定建玉がある場合は、N口座Stock候補より先に通常の建玉候補として確認できる。
- Saxo取得値は自動で正式保存せず、3-Aの確認を挟む導線を維持している。

## 残課題

- この時点ではなし。

---

# 2026-06-18 カバードコール損益図の最大損失・損益分岐点表示

## 実装内容

- カバードコールの損益図で、`最大損失` ラベルを `株価0ドル想定の最大評価損` に変更した。
- `保有株込みの評価損です。株を売却しなければ実現損ではありません。` と `この価格で自動売却されるという意味ではありません。` を補足表示するようにした。
- カバードコール全体の主損益分岐点を `取得単価 - 受取プレミアム + 手数料按分` に変更した。
- 取得単価 `$207.50`、受取プレミアム `$1.40` の場合、保有株込みの損益分岐点が `$206.10` になることをテストで確認した。
- `権利行使価格 + プレミアム` は主損益分岐点ではなく、`コール売り単体の上側損益分岐点` として参考表示へ分離した。
- 損益図に `保有株込み`、`オプション単体`、`機会損益` の表示モードラベルを追加し、初期表示を `保有株込み` とした。

## 修正ファイル

- `docs/saxo-pn-wheel-upgrade-design-v2.md`
- `src/domain/payoff.ts`
- `src/components/results/Charts.tsx`
- `src/types/domain.ts`
- `src/domain/payoff.test.ts`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（15 files / 79 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-DGllZy_N.js`
  - bundle内に `株価0ドル想定の最大評価損`、`保有株込みの損益分岐点`、`コール売り単体の上側損益分岐点`、`保有株込み`、`オプション単体`、`機会損益` が含まれることを確認した。

## commit / push

- 実装commit hash: `e98ed7d`
- Pages deploy commit hash: `b2cf18b`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-DGllZy_N.js` を参照することを確認した。
- 公開bundle内に `株価0ドル想定の最大評価損`、`保有株込みの損益分岐点`、`コール売り単体の上側損益分岐点`、`保有株込み`、`オプション単体`、`機会損益` が含まれることを確認した。

## 確認できたこと

- カバードコールの損失表示は、短期コール単体の確定損ではなく、保有株込みで株価0ドルを仮定した評価損であることが画面上で分かる。
- 主損益分岐点は `$206.10` 側になり、`$231.40` は参考の `コール売り単体の上側損益分岐点` として扱われる。
- 実現損益と評価損益を混同しない文言へ整理した。

---

# 2026-06-18 カバードコール損益図の表示レンジ

## 実装内容

- カバードコールの損益図の初期表示を、株価0ドルまで含む理論最大レンジではなく `実用レンジ` に変更した。
- 実用レンジは、現在株価、取得単価、損益分岐点、権利行使価格を含み、左端を最小値の85%、右端を最大値の115%にした。
- 表示モードを `実用レンジ`、`理論最大レンジ`、`オプション単体`、`機会損益` に整理した。
- `理論最大レンジ` を選んだ場合だけ、株価0ドルを含めて `理論上の最大評価損` と表示するようにした。
- 初期表示では大きな赤カードを `株価0ドル想定の最大評価損` にせず、`表示レンジ下限の評価損` として表示するようにした。
- `オプション単体` と `機会損益` では、保有株込みではなくオプション脚ベースの損益線を表示するようにした。

## 修正ファイル

- `docs/saxo-pn-wheel-upgrade-design-v2.md`
- `src/domain/payoff.ts`
- `src/components/results/Charts.tsx`
- `src/types/domain.ts`
- `src/domain/payoff.test.ts`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（15 files / 80 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-8qJQFtRU.js`
  - bundle内に `実用レンジ`、`理論最大レンジ`、`表示レンジ下限の評価損`、`理論上の最大評価損`、`株価0ドル想定。保有株込み。実現損ではありません` が含まれることを確認した。

## commit / push

- 実装commit hash: `6c92e68`
- Pages deploy commit hash: `a389fd1`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-8qJQFtRU.js` を参照することを確認した。
- 公開bundle内に `実用レンジ`、`理論最大レンジ`、`表示レンジ下限の評価損`、`理論上の最大評価損`、`株価0ドル想定。保有株込み。実現損ではありません` が含まれることを確認した。

## 確認できたこと

- 初期表示では株価0ドル付近までチャートを広げず、短期カバードコールの注文判断に使う価格帯を読みやすくした。
- 理論上の最大評価損は `理論最大レンジ` を選んだ場合だけ表示される。
- 損益分岐点、現在株価、権利行使価格付近を初期表示で確認しやすくした。

---

# 2026-06-18 Saxo再取得後の記録済みP→N候補と履歴復旧候補の表示整理

## 実装内容

- Saxo再取得後に、既存の `StockTransferEvent` と一致するN口座Stockを未処理の `P→N移管候補` 件数へ含めないようにした。
- 記録済みN口座Stockは `照合済みの現在保有確認` として表示し、`P→N株式移管を記録` と `今回は無視` を出さないようにした。
- 記録済みN口座Stockの主操作を `N口座ホイールを確認` と `JSONバックアップを保存` に絞った。
- 履歴候補の `broken` 状態を通常の未入力候補から分離し、`監査用の復旧候補` として表示するようにした。
- `不足している反映候補をまとめて作成` は、新規作成が必要な履歴候補だけを対象にし、復旧候補は行ごとの再作成に限定した。
- 6-A反映済み、P→N移管済み、正式反映済みの候補は、赤・黄色の未処理表示ではなく `反映済み / 追加操作不要` として扱うようにした。

## 修正ファイル

- `src/features/saxo/SaxoReadOnlyPanel.tsx`
- `docs/saxo-pn-wheel-upgrade-design-v2.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（15 files / 78 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-CdwoIQlh.js`
  - bundle内に `P→N未処理候補`、`照合済みの現在保有確認`、`監査用の復旧候補`、`反映済み / 追加操作不要`、`不足している反映候補はありません` が含まれることを確認した。

## commit / push

- 実装commit hash: `0d7a2f1`
- Pages deploy commit hash: `b2e4714`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-CdwoIQlh.js` を参照することを確認した。
- 公開bundle内に `P→N未処理候補`、`照合済みの現在保有確認`、`監査用の復旧候補`、`反映済み / 追加操作不要`、`不足している反映候補はありません` が含まれることを確認した。

## 残課題

- この時点ではなし。

# カバードコールの利回り表示分離 公開版反映報告 2026-06-17

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 設計参照: `docs/saxo-pn-wheel-upgrade-design-v2.md` の `18.28`

## 実装内容

- Dashboard一覧行のカバードコール表示で、主年率を `プレミアム年率` として維持し、権利行使時の株式売却益を別枠 `権利行使時想定` に分離した。
- `権利行使時想定` では、主分母を取得原価ベース `平均取得単価 × 株数` として表示するようにした。
- 現在株価ベースの分母が取得原価ベースと異なる場合は、補助表示として `参考: 現在株価ベース` を表示するようにした。
- 権利行使時想定には、株式売却益、プレミアム込み想定益、手数料後想定益を表示するようにした。
- `満期時に株価が権利行使価格以上となり、株式が売却された場合の想定です。実績には含めません。` の注記を追加した。
- 成績サマリーの集計ロジックは変更せず、権利行使時想定を実績へ混ぜない方針を維持した。

## 修正ファイル

- `src/domain/dashboardDisplay.ts`
- `src/domain/dashboardDisplay.test.ts`
- `src/components/dashboard/Dashboard.tsx`
- `docs/saxo-pn-wheel-upgrade-design-v2.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（15 files / 78 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-BG4gbuqs.js`
  - bundle内に `プレミアム年率`、`権利行使時想定`、`主分母: 取得原価`、`プレミアム込み想定益`、`満期時に株価が権利行使価格以上` が含まれることを確認した。

## 表示確認

- Cプレミアム `0.65`、1枚では、予定プレミアムは `$65.00` のまま主表示できる。
- 分母 `$20,750`、DTE `23日` のプレミアム年率は、税前約 `5.0%`、手数料後約 `4.8%` として表示できる。
- 権利行使時想定は、株式売却益 `$3,250.00`、プレミアム込み想定益 `$3,315.00`、手数料後想定益 `$3,312.75` として別枠表示できる。
- 権利行使時想定は、実績ではなく想定値として表示され、成績サマリーには混ざらない。

## commit / push

- 実装commit hash: `6ab6f2a`
- Pages deploy commit hash: `c677dcd`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-BG4gbuqs.js` を参照することを確認した。
- 公開bundle内に `プレミアム年率`、`権利行使時想定`、`主分母: 取得原価`、`プレミアム込み想定益` が含まれることを確認した。

# カバードコール注文前の権利行使時想定年率・SummaryCards統一 公開版反映報告 2026-06-17

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 設計参照: `docs/saxo-pn-wheel-upgrade-design-v2.md` の `18.29`

## 実装内容

- 上部Dashboardの `権利行使時想定` 枠に、想定年率と手数料後想定年率を追加した。
- 下部 `SummaryCards` でも、注文前・建玉中未確認の表示では `calculateDashboardPremiumDisplay` を使うようにし、上部Dashboardと同じ予定プレミアム、手数料後プレミアム、取得原価ベース分母、プレミアム年率を表示するようにした。
- 下部 `SummaryCards` の年率カードが旧 `taxResult` 経路で `0.0% / 0.0%` を出す状態を避け、注文前では `予定 5.0% / 手数料後 4.8%` の表示へ分岐するようにした。
- 下部 `SummaryCards` に `権利行使時想定` カードを追加し、想定年率、手数料後想定年率、株式売却益、プレミアム込み想定益、手数料後想定益を表示するようにした。
- 権利行使時想定は実績ではなく、成績サマリーへ混ぜない注記を維持した。

## 修正ファイル

- `src/domain/dashboardDisplay.test.ts`
- `src/components/dashboard/Dashboard.tsx`
- `src/components/results/SummaryCards.tsx`
- `docs/saxo-pn-wheel-upgrade-design-v2.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（15 files / 78 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-Rr91d3jl.js`
  - bundle内に `プレミアム年率`、`権利行使時想定`、`想定年率`、`手数料後想定益`、`実績には含めません` が含まれることを確認した。

## 表示確認

- Cプレミアム `0.65`、1枚、分母 `$20,750`、DTE `23日` で、プレミアム年率は約 `5.0%`、手数料後は約 `4.8%` になる。
- 権利行使時想定年率は、プレミアム込み想定益 `$3,315.00` を分子にして約 `253.5%`、手数料後想定益 `$3,312.75` を分子にして約 `253.4%` になる。
- 下部サマリーカードでも、注文前の年率が旧経路の `0.0% / 0.0%` に戻らず、上部Dashboardと同じプレミアム年率を表示できる。
- 権利行使時想定は、満期時に株価が権利行使価格以上となり株式が売却された場合の想定値として表示され、実績成績には混ざらない。

## commit / push

- 実装commit hash: `9f93524`
- Pages deploy commit hash: `57fe3fb`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-Rr91d3jl.js` を参照することを確認した。
- 公開bundle内に `プレミアム年率`、`権利行使時想定`、`想定年率`、`手数料後想定益`、`実績には含めません` が含まれることを確認した。

---

# 2026-06-17 一般公開版 N株式保有からNカバードコール建玉を作成する導線

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 設計参照: `docs/saxo-pn-wheel-upgrade-design-v2.md` の `18.25`

## 実装内容

- ホイール管理の `n_stock_holding` フェーズで100株以上を保有している場合、ホイールカードに `Nカバードコール建玉を作成` を表示するようにした。
- ボタン押下で、N口座カバードコール用の `covered_call` 下書きを作成し、建玉入力画面を開くようにした。
- 作成する下書きには、N口座、USD決済、ticker、保有株数、平均取得単価、100株につき1枚までのC売り脚を初期反映するようにした。
- 同じホイールサイクル、または同一ticker・N口座の未完了カバードコール下書きがある場合は重複作成せず、`作成済みC売り入力を開く` として既存入力へ誘導するようにした。
- 100株未満では作成ボタンを出さず、`100株未満のためカバードコールを作成できません。` を表示するようにした。
- C売りの建玉開始約定確認が完了して `covered_call` 建玉が `open` になった場合、ホイールイベント `covered_call_opened` を作成し、フェーズを `n_covered_call` へ進めるようにした。

## 修正ファイル

- `src/store/useOptionsStore.ts`
- `src/components/wheel/WheelPanel.tsx`
- `src/App.tsx`
- `docs/saxo-pn-wheel-upgrade-design-v2.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（14 files / 74 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-BRL9-zZa.js`
  - bundle内に `Nカバードコール建玉を作成`、`作成済みC売り入力を開く`、`100株未満のためカバードコールを作成できません`、`covered_call_opened` が含まれることを確認した。

## commit / push

- 実装commit hash: `ff2337b`
- Pages deploy commit hash: `88e8779`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-BRL9-zZa.js` を参照することを確認した。
- 公開bundle内に `Nカバードコール建玉を作成`、`作成済みC売り入力を開く`、`100株未満のためカバードコールを作成できません`、`covered_call_opened` が含まれることを確認した。

---

# 2026-06-17 一般公開版 注文前建玉の予定プレミアム・予定年率表示修正

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 設計参照: `docs/saxo-pn-wheel-upgrade-design-v2.md` の `18.26`

## 実装内容

- Dashboard一覧行のプレミアム表示用に `src/domain/dashboardDisplay.ts` を追加した。
- `planned` の建玉では、未確認の `optionEntryExecutions` を使わず、`optionLegs.premiumUSD` から予定プレミアムを計算するようにした。
- `open` でも建玉開始確認が未確認の場合は、未確認の約定確認下書きが0でも `optionLegs.premiumUSD` を予定値として表示するようにした。
- 建玉開始確認済み・履歴行では、従来通り確認済み実績値または履歴実績値を優先する。
- Dashboard一覧行では、注文前に `予定プレミアム`、未確認建玉に `約定未確認プレミアム`、注文前年率に `予定` を表示するようにした。
- 本当にプレミアム未入力の場合は `$0.00` ではなく `未入力` と表示し、年率も `未入力` とするようにした。
- N口座の注文前カバードコールでは、予定受取額と手数料後金額を併記するようにした。

## 修正ファイル

- `src/domain/dashboardDisplay.ts`
- `src/domain/dashboardDisplay.test.ts`
- `src/components/dashboard/Dashboard.tsx`
- `docs/saxo-pn-wheel-upgrade-design-v2.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（15 files / 76 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-qceZbmUO.js`
  - bundle内に `予定プレミアム`、`約定未確認プレミアム`、`手数料後`、`未入力` が含まれることを確認した。

## commit / push

- 実装commit hash: `388f9d6`
- Pages deploy commit hash: `8d2c270`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-qceZbmUO.js` を参照することを確認した。
- 公開bundle内に `予定プレミアム`、`約定未確認プレミアム`、`手数料後`、`未入力` が含まれることを確認した。

---

# 2026-06-17 一般公開版 N口座カバードコールのUSD予定年率・参考JPY・権利行使時想定損益

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 設計参照: `docs/saxo-pn-wheel-upgrade-design-v2.md` の `18.27`

## 実装内容

- `referenceFxRateJPY = 0` を有効な為替として扱わず、`referenceFxRateJPY > 0`、次に `fxRateJPY > 0` の順で使う `effectiveFx` 判定を追加した。
- N口座の注文前・約定未確認表示では、USD予定利益、USD分母、建玉日から満期日までのDTEで予定年率を直接計算するようにした。
- 参考JPYは `effectiveFx` がある場合だけ表示し、ない場合は `参考JPY未計算` と表示するようにした。
- カバードコールの注文前表示に、プレミアム年率とは別枠で `権利行使時想定` を追加した。
- 権利行使時想定では、株式売却益、プレミアム込み想定益、手数料後想定益を表示し、実績ではなく成績サマリーへ混ぜない旨を注記するようにした。
- `calculateDenominatorsUSD` でも同じ `effectiveFx` 判定を使い、分母の参考JPYが `参考 0円` にならないようにした。

## 修正ファイル

- `src/domain/dashboardDisplay.ts`
- `src/domain/dashboardDisplay.test.ts`
- `src/domain/denominators.ts`
- `src/components/dashboard/Dashboard.tsx`
- `docs/saxo-pn-wheel-upgrade-design-v2.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（15 files / 78 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-BJXsHE_d.js`
  - bundle内に `権利行使時想定`、`参考JPY未計算`、`プレミアム込み`、`手数料後` が含まれることを確認した。

## commit / push

- 実装commit hash: `40fafae`
- Pages deploy commit hash: `b713f0d`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-BJXsHE_d.js` を参照することを確認した。
- 公開bundle内に `権利行使時想定`、`参考JPY未計算`、`プレミアム込み`、`手数料後` が含まれることを確認した。

---

# 2026-06-17 一般公開版 買いオプションの反対売買決済優先UX

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 設計参照: `docs/saxo-pn-wheel-upgrade-design-v2.md` の `18.23`

## 実装内容

- `long_call` / `long_put` を戦略種別として追加し、`コール買い` / `プット買い` を建玉入力で選択できるようにした。
- Saxo現在建玉の long option は、`short_put` / `covered_call` ではなく `long_put` / `long_call` として下書き化するようにした。
- long option の建玉中 primary action を `反対売買で決済` にし、ITMでも満期前は売却決済を優先案内するようにした。
- `反対売買判断` カードに買いオプション用の主表示を追加した。
  - 支払プレミアム
  - 現在オプション価格
  - 評価損益
  - 評価損益率
  - 利確ライン
  - 損切りライン
  - 残存日数
  - 本質的価値
  - 時間的価値
- 利確/損切りラインは、支払プレミアム比 `+30% / -30%` を初期候補にし、ユーザーが変更できるようにした。
- 権利行使は主ボタンにせず、`例外的な権利行使として確認` の折りたたみ内へ移した。
- Saxo履歴分類で、long call / long put の `buy` を建玉開始、`sell` を決済候補として扱えるようにした。Stock履歴は通常の3-A/7候補へ混ぜない方針を維持した。
- 公開版のSaxo設定表示で参照していた `localUiAllowedOrigin` / `localUiReturnUrl` を `SaxoConfigStatus` 型へ追加した。
- 発注、注文変更、注文取消endpointは追加していない。
- Saxo ID、password、2FA、OAuth token、Client Secretの保存処理や入力欄は追加していない。

## 修正ファイル

- `src/types/domain.ts`
- `src/domain/strategyLabels.ts`
- `src/domain/calculations.ts`
- `src/domain/optionEntryExecutions.ts`
- `src/domain/workflowTasks.ts`
- `src/domain/workflowTasks.test.ts`
- `src/features/saxo/saxoAccountSync.ts`
- `src/features/saxo/saxoAccountSync.test.ts`
- `src/components/results/CloseDecisionCard.tsx`
- `src/components/wizard/SimulationEditor.tsx`
- `src/App.tsx`
- `docs/saxo-pn-wheel-upgrade-design-v2.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（13 files / 71 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過

## commit / push

- 実装commit hash: `19809f9`
- Pages deploy commit hash: `1819246`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-DlRQda41.js` と `assets/index-DR-6Do-7.css` を参照することを確認した。
- 公開bundle内に `反対売買で決済`、`例外的な権利行使として確認`、`コール買い`、`プット買い` が含まれることを確認した。

---

# 2026-06-17 一般公開版 損益分岐点・満期損益図の全脚対応

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 設計参照: `docs/saxo-pn-wheel-upgrade-design-v2.md` の `18.24`

## 実装内容

- `src/domain/payoff.ts` を全 `optionLegs` 対応へ拡張し、`buy` / `sell` と `call` / `put` の満期損益式を明示的に分岐した。
- コール買いの損益分岐点を `権利行使価格 + 支払プレミアム + 手数料按分`、プット買いの損益分岐点を `権利行使価格 - 支払プレミアム - 手数料按分` で表示できるようにした。
- プット売り、カバードコール、ショートストラングルでも既存の損益図が破綻しないよう、売り脚も同じ共通式で計算するようにした。
- `満期時の損益図` に、現在株価、権利行使価格、損益分岐点、0損益ラインを表示するようにした。
- 利益領域を緑、損失領域を赤で表示するようにした。
- 最大損失、最大利益、損益分岐点、損益分岐点の計算式をチャート下に表示するようにした。
- 買いオプションでは、満期保有推奨と誤解しないための注意文を表示するようにした。

## 修正ファイル

- `src/types/domain.ts`
- `src/domain/payoff.ts`
- `src/domain/payoff.test.ts`
- `src/components/results/Charts.tsx`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（14 files / 74 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過

## commit / push

- 実装commit hash: `1002059`
- Pages deploy commit hash: `d6966a7`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-CH02V1aJ.js` と `assets/index-DR-6Do-7.css` を参照することを確認した。
- 公開bundle内に `満期時の損益図`、`損益分岐点の計算`、`最大損失`、`最大利益`、`満期まで持つことを推奨する図ではありません` が含まれることを確認した。

---

# 2026-06-17 一般公開版 履歴折りたたみ時の履歴実績カード非表示と当年成績内訳表示

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 設計参照: `docs/saxo-pn-wheel-upgrade-design-v2.md` の `18.18`、`18.19`、`18.20`

## 実装内容

- Dashboardの履歴開閉状態を `App.tsx` 側へ持ち上げ、履歴一覧が閉じている間は終了済み履歴1件の `SummaryCards` historyModeを表示しないようにした。
- 履歴一覧を閉じている間は、現在状態カードだけを表示し、`終了済みプット売りの実績`、`この履歴の確定オプション収入`、`この履歴の年率分母`、`この履歴のオプション年率` を出さないようにした。
- `WorkflowTask.type === "complete"` は押せるボタンではなく、`完了（追加操作なし）` の非クリック表示にした。
- 当年成績サマリーに `optionBreakdowns` を追加し、`2026年累計 / 確認済みN件の合計` と、反対売買決済・P売り権利行使プレミアムの内訳を表示できるようにした。
- `18,792円` の履歴1件実績と、`34,283円` の当年累計が別物だと分かる説明を成績ページに追加した。

## 修正ファイル

- `src/App.tsx`
- `src/components/dashboard/Dashboard.tsx`
- `src/components/dashboard/YearlyPerformanceSummaryCard.tsx`
- `src/domain/yearlyPerformance.ts`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（13 files / 70 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過

## commit / push

- 実装commit hash: `9b5d875`
- Pages deploy commit hash: `d3805fa`
- 報告書commit hash: `108d737`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-D52BWoQa.js` を参照することを確認した。
- 公開bundle内に `履歴一覧を畳んでいるため`、`完了（追加操作なし）`、`当年オプション損益の内訳` が含まれることを確認した。

## 残課題

- 実画面の履歴開閉目視はユーザーの保存済みREALデータに依存するため、今回は表示条件、テスト、ビルド、公開bundle更新までを確認する。

---

# 2026-06-16 一般公開版 Saxo履歴候補のStock履歴一括作成除外

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 設計参照: `docs/saxo-pn-wheel-upgrade-design-v2.md` の `18.17`

## 実装内容

- `getSaxoHistoryCandidateTarget` で通常の `entry` / `close` に分類する対象を `StockOption` 履歴に限定した。
- `Stock` の売買履歴は、通常の `3-A. 建玉開始の約定確認` や `7. 決済実績` の一括作成対象にしないようにした。
- Saxo履歴候補カードで、追加作成が必要な候補が0件の場合は `不足している反映候補をまとめて作成` を出さず、`追加で作成が必要な履歴候補はありません。` と表示するようにした。
- 反映待ちサマリーは、履歴が存在するだけでは反映待ち扱いにせず、実際に作成可能な `none` / `broken` の通常候補がある場合だけ反映待ちにした。
- 表示件数を `反映済み`、`対象外または確認不要`、`追加で作成が必要` に分け、Stock履歴などの対象外候補が未作成件数へ混ざらないようにした。

## 修正ファイル

- `src/features/saxo/saxoAccountSync.ts`
- `src/features/saxo/saxoAccountSync.test.ts`
- `src/features/saxo/SaxoReadOnlyPanel.tsx`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（13 files / 70 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過

## commit / push

- 実装commit hash: `0f0a295`
- Pages deploy commit hash: `d5dc122`
- 報告書初回commit hash: `3411f53`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-DQyYGf-I.js` を参照することを確認した。
- 公開bundle内に `追加で作成が必要な履歴候補はありません`、`対象外または確認不要`、`Stock履歴は通常の3-A/7候補として自動反映しません` が含まれることを確認した。

## 残課題

- 実Saxo接続での `まとめて取得` 再実行目視はユーザーのローカル接続状態と保存データに依存するため、今回はStock履歴分類、反映待ち判定、テスト、ビルド、公開bundle更新までを確認する。

# 履歴実績モードのサマリーカード文言改善 報告 2026-06-16

## 対象

- 公開版: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 設計参照: `docs/saxo-pn-wheel-upgrade-design-v2.md` の `18.16`

## 修正内容

- 履歴実績モードのサマリーカード群の上に `終了済みプット売りの実績` の小見出しを追加した。
- 履歴実績モードではカード名を次のように変更した。
  - `確定プレミアム` → `この履歴の確定オプション収入`
  - `実績分母` → `この履歴の年率分母`
  - `年率` → `この履歴のオプション年率`
- 年率カードの注記に、`確定損益 ÷ 分母 × 365 ÷ 日数` の計算式を表示するようにした。
- P→N移管済みでN口座株式保有中の場合、現在のN口座株式損益ではなく終了済みP口座プット売りの実績であることを注記した。
- 現在保有状態カードと、終了済みプット売り実績カード群を視覚的に分けるため、履歴実績モードのサマリーカード群を専用枠で囲んだ。

## 修正ファイル

- `src/components/results/SummaryCards.tsx`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（13 files / 70 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過

## commit / push

- 実装commit hash: `e625954`
- 報告書更新commit hash: `b864b73`
- Pages deploy commit hash: `e65007e`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-DZBpHZ6j.js` を参照することを確認した。

# Saxo再取得時の反映済み権利行使履歴表示修正 報告 2026-06-16

## 対象

- 公開版: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 設計参照: `docs/saxo-pn-wheel-upgrade-design-v2.md` の `18.15`

## 修正内容

- Saxo履歴候補のassignment判定に、6-A必須項目完了、`stockAcquisition.confirmationStatus === "confirmed"`、同じ `sourceSimulationId` の `StockTransferEvent` の有無を含めた。
- `assignmentImportantCount` は未処理またはbrokenの権利行使履歴だけを赤い重要候補として数えるようにし、6-A反映済み・P→N移管済みの履歴を除外した。
- `reflectionState.status === "candidate"` でも6-A必須項目が完了していれば、`6-A確認済み / 現物株取得反映済み` と表示し、`推奨: 6-Aで現物株取得を確認` ボタンを出さないようにした。
- P→N移管済みの場合は、履歴候補行を `P→N移管済み / N口座で株式保有中` と表示し、赤い反映待ち候補として扱わないようにした。
- 6-Aの `入力欄を閉じて俯瞰へ戻る` で必須項目が完了している場合、`stockAcquisition.confirmationStatus` を `confirmed` へ昇格するようにした。

## 修正ファイル

- `src/features/saxo/SaxoReadOnlyPanel.tsx`
- `src/components/wizard/SimulationEditor.tsx`
- `docs/saxo-pn-wheel-upgrade-design-v2.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（13 files / 70 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過

## commit / push

- 実装commit hash: `5c09b6e`
- 報告書更新commit hash: `e8a52a9`
- Pages deploy commit hash: `dafbe1a`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-BSHdVQ34.js` を参照することを確認した。

---

# 2026-06-16 ホイール管理上部のP→N株式移管ボタン表示条件修正

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 対象ブランチ: `main` / `gh-pages`

## 実装内容

- ホイール管理上部で、既にP→N株式移管が記録済み、または対象ホイールがN口座側の株式保有以降へ進んでいる場合に、緑色の `P→N株式移管を記録` ボタンを出さないようにした。
- 選択中建玉について、同じ `sourceSimulationId`、`toAccountCode=N`、同一株数の `StockTransferEvent` がある場合は、上部に `P→N株式移管は記録済み` を表示する。
- 対象ホイールの `currentPhase` が `n_stock_holding` / `n_covered_call` / `n_called_away` の場合は、移管記録ボタンを表示しない。
- `P→N移管待ち 済` と `P→N株式移管を記録` が同時表示される状態を禁止した。
- 次の主導線として `次: C売り候補を確認` を表示する。
- store側の `createStockTransferFromSimulation` でも、同じ `sourceSimulationId`、N口座、同一株数の重複作成を拒否する。

## 修正ファイル

- `src/App.tsx`
- `src/components/wheel/WheelPanel.tsx`
- `src/store/useOptionsStore.ts`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（13 files / 70 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- Pages配信bundle: `assets/index-VqB-zPEO.js`

## commit / push

- 実装commit hash: `4dcfc75`
- Pages deploy commit hash: `3849840`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが `assets/index-VqB-zPEO.js` を参照することを確認した。

## 残課題

- 実Saxo接続データでのクリック確認は、利用者端末のローカルAPI・接続状態に依存するため、コード経路、テスト、ビルド、Pages配信bundle更新を確認対象にする。

---

# 2026-06-16 P売り権利行使後からP→N移管済み状態までのUX表示修正

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 対象ブランチ: `main` / `gh-pages`

## 実装内容

- 6-A現物株取得が反映済みで、同じ建玉にP→N株式移管記録がある場合、6-Aの完了メッセージを「現在はN口座で保有」に切り替えるようにした。
- 6-Aの `入力欄を閉じて俯瞰へ戻る` は、P→N移管済みの場合にSaxo履歴候補へ戻さず、建玉入力を閉じてN口座ホイール管理を開くようにした。
- Saxo履歴候補で、正式保存済みのP売り権利行使行は赤い `重要: P売り権利行使候補` 表示と `推奨: 6-Aで現物株取得を確認` ボタンを出さず、緑系の `6-A確認済み / 現物株取得反映済み` 表示にした。
- 履歴実績モードカードでは、同じ `sourceSimulationId` の `StockTransferEvent` がある場合、現在状態を `N口座 / USDで株式保有` として表示するようにした。
- 取得履歴、移管履歴、現在保有を分けて表示するようにした。
- 状態確認カードでは、移管済みの場合に `P→N移管済み / N口座で株式保有中` と表示し、未移管向けの `P→N移管記録待ち` を出さないようにした。
- Dashboard履歴行の補足文も、移管済みの場合は `現在はN口座で株式保有中`、次アクションは `JSONバックアップ保存` と `C売り候補確認` に切り替えるようにした。
- risk warningの `P口座で株式取得済み。N口座へ移管したら...` は、P→N移管済みの場合は出さないようにした。

## 修正ファイル

- `src/App.tsx`
- `src/components/dashboard/Dashboard.tsx`
- `src/components/results/SummaryCards.tsx`
- `src/components/wizard/SimulationEditor.tsx`
- `src/domain/riskRules.ts`
- `src/features/saxo/SaxoReadOnlyPanel.tsx`
- `docs/saxo-pn-wheel-upgrade-design-v2.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（13 files / 70 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- Pages配信bundle: `assets/index-B0_l7-a8.js`

## commit / push

- 実装commit hash: `c0116c4`
- Pages deploy commit hash: `11d02c1`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが `assets/index-B0_l7-a8.js` を参照することを確認した。

## 残課題

- 実Saxo接続データでのクリック確認は、利用者端末のローカルAPI・接続状態に依存するため、コード経路、テスト、ビルド、Pages配信bundle更新を確認対象にする。

---

# 2026-06-16 P→N株式移管候補カードの記録済み反映漏れ修正

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 対象ブランチ: `main` / `gh-pages`

## 実装内容

- `App.tsx` の建玉選択中ルートで表示する `SaxoReadOnlyPanel` に、未選択時ルートと同じ `stockTransfers`、`onOpenWheelManagement`、`onDownloadJson` を渡すようにした。
- これにより、建玉選択中のSaxo反映待ち確認でも既存の `StockTransferEvent` を検出でき、P→N株式移管候補カードが初期表示から `P→N株式移管を記録済み` になる。
- 記録済み状態では `P→N株式移管を記録` を再表示せず、既存の `N口座ホイールを確認`、`JSONバックアップを保存`、`移管記録済み` の導線を使える。
- 二重反映防止ロジックは既存の `sourceSimulationId`、`toAccountCode=N`、株数一致による検出を維持している。

## 修正ファイル

- `src/App.tsx`
- `docs/saxo-pn-wheel-upgrade-design-v2.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（13 files / 70 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- Pages配信bundle: `assets/index-BKyBNbCb.js`

## commit / push

- 実装commit hash: `f7377de`
- Pages deploy commit hash: `4f1c977`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが `assets/index-BKyBNbCb.js` を参照することを確認した。
- 公開版にも建玉選択中ルートの `stockTransfers` / `onOpenWheelManagement` / `onDownloadJson` 受け渡しが反映済み。

## 残課題

- 実Saxoデータを使った公開URL上のクリック確認は、利用者端末のローカルAPI・接続状態に依存するため未実施。コード経路、テスト、ビルド、Pages配信bundle更新は確認済み。

# P→N株式移管記録後の完了導線修正 報告 2026-06-16

## 対象

- 公開版: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 設計参照: `docs/saxo-pn-wheel-upgrade-design-v2.md` の `18.9 移管記録後の完了導線`

## 修正内容

Saxo N口座Stock候補から `P→N株式移管を記録` を押した後、候補カードを `P→N株式移管を記録済み` 状態へ切り替えるようにした。

- 同じP口座権利行使済み建玉・同じ株数の `StockTransferEvent` が存在する場合、再度 `P→N株式移管を記録` を押せない表示に変更
- 主ボタンを `N口座ホイールを確認` に変更
- 補助ボタンとして `JSONバックアップを保存` を表示
- 完了メッセージを「N口座ホイールを確認し、確認後にJSONバックアップを保存する」導線へ変更
- `N口座ホイールを確認` でアプリ本体の `ホイール管理` セクションへスクロールし、折りたたみ時は自動で開く
- 対象銘柄のホイールカードを一時的にハイライトする

## 修正ファイル

- `src/App.tsx`
- `src/features/saxo/SaxoReadOnlyPanel.tsx`
- `src/components/wheel/WheelPanel.tsx`
- `docs/saxo-pn-wheel-upgrade-design-v2.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（13 files / 70 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過

## commit / push

- 実装commit hash: `a3d2c6c`
- Pages deploy commit hash: `f01b84b`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-DUGBWaba.js` を参照することを確認した。

## 残課題

- 実Saxo接続データでのクリック確認は、ユーザーのローカルAPI接続状態に依存するため、今回はコード導線、テスト、ビルド、GitHub Pages配信更新までを確認した。

---

# 2026-06-16 一般公開版 Saxo接続後の準備カード折りたたみと接続保持促進

## 対象

- リポジトリ: `jimusaku-lab/us-options-risk-planner`
- 作業ディレクトリ: `/Users/motomichi/Documents/30_ファイナンス（作業中）/us-options-risk-planner-public-repo`
- 公開URL: `https://jimusaku-lab.github.io/us-options-risk-planner/`
- 対象ブランチ: `main` / `gh-pages`

## 実装内容

- Saxo接続済み状態では、Node.js、PC側補助ツール、`.env.local`、OS別起動手順を含む準備カードを主表示から外すようにした。
- 未導入、ローカルAPI未起動、Saxo未接続、接続設定不足の状態では、従来どおり準備カードを展開表示する。
- Saxo接続済みかつ接続保持未保存の場合、準備カードより上に `次回以降の再ログインを減らすため、接続保持を保存してください` カードを表示するようにした。
- 接続保持カードには、保存するのはOAuth接続保持情報だけであり、Saxo ID、パスワード、2FAコード、口座情報は保存しない説明を表示した。
- 接続保持カードの主ボタンを `このPCに接続保持を保存`、補助ボタンを `今は保存しない` にした。
- 接続保持保存成功後は準備カードを自動で畳み、`まとめて取得` を主操作として表示するようにした。
- 接続保持が有効な場合は、準備カードを畳んだまま小さな `準備手順を再表示` ボタンだけを表示するようにした。
- `準備手順を再表示` を押した場合だけ、OS別手順、`.env.local`、セキュリティ注意を再展開できるようにした。
- 再接続が必要な状態では、準備カードではなく `Saxo再接続` を主操作として出す既存導線を維持した。
- Saxo APIはRead-onlyのままで、発注・注文変更・注文取消endpointは追加していない。
- Saxo ID、password、2FA、OAuth token、Client Secretの入力欄や保存処理は追加していない。

## 修正ファイル

- `src/features/saxo/SaxoReadOnlyPanel.tsx`
- `docs/saxo-api-readonly-detailed-design-2026-06-08.md`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（13 files / 70 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-iVAo1oEw.js`
  - bundle内に `次回以降の再ログインを減らすため、接続保持を保存してください`、`このPCに接続保持を保存`、`準備手順を再表示`、`準備手順を閉じる` が含まれることを確認した。

## commit / push

- 実装commit hash: `bb9a606`
- 報告書commit hash: `39b8f25`
- Pages deploy commit hash: `ba812d0`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-iVAo1oEw.js` を参照することを確認した。
- 公開bundle内に `次回以降の再ログインを減らすため、接続保持を保存してください`、`このPCに接続保持を保存`、`準備手順を再表示`、`準備手順を閉じる` が含まれることを確認済み。

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

---

# 2026-06-18 Saxo未約定注文・出口注文取得UXの整理

## 実装内容

- Saxo未約定注文取得時の説明を、未約定注文は約定するまで建玉・決済実績・成績へ正式反映しない文言へ変更した。
- N口座のWorking状態のCall売り注文を `未約定カバードコール売り注文` として分類し、`出口候補` と混同しないようにした。
- 注文分類を `未約定カバードコール売り注文`、`決済・出口注文`、`取消済み・失効注文`、通常の `未約定注文` に分離した。
- Working注文には「まだ約定していません。約定するまでは建玉・実績には反映しません。約定後にまとめて取得を実行し、建玉開始候補として確認してください。」と表示するようにした。
- 未約定カバードコール売り注文の主操作を `注文内容を確認` にし、決済実績や建玉開始確認へ直接進む誤導線を出さないようにした。

## 修正ファイル

- `src/features/saxo/SaxoReadOnlyPanel.tsx`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（15 files / 78 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-BDS0vs21.js`
  - bundle内に `未約定カバードコール売り注文`、`未約定C売り`、`決済・出口注文`、`取消済み・失効注文`、`まだ約定していません。約定するまでは建玉・実績には反映しません` が含まれることを確認した。

## commit / push

- 実装commit hash: `6f83ea9`
- Pages deploy commit hash: `eec937b`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-BDS0vs21.js` を参照することを確認した。公開bundle内に `未約定カバードコール売り注文`、`未約定C売り`、`決済・出口注文`、`取消済み・失効注文`、`まだ約定していません。約定するまでは建玉・実績には反映しません` が含まれることを確認した。

## 残課題

- この時点ではなし。

---

# 2026-06-18 注文前カバードコール画面の情報設計整理

## 実装内容

- 注文前カバードコールで、上部に `注文前モード` の現在アクションカードを追加した。
- `注文判断カード` を追加し、予定プレミアム、手数料後プレミアム、プレミアム年率、権利行使価格、損益分岐点、株式売却益、プレミアム込み想定益、権利行使時想定年率、次にやることを集約した。
- 損益図を注文判断カード直下へ配置し、注文判断と同じ視界で確認できるようにした。
- 注文前チェックリストを `注文内容を確認` ボタンの近くに配置した。
- 注文前カバードコールでは、Saxo API詳細、口座全体の余力・証拠金詳細、予定値サマリー詳細、分母比較、年率換算の計算根拠、税務・NISA等の参考情報、上昇/レンジ/下落シナリオ、反対売買判断、分母チャート、ホイール管理詳細を初期折りたたみにした。
- 注文前の値は予定値であり、実績成績や税務集計にはまだ含めないことを上部に明示した。

## 修正ファイル

- `src/App.tsx`
- `docs/saxo-api-readonly-implementation-report-2026-06-15.md`

## 検証結果

- `npm test`: 通過（15 files / 78 tests）
- `npm run build`: 通過
- `GITHUB_PAGES=true npm run build`: 通過
- build成果物確認:
  - `dist/assets/index-ClyyqyNi.js`
  - bundle内に `注文前モード`、`注文判断カード`、`Saxo API詳細`、`口座全体の余力・証拠金詳細`、`税務・NISA等の参考情報`、`ホイール管理詳細` が含まれることを確認した。

## commit / push

- 実装commit hash: `ce2c7e4`
- Pages deploy commit hash: `3162ccb`
- main push: 済み
- gh-pages push: 済み

## 公開URL確認

- `https://jimusaku-lab.github.io/us-options-risk-planner/` のHTMLが新bundle `assets/index-ClyyqyNi.js` を参照することを確認した。公開bundle内に `注文前モード`、`注文判断カード`、`Saxo API詳細`、`口座全体の余力・証拠金詳細`、`税務・NISA等の参考情報`、`ホイール管理詳細` が含まれることを確認した。

## 残課題

- この時点ではなし。
