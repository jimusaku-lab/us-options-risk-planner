import {test} from 'node:test';
import assert from 'node:assert/strict';
process.env.SAXO_READONLY_SERVER_TEST='1';
const {normalizePosition,enrichPositionUnderlyingIdentities}=await import('./saxo-readonly-server.mjs');
const at='2026-09-26T10:00:00Z';
const raw=(view={})=>({PositionId:'fixture-position',PositionBase:{AccountKey:'fixture-account',Uic:900001,AssetType:'StockOption',Amount:1,OptionsData:{PutCall:'Call',Strike:100,ExpiryDate:'2026-12-18'}},PositionView:{CurrentPrice:3.38,CurrentPriceType:'Indicative',CalculationReliability:'OkWithConditions',ProfitLossOnTrade:-57.15,TradeCostsTotal:-4.48,...view}});
const normalize=r=>normalizePosition(r,new Map([['fixture-account',{currency:'JPY'}]]),at,0);
test('R16 exact valuation fields preserve signed costs and zero, not rounded-price PnL or base values',()=>{
 const p=normalize({...raw({CurrentPrice:0,ProfitLossOnTrade:0,TradeCostsTotal:0}),ProfitLossOnTradeInBaseCurrency:999,Costs:{TradeCostsTotalInBaseCurrency:123}});
 assert.equal(p.valuation.currentPrice,0);assert.equal(p.valuation.profitLossOnTrade,0);assert.equal(p.valuation.tradeCostsTotal,0);
 assert.equal(p.valuation.quoteCurrency,undefined);
 assert.equal(p.valuation.currentPriceType,'Indicative');assert.equal(p.valuation.calculationReliability,'OkWithConditions');
 assert.equal(p.valuation.fetchedAt,at);
});
test('R16 missing direct cost stays absent and account/recursive currency is not quote evidence',()=>{
 const p=normalize({...raw({TradeCostsTotal:undefined}),Currency:'USD',Costs:{TradeCostsTotal:-9}});
 assert.equal(p.valuation.tradeCostsTotal,undefined);assert.equal(p.valuation.quoteCurrency,undefined);
});
test('R16 same UIC instrument details establish quote currency after enrichment',async()=>{
 const p=normalize(raw());let calls=0;
 const [result]=await enrichPositionUnderlyingIdentities([p],'fixture-client',async input=>{calls++;assert.equal(input.uic,900001);return {CurrencyCode:'USD',ContractSize:100};});
 assert.equal(calls,1);assert.equal(result.valuation.quoteCurrency,'USD');assert.equal(result.valuation.quoteCurrencySource,'InstrumentDetails.CurrencyCode');
 assert.equal(result.valuation.profitLossOnTrade,-57.15);assert.equal(result.valuation.tradeCostsTotal,-4.48);
 assert.equal(result.valuation.currentPrice,3.38);
});
test('R16 delay is exact CurrentPriceDelayMinutes and fetchedAt never becomes sourceTimestamp',()=>{
 const p=normalize(raw({CurrentPriceDelayMinutes:15,CurrentPriceLastTraded:'2026-09-25T20:00:00Z'}));
 assert.equal(p.valuation.delayedByMinutes,15);assert.equal(p.valuation.sourceTimestamp,undefined);
});
test('R16 numeric strings and unrelated price/cost fields are not numeric evidence',()=>{
 const p=normalize(raw({CurrentPrice:'3.38',ProfitLossOnTrade:'-57.15',TradeCostsTotal:'-4.48'}));
 for(const field of ['currentPrice','profitLossOnTrade','tradeCostsTotal'])assert.equal(p.valuation[field],undefined);
});
test('R16 exact currency and multiplier fields do not borrow recursively',async()=>{
 const [p]=await enrichPositionUnderlyingIdentities([normalize(raw())],'fixture-client',async()=>({Other:{CurrencyCode:'USD',ContractSize:100}}));
 assert.equal(p.valuation.quoteCurrency,undefined);assert.equal(p.valuation.contractSize,undefined);
});
