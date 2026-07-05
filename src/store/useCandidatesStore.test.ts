import { beforeEach, describe, expect, it } from "vitest";
import { useCandidatesStore } from "@/store/useCandidatesStore";
import type { CandidateSymbol } from "@/types/candidates";

function candidate(symbol = "NVDA"): CandidateSymbol {
  return {
    id: `candidate-${symbol}`,
    source: "manual_import",
    importedAt: "2026-07-05T00:00:00.000Z",
    rank: 1,
    symbol,
    company: symbol,
    priceUSD: 100,
    score: 80,
    suggestedUse: "test",
  };
}

describe("useCandidatesStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useCandidatesStore.setState({
      candidates: [],
      importWarnings: [],
      lastImportedAt: undefined,
      lastImportSummary: undefined,
    });
  });

  it("restores review checklist and journal for same candidate id on re-import", () => {
    const base = candidate();
    useCandidatesStore.getState().importCandidateSymbols([
      {
        ...base,
        reviewChecklistStates: [
          {
            candidateId: base.id,
            symbol: base.symbol,
            strategy: "long_call",
            updatedAt: "2026-07-05T01:00:00.000Z",
            items: [{ id: "chart", label: "チャート根拠を確認した", checked: true, required: true, source: "common" }],
          },
        ],
        entryRationaleJournal: {
          id: "journal-1",
          candidateId: base.id,
          symbol: base.symbol,
          underlyingName: base.company,
          strategy: "custom",
          accountCode: "UNKNOWN",
          status: "candidate",
          createdAt: "2026-07-05T00:00:00.000Z",
          updatedAt: "2026-07-05T01:00:00.000Z",
          entryReason: "候補レビューを根拠メモへ反映済み",
          technicalTags: ["候補レビュー確認"],
          technicalMemo: "",
          expectedScenario: "",
          profitTakingPlan: "",
          stopLossPlan: "",
          invalidationCondition: "",
          chartEvidence: [],
          review: { outcome: "not_reviewed" },
        },
      },
    ]);

    useCandidatesStore.getState().importCandidateSymbols([{ ...base, importedAt: "2026-07-05T02:00:00.000Z" }]);

    const restored = useCandidatesStore.getState().candidates[0];
    const serialized = JSON.stringify(restored);
    expect(restored.reviewChecklistStates?.[0].items[0].checked).toBe(true);
    expect(restored.entryRationaleJournal?.entryReason).toContain("候補レビュー");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("accountId");
    expect(serialized).not.toContain("localPath");
    expect(serialized).not.toContain("apiKey");
  });
});
