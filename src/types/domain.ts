export type StrategyType =
  | "covered_call"
  | "short_put"
  | "covered_call_plus_short_put"
  | "wheel"
  | "short_strangle"
  | "long_call"
  | "long_put"
  | "custom";

export type DenominatorMode =
  | "broker_margin_only"
  | "stock_plus_ticket_margin"
  | "stock_plus_margin"
  | "cash_secured"
  | "conservative_common"
  | "custom";

export type PutIntent =
  | "accept_assignment"
  | "avoid_assignment"
  | "want_to_buy"
  | "can_buy"
  | "do_not_want_to_buy"
  | "cannot_buy";
export type OptionType = "call" | "put";
export type OptionSide = "sell" | "buy";
export type SimulationStatus = "planned" | "open" | "closed" | "assigned" | "expired";
export type DataSource = "manual" | "saxo_api" | "imported_csv" | "calculated" | "demo_fixture";
export type RiskSeverity = "info" | "warning" | "danger";
export type SaxoAccountCode = "P" | "N";
export type Currency = "JPY" | "USD";
export type AccountEnvironment =
  | "DEMO_JPY_BASE"
  | "PROD_P_JPY_SETTLEMENT"
  | "PROD_N_USD_SETTLEMENT";

export type JournalAccountCode = SaxoAccountCode | "DEMO" | "UNKNOWN";
export type EntryRationaleJournalStatus = "candidate" | "planned" | "entered" | "watching" | "closed";
export type ChartEvidenceSource = "moomoo" | "Saxo" | "TradingView" | "manual" | "other";
export type ChartEvidenceTimeframe = "daily" | "weekly" | "monthly" | "other";
export type EntryRationaleReviewOutcome = "not_reviewed" | "as_expected" | "partly_expected" | "unexpected";

export type ChartEvidence = {
  id: string;
  source: ChartEvidenceSource;
  timeframe: ChartEvidenceTimeframe;
  capturedAt: string;
  memo: string;
  imageRef: string;
  thumbnailRef?: string;
};

export type EntryRationaleJournal = {
  id: string;
  candidateId?: string;
  positionId?: string;
  symbol: string;
  underlyingName?: string;
  strategy: StrategyType;
  accountCode?: JournalAccountCode;
  status: EntryRationaleJournalStatus;
  entryDate?: string;
  createdAt: string;
  updatedAt: string;
  entryReason: string;
  technicalTags: string[];
  technicalMemo?: string;
  expectedScenario?: string;
  profitTakingPlan?: string;
  stopLossPlan?: string;
  invalidationCondition?: string;
  chartEvidence: ChartEvidence[];
  review?: {
    closedAt?: string;
    outcome: EntryRationaleReviewOutcome;
    resultMemo?: string;
    lesson?: string;
  };
};

export type WorkflowTaskType =
  | "confirm_entry_execution"
  | "enter_close_execution"
  | "confirm_expiry"
  | "enter_stock_acquisition"
  | "enter_stock_settlement"
  | "review_close_decision"
  | "complete";

export type WorkflowTask = {
  id: string;
  simulationId: string;
  type: WorkflowTaskType;
  severity: RiskSeverity;
  label: string;
  detail: string;
  actionLabel: string;
  targetAnchor:
    | "option-entry-executions"
    | "option-close-executions"
    | "stock-acquisition"
    | "stock-settlement"
    | "close-decision"
    | "simulation-editor";
  focusField?: string;
};

export type BrokerAccount = {
  id: string;
  broker: "SAXO_BANK_JP";
  accountCode: SaxoAccountCode;
  displayName: string;
  baseCurrency: Currency;
  settlementCurrency: Currency;
  productType: "FOREIGN_STOCK_INDEX_OPTIONS";
};

