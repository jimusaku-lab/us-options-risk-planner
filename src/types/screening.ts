export type StrategyCandidateKind =
  | "cash_secured_put_buy_to_own"
  | "cash_secured_put_avoid_assignment"
  | "covered_call"
  | "long_call"
  | "wheel"
  | "short_strangle"
  | "short_strangle_covered"
  | "short_strangle_advanced_review"
  | "synthetic_forward"
  | "combo"
  | "itm_short_put_buy_to_own"
  | "long_straddle_event"
  | "protective_collar";

export type ScreeningDataSource = "manual" | "csv" | "json" | "tradingview" | "moomoo" | "saxo" | "calculated";
export type ScreeningDelayStatus = "real_time" | "delayed" | "end_of_day" | "unknown";
export type TechnicalSignal = "bullish" | "bearish" | "neutral" | "golden_cross" | "dead_cross" | "watch" | "unknown";
export type StrategyFitLevel = "fit" | "watch" | "avoid" | "insufficient_data";
export type PublicStrategyFitLevel = StrategyFitLevel | "manual_review_required";
export type ChartRegime =
  | "bullish_continuation"
  | "upside_reversal"
  | "bullish_pullback"
  | "range_neutral"
  | "bearish_breakdown"
  | "downtrend"
  | "downtrend_rebound"
  | "event_large_move_unknown"
  | "insufficient_data";
export type ChartConfidence = "high" | "medium" | "low" | "insufficient";
export type ChartTimeframe = "monthly" | "weekly" | "daily";
export type PositionDraftStatus = "not_ready" | "manual_review_required" | "draft_ready";
export type ScreeningCompletenessLevel =
  | "insufficient"
  | "level_1_symbol_price"
  | "level_2_chart_ready"
  | "level_3_option_ready"
  | "level_4_draft_ready";
export type TechnicalSignalEventType =
  | "slowkd_golden_cross"
  | "macd_golden_cross"
  | "ma25_50_golden_cross"
  | "price_above_ma25"
  | "price_above_ma50"
  | "ma_slope_up";
export type TechnicalSignalStrength = "weak" | "normal" | "strong";
export type TechnicalTimingPatternKind = "upside_reversal_combo";
export type MovingAverageSlopeState = "up" | "flat" | "down" | "unknown";
export type OptionComboMode = "school_same_expiry" | "practical_split_expiry";
export type SyntheticForwardLegType = "long_call" | "short_put";
export type SyntheticForwardRiskFlag =
  | "directional_bias_weak"
  | "liquidity_attention"
  | "liquidity_too_low"
  | "assignment_capital_shortage"
  | "long_term_hold_not_eligible"
  | "long_put_risk_window"
  | "event_risk_attention";

export type TechnicalSnapshot = {
  dailyClose?: number;
  sma5?: number;
  sma10?: number;
  sma25?: number;
  sma50?: number;
  sma75?: number;
  sma100?: number;
  sma200?: number;
  weeklySma13?: number;
  weeklySma26?: number;
  weeklySma52?: number;
  macdSignal?: TechnicalSignal;
  slowKdSignal?: TechnicalSignal;
  rsi?: number;
  trendNotes: string[];
  signalEvents?: TechnicalSignalEvent[];
  patternCandidates?: TechnicalTimingPattern[];
  movingAverageSlopes?: Partial<MovingAverageSlopes>;
};

export type OhlcvBar = {
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
};

export type ChartTimeframeSnapshot = {
  timeframe: ChartTimeframe;
  close?: number;
  sma5?: number;
  sma10?: number;
  sma20?: number;
  sma13?: number;
  sma25?: number;
  sma26?: number;
  sma50?: number;
  sma52?: number;
  sma75?: number;
  sma100?: number;
  sma200?: number;
  macdSignal?: TechnicalSignal;
  slowKdSignal?: TechnicalSignal;
  rsi?: number;
  macd?: {
    macd?: number;
    signal?: number;
    histogram?: number;
  };
  slowKd?: {
    k?: number;
    d?: number;
  };
  movingAverageSlopes?: Partial<MovingAverageSlopes>;
  priceLocation?: PriceLocation;
  recentHigh?: number;
  recentLow?: number;
  supportLevels?: number[];
  resistanceLevels?: number[];
  fibonacciLevels?: {
    high?: number;
    low?: number;
    retracement382?: number;
    retracement500?: number;
    retracement618?: number;
  };
  ohlcv?: OhlcvBar[];
  notes?: string[];
};

