import type { TradeSimulation } from "@/types/domain";
import type { FxQuote } from "@/lib/marketData";
import { applyCurrentPricePreview, getCurrentOptionPriceTargets, type CurrentOptionPricePreviewRow, type CurrentStockPricePreviewRow } from "./bulkOptionPrice";
import { calculatePositionBasisEvaluation } from "./positionBasisEvaluation";

/** Runs the actual adoption calculation, never a store action. Previewing this
 * result must not be confused with evidence already persisted by the user. */
export function projectPriceAdoption(simulations: TradeSimulation[], rows: CurrentOptionPricePreviewRow[], stocks: CurrentStockPricePreviewRow[], confirmed: boolean, fx?: FxQuote | null) {
  const next = applyCurrentPricePreview(simulations, rows, stocks, { includeConfirmedReferences: confirmed, batchId: "unpersisted-adoption-preview", currentFx:fx });
  return next.flatMap(simulation => {
    const targets = getCurrentOptionPriceTargets([simulation]);
    if (!targets.length || !rows.some(row => row.target.simulationId === simulation.id)) return [];
    const original = simulations.find(s => s.id === simulation.id)!;
    const evaluation = calculatePositionBasisEvaluation(simulation, fx);
    return [{ simulationId: simulation.id, ticker: simulation.ticker,
      optionChanged: optionEvidence(original) !== optionEvidence(simulation),
      basis: simulation.currentValuationBasis?.kind,
      reference: evaluation.reference, conservative: evaluation.conservative,
      legs: targets.map(target => ({ legId: target.legId,
        label: `${target.optionType === "call" ? "C" : "P"}${target.side === "buy" ? "買い" : "売り"}`,
        beforeMultiplier: original.optionLegs.find(l => l.id === target.legId)?.contractSize,
        candidateMultiplier: rows.find(r => r.target.targetId === target.targetId)?.saxoValuation?.contractSize,
        afterMultiplier: target.contractSize,
        multiplierSource: simulation.optionLegs.find(l => l.id === target.legId)?.contractSizeEvidence?.source,
      })),
    }];
  });
}

function legEvidence(leg: TradeSimulation["optionLegs"][number]) {
  return { id:leg.id, contractSize:leg.contractSize, contractSizeEvidence:leg.contractSizeEvidence,
    referenceQuote:leg.referenceQuote, saxoValuation:leg.saxoValuation, closeCostUSD:leg.closeCostUSD,
    closePlan:leg.closePlan, valueSnapshots:leg.valueSnapshots, valueObservations:leg.valueObservations };
}
function optionEvidence(s: TradeSimulation) {
  return JSON.stringify({ basis:s.currentValuationBasis, legs:s.optionLegs.map(legEvidence) });
}

/** Count only verified persisted changes. A successful underlying-stock update
 * is not proof that option quotes/valuation/multipliers were accepted. */
export function summarizePriceAdoption(before: TradeSimulation[], planned: TradeSimulation[], stored: TradeSimulation[], fx?: FxQuote | null) {
  let stockUpdates=0, optionUpdates=0, optionLegUpdates=0, evaluationAvailable=0;
  const problems: string[]=[];
  for (const original of before) {
    const plan=planned.find(s=>s.id===original.id), saved=stored.find(s=>s.id===original.id);
    if (!plan || !saved) continue;
    if (original.currentPriceUSD !== plan.currentPriceUSD && saved.currentPriceUSD === plan.currentPriceUSD) stockUpdates++;
    if (optionEvidence(original) !== optionEvidence(plan)) {
      if (optionEvidence(plan) !== optionEvidence(saved)) problems.push(`${saved.ticker}: 保存後の価格証拠が一致しません`);
      else {
        optionUpdates++;
        optionLegUpdates+=plan.optionLegs.filter(l=>{const old=original.optionLegs.find(o=>o.id===l.id);return !old || JSON.stringify(legEvidence(l))!==JSON.stringify(legEvidence(old));}).length;
      }
    }
    if (!getCurrentOptionPriceTargets([saved]).length) continue;
    const result=calculatePositionBasisEvaluation(saved,fx).reference;
    if (result.kind === "available") evaluationAvailable++;
    else problems.push(`${saved.ticker}: ${result.reason ?? "評価未計算"}`);
  }
  return { stockUpdates, optionUpdates, optionLegUpdates, evaluationAvailable, problems,
    message:`株価更新${stockUpdates}件 / オプション価格・評価証拠保存${optionUpdates}建玉（${optionLegUpdates}脚） / 全管理中の参考評価計算可${evaluationAvailable}件${problems.length?` / ${problems.join(" / ")}`:""}` };
}
