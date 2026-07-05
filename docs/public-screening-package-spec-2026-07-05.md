# us_options_screening_package.v1 仕様メモ 2026-07-05

## 目的

`us_options_screening_package.v1` は、公開版でスクリーニング候補を持ち込むためのJSON形式です。手入力やCSVだけでは表現しにくい、チャート分析、オプション候補、資金条件、レビュー結果をまとめて取り込めます。

公開版はこのJSONを読み込んで、既存の候補形式へ正規化します。証券会社やローカルAPIから値を取得する機能は含みません。

## 最小構造

```json
{
  "schemaVersion": "us_options_screening_package.v1",
  "generatedAt": "2026-07-05T09:00:00+09:00",
  "source": "manual",
  "dataPolicy": {
    "userProvided": true,
    "containsCredentials": false,
    "redistributionChecked": true
  },
  "candidates": [
    {
      "symbol": "SAMPLE",
      "name": "Sample Candidate",
      "market": "US",
      "underlyingPrice": 100,
      "priceAsOf": "2026-07-05T09:00:00+09:00"
    }
  ]
}
```

## 主なフィールド

| フィールド | 用途 |
| --- | --- |
| `symbol` | 米国株ティッカー。 |
| `underlyingPrice` | 株価。Level 1判定に使う。 |
| `dailyOhlcv` | OHLCV配列。チャート分析エンジンで使う。 |
| `chartAnalysis` | 外部で作成したチャート分析結果。 |
| `candidateStrategies` | `long_call`、`cash_secured_put_buy_to_own`、`covered_call`、`cash_secured_put_avoid_assignment` など。 |
| `optionCandidates` | オプション候補。Bid/Ask、Volume、Open Interest、IV、Greeksを入れる。 |
| `capital` | `availableCashUSD`、`buyingPowerUSD`、`maxLossToleranceUSD`、`assignmentCapitalAvailableUSD`、`stockShares` など。 |
| `strategySuitability` | 外部で判定済みの戦略適性。なければ共通ロジックで生成する。 |
| `positionDrafts` | 外部で作成済みの建玉案レビュー。なければ共通ロジックで生成できる範囲を生成する。 |
| `advancedStrategyReviews` | wheel、short strangle、synthetic forward等の上級戦略レビュー。 |

## Level判定

| Level | 判定の目安 |
| --- | --- |
| `level_1_symbol_price` | `symbol` と `underlyingPrice` がある。 |
| `level_2_chart_ready` | チャート分析またはOHLCVがある。 |
| `level_3_option_ready` | Bid/Ask付きオプション候補がある。 |
| `level_4_draft_ready` | 資金条件まであり、建玉案レビューを評価できる。 |

Levelはデータ充足度であり、実行可否や売買判断ではありません。

## 保守価格の扱い

- 買い建て候補はAskを保守価格候補にする。
- 売り建て候補はBidを保守価格候補にする。
- Midは参考値として表示する。
- Lastだけでは保守価格候補を作らない。

## 危険フィールド

公開版の取込では、認証情報や操作系フィールドに見えるキーを検出し、候補のrawデータから除外します。

入れないでください。

- APIキー、トークン、パスワード、口座ID完全値
- ローカル端末パス
- 発注、変更、取消、権利行使などの操作指示に見えるフィールド

`dataPolicy.containsCredentials` はメタ情報として許容されますが、値は `false` にしてください。危険フィールドが見つかった場合、取込結果の警告に表示されます。

## 配布サンプル

```text
public/samples/us-options-screening-sample-v1.json
```

このサンプルは、Level 1からLevel 4、Lastのみ、Bid/Askあり、資金不足、上級戦略の手動確認レビューを確認するための合成データです。

公開版アプリでは、候補画面の `サンプルを読み込む` から同じJSONを直接読み込めます。GitHub Pages配布時の想定URLは次です。

```text
https://jimusaku-lab.github.io/us-options-risk-planner/samples/us-options-screening-sample-v1.json
```