export type ChartAnalysisSnapshot = {
  asOf?: string;
  regime: ChartRegime;
  confidence: ChartConfidence;
  primaryTimeframe: ChartTimeframe;
  timeframes: ChartTimeframeSnapshot[];
  reasons: string[];
  warnings: string[];
  missingFields: string[];
};

export type TechnicalSignalEvent = {
  type: TechnicalSignalEventType;
  occurredAt: string;
  lookbackTradingDays: number;
  strength: TechnicalSignalStrength;
  notes?: string;
};

export type MovingAverageSlopes = {
  ma25: MovingAverageSlopeState;
  ma50: MovingAverageSlopeState;
  ma200: MovingAverageSlopeState;
};

export type PriceLocation = {
  aboveMa25?: boolean;
  aboveMa50?: boolean;
  aboveMa200?: boolean;
  distanceFromMa25Pct?: number;
  distanceFromMa50Pct?: number;
};

export type OptionComboReadiness = {
  modes: OptionComboMode[];
  longCallReady?: boolean;
  buyToOwnPutReady?: boolean;
  longTermHoldEligible?: boolean;
  assignmentCapitalSufficient?: boolean;
  liquidityOk?: boolean;
  eventRiskOk?: boolean;
  notes: string[];
};

export type UpsideReversalComboTiming = {
  slowKdCrossDate?: string;
  macdCrossDate?: string;
  ma25Ma50CrossDate?: string;
  ma25Ma50DistancePct?: number;
  movingAverageSlopes: MovingAverageSlopes;
  priceLocation: PriceLocation;
  optionComboReadiness: OptionComboReadiness;
  timingNotes: string[];
};

export type TechnicalTimingPattern = {
  kind: TechnicalTimingPatternKind;
  fitLevel: StrategyFitLevel;
  signalOrder: TechnicalSignalEventType[];
  reasons: string[];
  warnings: string[];
  missingFields: string[];
  suggestedStrategyKinds: StrategyCandidateKind[];
  detectedAt: string;
  timing: UpsideReversalComboTiming;
};

export type OptionChainQuality = {
  hasOptionChain: boolean;
  expirationCount?: number;
  targetDteAvailable?: boolean;
  bidAskSpreadRate?: number;
  volume?: number;
  openInterest?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  qualityWarnings: string[];
};

export type StrategyCandidateInput = {
  strategy: StrategyCandidateKind;
  dte?: number;
  strikePrice?: number;
  premium?: number;
  stockShares?: number;
  stockCostBasis?: number;
  longTermHoldEligible?: boolean;
  coveredCallTransitionPossible?: boolean;
  profitTakeRuleSet?: boolean;
  stopLossRuleSet?: boolean;
  latestCloseDateSet?: boolean;
  sameAccount?: boolean;
  sameExpiry?: boolean;
  assignmentCapitalRequired?: number;
  availableCash?: number;
};

export type ScreeningCandidate = {
  symbol: string;
  name?: string;
  market: string;
  sector?: string;
  underlyingPrice?: number;
  priceAsOf?: string;
  dataSource: ScreeningDataSource;
  delayStatus: ScreeningDelayStatus;
  technicalSnapshot: TechnicalSnapshot;
  optionChainQuality: OptionChainQuality;
  candidateStrategies: StrategyCandidateInput[];
  riskFlags: string[];
  missingFields: string[];
};

export type NumericCheck = {
  id: string;
  label: string;
  value?: number;
  min?: number;
  max?: number;
  passed: boolean;
};

export type RequiredCheck = {
  id: string;
  label: string;
  passed?: boolean;
};

export type StrategyFitResult = {
  strategy: StrategyCandidateKind;
  fitLevel: StrategyFitLevel;
  reasons: string[];
  warnings: string[];
  missingFields: string[];
  requiredChecks: RequiredCheck[];
  numericChecks: NumericCheck[];
};

export type StrategySuitability = {
  strategy: StrategyCandidateKind;
  level: PublicStrategyFitLevel;
  chartRegime?: ChartRegime;
  confidence?: ChartConfidence;
  reasons: string[];
  warnings: string[];
  missingFields: string[];
  manualReviewReasons?: string[];
  nextChecks: string[];
};

