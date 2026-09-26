import type { SaxoApiPositionSnapshot } from "./saxoAccountSync";

/** Compatibility for the preceding read-only helper. Exact fields only; never borrow account/base currency. */
export function adaptLegacyPositionValuation(position:SaxoApiPositionSnapshot,fetchedAt:string):SaxoApiPositionSnapshot {
  if(Object.prototype.hasOwnProperty.call(position,"valuation") || position.specificationConflicts?.length)return position;
  const raw=position.raw;
  if(!raw || typeof raw!=="object" || !("PositionView" in raw))return position;
  const view=(raw as Record<string,unknown>).PositionView;
  if(!view || typeof view!=="object" || Array.isArray(view))return position;
  const direct=view as Record<string,unknown>;
  const number=(key:string)=>typeof direct[key]==="number" && Number.isFinite(direct[key])?direct[key] as number:undefined;
  const text=(key:string)=>typeof direct[key]==="string"?direct[key] as string:undefined;
  const currency=position.currencySourceField==="InstrumentDetails.CurrencyCode" && typeof position.currency==="string" && /^[A-Z]{3}$/.test(position.currency)?position.currency:undefined;
  const contractSize=position.contractSizeSourceField==="InstrumentDetails.ContractSize" && Number.isInteger(position.contractSize) && position.contractSize!>0?position.contractSize:undefined;
  return {...position,valuation:{source:"Saxo.PositionView",fetchedAt,currentPrice:number("CurrentPrice"),currentPriceType:text("CurrentPriceType"),calculationReliability:text("CalculationReliability"),profitLossOnTrade:number("ProfitLossOnTrade"),tradeCostsTotal:number("TradeCostsTotal"),delayedByMinutes:number("CurrentPriceDelayMinutes"),quoteCurrency:currency,quoteCurrencySource:currency?"InstrumentDetails.CurrencyCode":undefined,contractSize,contractSizeSource:contractSize!==undefined?"InstrumentDetails.ContractSize":undefined}};
}
