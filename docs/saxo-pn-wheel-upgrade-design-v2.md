# Saxo P/N口座・N口座ホイール対応 設計書 v2

作成日: 2026-05-31  
対象: 米国株オプション建玉管理・リスク確認アプリ  
初回実装対象: ローカルPC版 `http://127.0.0.1:5173/`  
関連資料:

- `saxo_p_n_account_logic_report.md`
- `No7_サクソバンクのサブ口座と株式移管.pdf` 1-12ページ
- `saxo-readonly-upgrade-design-handoff.md`
- `tradingview-saxo-integration-brief.md`

## 1. 改訂の目的

これまでの手入力型パイロットは、JPYを主軸にした建玉管理として成立している。

ただし、サクソバンク証券で実際に運用する前提では、次の設計が不足していた。

- P口座とN口座の決済通貨差
- N口座を主戦場にしたUSDベースのホイール戦略
- P口座で取得した株式をN口座へ株式移管する流れ
- N口座内で、カバードコール、株式売却、プット売り、株式取得を循環させる管理
- 最終出金時だけ円転するという為替設計

本設計書は、これらをアプリの正式なバックグラウンドロジックとして組み込み、以後の実装工程を明確にする。

## 2. 最終目標

最終目標は、サクソバンク証券のP/N口座構造に合わせて、米国株オプションの建玉、株式取得、株式移管、カバードコール、プット売り、税務区分、為替換算を一貫して管理できるアプリにすること。

特にホイール戦略は、原則として **N口座内でUSDベースで回す**。

```text
N口座でUSD保有
→ N口座でプット売り
→ 権利行使でN口座に株式取得
→ N口座でカバードコール
→ 権利行使で株式売却
→ N口座にUSDが残る
→ N口座で再購入または再度プット売り
```

P口座は、円資金から入口を作る補助ルートとして扱う。

```text
P口座でプット売り
→ 権利行使でP口座に株式取得
→ P口座からN口座へ株式移管
→ 以後はN口座ホイールへ合流
```

このアプリは、今後Saxo read-only連携を入れる場合でも、発注はしない。最終判断と発注はユーザーがSaxo画面で行う。

## 3. 重要な設計原則

### 3.0 DEMO口座は本番N口座相当として扱わない

SaxoTraderGOのDEMO口座は、米国株式・米国株式オプションの価格や建玉損益がUSDで表示される一方、画面下部の口座通貨、現金残高、買付可能額、評価額はJPYで表示される。

そのため、アプリ上では本番N口座相当として扱わず、次の3分類で扱う。

```ts
type AccountEnvironment =
  | "DEMO_JPY_BASE"
  | "PROD_P_JPY_SETTLEMENT"
  | "PROD_N_USD_SETTLEMENT";
```

- `DEMO_JPY_BASE`: デモ・テスト用。USD建て商品をJPY口座で管理している状態
- `PROD_P_JPY_SETTLEMENT`: 本番P口座。JPY決済
- `PROD_N_USD_SETTLEMENT`: 本番N口座。USD決済

DEMOワークスペースでは、口座全体カードにN口座欄を表示しない。

DEMO表示:

```text
DEMO / JPYベース
証拠金使用率
現金残高
必要証拠金など、Saxoデモ画面下部でJPY表示される項目
```

DEMOで非表示にするもの:

- N口座
- USD残高
- N口座証拠金使用率
- N口座ホイール用USD台帳

REALワークスペースの場合だけ、P口座とN口座を分けて表示する。

既存データの移行:

- 既存DEMOワークスペース: `DEMO_JPY_BASE`
- 既存REALワークスペースで口座種別がないもの: 原則 `PROD_P_JPY_SETTLEMENT`
- REAL側は必要に応じてユーザーがN口座へ変更できるようにする

注意:

