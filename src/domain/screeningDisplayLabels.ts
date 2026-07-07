export type ScreeningDisplayKind =
  | "capitalQuality"
  | "chartConfidence"
  | "chartRegime"
  | "completeness"
  | "dataSource"
  | "delayStatus"
  | "fitLevel"
  | "legSide"
  | "missingField"
  | "movingAverageSlope"
  | "optionType"
  | "positionDraftStatus"
  | "precisionLevel"
  | "priorityBand"
  | "publicFitLevel"
  | "reviewStatus"
  | "scoreItem"
  | "strategy"
  | "technicalSignal"
  | "timeframe";

const fieldLabels: Record<string, string> = {
  aboveMa25: "25日線上",
  aboveMa50: "50日線上",
  aboveMa200: "200日線上",
  assignmentCapital: "割当必要資金",
  assignmentCapitalAvailable: "割当可能資金",
  assignmentCapitalAvailableUSD: "現物株購入可能資金",
  assignmentCapitalRequired: "割当必要資金",
  assignmentCapitalRequiredUSD: "現物株購入必要資金",
  asOf: "データ時点",
  availableCashUSD: "利用可能資金",
  bidAskSpreadRate: "Bid/Askスプレッド率",
  blockers: "ブロック理由",
  breakEvenLowerUSD: "下側損益分岐",
  breakEvenPrice: "損益分岐価格",
  breakEvenUpperUSD: "上側損益分岐",
  capital: "資金",
  capitalEfficiencyNotes: "資金効率メモ",
  capitalQuality: "資金確認",
  cashBalanceUSD: "現金残高",
  chart: "チャート判定",
  close: "終値",
  comboModes: "コンボ種別",
  confidence: "信頼度",
  dailyClose: "日足終値",
  dataPolicy: "データ種別",
  dataSource: "データ取得元",
  delayStatus: "遅延状況",
  delta: "Delta",
  dte: "DTE",
  draftStatus: "建玉案状態",
  effectiveAcquisitionCostUSD: "実質取得単価",
  expirationCount: "満期数",
  expiry: "満期",
  expiryHandling: "満期対応",
  gamma: "Gamma",
  hasOptionChain: "オプションチェーン",
  importedAt: "取込日時",
  IV: "IV",
  iv: "IV",
  latestCloseDate: "最終決済目安日",
  legs: "脚数",
  level: "データ充足レベル",
  lookback: "確認期間",
  ma25Ma50CrossDate: "25/50日線GC日",
  ma25Ma50DistancePct: "25/50日線距離",
  macdCrossDate: "MACDクロス日",
  manualReview: "手動確認",
  market: "市場",
  maxLossUSD: "最大損失",
  missingFields: "不足データ",
  name: "会社名",
  netPremium: "正味プレミアム",
  netPremiumUSD: "正味プレミアム",
  nextChecks: "次に確認すること",
  nextDataNeeded: "次に必要なデータ",
  notes: "メモ",
  occurredAt: "発生日",
  openInterest: "建玉残高",
  optionLiquidity: "オプション流動性",
  optionType: "種別",
  positionDraft: "建玉案",
  premiumCreditUSD: "受取プレミアム",
  premiumDebitUSD: "支払プレミアム",
  price: "株価",
  priceAsOf: "株価時点",
  priceSource: "価格根拠",
  primary: "主時間軸",
  profitTakePrice: "利確目安",
  qualityWarnings: "品質警告",
  reasons: "判定理由",
  regime: "チャート局面",
  requiredCapitalUSD: "必要資金",
  reviewStatus: "確認状態",
  riskFlags: "リスクフラグ",
  scenario: "シナリオ",
  scenarios: "シナリオ",
  schema: "スキーマ",
  sector: "セクター",
  signalEvents: "シグナル発生日",
  signalOrder: "シグナル順序",
  slowKdCrossDate: "SlowKDクロス日",
  source: "価格ソース",
  saxoMarginAvailableUSD: "Saxo証拠金余力",
  saxoRequiredMarginUSD: "Saxo必要証拠金",
  stockEquivalentNotionalUSD: "株式換算想定元本",
  stockShares: "保有株数",
  stopLossPrice: "損切り目安",
  strategy: "戦略判定",
  strength: "強度",
  strike: "権利行使価格",
  strikePrice: "権利行使価格",
  symbol: "銘柄",
  syntheticDelta: "合成Delta",
  targetDteAvailable: "対象DTEあり",
  theta: "Theta",
  timingNotes: "タイミングメモ",
  transferWarnings: "転記前警告",
  trendNotes: "トレンドメモ",
  underlyingPrice: "原資産価格",
  vega: "Vega",
  volume: "出来高",
  warnings: "警告",
};

