import { evaluateScreeningCandidate } from "@/domain/screeningRules";
import { detectScreeningCompleteness } from "@/domain/screeningCompleteness";
import { analyzeChart } from "@/domain/chartAnalysis";
import { evaluateCandidateStrategySuitabilities } from "@/domain/strategySuitability";
import { selectOptionLegCandidates } from "@/domain/optionLegSelection";
import { buildPositionDraftsForCandidate, finalizePositionDraftForReview } from "@/domain/positionDrafts";
import { buildAdvancedStrategyReviewsForCandidate } from "@/domain/advancedStrategyReviews";
import { buildStrategyPrecisionReviewsForCandidate } from "@/domain/strategyPrecision";
import type { CandidateImportResult, CandidateSource, CandidateSymbol } from "@/types/candidates";
import type {
  OptionChainQuality,
  OptionLegDraft,
  PublicOptionCandidateInput,
  PublicScreeningCandidateInput,
  PublicScreeningPackage,
  ScreeningCandidate,
  ScreeningCompletenessResult,
  ScreeningDataSource,
  ScreeningDelayStatus,
  StrategyCandidateInput,
  StrategyCandidateKind,
  StrategySuitability,
  TechnicalSnapshot,
} from "@/types/screening";

type UnsafePath = string;

export type DangerousFieldFinding = {
  path: string;
  reason: "credential_like_key" | "order_operation" | "local_path";
};

export type NormalizedPublicScreeningCandidate = {
  input: PublicScreeningCandidateInput;
  candidate: ScreeningCandidate;
  completeness: ScreeningCompletenessResult;
  warnings: string[];
};

export type PublicScreeningPackageNormalization = {
  package: PublicScreeningPackage;
  candidates: NormalizedPublicScreeningCandidate[];
  warnings: string[];
  dangerousFields: DangerousFieldFinding[];
};

const SCHEMA_VERSION = "us_options_screening_package.v1";
const dangerousKeyPattern = /(token|password|secret|api[_-]?key|account[_-]?id|acc[_-]?id|credential|refresh)/i;
const blockedOperationTerms = ["order", ["unlock", "trade"].join("_"), ["place", "order"].join("_"), ["modify", "order"].join("_"), ["cancel", "order"].join("_"), "exercise"];
const orderKeyPattern = new RegExp(`(${blockedOperationTerms.join("|")})`, "i");
const localPathPattern = /(?:\/Users\/|\/home\/|[A-Za-z]:\\)/;

export function parsePublicScreeningPackage(text: string): PublicScreeningPackage {
  return normalizePublicScreeningPackage(JSON.parse(stripBom(text)) as unknown).package;
}

export function normalizePublicScreeningPackage(value: unknown): PublicScreeningPackageNormalization {
  const dangerousFields = detectDangerousFields(value);
  const sanitized = sanitizePublicScreeningPackage(value);
  if (!isRecord(sanitized)) {
    throw new Error("screening package must be a JSON object.");
  }
  if (sanitized.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  const candidates = Array.isArray(sanitized.candidates) ? sanitized.candidates : [];
  const source = normalizePackageSource(sanitized.source);
  const dataPolicy = isRecord(sanitized.dataPolicy) ? sanitized.dataPolicy : {};
  const containsCredentials = dataPolicy.containsCredentials === true || dangerousFields.length > 0;
  const normalizedPackage: PublicScreeningPackage = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: stringOrUndefined(sanitized.generatedAt),
    source,
    dataPolicy: {
      userProvided: true,
      containsCredentials: false,
      redistributionChecked: dataPolicy.redistributionChecked === true,
      notes: asStringArray(dataPolicy.notes),
    },
    candidates: candidates.map((candidate) => sanitizePublicCandidate(candidate)).filter((candidate): candidate is PublicScreeningCandidateInput => Boolean(candidate)),
  };
  const warnings = [
    ...dangerousFields.map((finding) => `危険フィールドを除外しました: ${finding.path}`),
    containsCredentials ? "認証情報らしきフィールドが含まれていたため除外しました。" : undefined,
  ].filter((warning): warning is string => Boolean(warning));
  return {
    package: normalizedPackage,
    candidates: normalizedPackage.candidates.map((candidate) => normalizePublicScreeningCandidate(candidate, { generatedAt: normalizedPackage.generatedAt, source })),
    warnings,
    dangerousFields,
  };
}