- `DEMO_JPY_BASE` は本番P口座と完全に同じではない
- 画面上は「P口座」ではなく「DEMO / JPYベース」と表記する
- DEMO口座はP口座ロジックの初期テストには使える
- DEMO口座をN口座ロジック、USD残高管理、JPY→USD資金振替、USD取得レート管理の検証には使わない

### 3.1 P/N口座を合算しない

P口座とN口座は、同じサクソバンク証券内の外国株式等オプション口座であっても、アプリ上は別口座として扱う。

```ts
type SaxoAccountCode = "P" | "N";
type Currency = "JPY" | "USD";
```

- P口座: JPY決済
- N口座: USD決済
- 証拠金、現金残高、株式保有、オプション建玉は口座別に管理する
- P口座のJPY残高をN口座の余力として扱わない
- N口座のUSD残高をP口座の余力として扱わない

### 3.2 N口座の損益はUSDが主

N口座では、プレミアム、手数料、株式売買代金、実現損益、累積ホイール損益をUSDで管理する。

JPY表示は参考換算に限定する。

```text
N口座のJPY換算額は、表示用USD/JPYによる参考値です。
円転または税務上の確定損益とは異なる可能性があります。
```

### 3.3 為替は3種類に分ける

1. P口座の取引時適用為替
2. N口座の参考表示用USD/JPY
3. USDをJPYに戻す出金・円転時の為替

N口座内でホイールを回している間、USD建て損益は為替更新で変えない。

### 3.4 P口座の円転コストは二重計上しない

P口座でブローカー実明細のJPY決済額、JPY手数料、適用為替が分かる場合、それを優先する。

アプリ側で一律に0.25%を上乗せしない。

0.25%は、JPY⇔USDの資金振替イベントの推定時だけ既定値として使う。

### 3.5 税務区分は分ける

アプリ上は次を別区分として表示する。

- オプション損益: 先物取引に係る雑所得等
- 株式売却損益: 上場株式等の譲渡所得等
- 為替差損益: 今回は厳密計算の対象外。出金・円転イベントとして記録し、参考表示から始める

本アプリの税額は概算であり、申告用の確定値ではない。

## 4. 口座と台帳のデータ設計

### 4.1 口座マスタ

```ts
type BrokerAccount = {
  id: string;
  broker: "SAXO_BANK_JP";
  accountCode: "P" | "N";
  displayName: string;
  baseCurrency: "JPY" | "USD";
  settlementCurrency: "JPY" | "USD";
  productType: "FOREIGN_STOCK_INDEX_OPTIONS";
};
```

表示例:

- `P: 外国株式等オプション（円建て / JPY決済）`
- `N: 外国株式等オプション（ドル建て / USD決済）`

### 4.2 口座状態

現在の `AccountInputs` はJPY前提なので、P/N別に拡張する。

```ts
type AccountState = {
  accountCode: "P" | "N";
  currency: "JPY" | "USD";
  cashBalance: number;
  marginRequirement: number;
  marginUsagePercent: number;
  accountValue?: number;
  updatedAt: string;
};
```

P口座:

- 現金残高 JPY
- 証拠金使用率
- 必要証拠金 JPY

N口座:

- USD現金残高
- 証拠金使用率
- 必要証拠金 USD
- 参考JPY換算

### 4.3 オプション建玉

既存の `TradeSimulation` に `accountCode` と通貨別キャッシュフローを追加する。

```ts
type TradeSimulation = {
  accountCode: "P" | "N";
  accountCurrency: "JPY" | "USD";
  referenceFxRateJPY?: number;
  brokerSettlement?: BrokerSettlement;
  // 既存項目...
};
```

```ts
type BrokerSettlement = {
  source: "manual" | "broker_statement" | "saxo_api_estimate";
  tradeCurrency: "USD";
  settlementCurrency: "JPY" | "USD";
  grossPremiumUSD: number;
  commissionUSD?: number;
  commissionJPY?: number;
  exchangeFeeUSD?: number;
  exchangeFeeJPY?: number;
  appliedFxRate?: number;
  netCashflowUSD?: number;
  netCashflowJPY?: number;
};
```

