# 米国株オプション候補選定と建玉管理アプリの統合ブリーフ

作成日: 2026-05-28

## 目的

既存の「米国株オプション建玉管理・リスク確認」アプリに、TradingViewで抽出した候補銘柄リストとSaxoBank証券のread-only情報取得を連携させる。

この統合は投資助言や自動売買ではなく、以下を目的にする。

- TradingViewで抽出した大型・高流動性の米国株候補を管理アプリ内で確認する
- Saxo OpenAPI read-onlyでオプションチェーン、建玉、余力、証拠金情報を取得する
- DTE、Delta、Open Interest、Option Volume、Bid/Askスプレッドを候補ごとに確認する
- 条件に合う候補を「建玉案」として既存のリスク確認画面へ渡す
- 最終判断と発注は必ず人間が行う

## 現状確認

管理アプリ本体:

- `apps/us-options-risk-planner`
- ローカルURL: `http://127.0.0.1:5173/`
- 現在の主用途: 手入力した米国株オプション建玉の分母、年率、税引後、注文前NG確認

既存の拡張ポイント:

- `src/broker/BrokerAdapter.ts`
  - `getConnectionStatus`
  - `getAccountSnapshot`
  - `getPositions`
  - `getOpenOrders`
  - `getOptionChain`
- `src/broker/SaxoBrokerAdapter.stub.ts`
  - Saxo OpenAPI read-only連携用の未実装スタブ
- `src/types/broker.ts`
  - 口座、建玉、注文、オプションチェーンの型が既に存在する
- `src/types/domain.ts`
  - `DataSource = "manual" | "saxo_api" | "imported_csv" | "calculated" | "demo_fixture"` が定義済み

TradingView候補抽出側:

- `tradingview-us-options-agent/output/tradingview_candidates.csv`
- `tradingview-us-options-agent/output/tradingview_candidates.json`
- `tradingview-us-options-agent/output/tradingview_candidates.md`
- `tradingview-us-options-agent/config.json`

現在のTradingView候補条件:

- US
- Price >= 20 USD
- Volume >= 1M
- Market Cap >= 100B USD
- 最大50銘柄
- Redlist既存銘柄はデフォルト除外
- 決算14日以内は除外ではなく注意扱い

Saxo UI検証結果:

- SaxoTraderGOの画面からオプションチェーンを開き、Bid / Ask / Delta / IV / Expiry / DTE を読むことは可能だった
- ただし50銘柄をUI自動化で連続取得した場合、仮想表示や銘柄切替後の古いチェーンを読むリスクがあった
- `tradingview-us-options-agent/output/saxo_options_scan_summary.csv` と `saxo_options_chain_rows.csv` は検証用であり、実判断には使わない
- 今後はSaxo OpenAPIを優先する

## 推奨する統合方針

「候補選定」と「建玉管理」は同じテーブルに混ぜない。

管理アプリ内に、以下の流れを追加する。

1. TradingView候補を読み込む
2. 候補を銘柄単位でレビューする
3. Saxo OpenAPI read-onlyでオプションチェーンを取得する
4. DTE 30-60日、Delta 0.15-0.35付近、Open Interest、Option Volume、Bid/Askスプレッドを確認する
5. 条件に合うものだけを「建玉案」に変換する
6. 既存の建玉入力・リスク確認画面で分母、年率、税引後、NG警告を確認する
7. 発注は管理アプリでは行わない

## 画面設計案

### 1. 建玉管理

既存画面を維持する。

役割:

- 登録済み建玉の管理
- 分母比較
- 税引後比較
- シナリオ確認
- 注文前NG
- Wheel履歴

### 2. 候補リスト

新規追加する。

入力:

- `tradingview_candidates.json`
- またはCSVインポート

表示項目:

- Rank
- Symbol
- Company
- Price
- Volume
- Market Cap
- Sector
- Analyst Rating
- Next Earnings Date
- EarningsWarning
- Score
- SuggestedUse
- Memo
- 既存建玉あり/なし
- Redlist銘柄かどうか
- Saxoチェーン取得済み/未取得

