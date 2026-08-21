import type { FxQuote } from "@/lib/marketData";
import type { TradeSimulation } from "@/types/domain";

export type ResolvedCurrentEstimateFx =
  | { kind: "resolved"; rateJPYPerUSD: number; source: "readonly_current_quote" | "saved_reference_fx" | "saved_manual_fx"; rateDate?: string; fetchedAt?: string; provider?: string }
  | { kind: "missing" };

function validRate(value: number | undefined): value is number { return value !== undefined && Number.isFinite(value) && value > 1; }

export function resolveCurrentEstimateFx(simulation: TradeSimulation, currentQuote?: FxQuote | null): ResolvedCurrentEstimateFx {
  if (currentQuote?.pair === "USDJPY" && validRate(currentQuote.rate) && Boolean(currentQuote.source) && Boolean(currentQuote.date) && Boolean(currentQuote.fetchedAt)) {
    return { kind: "resolved", rateJPYPerUSD: currentQuote.rate, source: "readonly_current_quote", rateDate: currentQuote.date, fetchedAt: currentQuote.fetchedAt, provider: currentQuote.source };
  }
  if (validRate(simulation.referenceFxRateJPY)) return { kind: "resolved", rateJPYPerUSD: simulation.referenceFxRateJPY, source: "saved_reference_fx" };
  if (validRate(simulation.fxRateJPY)) return { kind: "resolved", rateJPYPerUSD: simulation.fxRateJPY, source: "saved_manual_fx" };
  return { kind: "missing" };
}

export function formatCurrentEstimateFxEvidence(fx: ResolvedCurrentEstimateFx): string | undefined {
  if (fx.kind === "missing") return undefined;
  const evidence = [fx.provider, fx.rateDate].filter(Boolean).join(" / ");
  return `現在換算為替 ${fx.rateJPYPerUSD} JPY/USD${evidence ? ` / ${evidence}` : ""}`;
}
