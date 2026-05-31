export type StrategyType =
  | "covered_call"
  | "short_put"
  | "covered_call_plus_short_put"
  | "wheel"
  | "short_strangle"
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
  marginRequirement: number;
  marginUsagePercent: number;
  accountValue?: number;
  updatedAt: string;
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
  latestCloseDate?: string;
  orderType?: "limit" | "market" | "stop" | "stop_limit";
  commissionUSD?: number;
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
  hedgeBuyStopUSD?: number;
  marketPriceUSD?: number;
  unrealizedPnlJPY?: number;
  theta?: number;
  brokerSymbol?: string;
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

export type BrokerFixtureMeta = {
  source: "demo" | "live";
  isRealMoney: boolean;
  broker: "SaxoBank";
  purpose: "development-fixture";
  createdAt: string;
  notes: string;
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
  taxProfileId: TaxProfileId;
  nisaExpectedAnnualReturnPct?: number;
  brokerCommissionUSD?: number;
  brokerCommissionJPY?: number;
  exchangeFeesJPY?: number;
  fxConversionCostJPY?: number;
  carryingCostJPY?: number;
  stockSettlement?: StockSettlement;
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
};

export type RiskWarning = {
  id: string;
  severity: RiskSeverity;
  title: string;
  message: string;
  blocking?: boolean;
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
  usdPnl?: number;
  sharesChange?: number;
  phaseAfter: WheelPhase;
  linkedSimulationId?: string;
  linkedTransferId?: string;
};
