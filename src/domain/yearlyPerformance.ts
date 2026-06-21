import type { AccountEnvironment, TradeSimulation } from "@/types/domain";
import { calculateOptionCloseExecutionResults } from "./optionCloseExecutions";
import { calculateStockSettlementTaxResult } from "./tax";
import { calculateNetInitialPremiumJPY, getShortCallLegs, getShortPutLegs } from "./calculations";

const endedStatuses = new Set(["closed", "assigned", "expired"]);
const months = Array.from({ length: 12 }, (_, index) => index + 1);

export type YearlyPerformanceIssueTarget =
  | "option-close-executions"
  | "stock-acquisition-record"
  | "stock-settlement-record";

export type YearlyPerformanceIssue = {
  id: string;
  simulationId: string;
  ticker: string;
  label: string;
  detail: string;
  severity: "warning" | "danger";
  targetAnchor: YearlyPerformanceIssueTarget;
};

export type YearlyPerformanceMonthlyRow = {
  month: number;
  label: string;
  optionJPY: number;
  stockJPY: number;
  totalJPY: number;
  nOptionUSD: number;
  nReferenceJPY: number;
  cumulativeJPY: number;
  cumulativeNOptionUSD: number;
};

export type YearlyPerformanceTaxBucket = {
  id: "option" | "stock" | "n_option";
  label: string;
  amountJPY: number;
  amountUSD?: number;
  referenceJPY?: number;
  count: number;
};

export type YearlyPerformanceTickerSummary = {
  ticker: string;
  optionJPY: number;
  stockJPY: number;
  totalJPY: number;
  nOptionUSD: number;
  nReferenceJPY: number;
  count: number;
};

export type YearlyPerformanceOptionBreakdown = {
  id: string;
  simulationId: string;
  ticker: string;
  label: string;
  date: string;
  amountJPY: number;
  amountUSD?: number;
  referenceJPY?: number;
  currency: "JPY" | "USD";
  denominatorJPY?: number;
  denominatorUSD?: number;
  days?: number;
  annualReturnPct?: number;
  annualReturnMissingReason?: string;
};

export type YearlyPerformanceSummary = {
  year: number;
  realizedPnlJPY: number;
  optionPnlJPY: number;
  stockPnlJPY: number;
  nOptionPnlUSD: number;
  nReferencePnlJPY: number;
  optionCapitalDaysJPY: number;
  optionAnnualReturnProfitJPY: number;
  optionAnnualReturnIncludedCount: number;
  optionAnnualReturnExcludedCount: number;
  optionAnnualReturnPct?: number;
  nOptionCapitalDaysUSD: number;
  nOptionAnnualReturnProfitUSD: number;
  nOptionAnnualReturnIncludedCount: number;
  nOptionAnnualReturnExcludedCount: number;
  nOptionAnnualReturnPct?: number;
  optionCount: number;
  stockSettlementCount: number;
  nOptionCount: number;
  unconfirmedCount: number;
  transactionUnconfirmedCount: number;
  annualReturnMissingCount: number;
  monthly: YearlyPerformanceMonthlyRow[];
  taxBuckets: YearlyPerformanceTaxBucket[];
  tickerSummaries: YearlyPerformanceTickerSummary[];
  optionBreakdowns: YearlyPerformanceOptionBreakdown[];
  issues: YearlyPerformanceIssue[];
  availableYears: number[];
};

type AggregationEvent = {
  simulation: TradeSimulation;
  date: string;
  kind: "option" | "stock";
  amountJPY: number;
  amountUSD?: number;
  referenceJPY?: number;
  label?: string;
  denominatorJPY?: number;
  denominatorUSD?: number;
  denominatorMissingReason?: string;
  days?: number;
  annualReturnIssueTarget?: YearlyPerformanceIssueTarget;
};

