import type { ExitBrokerOrderType, ExitOrderPlan, ExitOrderPlanMode, ExitStopLossType, OptionLeg, StopLossRule, TradeSimulation } from "@/types/domain";
import { getShortOptionLegs, getShortPutLegs } from "./calculations";

export const DEFAULT_PROFIT_KEEP_PERCENT = 60;
export const DEFAULT_CLOSE_DAYS_BEFORE_EXPIRY = 7;

export function calculateProfitTakeBuybackPriceUSD(premiumUSD: number, keepPercent: number): number {
  if (!Number.isFinite(premiumUSD) || premiumUSD <= 0 || !Number.isFinite(keepPercent)) return 0;
  return Math.max(0, premiumUSD * (1 - keepPercent / 100));
}

export function getPrimaryExitLeg(simulation: TradeSimulation): OptionLeg | undefined {
  return getShortPutLegs(simulation)[0] ?? getShortOptionLegs(simulation)[0];
}

export function getDefaultExitOrderPlan(simulation?: TradeSimulation): ExitOrderPlan {
  const leg = simulation ? getPrimaryExitLeg(simulation) : undefined;
  return getDefaultExitOrderPlanForLeg(leg);
}

export function getDefaultExitOrderPlanForLeg(leg?: OptionLeg): ExitOrderPlan {
  const premiumUSD = leg?.premiumUSD ?? 0;
  return {
    scope: leg ? "leg" : "position",
    legId: leg?.id,
    mode: "manual_only",
    brokerOrderType: "none",
    profitTakeEnabled: false,
    profitTakePremiumKeepPercent: DEFAULT_PROFIT_KEEP_PERCENT,
    profitTakeBuybackPriceUSD: calculateProfitTakeBuybackPriceUSD(premiumUSD, DEFAULT_PROFIT_KEEP_PERCENT),
    stopLossEnabled: false,
    stopLossType: "buyback_price",
    stopLossBuybackPriceUSD: 0,
    stopLossStockPriceUSD: 0,
    stopLossAmountJPY: 0,
    stopLossAmountUSD: 0,
    stopLossAmountCurrency: "JPY",
    latestCloseDaysBeforeExpiry: DEFAULT_CLOSE_DAYS_BEFORE_EXPIRY,
    latestCloseDaysBeforeExpiryUserSet: false,
    memo: "",
  };
}

type LegacyExitOrderPlan = Partial<ExitOrderPlan> & {
  enabled?: boolean;
  orderPlanType?: "none" | "manual_watch" | "closing_limit" | "closing_stop" | "ifd" | "ifd_oco" | "oco";
  useBrokerAttachedOrder?: boolean;
};

function inferExitMode(existing?: LegacyExitOrderPlan): ExitOrderPlanMode {
  if (!existing) return "manual_only";
  if (existing.mode) return existing.mode;
  if (existing.useBrokerAttachedOrder || existing.orderPlanType === "ifd" || existing.orderPlanType === "ifd_oco") {
    return "attached_entry_exit_order";
  }
  if (existing.enabled || existing.orderPlanType === "closing_limit" || existing.orderPlanType === "closing_stop" || existing.orderPlanType === "oco") {
    return "after_entry_closing_order";
  }
  return "manual_only";
}

function inferBrokerOrderType(existing?: LegacyExitOrderPlan): ExitBrokerOrderType {
  if (!existing) return "none";
  if (existing.brokerOrderType) return existing.brokerOrderType;
  if (!existing.orderPlanType || existing.orderPlanType === "manual_watch") return "none";
  return existing.orderPlanType;
}

function toExitStopLossType(rule?: StopLossRule): ExitStopLossType {
  if (rule?.type === "stock_price_line") return "stock_price_line";
  if (rule?.type === "loss_amount_jpy") return "loss_amount";
  return "buyback_price";
}

function getStopValueByType(rule: StopLossRule | undefined, type: ExitStopLossType): number {
  if (!rule || rule.value <= 0) return 0;
  if (type === "buyback_price" && rule.type === "option_buyback_price") return rule.value;
  if (type === "stock_price_line" && rule.type === "stock_price_line") return rule.value;
  if (type === "loss_amount" && rule.type === "loss_amount_jpy") return rule.value;
  return 0;
}

