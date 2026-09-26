import { describe, expect, it } from "vitest";
import type { TradeSimulation } from "@/types/domain";
import type { SaxoApiPositionSnapshot } from "@/features/saxo/saxoAccountSync";
import { attachPositionValuations, parentPriceBasis, storedSaxoValuation } from "./saxoValuation";
import { applyCurrentOptionPricePreview, createCurrentOptionPricePreviewRow, getCurrentOptionPriceTargets, getBulkApplicableTargetIds } from "./bulkOptionPrice";
import { calculatePositionBasisEvaluation } from "./positionBasisEvaluation";
import { diagnosePriceUpdate } from "./priceUpdateDiagnostic";

import { valuationFixture, valuationPositions, valuationRows } from "@/test/fixtures/saxoValuation";
const at="2026-09-26T01:00:00Z";
const apply=(s:TradeSimulation,rows=valuationRows(s))=>applyCurrentOptionPricePreview([s],rows,{includeConfirmedReferences:true,capturedAt:at})[0];
describe("R16 source-isolated Saxo valuation",()=>{
 it("adopts entire parent only after consent, without preview mutation or actual/close/time-value writes",()=>{
  const s=valuationFixture(),before=JSON.stringify(s),rows=valuationRows(s);
  expect(parentPriceBasis(s,rows,false)).toBeUndefined();expect(getBulkApplicableTargetIds(rows,[s])).toHaveLength(0);
  expect(applyCurrentOptionPricePreview([s],rows)[0]).toBe(s);expect(JSON.stringify(s)).toBe(before);
  const next=apply(s,rows);expect(storedSaxoValuation(next).amount).toBe(-55.45);
  expect(next.optionLegs.map(l=>l.closePlan)).toEqual(s.optionLegs.map(l=>l.closePlan));
  expect(next.optionLegs.map(l=>l.valueObservations)).toEqual([undefined,undefined]);expect(next.timeValueParentHistory).toBeUndefined();
  expect(next.optionEntryExecutions).toBe(s.optionEntryExecutions);expect(next.optionCloseExecutions).toBe(s.optionCloseExecutions);expect(next.status).toBe("open");
  expect(storedSaxoValuation(JSON.parse(JSON.stringify(next))).amount).toBe(-55.45);
 });
 it("uses signed raw P/L and costs, not rounded price or app commissions",()=>{
  const s=valuationFixture(),p=valuationPositions(s);p[0].valuation!.profitLossOnTrade=-546.20;p[1].valuation!.profitLossOnTrade=74.44;
  s.optionLegs.forEach(l=>l.closePlan!.commissionUSD=999);
  expect(calculatePositionBasisEvaluation(apply(s,valuationRows(s,p)),undefined,"2026-09-26").reference).toMatchObject({amount:-480.72,currency:"USD",valuationSource:"saxo-position"});
 });
 it("never mixes one midpoint leg with one broker leg; incomplete broker pair preserves prior",()=>{
  const s=valuationFixture(),rows=valuationRows(s);rows[0]=valuationRows(s,valuationPositions(s),true)[0];
  expect(parentPriceBasis(s,rows,true)).toBe("saxo-position");
  delete rows[1].saxoValuation;expect(parentPriceBasis(s,rows,true)).toBeUndefined();
  const next=apply(s,rows);expect(next.currentValuationBasis).toBeUndefined();expect(next.optionLegs.every(l=>!l.saxoValuation)).toBe(true);
  // R15's separate conservative Bid/Ask adoption remains available; it cannot create a mixed reference basis.
  expect(next.optionLegs.map(l=>l.referenceQuote)).toEqual(s.optionLegs.map(l=>l.referenceQuote));
 });
 it("returns to complete midpoint only on next explicit adoption",()=>{
  const s=apply(valuationFixture());const rows=valuationRows(s,valuationPositions(s),true);
  expect(s.currentValuationBasis?.kind).toBe("saxo-position");const next=apply(s,rows);
  expect(next.currentValuationBasis?.kind).toBe("midpoint");expect(calculatePositionBasisEvaluation(next).reference.valuationSource).toBeUndefined();
  expect(next.optionLegs[0].saxoValuation).toEqual(s.optionLegs[0].saxoValuation);
  expect(apply(next,valuationRows(next,[]))).toBe(next);
 });
 it.each(["accountKey","uic","positionId","underlyingSymbol","strike","expiry","side","quantity"])("rejects mismatched %s rather than ticker-only matching",key=>{
  const s=valuationFixture(),p=valuationPositions(s);(p[0] as unknown as Record<string,unknown>)[key]=typeof(p[0] as unknown as Record<string,unknown>)[key]==="number"?999:"different";
  expect(apply(s,valuationRows(s,p))).toBe(s);
 });
 it("rejects duplicate lots and conflicting specifications",()=>{
  const s=valuationFixture(),p=valuationPositions(s);expect(apply(s,valuationRows(s,[...p,{...p[0]}]))).toBe(s);
  p[0].specificationConflicts=["currency"];expect(apply(s,valuationRows(s,p))).toBe(s);
 });
 it.each(["profitLossOnTrade","tradeCostsTotal","quoteCurrency","quoteCurrencySource","calculationReliability","fetchedAt"])("missing direct %s never becomes zero or borrowed evidence",key=>{
  const s=valuationFixture(),p=valuationPositions(s);delete(p[0].valuation as unknown as Record<string,unknown>)[key];expect(apply(s,valuationRows(s,p))).toBe(s);
 });
 it("accepts explicit numeric zero but not unknown quality or currencies; Approx requires consent",()=>{
  const s=valuationFixture(false),p=valuationPositions(s);Object.assign(p[0].valuation!,{currentPrice:0,profitLossOnTrade:0,tradeCostsTotal:0,calculationReliability:"ApproximatedPrice"});
  const rows=valuationRows(s,p);expect(parentPriceBasis(s,rows,false)).toBeUndefined();expect(storedSaxoValuation(apply(s,rows)).amount).toBe(0);
  for(const reliability of ["UnknownPrice","NoMarketAccess","PricePending"]){p[0].valuation!.calculationReliability=reliability;expect(apply(s,valuationRows(s,p))).toBe(s);}
  p[0].valuation!.calculationReliability="Ok";p[0].valuation!.quoteCurrency="JPY";expect(apply(s,valuationRows(s,p))).toBe(s);
 });
 it.each(["ticker","accountEnvironment","accountCurrency"])("rejects stale midpoint preview after %s edit",key=>{
  const s=valuationFixture(),rows=valuationRows(s,valuationPositions(s),true);(s as unknown as Record<string,unknown>)[key]="different";expect(apply(s,rows)).toBe(s);
 });
 it.each(["saxoUic","saxoPositionId","saxoAccountKey"])("rejects stale midpoint/valuation after %s edit",key=>{
  const s=valuationFixture(),rows=valuationRows(s,valuationPositions(s),true);(s.optionLegs[0] as unknown as Record<string,unknown>)[key]=key==="saxoUic"?999:"different";expect(apply(s,rows)).toBe(s);
 });
 it("legacy P/JPY missing multiplier is completed only from same-contract direct detail at adoption",()=>{
  const s=valuationFixture(false),l=s.optionLegs[0];s.accountCode="P";s.accountCurrency="JPY";s.accountEnvironment="PROD_P_JPY_SETTLEMENT";
  s.fixtureMeta={source:"demo",isRealMoney:false,broker:"SaxoBank",purpose:"development-fixture",createdAt:at,notes:"",saxoAccountKey:l.saxoAccountKey,saxoPositionId:l.saxoPositionId,saxoUic:l.saxoUic};delete l.saxoAccountKey;delete l.saxoPositionId;delete l.saxoUic;delete l.contractSize;
  s.optionEntryExecutions![0]={...s.optionEntryExecutions![0],settlementCurrency:"JPY",brokerBookedAmountJPY:-200000,commissionUSD:undefined};
  const rows=valuationRows(s,valuationPositions(s),true);rows[0]=attachPositionValuations([s],[createCurrentOptionPricePreviewRow(rows[0].target,{environment:"live",status:"available",classification:"available",source:"fixture",message:"",fetchedAt:at,bid:47.55,ask:50.85,quoteDiagnostics:{priceTypeBid:"OldIndicative",priceTypeAsk:"OldIndicative"}})],valuationPositions(s),"live","fixture-batch")[0];
  expect(l.contractSize).toBeUndefined();expect(calculatePositionBasisEvaluation(s).reference.kind).toBe("missing");
  const next=apply(s,rows),r=calculatePositionBasisEvaluation(next,undefined,"2026-09-26");
  expect(next.optionLegs[0]).toMatchObject({contractSize:100,contractSizeEvidence:{source:"InstrumentDetails.ContractSize"}});
  expect(r.reference).toMatchObject({currency:"JPY",amount:537700});expect(r.conservative.amount).toBe(512950);
  expect(calculatePositionBasisEvaluation(JSON.parse(JSON.stringify(next))).reference.amount).toBe(537700);
 });
 it("P/JPY broker valuation remains USD and never uses JPY denominator, even without multiplier or FX",()=>{
  const s=valuationFixture(false);s.accountCode="P";s.accountCurrency="JPY";s.accountEnvironment="PROD_P_JPY_SETTLEMENT";s.fxRateJPY=undefined as unknown as number;delete s.optionLegs[0].contractSize;
  const p=valuationPositions(s);delete p[0].valuation!.contractSize;delete p[0].valuation!.contractSizeSource;
  expect(calculatePositionBasisEvaluation(apply(s,valuationRows(s,p))).reference).toMatchObject({kind:"available",currency:"USD",amount:-61.63,denominator:undefined,referenceJPY:undefined});
 });
 it("partial parent sums remaining position only, never confirmed closed P/L",()=>{
  const s=valuationFixture();s.optionCloseExecutions=[{id:"close",legId:"leg0",contracts:1,closeKind:"buyback",closeDate:"2026-09-10",settlementCurrency:"USD",source:"broker_statement",closePriceUSD:999,commissionUSD:2,confirmed:true}];
  expect(getCurrentOptionPriceTargets([s])).toHaveLength(1);expect(storedSaxoValuation(apply(s)).amount).toBe(-61.63);
 });
 it.each(["2026-02-30","2026-09-26","2026-10-01",""])("keeps known broker amount but no annualization for invalid/zero/future holding date %s",date=>{
  const s=valuationFixture();s.optionEntryExecutions!.forEach(e=>e.tradeDate=date);
  const result=calculatePositionBasisEvaluation(apply(s),undefined,"2026-09-26");
  expect(result.reference.amount).toBe(-55.45);expect(result.reference.annualizedReturnPct).toBeUndefined();
 });
 it("does not overwrite a nonmatching multiplier or reuse evidence after residual quantity changes",()=>{
  const s=valuationFixture(),p=valuationPositions(s);s.optionLegs[0].contractSize=50;
  expect(apply(s,valuationRows(s,p))).toBe(s);
  expect(apply(s,valuationRows(s,p,true))).toBe(s);
  const saved=apply(valuationFixture());saved.optionLegs[0].quantity=2;
  expect(storedSaxoValuation(saved).amount).toBeUndefined();
 });
 it("diagnostics distinguish successful Saxo adoption from unavailable midpoint",()=>{
  const s=valuationFixture(),rows=valuationRows(s),saved=apply(s,rows);
  expect(diagnosePriceUpdate(s,rows,false)).toMatchObject({evaluation:"confirmation_required",storage:"not_applied"});
  expect(diagnosePriceUpdate(saved,rows,true,{simulationIds:[s.id],referenceConfirmed:true})).toMatchObject({storage:"updated",summary:"Saxo評価を更新しました"});
 });
});
