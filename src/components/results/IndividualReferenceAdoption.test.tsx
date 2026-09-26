import React from "react";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {describe,it,expect,vi,afterEach} from "vitest";
import {CloseDecisionCard} from "./CloseDecisionCard";
import type {TradeSimulation} from "@/types/domain";
const {fetchCandidate}=vi.hoisted(()=>({fetchCandidate:vi.fn()}));
vi.mock("@/features/saxo/saxoApiClient",()=>({fetchSaxoOptionPremiumCandidate:fetchCandidate}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
function fixture():TradeSimulation {return {id:"anon",ticker:"TEST",name:"anonymous",status:"open",strategyType:"long_call",accountCode:"N",accountCurrency:"USD",accountEnvironment:"PROD_N_USD_SETTLEMENT",entryDate:"2026-09-01",expiryDate:"2026-12-18",dte:83,currentPriceUSD:110,fxRateJPY:150,stockPosition:null,brokerMarginJPY:0,marginBufferMultiplier:1,denominatorMode:"cash_secured",taxProfileId:"none_nisa_or_tax_free_comparison",optionLegs:[{id:"leg",type:"call",side:"buy",strikeUSD:110,premiumUSD:10,quantity:1,contractSize:100,expiryDate:"2026-12-18",closeCostUSD:5,closePlan:{enabled:true,closePriceUSD:5,commissionUSD:2,commissionSource:"manual"}}],optionEntryExecutions:[{id:"entry",legId:"leg",tradeDate:"2026-09-01",contracts:1,fillPriceUSD:10,commissionUSD:2,settlementCurrency:"USD",source:"broker_statement",confirmed:true}]};}
const candidate={environment:"live",status:"available",classification:"available",source:"fixture",fetchedAt:"2026-09-26T02:00:00Z",sourceTimestamp:"2026-09-26T01:00:00Z",message:"anonymous",bid:8,ask:12,mid:999,quoteDiagnostics:{priceTypeBid:"Tradable",priceTypeAsk:"OldIndicative",delayedByMinutes:15}};
describe("R15 individual explicit adoption",()=>{
 it("fetches without mutation, requires opposite-side old confirmation and writes two bases once",async()=>{
 fetchCandidate.mockResolvedValue(candidate);const s=fixture(),change=vi.fn();render(<CloseDecisionCard simulation={s} onChange={change}/>);
 fireEvent.click(screen.getByRole("button",{name:"開く"}));
 fireEvent.click(screen.getByRole("button",{name:"候補価格を取得"}));
 const adopt=await screen.findByRole("button",{name:/この価格を採用/});
 expect(change).not.toHaveBeenCalled();expect(adopt).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox",{name:/OldIndicative/}));fireEvent.click(adopt);
 expect(change).toHaveBeenCalledTimes(1);
 const saved:TradeSimulation=change.mock.calls[0][0];
 expect(saved.optionLegs[0]).toMatchObject({closeCostUSD:8,closePlan:{closePriceUSD:8,commissionUSD:2},referenceQuote:{midUSD:10,bidUSD:8,askUSD:12,priceTypeBid:"Tradable",priceTypeAsk:"OldIndicative",sourceTimestamp:candidate.sourceTimestamp,delayedByMinutes:15,referenceConfirmedAt:expect.any(String)}});
 expect(saved.optionEntryExecutions).toEqual(s.optionEntryExecutions);expect(saved.optionCloseExecutions).toBeUndefined();expect(saved.status).toBe("open");
 expect(JSON.parse(JSON.stringify(saved)).optionLegs[0].referenceQuote.midUSD).toBe(10);
 });
 it("keeps failed payload and fetch exceptions non-mutating",async()=>{
 const s=fixture(),change=vi.fn();fetchCandidate.mockResolvedValue({...candidate,status:"unavailable"});
 render(<CloseDecisionCard simulation={s} onChange={change}/>);fireEvent.click(screen.getByRole("button",{name:"開く"}));fireEvent.click(screen.getByRole("button",{name:"候補価格を取得"}));
 await waitFor(()=>expect(fetchCandidate).toHaveBeenCalledTimes(1));expect(screen.queryByRole("button",{name:/この価格を採用/})).toBeNull();expect(change).not.toHaveBeenCalled();
 });
});
