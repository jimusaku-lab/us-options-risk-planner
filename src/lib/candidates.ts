import { evaluateScreeningCandidate } from "@/domain/screeningRules";
import { buildUpsideReversalComboPattern } from "@/domain/technicalPatterns";
import { evaluateSyntheticForwardCandidate } from "@/domain/syntheticForward";
import type { CandidateImportError, CandidateImportFormat, CandidateImportResult, CandidateSource, CandidateSymbol } from "@/types/candidates";
import type { OptionChainQuality, ScreeningCandidate, ScreeningDataSource, ScreeningDelayStatus, StrategyCandidateInput, SyntheticForwardLeg, TechnicalSnapshot } from "@/types/screening";

type CandidateRow = Record<string, unknown>;
export type MoomooOptionPermission = "ok" | "permission_missing" | "unknown";

export type MoomooScreeningRun = {
  source?: unknown;
  asOf?: unknown;
  permissions?: {
    usOption?: unknown;
  };
  candidates?: unknown;
  quotes?: unknown;
  results?: unknown;
};

export type MoomooQuoteInput = CandidateRow & {
  options?: unknown;
  optionContracts?: unknown;
  callOption?: unknown;
  putOption?: unknown;
  historyBars?: unknown;
  permissions?: {
    usOption?: unknown;
  };
};

const requiredHeaders = ["Rank", "Symbol", "Company", "Price", "Score", "SuggestedUse"];
const legacyTradingViewPattern = /tradingview/i;
const sensitiveKeyPattern = /(token|secret|password|credential|accountNumber|accountId|account[_-]?id|localPath|path|apiKey|api[_-]?key|refresh)/i;
const localPathPattern = /(?:\/Users\/|\/home\/|[A-Za-z]:\\)/;

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function normalizeMinus(value: string): string {
  return value.replace(/\u2212/g, "-");
}

function toRawStringRecord(row: CandidateRow): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !sensitiveKeyPattern.test(key))
      .map(([key, value]) => {
        const stringValue = value === undefined || value === null ? "" : String(value);
        return [key, localPathPattern.test(stringValue) ? "[removed-local-path]" : stringValue];
      }),
  );
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = normalizeMinus(value).replace(/,/g, "").trim();
  if (!normalized) return undefined;
  const match = normalized.match(/[-+]?\d*\.?\d+/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseUsdPrice(value: string | undefined): number | undefined {
  return parseNumber(value);
}

export function parsePercent(value: string | undefined): number | undefined {
  return parseNumber(value);
}

export function parseCompactNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = normalizeMinus(value).replace(/,/g, "").replace(/USD/gi, "").trim();
  const match = normalized.match(/^([-+]?\d*\.?\d+)\s*([KMBT])?$/i);
  if (!match) return parseNumber(value);
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return undefined;
  const suffix = match[2]?.toUpperCase();
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : suffix === "T" ? 1_000_000_000_000 : 1;
  return base * multiplier;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

export function parseCandidateCsv(text: string): CandidateRow[] {
  const lines = stripBom(text).split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function getString(row: CandidateRow, key: string): string {
  const value = row[key];
  return value === undefined || value === null ? "" : String(value).trim();
}

function getAliasedString(row: CandidateRow, aliases: string[]): string {
  const lowerMap = new Map(Object.keys(row).map((key) => [key.toLowerCase(), key]));
  for (const alias of aliases) {
    const actualKey = lowerMap.get(alias.toLowerCase());
    if (actualKey) return getString(row, actualKey);
  }
  return "";
}

function getAliasedNumber(row: CandidateRow, aliases: string[]): number | undefined {
  return parseNumber(getAliasedString(row, aliases));
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["true", "yes", "y", "1", "ok"].includes(normalized)) return true;
  if (["false", "no", "n", "0", "ng"].includes(normalized)) return false;
  return undefined;
}

function normalizeSlope(value: string): "up" | "flat" | "down" | "unknown" | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["up", "upward", "rising"].includes(normalized)) return "up";
  if (["flat", "sideways"].includes(normalized)) return "flat";
  if (["down", "downward", "falling"].includes(normalized)) return "down";
  if (normalized === "unknown") return "unknown";
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(/[;|]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function compactUnique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

function asRecord(value: unknown): CandidateRow | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as CandidateRow) : undefined;
}

function asRecordArray(value: unknown): CandidateRow[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is CandidateRow => Boolean(item)) : [];
}

function normalizeMoomooOptionPermission(value: unknown): MoomooOptionPermission {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized === "ok" || normalized === "granted" || normalized === "available") return "ok";
  if (normalized.includes("permission") || normalized.includes("no permission") || normalized.includes("権限")) return "permission_missing";
  return "unknown";
}

function normalizeMoomooSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/^US\./, "");
}

function warnIfMissing(warnings: string[], rowNumber: number, field: string, value: unknown): void {
  if (value === undefined || value === null || String(value).trim() === "") {
    warnings.push(`row ${rowNumber}: ${field} is empty`);
  }
}