export type AccountState = {
  accountCode: SaxoAccountCode;
  accountEnvironment?: AccountEnvironment;
  currency: Currency;
  cashBalance: number;
  buyingPower?: number;
  marginAvailable: number;
  marginRequirement?: number;
  marginUsagePercent: number;
  accountValue?: number;
  updatedAt: string;
  cashAdjustments?: AccountCashAdjustment[];
  saxoSyncHistory?: SaxoAccountSyncHistory[];
};

export type SaxoAccountSyncHistory = {
  id: string;
  source: "saxo_api";
  accountKey: string;
  accountId?: string;
  displayName?: string;
  fetchedAt: string;
  appliedAt: string;
  appliedFields: string[];
};

export type AccountCashAdjustment = {
  id: string;
  sourceType: "option_close_execution";
  sourceSimulationId: string;
  sourceExecutionId: string;
  accountCode: SaxoAccountCode;
  currency: Currency;
  amount: number;
  label: string;
  appliedAt: string;
  memo?: string;
};

export type StockPosition = {
  shares: number;
  averageCostUSD: number;
  denominatorPriceMode: "current_price" | "average_cost" | "custom";
  customDenominatorPriceUSD?: number;
  canSellAtStrike?: boolean;
};

export type ClosePlan = {
  enabled: boolean;
  closePriceUSD?: number;
  profitTargetPriceUSD?: number;
  stopLossPriceUSD?: number;
  latestCloseDate?: string;
  orderType?: "limit" | "market" | "stop" | "stop_limit";
  commissionUSD?: number;
};

export type OptionValueSnapshotSource = "manual" | "saxo" | "moomoo";

export type OptionValueSnapshot = {
  snapshotDate: string;
  underlyingPrice: number;
  optionExitPrice: number;
  strike: number;
  expiry: string;
  dte: number;
  intrinsicValue: number;
  timeValue: number;
  timeValueRatio: number;
  source: OptionValueSnapshotSource;
};

export type OptionLeg = {
  id: string;
  type: OptionType;
  side: OptionSide;
  strikeUSD: number;
  premiumUSD: number;
  quantity: number;
  expiryDate: string;
  isCovered?: boolean;
  putIntent?: PutIntent;
  closeCostUSD?: number;
  closePlan?: ClosePlan;
  assignmentPolicy?: "accept" | "avoid" | "unknown";
  callExitIntent?: "covered_can_sell" | "covered_keep_stock" | "naked_buyback";
  hedgeBuyStopUSD?: number;
  nakedCallRiskAcknowledged?: boolean;
  marketPriceUSD?: number;
  unrealizedPnlJPY?: number;
  theta?: number;
  brokerSymbol?: string;
  valueSnapshots?: OptionValueSnapshot[];
};

export type ProfitTakeRule = {
  enabled: boolean;
  targetPremiumKeepPercent: 50 | 60 | 80 | number;
  latestCloseDaysBeforeExpiry?: number;
};

export type StopLossRule = {
  enabled: boolean;
  type: "option_buyback_price" | "stock_price_line" | "loss_amount_jpy";
  value: number;
};

export type ExitOrderPlanMode =
  | "manual_only"
  | "after_entry_closing_order"
  | "attached_entry_exit_order";

export type ExitBrokerOrderType =
  | "none"
  | "closing_limit"
  | "closing_stop"
  | "oco"
  | "ifd"
  | "ifd_oco";

export type ExitStopLossType = "buyback_price" | "stock_price_line" | "loss_amount";

export type ExitOrderPlan = {
  scope: "position" | "leg";
  legId?: string;
  mode: ExitOrderPlanMode;
  brokerOrderType?: ExitBrokerOrderType;
  profitTakeEnabled: boolean;
  profitTakePremiumKeepPercent?: number;
  profitTakeBuybackPriceUSD?: number;
  stopLossEnabled: boolean;
  stopLossType?: ExitStopLossType;
  stopLossBuybackPriceUSD?: number;
  stopLossStockPriceUSD?: number;
  stopLossAmountJPY?: number;
  stopLossAmountUSD?: number;
  stopLossAmountCurrency?: Currency;
  latestCloseDaysBeforeExpiry?: number;
  latestCloseDaysBeforeExpiryUserSet?: boolean;
  memo?: string;
};

