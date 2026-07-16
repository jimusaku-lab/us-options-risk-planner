export type SaxoHistoryCompletionState = "none" | "candidate" | "official" | "ignored" | "broken";

export type SaxoHistoryCompletionRow = {
  state: SaxoHistoryCompletionState;
  creatable: boolean;
};

export type SaxoHistoryCompletionSummary = {
  creatableCount: number;
  pendingConfirmationCount: number;
  recoveryCount: number;
  actionRequiredCount: number;
  completedOrOutOfScopeCount: number;
  isComplete: boolean;
};

/** The candidate state is still user work; only official, ignored, and out-of-scope rows are complete. */
export function summarizeSaxoHistoryCompletion(rows: SaxoHistoryCompletionRow[]): SaxoHistoryCompletionSummary {
  const creatableCount = rows.filter((row) => row.creatable).length;
  const pendingConfirmationCount = rows.filter((row) => row.state === "candidate").length;
  const recoveryCount = rows.filter((row) => row.state === "broken").length;
  const actionRequiredCount = creatableCount + pendingConfirmationCount + recoveryCount;
  return {
    creatableCount,
    pendingConfirmationCount,
    recoveryCount,
    actionRequiredCount,
    completedOrOutOfScopeCount: Math.max(0, rows.length - actionRequiredCount),
    isComplete: rows.length > 0 && actionRequiredCount === 0,
  };
}