## 5. 為替・資金振替・出金設計

### 5.1 FX_TRANSFER

JPY⇔USDの資金振替は、オプション取引とは別イベントとして扱う。

```ts
type FxTransferEvent = {
  id: string;
  direction: "JPY_TO_USD" | "USD_TO_JPY";
  fromAccountCode: "P" | "N" | "OTHER_JPY" | "OTHER_USD";
  toAccountCode: "P" | "N" | "OTHER_JPY" | "OTHER_USD";
  fromCurrency: "JPY" | "USD";
  toCurrency: "JPY" | "USD";
  fromAmount: number;
  toAmount: number;
  appliedFxRate: number;
  fxCostRate?: number;
  occurredAt: string;
  source: "manual" | "broker_statement" | "app_estimate";
};
```

推定時の既定値:

```ts
const DEFAULT_SAXO_TRANSFER_FX_COST_RATE = 0.0025;
```

ただし、実明細の `fromAmount`, `toAmount`, `appliedFxRate` がある場合はそれを優先する。

### 5.2 N口座からの最終出金

N口座ホイールで得たUSD利益は、N口座内ではUSD利益として管理する。

最終的に出金したい場合のみ、出金・円転イベントを記録する。

```text
N口座USD残高
→ USD_TO_JPY出金・円転
→ その時点の為替でJPY換算
```

このイベントは、N口座内ホイールの運用成績とは別に表示する。

## 6. 株式移管設計

### 6.1 P→N株式移管イベント

P口座でプット売りが権利行使され株式を取得した場合、その株式をN口座へ移管する運用を想定する。

```ts
type StockTransferEvent = {
  id: string;
  ticker: string;
  fromAccountCode: "P" | "N";
  toAccountCode: "P" | "N";
  shares: number;
  transferDate: string;
  costBasisUSD: number;
  sourceSimulationId?: string;
  destinationWheelCycleId?: string;
  memo?: string;
};
```

株式移管は売却ではないため、原則として以下の扱いにする。

- オプション損益に含めない
- 株式譲渡損益に含めない
- 為替差損益に含めない
- 株数と取得単価をN口座側へ引き継ぐ
- N口座ホイールの `stock_holding` フェーズへ合流させる

### 6.2 P口座で株式が残る場合の警告

P口座で株式取得済みだがN口座へ移管していない場合、次の注意を表示する。

```text
P口座で取得した株式が残っています。
N口座へ株式移管してカバードコール管理へ進めるか確認してください。
```

## 7. N口座ホイール戦略設計

### 7.1 ホイールの基本単位

ホイールは銘柄ごとに管理する。

```text
1銘柄 = 1ホイールサイクル
```

NVDA、AMZN、NFLXなど、銘柄ごとにカードを表示する。

### 7.2 ホイールフェーズ

```ts
type WheelPhase =
  | "n_cash"
  | "n_short_put"
  | "n_stock_holding"
  | "n_covered_call"
  | "n_called_away"
  | "p_short_put"
  | "p_assigned_stock"
  | "p_to_n_transfer_pending"
  | "cycle_closed";
```

標準ルート:

```text
N現金待機
→ Nプット売り中
→ N株式保有中
→ Nカバードコール中
→ N株式売却済み
→ N現金待機
```

P口座合流ルート:

```text
Pプット売り中
→ P株式取得済み
→ P→N株式移管待ち
→ N株式保有中
→ Nカバードコール中
```

P口座合流ルートは、N口座ホイール本体ではなく「N口座ホイールへ合流する前段階」として扱う。P口座でプット売りをしているだけの状態では、N口座の現金待機を「済」と表示しない。N口座にUSD現金がない、またはN口座で実際に建玉・株式保有がない場合は、N口座側のフェーズを進行済みに見せない。