export function normalizeCandidateRow(row: CandidateRow, params: { importedAt: string; rowNumber: number; source: CandidateSource }): CandidateSymbol {
  const rowWarnings: string[] = [];
  const rawSourceRow = toRawStringRecord(row);
  const symbol = getString(row, "Symbol").toUpperCase();
  const priceUSD = parseUsdPrice(getString(row, "Price"));
  const changePercent = parsePercent(getString(row, "ChangePercent"));
  const volume = parseCompactNumber(getString(row, "Volume"));
  const marketCapUSD = parseCompactNumber(getString(row, "MarketCap"));
  const rank = parseNumber(getString(row, "Rank"));
  const score = parseNumber(getString(row, "Score"));
  const per = parseNumber(getString(row, "PER"));
  const relativeVolume = parseNumber(getString(row, "RelativeVolume"));

  warnIfMissing(rowWarnings, params.rowNumber, "Symbol", symbol);
  if (priceUSD === undefined && getString(row, "Price")) rowWarnings.push(`row ${params.rowNumber}: Price could not be parsed`);
  if (changePercent === undefined && getString(row, "ChangePercent")) rowWarnings.push(`row ${params.rowNumber}: ChangePercent could not be parsed`);
  if (volume === undefined && getString(row, "Volume")) rowWarnings.push(`row ${params.rowNumber}: Volume could not be parsed`);
  if (marketCapUSD === undefined && getString(row, "MarketCap")) rowWarnings.push(`row ${params.rowNumber}: MarketCap could not be parsed`);

  const earningsWarning = getString(row, "EarningsWarning");
  const suggestedUse = getString(row, "SuggestedUse");

  return {
    id: `${params.source}-${symbol || "unknown"}-${params.importedAt}-${params.rowNumber}`,
    source: params.source,
    importedAt: params.importedAt,
    rawSourceRow,
    parseWarnings: rowWarnings,
    rank: rank ?? params.rowNumber,
    symbol,
    company: getString(row, "Company"),
    priceUSD,
    changePercent,
    volume,
    relativeVolume,
    marketCapUSD,
    per,
    sector: getString(row, "Sector") || undefined,
    analystRating: getString(row, "AnalystRating") || undefined,
    nextEarningsDate: getString(row, "NextEarningsDate") || undefined,
    earningsWarning: earningsWarning || undefined,
    score: score ?? 0,
    suggestedUse,
    memo: getString(row, "Memo") || undefined,
    redlist: /redlist/i.test(suggestedUse) || /redlist/i.test(getString(row, "Memo")),
    watchOnly: /watch only/i.test(suggestedUse),
  };
}

function parseJsonPayload(text: string): { rows: CandidateRow[]; source?: CandidateSource; asOf?: string } {
  const parsed = JSON.parse(stripBom(text)) as unknown;
  if (Array.isArray(parsed)) return { rows: parsed as CandidateRow[] };
  if (parsed && typeof parsed === "object") {
    const maybeObject = parsed as Record<string, unknown>;
    const source = typeof maybeObject.source === "string" ? normalizeCandidateSource(maybeObject.source) : undefined;
    const asOf = typeof maybeObject.asOf === "string" ? maybeObject.asOf : undefined;
    if (Array.isArray(maybeObject.candidates)) return { rows: maybeObject.candidates as CandidateRow[], source, asOf };
    if (Array.isArray(maybeObject.data)) return { rows: maybeObject.data as CandidateRow[], source, asOf };
  }
  throw new Error("候補JSONは配列、または candidates/data 配列を含む形式にしてください。");
}

function normalizeCandidateSource(value: string): CandidateSource {
  const normalized = value.trim().toLowerCase();
  if (normalized === "moomoo_opend") return "moomoo_opend";
  if (normalized === "moomoo_file_import") return "moomoo_file_import";
  if (normalized === "legacy_tradingview" || /tradingview/i.test(value)) return "legacy_tradingview";
  if (normalized === "manual_import" || /manual/i.test(value)) return "manual_import";
  if (normalized === "imported_csv") return "imported_csv";
  return "manual_import";
}

function toScreeningDataSource(source: CandidateSource): ScreeningDataSource {
  if (source === "moomoo_file_import" || source === "moomoo_opend") return "moomoo";
  if (source === "legacy_tradingview" || source === "tradingview") return "tradingview";
  if (source === "imported_csv") return "csv";
  return "manual";
}

function normalizeDelayStatus(value: string): ScreeningDelayStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === "real_time" || normalized === "realtime") return "real_time";
  if (normalized === "delayed") return "delayed";
  if (normalized === "end_of_day" || normalized === "eod") return "end_of_day";
  return "unknown";
}

