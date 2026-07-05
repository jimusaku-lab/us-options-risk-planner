import type {
  ChartAnalysisSnapshot,
  PublicOptionCandidateInput,
  PublicScreeningCandidateInput,
  ScreeningCandidate,
  ScreeningCompletenessResult,
  TechnicalSnapshot,
} from "@/types/screening";

type CompletenessInput = PublicScreeningCandidateInput | ScreeningCandidate;

export function detectScreeningCompleteness(input: CompletenessInput): ScreeningCompletenessResult {
  const missingFields: string[] = [];
  const warnings: string[] = [];
  const symbol = stringValue(input.symbol);
  const underlyingPrice = numberValue("underlyingPrice" in input ? input.underlyingPrice : undefined);
  const technicalSnapshot = getTechnicalSnapshot(input);
  const chartAnalysis = getChartAnalysis(input);
  const dailyOhlcv = "dailyOhlcv" in input && Array.isArray(input.dailyOhlcv) ? input.dailyOhlcv : [];
  const optionCandidates = getOptionCandidates(input);
  const optionQuality = "optionChainQuality" in input ? input.optionChainQuality : undefined;
  const capital = "capital" in input ? input.capital : undefined;

  if (!symbol) missingFields.push("symbol");
  if (underlyingPrice === undefined) missingFields.push("underlyingPrice");
  if (!hasMinimumTechnical(technicalSnapshot, chartAnalysis)) missingFields.push("technicalSnapshot.minimum");

  const hasLevel1 = Boolean(symbol && underlyingPrice !== undefined);
  if (!hasLevel1) {
    return {
      level: "insufficient",
      canClassifyStrategy: false,
      canAnalyzeChart: false,
      canEvaluateOptionLiquidity: false,
      canCreatePositionDraft: false,
      missingFields: unique(missingFields),
      warnings,
    };
  }

  const chartReady = hasChartReadyData({ technicalSnapshot, chartAnalysis, dailyOhlcv });
  if (!chartReady) missingFields.push("chartAnalysis.orDailyOhlcv");
  const optionReady = chartReady && hasOptionReadyData({ optionCandidates, optionQuality });
  if (chartReady && !optionReady) {
    missingFields.push("optionCandidates.bidAsk");
    if (optionCandidates.length > 0) {
      warnings.push("Bid/Ask/OI/Volume/IVのいずれかが不足しているため、オプション流動性判定へ進めません。");
    }
  }
  const draftReady = optionReady && hasDraftReadyData({ capital, optionCandidates, input });
  if (optionReady && !draftReady) missingFields.push("capital.availableCashOrRiskBudget");

  const level = draftReady
    ? "level_4_draft_ready"
    : optionReady
      ? "level_3_option_ready"
      : chartReady
        ? "level_2_chart_ready"
        : "level_1_symbol_price";

  return {
    level,
    canClassifyStrategy: hasLevel1,
    canAnalyzeChart: chartReady,
    canEvaluateOptionLiquidity: optionReady,
    canCreatePositionDraft: draftReady,
    missingFields: unique(missingFields),
    warnings: unique(warnings),
  };
}

function getTechnicalSnapshot(input: CompletenessInput): Partial<TechnicalSnapshot> | undefined {
  return "technicalSnapshot" in input ? input.technicalSnapshot : undefined;
}

function getChartAnalysis(input: CompletenessInput): ChartAnalysisSnapshot | undefined {
  return "chartAnalysis" in input ? input.chartAnalysis : undefined;
}

function getOptionCandidates(input: CompletenessInput): PublicOptionCandidateInput[] {
  if ("optionCandidates" in input && Array.isArray(input.optionCandidates)) return input.optionCandidates;
  if ("candidateStrategies" in input && Array.isArray(input.candidateStrategies)) {
    return input.candidateStrategies
      .filter((strategy) => strategy.strikePrice !== undefined || strategy.premium !== undefined)
      .map((strategy) => ({
        optionType: strategy.strategy === "long_call" || strategy.strategy === "covered_call" ? "call" : "put",
        strike: strategy.strikePrice,
        dte: strategy.dte,
        bid: strategy.strategy === "long_call" ? undefined : strategy.premium,
        ask: strategy.strategy === "long_call" ? strategy.premium : undefined,
      }));
  }
  return [];
}

