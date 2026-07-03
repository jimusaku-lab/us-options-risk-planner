import { create } from "zustand";
import type { CandidateImportSummary, CandidateSymbol } from "@/types/candidates";
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
};

const initialCandidates = loadJson<CandidateSymbol[]>(CANDIDATES_KEY, []);

export const useCandidatesStore = create<CandidatesStore>((set) => ({
  candidates: initialCandidates,
  lastImportedAt: initialCandidates[0]?.importedAt,
  importWarnings: [],
  importCandidateSymbols: (candidates, warnings = [], summary) =>
    set(() => {
      saveJson(CANDIDATES_KEY, candidates);
      return {
        candidates,
        lastImportedAt: candidates[0]?.importedAt,
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
}));