function buildTechnicalSnapshot(row: CandidateRow): TechnicalSnapshot {
  const existing = row.technicalSnapshot && typeof row.technicalSnapshot === "object" ? (row.technicalSnapshot as Partial<TechnicalSnapshot>) : {};
  const macdHistogram = getAliasedNumber(row, ["macdHistogram"]);
  const slowK = getAliasedNumber(row, ["slowK"]);
  const slowD = getAliasedNumber(row, ["slowD"]);
  return {
    dailyClose: existing.dailyClose ?? getAliasedNumber(row, ["dailyClose", "close", "underlyingPrice", "price"]),
    sma5: existing.sma5 ?? getAliasedNumber(row, ["sma5", "ma5"]),
    sma10: existing.sma10 ?? getAliasedNumber(row, ["sma10", "ma10"]),
    sma25: existing.sma25 ?? getAliasedNumber(row, ["sma25", "ma25"]),
    sma50: existing.sma50 ?? getAliasedNumber(row, ["sma50", "ma50"]),
    sma75: existing.sma75 ?? getAliasedNumber(row, ["sma75", "ma75"]),
    sma100: existing.sma100 ?? getAliasedNumber(row, ["sma100", "ma100"]),
    sma200: existing.sma200 ?? getAliasedNumber(row, ["sma200", "ma200"]),
    weeklySma13: existing.weeklySma13 ?? getAliasedNumber(row, ["weeklySma13"]),
    weeklySma26: existing.weeklySma26 ?? getAliasedNumber(row, ["weeklySma26"]),
    weeklySma52: existing.weeklySma52 ?? getAliasedNumber(row, ["weeklySma52"]),
    macdSignal: existing.macdSignal ?? (macdHistogram === undefined ? undefined : macdHistogram > 0 ? "bullish" : macdHistogram < 0 ? "bearish" : "neutral"),
    slowKdSignal: existing.slowKdSignal ?? (slowK === undefined || slowD === undefined ? undefined : slowK > slowD ? "bullish" : slowK < slowD ? "bearish" : "neutral"),
    rsi: existing.rsi ?? getAliasedNumber(row, ["rsi"]),
    trendNotes: existing.trendNotes ?? asStringArray(row.notes),
    signalEvents: existing.signalEvents,
    patternCandidates: existing.patternCandidates,
    movingAverageSlopes: existing.movingAverageSlopes ?? {
      ma25: normalizeSlope(getAliasedString(row, ["ma25Slope", "sma25Slope"])),
      ma50: normalizeSlope(getAliasedString(row, ["ma50Slope", "sma50Slope"])),
      ma200: normalizeSlope(getAliasedString(row, ["ma200Slope", "sma200Slope"])),
    },
  };
}

function buildOptionChainQuality(row: CandidateRow): OptionChainQuality {
  const existing = row.optionChainQuality && typeof row.optionChainQuality === "object" ? (row.optionChainQuality as Partial<OptionChainQuality>) : {};
  const callVolume = getAliasedNumber(row, ["callVolume"]);
  const putVolume = getAliasedNumber(row, ["putVolume"]);
  const callOpenInterest = getAliasedNumber(row, ["callOpenInterest", "callOi"]);
  const putOpenInterest = getAliasedNumber(row, ["putOpenInterest", "putOi"]);
  const callBid = getAliasedNumber(row, ["callBid"]);
  const callAsk = getAliasedNumber(row, ["callAsk"]);
  const putBid = getAliasedNumber(row, ["putBid"]);
  const putAsk = getAliasedNumber(row, ["putAsk"]);
  const callMid = callBid !== undefined && callAsk !== undefined ? (callBid + callAsk) / 2 : undefined;
  const putMid = putBid !== undefined && putAsk !== undefined ? (putBid + putAsk) / 2 : undefined;
  const spreadRates = [
    callMid && callMid > 0 && callBid !== undefined && callAsk !== undefined ? (callAsk - callBid) / callMid : undefined,
    putMid && putMid > 0 && putBid !== undefined && putAsk !== undefined ? (putAsk - putBid) / putMid : undefined,
  ].filter((value): value is number => value !== undefined && Number.isFinite(value));
  const hasOptionColumns = [callBid, callAsk, putBid, putAsk, callVolume, putVolume, callOpenInterest, putOpenInterest].some((value) => value !== undefined);
  return {
    hasOptionChain: existing.hasOptionChain ?? hasOptionColumns,
    expirationCount: existing.expirationCount,
    targetDteAvailable: existing.targetDteAvailable ?? Boolean(getAliasedString(row, ["callExpiry"]) || getAliasedString(row, ["putExpiry"])),
    bidAskSpreadRate: existing.bidAskSpreadRate ?? (spreadRates.length > 0 ? Math.max(...spreadRates) : undefined),
    volume: existing.volume ?? (Math.max(callVolume ?? 0, putVolume ?? 0) || undefined),
    openInterest: existing.openInterest ?? (Math.max(callOpenInterest ?? 0, putOpenInterest ?? 0) || undefined),
    iv: existing.iv ?? getAliasedNumber(row, ["impliedVolatility", "iv"]),
    delta: existing.delta,
    gamma: existing.gamma,
    theta: existing.theta,
    vega: existing.vega,
    qualityWarnings: existing.qualityWarnings ?? [],
  };
}