export type SyntheticForwardLeg = {
  type: SyntheticForwardLegType;
  expiry: string;
  dte?: number;
  strikePrice: number;
  bid?: number;
  ask?: number;
  mid?: number;
  volume?: number;
  openInterest?: number;
  iv?: number;
  delta?: number;
  sourceId?: string;
};

export type PublicOptionCandidateInput = {
  id?: string;
  optionType: "call" | "put";
  expiry?: string;
  dte?: number;
  strike?: number;
  strikePrice?: number;
  bid?: number;
  ask?: number;
  mid?: number;
  last?: number;
  volume?: number;
  openInterest?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  source?: string;
};

export type OptionLegDraft = {
  id: string;
  optionType: "call" | "put";
  side: "buy" | "sell";
  expiry?: string;
  dte?: number;
  strikePrice?: number;
  conservativePrice?: number;
  conservativePriceField?: "bid" | "ask";
  mid?: number;
  last?: number;
  quantity?: number;
  liquidityWarnings: string[];
  missingFields: string[];
};

export type PositionDraftReviewChecklistId =
  | "chart_confirmed"
  | "strategy_confirmed"
  | "expiry_strike_confirmed"
  | "bid_ask_confirmed"
  | "liquidity_confirmed"
  | "capital_confirmed"
  | "max_loss_confirmed"
  | "assignment_confirmed"
  | "exit_rule_confirmed"
  | "saxo_ticket_confirmed";

export type PositionDraftReviewChecklistItem = {
  id: PositionDraftReviewChecklistId;
  label: string;
  required: boolean;
  checked: boolean;
  blockingIfUnchecked: boolean;
};

export type PositionDraftReviewState = {
  checklist: PositionDraftReviewChecklistItem[];
  reviewStatus: "not_reviewed" | "needs_data" | "ready_for_manual_transfer" | "blocked";
  transferWarnings: string[];
};

export type PositionDraftCapital = {
  premiumDebitUSD?: number;
  premiumCreditUSD?: number;
  requiredCapitalUSD?: number;
  maxLossUSD?: number;
  assignmentCapitalRequiredUSD?: number;
  stockNotionalUSD?: number;
  availableCashUSD?: number;
  buyingPowerUSD?: number;
  maxLossToleranceUSD?: number;
  saxoRequiredMarginUSD?: number;
  saxoMarginAvailableUSD?: number;
  cashBalanceUSD?: number;
  marginCashCoverageRatio?: number;
  marginUsageAfterEntryPct?: number;
  capitalQuality: "ok" | "watch" | "blocked" | "unknown";
};

export type PositionDraftExitPlan = {
  profitTakePrice?: number;
  stopLossPrice?: number;
  latestCloseDate?: string;
  expiryHandling?: string;
  notes: string[];
};

export type PositionDraft = {
  id: string;
  strategy: StrategyCandidateKind;
  status: PositionDraftStatus;
  symbol: string;
  legs: OptionLegDraft[];
  requiredCapitalUSD?: number;
  maxLossUSD?: number;
  availableCashUSD?: number;
  warnings: string[];
  missingFields: string[];
  capital?: PositionDraftCapital;
  exitPlan?: PositionDraftExitPlan;
  reviewState?: PositionDraftReviewState;
};

export type StrategyPrecisionReviewLevel = "pass" | "watch" | "blocked" | "insufficient_data";

export type StrategyPrecisionSubReview = {
  level: StrategyPrecisionReviewLevel;
  reasons: string[];
  warnings: string[];
};

export type StrategyPrecisionExpiryReview = StrategyPrecisionSubReview & {
  targetDteRange?: [number, number];
  actualDte?: number;
};

export type StrategyPrecisionStrikeReview = StrategyPrecisionSubReview & {
  targetStrikeRatioRange?: [number, number];
  actualStrikeRatio?: number;
};

export type StrategyPrecisionReview = {
  strategy: StrategyCandidateKind;
  level: PublicStrategyFitLevel;
  chartGate: StrategyPrecisionSubReview;
  expiryReview: StrategyPrecisionExpiryReview;
  strikeReview: StrategyPrecisionStrikeReview;
  liquidityReview: StrategyPrecisionSubReview;
  capitalReview: StrategyPrecisionSubReview;
  manualReviewReasons: string[];
  avoidReasons: string[];
  nextChecks: string[];
  checklist: string[];
};

