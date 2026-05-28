import { create } from "zustand";
import type { TradeSimulation, WheelCycle } from "@/types/domain";
import { sampleAmznSimulation } from "@/data/sampleAmzn";

export type WorkspaceMode = "demo" | "live";

const LEGACY_SIMULATIONS_KEY = "us-options-simulations";
const SIMULATIONS_KEY = "us-options-simulations-v2";
const WHEEL_KEY = "us-options-wheel-cycles-v2";
const SETTINGS_KEY = "us-options-settings";
const ACCOUNT_KEY = "us-options-account-snapshots-v1";

export type AppSettings = {
  beginnerMode: boolean;
  defaultMarginBufferMultiplier: number;
  defaultNisaExpectedAnnualReturnPct: number;
};

export type AccountInputs = {
  availableCashJPY: number;
  marginUsagePercent: number;
  updatedAt: string;
};

type OptionsStore = {
  activeWorkspace: WorkspaceMode;
  simulationsByWorkspace: Record<WorkspaceMode, TradeSimulation[]>;
  wheelCyclesByWorkspace: Record<WorkspaceMode, WheelCycle[]>;
  accountInputsByWorkspace: Record<WorkspaceMode, AccountInputs>;
  selectedSimulationIds: Record<WorkspaceMode, string>;
  simulations: TradeSimulation[];
  wheelCycles: WheelCycle[];
  accountInputs: AccountInputs;
  settings: AppSettings;
  selectedSimulationId: string;
  switchWorkspace: (workspace: WorkspaceMode) => void;
  createSimulationFromTemplate: () => void;
  updateAccountInputs: (accountInputs: Partial<AccountInputs>) => void;
  upsertSimulation: (simulation: TradeSimulation) => void;
  replaceWorkspaceSimulations: (simulations: TradeSimulation[]) => void;
  deleteSimulation: (id: string) => void;
  selectSimulation: (id: string) => void;
  createWheelCycleFromSimulation: (simulation: TradeSimulation) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
};

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

const initialSettings = loadJson<AppSettings>(SETTINGS_KEY, {
  beginnerMode: true,
  defaultMarginBufferMultiplier: 2,
  defaultNisaExpectedAnnualReturnPct: 6,
});

function createBlankSimulation(workspace: WorkspaceMode, settings: AppSettings): TradeSimulation {
  const today = new Date();
  const expiry = new Date(today);
  expiry.setDate(today.getDate() + 45);
  const entryDate = today.toISOString().slice(0, 10);
  const expiryDate = expiry.toISOString().slice(0, 10);
  return {
    id: `${workspace}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "planned",
    name: workspace === "demo" ? "デモ口座 新規建玉" : "リアル口座 新規建玉",
    ticker: "",
    underlyingName: "",
    strategyType: "covered_call_plus_short_put",
    currentPriceUSD: 0,
    fxRateJPY: 0,
    entryDate,
    expiryDate,
    dte: 45,
    accountCurrency: "JPY",
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
    taxProfileId: "japan_listed_stock_default_20_315",
    nisaExpectedAnnualReturnPct: settings.defaultNisaExpectedAnnualReturnPct,
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

function normalizeForWorkspace(simulation: TradeSimulation, workspace: WorkspaceMode): TradeSimulation {
  return {
    ...simulation,
    id: `${workspace}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: workspace === "demo" ? simulation.name : "リアル口座 新規建玉",
    fixtureMeta:
      workspace === "demo"
        ? {
            source: "demo",
            isRealMoney: false,
            broker: "SaxoBank",
            purpose: "development-fixture",
            createdAt: "2026-05-26",
            notes: "これは実取引ではなく、画面仕様・計算仕様確認用のサンプルです。",
          }
        : {
            source: "live",
            isRealMoney: true,
            broker: "SaxoBank",
            purpose: "development-fixture",
            createdAt: new Date().toISOString().slice(0, 10),
            notes: "リアル口座管理用。数値はユーザーが実口座画面を見て入力してください。",
          },
  };
}

function loadInitialSimulations(): Record<WorkspaceMode, TradeSimulation[]> {
  const legacy = loadJson<TradeSimulation[] | null>(LEGACY_SIMULATIONS_KEY, null);
  return loadJson<Record<WorkspaceMode, TradeSimulation[]>>(SIMULATIONS_KEY, {
    demo: legacy && legacy.length > 0 ? legacy : [sampleAmznSimulation],
    live: [],
  });
}

function loadInitialWheelCycles(): Record<WorkspaceMode, WheelCycle[]> {
  return loadJson<Record<WorkspaceMode, WheelCycle[]>>(WHEEL_KEY, {
    demo: [],
    live: [],
  });
}

function loadInitialAccountInputs(): Record<WorkspaceMode, AccountInputs> {
  return loadJson<Record<WorkspaceMode, AccountInputs>>(ACCOUNT_KEY, {
    demo: {
      availableCashJPY: sampleAmznSimulation.availableCashJPY ?? 0,
      marginUsagePercent: sampleAmznSimulation.marginUsagePercent ?? 0,
      updatedAt: "2026-05-26",
    },
    live: {
      availableCashJPY: 0,
      marginUsagePercent: 0,
      updatedAt: new Date().toISOString(),
    },
  });
}

const initialWorkspace: WorkspaceMode = loadJson<WorkspaceMode>("us-options-active-workspace", "demo");
const initialSimulationsByWorkspace = loadInitialSimulations();
const initialWheelCyclesByWorkspace = loadInitialWheelCycles();
const initialAccountInputsByWorkspace = loadInitialAccountInputs();
const initialSelectedIds: Record<WorkspaceMode, string> = {
  demo: initialSimulationsByWorkspace.demo[0]?.id ?? sampleAmznSimulation.id,
  live: initialSimulationsByWorkspace.live[0]?.id ?? "",
};