function getMoomooOptions(input: MoomooQuoteInput): CandidateRow[] {
  const callOption = asRecord(input.callOption);
  const putOption = asRecord(input.putOption);
  return [
    ...asRecordArray(input.options),
    ...asRecordArray(input.optionContracts),
    ...(callOption ? [callOption] : []),
    ...(putOption ? [putOption] : []),
  ];
}

function getOptionType(option: CandidateRow): "call" | "put" | undefined {
  const value = getAliasedString(option, ["type", "optionType", "callPut", "putCall", "right"]).toLowerCase();
  if (value.includes("call") || value === "c") return "call";
  if (value.includes("put") || value === "p") return "put";
  return undefined;
}

function getOptionBidAskSpreadRate(option: CandidateRow): number | undefined {
  const bid = getAliasedNumber(option, ["bid", "bidPrice", "bid_price"]);
  const ask = getAliasedNumber(option, ["ask", "askPrice", "ask_price"]);
  const mid = getAliasedNumber(option, ["mid", "midPrice"]);
  const resolvedMid = mid ?? (bid !== undefined && ask !== undefined ? (bid + ask) / 2 : undefined);
  return resolvedMid && resolvedMid > 0 && bid !== undefined && ask !== undefined ? (ask - bid) / resolvedMid : undefined;
}

export function buildOptionChainQualityFromMoomooOption(
  optionOrOptions: CandidateRow | CandidateRow[] | undefined,
  params: { usOptionPermission?: MoomooOptionPermission; existingWarnings?: string[] } = {},
): OptionChainQuality {
  const options = Array.isArray(optionOrOptions) ? optionOrOptions : optionOrOptions ? [optionOrOptions] : [];
  const permissionMissing = params.usOptionPermission === "permission_missing";
  const spreadRates = options.map(getOptionBidAskSpreadRate).filter((value): value is number => value !== undefined && Number.isFinite(value));
  const volumes = options
    .map((option) => getAliasedNumber(option, ["volume", "vol", "optionVolume"]))
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  const openInterests = options
    .map((option) => getAliasedNumber(option, ["openInterest", "open_interest", "oi"]))
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  const ivs = options
    .map((option) => getAliasedNumber(option, ["iv", "impliedVolatility", "implied_volatility"]))
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  const deltas = options
    .map((option) => getAliasedNumber(option, ["delta"]))
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  const expiries = compactUnique(options.map((option) => getAliasedString(option, ["expiry", "expiration", "expirationDate", "expiryDate"])));
  const hasAnyBidAsk = options.some((option) =>
    getAliasedNumber(option, ["bid", "bidPrice", "bid_price"]) !== undefined ||
    getAliasedNumber(option, ["ask", "askPrice", "ask_price"]) !== undefined,
  );
  const hasAnyOiOrVolume = volumes.length > 0 || openInterests.length > 0;
  const qualityWarnings = compactUnique([
    ...(params.existingWarnings ?? []),
    permissionMissing ? "米国オプション相場権限不足" : undefined,
    !permissionMissing && options.length > 0 && !hasAnyBidAsk ? "Bid/Ask不足" : undefined,
    !permissionMissing && options.length > 0 && volumes.length === 0 ? "Volume不足" : undefined,
    !permissionMissing && options.length > 0 && openInterests.length === 0 ? "Open Interest不足" : undefined,
    !permissionMissing && options.length > 0 && !hasAnyOiOrVolume ? "流動性データ不足" : undefined,
  ]);

  return {
    hasOptionChain: !permissionMissing && options.length > 0,
    expirationCount: expiries.length || undefined,
    targetDteAvailable: options.some((option) => getAliasedNumber(option, ["dte", "daysToExpiration"]) !== undefined || Boolean(getAliasedString(option, ["expiry", "expiration", "expirationDate", "expiryDate"]))),
    bidAskSpreadRate: spreadRates.length > 0 ? Math.max(...spreadRates) : undefined,
    volume: volumes.length > 0 ? Math.max(...volumes) : undefined,
    openInterest: openInterests.length > 0 ? Math.max(...openInterests) : undefined,
    iv: ivs[0],
    delta: deltas[0],
    gamma: options.map((option) => getAliasedNumber(option, ["gamma"])).find((value) => value !== undefined),
    theta: options.map((option) => getAliasedNumber(option, ["theta"])).find((value) => value !== undefined),
    vega: options.map((option) => getAliasedNumber(option, ["vega"])).find((value) => value !== undefined),
    qualityWarnings,
  };
}

