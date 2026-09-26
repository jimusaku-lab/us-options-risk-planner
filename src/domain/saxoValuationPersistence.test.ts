import { afterEach, describe, expect, it } from "vitest";
import { valuationFixture, valuationPositions, valuationRows } from "@/test/fixtures/saxoValuation";
import { applyCurrentOptionPricePreview } from "./bulkOptionPrice";
import { calculatePositionBasisEvaluation } from "./positionBasisEvaluation";
import { projectPriceAdoption } from "./priceAdoptionProjection";
import { emptyStrategyLedger, materializeStrategyEntries, type StrategyLedger } from "./strategyLedger";
import { hydrateStrategyRecords, normalizeSimulation, useOptionsStore } from "@/store/useOptionsStore";
import type { TradeSimulation } from "@/types/domain";

const prior = useOptionsStore.getState();
afterEach(() => { useOptionsStore.setState(prior); localStorage.clear(); });
function roundTrip(s: TradeSimulation, ledger = emptyStrategyLedger(), mid = false) {
  const initial = hydrateStrategyRecords([s], ledger).map(s => normalizeSimulation(s, "live"));
  useOptionsStore.setState({activeWorkspace:"live", simulations:initial, simulationsByWorkspace:{demo:[],live:initial}, strategyLedgersByWorkspace:{demo:emptyStrategyLedger(),live:ledger}, wheelCyclesByWorkspace:{demo:[],live:[]},wheelEventsByWorkspace:{demo:[],live:[]}});
  const source = useOptionsStore.getState().simulations[0];
  const rows = valuationRows(source, valuationPositions(source), mid);
  const projected=projectPriceAdoption([source],rows,[],true)[0];
  const next = applyCurrentOptionPricePreview([source], rows, {includeConfirmedReferences:true});
  useOptionsStore.getState().applySimulationBatch(next);
  const live = useOptionsStore.getState().simulations[0];
  const envelope = JSON.parse(localStorage.getItem("us-options-simulations-v2")!);
  const reloaded = hydrateStrategyRecords(envelope.live,envelope.strategyLedgers.live).map(s=>normalizeSimulation(s,"live"))[0];
  expect(reloaded.currentValuationBasis).toEqual(next[0].currentValuationBasis);
  expect(reloaded.optionLegs.map(l=>l.saxoValuation)).toEqual(next[0].optionLegs.map(l=>l.saxoValuation));
  expect(reloaded.optionLegs.map(l=>l.contractSizeEvidence)).toEqual(next[0].optionLegs.map(l=>l.contractSizeEvidence));
  expect(calculatePositionBasisEvaluation(reloaded).reference).toEqual(calculatePositionBasisEvaluation(live).reference);
  expect(calculatePositionBasisEvaluation(live).reference).toEqual(projected.reference);
  return reloaded;
}
describe("R16.1 production store and ledger evidence persistence",()=>{
  it("keeps projected and stored broker amount equal for partial synthetic remaining put",()=>{
    const s=valuationFixture();s.strategyType="synthetic_forward";
    s.optionLegs[1].type="put";s.optionLegs[1].strikeUSD=100;
    delete s.optionLegs[1].contractSize;
    s.optionCloseExecutions=[{id:"fiction-close",legId:s.optionLegs[0].id,contracts:1,closeDate:"2026-09-20",closePriceUSD:12,commissionUSD:2,settlementCurrency:"USD",confirmed:true,closeKind:"buyback",source:"broker_statement"}];
    const result=roundTrip(s);
    expect(result.optionCloseExecutions).toEqual(s.optionCloseExecutions);
    expect(result.optionLegs[1].contractSize).toBe(100);
    expect(calculatePositionBasisEvaluation(result).reference.kind).toBe("available");
  });
  it("retains broker valuation through applySimulationBatch and reload with a canonical strategy ledger",()=>{
    const s=valuationFixture();s.strategyGroupId=s.id;
    const ledger:StrategyLedger={schema:1,revision:1,commits:[s.id],fills:s.optionLegs.map((l,i)=>({key:`fixture-fill-${i}`,revision:"1",aliases:[],identity:{environment:"live",broker:"fixture",accountKey:l.saxoAccountKey!,kind:"fill",id:`fiction-${i}`},brokerPositionId:l.saxoPositionId,contract:{underlying:s.ticker,instrument:String(l.saxoUic),ticker:s.ticker,optionType:l.type,side:l.side,strike:l.strikeUSD,expiry:l.expiryDate,multiplier:l.contractSize!,currency:"USD",settlement:"physical",deliverable:"fixture"},execution:s.optionEntryExecutions![i]})),allocations:s.optionLegs.map((l,i)=>({strategyId:s.id,legId:l.id,eventKey:`fixture-fill-${i}`,revision:"1",contracts:l.quantity}))};
    s.optionEntryExecutions=materializeStrategyEntries(s.id,ledger,[]).entries;
    expect(calculatePositionBasisEvaluation(roundTrip(s,ledger)).reference.amount).toBe(-55.45);
  });
  it("retains direct multiplier for legacy single P/JPY with missing multiplier",()=>{
    const s=valuationFixture(false),l=s.optionLegs[0];s.accountCode="P";s.accountCurrency="JPY";s.accountEnvironment="PROD_P_JPY_SETTLEMENT";
    s.fixtureMeta={source:"demo",isRealMoney:false,broker:"SaxoBank",purpose:"development-fixture",createdAt:"2026-09-26T00:00:00Z",notes:"",saxoAccountKey:l.saxoAccountKey,saxoUic:l.saxoUic,saxoPositionId:l.saxoPositionId};delete l.saxoAccountKey;delete l.saxoUic;delete l.saxoPositionId;delete l.contractSize;
    Object.assign(s.optionEntryExecutions![0],{settlementCurrency:"JPY",brokerBookedAmountJPY:-200000,commissionUSD:undefined});
    expect(roundTrip(s,undefined,true).optionLegs[0].contractSize).toBe(100);
  });
});