export const useOptionsStore = create<OptionsStore>((set) => ({
  activeWorkspace: initialWorkspace,
  simulationsByWorkspace: initialSimulationsByWorkspace,
  wheelCyclesByWorkspace: initialWheelCyclesByWorkspace,
  accountInputsByWorkspace: initialAccountInputsByWorkspace,
  selectedSimulationIds: initialSelectedIds,
  simulations: initialSimulationsByWorkspace[initialWorkspace],
  wheelCycles: initialWheelCyclesByWorkspace[initialWorkspace],
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
        accountInputs: state.accountInputsByWorkspace[workspace],
        selectedSimulationId: state.selectedSimulationIds[workspace],
      };
    }),
  createSimulationFromTemplate: () =>
    set((state) => {
      const simulation = createBlankSimulation(state.activeWorkspace, state.settings);
      const simulations = [simulation, ...state.simulationsByWorkspace[state.activeWorkspace]];
      const simulationsByWorkspace = {
        ...state.simulationsByWorkspace,
        [state.activeWorkspace]: simulations,
      };
      const selectedSimulationIds = {
        ...state.selectedSimulationIds,
        [state.activeWorkspace]: simulation.id,
      };
      saveJson(SIMULATIONS_KEY, simulationsByWorkspace);
      return {
        simulationsByWorkspace,
        selectedSimulationIds,
        simulations,
        selectedSimulationId: simulation.id,
      };
    }),
  updateAccountInputs: (accountInputs) =>
    set((state) => {
      const next = {
        ...state.accountInputsByWorkspace[state.activeWorkspace],
        ...accountInputs,
        updatedAt: new Date().toISOString(),
      };
      const accountInputsByWorkspace = {
        ...state.accountInputsByWorkspace,
        [state.activeWorkspace]: next,
      };
      saveJson(ACCOUNT_KEY, accountInputsByWorkspace);
      return { accountInputsByWorkspace, accountInputs: next };
    }),
  upsertSimulation: (simulation) =>
    set((state) => {
      const current = state.simulationsByWorkspace[state.activeWorkspace];
      const exists = current.some((item) => item.id === simulation.id);
      const simulations = exists
        ? current.map((item) => (item.id === simulation.id ? simulation : item))
        : [simulation, ...current];
      const simulationsByWorkspace = {
        ...state.simulationsByWorkspace,
        [state.activeWorkspace]: simulations,
      };
      const selectedSimulationIds = {
        ...state.selectedSimulationIds,
        [state.activeWorkspace]: simulation.id,
      };
      saveJson(SIMULATIONS_KEY, simulationsByWorkspace);
      return { simulationsByWorkspace, selectedSimulationIds, simulations, selectedSimulationId: simulation.id };
    }),
  replaceWorkspaceSimulations: (incoming) =>
    set((state) => {
      const simulations = incoming.map((simulation) => ({
        ...simulation,
        id: simulation.id || `${state.activeWorkspace}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      }));
      const simulationsByWorkspace = {
        ...state.simulationsByWorkspace,
        [state.activeWorkspace]: simulations,
      };
      const selectedSimulationIds = {
        ...state.selectedSimulationIds,
        [state.activeWorkspace]: simulations[0]?.id ?? "",
      };
      saveJson(SIMULATIONS_KEY, simulationsByWorkspace);
      return {
        simulationsByWorkspace,
        selectedSimulationIds,
        simulations,
        selectedSimulationId: selectedSimulationIds[state.activeWorkspace],
      };
    }),
  deleteSimulation: (id) =>
    set((state) => {
      const simulations = state.simulationsByWorkspace[state.activeWorkspace].filter((item) => item.id !== id);
      const simulationsByWorkspace = {
        ...state.simulationsByWorkspace,
        [state.activeWorkspace]: simulations,
      };
      const selectedSimulationIds = {
        ...state.selectedSimulationIds,
        [state.activeWorkspace]: simulations[0]?.id ?? "",
      };
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
      const existing = state.wheelCyclesByWorkspace[state.activeWorkspace].find(
        (cycle) => cycle.ticker === simulation.ticker && cycle.trades.includes(simulation.id),
      );
      if (existing) return {};
      const phase =
        simulation.strategyType === "covered_call"
          ? "covered_call"
          : simulation.status === "assigned"
            ? "assigned_stock"
            : "short_put";
      const stockShares = simulation.stockPosition?.shares ?? 0;
      const cycle: WheelCycle = {
        id: `wheel-${state.activeWorkspace}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        ticker: simulation.ticker,
        phase,
        trades: [simulation.id],
        cumulativePremiumJPY: 0,
        cumulativeRealizedPnlJPY: 0,
        currentShares: stockShares,
        currentCostBasisUSD: simulation.stockPosition?.averageCostUSD ?? 0,
      };
      const wheelCycles = [cycle, ...state.wheelCyclesByWorkspace[state.activeWorkspace]];
      const wheelCyclesByWorkspace = {
        ...state.wheelCyclesByWorkspace,
        [state.activeWorkspace]: wheelCycles,
      };
      saveJson(WHEEL_KEY, wheelCyclesByWorkspace);
      return { wheelCyclesByWorkspace, wheelCycles };
    }),
  updateSettings: (settings) =>
    set((state) => {
      const next = { ...state.settings, ...settings };
      saveJson(SETTINGS_KEY, next);
      return { settings: next };
    }),
}));
