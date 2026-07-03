import type { CandidateSymbol } from "@/types/candidates";
import type { EntryRationaleJournal, EntryRationaleJournalStatus, JournalAccountCode, StrategyType, TradeSimulation } from "@/types/domain";

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function inferJournalAccountCode(simulation: Pick<TradeSimulation, "accountEnvironment" | "accountCode">): JournalAccountCode {
  if (simulation.accountEnvironment === "DEMO_JPY_BASE") return "DEMO";
  return simulation.accountCode ?? "UNKNOWN";
}

export function inferJournalStatus(simulation: Pick<TradeSimulation, "status">): EntryRationaleJournalStatus {
  if (simulation.status === "planned") return "planned";
  if (simulation.status === "open") return "entered";
  return "closed";
}

export function createJournalForCandidate(candidate: CandidateSymbol, strategy: StrategyType = "custom"): EntryRationaleJournal {
  const timestamp = nowIso();
  const tags = [
    ...(candidate.technicalTimingPatterns?.length ? ["上昇転換コンボ候補"] : []),
    ...(candidate.syntheticForwardCandidates?.length ? ["シンセティック確認"] : []),
    ...(candidate.earningsWarning ? ["決算/イベント注意"] : []),
  ];
  return {
    id: createId("journal"),
    candidateId: candidate.id,
    symbol: candidate.symbol,
    underlyingName: candidate.company,
    strategy,
    accountCode: "UNKNOWN",
    status: "candidate",
    createdAt: timestamp,
    updatedAt: timestamp,
    entryReason: "",
    technicalTags: tags,
    technicalMemo: [
      candidate.strategyFitResults?.slice(0, 3).map((result) => `${result.strategy}: ${result.fitLevel}`).join(" / "),
      candidate.technicalTimingPatterns?.[0] ? `上昇転換コンボ候補: ${candidate.technicalTimingPatterns[0].fitLevel}` : "",
      candidate.syntheticForwardCandidates?.[0] ? `シンセティック: ${candidate.syntheticForwardCandidates[0].fitLevel}` : "",
    ].filter(Boolean).join("\n"),
    expectedScenario: candidate.suggestedUse || "",
    profitTakingPlan: "",
    stopLossPlan: "",
    invalidationCondition: "",
    chartEvidence: [],
    review: { outcome: "not_reviewed" },
  };
}

export function createJournalForSimulation(simulation: TradeSimulation): EntryRationaleJournal {
  const timestamp = nowIso();
  return {
    id: createId("journal"),
    positionId: simulation.id,
    symbol: simulation.ticker,
    underlyingName: simulation.underlyingName,
    strategy: simulation.strategyType,
    accountCode: inferJournalAccountCode(simulation),
    status: inferJournalStatus(simulation),
    entryDate: simulation.entryDate,
    createdAt: timestamp,
    updatedAt: timestamp,
    entryReason: "",
    technicalTags: [],
    technicalMemo: "",
    expectedScenario: "",
    profitTakingPlan: "",
    stopLossPlan: "",
    invalidationCondition: "",
    chartEvidence: [],
    review: { outcome: "not_reviewed" },
  };
}

export function prepareJournalForSimulation(candidate: CandidateSymbol, simulation: TradeSimulation): EntryRationaleJournal {
  const base = candidate.entryRationaleJournal ?? createJournalForCandidate(candidate, simulation.strategyType);
  return {
    ...base,
    candidateId: base.candidateId ?? candidate.id,
    positionId: simulation.id,
    symbol: simulation.ticker,
    underlyingName: simulation.underlyingName,
    strategy: simulation.strategyType,
    accountCode: inferJournalAccountCode(simulation),
    status: inferJournalStatus(simulation),
    entryDate: simulation.entryDate,
    updatedAt: nowIso(),
    review: base.review ?? { outcome: "not_reviewed" },
  };
}

export function updateJournalTimestamp(journal: EntryRationaleJournal): EntryRationaleJournal {
  return { ...journal, updatedAt: nowIso() };
}

export function getJournalStatusLabel(journal: EntryRationaleJournal | undefined, simulationStatus?: TradeSimulation["status"]): string {
  if (!journal || !journal.entryReason.trim()) return "根拠未記録";
  if ((simulationStatus === "closed" || simulationStatus === "expired" || simulationStatus === "assigned" || journal.status === "closed") && (journal.review?.outcome ?? "not_reviewed") === "not_reviewed") {
    return "振り返り未記入";
  }
  return "根拠あり";
}

export function getJournalStatusTone(label: string): "teal" | "amber" | "slate" {
  if (label === "根拠あり") return "teal";
  if (label === "振り返り未記入") return "amber";
  return "slate";
}