表示上は次のように分ける。

```text
P口座準備ルート:
Pプット売り中
→ P株式取得済み
→ P→N移管待ち

N口座ホイール本体:
N現金待機
→ Nプット売り中
→ N株式保有中
→ Nカバードコール中
→ N株式売却済み
```

P口座準備ルートのカード名は `N口座ホイール` と断定せず、`ホイール準備中（P口座）` または `P口座からN口座への合流準備` とする。N口座へ移管済み、またはN口座で建玉を開始した段階で `N口座ホイール` と表示する。

### 7.3 ホイールサイクル

```ts
type WheelCycle = {
  id: string;
  ticker: string;
  primaryAccountCode: "N";
  currentPhase: WheelPhase;
  currentAccountCode: "P" | "N";
  currentShares: number;
  averageCostUSD: number;
  usdCashImpact: number;
  cumulativePremiumUSD: number;
  cumulativeStockRealizedPnlUSD: number;
  cumulativeFeesUSD: number;
  cumulativeTotalPnlUSD: number;
  referenceFxRateJPY?: number;
  eventIds: string[];
  linkedSimulationIds: string[];
  openedAt: string;
  closedAt?: string;
  memo?: string;
};
```

`primaryAccountCode: "N"` は「最終的にN口座でホイールを回す設計上の主口座」を表す。現在の実建玉口座ではない。画面上で `主口座 N / 現在 N` のように表示すると誤解しやすいため、次のように表示する。

- P口座準備中: `現在: P口座 / N口座合流前`
- P→N移管待ち: `現在: P口座 / N口座へ移管待ち`
- N口座で運用中: `現在: N口座ホイール`

`主口座 N` という内部概念は、利用者向けの常時表示から外すか、ヘルプ内だけで説明する。

### 7.4 ホイールイベント

```ts
type WheelEvent =
  | ShortPutOpenedEvent
  | ShortPutClosedEvent
  | PutAssignedEvent
  | StockTransferEvent
  | StockPurchaseEvent
  | CoveredCallOpenedEvent
  | CoveredCallClosedEvent
  | CallAssignedEvent
  | StockSoldEvent
  | FxTransferEvent
  | ManualAdjustmentEvent;
```

イベント履歴は時系列で表示する。

```text
日付 | イベント | 口座 | 内容 | USD損益 | 株数変化 | フェーズ
```

### 7.5 ホイール可視化

画面下部のホイール戦略は、表だけではなく、色付きステップで現在地を示す。

```text
N現金待機 ─ Nプット売り ─ N株式保有 ─ Nカバードコール ─ N株式売却
  済           済           済           現在             未
```

色:

- 灰色: 未到達または該当なし
- 緑: 通過済み
- 青: 現在
- 黄: 注意
- 赤: 対応が必要

ステップの「済」は、その口座で実際に通過した状態だけに使う。P口座でプット売り中の場合、N口座現金待機を通過済みとして緑表示しない。N口座の現金が0 USDで、N口座側の建玉・株式保有もない場合は、N口座ステップは未到達として表示する。

P口座準備中の例:

```text
NVDA  ホイール準備中（P口座）
現在: P口座でプット売り中 / N口座合流前

Pプット売り ─ P株式取得 ─ P→N移管待ち ─ N株式保有 ─ Nカバードコール
  現在           未             未             未             未
```

この状態では、N口座の累積プレミアム、N口座現金、N口座ホイール損益を0のまま「済」扱いにしない。

カード例:

```text
NVDA  N口座ホイール
現在: Nカバードコール中
累積プレミアム +$428
累積損益 +$612
保有株数 100株 / 平均取得 $200.00

N現金待機 ─ Nプット売り ─ N株式保有 ─ Nカバードコール ─ N株式売却
  済           済           済           現在             未

次の候補: Cを満期まで保有するか、買戻しで閉じるかを確認
```

