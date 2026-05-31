export type CandidateSource = "tradingview" | "manual" | "imported_csv";

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
};

export type CandidateImportResult = {
  candidates: CandidateSymbol[];
  warnings: string[];
};
