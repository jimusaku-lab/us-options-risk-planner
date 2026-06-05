import type { CandidateSymbol } from "@/types/candidates";
import { DEFAULT_BROKER_COMMISSION_USD, type AppSettings, type WorkspaceMode } from "@/store/useOptionsStore";
import type { StrategyType, TradeSimulation } from "@/types/domain";
import { addLocalDays, formatLocalDate } from "@/lib/date";

function addDays(date: Date, days: number): string {
  return formatLocalDate(addLocalDays(date, days));
}

export function createSimulationFromCandidate(params: {
  candidate: CandidateSymbol;
  workspace: WorkspaceMode;
  settings: AppSettings;
  strategyType: Extract<StrategyType, "covered_call" | "short_put">;
  fxRateJPY?: number;
}): TradeSimulation {
  const today = new Date();
  const entryDate = formatLocalDate(today);
  const expiryDate = addDays(today, 45);
  const id = `${params.workspace}-candidate-${params.candidate.symbol}-${Date.now()}`;
  const isCoveredCall = params.strategyType === "covered_call";
  return {
    id,
    status: "planned",
    name: `${params.candidate.symbol} 候補建玉案`,
    ticker: params.candidate.symbol,
    underlyingName: params.candidate.company,
    strategyType: params.strategyType,
    currentPriceUSD: params.candidate.priceUSD ?? 0,
    fxRateJPY: params.fxRateJPY ?? 0,
    accountCode: "P",
    accountEnvironment: params.workspace === "demo" ? "DEMO_JPY_BASE" : "PROD_P_JPY_SETTLEMENT",
    entryDate,
    expiryDate,
    dte: 45,
    accountCurrency: "JPY",
    referenceFxRateJPY: params.fxRateJPY ?? 0,
    stockPosition: isCoveredCall
      ? {
          shares: 100,
          averageCostUSD: params.candidate.priceUSD ?? 0,
          denominatorPriceMode: "current_price",
          canSellAtStrike: false,
        }
      : null,
    optionLegs: [
      {
        id: `${id}-${isCoveredCall ? "call" : "put"}`,
        type: isCoveredCall ? "call" : "put",
        side: "sell",
        strikeUSD: 0,
        premiumUSD: 0,
        quantity: 1,
        expiryDate,
        isCovered: isCoveredCall,
        putIntent: isCoveredCall ? undefined : "accept_assignment",
        assignmentPolicy: isCoveredCall ? "unknown" : "accept",
      },
    ],
    brokerMarginJPY: 0,
    marginBufferMultiplier: params.settings.defaultMarginBufferMultiplier,
    marginUsagePercent: 0,
    availableCashJPY: 0,
    denominatorMode: isCoveredCall ? "stock_plus_margin" : "cash_secured",
    profitTakeRule: {
      enabled: false,
      targetPremiumKeepPercent: 60,
      latestCloseDaysBeforeExpiry: 7,
    },
    stopLossRule: {
      enabled: false,
      type: "option_buyback_price",
      value: 0,
    },
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    nisaExpectedAnnualReturnPct: params.settings.defaultNisaExpectedAnnualReturnPct,
    brokerCommissionUSD: DEFAULT_BROKER_COMMISSION_USD,
    beginnerMode: params.settings.beginnerMode,
    notes: [
      `TradingView候補から作成: ${params.candidate.symbol}`,
      `Imported at: ${params.candidate.importedAt}`,
      `Score: ${params.candidate.score}`,
      `Suggested use: ${params.candidate.suggestedUse}`,
      params.candidate.earningsWarning ? `Earnings warning: ${params.candidate.earningsWarning}` : "",
      params.candidate.memo ? `Memo: ${params.candidate.memo}` : "",
      "Option chain未取得。権利行使価格、プレミアム、満期、証拠金は手入力で確認する。",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