export function normalizePublicScreeningCandidate(
  input: PublicScreeningCandidateInput,
  params: { generatedAt?: string; source?: PublicScreeningPackage["source"] } = {},
): NormalizedPublicScreeningCandidate {
  const chartAnalysis = input.chartAnalysis ?? buildChartAnalysis(input, params.source);
  const preliminaryInput: PublicScreeningCandidateInput = { ...input, chartAnalysis };
  const optionChainQuality = buildOptionChainQuality(preliminaryInput.optionCandidates, preliminaryInput.optionChainQuality);
  const technicalSnapshot = buildTechnicalSnapshot(preliminaryInput);
  const candidate: ScreeningCandidate = {
    symbol: preliminaryInput.symbol.trim().toUpperCase().replace(/^US\./, ""),
    name: preliminaryInput.name,
    market: preliminaryInput.market ?? "US",
    sector: preliminaryInput.sector,
    underlyingPrice: preliminaryInput.underlyingPrice,
    priceAsOf: preliminaryInput.priceAsOf ?? params.generatedAt,
    dataSource: toScreeningDataSource(params.source),
    delayStatus: normalizeDelayStatus(preliminaryInput.delayStatus),
    technicalSnapshot,
    optionChainQuality,
    candidateStrategies: preliminaryInput.candidateStrategies?.length ? preliminaryInput.candidateStrategies : buildCandidateStrategies(preliminaryInput),
    riskFlags: preliminaryInput.riskFlags ?? [],
    missingFields: preliminaryInput.missingFields ?? [],
  };
  const strategySuitability = preliminaryInput.strategySuitability?.length
    ? preliminaryInput.strategySuitability
    : chartAnalysis
      ? evaluateCandidateStrategySuitabilities({
          candidate,
          chartAnalysis,
          capital: preliminaryInput.capital,
          existingPosition: preliminaryInput.existingPosition,
        })
      : undefined;
  const legSelections = buildLegSelections(preliminaryInput, candidate.symbol, strategySuitability);
  const positionDrafts = preliminaryInput.positionDrafts?.length
    ? preliminaryInput.positionDrafts.map(finalizePositionDraftForReview)
    : legSelections.length
      ? buildPositionDraftsForCandidate({
          symbol: candidate.symbol,
          strategySuitabilities: strategySuitability,
          legSelections,
          capital: preliminaryInput.capital,
          underlyingPrice: preliminaryInput.underlyingPrice,
        })
      : undefined;
  const advancedStrategyReviews = preliminaryInput.advancedStrategyReviews?.length
    ? preliminaryInput.advancedStrategyReviews
    : buildAdvancedStrategyReviewsForCandidate(preliminaryInput);
  const strategyPrecisionReviews = preliminaryInput.strategyPrecisionReviews?.length
    ? preliminaryInput.strategyPrecisionReviews
    : buildStrategyPrecisionReviewsForCandidate({
        ...preliminaryInput,
        strategySuitability,
        positionDrafts,
        advancedStrategyReviews,
      });
  const enrichedInput: PublicScreeningCandidateInput = {
    ...preliminaryInput,
    strategySuitability,
    positionDrafts,
    advancedStrategyReviews,
    strategyPrecisionReviews,
  };
  const completeness = detectScreeningCompleteness(enrichedInput);
  const missingFields = unique([...(enrichedInput.missingFields ?? []), ...completeness.missingFields]);
  const warnings = unique([...(enrichedInput.warnings ?? []), ...completeness.warnings]);
  candidate.riskFlags = unique([...(enrichedInput.riskFlags ?? []), ...warnings]);
  candidate.missingFields = missingFields;
  return { input: enrichedInput, candidate, completeness, warnings };
}

