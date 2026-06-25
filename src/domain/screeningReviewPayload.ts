import type { ExternalReviewPayload, ScreeningCandidate, StrategyFitResult, SyntheticForwardEvaluation, TechnicalTimingPattern } from "@/types/screening";

const sensitiveKeyPattern = /(token|secret|password|credential|accountNumber|accountId|localPath|path|apiKey|refresh)/i;
const localPathPattern = /(?:\/Users\/|\/home\/|[A-Za-z]:\\)/;

function sanitizeForExternalReview(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, currentValue) => {
      if (sensitiveKeyPattern.test(key)) return undefined;
      if (typeof currentValue === "string" && localPathPattern.test(currentValue)) return "[removed-local-path]";
      return currentValue;
    }),
  ) as unknown;
}

export function createExternalReviewPayload(params: {
  generatedAt: string;
  appVersion: string;
  candidate: ScreeningCandidate;
  strategyFitResults: StrategyFitResult[];
  technicalTimingPatterns?: TechnicalTimingPattern[];
  syntheticForwardCandidates?: SyntheticForwardEvaluation[];
  userStrategyAssumptions?: string[];
  dataQualityNotes?: string[];
}): ExternalReviewPayload {
  return {
    generatedAt: params.generatedAt,
    appVersion: params.appVersion,
    candidate: sanitizeForExternalReview(params.candidate) as ScreeningCandidate,
    strategyFitResults: sanitizeForExternalReview(params.strategyFitResults) as StrategyFitResult[],
    technicalTimingPatterns: params.technicalTimingPatterns
      ? (sanitizeForExternalReview(params.technicalTimingPatterns) as TechnicalTimingPattern[])
      : undefined,
    syntheticForwardCandidates: params.syntheticForwardCandidates
      ? (sanitizeForExternalReview(params.syntheticForwardCandidates) as SyntheticForwardEvaluation[])
      : undefined,
    userStrategyAssumptions: params.userStrategyAssumptions ?? [],
    dataQualityNotes: params.dataQualityNotes ?? [],
    noPersonalCredentialIncluded: true,
  };
}