### 7.6 建玉管理との役割分担

建玉ダッシュボード:

- いま存在する1件ごとの建玉
- 注文前、建玉中、決済済み、権利行使済み、満期終了

ホイール戦略:

- 同じ銘柄の一連の履歴
- 累積プレミアム
- 累積株式売買損益
- 現在フェーズ
- 次に取る候補アクション

## 8. 画面設計

### 8.1 ヘッダー

追加または明確化する表示:

- DEMO / REAL
- P口座 / N口座フィルタ
- 株価更新
- 為替更新
- JSONバックアップ / 復元

### 8.1.1 公開版の外部株価・為替取得モード

一般公開用バージョンでは、初期状態では外部株価・為替取得をOFFにする。ただし、利用者が明示的に同意した場合だけ、外部取得を有効にできるモードを用意する。

目的:

- 利用者が手入力だけで使える状態を維持する
- 必要な利用者は、銘柄ティッカーとUSD/JPYだけを外部サービスへ照会できる
- 建玉数量、口座残高、証拠金、JSONバックアップなどの入力データは外部送信しないことを明示する

初回ON時の同意文:

```text
外部株価・為替取得を有効にします。

この機能をONにすると、株価取得時に銘柄ティッカー、為替取得時にUSD/JPY取得リクエストが外部の価格取得サービスへ送信されます。

送信される可能性があるもの:
- 銘柄ティッカー（例: NVDA, AMZN）
- USD/JPYの取得リクエスト
- 利用者のIPアドレス、ブラウザ情報、アクセス時刻

送信しないもの:
- 保有株数
- 建玉数量
- プレミアム
- 口座残高
- 証拠金使用率
- DEMO/REALの入力内容全体
- JSONバックアップの内容
- localStorageに保存されたデータ

外部取得を使わない場合は、Saxo TraderGO等で確認した株価・為替を手入力してください。
```

UI:

- ヘッダーまたはデータ/設定画面に `外部取得` トグルを置く
- 初期値はOFF
- ONにする時だけ同意ダイアログを出す
- 同意済みフラグはブラウザ内 `localStorage` に保存する
- OFFの場合、株価・為替ボタンは無効または `外部取得OFF` と表示する
- ONの場合、株価・為替ボタンを使用可能にする
- いつでもOFFへ戻せる

実装上の注意:

- 外部取得ONでも、送信するのは価格取得に必要な最小情報に限定する
- URLに建玉ID、数量、口座種別、残高、証拠金、メモを含めない
- 一括株価更新では、登録されているティッカーの集合だけを送る
- 公開版でAPIプロキシを使う場合は、プロキシ側でも入力データ全体をログに残さない
- 外部取得ON/OFFはJSONバックアップの対象外でもよい。端末ごとのプライバシー設定として扱う

表示文言:

```text
外部取得ON: 銘柄ティッカーとUSD/JPY取得リクエストのみ外部サービスへ送信します。
外部取得OFF: 株価・為替は手入力してください。
```

### 8.2 建玉ダッシュボード

列に `口座` を追加する。

```text
銘柄 | 状態 | 口座 | 戦略 | 権利行使価格 | 満期 | プレミアム | 使用分母 | 年率 | 警告 | 操作
```

N口座建玉では、USD実額を主表示し、JPYは参考表示にする。

### 8.3 口座全体カード

REALではP/N別に表示する。

```text
P口座: JPY現金残高 / 証拠金使用率
N口座: USD現金残高 / 証拠金使用率 / 参考JPY換算
```

P/Nを合算した警告判定はしない。

DEMOではN口座欄を出さず、`DEMO / JPYベース` としてJPYベースの口座情報だけを表示する。

### 8.4 建玉入力

最初に口座を選ぶ。

```text
口座:
P: 外国株式等オプション（円建て / JPY決済）
N: 外国株式等オプション（ドル建て / USD決済）
```