const listTitleLabels: Record<string, string> = {
  "comboReadiness notes": "コンボ準備メモ",
  "exitPlan notes": "出口ルールメモ",
  blockers: "ブロック理由",
  capitalEfficiencyNotes: "資金効率メモ",
  manualReview: "手動確認",
  missingFields: "不足データ",
  "主要サイン": "主要サイン",
  nextChecks: "次に確認すること",
  nextDataNeeded: "次に必要なデータ",
  qualityWarnings: "品質警告",
  reasons: "判定理由",
  riskFlags: "リスクフラグ",
  scenarios: "シナリオ",
  timingNotes: "タイミングメモ",
  transferWarnings: "転記前警告",
  trendNotes: "トレンドメモ",
  warnings: "警告",
  "warnings / riskFlags": "警告・リスクフラグ",
};

const strategyLabels: Record<string, string> = {
  cash_secured_put_avoid_assignment: "買わないプット売り",
  cash_secured_put_buy_to_own: "現金確保P売り（取得前提）",
  combo: "上昇転換コンボ",
  covered_call: "カバードコール",
  itm_short_put_buy_to_own: "ITM P売り（取得前提）",
  long_call: "コール買い",
  long_straddle_event: "イベント狙いロングストラドル",
  protective_collar: "プロテクティブカラー",
  short_put: "P売り",
  short_strangle: "ショートストラングル",
  short_strangle_advanced_review: "ショートストラングル（上級確認）",
  short_strangle_covered: "カバー付きショートストラングル",
  synthetic_forward: "シンセティック・フォワード",
  upside_reversal_combo: "上昇転換コンボ",
  wheel: "ホイール",
  wheel_cycle: "ホイール",
};

