import type {
  PositionDraft,
  PublicScreeningCandidateInput,
  ScreeningCandidate,
  ScreeningCompletenessResult,
  AdvancedStrategyReview,
  StrategyPrecisionReview,
  StrategyFitResult,
  StrategySuitability,
  SyntheticForwardEvaluation,
  TechnicalTimingPattern,
  StrategyCandidateKind,
} from "@/types/screening";
import type { EntryRationaleJournal } from "@/types/domain";

export type CandidateSource =
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
  publicScreeningInput?: PublicScreeningCandidateInput;
  screeningCompleteness?: ScreeningCompletenessResult;
  strategySuitability?: StrategySuitability[];
  positionDrafts?: PositionDraft[];
  advancedStrategyReviews?: AdvancedStrategyReview[];
  strategyPrecisionReviews?: StrategyPrecisionReview[];
  reviewChecklistStates?: CandidateReviewChecklistState[];
  strategyFitResults?: StrategyFitResult[];
  technicalTimingPatterns?: TechnicalTimingPattern[];
  syntheticForwardCandidates?: SyntheticForwardEvaluation[];
  entryRationaleJournal?: EntryRationaleJournal;
};

export type CandidateReviewChecklistItem = {
  id: string;
  label: string;
  checked: boolean;
  required: boolean;
  source: "common" | "strategy" | "manual";
};

export type CandidateReviewChecklistState = {
  candidateId: string;
  symbol: string;
  strategy: StrategyCandidateKind;
  updatedAt: string;
  items: CandidateReviewChecklistItem[];
  note?: string;
};

export type CandidateReviewReadinessStatus = "ready_for_review" | "needs_review" | "blocked";

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
