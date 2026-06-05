import { create } from "zustand";
import type {
  AccountCashAdjustment,
  AccountState,
  AccountEnvironment,
  BrokerAccount,
  Currency,
  SaxoAccountCode,
  StockTransferEvent,
  TradeSimulation,
  WheelCycle,
  WheelEvent,
  WheelPhase,
} from "@/types/domain";
import { sampleAmznSimulation } from "@/data/sampleAmzn";
import { getDefaultExitOrderPlan, normalizeExitOrderPlan, normalizeExitOrderPlans } from "@/domain/exitOrderPlan";
import { normalizeOptionCloseExecutionsForStatus } from "@/domain/optionCloseExecutions";
import { addLocalDays, formatLocalDate } from "@/lib/date";

export type WorkspaceMode = "demo" | "live";

const LEGACY_SIMULATIONS_KEY = "us-options-simulations";
const SIMULATIONS_KEY = "us-options-simulations-v2";
const WHEEL_KEY = "us-options-wheel-cycles-v2";
const WHEEL_EVENTS_KEY = "us-options-wheel-events-v2";
const STOCK_TRANSFERS_KEY = "us-options-stock-transfers-v2";
const SETTINGS_KEY = "us-options-settings";
const ACCOUNT_KEY = "us-options-account-snapshots-v2";

export const SAXO_ACCOUNTS: BrokerAccount[] = [
  {
    id: "saxo-p",
    broker: "SAXO_BANK_JP",
    accountCode: "P",
    displayName: "P: 外国株式等オプション（円建て / JPY決済）",
    baseCurrency: "JPY",
    settlementCurrency: "JPY",
    productType: "FOREIGN_STOCK_INDEX_OPTIONS",
  },
  {
    id: "saxo-n",
    broker: "SAXO_BANK_JP",
    accountCode: "N",
    displayName: "N: 外国株式等オプション（ドル建て / USD決済）",
    baseCurrency: "USD",
    settlementCurrency: "USD",
    productType: "FOREIGN_STOCK_INDEX_OPTIONS",
  },
];

export type AppSettings = {
  beginnerMode: boolean;
  defaultMarginBufferMultiplier: number;
  defaultNisaExpectedAnnualReturnPct: number;
};

export type AccountInputs = Record<SaxoAccountCode, AccountState>;

type WorkspaceImportData = {
  simulations: TradeSimulation[];
  accountStates?: AccountState[];
  wheelCycles?: WheelCycle[];
  wheelEvents?: WheelEvent[];
  stockTransfers?: StockTransferEvent[];
};

type OptionsStore = {
  activeWorkspace: WorkspaceMode;
  simulationsByWorkspace: Record<WorkspaceMode, TradeSimulation[]>;
  wheelCyclesByWorkspace: Record<WorkspaceMode, WheelCycle[]>;
  wheelEventsByWorkspace: Record<WorkspaceMode, WheelEvent[]>;
  stockTransfersByWorkspace: Record<WorkspaceMode, StockTransferEvent[]>;
  accountInputsByWorkspace: Record<WorkspaceMode, AccountInputs>;
  selectedSimulationIds: Record<WorkspaceMode, string>;
  simulations: TradeSimulation[];
  wheelCycles: WheelCycle[];
  wheelEvents: WheelEvent[];
  stockTransfers: StockTransferEvent[];
  accountInputs: AccountInputs;
  settings: AppSettings;
  selectedSimulationId: string;
  switchWorkspace: (workspace: WorkspaceMode) => void;
  createSimulationFromTemplate: () => void;
  updateAccountState: (accountCode: SaxoAccountCode, accountInputs: Partial<AccountState>) => void;
  applyAccountCashAdjustment: (adjustment: AccountCashAdjustment) => void;
  upsertSimulation: (simulation: TradeSimulation) => void;
  replaceWorkspaceData: (data: WorkspaceImportData) => void;
  deleteSimulation: (id: string) => void;
  selectSimulation: (id: string) => void;
  createWheelCycleFromSimulation: (simulation: TradeSimulation) => void;
  createStockTransferFromSimulation: (simulation: TradeSimulation) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
};

export const DEFAULT_BROKER_COMMISSION_USD = 2.25;
export const DEFAULT_NISA_EXPECTED_ANNUAL_RETURN_PCT = 9;

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJson<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function getAccountCurrency(accountEnvironment: AccountEnvironment): Currency {
  return accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "USD" : "JPY";
}