口座に応じて入力ラベルを変える。

P口座:

- JPY決済額
- 適用為替
- JPY手数料

N口座:

- USDプレミアム
- USD手数料
- 参考USD/JPY

### 8.5 ホイール戦略カード

画面下部にコンパクト表示する。

ホイール戦略カードは常時大きく表示しない。銘柄ごとのホイールサイクルが存在しない場合、または選択中の建玉がまだホイール管理に登録されていない場合は、折りたたみ行または小さな導線だけを表示する。

表示ルール:

- ホイールサイクルが0件: `ホイール管理 0件` と小さく表示し、必要な時だけ開く
- P口座プット売り中: `ホイール準備中（P口座）` として表示し、N口座ホイール本体と区別する
- P→N移管後またはN口座運用中: `N口座ホイール管理` として表示する
- ダッシュボードやサマリー確認の邪魔にならないよう、初期状態は折りたたむ
- ユーザーが `選択建玉からサイクル作成` を押した場合のみ、その建玉をホイール管理へ登録する
- P口座プット売りを登録する場合は、N口座現金待機を通過済みにしない

通常:

```text
ホイール戦略
NVDA | Nカバードコール中 | +$612 | 100株
AMZN | Nプット売り中     | +$180 | 0株
```

展開時:

- 色付きフェーズステッパー
- 累積損益
- 保有株数と平均取得単価
- イベント履歴
- 関連建玉
- 次の候補アクション

## 9. 計算ロジック

### 9.1 P口座プレミアム

実明細がある場合:

```text
netCashflowJPY = brokerNetCashflowJPY
```

推定の場合:

```text
grossPremiumUSD = premiumUSD * 100 * quantity
grossPremiumJPY = grossPremiumUSD * appliedFxRate
netCashflowJPY = grossPremiumJPY - commissionJPY - exchangeFeeJPY
```

### 9.2 N口座プレミアム

```text
grossPremiumUSD = premiumUSD * 100 * quantity
netCashflowUSD = grossPremiumUSD - commissionUSD - exchangeFeeUSD
referenceJPY = netCashflowUSD * referenceFxRateJPY
```

年率計算はUSD同士で行う。

```text
annualReturnPct = profitUSD / denominatorUSD * (365 / days) * 100
```

JPY参考換算は年率の主計算には使わない。

### 9.3 N口座ホイール累積損益

```text
cumulativePremiumUSD
  + cumulativeStockRealizedPnlUSD
  - cumulativeFeesUSD
  = cumulativeTotalPnlUSD
```

未売却の株式含み損益は、実現損益とは別に表示する。

### 9.4 カバードコール満期想定損益

カバードコールでは、権利行使された場合の株式売却損益とオプションプレミアムを並べて表示する。

```text
株式売却損益 = (C権利行使価格 - 取得単価) * 株数
オプション損益 = Cプレミアム - 手数料
合計想定損益 = 株式売却損益 + オプション損益
```

N口座ではUSD主表示、JPYは参考表示。

### 9.5 税務

オプション損益と株式譲渡損益は別区分で表示する。

N口座でUSD運用中の損益は、JPY換算を確定値として扱わない。税務上の厳密な円換算は後続フェーズ。

## 10. リスク警告

追加する警告:

1. P/N余力の混同
   - P口座のJPY残高をN口座建玉の余力に使っている可能性
   - N口座のUSD残高をP口座建玉の余力に使っている可能性

2. P口座に取得株が残っている
   - P口座で権利行使により株式取得済み
   - N口座へ移管していない

3. N口座カバードコールの株数不足
   - C売り数量 * 100 > N口座保有株数

4. 同一口座内でP売りとカバードコールを同時進行
   - 資料上は、通常ホイールはN口座中心、P口座は入口・資金待機として分ける前提
   - 必ずNGではないが、注意表示する

