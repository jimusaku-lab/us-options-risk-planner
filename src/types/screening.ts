export type StrategyCandidateKind =
  | "cash_secured_put_buy_to_own"
  | "cash_secured_put_avoid_assignment"
  | "covered_call"
  | "long_call"
  | "short_strangle"
  | "synthetic_forward"
  | "combo";

export type ScreeningDataSource = "manual" | "csv" | "json" | "tradingview" | "moomoo" | "saxo" | "calculated";
export type ScreeningDelayStatus = "real_time" | "delayed" | "end_of_day" | "unknown";
export type TechnicalSignal = "bullish" | "bearish" | "neutral" | "golden_cross" | "dead_cross" | "watch" | "unknown";
export type StrategyFitLevel = "fit" | "watch" | "avoid" | "insufficient_data";
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