function getAccountCode(accountEnvironment: AccountEnvironment): SaxoAccountCode {
  return accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "N" : "P";
}

function createDefaultAccountInputs(overrides?: Partial<Record<SaxoAccountCode, Partial<AccountState>>>): AccountInputs {
  const now = new Date().toISOString();
  return {
    P: {
      accountCode: "P",
      accountEnvironment: "PROD_P_JPY_SETTLEMENT",
      currency: "JPY",
      cashBalance: 0,
      marginUsagePercent: 0,
      updatedAt: now,
      ...(overrides?.P ?? {}),
      marginAvailable: overrides?.P?.marginAvailable ?? overrides?.P?.marginRequirement ?? 0,
      marginRequirement: undefined,
    },
    N: {
      accountCode: "N",
      accountEnvironment: "PROD_N_USD_SETTLEMENT",
      currency: "USD",
      cashBalance: 0,
      marginUsagePercent: 0,
      updatedAt: now,
      ...(overrides?.N ?? {}),
      marginAvailable: overrides?.N?.marginAvailable ?? overrides?.N?.marginRequirement ?? 0,
      marginRequirement: undefined,
    },
  };
}

function inferAccountEnvironment(simulation: TradeSimulation, workspace: WorkspaceMode): AccountEnvironment {
  if (workspace === "demo") return "DEMO_JPY_BASE";
  if (simulation.accountEnvironment) return simulation.accountEnvironment;
  return simulation.accountCode === "N" ? "PROD_N_USD_SETTLEMENT" : "PROD_P_JPY_SETTLEMENT";
}

export function normalizeSimulation(simulation: TradeSimulation, workspace: WorkspaceMode = "live"): TradeSimulation {
  const accountEnvironment = inferAccountEnvironment(simulation, workspace);
  const accountCode = getAccountCode(accountEnvironment);
  const accountCurrency = getAccountCurrency(accountEnvironment);
  const normalized: TradeSimulation = {
    ...simulation,
    accountCode,
    accountEnvironment,
    accountCurrency,
    referenceFxRateJPY: simulation.referenceFxRateJPY ?? simulation.fxRateJPY,
    brokerMarginUSD:
      simulation.brokerMarginUSD ??
      (accountEnvironment === "PROD_N_USD_SETTLEMENT" && simulation.fxRateJPY > 0 ? simulation.brokerMarginJPY / simulation.fxRateJPY : undefined),
  };
  const exitOrderPlan = normalizeExitOrderPlan(normalized);
  const exitOrderPlans = normalizeExitOrderPlans({ ...normalized, exitOrderPlan });
  return {
    ...normalized,
    optionEntryExecutions: normalized.optionEntryExecutions ?? [],
    optionCloseExecutions: normalizeOptionCloseExecutionsForStatus(normalized.optionCloseExecutions, normalized.status),
    exitOrderPlan,
    exitOrderPlans,
    profitTakeRule: normalized.profitTakeRule ?? {
      enabled: exitOrderPlan.profitTakeEnabled,
      targetPremiumKeepPercent: exitOrderPlan.profitTakePremiumKeepPercent ?? 60,
      latestCloseDaysBeforeExpiry: exitOrderPlan.latestCloseDaysBeforeExpiry,
    },
    stopLossRule: normalized.stopLossRule ?? {
      enabled: exitOrderPlan.stopLossEnabled,
      type:
        exitOrderPlan.stopLossType === "stock_price_line"
          ? "stock_price_line"
          : exitOrderPlan.stopLossType === "loss_amount"
            ? "loss_amount_jpy"
            : "option_buyback_price",
      value:
        exitOrderPlan.stopLossType === "stock_price_line"
          ? exitOrderPlan.stopLossStockPriceUSD ?? 0
          : exitOrderPlan.stopLossType === "loss_amount"
            ? accountEnvironment === "PROD_N_USD_SETTLEMENT"
              ? exitOrderPlan.stopLossAmountUSD ?? 0
              : exitOrderPlan.stopLossAmountJPY ?? 0
            : exitOrderPlan.stopLossBuybackPriceUSD ?? 0,
    },
  };
}

