import { describe, expect, it } from "vitest";
import type { TradeSimulation, StrategyType } from "@/types/domain";
import { calculatePositionBasisEvaluation } from "./positionBasisEvaluation";
import { captureReferenceQuote, resolveEvaluationQuote } from "./midpointEvaluation";
import { applyCurrentOptionPricePreview, createCurrentOptionPricePreviewRow, getCurrentOptionPriceTargets } from "./bulkOptionPrice";

const at="2026-09-26T01:00:00Z";
const shapes:Record<string,Array<["call"|"put","buy"|"sell",number,number,number,number]>>={
bull_call_spread:[["call","buy",100,11,12,14],["call","sell",120,3,2,4]],
bear_call_spread:[["call","sell",100,11,12,14],["call","buy",120,3,2,4]],
bull_put_spread:[["put","buy",100,3,2,4],["put","sell",120,11,12,14]],
bear_put_spread:[["put","sell",100,3,2,4],["put","buy",120,11,12,14]],
long_call:[["call","buy",110,10,8,12]],long_put:[["put","buy",110,10,8,12]],
short_call:[["call","sell",110,10,8,12]],short_put:[["put","sell",110,10,8,12]],
synthetic_forward:[["call","buy",110,4,3,5],["put","sell",110,10,8,12]],
combo:[["call","buy",110,4,3,5],["put","sell",110,10,8,12]],
short_strangle:[["call","sell",120,3,2,4],["put","sell",100,3,2,4]],
custom:[["call","buy",100,11,12,14],["call","sell",120,3,2,4]]};
function fixture(kind="long_call"):TradeSimulation {
 const s:TradeSimulation={id:"fixture",name:"anonymous",ticker:"TEST",strategyType:(kind==="short_call"?"custom":kind) as StrategyType,status:"open",accountCode:"N",accountCurrency:"USD",accountEnvironment:"PROD_N_USD_SETTLEMENT",currentPriceUSD:110,fxRateJPY:150,entryDate:"2026-09-01",expiryDate:"2026-12-18",dte:83,stockPosition:null,brokerMarginJPY:0,marginBufferMultiplier:1,denominatorMode:"cash_secured",taxProfileId:"none_nisa_or_tax_free_comparison",strategyContractVerification:{state:"verified"},optionLegs:[]};
 s.optionLegs=shapes[kind].map(([type,side,strikeUSD,premiumUSD,bid,ask],i)=>({id:"leg"+i,type,side,strikeUSD,premiumUSD,quantity:1,contractSize:100,expiryDate:s.expiryDate,closeCostUSD:side==="buy"?bid:ask,closePlan:{enabled:true,closePriceUSD:side==="buy"?bid:ask,commissionUSD:2,commissionContracts:1,commissionSource:"manual"},referenceQuote:captureReferenceQuote(resolveEvaluationQuote({bid,ask,priceTypeBid:"Indicative",priceTypeAsk:"Tradable",fetchedAt:at,source:"fixture"}),"batch")}));
 s.optionEntryExecutions=s.optionLegs.map(l=>({id:"entry"+l.id,legId:l.id,tradeDate:s.entryDate,contracts:1,fillPriceUSD:l.premiumUSD,commissionUSD:2,settlementCurrency:"USD",source:"broker_statement",confirmed:true}));
 return s;
}
const evaluate=(s:TradeSimulation)=>calculatePositionBasisEvaluation(s,undefined,"2026-09-26");
describe("R15 unified reference and conservative evaluation",()=>{
 it("distinguishes absent, partially missing, quality pending and mismatched reference observations",()=>{
  const s=fixture("bull_call_spread"); const saved=s.optionLegs.map(l=>l.referenceQuote);
  s.optionLegs.forEach(l=>{delete l.referenceQuote;});
  expect(evaluate(s).reference.reason).toBe("中間値の価格をまだ取得していません");
  s.optionLegs[0].referenceQuote=saved[0];
  expect(evaluate(s).reference.reason).toBe("一部の脚の中間値が未取得です。両脚の価格をまとめて更新してください");
  s.optionLegs[1].referenceQuote={...saved[1]!,priceTypeAsk:"OldIndicative",referenceConfirmedAt:undefined};
  expect(evaluate(s).reference.reason).toContain("使用確認");
  s.optionLegs[1].referenceQuote={...saved[1]!,batchId:"other"};
  expect(evaluate(s).reference.reason).toBe("価格の取得タイミングが揃っていません。両脚の価格をまとめて更新してください");
 });
 it("preserves all old reference legs when one new opposite side is missing, independently of close adoption",()=>{
 const s=fixture("bull_call_spread");const rows=getCurrentOptionPriceTargets([s]).map((target,i)=>createCurrentOptionPricePreviewRow(target,{environment:"live",status:"available",classification:"available",source:"fixture",message:"",fetchedAt:at,bid:i===0?14:undefined,ask:i===0?16:5,quoteDiagnostics:{priceTypeBid:"Tradable",priceTypeAsk:"Tradable"}}));
 const updated=applyCurrentOptionPricePreview([s],rows,{batchId:"new"})[0];
 expect(updated.optionLegs.map(l=>l.referenceQuote)).toEqual(s.optionLegs.map(l=>l.referenceQuote));
 expect(updated.optionLegs.map(l=>l.closePlan?.closePriceUSD)).toEqual([14,5]);
 });
 it.each(["unavailable","permission_denied"] as const)("never adopts stale values in a failed %s payload",status=>{
 const s=fixture(); const row=createCurrentOptionPricePreviewRow(getCurrentOptionPriceTargets([s])[0],{environment:"live",status,classification:"failed",source:"fixture",message:"",fetchedAt:at,bid:14,ask:16,quoteDiagnostics:{priceTypeBid:"Tradable",priceTypeAsk:"Tradable"}});
 expect(row.status).toBe("unavailable");expect(applyCurrentOptionPricePreview([s],[row])[0]).toBe(s);
 });
 it("does not throw when finite prices overflow after multiplier",()=>{
 const s=fixture();s.optionLegs[0].referenceQuote=captureReferenceQuote(resolveEvaluationQuote({bid:8e306,ask:1.2e307,priceTypeBid:"Tradable",priceTypeAsk:"Tradable",source:"fixture",fetchedAt:at}),"overflow");
 expect(()=>evaluate(s)).not.toThrow();expect(evaluate(s).reference.kind).toBe("missing");
 });
 it.each(Object.keys(shapes))("%s keeps reference and conservative cashflows separate",kind=>{
 const s=fixture(kind);
 if(kind==="synthetic_forward")s.optionCloseExecutions=[{id:"closed",legId:"leg0",contracts:1,closeKind:"buyback",closeDate:"2026-09-10",closePriceUSD:2,commissionUSD:2,settlementCurrency:"USD",source:"broker_statement",confirmed:true}];
 const result=evaluate(s);
 const ref=["bull_call_spread","bear_put_spread","custom"].includes(kind)?192:kind.endsWith("spread")?-208:["combo","short_strangle"].includes(kind)?-8:-4;
 const conservative=["bull_call_spread","bear_put_spread","custom"].includes(kind)?-8:kind.endsWith("spread")?-408:kind==="combo"?-308:kind==="short_strangle"?-208:-204;
 expect(result.reference).toMatchObject({kind:"available",amount:ref});
 expect(result.conservative).toMatchObject({kind:"available",amount:conservative});
 });
 it("uses direct JPY booked cashflow, never current FX conversion of USD P/L",()=>{
 const s=fixture();s.accountCode="P";s.accountCurrency="JPY";s.accountEnvironment="PROD_P_JPY_SETTLEMENT";
 s.optionEntryExecutions![0]={...s.optionEntryExecutions![0],settlementCurrency:"JPY",brokerBookedAmountJPY:-140280};
 expect(evaluate(s).reference).toMatchObject({currency:"JPY",amount:9420});
 expect(evaluate(s).conservative.amount).toBe(-20580);
 s.fxRateJPY=undefined as unknown as number;expect(evaluate(s).reference.kind).toBe("missing");
 });
 it("keeps USD amount when FX or denominator is absent",()=>{
 const s=fixture("short_call");s.fxRateJPY=undefined as unknown as number;
 expect(evaluate(s).reference).toMatchObject({kind:"available",amount:-4,denominator:undefined,periodReturnPct:undefined,referenceJPY:undefined});
 });
 it.each(["2026-02-30","","2026-10-01"])("does not invent annualization with invalid/future date %s",date=>{
 const s=fixture("bull_call_spread");s.optionEntryExecutions!.forEach(e=>e.tradeDate=date);
 expect(evaluate(s).reference.amount).toBe(192);expect(evaluate(s).reference.annualizedReturnPct).toBeUndefined();
 });
 it("never supplies missing entry fees or multiplier",()=>{
 const s=fixture();s.optionEntryExecutions![0].commissionUSD=undefined;expect(evaluate(s).reference.kind).toBe("missing");
 s.optionEntryExecutions![0].commissionUSD=0;s.optionLegs[0].contractSize=undefined;expect(evaluate(s).reference.kind).toBe("missing");
 });
 it("preserves confirmed close CF and each fee once for a partial vertical",()=>{
 const s=fixture("bull_call_spread");s.optionCloseExecutions=[{id:"close",legId:"leg0",contracts:1,closeKind:"buyback",closeDate:"2026-09-10",closePriceUSD:12,commissionUSD:2,settlementCurrency:"USD",source:"broker_statement",confirmed:true}];
 expect(evaluate(s).reference.amount).toBe(92);expect(evaluate(s).conservative.amount).toBe(-8);
 });
 it("does not aggregate different residual batches",()=>{const s=fixture("combo");s.optionLegs[1].referenceQuote!.batchId="different";expect(evaluate(s).reference.kind).toBe("missing");expect(evaluate(s).conservative.amount).toBe(-308);});
 it("never mutates while evaluating or serializing/reloading",()=>{const s=fixture(),before=JSON.stringify(s);expect(evaluate(JSON.parse(before))).toEqual(evaluate(s));expect(JSON.stringify(s)).toBe(before);});
 it.each(["NoAccess","NoMarket","None","Pending","Theor","Current","unknown",undefined])("rejects unsupported raw quality %s",quality=>{const q=resolveEvaluationQuote({bid:8,ask:12,priceTypeBid:quality,priceTypeAsk:"Tradable",source:"fixture",fetchedAt:at});expect(q.kind).toBe("unavailable");});
 it("requires confirmation when only opposite side is old and preserves both quality and delay",()=>{
 const s=fixture(); const target=getCurrentOptionPriceTargets([s])[0];
 const row=createCurrentOptionPricePreviewRow(target,{environment:"live",status:"available",classification:"available",source:"fixture",message:"",fetchedAt:at,bid:8,ask:12,quoteDiagnostics:{priceTypeBid:"Tradable",priceTypeAsk:"OldIndicative",delayedByMinutes:15}});
 expect(row.status).toBe("confirmable_reference");
 expect(applyCurrentOptionPricePreview([s],[row])[0]).toBe(s);
 const saved=applyCurrentOptionPricePreview([s],[row],{includeConfirmedReferences:true,capturedAt:at})[0];
 expect(saved.optionLegs[0].referenceQuote).toMatchObject({priceTypeBid:"Tradable",priceTypeAsk:"OldIndicative",delayedByMinutes:15,referenceConfirmedAt:at});
 expect(evaluate(saved).reference.amount).toBe(-4);
 });
 it("adopts explicit Bid zero reference without changing close candidate or R14 observations",()=>{
 const s=fixture(),leg=s.optionLegs[0];
 const row=createCurrentOptionPricePreviewRow(getCurrentOptionPriceTargets([s])[0],{environment:"live",status:"available",classification:"available",source:"fixture",message:"",fetchedAt:at,bid:0,ask:2,quoteDiagnostics:{priceTypeBid:"Indicative",priceTypeAsk:"Indicative"}});
 const saved=applyCurrentOptionPricePreview([s],[row])[0].optionLegs[0];
 expect(saved.referenceQuote?.midUSD).toBe(1);expect(saved.closePlan).toEqual(leg.closePlan);expect(saved.valueObservations).toEqual(leg.valueObservations);
 });
 it("stale one-leg preview cannot partly apply a managed pair",()=>{
 const s=fixture("bull_call_spread");const rows=getCurrentOptionPriceTargets([s]).map(target=>createCurrentOptionPricePreviewRow(target,{environment:"live",status:"available",classification:"available",source:"fixture",message:"",fetchedAt:at,bid:1,ask:2,quoteDiagnostics:{priceTypeBid:"Tradable",priceTypeAsk:"Tradable"}}));
 s.optionLegs[0].closeCostUSD=99;expect(applyCurrentOptionPricePreview([s],rows)[0]).toBe(s);
 });
});