function buildCandidateStrategies(row: CandidateRow, underlyingPrice?: number): StrategyCandidateInput[] {
  if (Array.isArray(row.candidateStrategies)) return row.candidateStrategies as StrategyCandidateInput[];
  const strategies: StrategyCandidateInput[] = [];
  const callStrike = getAliasedNumber(row, ["callStrike"]);
  const callDte = getAliasedNumber(row, ["callDte", "dte"]);
  const putStrike = getAliasedNumber(row, ["putStrike"]);
  const putDte = getAliasedNumber(row, ["putDte", "dte"]);
  const availableCash = getAliasedNumber(row, ["availableCash", "assignmentCapitalAvailable"]);
  const longTermHoldEligible = parseBoolean(getAliasedString(row, ["longTermHoldEligible", "holdEligible"]));
  if (callStrike !== undefined) {
    strategies.push({
      strategy: "long_call",
      dte: callDte,
      strikePrice: callStrike,
      premium: getAliasedNumber(row, ["callAsk", "callMid"]),
    });
  }
  if (putStrike !== undefined) {
    strategies.push({
      strategy: "cash_secured_put_buy_to_own",
      dte: putDte,
      strikePrice: putStrike,
      premium: getAliasedNumber(row, ["putBid", "putMid"]),
      longTermHoldEligible,
      assignmentCapitalRequired: putStrike * 100,
      availableCash,
    });
  }
  if (underlyingPrice !== undefined && getAliasedNumber(row, ["coveredCallStrike"]) !== undefined) {
    strategies.push({
      strategy: "covered_call",
      dte: getAliasedNumber(row, ["coveredCallDte", "dte"]),
      strikePrice: getAliasedNumber(row, ["coveredCallStrike"]),
      stockShares: getAliasedNumber(row, ["stockShares"]),
      stockCostBasis: getAliasedNumber(row, ["stockCostBasis"]),
    });
  }
  return strategies;
}

function buildMoomooStrategyFromOption(option: CandidateRow, underlyingPrice?: number): StrategyCandidateInput | undefined {
  const optionType = getOptionType(option);
  const strikePrice = getAliasedNumber(option, ["strike", "strikePrice", "strike_price"]);
  if (!optionType || strikePrice === undefined) return undefined;
  const dte = getAliasedNumber(option, ["dte", "daysToExpiration"]);
  const bid = getAliasedNumber(option, ["bid", "bidPrice", "bid_price"]);
  const ask = getAliasedNumber(option, ["ask", "askPrice", "ask_price"]);
  const mid = getAliasedNumber(option, ["mid", "midPrice"]) ?? (bid !== undefined && ask !== undefined ? (bid + ask) / 2 : undefined);
  if (optionType === "call") {
    return {
      strategy: "long_call",
      dte,
      strikePrice,
      premium: ask ?? mid,
    };
  }
  return {
    strategy: "cash_secured_put_buy_to_own",
    dte,
    strikePrice,
    premium: bid ?? mid,
    longTermHoldEligible: parseBoolean(getAliasedString(option, ["longTermHoldEligible", "holdEligible"])),
    assignmentCapitalRequired: strikePrice * 100,
    availableCash: getAliasedNumber(option, ["availableCash", "assignmentCapitalAvailable"]),
  };
}

function buildMoomooSyntheticLeg(option: CandidateRow): SyntheticForwardLeg | undefined {
  const optionType = getOptionType(option);
  const strikePrice = getAliasedNumber(option, ["strike", "strikePrice", "strike_price"]);
  const expiry = getAliasedString(option, ["expiry", "expiration", "expirationDate", "expiryDate"]);
  if (!optionType || strikePrice === undefined || !expiry) return undefined;
  return {
    type: optionType === "call" ? "long_call" : "short_put",
    expiry,
    dte: getAliasedNumber(option, ["dte", "daysToExpiration"]),
    strikePrice,
    bid: getAliasedNumber(option, ["bid", "bidPrice", "bid_price"]),
    ask: getAliasedNumber(option, ["ask", "askPrice", "ask_price"]),
    mid: getAliasedNumber(option, ["mid", "midPrice"]),
    volume: getAliasedNumber(option, ["volume", "vol", "optionVolume"]),
    openInterest: getAliasedNumber(option, ["openInterest", "open_interest", "oi"]),
    iv: getAliasedNumber(option, ["iv", "impliedVolatility", "implied_volatility"]),
    delta: getAliasedNumber(option, ["delta"]),
  };
}

function getMoomooHistoryBarCount(input: MoomooQuoteInput): number | undefined {
  if (Array.isArray(input.historyBars)) return input.historyBars.length;
  return getAliasedNumber(input, ["historyBarCount", "dailyBarCount", "klineCount"]);
}