function normalizeAccountInputs(value: unknown, fallback: AccountInputs): AccountInputs {
  if (!value || typeof value !== "object") return fallback;
  const legacy = value as Partial<AccountInputs> & { availableCashJPY?: number; marginUsagePercent?: number; updatedAt?: string };
  if ("availableCashJPY" in legacy || !("P" in legacy)) {
    return createDefaultAccountInputs({
      P: {
        cashBalance: legacy.availableCashJPY ?? fallback.P.cashBalance,
        marginUsagePercent: legacy.marginUsagePercent ?? fallback.P.marginUsagePercent,
        updatedAt: legacy.updatedAt ?? fallback.P.updatedAt,
      },
      N: fallback.N,
    });
  }
  return createDefaultAccountInputs({ P: legacy.P, N: legacy.N });
}

type LegacyWheelCycle = Partial<WheelCycle> & {
  id: string;
  ticker: string;
  phase?: string;
  trades?: string[];
  cumulativePremiumJPY?: number;
  cumulativeRealizedPnlJPY?: number;
  currentCostBasisUSD?: number;
};

function normalizeWheelCycle(cycle: LegacyWheelCycle): WheelCycle {
  if ("currentPhase" in cycle) return cycle as WheelCycle;
  const legacyPhase = cycle.phase ?? "short_put";
  const currentPhase: WheelPhase =
    legacyPhase === "covered_call"
      ? "n_covered_call"
      : legacyPhase === "assigned_stock"
        ? "n_stock_holding"
        : legacyPhase === "called_away"
          ? "n_called_away"
          : legacyPhase === "cash"
            ? "n_cash"
            : "n_short_put";
  const premiumUSD = cycle.cumulativePremiumJPY && cycle.referenceFxRateJPY ? cycle.cumulativePremiumJPY / cycle.referenceFxRateJPY : 0;
  const stockPnlUSD =
    cycle.cumulativeRealizedPnlJPY && cycle.referenceFxRateJPY ? cycle.cumulativeRealizedPnlJPY / cycle.referenceFxRateJPY : 0;
  return {
    id: cycle.id,
    ticker: cycle.ticker,
    primaryAccountCode: "N",
    currentPhase,
    currentAccountCode: "N",
    currentShares: cycle.currentShares ?? 0,
    averageCostUSD: cycle.currentCostBasisUSD ?? 0,
    usdCashImpact: premiumUSD + stockPnlUSD,
    cumulativePremiumUSD: premiumUSD,
    cumulativeStockRealizedPnlUSD: stockPnlUSD,
    cumulativeFeesUSD: 0,
    cumulativeTotalPnlUSD: premiumUSD + stockPnlUSD,
    referenceFxRateJPY: cycle.referenceFxRateJPY,
    eventIds: [],
    linkedSimulationIds: cycle.trades ?? [],
    openedAt: formatLocalDate(),
  };
}

function repairWheelCyclePhase(cycle: WheelCycle, simulations: TradeSimulation[]): WheelCycle {
  const linkedSimulations = cycle.linkedSimulationIds
    .map((id) => simulations.find((simulation) => simulation.id === id))
    .filter((simulation): simulation is TradeSimulation => Boolean(simulation));
  const hasNAccountLink = linkedSimulations.some(
    (simulation) =>
      simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ||
      simulation.accountCode === "N",
  );
  const hasPAccountLink = linkedSimulations.some(
    (simulation) => simulation.accountEnvironment === "PROD_P_JPY_SETTLEMENT",
  );
  const hasTransferToN = cycle.eventIds.length > 0 && cycle.currentPhase.startsWith("n_");

  if (hasPAccountLink && !hasNAccountLink && !hasTransferToN) {
    return {
      ...cycle,
      currentPhase: cycle.currentShares > 0 ? "p_assigned_stock" : "p_short_put",
      currentAccountCode: "P",
    };
  }

  return cycle;
}

const storedSettings = loadJson<AppSettings>(SETTINGS_KEY, {
  beginnerMode: true,
  defaultMarginBufferMultiplier: 2,
  defaultNisaExpectedAnnualReturnPct: DEFAULT_NISA_EXPECTED_ANNUAL_RETURN_PCT,
});

const initialSettings: AppSettings = {
  ...storedSettings,
  defaultNisaExpectedAnnualReturnPct:
    storedSettings.defaultNisaExpectedAnnualReturnPct === 6
      ? DEFAULT_NISA_EXPECTED_ANNUAL_RETURN_PCT
      : storedSettings.defaultNisaExpectedAnnualReturnPct,
};

