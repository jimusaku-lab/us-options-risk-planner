import type { OptionLeg, TradeSimulation } from "@/types/domain";

/** Confirmed from Saxo Stock Option close tickets; independent of the 2.25 USD entry standard. */
export const SAXO_CLOSE_BROKER_FEE_PER_CONTRACT_USD = 2.20;
export const SAXO_CLOSE_EXCHANGE_FEE_PER_CONTRACT_USD = 0.04311;
export const SAXO_CLOSE_COMMISSION_CONFIRMED_AT = "2026-08-14";
export const SAXO_CLOSE_COMMISSION_SOURCE = "saxo_ticket_confirmed_standard" as const;
export type ResolvedCloseCommission = { kind: "resolved"; amountUSD: number; source: "manual" | "user_confirmed_standard" | "saxo_readonly_candidate" | "legacy_unrecorded" | typeof SAXO_CLOSE_COMMISSION_SOURCE; confirmedAt?: string } | { kind: "missing" };
function roundUsd(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
export function calculateConfirmedSaxoCloseCommissionUSD(contracts: number): number | undefined { if (!Number.isFinite(contracts) || !Number.isInteger(contracts) || contracts <= 0) return undefined; return roundUsd((SAXO_CLOSE_BROKER_FEE_PER_CONTRACT_USD + SAXO_CLOSE_EXCHANGE_FEE_PER_CONTRACT_USD) * contracts); }
export function resolveCloseCommissionUSD(simulation: TradeSimulation, leg: OptionLeg): ResolvedCloseCommission { const explicit=leg.closePlan?.commissionUSD; if(explicit!==undefined&&Number.isFinite(explicit)&&explicit>=0) return {kind:"resolved",amountUSD:explicit,source:leg.closePlan?.commissionSource??"legacy_unrecorded",confirmedAt:leg.closePlan?.commissionConfirmedAt}; if(simulation.accountEnvironment==="PROD_P_JPY_SETTLEMENT"||simulation.accountEnvironment==="PROD_N_USD_SETTLEMENT"){const amountUSD=calculateConfirmedSaxoCloseCommissionUSD(leg.quantity);if(amountUSD!==undefined)return {kind:"resolved",amountUSD,source:SAXO_CLOSE_COMMISSION_SOURCE,confirmedAt:SAXO_CLOSE_COMMISSION_CONFIRMED_AT};}return {kind:"missing"}; }