5. N口座JPY換算の誤解
   - 参考換算を確定損益と誤認しないよう表示

6. 最終円転未記録
   - N口座からJPY出金したが、出金・円転イベントが未入力

## 11. JSONバックアップ互換

スキーマを更新する。

```json
{
  "schemaVersion": 2,
  "app": "us-options-position-manager",
  "workspace": "live",
  "simulations": [],
  "accountStates": [],
  "wheelCycles": [],
  "wheelEvents": [],
  "fxTransfers": [],
  "stockTransfers": []
}
```

既存 `schemaVersion: 1` は、読み込み時に次の既定で移行する。

- `accountCode = "P"`
- `accountCurrency = "JPY"`
- 既存JPY計算を維持
- ホイールイベントなし

## 12. 実装工程

### Phase 0: 保全と仕様固定

目的: 現行ローカル版を壊さない。

作業:

- `http://127.0.0.1:5173/` の現行データをJSONバックアップ
- 現行コードのブランチまたはタグ固定
- `schemaVersion: 1` データの移行ルールをテスト化

完了条件:

- 既存データを消さずにアプリを起動できる
- 旧JSONを読み込める

### Phase 1: P/N口座基盤

目的: 口座と通貨の前提を正す。

作業:

- `SaxoAccountCode` 型追加
- `AccountState` をP/N別に変更
- 建玉に `accountCode` を追加
- ダッシュボードに口座列追加
- 口座全体カードをP/N別表示に変更
- P/N合算警告を除去

完了条件:

- P口座建玉とN口座建玉を同時に保存できる
- P/Nで現金残高と証拠金使用率が分かれる

### Phase 2: P/N別キャッシュフロー計算

目的: JPY口座とUSD口座の計算を分離する。

作業:

- P口座用JPY計算
- N口座用USD計算
- N口座参考JPY表示
- 分母比較をP/N通貨別に修正
- 年率計算の根拠表示も通貨別に修正

完了条件:

- N口座のUSD/JPY更新でUSD年率が変わらない
- P口座はJPYベースで従来通り計算できる

### Phase 3: 株式移管イベント

目的: P口座取得株をN口座ホイールへ渡せるようにする。

作業:

- `StockTransferEvent` 型追加
- P→N株式移管入力UI
- 移管後にN口座保有株へ反映
- P口座取得株残り警告
- JSONバックアップ対応

完了条件:

- P口座で取得した100株をN口座へ移管記録できる
- 移管後、N口座カバードコールの保有株として使える

### Phase 4: N口座ホイール管理

目的: 銘柄ごとのUSD建てホイール台帳を作る。

作業:

- `WheelCycle` v2型
- `WheelEvent` 型
- 銘柄別ホイールカード
- 色付きフェーズステッパー
- イベント履歴
- 累積プレミアムUSD
- 累積株式売買損益USD
- 累積手数料USD
- 参考JPY換算
- 次の候補アクション

完了条件:

- NVDAなど1銘柄で、P売り、株取得、P→N移管、Nカバードコールまで1サイクルで見える
- N口座内ホイールはUSDで累積される
- P口座でプット売り中の建玉をホイールへ登録しても、N口座現金待機が「済」にならない
- N口座に0 USDしかない状態で、N口座プット売りが「現在」と表示されない
- P口座段階は `ホイール準備中（P口座）` または同等の表現で、N口座ホイール本体と区別される
- ホイールカードは初期表示で画面を大きく占有せず、必要な時だけ展開できる

### Phase 5: リスク警告とシナリオ再調整

目的: P/Nとホイールに合わせて文言と警告を整える。

作業:

- N口座カバードコール株数不足警告
- P口座株式残り警告
- P/N余力混同警告
- N口座参考JPY注意文言
- プット売り、カバードコール、ホイールのシナリオ文言再整理

完了条件:

- ユーザーが「次に何を確認すべきか」を口座別に理解できる
- 確定損益、含み損益、参考JPY換算が混同されない