export function normalizePublicScreeningPackageToCandidateImport(
  value: unknown,
  importedAt = new Date().toISOString(),
): CandidateImportResult {
  const normalized = normalizePublicScreeningPackage(value);
  const source = toCandidateSource(normalized.package.source);
  const candidates = normalized.candidates.map((item, index) => candidateSymbolFromPublicCandidate(item, {
    source,
    importedAt,
    rowNumber: index + 1,
  }));
  const warnings = [
    ...normalized.warnings,
    ...normalized.candidates.flatMap((candidate, index) =>
      candidate.warnings.map((warning) => `row ${index + 1} ${candidate.candidate.symbol}: ${warning}`),
    ),
  ];
  return {
    candidates,
    warnings,
    errors: [],
    screeningCandidates: normalized.candidates.map((item) => item.candidate),
    summary: {
      totalRows: normalized.package.candidates.length,
      importedCount: candidates.length,
      warningCount: warnings.length,
      errorCount: 0,
      source,
      format: "json",
      asOf: normalized.package.generatedAt,
      importedAt,
    },
  };
}

export function sanitizePublicScreeningPackage(value: unknown): unknown {
  return sanitizeUnknown(value, []);
}

export function detectDangerousFields(value: unknown): DangerousFieldFinding[] {
  const findings: DangerousFieldFinding[] = [];
  visitDangerousFields(value, [], findings);
  return findings;
}

function candidateSymbolFromPublicCandidate(
  normalized: NormalizedPublicScreeningCandidate,
  params: { source: CandidateSource; importedAt: string; rowNumber: number },
): CandidateSymbol {
  const strategyFitResults = evaluateScreeningCandidate(normalized.candidate);
  return {
    id: `${params.source}-${normalized.candidate.symbol}-${params.importedAt}-${params.rowNumber}`,
    source: params.source,
    importedAt: params.importedAt,
    rawSourceRow: rawSourceRowFromCandidate(normalized.input),
    parseWarnings: normalized.warnings,
    rank: params.rowNumber,
    symbol: normalized.candidate.symbol,
    company: normalized.candidate.name ?? normalized.candidate.symbol,
    priceUSD: normalized.candidate.underlyingPrice,
    sector: normalized.candidate.sector,
    score: completenessScore(normalized.completeness.level),
    suggestedUse: `screening package ${normalized.completeness.level}`,
    memo: normalized.input.notes,
    screeningCandidate: normalized.candidate,
    publicScreeningInput: normalized.input,
    screeningCompleteness: normalized.completeness,
    strategySuitability: normalized.input.strategySuitability,
    positionDrafts: normalized.input.positionDrafts,
    advancedStrategyReviews: normalized.input.advancedStrategyReviews,
    strategyPrecisionReviews: normalized.input.strategyPrecisionReviews,
    strategyFitResults,
  };
}

function buildChartAnalysis(
  input: PublicScreeningCandidateInput,
  source?: PublicScreeningPackage["source"],
): PublicScreeningCandidateInput["chartAnalysis"] {
  if (!input.dailyOhlcv?.length && !input.technicalSnapshot) return undefined;
  return analyzeChart({
    asOf: input.priceAsOf,
    source: toScreeningDataSource(source),
    daily: input.dailyOhlcv,
    technicalSnapshot: input.technicalSnapshot,
  });
}

function buildLegSelections(
  input: PublicScreeningCandidateInput,
  symbol: string,
  strategySuitability?: StrategySuitability[],
): Array<{ strategy: StrategyCandidateKind; legs: OptionLegDraft[] }> {
  if (!input.optionCandidates?.length || !strategySuitability?.length) return [];
  return strategySuitability
    .filter((item) => ["long_call", "cash_secured_put_buy_to_own", "cash_secured_put_avoid_assignment", "covered_call"].includes(item.strategy))
    .map((item) => selectOptionLegCandidates({
      symbol,
      underlyingPrice: input.underlyingPrice,
      strategy: item.strategy,
      strategySuitability: item,
      options: input.optionCandidates ?? [],
      stockCostBasis: input.capital?.stockCostBasisUSD,
      maxCandidates: 3,
    }))
    .filter((selection) => selection.legs.length > 0)
    .map((selection) => ({ strategy: selection.strategy, legs: selection.legs }));
}

