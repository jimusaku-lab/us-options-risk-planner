import { describe, expect, it } from "vitest";
import { summarizeSaxoHistoryCompletion } from "./saxoHistoryCompletion";

describe("Saxo history completion summary", () => {
  it("treats a created but unconfirmed draft as user work", () => {
    const summary = summarizeSaxoHistoryCompletion([
      { state: "candidate", creatable: false },
      { state: "official", creatable: false },
    ]);

    expect(summary.actionRequiredCount).toBe(1);
    expect(summary.pendingConfirmationCount).toBe(1);
    expect(summary.isComplete).toBe(false);
  });

  it("marks only reflected, ignored, and out-of-scope rows as complete", () => {
    const summary = summarizeSaxoHistoryCompletion([
      { state: "official", creatable: false },
      { state: "ignored", creatable: false },
      { state: "none", creatable: false },
    ]);

    expect(summary.actionRequiredCount).toBe(0);
    expect(summary.recoveryCount).toBe(0);
    expect(summary.completedOrOutOfScopeCount).toBe(3);
    expect(summary.isComplete).toBe(true);
  });
});