export type BrokerFixtureMeta = {
  source: "demo" | "live";
  isRealMoney: boolean;
  broker: "SaxoBank";
  purpose: "development-fixture";
  createdAt: string;
  notes: string;
  saxoAccountKey?: string;
  saxoPositionId?: string;
  saxoInstrumentCode?: string;
  saxoUic?: number;
};

export type StockSettlement = {
  enabled: boolean;
  kind: "manual_sale" | "covered_call_assignment" | "other";
  settlementDate: string;
  shares: number;
  sellPriceUSD: number;
  costBasisUSD: number;
  fxRateJPY?: number;
  commissionUSD?: number;
  commissionJPY?: number;
  memo?: string;
};

export type StockAcquisition = {
  enabled: boolean;
  acquisitionDate: string;
  shares: number;
  priceUSD: number;
  accountEnvironment: AccountEnvironment;
  commissionUSD?: number;
  commissionJPY?: number;
  source: "manual" | "broker_statement" | "saxo_api_estimate" | "saxo_history";
  sourceCandidateId?: string;
  sourceTradeId?: string;
  sourceStockCandidateId?: string;
  confirmationStatus?: "pending" | "confirmed" | "ignored" | "invalid";
  memo?: string;
};

export type BrokerSettlement = {
  source: "manual" | "broker_statement" | "saxo_api_estimate";
  tradeCurrency: "USD";
  settlementCurrency: Currency;
  grossPremiumUSD: number;
  commissionUSD?: number;
  commissionJPY?: number;
  exchangeFeeUSD?: number;
  exchangeFeeJPY?: number;
  appliedFxRate?: number;
  netCashflowUSD?: number;
  netCashflowJPY?: number;
};

export type OptionCloseExecution = {
  id: string;
  legId: string;
  closeKind?: "buyback" | "expired";
  confirmed: boolean;
  closeDate: string;
  closeTime?: string;
  orderId?: string;
  positionId?: string;
  contracts: number;
  closePriceUSD?: number;
  commissionUSD?: number;
  commissionJPY?: number;
  fxRateJPY?: number;
  settlementCurrency: Currency;
  brokerBookedAmountJPY?: number;
  brokerRealizedPnlJPY?: number;
  brokerTransactionCostJPY?: number;
  brokerPremiumJPY?: number;
  brokerFeeJPY?: number;
  brokerExchangeFeeJPY?: number;
  brokerExchangeRateJPY?: number;
  brokerExchangeTradeFeeJPY?: number;
  brokerTaxIncludedFeeJPY?: number;
  realizedPnlUSD?: number;
  inputMode?: "P_JPY_BROKER_STATEMENT" | "USD_EXECUTION_CALC";
  source: "manual" | "broker_statement" | "saxo_api_estimate" | "saxo_history";
  sourceCandidateId?: string;
  sourceTradeId?: string;
  targetPositionId?: string;
  confirmationStatus?: "pending" | "confirmed" | "ignored" | "invalid";
  invalidReason?: string;
  memo?: string;
};

export type OptionEntryExecution = {
  id: string;
  legId: string;
  tradeDate: string;
  contracts: number;
  fillPriceUSD: number;
  settlementCurrency: Currency;
  brokerBookedAmountJPY?: number;
  brokerPremiumJPY?: number;
  brokerTransactionCostJPY?: number;
  brokerFeeJPY?: number;
  brokerExchangeFeeJPY?: number;
  brokerExchangeRateJPY?: number;
  brokerTaxIncludedFeeJPY?: number;
  commissionUSD?: number;
  commissionJPY?: number;
  referenceFxRateJPY?: number;
  inputMode?: "P_JPY_BROKER_STATEMENT" | "USD_EXECUTION_CALC";
  source: "manual" | "broker_statement" | "saxo_api_estimate";
  saxoSourceType?: "current_position" | "history";
  historyCompletionStatus?: "unmatched" | "matched" | "multiple" | "manual";
  historyCandidateIds?: string[];
  confirmed: boolean;
  memo?: string;
};