const labelsByKind: Record<ScreeningDisplayKind, Record<string, string>> = {
  capitalQuality: { insufficient_data: "資金データ不足", manual_review_required: "手動確認", not_ready: "未準備", ok: "資金条件確認済み", unknown: "未確認" },
  chartConfidence: { high: "高", insufficient: "不足", low: "低", medium: "中" },
  chartRegime: {
    bearish_breakdown: "弱気下抜け",
    bullish_continuation: "上昇継続",
    bullish_pullback: "上昇中の押し目",
    downtrend: "下落トレンド",
    downtrend_rebound: "下落中の反発",
    event_large_move_unknown: "イベント前後で方向不明",
    insufficient_data: "チャートデータ不足",
    range_neutral: "レンジ・中立",
    upside_reversal: "上昇転換",
  },
  completeness: {
    insufficient: "データ不足",
    level_1_symbol_price: "L1 銘柄・株価のみ",
    level_2_chart_ready: "L2 チャート確認可",
    level_3_option_ready: "L3 オプション候補確認可",
    level_4_draft_ready: "L4 建玉案レビュー可",
  },
  dataSource: {
    calculated: "計算値",
    csv: "CSV",
    imported_csv: "CSV取込",
    json: "JSON",
    legacy_tradingview: "旧TradingView取込",
    manual: "手入力",
    manual_import: "手入力/JSON",
    moomoo: "moomoo",
    moomoo_file_import: "moomooファイル取込",
    moomoo_user_export: "moomoo取込",
    saxo: "Saxo",
    tradingview: "TradingView",
    tradingview_user_export: "TradingView取込",
    user_export: "ユーザー取込",
  },
  delayStatus: { delayed: "遅延", end_of_day: "終値", permission_missing: "権限不足", real_time: "リアルタイム", realtime: "リアルタイム", unknown: "不明" },
  fitLevel: { avoid: "候補外", fit: "候補", insufficient_data: "データ不足", manual_review_required: "手動確認", watch: "確認対象" },
  legSide: { buy: "買い", sell: "売り" },
  missingField: {
    assignmentCapitalAvailable: "割当可能資金不足",
    "candidateStrategies.cash_secured_put_buy_to_own": "取得前提P売り候補不足",
    "candidateStrategies.long_call": "コール買い候補不足",
    "capital.allowAssignment": "割当許容の確認不足",
    "capital.allowStockCalledAway": "株式売却許容の確認不足",
    "capital.assignmentCapitalAvailableUSD": "割当可能資金未入力",
    "capital.availableCashOrRiskBudget": "利用可能資金または許容損失未入力",
    "capital.availableCashUSD": "利用可能資金未入力",
    "capital.exitRuleConfirmed": "出口ルール確認不足",
    "capital.maxLossToleranceUSD": "最大損失許容額未入力",
    "capital.stockShares": "保有株数不足または未入力",
    "chartAnalysis": "チャート分析不足",
    "chartAnalysis.orDailyOhlcv": "チャート分析または日足データ不足",
    daily: "日足データ不足",
    "daily.ohlcv": "日足OHLCV不足",
    "existingPosition.stockShares": "保有株数確認不足",
    latestCloseDate: "最終決済日の確認不足",
    legs: "オプション脚不足",
    "legs.conservativePrice": "保守価格不足",
    "legs.covered_call": "カバードコール脚不足",
    "legs.long_call": "コール買い脚不足",
    "legs.short_put": "P売り脚不足",
    "legs.strikePrice": "権利行使価格不足",
    longTermHoldEligible: "長期保有前提の確認不足",
    "option.ask": "オプションAsk不足",
    "option.bid": "オプションBid不足",
    "option.bidAsk": "オプションBid/Ask不足",
    "option.dte": "DTE不足",
    "option.openInterest": "オプション建玉残高不足",
    "option.spreadRate": "スプレッド率不足",
    "option.strikePrice": "権利行使価格不足",
    "option.volume": "オプション出来高不足",
    "optionCandidates": "オプション候補不足",
    "optionCandidates.bidAsk": "オプションBid/Ask不足",
    "optionCandidates.call": "Call候補不足",
    "optionCandidates.iv": "IV不足",
    "optionCandidates.ivGreeks": "IV/Greeks不足",
    "optionCandidates.openInterest": "オプション建玉残高不足",
    "optionCandidates.put": "Put候補不足",
    "optionCandidates.usableBidAsk": "利用可能なBid/Ask不足",
    "optionCandidates.volume": "オプション出来高不足",
    "optionChainQuality.hasOptionChain": "オプションチェーン未取得",
    "optionContracts.delta": "Delta不足",
    priceAsOf: "株価時点不足",
    "put.openInterest": "Put建玉残高不足",
    "signalEvents.ma25_50_golden_cross": "25日/50日線のゴールデンクロス確認不足",
    strategy: "戦略不足",
    "syntheticForward.sameExpiry": "同一満期の確認不足",
    symbol: "銘柄不足",
    "technicalSnapshot.dailyClose": "日足終値不足",
    "technicalSnapshot.minimum": "最低限のテクニカル情報不足",
    "technicalSnapshot.movingAverageSlopes.ma50": "50日線傾き不足",
    "technicalSnapshot.signalEvents": "シグナルイベント不足",
    "technicalSnapshot.signalEvents.macd_golden_cross": "MACDゴールデンクロス確認不足",
    "technicalSnapshot.signalEvents.slowkd_golden_cross": "SlowKDゴールデンクロス確認不足",
    underlyingPrice: "原資産価格不足",
  },
  movingAverageSlope: { down: "下向き", flat: "横ばい", unknown: "未確認", up: "上向き" },
  optionType: { call: "Call", put: "Put" },
  positionDraftStatus: { draft_ready: "建玉案レビュー可", manual_review_required: "手動確認", not_ready: "未準備" },
  precisionLevel: { blocked: "避ける", insufficient_data: "データ不足", pass: "通過", watch: "確認" },
  priorityBand: { avoid: "候補外", insufficient_data: "データ不足", manual_review: "手動確認", primary_watch: "確認優先", secondary_watch: "次点" },
  publicFitLevel: { avoid: "候補外", fit: "候補", insufficient_data: "データ不足", manual_review_required: "手動確認", watch: "監視" },
  reviewStatus: { blocked: "反映不可", needs_data: "データ不足", not_reviewed: "確認未完了", ready_for_manual_transfer: "入力候補として確認済み" },
  scoreItem: { capital: "資金", chart: "チャート", complete: "データ充足", option: "オプション", stock: "株式品質", strategy: "戦略" },
  strategy: strategyLabels,
  technicalSignal: {
    bearish: "弱気",
    bullish: "強気",
    dead_cross: "デッドクロス",
    golden_cross: "ゴールデンクロス",
    ma25_50_golden_cross: "25/50日線ゴールデンクロス",
    macd_golden_cross: "MACDゴールデンクロス",
    neutral: "中立",
    normal: "通常",
    slowkd_golden_cross: "SlowKDゴールデンクロス",
    unknown: "未確認",
    watch: "監視",
  },
  timeframe: { daily: "日足", intraday: "日中足", monthly: "月足", weekly: "週足" },
};

