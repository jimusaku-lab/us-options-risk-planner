import type { ScreeningCandidate, StrategyFitResult, SyntheticForwardEvaluation, TechnicalTimingPattern } from "@/types/screening";
import type { EntryRationaleJournal } from "@/types/domain";

export type CandidateSource =
  | "moomoo_opend"
  | "moomoo_file_import"
  | "manual"
  | "manual_import"
  | "legacy_tradingview"
  | "tradingview"
  | "imported_csv";

export type CandidateSymbol = {
  id: string;
  source: CandidateSource;
  importedAt: string;
  rawSourceRow?: Record<string, string>;
  parseWarnings?: string[];
  rank: number;
  symbol: string;
  company: string;
  priceUSD?: number;
  changePercent?: number;
  volume?: number;
  relativeVolume?: number;
  marketCapUSD?: number;
  per?: number;
  sector?: string;
  analystRating?: string;
  nextEarningsDate?: string;
  earningsWarning?: string;
  score: number;
  suggestedUse: string;
  memo?: string;
  redlist?: boolean;
  alreadyHasPosition?: boolean;
  watchOnly?: boolean;
  screeningCandidate?: ScreeningCandidate;
  strategyFitResults?: StrategyFitResult[];
  technicalTimingPatterns?: TechnicalTimingPattern[];
  syntheticForwardCandidates?: SyntheticForwardEvaluation[];
  entryRationaleJournal?: EntryRationaleJournal;
};

export type CandidateImportFormat = "json" | "csv";

export type CandidateImportError = {
  rowNumber?: number;
  symbol?: string;
  field?: string;
  message: string;
};

export type CandidateImportSummary = {
  totalRows: number;
  importedCount: number;
  warningCount: number;
  errorCount: number;
  source: CandidateSource;
  format: CandidateImportFormat;
  asOf?: string;
  importedAt: string;
};

export type CandidateImportResult = {
  candidates: CandidateSymbol[];
  warnings: string[];
  errors?: CandidateImportError[];
  summary?: CandidateImportSummary;
  screeningCandidates?: ScreeningCandidate[];
};