function buildTechnicalSnapshot(input: PublicScreeningCandidateInput): TechnicalSnapshot {
  const existing = input.technicalSnapshot ?? {};
  const daily = input.chartAnalysis?.timeframes.find((timeframe) => timeframe.timeframe === "daily");
  return {
    dailyClose: existing.dailyClose ?? daily?.close ?? input.underlyingPrice,
    sma5: existing.sma5 ?? daily?.sma5,
    sma10: existing.sma10 ?? daily?.sma10,
    sma25: existing.sma25 ?? daily?.sma25,
    sma50: existing.sma50 ?? daily?.sma50,
    sma75: existing.sma75,
    sma100: existing.sma100,
    sma200: existing.sma200 ?? daily?.sma200,
    weeklySma13: existing.weeklySma13,
    weeklySma26: existing.weeklySma26,
    weeklySma52: existing.weeklySma52,
    macdSignal: existing.macdSignal ?? daily?.macdSignal,
    slowKdSignal: existing.slowKdSignal ?? daily?.slowKdSignal,
    rsi: existing.rsi ?? daily?.rsi,
    trendNotes: existing.trendNotes ?? input.chartAnalysis?.reasons ?? [],
    signalEvents: existing.signalEvents,
    patternCandidates: existing.patternCandidates,
    movingAverageSlopes: existing.movingAverageSlopes,
  };
}

function buildOptionChainQuality(
  options: PublicOptionCandidateInput[] | undefined,
  existing: PublicScreeningCandidateInput["optionChainQuality"],
): OptionChainQuality {
  const optionList = options ?? [];
  const spreads = optionList.map((option) => spreadRate(option)).filter((value): value is number => value !== undefined);
  const volumes = optionList.map((option) => option.volume).filter(isFiniteNumber);
  const openInterests = optionList.map((option) => option.openInterest).filter(isFiniteNumber);
  const ivs = optionList.map((option) => option.iv).filter(isFiniteNumber);
  const expiries = unique(optionList.map((option) => option.expiry).filter(Boolean) as string[]);
  return {
    hasOptionChain: existing?.hasOptionChain ?? optionList.length > 0,
    expirationCount: existing?.expirationCount ?? (expiries.length || undefined),
    targetDteAvailable: existing?.targetDteAvailable ?? optionList.some((option) => option.dte !== undefined || option.expiry),
    bidAskSpreadRate: existing?.bidAskSpreadRate ?? (spreads.length ? Math.max(...spreads) : undefined),
    volume: existing?.volume ?? (volumes.length ? Math.max(...volumes) : undefined),
    openInterest: existing?.openInterest ?? (openInterests.length ? Math.max(...openInterests) : undefined),
    iv: existing?.iv ?? ivs[0],
    delta: existing?.delta ?? optionList.map((option) => option.delta).find(isFiniteNumber),
    gamma: existing?.gamma ?? optionList.map((option) => option.gamma).find(isFiniteNumber),
    theta: existing?.theta ?? optionList.map((option) => option.theta).find(isFiniteNumber),
    vega: existing?.vega ?? optionList.map((option) => option.vega).find(isFiniteNumber),
    qualityWarnings: existing?.qualityWarnings ?? optionQualityWarnings(optionList),
  };
}

function buildCandidateStrategies(input: PublicScreeningCandidateInput): StrategyCandidateInput[] {
  const options = input.optionCandidates ?? [];
  return options
    .map((option): StrategyCandidateInput | undefined => {
      const strikePrice = option.strikePrice ?? option.strike;
      if (strikePrice === undefined) return undefined;
      if (option.optionType === "call") {
        return { strategy: "long_call", dte: option.dte, strikePrice, premium: option.ask ?? option.mid };
      }
      return {
        strategy: "cash_secured_put_buy_to_own",
        dte: option.dte,
        strikePrice,
        premium: option.bid ?? option.mid,
        assignmentCapitalRequired: strikePrice * 100,
        availableCash: input.capital?.availableCashUSD ?? input.capital?.assignmentCapitalAvailableUSD,
      };
    })
    .filter((strategy): strategy is StrategyCandidateInput => Boolean(strategy));
}

function sanitizePublicCandidate(value: unknown): PublicScreeningCandidateInput | undefined {
  if (!isRecord(value)) return undefined;
  const symbol = stringOrUndefined(value.symbol) ?? stringOrUndefined(value.ticker);
  if (!symbol) return undefined;
  return value as PublicScreeningCandidateInput;
}