export function buildScreeningCandidateFromMoomooQuote(
  quote: MoomooQuoteInput,
  params: { asOf?: string; usOptionPermission?: MoomooOptionPermission } = {},
): ScreeningCandidate {
  const symbol = normalizeMoomooSymbol(getAliasedString(quote, ["symbol", "ticker", "code"]));
  const underlyingPrice = getAliasedNumber(quote, ["underlyingPrice", "lastPrice", "last_price", "price", "close"]);
  const priceAsOf = getAliasedString(quote, ["priceAsOf", "asOf", "fetchedAt", "updateTime"]) || params.asOf;
  const quotePermission = normalizeMoomooOptionPermission(quote.permissions?.usOption ?? getAliasedString(quote, ["usOptionPermission", "optionPermission", "optionPermissionStatus"]));
  const usOptionPermission = quotePermission === "unknown" ? params.usOptionPermission ?? "unknown" : quotePermission;
  const options = getMoomooOptions(quote);
  const optionChainQuality = buildOptionChainQualityFromMoomooOption(options, {
    usOptionPermission,
    existingWarnings: asStringArray(quote.qualityWarnings),
  });
  const missingFields = [
    ...asStringArray(quote.missingFields),
    !symbol ? "symbol" : undefined,
    underlyingPrice === undefined ? "underlyingPrice" : undefined,
    !priceAsOf ? "priceAsOf" : undefined,
    usOptionPermission === "permission_missing" ? "permissions.usOption" : undefined,
    !optionChainQuality.hasOptionChain ? "optionChainQuality.hasOptionChain" : undefined,
    options.length > 0 && optionChainQuality.bidAskSpreadRate === undefined ? "optionContracts.bidAsk" : undefined,
    options.length > 0 && optionChainQuality.volume === undefined ? "optionContracts.volume" : undefined,
    options.length > 0 && optionChainQuality.openInterest === undefined ? "optionContracts.openInterest" : undefined,
  ];
  const historyBarCount = getMoomooHistoryBarCount(quote);
  if (
    getAliasedString(quote, ["historyStatus", "klineStatus"]).toLowerCase().includes("insufficient") ||
    (historyBarCount !== undefined && historyBarCount < 200)
  ) {
    missingFields.push("technicalSnapshot.historyBars");
  }
  const optionStrategies = options.map((option) => buildMoomooStrategyFromOption(option, underlyingPrice)).filter((strategy): strategy is StrategyCandidateInput => Boolean(strategy));
  const technicalSnapshot = buildTechnicalSnapshot({
    ...quote,
    underlyingPrice,
    technicalSnapshot: quote.technicalSnapshot,
  });

  return {
    symbol,
    name: getAliasedString(quote, ["name", "securityName", "company"]) || undefined,
    market: getAliasedString(quote, ["market"]) || "US",
    sector: getAliasedString(quote, ["sector", "industry"]) || undefined,
    underlyingPrice,
    priceAsOf,
    dataSource: "moomoo",
    delayStatus: normalizeDelayStatus(getAliasedString(quote, ["delayStatus"]) || "unknown"),
    technicalSnapshot,
    optionChainQuality,
    candidateStrategies: optionStrategies.length > 0 ? optionStrategies : buildCandidateStrategies(quote, underlyingPrice),
    riskFlags: compactUnique([
      ...asStringArray(quote.riskFlags),
      ...asStringArray(quote.warnings),
      usOptionPermission === "permission_missing" ? "米国オプション権限不足" : undefined,
      missingFields.includes("technicalSnapshot.historyBars") ? "履歴足不足" : undefined,
      optionChainQuality.qualityWarnings.some((warning) => /Bid\/Ask|Volume|Open Interest|流動性/.test(warning)) ? "流動性注意" : undefined,
    ]),
    missingFields: compactUnique(missingFields),
  };
}

function buildSyntheticLegs(row: CandidateRow): { call?: SyntheticForwardLeg; put?: SyntheticForwardLeg } {
  const callExpiry = getAliasedString(row, ["callExpiry"]);
  const putExpiry = getAliasedString(row, ["putExpiry"]);
  const callStrike = getAliasedNumber(row, ["callStrike"]);
  const putStrike = getAliasedNumber(row, ["putStrike"]);
  return {
    call: callExpiry && callStrike !== undefined ? {
      type: "long_call",
      expiry: callExpiry,
      dte: getAliasedNumber(row, ["callDte", "dte"]),
      strikePrice: callStrike,
      bid: getAliasedNumber(row, ["callBid"]),
      ask: getAliasedNumber(row, ["callAsk"]),
      mid: getAliasedNumber(row, ["callMid"]),
      volume: getAliasedNumber(row, ["callVolume"]),
      openInterest: getAliasedNumber(row, ["callOpenInterest", "callOi"]),
      iv: getAliasedNumber(row, ["impliedVolatility", "callIv"]),
      delta: getAliasedNumber(row, ["callDelta"]),
    } : undefined,
    put: putExpiry && putStrike !== undefined ? {
      type: "short_put",
      expiry: putExpiry,
      dte: getAliasedNumber(row, ["putDte", "dte"]),
      strikePrice: putStrike,
      bid: getAliasedNumber(row, ["putBid"]),
      ask: getAliasedNumber(row, ["putAsk"]),
      mid: getAliasedNumber(row, ["putMid"]),
      volume: getAliasedNumber(row, ["putVolume"]),
      openInterest: getAliasedNumber(row, ["putOpenInterest", "putOi"]),
      iv: getAliasedNumber(row, ["impliedVolatility", "putIv"]),
      delta: getAliasedNumber(row, ["putDelta"]),
    } : undefined,
  };
}