function calculateAnnualReturnPct(amount: number, denominator: number | undefined, days: number | undefined): number | undefined {
  if (denominator === undefined || denominator <= 0 || days === undefined || days <= 0) return undefined;
  return (amount / denominator / days) * 365 * 100;
}

function annualizeFromCapitalDays(amount: number, capitalDays: number): number | undefined {
  if (capitalDays <= 0) return undefined;
  return (amount / capitalDays) * 100;
}

function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function getMissingAnnualReturnReason(event: Pick<AggregationEvent, "denominatorJPY" | "denominatorUSD" | "denominatorMissingReason" | "days">): string | undefined {
  const denominator = event.denominatorUSD ?? event.denominatorJPY;
  const reasons: string[] = [];
  if (!isPositiveFinite(denominator)) reasons.push(event.denominatorMissingReason ?? "使用分母が不足");
  if (!isPositiveFinite(event.days)) reasons.push("日数が不足");
  return reasons.length > 0 ? reasons.join(" / ") : undefined;
}

function getPositiveFx(...values: Array<number | undefined>): number | undefined {
  return values.find(isPositiveFinite);
}

function getAssignedShortPutFxRate(simulation: TradeSimulation): number | undefined {
  const directFx = getPositiveFx(simulation.referenceFxRateJPY, simulation.fxRateJPY);
  if (directFx) return directFx;
  const entryExecutions = simulation.optionEntryExecutions ?? [];
  for (const execution of entryExecutions) {
    const executionFx = getPositiveFx(execution.brokerExchangeRateJPY, execution.referenceFxRateJPY);
    if (executionFx) return executionFx;
  }
  for (const execution of entryExecutions) {
    const premiumUSD = Math.abs((execution.fillPriceUSD ?? 0) * 100 * Math.max(1, execution.contracts || 1));
    const premiumJPY = Math.abs(execution.brokerPremiumJPY ?? 0);
    if (premiumUSD > 0 && premiumJPY > 0) return premiumJPY / premiumUSD;
  }
  return undefined;
}

function isNAccount(accountEnvironment: AccountEnvironment): boolean {
  return accountEnvironment === "PROD_N_USD_SETTLEMENT";
}