function sanitizeUnknown(value: unknown, path: UnsafePath[]): unknown {
  if (Array.isArray(value)) return value.map((item, index) => sanitizeUnknown(item, [...path, String(index)]));
  if (!isRecord(value)) {
    return typeof value === "string" && localPathPattern.test(value) ? "[removed-local-path]" : value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => isAllowedPublicMetadataKey([...path, key]) || (!dangerousKeyPattern.test(key) && !orderKeyPattern.test(key)))
      .map(([key, nested]) => [key, sanitizeUnknown(nested, [...path, key])]),
  );
}

function visitDangerousFields(value: unknown, path: UnsafePath[], findings: DangerousFieldFinding[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitDangerousFields(item, [...path, String(index)], findings));
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === "string" && localPathPattern.test(value)) {
      findings.push({ path: path.join("."), reason: "local_path" });
    }
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (!isAllowedPublicMetadataKey(nextPath)) {
      if (dangerousKeyPattern.test(key)) findings.push({ path: nextPath.join("."), reason: "credential_like_key" });
      if (orderKeyPattern.test(key)) findings.push({ path: nextPath.join("."), reason: "order_operation" });
    }
    visitDangerousFields(nested, nextPath, findings);
  }
}

function isAllowedPublicMetadataKey(path: UnsafePath[]): boolean {
  return path.join(".") === "dataPolicy.containsCredentials";
}

function rawSourceRowFromCandidate(input: PublicScreeningCandidateInput): Record<string, string> {
  const sanitized = sanitizePublicScreeningPackage(input);
  if (!isRecord(sanitized)) return {};
  return Object.fromEntries(
    Object.entries(sanitized)
      .filter(([, value]) => typeof value !== "object")
      .map(([key, value]) => [key, value === undefined || value === null ? "" : String(value)]),
  );
}

function optionQualityWarnings(options: PublicOptionCandidateInput[]): string[] {
  if (options.length === 0) return ["オプション候補なし"];
  return unique([
    options.some((option) => option.bid === undefined || option.ask === undefined) ? "Bid/Ask不足" : undefined,
    options.some((option) => option.volume === undefined) ? "Volume不足" : undefined,
    options.some((option) => option.openInterest === undefined) ? "Open Interest不足" : undefined,
    options.some((option) => option.iv === undefined) ? "IV不足" : undefined,
  ].filter((value): value is string => Boolean(value)));
}

function spreadRate(option: PublicOptionCandidateInput): number | undefined {
  if (!isFiniteNumber(option.bid) || !isFiniteNumber(option.ask)) return undefined;
  const mid = option.mid ?? (option.bid + option.ask) / 2;
  return mid > 0 ? (option.ask - option.bid) / mid : undefined;
}

function toCandidateSource(source: PublicScreeningPackage["source"]): CandidateSource {
  if (source === "tradingview_user_export") return "legacy_tradingview";
  if (source === "csv") return "imported_csv";
  return "manual_import";
}

function toScreeningDataSource(source?: PublicScreeningPackage["source"]): ScreeningDataSource {
  if (source === "csv") return "csv";
  if (source === "json") return "json";
  if (source === "tradingview_user_export") return "tradingview";
  if (source === "calculated") return "calculated";
  return "manual";
}

function normalizePackageSource(value: unknown): PublicScreeningPackage["source"] {
  const normalized = String(value ?? "manual").trim();
  return ["manual", "moomoo_user_export", "tradingview_user_export", "csv", "json", "calculated"].includes(normalized)
    ? (normalized as PublicScreeningPackage["source"])
    : "manual";
}

function normalizeDelayStatus(value: unknown): ScreeningDelayStatus {
  return value === "real_time" || value === "delayed" || value === "end_of_day" || value === "unknown" ? value : "unknown";
}

function completenessScore(level: ScreeningCompletenessResult["level"]): number {
  if (level === "level_4_draft_ready") return 90;
  if (level === "level_3_option_ready") return 75;
  if (level === "level_2_chart_ready") return 55;
  if (level === "level_1_symbol_price") return 35;
  return 0;
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