export type TradeSimulation = {
  id: string;
  status: SimulationStatus;
  name: string;
  ticker: string;
  underlyingName?: string;
  strategyType: StrategyType;
  currentPriceUSD: number;
  fxRateJPY: number;
  accountCode: SaxoAccountCode;
  accountEnvironment: AccountEnvironment;
  entryDate: string;
  expiryDate: string;
  dte: number;
  accountCurrency: Currency;
  referenceFxRateJPY?: number;
  brokerSettlement?: BrokerSettlement;
  stockPosition: StockPosition | null;
  optionLegs: OptionLeg[];
  brokerMarginJPY: number;
  brokerMarginUSD?: number;
  marginBufferMultiplier: number;
  marginUsagePercent?: number;
  availableCashJPY?: number;
  denominatorMode: DenominatorMode;
  customDenominatorJPY?: number;
  profitTakeRule?: ProfitTakeRule;
  stopLossRule?: StopLossRule;
  exitOrderPlans?: ExitOrderPlan[];
  exitOrderPlan?: ExitOrderPlan;
  optionEntryExecutions?: OptionEntryExecution[];
  optionCloseExecutions?: OptionCloseExecution[];
  taxProfileId: TaxProfileId;
  nisaExpectedAnnualReturnPct?: number;
  brokerCommissionUSD?: number;
  brokerCommissionJPY?: number;
  exchangeFeesJPY?: number;
  fxConversionCostJPY?: number;
  carryingCostJPY?: number;
  stockAcquisition?: StockAcquisition;
  stockSettlement?: StockSettlement;
  entryRationaleJournal?: EntryRationaleJournal;
  beginnerMode?: boolean;
  preOrderChecklist?: Record<string, boolean>;
  fixtureMeta?: BrokerFixtureMeta;
  notes?: string;
};

export type DenominatorResult = {
  mode: DenominatorMode;
  label: string;
  currency: Currency;
  amountJPY: number;
  amountUSD?: number;
  annualReturnPct: number;
  netAnnualReturnPct?: number;
  isPrimary: boolean;
  explanation: string;
  components: Array<{ label: string; amountJPY: number; amountUSD?: number }>;
};

export type ScenarioResult = {
  id: string;
  title: string;
  stockPriceCondition: string;
  premiumJPY: number;
  stockChange: string;
  realizedPnlJPY?: number;
  nextAction: string;
  notes: string[];
};

export type PayoffPoint = {
  stockPriceUSD: number;
  pnlJPY: number;
  profitJPY?: number;
  lossJPY?: number;
};

export type PayoffBreakeven = {
  priceUSD: number;
  label: string;
};

export type PayoffSummary = {
  breakevens: PayoffBreakeven[];
  secondaryBreakevens?: PayoffBreakeven[];
  maxLossLabel: string;
  maxLossTitle?: string;
  maxLossNote?: string;
  maxProfitLabel: string;
  displayModeLabel?: string;
  displayModeOptions?: string[];
  hasLongOption: boolean;
  formulas: string[];
};

export type PayoffDisplayMode = "practical" | "theoretical" | "option_only" | "opportunity";

export type RiskWarning = {
  id: string;
  severity: RiskSeverity;
  title: string;
  message: string;
  blocking?: boolean;
  actionLabel?: string;
  actionSimulationId?: string;
  actionAnchorId?: string;
  actionWheelCycleId?: string;
  actionLegId?: string;
  actionLegType?: OptionType;
};

export type ChecklistItem = {
  id: string;
  label: string;
  passed: boolean;
  blocking?: boolean;
};

export type TaxProfileId =
  | "none_nisa_or_tax_free_comparison"
  | "japan_listed_stock_default_20_315"
  | "japan_derivative_separate_tax_user_confirm"
  | "custom";