function normalizeExitOrderPlanForLeg(
  simulation: TradeSimulation,
  leg: OptionLeg | undefined,
  existing: LegacyExitOrderPlan | undefined,
): ExitOrderPlan {
  const defaults = getDefaultExitOrderPlanForLeg(leg);
  const profitKeepPercent =
    existing?.profitTakePremiumKeepPercent ??
    simulation.profitTakeRule?.targetPremiumKeepPercent ??
    defaults.profitTakePremiumKeepPercent ??
    DEFAULT_PROFIT_KEEP_PERCENT;
  const stopLossType = existing?.stopLossType ?? toExitStopLossType(simulation.stopLossRule);
  const premiumUSD = leg?.premiumUSD ?? 0;
  const stopLossAmountCurrency = existing?.stopLossAmountCurrency ?? (simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "USD" : "JPY");
  const legacyLossAmount = getStopValueByType(simulation.stopLossRule, "loss_amount");
  const normalizedLatestCloseDays =
    existing?.latestCloseDaysBeforeExpiry ??
    simulation.profitTakeRule?.latestCloseDaysBeforeExpiry ??
    (simulation.profitTakeRule ? undefined : defaults.latestCloseDaysBeforeExpiry);
  const latestCloseDaysUserSet =
    existing?.latestCloseDaysBeforeExpiryUserSet ??
    ((simulation.profitTakeRule?.enabled === true && simulation.profitTakeRule.latestCloseDaysBeforeExpiry !== undefined) ||
      (existing?.latestCloseDaysBeforeExpiry !== undefined && existing.latestCloseDaysBeforeExpiry !== DEFAULT_CLOSE_DAYS_BEFORE_EXPIRY));

  return {
    ...defaults,
    ...existing,
    scope: existing?.scope ?? (leg ? "leg" : "position"),
    legId: existing?.legId ?? leg?.id,
    mode: inferExitMode(existing),
    brokerOrderType: inferBrokerOrderType(existing),
    profitTakeEnabled: existing?.profitTakeEnabled ?? simulation.profitTakeRule?.enabled ?? false,
    profitTakePremiumKeepPercent: profitKeepPercent,
    profitTakeBuybackPriceUSD:
      existing?.profitTakeBuybackPriceUSD ??
      calculateProfitTakeBuybackPriceUSD(premiumUSD, profitKeepPercent),
    stopLossEnabled: existing?.stopLossEnabled ?? simulation.stopLossRule?.enabled ?? false,
    stopLossType,
    stopLossBuybackPriceUSD: existing?.stopLossBuybackPriceUSD ?? getStopValueByType(simulation.stopLossRule, "buyback_price"),
    stopLossStockPriceUSD: existing?.stopLossStockPriceUSD ?? getStopValueByType(simulation.stopLossRule, "stock_price_line"),
    stopLossAmountJPY: existing?.stopLossAmountJPY ?? (stopLossAmountCurrency === "JPY" ? legacyLossAmount : 0),
    stopLossAmountUSD:
      existing?.stopLossAmountUSD ??
      (stopLossAmountCurrency === "USD"
        ? existing?.stopLossAmountJPY ?? legacyLossAmount
        : 0),
    stopLossAmountCurrency,
    latestCloseDaysBeforeExpiry: normalizedLatestCloseDays,
    latestCloseDaysBeforeExpiryUserSet: latestCloseDaysUserSet,
    memo: existing?.memo ?? "",
  };
}

export function normalizeExitOrderPlan(simulation: TradeSimulation): ExitOrderPlan {
  return normalizeExitOrderPlanForLeg(
    simulation,
    getPrimaryExitLeg(simulation),
    simulation.exitOrderPlan as LegacyExitOrderPlan | undefined,
  );
}

export function normalizeExitOrderPlans(simulation: TradeSimulation): ExitOrderPlan[] {
  const shortLegs = getShortOptionLegs(simulation);
  if (shortLegs.length === 0) return [];
  const existingPlans = simulation.exitOrderPlans as LegacyExitOrderPlan[] | undefined;
  if (existingPlans?.length) {
    return shortLegs.map((leg) =>
      normalizeExitOrderPlanForLeg(
        simulation,
        leg,
        existingPlans.find((plan) => plan.legId === leg.id) ?? undefined,
      ),
    );
  }
  const legacyPlan = simulation.exitOrderPlan as LegacyExitOrderPlan | undefined;
  const legacyTargetLeg = getShortPutLegs(simulation)[0] ?? shortLegs[0];
  return shortLegs.map((leg) => normalizeExitOrderPlanForLeg(simulation, leg, leg.id === legacyTargetLeg.id ? legacyPlan : undefined));
}

export function getExitOrderPlan(simulation: TradeSimulation): ExitOrderPlan {
  return normalizeExitOrderPlan(simulation);
}

export function getExitOrderPlanForLeg(simulation: TradeSimulation, leg: OptionLeg): ExitOrderPlan {
  return normalizeExitOrderPlans(simulation).find((plan) => plan.legId === leg.id) ?? getDefaultExitOrderPlanForLeg(leg);
}

export function getExitOrderStopValue(plan: ExitOrderPlan): number {
  if (plan.stopLossType === "stock_price_line") return plan.stopLossStockPriceUSD ?? 0;
  if (plan.stopLossType === "loss_amount") return plan.stopLossAmountJPY ?? 0;
  return plan.stopLossBuybackPriceUSD ?? 0;
}

export function getExitOrderLossAmount(plan: ExitOrderPlan, simulation: TradeSimulation): number {
  return simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
    ? plan.stopLossAmountUSD ?? 0
    : plan.stopLossAmountJPY ?? 0;
}

export function getExitDeadlineInfo(
  simulation: TradeSimulation,
  plan: ExitOrderPlan,
  now = new Date(),
): { deadlineDate: string | null; remainingDays: number | null; isPast: boolean } {
  if (plan.latestCloseDaysBeforeExpiry === undefined || plan.latestCloseDaysBeforeExpiry < 0 || !simulation.expiryDate) {
    return { deadlineDate: null, remainingDays: null, isPast: false };
  }
  const expiry = new Date(`${simulation.expiryDate}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return { deadlineDate: null, remainingDays: null, isPast: false };
  const deadline = new Date(expiry);
  deadline.setDate(expiry.getDate() - plan.latestCloseDaysBeforeExpiry);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const deadlineDay = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  const remainingDays = Math.ceil((deadlineDay.getTime() - today.getTime()) / 86_400_000);
  return {
    deadlineDate: [
      deadlineDay.getFullYear(),
      String(deadlineDay.getMonth() + 1).padStart(2, "0"),
      String(deadlineDay.getDate()).padStart(2, "0"),
    ].join("-"),
    remainingDays,
    isPast: remainingDays <= 0,
  };
}

export function isAvoidAssignmentPut(simulation: TradeSimulation): boolean {
  return getShortPutLegs(simulation).some(
    (leg) =>
      leg.putIntent === "avoid_assignment" ||
      leg.putIntent === "do_not_want_to_buy" ||
      leg.putIntent === "cannot_buy",
  );
}