function isLegacyCandidateShape(row: CandidateRow): boolean {
  return "Symbol" in row && ("Price" in row || "Company" in row || "SuggestedUse" in row) && !("technicalSnapshot" in row) && !("underlyingPrice" in row);
}

function buildScreeningCandidateFromImport(row: CandidateRow, params: { source: CandidateSource; asOf?: string }): { candidate?: ScreeningCandidate; warnings: string[]; errors: CandidateImportError[] } {
  const symbol = getAliasedString(row, ["symbol", "ticker"]).toUpperCase();
  const underlyingPrice = getAliasedNumber(row, ["underlyingPrice", "price", "lastPrice"]);
  const priceAsOf = getAliasedString(row, ["priceAsOf", "asOf"]) || params.asOf;
  const missingFields: string[] = [...asStringArray(row.missingFields)];
  const errors: CandidateImportError[] = [];
  const warnings: string[] = [];
  if (!symbol) {
    missingFields.push("symbol");
    errors.push({ field: "symbol", message: "symbol is required" });
  }
  if (underlyingPrice === undefined) {
    missingFields.push("underlyingPrice");
    errors.push({ symbol, field: "underlyingPrice", message: "underlyingPrice is required" });
  }
  if (!priceAsOf) {
    missingFields.push("priceAsOf");
    errors.push({ symbol, field: "priceAsOf", message: "priceAsOf is required" });
  }
  const optionChainQuality = buildOptionChainQuality(row);
  if (!optionChainQuality.hasOptionChain) warnings.push("オプションチェーン情報が不足しています。");
  const candidate: ScreeningCandidate = {
    symbol,
    name: getAliasedString(row, ["name", "company"]) || undefined,
    market: getAliasedString(row, ["market"]) || "US",
    sector: getAliasedString(row, ["sector"]) || undefined,
    underlyingPrice,
    priceAsOf,
    dataSource: toScreeningDataSource(params.source),
    delayStatus: normalizeDelayStatus(getAliasedString(row, ["delayStatus"]) || "unknown"),
    technicalSnapshot: buildTechnicalSnapshot(row),
    optionChainQuality,
    candidateStrategies: buildCandidateStrategies(row, underlyingPrice),
    riskFlags: [...asStringArray(row.riskFlags), ...asStringArray(row.warnings)],
    missingFields: Array.from(new Set(missingFields)),
  };
  return { candidate: errors.length === 0 ? candidate : undefined, warnings, errors };
}

function candidateSymbolFromScreening(candidate: ScreeningCandidate, params: { source: CandidateSource; importedAt: string; rowNumber: number; rawRow: CandidateRow; rowWarnings: string[] }): CandidateSymbol {
  const strategyFitResults = evaluateScreeningCandidate(candidate);
  const technicalTimingPatterns = [];
  try {
    technicalTimingPatterns.push(buildUpsideReversalComboPattern({ candidate, detectedAt: params.importedAt }));
  } catch {
    // Pattern readiness may be insufficient; import should continue row-by-row.
  }
  const syntheticLegs = buildSyntheticLegs(params.rawRow);
  const syntheticForwardCandidates = syntheticLegs.call && syntheticLegs.put
    ? [evaluateSyntheticForwardCandidate({
        candidate,
        longCallLeg: syntheticLegs.call,
        shortPutLeg: syntheticLegs.put,
        assignmentCapitalAvailable: getAliasedNumber(params.rawRow, ["availableCash", "assignmentCapitalAvailable"]),
        longTermHoldEligible: parseBoolean(getAliasedString(params.rawRow, ["longTermHoldEligible", "holdEligible"])),
      })]
    : [];
  return {
    id: `${params.source}-${candidate.symbol || "unknown"}-${params.importedAt}-${params.rowNumber}`,
    source: params.source,
    importedAt: params.importedAt,
    rawSourceRow: toRawStringRecord(params.rawRow),
    parseWarnings: params.rowWarnings,
    rank: getAliasedNumber(params.rawRow, ["rank"]) ?? params.rowNumber,
    symbol: candidate.symbol,
    company: candidate.name ?? candidate.symbol,
    priceUSD: candidate.underlyingPrice,
    sector: candidate.sector,
    nextEarningsDate: getAliasedString(params.rawRow, ["earningsDate", "nextEarningsDate"]) || undefined,
    earningsWarning: getAliasedString(params.rawRow, ["earningsWarning"]) || undefined,
    score: getAliasedNumber(params.rawRow, ["score"]) ?? 0,
    suggestedUse: getAliasedString(params.rawRow, ["suggestedUse"]) || "screening candidate",
    memo: getAliasedString(params.rawRow, ["memo", "notes"]) || undefined,
    watchOnly: parseBoolean(getAliasedString(params.rawRow, ["watchOnly"])) ?? false,
    screeningCandidate: candidate,
    strategyFitResults,
    technicalTimingPatterns,
    syntheticForwardCandidates,
  };
}