function hasMinimumTechnical(technicalSnapshot?: Partial<TechnicalSnapshot>, chartAnalysis?: ChartAnalysisSnapshot): boolean {
  if (chartAnalysis && chartAnalysis.regime !== "insufficient_data") return true;
  if (!technicalSnapshot) return false;
  return [
    technicalSnapshot.dailyClose,
    technicalSnapshot.sma25,
    technicalSnapshot.sma50,
    technicalSnapshot.sma200,
    technicalSnapshot.rsi,
    technicalSnapshot.macdSignal,
    technicalSnapshot.slowKdSignal,
    ...(technicalSnapshot.trendNotes ?? []),
  ].some((value) => value !== undefined && value !== "");
}

function hasChartReadyData({
  technicalSnapshot,
  chartAnalysis,
  dailyOhlcv,
}: {
  technicalSnapshot?: Partial<TechnicalSnapshot>;
  chartAnalysis?: ChartAnalysisSnapshot;
  dailyOhlcv: PublicScreeningCandidateInput["dailyOhlcv"];
}): boolean {
  if (chartAnalysis && chartAnalysis.confidence !== "insufficient" && chartAnalysis.regime !== "insufficient_data") return true;
  if ((dailyOhlcv?.length ?? 0) >= 120) return true;
  if (!technicalSnapshot) return false;
  const maCount = [technicalSnapshot.dailyClose, technicalSnapshot.sma25, technicalSnapshot.sma50, technicalSnapshot.sma200].filter(
    (value) => typeof value === "number",
  ).length;
  const signals = [technicalSnapshot.macdSignal, technicalSnapshot.slowKdSignal, technicalSnapshot.rsi].filter(Boolean).length;
  return maCount >= 3 && signals >= 1;
}

function hasOptionReadyData({
  optionCandidates,
  optionQuality,
}: {
  optionCandidates: PublicOptionCandidateInput[];
  optionQuality?: Partial<ScreeningCandidate["optionChainQuality"]>;
}): boolean {
  if (optionQuality?.hasOptionChain && optionQuality.bidAskSpreadRate !== undefined && optionQuality.volume !== undefined && optionQuality.openInterest !== undefined && optionQuality.iv !== undefined) {
    return true;
  }
  return optionCandidates.some((option) => {
    const bidAskReady = numberValue(option.bid) !== undefined && numberValue(option.ask) !== undefined;
    const liquidityReady = numberValue(option.volume) !== undefined && numberValue(option.openInterest) !== undefined;
    const ivReady = numberValue(option.iv) !== undefined;
    return bidAskReady && liquidityReady && ivReady;
  });
}

function hasDraftReadyData({
  capital,
  optionCandidates,
  input,
}: {
  capital?: PublicScreeningCandidateInput["capital"];
  optionCandidates: PublicOptionCandidateInput[];
  input: CompletenessInput;
}): boolean {
  const availableCash = numberValue(capital?.availableCashUSD ?? capital?.buyingPowerUSD ?? capital?.assignmentCapitalAvailableUSD);
  const maxLossTolerance = numberValue(capital?.maxLossToleranceUSD);
  const hasShares = numberValue(capital?.stockShares) !== undefined;
  const hasDraft = "positionDrafts" in input && Array.isArray(input.positionDrafts) && input.positionDrafts.some((draft) => draft.status === "draft_ready");
  const hasOptionPremium = optionCandidates.some((option) => numberValue(option.ask ?? option.bid ?? option.mid) !== undefined);
  return hasDraft || (availableCash !== undefined && (maxLossTolerance !== undefined || hasShares) && hasOptionPremium);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