export type AdvancedStrategyReview = {
  id: string;
  strategy: StrategyCandidateKind;
  level: PublicStrategyFitLevel;
  symbol: string;
  chartRegime?: ChartRegime;
  confidence?: ChartConfidence;
  legs: OptionLegDraft[];
  netPremiumUSD?: number;
  requiredCapitalUSD?: number;
  maxLossUSD?: number;
  stockEquivalentNotionalUSD?: number;
  breakEvenUpperUSD?: number;
  breakEvenLowerUSD?: number;
  effectiveAcquisitionCostUSD?: number;
  scenarios: string[];
  reasons: string[];
  warnings: string[];
  missingFields: string[];
  manualReviewReasons: string[];
};

export type PublicScreeningCandidateInput = {
  symbol: string;
  name?: string;
  market?: string;
  sector?: string;
  underlyingPrice?: number;
  priceAsOf?: string;
  delayStatus?: ScreeningDelayStatus;
  technicalSnapshot?: Partial<TechnicalSnapshot>;
  chartAnalysis?: ChartAnalysisSnapshot;
  dailyOhlcv?: OhlcvBar[];
  optionCandidates?: PublicOptionCandidateInput[];
  optionChainQuality?: Partial<OptionChainQuality>;
  candidateStrategies?: StrategyCandidateInput[];
  strategySuitability?: StrategySuitability[];
  capital?: {
    availableCashUSD?: number;
    buyingPowerUSD?: number;
    stockShares?: number;
    stockCostBasisUSD?: number;
    maxLossToleranceUSD?: number;
    assignmentCapitalAvailableUSD?: number;
    saxoRequiredMarginUSD?: number;
    saxoMarginAvailableUSD?: number;
    cashBalanceUSD?: number;
    allowAssignment?: boolean;
    allowStockCalledAway?: boolean;
    maxContracts?: number;
    exitRuleConfirmed?: boolean;
  };
  existingPosition?: {
    stockShares?: number;
    stockCostBasisUSD?: number;
  };
  event?: {
    earningsDate?: string;
    importantEventDate?: string;
    expectedMovePct?: number;
    historicalPostEventMovePct?: number;
  };
  positionDrafts?: PositionDraft[];
  advancedStrategyReviews?: AdvancedStrategyReview[];
  strategyPrecisionReviews?: StrategyPrecisionReview[];
  riskFlags?: string[];
  missingFields?: string[];
  warnings?: string[];
  notes?: string;
  rawSourceRow?: Record<string, unknown>;
};

export type PublicScreeningPackage = {
  schemaVersion: "us_options_screening_package.v1";
  generatedAt?: string;
  source: "manual" | "moomoo_user_export" | "tradingview_user_export" | "csv" | "json" | "calculated";
  dataPolicy: {
    userProvided: true;
    containsCredentials: false;
    redistributionChecked?: boolean;
    notes: string[];
  };
  candidates: PublicScreeningCandidateInput[];
};

export type ScreeningCompletenessResult = {
  level: ScreeningCompletenessLevel;
  canClassifyStrategy: boolean;
  canAnalyzeChart: boolean;
  canEvaluateOptionLiquidity: boolean;
  canCreatePositionDraft: boolean;
  missingFields: string[];
  warnings: string[];
};

export type SyntheticForwardCandidate = {
  kind: "synthetic_forward";
  expiry?: string;
  dte?: number;
  strike?: number;
  strikeToPriceRatio?: number;
  longCallLeg?: SyntheticForwardLeg;
  shortPutLeg?: SyntheticForwardLeg;
  netPremium?: number;
  syntheticDelta?: number;
  breakEvenPrice?: number;
  assignmentCapitalRequired?: number;
  assignmentCapitalAvailable?: number;
  stockEquivalentNotional?: number;
  capitalEfficiencyNotes: string[];
};

export type SyntheticForwardEvaluation = SyntheticForwardCandidate & {
  fitLevel: StrategyFitLevel;
  technicalBias: StrategyFitLevel;
  reasons: string[];
  warnings: string[];
  missingFields: string[];
  riskFlags: SyntheticForwardRiskFlag[];
};

export type ExternalReviewPayload = {
  generatedAt: string;
  appVersion: string;
  candidate: ScreeningCandidate;
  strategyFitResults: StrategyFitResult[];
  technicalTimingPatterns?: TechnicalTimingPattern[];
  syntheticForwardCandidates?: SyntheticForwardEvaluation[];
  userStrategyAssumptions: string[];
  dataQualityNotes: string[];
  noPersonalCredentialIncluded: true;
};