主な操作:

- 候補JSON/CSVを読み込み
- Redlist銘柄も表示/非表示
- 保有中・建玉中の銘柄を強調
- 決算近い銘柄を注意表示
- 「Saxoチェーン確認へ」ボタン

### 3. オプションチェーン確認

新規追加する。

入力:

- 候補銘柄
- DTE範囲: デフォルト 30-60
- Delta範囲: デフォルト 0.15-0.35
- 最小Open Interest
- 最小Option Volume
- 最大Bid/Askスプレッド率

表示項目:

- Symbol
- Underlying Price
- Expiry
- DTE
- Type
- Strike
- Bid
- Ask
- Mid
- Delta
- IV
- Open Interest
- Option Volume
- Spread %
- 取得日時
- データソース

主な操作:

- Saxo OpenAPIからチェーン取得
- DTE/Delta/OI/Volume/Spreadで絞り込み
- Covered Call候補として建玉案作成
- Cash Secured Put候補として建玉案作成
- Watch onlyとして保存

### 4. Saxo接続

新規追加または設定領域に追加する。

表示項目:

- 接続状態
- DEMO / LIVE
- AccountKey
- ClientKey
- 権限
- 最終同期時刻
- read-only方針

操作:

- 接続開始
- トークン更新
- 口座スナップショット取得
- 建玉同期
- 未約定注文取得

## データ型追加案

### CandidateSymbol

```ts
export type CandidateSource = "tradingview" | "manual" | "imported_csv";

export type CandidateSymbol = {
  id: string;
  source: CandidateSource;
  importedAt: string;
  rank: number;
  symbol: string;
  company: string;
  priceUSD?: number;
  changePercent?: number;
  volume?: number;
  relativeVolume?: number;
  marketCapUSD?: number;
  per?: number;
  sector?: string;
  analystRating?: string;
  nextEarningsDate?: string;
  earningsWarning?: string;
  score: number;
  suggestedUse: string;
  memo?: string;
  redlist?: boolean;
  alreadyHasPosition?: boolean;
  watchOnly?: boolean;
};
```

### OptionCandidate

```ts
export type OptionCandidate = {
  id: string;
  symbol: string;
  underlyingPriceUSD: number;
  optionType: "call" | "put";
  expiryDate: string;
  dte: number;
  strikeUSD: number;
  bid: number;
  ask: number;
  mid: number;
  delta?: number;
  impliedVolatility?: number;
  openInterest?: number;
  volume?: number;
  spreadPercent?: number;
  dataSource: "saxo_api" | "manual" | "imported_csv";
  fetchedAt: string;
  suggestedStrategy: "covered_call" | "short_put" | "watch_only";
  warnings: string[];
};
```

### CandidateScanSettings

```ts
export type CandidateScanSettings = {
  minDte: number;
  maxDte: number;
  minAbsDelta: number;
  maxAbsDelta: number;
  minOpenInterest: number;
  minOptionVolume: number;
  maxSpreadPercent: number;
  includeNearEarnings: boolean;
};
```

## Store追加案

`useOptionsStore.ts` に以下を追加する。

- `candidateSymbolsByWorkspace`
- `optionCandidatesByWorkspace`
- `candidateScanSettings`
- `importCandidateSymbols`
- `upsertOptionCandidates`
- `createSimulationFromOptionCandidate`
- `markCandidateWatchOnly`
- `clearCandidates`

保存キー案:

- `us-options-candidate-symbols-v1`
- `us-options-option-candidates-v1`
- `us-options-candidate-settings-v1`

## Saxo OpenAPI連携案

### フロントエンドから直接Saxoへ接続しない

OAuthトークンをブラウザのlocalStorageへ置く設計は避ける。

推奨:

- Vite/React側はローカルAPIへアクセスする
- ローカルAPIがSaxo OpenAPIへ接続する
- アクセストークンと更新トークンはローカルの安全な保存先へ置く
- アプリ画面には接続状態と最終同期時刻だけ表示する