### Phase 6: 税務・履歴集計の拡張

目的: P/NとUSD運用を踏まえて税務表示を破綻させない。

作業:

- オプション損益の税務区分表示
- 株式譲渡損益の区分表示
- N口座USD損益の参考JPY表示
- 出金・円転イベントの記録欄
- 税務区分別履歴集計の通貨別注意表示

完了条件:

- オプション損益と株式譲渡損益が自動相殺されない
- N口座のJPY参考換算が確定税務値として表示されない

### Phase 7: Saxo read-only / 候補アプリ連携

目的: 後続の自動取得版へ進む。

作業:

- ローカルAPI
- Saxo OAuth read-only
- 口座、建玉、残高、未約定注文取得
- オプションチェーン取得
- TradingView候補から建玉案作成

完了条件:

- 発注機能なしでSaxo情報を取得できる
- 手入力版のロジックに自然に接続できる

### Phase 7.5: 公開版の外部株価・為替取得オプション

目的: 一般公開版でも、利用者が明示的に同意した場合だけ株価・為替の外部取得を使えるようにする。

作業:

- 外部取得ON/OFF設定
- 初回ON時の同意ダイアログ
- 送信される情報・送信されない情報の明示
- 株価取得ボタンと為替取得ボタンの有効/無効切り替え
- 公開版で使える価格取得経路の実装または既存 `/api/quote` `/api/fx` の公開環境対応
- エラー時は手入力へ戻せる表示

完了条件:

- 初期状態では外部取得OFF
- 同意なしでは外部株価・為替取得が動かない
- ONにした場合だけ、株価・為替ボタンが使える
- 送信される情報がUIで明示される
- 建玉数量、口座残高、証拠金、JSONデータ、localStorage内容を外部送信しない
- OFFへ戻せる
- 公開版でビルド・表示確認が通る

## 13. 最適な実装順

最初にやるべき順番は次。

1. Phase 0: 保全
2. Phase 1: P/N口座基盤
3. Phase 2: P/N別計算
4. Phase 3: P→N株式移管
5. Phase 4: N口座ホイール可視化
6. Phase 5: 警告と文言
7. Phase 6: 税務・履歴集計
8. Phase 7: read-only連携

理由:

- 口座と通貨の土台を直さないままホイールを作ると、後で全面修正になる
- N口座ホイールはUSD台帳が前提なので、P/N別計算が先
- P→N株式移管はホイール合流の入口なので、ホイール可視化より先
- read-only連携は最後でよい。手入力で正しい設計を固めてから取得自動化する

## 14. 初回実装対象

初回実装は、ユーザーが利用中のローカル版を対象にする。

```text
http://127.0.0.1:5173/
```

公開用GitHub Pages版、グレードアップ開発中版への反映は、ローカル版で確認した後に行う。

## 15. 完了判定

この改訂の完成条件:

- P/N口座を選んで建玉登録できる
- DEMO口座が `DEMO / JPYベース` として表示され、N口座欄が出ない
- P/N別に現金残高と証拠金使用率を管理できる
- N口座建玉はUSD主表示になる
- N口座のJPYは参考換算として表示される
- P口座で取得した株式をN口座へ移管できる
- N口座ホイールが銘柄別に表示される
- ホイールの現在フェーズが色付きで一目で分かる
- ホイールの累積損益がUSDで分かる
- オプション損益と株式譲渡損益が別区分で表示される
- JSONバックアップで復元できる

## 16. 実装時の禁止事項

- P/N口座の余力を合算しない
- N口座の参考JPYを確定損益として扱わない
- P口座取引に0.25%を一律上乗せしない
- 株式移管を売却損益として扱わない
- ホイール累積損益に未売却株の含み損益を実現損益として混ぜない
- Saxoへの発注機能を作らない
- OAuthトークンをブラウザlocalStorageに保存しない