function parseYear(date: string | undefined): number | null {
  const year = Number(date?.slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : null;
}

function parseMonth(date: string | undefined): number | null {
  const month = Number(date?.slice(5, 7));
  return Number.isFinite(month) && month >= 1 && month <= 12 ? month : null;
}

function addTickerSummary(
  map: Map<string, YearlyPerformanceTickerSummary>,
  ticker: string,
  patch: Partial<Omit<YearlyPerformanceTickerSummary, "ticker">>,
) {
  const current =
    map.get(ticker) ??
    {
      ticker,
      optionJPY: 0,
      stockJPY: 0,
      totalJPY: 0,
      nOptionUSD: 0,
      nReferenceJPY: 0,
      count: 0,
    };
  const next = {
    ...current,
    optionJPY: current.optionJPY + (patch.optionJPY ?? 0),
    stockJPY: current.stockJPY + (patch.stockJPY ?? 0),
    totalJPY: current.totalJPY + (patch.totalJPY ?? 0),
    nOptionUSD: current.nOptionUSD + (patch.nOptionUSD ?? 0),
    nReferenceJPY: current.nReferenceJPY + (patch.nReferenceJPY ?? 0),
    count: current.count + (patch.count ?? 0),
  };
  map.set(ticker, next);
}

function hasConfirmedBuybackExecution(simulation: TradeSimulation): boolean {
  return (simulation.optionCloseExecutions ?? []).some(
    (execution) => execution.confirmed && (execution.closeKind ?? "buyback") === "buyback",
  );
}

function hasConfirmedExpiredExecution(simulation: TradeSimulation): boolean {
  return (simulation.optionCloseExecutions ?? []).some(
    (execution) => execution.confirmed && execution.closeKind === "expired",
  );
}

function hasConfirmedAssignedShortPutPremium(simulation: TradeSimulation): boolean {
  const acquisition = simulation.stockAcquisition;
  return (
    simulation.status === "assigned" &&
    !isNAccount(simulation.accountEnvironment) &&
    getShortPutLegs(simulation).length > 0 &&
    Boolean(
      acquisition?.enabled &&
        acquisition.confirmationStatus !== "ignored" &&
        acquisition.confirmationStatus !== "invalid" &&
        Number.isFinite(acquisition.shares) &&
        acquisition.shares > 0 &&
        Number.isFinite(acquisition.priceUSD) &&
        acquisition.priceUSD > 0,
    )
  );
}

function getAssignedShortPutPremiumDate(simulation: TradeSimulation): string {
  return simulation.stockAcquisition?.acquisitionDate || simulation.expiryDate || simulation.entryDate;
}

function collectIssues(simulations: TradeSimulation[]): YearlyPerformanceIssue[] {
  return simulations.flatMap((simulation) => {
    const issues: YearlyPerformanceIssue[] = [];
    const ticker = simulation.ticker || simulation.name || "未設定";
    const hasUnconfirmedCloseDraft = (simulation.optionCloseExecutions ?? []).some((execution) => !execution.confirmed);
    const hasBuybackCloseDraft = (simulation.optionCloseExecutions ?? []).some(
      (execution) => (execution.closeKind ?? "buyback") === "buyback",
    );
    const hasExpiredCloseDraft = (simulation.optionCloseExecutions ?? []).some(
      (execution) => execution.closeKind === "expired",
    );

    if (hasUnconfirmedCloseDraft) {
      issues.push({
        id: `${simulation.id}-unconfirmed-close`,
        simulationId: simulation.id,
        ticker,
        label: "決済実績下書きが未確認",
        detail: "Saxo注文履歴を見て、決済実績を確認済みにしてください。",
        severity: "warning",
        targetAnchor: "option-close-executions",
      });
    }

    if (simulation.status === "closed" && !hasConfirmedBuybackExecution(simulation) && !hasBuybackCloseDraft) {
      issues.push({
        id: `${simulation.id}-missing-close`,
        simulationId: simulation.id,
        ticker,
        label: "決済実績未入力",
        detail: "決済済みですが、確認済みの買戻し決済実績がありません。",
        severity: "danger",
        targetAnchor: "option-close-executions",
      });
    }

    if (simulation.status === "expired" && !hasConfirmedExpiredExecution(simulation) && !hasExpiredCloseDraft) {
      issues.push({
        id: `${simulation.id}-missing-expiry`,
        simulationId: simulation.id,
        ticker,
        label: "満期終了記録未入力",
        detail: "満期終了ですが、確認済みの買戻しなし記録がありません。",
        severity: "warning",
        targetAnchor: "option-close-executions",
      });
    }

    if (simulation.status === "assigned") {
      if (getShortPutLegs(simulation).length > 0 && !simulation.stockAcquisition?.enabled) {
        issues.push({
          id: `${simulation.id}-missing-stock-acquisition`,
          simulationId: simulation.id,
          ticker,
          label: "株式取得記録未入力",
          detail: "P売り権利行使による株式取得記録がありません。",
          severity: "danger",
          targetAnchor: "stock-acquisition-record",
        });
      }
      if (getShortCallLegs(simulation).length > 0 && !simulation.stockSettlement?.enabled) {
        issues.push({
          id: `${simulation.id}-missing-stock-settlement`,
          simulationId: simulation.id,
          ticker,
          label: "株式譲渡記録未入力",
          detail: "C売り権利行使による株式譲渡記録がありません。",
          severity: "danger",
          targetAnchor: "stock-settlement-record",
        });
      }
    }

    return issues;
  });
}

export function calculateYearlyPerformanceSummary(
  simulations: TradeSimulation[],
  year: number,
): YearlyPerformanceSummary {
  const monthly = months.map<YearlyPerformanceMonthlyRow>((month) => ({
    month,
    label: `${month}月`,
    optionJPY: 0,
    stockJPY: 0,
    totalJPY: 0,
    nOptionUSD: 0,
    nReferenceJPY: 0,
    cumulativeJPY: 0,
    cumulativeNOptionUSD: 0,
  }));
  const tickerMap = new Map<string, YearlyPerformanceTickerSummary>();
  const availableYearSet = new Set<number>([year]);
  const issues = collectIssues(simulations);
  let optionPnlJPY = 0;
  let stockPnlJPY = 0;
  let nOptionPnlUSD = 0;
  let nReferencePnlJPY = 0;
  let optionCapitalDaysJPY = 0;
  let optionAnnualReturnProfitJPY = 0;
  let optionAnnualReturnIncludedCount = 0;
  let optionAnnualReturnExcludedCount = 0;
  let nOptionCapitalDaysUSD = 0;
  let nOptionAnnualReturnProfitUSD = 0;
  let nOptionAnnualReturnIncludedCount = 0;
  let nOptionAnnualReturnExcludedCount = 0;
  let optionCount = 0;
  let nOptionCount = 0;
  let stockSettlementCount = 0;
  const optionBreakdowns: YearlyPerformanceOptionBreakdown[] = [];

  const addEvent = (event: AggregationEvent) => {
    const eventYear = parseYear(event.date);
    const month = parseMonth(event.date);
    if (eventYear) availableYearSet.add(eventYear);
    if (eventYear !== year || month === null) return;
    const row = monthly[month - 1];
    const ticker = event.simulation.ticker || event.simulation.name || "未設定";

    if (event.kind === "option" && event.amountUSD !== undefined) {
      nOptionPnlUSD += event.amountUSD;
      nReferencePnlJPY += event.referenceJPY ?? 0;
      nOptionCount += 1;
      if (event.denominatorUSD !== undefined && event.denominatorUSD > 0 && event.days !== undefined && event.days > 0) {
        nOptionCapitalDaysUSD += (event.denominatorUSD * event.days) / 365;
        nOptionAnnualReturnProfitUSD += event.amountUSD;
        nOptionAnnualReturnIncludedCount += 1;
      } else {
        nOptionAnnualReturnExcludedCount += 1;
      }
      const annualReturnMissingReason = getMissingAnnualReturnReason(event);
      optionBreakdowns.push({
        id: `${event.simulation.id}-${event.date}-n-${nOptionCount}`,
        simulationId: event.simulation.id,
        ticker,
        label: event.label ?? "確認済みN口座オプション損益",
        date: event.date,
        amountJPY: 0,
        amountUSD: event.amountUSD,
        referenceJPY: event.referenceJPY,
        currency: "USD",
        denominatorUSD: event.denominatorUSD,
        denominatorJPY: event.denominatorJPY,
        days: event.days,
        annualReturnPct: calculateAnnualReturnPct(event.amountUSD, event.denominatorUSD, event.days),
        annualReturnMissingReason,
      });
      if (annualReturnMissingReason) {
        issues.push({
          id: `${event.simulation.id}-${event.date}-n-annual-missing`,
          simulationId: event.simulation.id,
          ticker,
          label: "年率未計算",
          detail: `${event.label ?? "N口座オプション損益"} の実績年率を計算できません。理由: ${annualReturnMissingReason}。`,
          severity: "warning",
          targetAnchor: event.annualReturnIssueTarget ?? "option-close-executions",
        });
      }
      row.nOptionUSD += event.amountUSD;
      row.nReferenceJPY += event.referenceJPY ?? 0;
      addTickerSummary(tickerMap, ticker, {
        nOptionUSD: event.amountUSD,
        nReferenceJPY: event.referenceJPY ?? 0,
        count: 1,
      });
      return;
    }

    if (event.kind === "option") {
      optionPnlJPY += event.amountJPY;
      optionCount += 1;
      if (event.denominatorJPY !== undefined && event.denominatorJPY > 0 && event.days !== undefined && event.days > 0) {
        optionCapitalDaysJPY += (event.denominatorJPY * event.days) / 365;
        optionAnnualReturnProfitJPY += event.amountJPY;
        optionAnnualReturnIncludedCount += 1;
      } else {
        optionAnnualReturnExcludedCount += 1;
      }
      const annualReturnMissingReason = getMissingAnnualReturnReason(event);
      optionBreakdowns.push({
        id: `${event.simulation.id}-${event.date}-${optionCount}`,
        simulationId: event.simulation.id,
        ticker,
        label: event.label ?? "確認済みオプション損益",
        date: event.date,
        amountJPY: event.amountJPY,
        currency: "JPY",
        denominatorJPY: event.denominatorJPY,
        days: event.days,
        annualReturnPct: calculateAnnualReturnPct(event.amountJPY, event.denominatorJPY, event.days),
        annualReturnMissingReason,
      });
      if (annualReturnMissingReason) {
        const detail =
          annualReturnMissingReason === "USD/JPYが未取得"
            ? "この権利行使プレミアムはUSD/JPYが未取得のため年率を計算できません。"
            : `${event.label ?? "オプション損益"} の実績年率を計算できません。理由: ${annualReturnMissingReason}。`;
        issues.push({
          id: `${event.simulation.id}-${event.date}-${optionCount}-annual-missing`,
          simulationId: event.simulation.id,
          ticker,
          label: "年率未計算",
          detail,
          severity: "warning",
          targetAnchor: event.annualReturnIssueTarget ?? "option-close-executions",
        });
      }
      row.optionJPY += event.amountJPY;
      row.totalJPY += event.amountJPY;
      addTickerSummary(tickerMap, ticker, {
        optionJPY: event.amountJPY,
        totalJPY: event.amountJPY,
        count: 1,
      });
      return;
    }

    stockPnlJPY += event.amountJPY;
    stockSettlementCount += 1;
    row.stockJPY += event.amountJPY;
    row.totalJPY += event.amountJPY;
    addTickerSummary(tickerMap, ticker, {
      stockJPY: event.amountJPY,
      totalJPY: event.amountJPY,
      count: 1,
    });
  };

  simulations.forEach((simulation) => {
    (simulation.optionCloseExecutions ?? []).forEach((execution) => {
      const executionYear = parseYear(execution.closeDate);
      if (executionYear) availableYearSet.add(executionYear);
    });
    if (simulation.stockSettlement?.settlementDate) {
      const settlementYear = parseYear(simulation.stockSettlement.settlementDate);
      if (settlementYear) availableYearSet.add(settlementYear);
    }
    if (hasConfirmedAssignedShortPutPremium(simulation)) {
      const assignmentYear = parseYear(getAssignedShortPutPremiumDate(simulation));
      if (assignmentYear) availableYearSet.add(assignmentYear);
    }

    if (!endedStatuses.has(simulation.status)) return;

    calculateOptionCloseExecutionResults(simulation)
      .filter((result) => result.execution.confirmed)
      .forEach((result) => {
        if (isNAccount(simulation.accountEnvironment)) {
          addEvent({
            simulation,
            date: result.execution.closeDate,
            kind: "option",
            amountJPY: 0,
            amountUSD: result.realizedPnlUSD,
            referenceJPY: result.realizedPnlJPY,
            label: "反対売買決済",
            denominatorUSD: result.denominatorUSD,
            denominatorJPY: result.denominatorJPY,
            days: result.holdingDays,
          });
        } else {
          addEvent({
            simulation,
            date: result.execution.closeDate,
            kind: "option",
            amountJPY: result.realizedPnlJPY,
            label: "反対売買決済",
            denominatorJPY: result.denominatorJPY,
            days: result.holdingDays,
          });
        }
      });

    if (hasConfirmedAssignedShortPutPremium(simulation)) {
      const assignedPut = getShortPutLegs(simulation)[0];
      const fx = getAssignedShortPutFxRate(simulation);
      const shares = assignedPut ? Math.abs(assignedPut.quantity) * 100 : simulation.stockAcquisition?.shares;
      const denominatorJPY =
        assignedPut && shares && fx && fx > 0 ? assignedPut.strikeUSD * shares * fx : undefined;
      const denominatorMissingReason =
        assignedPut && shares && (!fx || fx <= 0) ? "USD/JPYが未取得" : undefined;
      addEvent({
        simulation,
        date: getAssignedShortPutPremiumDate(simulation),
        kind: "option",
        amountJPY: calculateNetInitialPremiumJPY(simulation),
        label: "P売り権利行使プレミアム",
        denominatorJPY,
        denominatorMissingReason,
        days: simulation.dte > 0 ? simulation.dte : undefined,
        annualReturnIssueTarget: "stock-acquisition-record",
      });
    }

    const stockTax = calculateStockSettlementTaxResult(simulation);
    if (simulation.stockSettlement?.enabled && stockTax.enabled) {
      addEvent({
        simulation,
        date: simulation.stockSettlement.settlementDate,
        kind: "stock",
        amountJPY: stockTax.realizedGainJPY,
      });
    }
  });

  let cumulativeJPY = 0;
  let cumulativeNOptionUSD = 0;
  monthly.forEach((row) => {
    cumulativeJPY += row.totalJPY;
    cumulativeNOptionUSD += row.nOptionUSD;
    row.cumulativeJPY = cumulativeJPY;
    row.cumulativeNOptionUSD = cumulativeNOptionUSD;
  });

  return {
    year,
    realizedPnlJPY: optionPnlJPY + stockPnlJPY,
    optionPnlJPY,
    stockPnlJPY,
    nOptionPnlUSD,
    nReferencePnlJPY,
    optionCapitalDaysJPY,
    optionAnnualReturnProfitJPY,
    optionAnnualReturnIncludedCount,
    optionAnnualReturnExcludedCount,
    optionAnnualReturnPct: annualizeFromCapitalDays(optionAnnualReturnProfitJPY, optionCapitalDaysJPY),
    nOptionCapitalDaysUSD,
    nOptionAnnualReturnProfitUSD,
    nOptionAnnualReturnIncludedCount,
    nOptionAnnualReturnExcludedCount,
    nOptionAnnualReturnPct: annualizeFromCapitalDays(nOptionAnnualReturnProfitUSD, nOptionCapitalDaysUSD),
    optionCount,
    stockSettlementCount,
    nOptionCount,
    unconfirmedCount: issues.length,
    transactionUnconfirmedCount: issues.filter((issue) => issue.label !== "年率未計算").length,
    annualReturnMissingCount: issues.filter((issue) => issue.label === "年率未計算").length,
    monthly,
    taxBuckets: [
      {
        id: "option",
        label: "先物取引に係る雑所得等（P/DEMO オプション）",
        amountJPY: optionPnlJPY,
        count: optionCount,
      },
      {
        id: "stock",
        label: "上場株式等の譲渡所得等（株式譲渡）",
        amountJPY: stockPnlJPY,
        count: stockSettlementCount,
      },
      {
        id: "n_option",
        label: "N口座オプション損益（USD主帳簿）",
        amountJPY: 0,
        amountUSD: nOptionPnlUSD,
        referenceJPY: nReferencePnlJPY,
        count: nOptionCount,
      },
    ],
    tickerSummaries: Array.from(tickerMap.values()).sort((a, b) => Math.abs(b.totalJPY + b.nReferenceJPY) - Math.abs(a.totalJPY + a.nReferenceJPY)),
    optionBreakdowns,
    issues,
    availableYears: Array.from(availableYearSet).sort((a, b) => b - a),
  };
}
