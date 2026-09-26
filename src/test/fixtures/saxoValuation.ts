import type { TradeSimulation } from "@/types/domain";
import type { SaxoApiPositionSnapshot } from "@/features/saxo/saxoAccountSync";
import { attachPositionValuations } from "@/domain/saxoValuation";
import { createCurrentOptionPricePreviewRow, getCurrentOptionPriceTargets } from "@/domain/bulkOptionPrice";

const at="2026-09-26T01:00:00Z";
export function valuationFixture(pair=true):TradeSimulation {
 const s={id:"anonymous",name:"anonymous",ticker:"ABC",strategyType:pair?"bull_call_spread":"long_call",status:"open",accountCode:"N",accountCurrency:"USD",accountEnvironment:"PROD_N_USD_SETTLEMENT",entryDate:"2026-09-01",expiryDate:"2026-12-18",currentPriceUSD:110,fxRateJPY:150,dte:83,stockPosition:null,brokerMarginJPY:0,marginBufferMultiplier:1,denominatorMode:"cash_secured",taxProfileId:"none_nisa_or_tax_free_comparison",strategyContractVerification:{state:"verified"},optionLegs:[]} as TradeSimulation;
 s.optionLegs=[0,...pair?[1]:[]].map(i=>({id:`leg${i}`,type:"call",side:i?"sell":"buy",quantity:1,strikeUSD:100+i*20,premiumUSD:i?3:11,contractSize:100,expiryDate:s.expiryDate,saxoAccountKey:"fiction-account",saxoUic:900010+i,saxoPositionId:`fiction-position-${i}`,closeCostUSD:4,closePlan:{enabled:true,closePriceUSD:4,commissionUSD:2,commissionContracts:1,commissionSource:"manual"}}));
 s.optionEntryExecutions=s.optionLegs.map(l=>({id:`entry-${l.id}`,legId:l.id,tradeDate:s.entryDate,contracts:1,fillPriceUSD:l.premiumUSD,commissionUSD:2,settlementCurrency:"USD",source:"broker_statement",confirmed:true}));
 return s;
}
export function valuationPositions(s:TradeSimulation):SaxoApiPositionSnapshot[] {
 return getCurrentOptionPriceTargets([s]).map((t,i)=>({positionId:t.positionId,accountKey:t.accountKey,uic:t.uic,kind:"option",assetType:"StockOption",underlyingSymbol:t.ticker,optionType:t.optionType,strike:t.strike,expiry:t.expiry,side:t.side==="buy"?"long":"short",quantity:t.quantity*(t.side==="buy"?1:-1),valuation:{source:"Saxo.PositionView",fetchedAt:at,currentPrice:i?0.24:3.38,currentPriceType:"Indicative",calculationReliability:"OkWithConditions",delayedByMinutes:15,profitLossOnTrade:i?10.66:-57.15,tradeCostsTotal:-4.48,quoteCurrency:"USD",quoteCurrencySource:"InstrumentDetails.CurrencyCode",contractSize:100,contractSizeSource:"InstrumentDetails.ContractSize"}} as SaxoApiPositionSnapshot));
}
export function valuationRows(s:TradeSimulation,positions=valuationPositions(s),mid=false) {
 const rows=getCurrentOptionPriceTargets([s]).map(t=>createCurrentOptionPricePreviewRow(t,{environment:"live",fetchedAt:at,status:"available",classification:"available",source:"fixture",message:"",bid:mid?12:undefined,ask:14,quoteDiagnostics:{priceTypeBid:mid?"Tradable":"NoMarket",priceTypeAsk:"Tradable"}}));
 return attachPositionValuations([s],rows,positions,"live","fixture-batch");
}
