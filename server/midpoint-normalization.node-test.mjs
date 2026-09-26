import { test } from "node:test";
import assert from "node:assert/strict";
process.env.SAXO_READONLY_SERVER_TEST="1";
const {normalizeOptionPremiumCandidate}=await import("./saxo-readonly-server.mjs");
const normalize=price=>normalizeOptionPremiumCandidate({fetchedAt:"2026-09-26T02:00:00Z",source:"anonymous",contract:{},price});
test("R15 preserves explicit zero Bid with same-payload quote metadata",()=>{
 const result=normalize({LastUpdated:"2026-09-26T01:00:00Z",Quote:{Bid:0,Ask:2,PriceTypeBid:"Indicative",PriceTypeAsk:"OldIndicative",DelayedByMinutes:15}});
 assert.equal(result.bid,0);assert.equal(result.ask,2);assert.equal(result.sourceTimestamp,"2026-09-26T01:00:00Z");
 assert.equal(result.quoteDiagnostics.priceTypeAsk,"OldIndicative");assert.equal(result.quoteDiagnostics.delayedByMinutes,15);
});
test("R15 never borrows another payload quality or delay",()=>{
 const result=normalize({Quote:{Bid:8,Ask:12},__infoPriceMeta:{fallbackPayload:{Quote:{Bid:5,Ask:7,PriceTypeBid:"Tradable",PriceTypeAsk:"Tradable",DelayedByMinutes:0}}}});
 assert.equal(result.bid,8);assert.equal(result.quoteDiagnostics.priceTypeBid,undefined);assert.equal(result.quoteDiagnostics.priceTypeAsk,undefined);assert.equal(result.quoteDiagnostics.delayedByMinutes,undefined);
});
test("R15 rejects invalid Bid and missing/sentinel source timestamps",()=>{
 for(const bid of [-1,Infinity,NaN])assert.equal(normalize({Quote:{Bid:bid,Ask:2}}).bid,undefined);
 for(const LastUpdated of [undefined,"0001-01-01T00:00:00Z","invalid"])assert.equal(normalize({LastUpdated,Quote:{Bid:1,Ask:2}}).sourceTimestamp,undefined);
});
test("R15 diagnostics distinguish explicit zero from missing/null normalized bid",()=>{
 for(const Bid of [undefined,null]){
  const result=normalize({Quote:{Bid,Ask:2,PriceTypeBid:"Indicative",PriceTypeAsk:"Indicative"}});
  assert.equal(result.bid,undefined);assert.equal(result.ask,2);
 }
 assert.equal(normalize({Quote:{Bid:0,Ask:2,PriceTypeBid:"Indicative",PriceTypeAsk:"Indicative"}}).bid,0);
});