### ローカルAPI案

```txt
GET  /api/saxo/status
GET  /api/saxo/auth/start
GET  /api/saxo/auth/callback
POST /api/saxo/logout

GET  /api/saxo/account
GET  /api/saxo/positions
GET  /api/saxo/orders
GET  /api/saxo/options-chain?symbol=NVDA&minDte=30&maxDte=60
```

### BrokerAdapter実装案

`SaxoBrokerAdapter` はフロント側ではSaxoへ直接行かず、ローカルAPIを呼ぶ。

```ts
export class SaxoBrokerAdapter implements BrokerAdapter {
  async getConnectionStatus() {
    return fetchJson("/api/saxo/status");
  }

  async getAccountSnapshot() {
    return fetchJson("/api/saxo/account");
  }

  async getPositions() {
    return fetchJson("/api/saxo/positions");
  }

  async getOpenOrders() {
    return fetchJson("/api/saxo/orders");
  }

  async getOptionChain(symbol: string) {
    return fetchJson(`/api/saxo/options-chain?symbol=${encodeURIComponent(symbol)}`);
  }
}
```

## Saxo APIで確認したい項目

公式ドキュメント上、Options ChainはStockOptionを対象にできる。

候補確認に必要な主なフィールド:

- Bid
- Ask
- DeltaPct
- Greeks
- Volume
- OpenInterest
- Expiry
- Strike
- Put / Call

注意:

- OI/VolumeはETOで返る項目として説明されている
- Greeksは取引所が提供する場合に返る
- Market data権限やサブスクリプション状態により、実際に返る項目が変わる可能性がある
- 返らない項目は空欄または `Manual check required` として扱う

## 建玉案への変換ルール

### Cash Secured Put候補

条件例:

- Option type: put
- DTE: 30-60
- Delta絶対値: 0.15-0.35
- Bid/Askスプレッドが許容範囲
- Open InterestとVolumeが最低条件以上
- 決算14日以内ではない

変換先:

- `strategyType: "short_put"`
- `status: "planned"`
- `ticker`
- `currentPriceUSD`
- `expiryDate`
- `dte`
- `putLeg.strikeUSD`
- `putLeg.premiumUSD = mid`
- `putIntent = "accept_assignment"` を初期値にする
- `denominatorMode = "cash_secured"`

### Covered Call候補

条件例:

- Option type: call
- 既に100株以上保有している
- DTE: 30-60
- Delta: 0.15-0.35
- 権利行使されても売却してよい価格

変換先:

- `strategyType: "covered_call"`
- `status: "planned"`
- `ticker`
- `currentPriceUSD`
- `stockPosition.shares`
- `stockPosition.averageCostUSD`
- `callLeg.strikeUSD`
- `callLeg.premiumUSD = mid`
- `callLeg.isCovered = true`

## リスク警告の追加案

既存の `generateRiskWarnings` に、将来的に以下を追加できる。

- 決算14日以内
- Option Volume不足
- Open Interest不足
- Bid/Askスプレッド過大
- Deltaが想定範囲外
- DTEが短すぎる/長すぎる
- 既存建玉と同一銘柄に偏りすぎ
- セクターがテクノロジーに偏りすぎ
- Saxo取得時刻が古い
- Saxo APIで取得できない項目がある

## 実装フェーズ

### Phase 1: 候補リストの取り込み

目的:

- TradingView候補JSON/CSVを管理アプリ内で表示する
- まだSaxo APIには接続しない

実装:

- `CandidateSymbol` 型追加
- Storeへ候補保存領域追加
- 候補リスト画面追加
- JSON/CSVインポート対応
- 既存建玉との重複表示
- Redlist表示

完了条件:

- `tradingview_candidates.json` を読み込める
- 候補50件をテーブル表示できる
- 決算近い銘柄、データ不足銘柄が分かる

### Phase 2: Saxo read-onlyローカルAPIの土台

目的:

- OAuth接続とread-only取得を安全に分離する

実装:

- ローカルAPIサーバー追加
- Saxo OAuth Authorization Code + PKCE
- `/api/saxo/status`
- `/api/saxo/account`
- `/api/saxo/positions`
- `/api/saxo/orders`
- トークン保存
- DEMO / LIVEの明示表示

完了条件:

- 管理アプリから接続状態を表示できる
- 口座残高、証拠金、建玉、未約定注文をread-onlyで取得できる
- 発注系APIを一切実装していない

### Phase 3: オプションチェーン取得

目的:

- 候補銘柄に対してSaxo OpenAPIからオプションチェーンを取得する

実装:

- `/api/saxo/options-chain`
- `BrokerOptionChainSnapshot` への正規化
- DTE 30-60抽出
- Delta 0.15-0.35抽出
- OI/Volume/Spread計算
- 取得できない項目の明示

完了条件:

- 1銘柄ずつチェーンを取得できる
- 候補銘柄からOptionCandidateを生成できる
- AMZN/NVDAなどで実データの形を検証できる

### Phase 4: 建玉案作成

目的:

- OptionCandidateからTradeSimulationを作成する

実装:

- `createSimulationFromOptionCandidate`
- Covered Call / Cash Secured Putの初期値自動入力
- 既存リスク確認画面へ遷移
- 作成元データと取得時刻をメモに保存

完了条件:

- 候補からワンクリックで注文前建玉案を作れる
- 既存の分母・年率・税引後・NG確認がそのまま動く

### Phase 5: 一括候補スキャン

目的:

- 50銘柄を手動ではなく安全に順次確認する

実装:

- 一括取得キュー
- 1銘柄ごとの明示的な成功/失敗ログ
- レート制限
- 途中停止
- 取得済みキャッシュ
- 大量リトライ禁止

完了条件:

- 50候補のうち取得できた銘柄だけ保存される
- 失敗理由が分かる
- 古いチェーンや別銘柄データを混ぜない

## 安全制約

必須:

- 発注APIは実装しない
- 注文作成、注文変更、注文取消のAPIを呼ばない
- SaxoTraderGOの発注ボタンを自動クリックしない
- REAL口座では接続状態を赤系で明示する
- DEMO/REALを画面上で常に表示する
- API取得値には取得時刻を付ける
- データが不足する場合は空欄ではなく「Manual check required」を表示する
- 最終判断は人間が行う旨を画面に残す

避けること:

- Saxo UIの画面スクレイピングを本番データ取得の主手段にする
- ブラウザlocalStorageにOAuthトークンを保存する
- TradingView候補をそのまま注文候補として扱う
- 決算近い銘柄を自動除外だけで処理する
- PERやスコアだけで銘柄を自動選定する

## 参考リンク

- Saxo Options Chain Reference: https://www.developer.saxo/openapi/referencedocs/trade/v1/optionschain
- Saxo Options Chain Learn: https://www.developer.saxo/openapi/learn/options-chain
- Saxo OptionSidePutCall schema: https://www.developer.saxo/openapi/referencedocs/trade/v1/optionschain/post__trade__subscriptions/schema-optionsideputcall
- Saxo Positions Reference: https://www.developer.saxo/openapi/referencedocs/port/v1/positions/get__port
- Saxo Balances Reference: https://www.developer.saxo/openapi/referencedocs/port/v1/balances
- Saxo Orders Reference: https://www.developer.saxo/openapi/referencedocs/port/v1/orders/get__port
- Saxo OAuth PKCE: https://www.developer.saxo/openapi/learn/oauth-authorization-code-grant-pkce

## 担当者への推奨初手

最初に実装するのはSaxo API接続ではなく、候補リスト画面がよい。

理由:

- 既存TradingView出力をすぐ利用できる
- Saxo OAuthやMarket Data権限に依存しない
- 管理アプリの画面導線を先に固められる
- 後からSaxoチェーン取得を差し込める

最小の次タスク:

1. `CandidateSymbol` 型を追加する
2. `tradingview_candidates.json` のインポート画面を追加する
3. 候補テーブルから「建玉案を作成」できる導線を作る
