import { describe, expect, it } from "vitest";
import { calculateConfirmedSaxoCloseCommissionUSD, resolveCloseCommissionUSD } from "./closeCommissionStandard";
import type { OptionLeg, TradeSimulation } from "@/types/domain";
const simulation={accountCode:"N",accountEnvironment:"PROD_N_USD_SETTLEMENT"} as TradeSimulation;
const leg=(quantity:number,commissionUSD?:number):OptionLeg=>({id:"leg",type:"put",side:"sell",strikeUSD:100,premiumUSD:2,quantity,expiryDate:"2026-12-18",closePlan:commissionUSD===undefined?undefined:{enabled:true,commissionUSD}});
describe("confirmed Saxo close commission standard",()=>{
 it("rounds after multiplying the unrounded per-contract fee",()=>{expect(calculateConfirmedSaxoCloseCommissionUSD(1)).toBe(2.24);expect(calculateConfirmedSaxoCloseCommissionUSD(2)).toBe(4.49);});
 it("uses the confirmed standard only for a valid P/N Stock Option quantity",()=>{expect(resolveCloseCommissionUSD(simulation,leg(1))).toMatchObject({kind:"resolved",amountUSD:2.24,source:"saxo_ticket_confirmed_standard",confirmedAt:"2026-08-14"});expect(resolveCloseCommissionUSD(simulation,leg(0))).toEqual({kind:"missing"});expect(resolveCloseCommissionUSD(simulation,leg(1.5))).toEqual({kind:"missing"});});
 it("keeps explicit values including zero ahead of the standard",()=>{expect(resolveCloseCommissionUSD(simulation,leg(1,0))).toMatchObject({kind:"resolved",amountUSD:0});expect(resolveCloseCommissionUSD(simulation,leg(1,7.5))).toMatchObject({kind:"resolved",amountUSD:7.5});});
});
