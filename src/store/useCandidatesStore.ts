import { create } from "zustand";
import type { CandidateImportSummary, CandidateReviewChecklistState, CandidateSymbol } from "@/types/candidates";
import type { EntryRationaleJournal } from "@/types/domain";

const CANDIDATES_KEY = "us-options-candidate-symbols-v1";

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJson<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

type CandidatesStore = {
  candidates: CandidateSymbol[];
  lastImportedAt?: string;
  importWarnings: string[];
  lastImportSummary?: CandidateImportSummary;
  importCandidateSymbols: (candidates: CandidateSymbol[], warnings?: string[], summary?: CandidateImportSummary) => void;
  clearCandidates: () => void;
  markCandidateWatchOnly: (id: string, watchOnly: boolean) => void;
  updateCandidateJournal: (id: string, journal: EntryRationaleJournal) => void;
  updateCandidateChecklist: (id: string, checklist: CandidateReviewChecklistState) => void;
};

const initialCandidates = loadJson<CandidateSymbol[]>(CANDIDATES_KEY, []);

export const useCandidatesStore = create<CandidatesStore>((set) => ({
  candidates: initialCandidates,
  lastImportedAt: initialCandidates[0]?.importedAt,
  importWarnings: [],
  importCandidateSymbols: (candidates, warnings = [], summary) =>
    set((state) => {
      const previousById = new Map(state.candidates.map((candidate) => [candidate.id, candidate]));
      const restoredCandidates = candidates.map((candidate) => {
        const previous = previousById.get(candidate.id);
        if (!previous) return candidate;
        return {
          ...candidate,
          entryRationaleJournal: candidate.entryRationaleJournal ?? previous.entryRationaleJournal,
          reviewChecklistStates: candidate.reviewChecklistStates?.length ? candidate.reviewChecklistStates : previous.reviewChecklistStates,
        };
      });
      saveJson(CANDIDATES_KEY, restoredCandidates);
      return {
        candidates: restoredCandidates,
        lastImportedAt: restoredCandidates[0]?.importedAt,
        importWarnings: warnings,
        lastImportSummary: summary,
      };
    }),
  clearCandidates: () =>
    set(() => {
      saveJson(CANDIDATES_KEY, []);
      return { candidates: [], lastImportedAt: undefined, importWarnings: [], lastImportSummary: undefined };
    }),
  markCandidateWatchOnly: (id, watchOnly) =>
    set((state) => {
      const candidates = state.candidates.map((candidate) =>
        candidate.id === id ? { ...candidate, watchOnly } : candidate,
      );
      saveJson(CANDIDATES_KEY, candidates);
      return { candidates };
    }),
  updateCandidateJournal: (id, journal) =>
    set((state) => {
      const candidates = state.candidates.map((candidate) =>
        candidate.id === id ? { ...candidate, entryRationaleJournal: journal } : candidate,
      );
      saveJson(CANDIDATES_KEY, candidates);
      return { candidates };
    }),
  updateCandidateChecklist: (id, checklist) =>
    set((state) => {
      const candidates = state.candidates.map((candidate) =>
        candidate.id === id
          ? {
              ...candidate,
              reviewChecklistStates: [
                checklist,
                ...(candidate.reviewChecklistStates ?? []).filter((item) => item.strategy !== checklist.strategy),
              ],
            }
          : candidate,
      );
      saveJson(CANDIDATES_KEY, candidates);
      return { candidates };
    }),
}));