export type TaxProfile = {
  id: TaxProfileId;
  name: string;
  description: string;
  enabled: boolean;
  taxRatePct: number;
  applyTo: Array<"option_premium" | "option_close" | "stock_capital_gain" | "dividend" | "fx_gain_loss">;
  allowLossOffset: boolean;
  allowCarryForward: boolean;
  carryForwardYears?: number;
  notes: string;
  requiresUserConfirmation: boolean;
};

export type TaxResult = {
  grossProfitJPY: number;
  feeAdjustedProfitJPY: number;
  taxableProfitJPY: number;
  taxJPY: number;
  netProfitJPY: number;
  grossAnnualReturnPct: number;
  netAnnualReturnPct: number;
  netMonthlyReturnPct: number;
  requiresUserConfirmation: boolean;
};

export type StockSettlementTaxResult = {
  enabled: boolean;
  grossProceedsJPY: number;
  costBasisJPY: number;
  feesJPY: number;
  realizedGainJPY: number;
  taxableProfitJPY: number;
  estimatedTaxJPY: number;
  afterTaxGainJPY: number;
  holdingDays: number;
  annualReturnPct: number;
  taxRatePct: number;
};

export type TaxBucketSummary = {
  optionProfitJPY: number;
  optionCapitalDaysJPY: number;
  optionAnnualReturnPct: number;
  optionCloseMissingCount: number;
  stockRealizedGainJPY: number;
  stockCapitalDaysJPY: number;
  stockAnnualReturnPct: number;
  optionCount: number;
  stockSettlementCount: number;
};

export type NisaComparison = {
  expectedAnnualReturnPct: number;
  comparisonProfitJPY: number;
  netAdvantageJPY: number;
  requiredGrossProfitToBeatJPY: number;
  requiredGrossAnnualReturnPct: number;
};

export type WheelCycle = {
  id: string;
  ticker: string;
  primaryAccountCode: "N";
  currentPhase: WheelPhase;
  currentAccountCode: SaxoAccountCode;
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

export type WheelPhase =
  | "n_cash"
  | "n_short_put"
  | "n_stock_holding"
  | "n_covered_call"
  | "n_called_away"
  | "p_short_put"
  | "p_assigned_stock"
  | "p_to_n_transfer_pending"
  | "cycle_closed";

export type FxTransferEvent = {
  id: string;
  direction: "JPY_TO_USD" | "USD_TO_JPY";
  fromAccountCode: SaxoAccountCode | "OTHER_JPY" | "OTHER_USD";
  toAccountCode: SaxoAccountCode | "OTHER_JPY" | "OTHER_USD";
  fromCurrency: Currency;
  toCurrency: Currency;
  fromAmount: number;
  toAmount: number;
  appliedFxRate: number;
  fxCostRate?: number;
  occurredAt: string;
  source: "manual" | "broker_statement" | "app_estimate";
};

export type StockTransferEvent = {
  id: string;
  ticker: string;
  fromAccountCode: SaxoAccountCode;
  toAccountCode: SaxoAccountCode;
  shares: number;
  transferDate: string;
  costBasisUSD: number;
  sourceSimulationId?: string;
  destinationWheelCycleId?: string;
  memo?: string;
};

export type WheelEvent = {
  id: string;
  wheelCycleId: string;
  type:
    | "short_put_opened"
    | "short_put_closed"
    | "put_assigned"
    | "stock_transfer"
    | "stock_purchase"
    | "covered_call_opened"
    | "covered_call_closed"
    | "call_assigned"
    | "stock_sold"
    | "fx_transfer"
    | "manual_adjustment";
  occurredAt: string;
  accountCode: SaxoAccountCode;
  description: string;
  feeUSD?: number;
  usdPnl?: number;
  sharesChange?: number;
  phaseAfter: WheelPhase;
  linkedSimulationId?: string;
  linkedTransferId?: string;
};