function compactCode(value: string): string {
  const withSpaces = value.replace(/[_./-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return withSpaces || value;
}

function fallbackLabel(value: string): string {
  return `未対応項目（${compactCode(value)}）`;
}

const inlineCodeLabels: Record<string, string> = {
  assignment_capital_shortage: "割当資金不足",
  bearish_breakdown: "弱気下抜け",
  bullish_continuation: "上昇継続",
  capital_shortage: "資金不足",
  downtrend: "下落トレンド",
  event_risk: "イベント注意",
  last_only: "Lastのみ",
  liquidity_shortage: "流動性不足",
  ma25_50_golden_cross: "25/50日線ゴールデンクロス",
  macd_golden_cross: "MACDゴールデンクロス",
  naked_call_risk: "裸コールリスク",
  option_bid_ask_missing: "オプションBid/Ask不足",
  range_neutral: "レンジ・中立",
  slowkd_golden_cross: "SlowKDゴールデンクロス",
  upside_reversal: "上昇転換",
};

function replaceInlineCodes(item: string): string {
  return item.replace(/\b[a-z][a-z0-9_./-]*\b/gu, (code) => {
    if (labelsByKind.missingField[code]) return labelsByKind.missingField[code];
    if (inlineCodeLabels[code]) return inlineCodeLabels[code];
    return code;
  });
}

export function screeningDisplayLabel(kind: ScreeningDisplayKind, value?: string): string {
  if (!value) return "-";
  return labelsByKind[kind]?.[value] ?? fallbackLabel(value);
}

export function screeningFieldLabel(field: string): string {
  return fieldLabels[field] ?? listTitleLabels[field] ?? labelsByKind.missingField[field] ?? fallbackLabel(field);
}

export function screeningListTitle(title: string): string {
  return listTitleLabels[title] ?? screeningFieldLabel(title);
}

export function screeningMissingFieldLabel(field: string): string {
  return labelsByKind.missingField[field] ?? fallbackLabel(field);
}

export function screeningStrategyLabel(strategy?: string): string {
  return strategy ? screeningDisplayLabel("strategy", strategy) : "-";
}

export function screeningDisplayValue(fieldOrKind: string, value: unknown): string {
  if (typeof value === "boolean") return value ? "確認済み" : "未確認";
  if (typeof value === "number" && Number.isFinite(value)) return Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
  if (typeof value !== "string" || !value.trim()) return "-";
  const text = value.trim();
  const kind = fieldOrKind as ScreeningDisplayKind;
  if (kind in labelsByKind) return screeningDisplayLabel(kind, text);
  if (fieldOrKind === "level") return screeningDisplayLabel("completeness", text);
  if (fieldOrKind === "regime" || fieldOrKind === "chartRegime") return screeningDisplayLabel("chartRegime", text);
  if (fieldOrKind === "confidence") return screeningDisplayLabel("chartConfidence", text);
  if (fieldOrKind === "primary" || fieldOrKind === "timeframe") return screeningDisplayLabel("timeframe", text);
  if (fieldOrKind === "dataSource" || fieldOrKind === "source") return screeningDisplayLabel("dataSource", text);
  if (fieldOrKind === "delayStatus") return screeningDisplayLabel("delayStatus", text);
  if (fieldOrKind === "strategy") return screeningDisplayLabel("strategy", text);
  if (fieldOrKind === "capitalQuality") return screeningDisplayLabel("capitalQuality", text);
  if (fieldOrKind.includes("slope")) return screeningDisplayLabel("movingAverageSlope", text);
  if (["MACD", "SlowKD", "strength"].includes(fieldOrKind)) return screeningDisplayLabel("technicalSignal", text);
  return text;
}

export function screeningDisplayItems(kind: string, items?: string[]): string[] {
  if (!items?.length) return [];
  const normalizedKind = kind === "warnings / riskFlags" ? "warnings" : kind;
  return items.map((item) => {
    if (normalizedKind === "missingFields") return screeningMissingFieldLabel(item);
    if (normalizedKind === "nextDataNeeded" || normalizedKind === "blockers") {
      const replaced = item.replace(/^(チャート|戦略|建玉案):\s*(.+)$/u, (_, prefix: string, field: string) => `${prefix}: ${screeningMissingFieldLabel(field)}`);
      return replaced === item && labelsByKind.missingField[item] ? screeningMissingFieldLabel(item) : replaceInlineCodes(replaced);
    }
    if (normalizedKind === "riskFlags") return labelsByKind.missingField[item] ?? inlineCodeLabels[item] ?? replaceInlineCodes(item);
    return replaceInlineCodes(item);
  });
}