function createBlankSimulation(workspace: WorkspaceMode, settings: AppSettings): TradeSimulation {
  const today = new Date();
  const entryDate = formatLocalDate(today);
  const expiryDate = formatLocalDate(addLocalDays(today, 45));
  return {
    id: `${workspace}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "planned",
    name: workspace === "demo" ? "デモ口座 新規建玉" : "リアル口座 新規建玉",
    ticker: "",
    underlyingName: "",
    strategyType: "covered_call_plus_short_put",
    currentPriceUSD: 0,
    fxRateJPY: 0,
    accountCode: "P",
    accountEnvironment: workspace === "demo" ? "DEMO_JPY_BASE" : "PROD_P_JPY_SETTLEMENT",
    entryDate,
    expiryDate,
    dte: 45,
    accountCurrency: "JPY",
    referenceFxRateJPY: 0,
    stockPosition: {
      shares: 0,
      averageCostUSD: 0,
      denominatorPriceMode: "current_price",
    },
    optionLegs: [
      {
        id: `${workspace}-call-${Date.now()}`,
        type: "call",
        side: "sell",
        strikeUSD: 0,
        premiumUSD: 0,
        quantity: 1,
        expiryDate,
        isCovered: false,
        assignmentPolicy: "unknown",
      },
      {
        id: `${workspace}-put-${Date.now()}`,
        type: "put",
        side: "sell",
        strikeUSD: 0,
        premiumUSD: 0,
        quantity: 1,
        expiryDate,
        putIntent: "accept_assignment",
        assignmentPolicy: "unknown",
      },
    ],
    brokerMarginJPY: 0,
    brokerMarginUSD: 0,
    marginBufferMultiplier: settings.defaultMarginBufferMultiplier,
    marginUsagePercent: 0,
    availableCashJPY: 0,
    denominatorMode: "stock_plus_margin",
    profitTakeRule: {
      enabled: false,
      targetPremiumKeepPercent: 60,
      latestCloseDaysBeforeExpiry: 7,
    },
    stopLossRule: {
      enabled: false,
      type: "option_buyback_price",
      value: 0,
    },
    exitOrderPlan: getDefaultExitOrderPlan(),
    exitOrderPlans: [],
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    nisaExpectedAnnualReturnPct: settings.defaultNisaExpectedAnnualReturnPct,
    brokerCommissionUSD: DEFAULT_BROKER_COMMISSION_USD,
    beginnerMode: settings.beginnerMode,
    fixtureMeta:
      workspace === "demo"
        ? {
            source: "demo",
            isRealMoney: false,
            broker: "SaxoBank",
            purpose: "development-fixture",
            createdAt: entryDate,
            notes: "デモ口座ワークスペースの手入力建玉です。実取引ではありません。",
          }
        : {
            source: "live",
            isRealMoney: true,
            broker: "SaxoBank",
            purpose: "development-fixture",
            createdAt: entryDate,
            notes: "リアル口座管理用。数値はユーザーが実口座画面を見て入力してください。",
          },
  };
}

function loadInitialSimulations(): Record<WorkspaceMode, TradeSimulation[]> {
  const legacy = loadJson<TradeSimulation[] | null>(LEGACY_SIMULATIONS_KEY, null);
  const loaded = loadJson<Record<WorkspaceMode, TradeSimulation[]>>(SIMULATIONS_KEY, {
    demo: legacy && legacy.length > 0 ? legacy : [sampleAmznSimulation],
    live: [],
  });
  return {
    demo: loaded.demo.map((simulation) => normalizeSimulation(simulation, "demo")),
    live: loaded.live.map((simulation) => normalizeSimulation(simulation, "live")),
  };
}

function loadInitialWheelCycles(simulationsByWorkspace: Record<WorkspaceMode, TradeSimulation[]>): Record<WorkspaceMode, WheelCycle[]> {
  const loaded = loadJson<Record<WorkspaceMode, WheelCycle[]>>(WHEEL_KEY, {
    demo: [],
    live: [],
  });
  const repaired = {
    demo: loaded.demo.map(normalizeWheelCycle).map((cycle) => repairWheelCyclePhase(cycle, simulationsByWorkspace.demo)),
    live: loaded.live.map(normalizeWheelCycle).map((cycle) => repairWheelCyclePhase(cycle, simulationsByWorkspace.live)),
  };
  saveJson(WHEEL_KEY, repaired);
  return repaired;
}

function loadInitialWheelEvents(): Record<WorkspaceMode, WheelEvent[]> {
  return loadJson<Record<WorkspaceMode, WheelEvent[]>>(WHEEL_EVENTS_KEY, { demo: [], live: [] });
}

function loadInitialStockTransfers(): Record<WorkspaceMode, StockTransferEvent[]> {
  return loadJson<Record<WorkspaceMode, StockTransferEvent[]>>(STOCK_TRANSFERS_KEY, { demo: [], live: [] });
}

function loadInitialAccountInputs(): Record<WorkspaceMode, AccountInputs> {
  const fallback = {
    demo: createDefaultAccountInputs({
      P: {
        accountEnvironment: "DEMO_JPY_BASE",
        cashBalance: sampleAmznSimulation.availableCashJPY ?? 0,
        marginUsagePercent: sampleAmznSimulation.marginUsagePercent ?? 0,
        updatedAt: "2026-05-26",
      },
    }),
    live: createDefaultAccountInputs(),
  };
  const loaded = loadJson<Record<WorkspaceMode, unknown>>(ACCOUNT_KEY, fallback);
  return {
    demo: normalizeAccountInputs(loaded.demo, fallback.demo),
    live: normalizeAccountInputs(loaded.live, fallback.live),
  };
}

function accountStatesToInputs(accountStates: AccountState[] | undefined, fallback: AccountInputs): AccountInputs {
  return createDefaultAccountInputs({
    P: accountStates?.find((account) => account.accountCode === "P") ?? fallback.P,
    N: accountStates?.find((account) => account.accountCode === "N") ?? fallback.N,
  });
}

const initialWorkspace: WorkspaceMode = loadJson<WorkspaceMode>("us-options-active-workspace", "demo");
const initialSimulationsByWorkspace = loadInitialSimulations();
const initialWheelCyclesByWorkspace = loadInitialWheelCycles(initialSimulationsByWorkspace);
const initialWheelEventsByWorkspace = loadInitialWheelEvents();
const initialStockTransfersByWorkspace = loadInitialStockTransfers();
const initialAccountInputsByWorkspace = loadInitialAccountInputs();
const initialSelectedIds: Record<WorkspaceMode, string> = {
  demo: initialSimulationsByWorkspace.demo[0]?.id ?? sampleAmznSimulation.id,
  live: initialSimulationsByWorkspace.live[0]?.id ?? "",
};

export const useOptionsStore = create<OptionsStore>((set) => ({
  activeWorkspace: initialWorkspace,
  simulationsByWorkspace: initialSimulationsByWorkspace,
  wheelCyclesByWorkspace: initialWheelCyclesByWorkspace,
  wheelEventsByWorkspace: initialWheelEventsByWorkspace,
  stockTransfersByWorkspace: initialStockTransfersByWorkspace,
  accountInputsByWorkspace: initialAccountInputsByWorkspace,
  selectedSimulationIds: initialSelectedIds,
  simulations: initialSimulationsByWorkspace[initialWorkspace],
  wheelCycles: initialWheelCyclesByWorkspace[initialWorkspace],
  wheelEvents: initialWheelEventsByWorkspace[initialWorkspace],
  stockTransfers: initialStockTransfersByWorkspace[initialWorkspace],
  accountInputs: initialAccountInputsByWorkspace[initialWorkspace],
  settings: initialSettings,
  selectedSimulationId: initialSelectedIds[initialWorkspace],
  switchWorkspace: (workspace) =>
    set((state) => {
      saveJson("us-options-active-workspace", workspace);
      return {
        activeWorkspace: workspace,
        simulations: state.simulationsByWorkspace[workspace],
        wheelCycles: state.wheelCyclesByWorkspace[workspace],
        wheelEvents: state.wheelEventsByWorkspace[workspace],
        stockTransfers: state.stockTransfersByWorkspace[workspace],
        accountInputs: state.accountInputsByWorkspace[workspace],
        selectedSimulationId: state.selectedSimulationIds[workspace],
      };
    }),
  createSimulationFromTemplate: () =>
    set((state) => {
      const simulation = createBlankSimulation(state.activeWorkspace, state.settings);
      const simulations = [simulation, ...state.simulationsByWorkspace[state.activeWorkspace]];
      const simulationsByWorkspace = { ...state.simulationsByWorkspace, [state.activeWorkspace]: simulations };
      const selectedSimulationIds = { ...state.selectedSimulationIds, [state.activeWorkspace]: simulation.id };
      saveJson(SIMULATIONS_KEY, simulationsByWorkspace);
      return { simulationsByWorkspace, selectedSimulationIds, simulations, selectedSimulationId: simulation.id };
    }),
  updateAccountState: (accountCode, accountInputs) =>
    set((state) => {
      const marginAvailable = accountInputs.marginAvailable ?? accountInputs.marginRequirement;
      const next = {
        ...state.accountInputsByWorkspace[state.activeWorkspace],
        [accountCode]: {
          ...state.accountInputsByWorkspace[state.activeWorkspace][accountCode],
          ...accountInputs,
          ...(marginAvailable !== undefined ? { marginAvailable, marginRequirement: undefined } : {}),
          accountCode,
          accountEnvironment:
            state.activeWorkspace === "demo"
              ? "DEMO_JPY_BASE"
              : accountCode === "N"
                ? "PROD_N_USD_SETTLEMENT"
                : "PROD_P_JPY_SETTLEMENT",
          currency: accountCode === "N" ? "USD" : "JPY",
          updatedAt: new Date().toISOString(),
        },
      };
      const accountInputsByWorkspace = { ...state.accountInputsByWorkspace, [state.activeWorkspace]: next };
      saveJson(ACCOUNT_KEY, accountInputsByWorkspace);
      return { accountInputsByWorkspace, accountInputs: next };
    }),
  applyAccountCashAdjustment: (adjustment) =>
    set((state) => {
      const currentWorkspaceAccounts = state.accountInputsByWorkspace[state.activeWorkspace];
      const account = currentWorkspaceAccounts[adjustment.accountCode];
      if (account.currency !== adjustment.currency) return {};
      if (account.cashAdjustments?.some((item) => item.id === adjustment.id)) return {};

      const nextAccount: AccountState = {
        ...account,
        cashBalance: account.cashBalance + adjustment.amount,
        cashAdjustments: [...(account.cashAdjustments ?? []), adjustment],
        updatedAt: new Date().toISOString(),
      };
      const next = {
        ...currentWorkspaceAccounts,
        [adjustment.accountCode]: nextAccount,
      };
      const accountInputsByWorkspace = { ...state.accountInputsByWorkspace, [state.activeWorkspace]: next };
      saveJson(ACCOUNT_KEY, accountInputsByWorkspace);
      return { accountInputsByWorkspace, accountInputs: next };
    }),
  upsertSimulation: (simulation) =>
    set((state) => {
      const normalized = normalizeSimulation(simulation, state.activeWorkspace);
      const current = state.simulationsByWorkspace[state.activeWorkspace];
      const exists = current.some((item) => item.id === normalized.id);
      const simulations = exists ? current.map((item) => (item.id === normalized.id ? normalized : item)) : [normalized, ...current];
      const simulationsByWorkspace = { ...state.simulationsByWorkspace, [state.activeWorkspace]: simulations };
      const selectedSimulationIds = { ...state.selectedSimulationIds, [state.activeWorkspace]: normalized.id };
      saveJson(SIMULATIONS_KEY, simulationsByWorkspace);
      return { simulationsByWorkspace, selectedSimulationIds, simulations, selectedSimulationId: normalized.id };
    }),
  replaceWorkspaceData: (incoming) =>
    set((state) => {
      const simulations = incoming.simulations.map((simulation) =>
        normalizeSimulation({
          ...simulation,
          id: simulation.id || `${state.activeWorkspace}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        }, state.activeWorkspace),
      );
      const accountInputs = accountStatesToInputs(incoming.accountStates, state.accountInputsByWorkspace[state.activeWorkspace]);
      const wheelCycles = (incoming.wheelCycles ?? state.wheelCyclesByWorkspace[state.activeWorkspace])
        .map(normalizeWheelCycle)
        .map((cycle) => repairWheelCyclePhase(cycle, simulations));
      const wheelEvents = incoming.wheelEvents ?? state.wheelEventsByWorkspace[state.activeWorkspace];
      const stockTransfers = incoming.stockTransfers ?? state.stockTransfersByWorkspace[state.activeWorkspace];
      const simulationsByWorkspace = { ...state.simulationsByWorkspace, [state.activeWorkspace]: simulations };
      const accountInputsByWorkspace = { ...state.accountInputsByWorkspace, [state.activeWorkspace]: accountInputs };
      const wheelCyclesByWorkspace = { ...state.wheelCyclesByWorkspace, [state.activeWorkspace]: wheelCycles };
      const wheelEventsByWorkspace = { ...state.wheelEventsByWorkspace, [state.activeWorkspace]: wheelEvents };
      const stockTransfersByWorkspace = { ...state.stockTransfersByWorkspace, [state.activeWorkspace]: stockTransfers };
      const selectedSimulationIds = { ...state.selectedSimulationIds, [state.activeWorkspace]: simulations[0]?.id ?? "" };
      saveJson(SIMULATIONS_KEY, simulationsByWorkspace);
      saveJson(ACCOUNT_KEY, accountInputsByWorkspace);
      saveJson(WHEEL_KEY, wheelCyclesByWorkspace);
      saveJson(WHEEL_EVENTS_KEY, wheelEventsByWorkspace);
      saveJson(STOCK_TRANSFERS_KEY, stockTransfersByWorkspace);
      return {
        simulationsByWorkspace,
        accountInputsByWorkspace,
        wheelCyclesByWorkspace,
        wheelEventsByWorkspace,
        stockTransfersByWorkspace,
        selectedSimulationIds,
        simulations,
        accountInputs,
        wheelCycles,
        wheelEvents,
        stockTransfers,
        selectedSimulationId: selectedSimulationIds[state.activeWorkspace],
      };
    }),
  deleteSimulation: (id) =>
    set((state) => {
      const simulations = state.simulationsByWorkspace[state.activeWorkspace].filter((item) => item.id !== id);
      const simulationsByWorkspace = { ...state.simulationsByWorkspace, [state.activeWorkspace]: simulations };
      const selectedSimulationIds = { ...state.selectedSimulationIds, [state.activeWorkspace]: simulations[0]?.id ?? "" };
      saveJson(SIMULATIONS_KEY, simulationsByWorkspace);
      return {
        simulationsByWorkspace,
        selectedSimulationIds,
        simulations,
        selectedSimulationId: selectedSimulationIds[state.activeWorkspace],
      };
    }),
  selectSimulation: (id) =>
    set((state) => {
      const selectedSimulationIds = { ...state.selectedSimulationIds, [state.activeWorkspace]: id };
      return { selectedSimulationIds, selectedSimulationId: id };
    }),
  createWheelCycleFromSimulation: (simulation) =>
    set((state) => {
      const normalized = normalizeSimulation(simulation, state.activeWorkspace);
      const existing = state.wheelCyclesByWorkspace[state.activeWorkspace].find(
        (cycle) => cycle.ticker === normalized.ticker && cycle.linkedSimulationIds.includes(normalized.id),
      );
      if (existing) return {};
      const phase: WheelPhase =
        normalized.accountEnvironment !== "PROD_N_USD_SETTLEMENT"
          ? normalized.status === "assigned"
            ? "p_assigned_stock"
            : "p_short_put"
          : normalized.strategyType === "covered_call"
            ? "n_covered_call"
            : normalized.status === "assigned"
              ? "n_stock_holding"
              : "n_short_put";
      const premiumUSD = normalized.optionLegs
        .filter((leg) => leg.side === "sell")
        .reduce((sum, leg) => sum + leg.premiumUSD * leg.quantity * 100, 0);
      const feesUSD = normalized.brokerCommissionUSD ?? 0;
      const cycle: WheelCycle = {
        id: `wheel-${state.activeWorkspace}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        ticker: normalized.ticker,
        primaryAccountCode: "N",
        currentPhase: phase,
        currentAccountCode: normalized.accountCode,
        currentShares: normalized.stockPosition?.shares ?? 0,
        averageCostUSD: normalized.stockPosition?.averageCostUSD ?? 0,
        usdCashImpact: premiumUSD - feesUSD,
        cumulativePremiumUSD: premiumUSD,
        cumulativeStockRealizedPnlUSD: 0,
        cumulativeFeesUSD: feesUSD,
        cumulativeTotalPnlUSD: premiumUSD - feesUSD,
        referenceFxRateJPY: normalized.referenceFxRateJPY ?? normalized.fxRateJPY,
        eventIds: [],
        linkedSimulationIds: [normalized.id],
        openedAt: normalized.entryDate,
      };
      const wheelCycles = [cycle, ...state.wheelCyclesByWorkspace[state.activeWorkspace]];
      const wheelCyclesByWorkspace = { ...state.wheelCyclesByWorkspace, [state.activeWorkspace]: wheelCycles };
      saveJson(WHEEL_KEY, wheelCyclesByWorkspace);
      return { wheelCyclesByWorkspace, wheelCycles };
    }),
  createStockTransferFromSimulation: (simulation) =>
    set((state) => {
      const normalized = normalizeSimulation(simulation, state.activeWorkspace);
      const shares = normalized.stockPosition?.shares ?? 0;
      if (normalized.accountEnvironment !== "PROD_P_JPY_SETTLEMENT" || shares <= 0) return {};
      const id = `stock-transfer-${state.activeWorkspace}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const transfer: StockTransferEvent = {
        id,
        ticker: normalized.ticker,
        fromAccountCode: "P",
        toAccountCode: "N",
        shares,
        transferDate: formatLocalDate(),
        costBasisUSD: normalized.stockPosition?.averageCostUSD ?? normalized.currentPriceUSD,
        sourceSimulationId: normalized.id,
        memo: "P口座で取得した株式をN口座ホイールへ移管。売却損益には含めません。",
      };
      const existingCycle = state.wheelCyclesByWorkspace[state.activeWorkspace].find(
        (cycle) => cycle.ticker === normalized.ticker && cycle.currentPhase !== "cycle_closed",
      );
      const wheelCycleId = existingCycle?.id ?? `wheel-${state.activeWorkspace}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      transfer.destinationWheelCycleId = wheelCycleId;
      const event: WheelEvent = {
        id: `wheel-event-${state.activeWorkspace}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        wheelCycleId,
        type: "stock_transfer",
        occurredAt: transfer.transferDate,
        accountCode: "N",
        description: `${normalized.ticker} ${shares}株をP口座からN口座へ移管`,
        sharesChange: shares,
        phaseAfter: "n_stock_holding",
        linkedSimulationId: normalized.id,
        linkedTransferId: id,
      };
      const nextCycle: WheelCycle = existingCycle
        ? {
            ...existingCycle,
            currentPhase: "n_stock_holding",
            currentAccountCode: "N",
            currentShares: existingCycle.currentShares + shares,
            averageCostUSD: transfer.costBasisUSD,
            eventIds: [...existingCycle.eventIds, event.id],
            linkedSimulationIds: Array.from(new Set([...existingCycle.linkedSimulationIds, normalized.id])),
          }
        : {
            id: wheelCycleId,
            ticker: normalized.ticker,
            primaryAccountCode: "N",
            currentPhase: "n_stock_holding",
            currentAccountCode: "N",
            currentShares: shares,
            averageCostUSD: transfer.costBasisUSD,
            usdCashImpact: 0,
            cumulativePremiumUSD: 0,
            cumulativeStockRealizedPnlUSD: 0,
            cumulativeFeesUSD: 0,
            cumulativeTotalPnlUSD: 0,
            referenceFxRateJPY: normalized.referenceFxRateJPY ?? normalized.fxRateJPY,
            eventIds: [event.id],
            linkedSimulationIds: [normalized.id],
            openedAt: transfer.transferDate,
            memo: "P口座から移管した株式をN口座カバードコールに使うサイクル。",
          };
      const wheelCycles = existingCycle
        ? state.wheelCyclesByWorkspace[state.activeWorkspace].map((cycle) => (cycle.id === existingCycle.id ? nextCycle : cycle))
        : [nextCycle, ...state.wheelCyclesByWorkspace[state.activeWorkspace]];
      const wheelEvents = [event, ...state.wheelEventsByWorkspace[state.activeWorkspace]];
      const stockTransfers = [transfer, ...state.stockTransfersByWorkspace[state.activeWorkspace]];
      const wheelCyclesByWorkspace = { ...state.wheelCyclesByWorkspace, [state.activeWorkspace]: wheelCycles };
      const wheelEventsByWorkspace = { ...state.wheelEventsByWorkspace, [state.activeWorkspace]: wheelEvents };
      const stockTransfersByWorkspace = { ...state.stockTransfersByWorkspace, [state.activeWorkspace]: stockTransfers };
      saveJson(WHEEL_KEY, wheelCyclesByWorkspace);
      saveJson(WHEEL_EVENTS_KEY, wheelEventsByWorkspace);
      saveJson(STOCK_TRANSFERS_KEY, stockTransfersByWorkspace);
      return { wheelCyclesByWorkspace, wheelEventsByWorkspace, stockTransfersByWorkspace, wheelCycles, wheelEvents, stockTransfers };
    }),
  updateSettings: (settings) =>
    set((state) => {
      const next = { ...state.settings, ...settings };
      saveJson(SETTINGS_KEY, next);
      return { settings: next };
    }),
}));