export function normalizeMoomooScreeningRunToCandidateImport(
  run: MoomooScreeningRun,
  importedAt = new Date().toISOString(),
): CandidateImportResult {
  const source: CandidateSource = run.source === "moomoo_file_import" ? "moomoo_file_import" : "moomoo_opend";
  const asOf = typeof run.asOf === "string" ? run.asOf : importedAt;
  const usOptionPermission = normalizeMoomooOptionPermission(run.permissions?.usOption);
  const rows = [
    ...asRecordArray(run.candidates),
    ...asRecordArray(run.quotes),
    ...asRecordArray(run.results),
  ];
  const candidates = rows.map((row) => buildScreeningCandidateFromMoomooQuote(row as MoomooQuoteInput, { asOf, usOptionPermission }));
  return parseCandidateImport(
    JSON.stringify({
      schemaVersion: "us_options_screening_candidates.v1",
      source,
      asOf,
      candidates,
    }),
    "moomoo_opend_screening_candidates.json",
    importedAt,
  );
}

export function parseCandidateImport(text: string, fileName: string, importedAt = new Date().toISOString()): CandidateImportResult {
  const lowerFileName = fileName.toLowerCase();
  const format: CandidateImportFormat = lowerFileName.endsWith(".csv") ? "csv" : "json";
  const inferredSource: CandidateSource = legacyTradingViewPattern.test(fileName)
    ? "legacy_tradingview"
    : lowerFileName.endsWith(".csv")
      ? "moomoo_file_import"
      : "manual_import";
  const jsonPayload = format === "json" ? parseJsonPayload(text) : undefined;
  const source = jsonPayload?.source ?? inferredSource;
  const asOf = jsonPayload?.asOf;
  const rows = format === "csv" ? parseCandidateCsv(text) : (jsonPayload?.rows ?? []);
  const warnings: string[] = [];
  const errors: CandidateImportError[] = [];
  if (rows.length === 0) warnings.push("候補行がありません。");
  const firstRow = rows[0] ?? {};
  if (source === "legacy_tradingview") {
    for (const header of requiredHeaders) {
      if (!(header in firstRow)) warnings.push(`${header} 列が見つかりません。`);
    }
  }
  const candidates: CandidateSymbol[] = [];
  const screeningCandidates: ScreeningCandidate[] = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    if (isLegacyCandidateShape(row)) {
      const legacyCandidate = normalizeCandidateRow(row, { importedAt, rowNumber, source });
      if (legacyCandidate.symbol) {
        candidates.push(legacyCandidate);
      } else {
        const message = `row ${legacyCandidate.rank}: Symbolが空のためスキップしました。`;
        warnings.push(message);
        errors.push({ rowNumber, message, field: "Symbol" });
      }
      return;
    }
    const normalized = buildScreeningCandidateFromImport(row, { source, asOf });
    const rowWarningMessages = normalized.warnings.map((message) => `row ${rowNumber}${getAliasedString(row, ["symbol", "ticker"]) ? ` ${getAliasedString(row, ["symbol", "ticker"]).toUpperCase()}` : ""}: ${message}`);
    warnings.push(...rowWarningMessages);
    if (normalized.errors.length > 0) {
      const rowErrors = normalized.errors.map((error) => ({ ...error, rowNumber: error.rowNumber ?? rowNumber }));
      errors.push(...rowErrors);
      warnings.push(...rowErrors.map((error) => `row ${error.rowNumber}${error.symbol ? ` ${error.symbol}` : ""}: ${error.message}`));
      return;
    }
    if (!normalized.candidate) return;
    screeningCandidates.push(normalized.candidate);
    candidates.push(candidateSymbolFromScreening(normalized.candidate, {
      source,
      importedAt,
      rowNumber,
      rawRow: row,
      rowWarnings: rowWarningMessages,
    }));
  });
  const allWarnings = [...warnings, ...candidates.flatMap((candidate) => candidate.parseWarnings ?? [])];
  return {
    candidates,
    warnings: allWarnings,
    errors,
    screeningCandidates,
    summary: {
      totalRows: rows.length,
      importedCount: candidates.length,
      warningCount: allWarnings.length,
      errorCount: errors.length,
      source,
      format,
      asOf,
      importedAt,
    },
  };
}
