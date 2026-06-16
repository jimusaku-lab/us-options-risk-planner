import type { CandidateImportResult, CandidateSource, CandidateSymbol } from "@/types/candidates";

type CandidateRow = Record<string, unknown>;

const requiredHeaders = ["Rank", "Symbol", "Company", "Price", "Score", "SuggestedUse"];

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function normalizeMinus(value: string): string {
  return value.replace(/\u2212/g, "-");
}

function toRawStringRecord(row: CandidateRow): Record<string, string> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === undefined || value === null ? "" : String(value)]));
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

function parseJsonRows(text: string): CandidateRow[] {
  const parsed = JSON.parse(stripBom(text)) as unknown;
  if (Array.isArray(parsed)) return parsed as CandidateRow[];
  if (parsed && typeof parsed === "object") {
    const maybeObject = parsed as Record<string, unknown>;
    if (Array.isArray(maybeObject.candidates)) return maybeObject.candidates as CandidateRow[];
    if (Array.isArray(maybeObject.data)) return maybeObject.data as CandidateRow[];
  }
  throw new Error("候補JSONは配列、または candidates/data 配列を含む形式にしてください。");
}

export function parseCandidateImport(text: string, fileName: string, importedAt = new Date().toISOString()): CandidateImportResult {
  const source: CandidateSource = fileName.toLowerCase().endsWith(".csv") ? "imported_csv" : "tradingview";
  const rows = fileName.toLowerCase().endsWith(".csv") ? parseCandidateCsv(text) : parseJsonRows(text);
  const warnings: string[] = [];
  if (rows.length === 0) warnings.push("候補行がありません。");
  const firstRow = rows[0] ?? {};
  for (const header of requiredHeaders) {
    if (!(header in firstRow)) warnings.push(`${header} 列が見つかりません。`);
  }
  const candidates = rows
    .map((row, index) => normalizeCandidateRow(row, { importedAt, rowNumber: index + 1, source }))
    .filter((candidate) => {
      if (candidate.symbol) return true;
      warnings.push(`row ${candidate.rank}: Symbolが空のためスキップしました。`);
      return false;
    });
  return {
    candidates,
    warnings: [...warnings, ...candidates.flatMap((candidate) => candidate.parseWarnings ?? [])],
  };
}
