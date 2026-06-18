import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Ban, Cable, CheckCircle2, Clipboard, Download, Eye, FilePlus2, Link2, LogOut, RefreshCw, Save, ShieldCheck } from "lucide-react";
import {
  disableSaxoPersistence,
  enableSaxoPersistence,
  fetchSaxoAccounts,
  fetchSaxoAccountsSnapshot,
  fetchSaxoConfigStatus,
  fetchSaxoHistoryDiscovery,
  fetchSaxoOrdersSnapshot,
  fetchSaxoPositionsSnapshot,
  fetchSaxoStatus,
  logoutSaxo,
  saveSaxoLocalConfig,
  startSaxoAuth,
} from "@/features/saxo/saxoApiClient";
import {
  createSaxoSetupGuidance,
  createAccountPatchFromSaxoSnapshot,
  createSaxoAccountDiffRows,
  getSaxoAccountReflectionBlockReason,
  applyPositionAccountMappings,
  applyOrderAccountMappings,
  createSaxoPositionDraftSummary,
  findEntryHistoryMatches,
  findSaxoAssignmentStockAcquisitionItem,
  getSaxoHistoryCandidateKeys,
  getConfirmedMappingForAccount,
  getSaxoHistoryCandidateTarget,
  getSaxoHistoryStableKey,
  hasAppliedSaxoSnapshot,
  isSaxoHistoryMatchingCloseExecution,
  isSaxoHistoryMatchingEntryExecution,
  isSaxoHistoryMatchingStockAcquisition,
  maskSaxoIdentifier,
  reconcileSaxoPositions,
  resolveSaxoPositionSymbol,
  type SaxoAccountMapping,
  type SaxoApiAccount,
  type SaxoApiAccountSnapshot,
  type SaxoApiOrderSnapshot,
  type SaxoApiPositionSnapshot,
  type SaxoApiStatus,
  type SaxoConfigStatus,
  type SaxoSetupGuidance,
  type SaxoMappedCode,
  type SaxoHistoryDiscoveryEndpoint,
  type SaxoHistoryDiscoveryItem,
  type SaxoPositionReconciliationRow,
} from "@/features/saxo/saxoAccountSync";
import type { AccountInputs, WorkspaceMode } from "@/store/useOptionsStore";
import type { AccountState, SaxoAccountCode, StockTransferEvent, TradeSimulation } from "@/types/domain";
import { formatJPY, formatNumber, formatPct, formatUSD } from "@/lib/format";

const SAXO_MAPPING_STORAGE_KEY = "us-options-saxo-account-mappings-v1";
const SAXO_REFLECTED_HISTORY_KEY = "us-options-saxo-reflected-history-candidates-v1";
const SAXO_IGNORED_HISTORY_KEY = "us-options-saxo-ignored-history-candidates-v1";
const SAXO_DRAFTED_POSITION_KEY = "us-options-saxo-drafted-position-candidates-v1";
const SAXO_LINKED_POSITION_KEY = "us-options-saxo-linked-position-candidates-v1";
const SAXO_LINKED_POSITION_TARGET_KEY = "us-options-saxo-linked-position-targets-v1";
const SAXO_ONBOARDING_CHECKS_KEY = "us-options-saxo-onboarding-checks-v1";
const SAXO_LOCAL_API_OS_KEY = "us-options-saxo-local-api-os-v1";
const SAXO_LOCAL_API_SETUP_KEY = "us-options-saxo-local-api-setup-v1";
const SAXO_ONBOARDING_STEPS = [
  { id: "developer_portal", label: "Saxo Developer Portalに入れる" },
  { id: "sim_application", label: "SIM applicationを作成した" },
  { id: "redirect_uri", label: "Redirect URIを登録した" },
  { id: "live_app", label: "LIVE appを申請または取得した" },
  { id: "client_id", label: "Client ID / AppKeyを確認した" },
  { id: "local_api", label: "ローカルAPIを起動した" },
  { id: "readonly_connected", label: "Read-only接続できた" },
] as const;
type SaxoOnboardingStepId = (typeof SAXO_ONBOARDING_STEPS)[number]["id"];
const SAXO_LOCAL_API_SETUP_STEPS = [
  { id: "repository", label: "ローカルAPI補助ツールを準備済み" },
  { id: "node", label: "Node.js/npm導入済み" },
  { id: "env_local", label: ".env.local作成済み" },
  { id: "local_api", label: "ローカルAPI起動済み" },
] as const;
type SaxoLocalApiSetupStepId = (typeof SAXO_LOCAL_API_SETUP_STEPS)[number]["id"];
type SaxoLocalApiOs = "mac" | "windows" | "unknown";
const SAXO_PUBLIC_UI_ALLOWED_ORIGIN = "https://jimusaku-lab.github.io";
const SAXO_PUBLIC_UI_RETURN_URL = "https://jimusaku-lab.github.io/us-options-risk-planner/";
const SAXO_LOCAL_API_SUCCESS_LOG = "Saxo read-only local API listening on http://127.0.0.1:18787";

type SaxoPanelConnectionState = NonNullable<SaxoApiStatus["connectionState"]> | "disconnected" | "local_api_down";
type LocalApiReachability = "unknown" | "checking" | "down" | "cors_or_pna_blocked" | "up";
type LinkedSimulationResolution =
  | { status: "linked"; simulation: TradeSimulation; simulationId: string }
  | { status: "broken"; reason: string; simulationId?: string }
  | { status: "unlinked" };

type HistoryReflectionState =
  | { status: "none" }
  | { status: "candidate"; simulationId: string; recordId: string; target: "entry" | "close" | "assignment"; assignmentCompleted?: boolean; assignmentTransferred?: boolean }
  | { status: "official"; simulationId: string; recordId: string; target: "entry" | "close" | "assignment"; assignmentCompleted?: boolean; assignmentTransferred?: boolean }
  | { status: "ignored" }
  | { status: "broken"; target: "entry" | "close" | "assignment" | "unknown"; reason: string };

export function SaxoReadOnlyPanel({
  workspace,
  accountInputs,
  simulations,
  onApplyAccountState,
  onOrdersChange,
  onHistoryCandidatesChange,
  onCreateHistoryDraft,
  onCreateAssignmentDraft,
  onCreatePositionDraft,
  onCreateStockTransferFromPosition,
  stockTransfers = [],
  onOpenLinkedSimulation,
  onOpenHistoryTarget,
  onOpenWheelManagement,
  onDownloadJson,
}: {
  workspace: WorkspaceMode;
  accountInputs: AccountInputs;
  simulations: TradeSimulation[];
  onApplyAccountState: (accountCode: SaxoAccountCode, patch: Partial<AccountState>) => void;
  onOrdersChange?: (orders: SaxoApiOrderSnapshot[]) => void;
  onHistoryCandidatesChange?: (items: SaxoHistoryDiscoveryItem[]) => void;
  onCreateHistoryDraft?: (item: SaxoHistoryDiscoveryItem) => { simulationId?: string; closeExecutionId?: string } | void;
  onCreateAssignmentDraft?: (item: SaxoHistoryDiscoveryItem, stockItem?: SaxoHistoryDiscoveryItem) => { simulationId?: string } | void;
  onCreatePositionDraft?: (position: SaxoApiPositionSnapshot, historyItems?: SaxoHistoryDiscoveryItem[]) => void;
  onCreateStockTransferFromPosition?: (position: SaxoApiPositionSnapshot, sourceSimulationId?: string) => boolean | void;
  stockTransfers?: StockTransferEvent[];
  onOpenLinkedSimulation?: (simulationId: string, anchorId?: string) => void;
  onOpenHistoryTarget?: (anchorId: "option-entry-executions" | "option-close-executions" | "stock-acquisition-record", sourceTradeId?: string) => void;
  onOpenWheelManagement?: (ticker?: string) => void;
  onDownloadJson?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showConnectionDetails, setShowConnectionDetails] = useState(false);
  const [showOtherAccounts, setShowOtherAccounts] = useState(false);
  const [showPnSettings, setShowPnSettings] = useState(false);
  const [showIndividualFetch, setShowIndividualFetch] = useState(false);
  const [status, setStatus] = useState<SaxoApiStatus | null>(null);
  const [configStatus, setConfigStatus] = useState<SaxoConfigStatus | null>(null);
  const [accounts, setAccounts] = useState<SaxoApiAccount[]>([]);
  const [snapshots, setSnapshots] = useState<SaxoApiAccountSnapshot[]>([]);
  const [positions, setPositions] = useState<SaxoApiPositionSnapshot[]>([]);
  const [positionsFetchedAt, setPositionsFetchedAt] = useState("");
  const [orders, setOrders] = useState<SaxoApiOrderSnapshot[]>([]);
  const [ordersFetchedAt, setOrdersFetchedAt] = useState("");
  const [historyEndpoints, setHistoryEndpoints] = useState<SaxoHistoryDiscoveryEndpoint[]>([]);
  const [historyFetchedAt, setHistoryFetchedAt] = useState("");
  const [expandedPositionId, setExpandedPositionId] = useState("");
  const [highlightedPositionId, setHighlightedPositionId] = useState("");
  const [expandedOrderId, setExpandedOrderId] = useState("");
  const [ignoredPositionIds, setIgnoredPositionIds] = useState<string[]>([]);
  const [draftPosition, setDraftPosition] = useState<SaxoApiPositionSnapshot | null>(null);
  const [historyDraft, setHistoryDraft] = useState<SaxoHistoryDiscoveryItem | null>(null);
  const [reflectedHistoryIds, setReflectedHistoryIds] = useState<string[]>(loadReflectedHistoryIds);
  const [ignoredHistoryIds, setIgnoredHistoryIds] = useState<string[]>(loadIgnoredHistoryIds);
  const [draftedPositionIds, setDraftedPositionIds] = useState<string[]>(loadDraftedPositionIds);
  const [linkedPositionIds, setLinkedPositionIds] = useState<string[]>(loadLinkedPositionIds);
  const [linkedPositionTargets, setLinkedPositionTargets] = useState<Record<string, string>>(loadLinkedPositionTargets);
  const [positionActionErrors, setPositionActionErrors] = useState<Record<string, string>>({});
  const [positionActionNotices, setPositionActionNotices] = useState<Record<string, string>>({});
  const [historyActionMessages, setHistoryActionMessages] = useState<Record<string, { tone: "success" | "error" | "info"; message: string }>>({});
  const [mappings, setMappings] = useState<SaxoAccountMapping[]>(loadMappings);
  const [message, setMessage] = useState("");
  const [apiErrorMessage, setApiErrorMessage] = useState("");
  const [localApiDown, setLocalApiDown] = useState(false);
  const [localApiReachability, setLocalApiReachability] = useState<LocalApiReachability>("unknown");
  const [setupClientId, setSetupClientId] = useState("");
  const [setupEnvironment, setSetupEnvironment] = useState<"sim" | "live">("sim");
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [onboardingChecks, setOnboardingChecks] = useState<Record<SaxoOnboardingStepId, boolean>>(loadOnboardingChecks);
  const [localApiOs, setLocalApiOs] = useState<SaxoLocalApiOs>(loadLocalApiOs);
  const [localApiSetupChecks, setLocalApiSetupChecks] =
    useState<Record<SaxoLocalApiSetupStepId, boolean>>(loadLocalApiSetupChecks);
  const [startCommandCopied, setStartCommandCopied] = useState(false);
  const [showPreparationDetails, setShowPreparationDetails] = useState(false);
  const [dismissedPersistencePrompt, setDismissedPersistencePrompt] = useState(false);
  const mappingWorkspace = workspace === "demo" ? "demo" : "real";
  const pendingSummaryRef = useRef<HTMLDivElement | null>(null);
  const mappingRef = useRef<HTMLDivElement | null>(null);
  const snapshotRef = useRef<HTMLDivElement | null>(null);
  const positionsRef = useRef<HTMLDivElement | null>(null);
  const ordersRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("saxoConnected") !== "1") return;
    setIsOpen(true);
    setShowConnectionDetails(false);
    void (async () => {
      await refreshStatus();
      setMessage("Saxo認証が完了しました。接続状態を更新しました。次はまとめて取得へ進んでください。");
    })();
    params.delete("saxoConnected");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }, []);

  useEffect(() => {
    saveMappings(mappings);
  }, [mappings]);

  useEffect(() => {
    saveReflectedHistoryIds(reflectedHistoryIds);
  }, [reflectedHistoryIds]);

  useEffect(() => {
    saveIgnoredHistoryIds(ignoredHistoryIds);
  }, [ignoredHistoryIds]);

  useEffect(() => {
    saveDraftedPositionIds(draftedPositionIds);
  }, [draftedPositionIds]);

  useEffect(() => {
    saveLinkedPositionIds(linkedPositionIds);
  }, [linkedPositionIds]);

  useEffect(() => {
    saveLinkedPositionTargets(linkedPositionTargets);
  }, [linkedPositionTargets]);

  useEffect(() => {
    saveOnboardingChecks(onboardingChecks);
  }, [onboardingChecks]);

  useEffect(() => {
    saveLocalApiOs(localApiOs);
  }, [localApiOs]);

  useEffect(() => {
    saveLocalApiSetupChecks(localApiSetupChecks);
  }, [localApiSetupChecks]);

  const mappedSnapshots = useMemo(() => {
    const accountCodes: SaxoAccountCode[] = workspace === "demo" ? ["P"] : ["P", "N"];
    return accountCodes.map((accountCode) => {
      const mapping = getConfirmedMappingForAccount(
        mappings.filter((item) => item.workspace === mappingWorkspace),
        accountCode,
      );
      const snapshot = mapping ? snapshots.find((item) => item.accountKey === mapping.accountKey) : undefined;
      return { accountCode, mapping, snapshot };
    });
  }, [mappingWorkspace, mappings, snapshots]);

  const workspaceMappings = useMemo(
    () => mappings.filter((item) => item.workspace === mappingWorkspace),
    [mappingWorkspace, mappings],
  );

  const accountDisplayGroups = useMemo(() => {
    const withMapping = accounts.map((account) => ({
      account,
      mappedCode: mappings.find((mapping) => mapping.workspace === mappingWorkspace && mapping.accountKey === account.accountKey)?.mappedCode ?? "unmapped",
    }));
    const primary = withMapping.filter(({ account, mappedCode }) => shouldShowAccountByDefault(account, mappedCode));
    const secondary = withMapping.filter(({ account, mappedCode }) => !shouldShowAccountByDefault(account, mappedCode));
    return { primary, secondary };
  }, [accounts, mappingWorkspace, mappings]);

  const mappedPositions = useMemo(() => {
    const mapped = applyPositionAccountMappings(positions, workspaceMappings);
    return mapped.map((position) =>
      ignoredPositionIds.includes(position.id) ? { ...position, accountAssignment: "ignored" as const, accountCode: undefined } : position,
    );
  }, [ignoredPositionIds, positions, workspaceMappings]);

  const mappedOrders = useMemo(
    () => applyOrderAccountMappings(orders, workspaceMappings),
    [orders, workspaceMappings],
  );

  useEffect(() => {
    onOrdersChange?.(mappedOrders);
  }, [mappedOrders, onOrdersChange]);

  useEffect(() => {
    onHistoryCandidatesChange?.(historyEndpoints.flatMap((endpoint) => endpoint.items ?? []));
  }, [historyEndpoints, onHistoryCandidatesChange]);

  const positionRows = useMemo(
    () => reconcileSaxoPositions(simulations, mappedPositions),
    [mappedPositions, simulations],
  );
  const historyReflectionStates = useMemo(
    () => createHistoryReflectionStates(historyEndpoints, simulations, reflectedHistoryIds, ignoredHistoryIds, stockTransfers),
    [historyEndpoints, ignoredHistoryIds, simulations, reflectedHistoryIds, stockTransfers],
  );

  function resolveLinkedSimulation(row: SaxoPositionReconciliationRow): LinkedSimulationResolution {
    const positionId = row.position?.id;
    if (!positionId) {
      return { status: "unlinked" };
    }
    const hasLinkedId = linkedPositionIds.includes(positionId);
    const storedSimulationId = linkedPositionTargets[positionId];
    if (!hasLinkedId && !storedSimulationId) {
      return { status: "unlinked" };
    }
    const fallbackSimulationId = hasLinkedId ? row.simulation?.id : undefined;
    const simulationId = storedSimulationId ?? fallbackSimulationId;
    if (!simulationId) {
      return {
        status: "broken",
        reason: "linkedPositionIdsにはありますが、紐づけ先の建玉IDが保存されていません。",
      };
    }
    const simulation = simulations.find((item) => item.id === simulationId);
    if (!simulation) {
      return {
        status: "broken",
        simulationId,
        reason: "保存済みの紐づけ先建玉が見つかりません。",
      };
    }
    return { status: "linked", simulation, simulationId };
  }

  const reflectionSummary = useMemo(
    () => createReflectionSummary({
      mappedSnapshots,
      accountInputs,
      positionRows,
      simulations,
      stockTransfers,
      orders: mappedOrders,
      historyEndpoints,
      historyReflectionStates,
    }),
    [accountInputs, historyEndpoints, historyReflectionStates, mappedOrders, mappedSnapshots, positionRows, simulations, stockTransfers],
  );

  function createHistoryDraft(item: SaxoHistoryDiscoveryItem, openAfterCreate = false): boolean {
    const target = getSaxoHistoryCandidateTarget(item);
    const historyKeys = getSaxoHistoryCandidateKeys(item);
    const primaryHistoryKey = getSaxoHistoryStableKey(item);
    const setRowMessage = (tone: "success" | "error" | "info", message: string) => {
      setHistoryActionMessages((current) => ({ ...current, [primaryHistoryKey]: { tone, message } }));
    };
    if (target === "unknown") {
      const message = "この履歴候補は建玉開始か決済かを判定できません。Saxo画面で売買区分と新規/決済区分を確認してください。自動反映候補は作成しません。";
      setMessage(message);
      setRowMessage("error", message);
      return false;
    }

    const reflectionState = historyReflectionStates[item.id] ?? { status: "none" as const };
    if (reflectionState.status === "ignored") {
      const message = "この履歴候補は今回は無視済みです。再作成する場合は先に無視を取り消してください。";
      setMessage(message);
      setRowMessage("info", message);
      return false;
    }
    if (reflectionState.status === "candidate" || reflectionState.status === "official") {
      const message =
        reflectionState.status === "official"
          ? "この履歴候補はすでに正式保存済みです。重複候補は作成しません。"
          : "この履歴候補はすでに入力補助へ反映済みです。同じ候補の二重反映はできません。";
      setMessage(message);
      setRowMessage("info", message);
      if (openAfterCreate) {
        onOpenHistoryTarget?.(getHistoryCandidateAnchorId(item), item.id);
      }
      return true;
    }

    const historyItems = historyEndpoints.flatMap((endpoint) => endpoint.items ?? []);
    const assignmentStockItem = target === "assignment" ? findSaxoAssignmentStockAcquisitionItem(item, historyItems) : undefined;
    const created = target === "assignment" ? onCreateAssignmentDraft?.(item, assignmentStockItem) : onCreateHistoryDraft?.(item);
    if (!created?.simulationId) {
      const targetLabel = target === "assignment" ? "権利行使候補" : target === "close" ? "決済実績候補" : "建玉開始候補";
      const message = `${targetLabel}を作成できませんでした。P/N口座、銘柄、Put/Call、権利行使価格、満期、数量が対象建玉と一致するか確認してください。`;
      setMessage(message);
      setRowMessage("error", message);
      return false;
    }

    setHistoryDraft(item);
    setIgnoredHistoryIds((current) => current.filter((id) => !historyKeys.includes(id)));
    setReflectedHistoryIds((current) => {
      const withoutCurrent = current.filter((id) => !historyKeys.includes(id));
      return [...withoutCurrent, primaryHistoryKey];
    });
    const successMessage =
      target === "assignment"
        ? "権利行使候補を作成しました。6-A. 現物株の取得記録で株数と取得単価を確認してください。通常の買戻し決済としては保存していません。"
        : target === "close"
          ? "決済実績への反映候補を作成しました。正式な決済実績保存や現金残高反映はまだ行っていません。"
          : "建玉開始の約定確認への反映候補を作成しました。正式な建玉保存はまだ行っていません。";
    setMessage(successMessage);
    setRowMessage("success", successMessage);

    if (openAfterCreate) {
      onOpenHistoryTarget?.(getHistoryCandidateAnchorId(item), item.id);
    }
    return true;
  }

  function createHistoryDrafts(items: SaxoHistoryDiscoveryItem[]) {
    const creatableItems = items.filter((item) => {
      const target = getSaxoHistoryCandidateTarget(item);
      const state = historyReflectionStates[item.id] ?? { status: "none" as const };
      return target !== "unknown" && state.status === "none";
    });
    if (creatableItems.length === 0) {
      setMessage("不足している反映候補はありません。監査用の復旧候補がある場合は、履歴候補の各行から必要なものだけ再作成してください。");
      return;
    }
    let entryCount = 0;
    let closeCount = 0;
    let assignmentCount = 0;
    let failedCount = 0;
    for (const item of creatableItems) {
      const target = getSaxoHistoryCandidateTarget(item);
      const ok = createHistoryDraft(item, false);
      if (ok && target === "entry") entryCount += 1;
      if (ok && target === "close") closeCount += 1;
      if (ok && target === "assignment") assignmentCount += 1;
      if (!ok) failedCount += 1;
    }
    setMessage(
      failedCount > 0
        ? `反映候補を作成しました。3-A確認待ち ${entryCount}件 / 7確認待ち ${closeCount}件 / 6-A権利行使 ${assignmentCount}件 / 作成失敗 ${failedCount}件。失敗した行は不足理由を確認してください。`
        : `反映候補を作成しました。3-A確認待ち ${entryCount}件 / 7確認待ち ${closeCount}件 / 6-A権利行使 ${assignmentCount}件。`,
    );
  }

  function ignoreHistoryCandidate(item: SaxoHistoryDiscoveryItem) {
    const historyKeys = getSaxoHistoryCandidateKeys(item);
    const primaryHistoryKey = getSaxoHistoryStableKey(item);
    setIgnoredHistoryIds((current) => {
      const withoutCurrent = current.filter((id) => !historyKeys.includes(id));
      return [...withoutCurrent, primaryHistoryKey];
    });
    setReflectedHistoryIds((current) => current.filter((id) => !historyKeys.includes(id)));
    const message = "この履歴候補は今回は無視しました。正式保存や現金残高反映は行いません。";
    setMessage(message);
    setHistoryActionMessages((current) => ({ ...current, [primaryHistoryKey]: { tone: "info", message } }));
  }

  function unignoreHistoryCandidate(item: SaxoHistoryDiscoveryItem) {
    const historyKeys = getSaxoHistoryCandidateKeys(item);
    const primaryHistoryKey = getSaxoHistoryStableKey(item);
    setIgnoredHistoryIds((current) => current.filter((id) => !historyKeys.includes(id)));
    const message = "この履歴候補の無視を取り消しました。必要に応じて反映候補を作成してください。";
    setMessage(message);
    setHistoryActionMessages((current) => ({ ...current, [primaryHistoryKey]: { tone: "info", message } }));
  }

  async function refreshStatus() {
    try {
      const nextStatus = await fetchSaxoStatus();
      setStatus(nextStatus);
      setLocalApiDown(false);
      setLocalApiReachability("up");
      setLocalApiSetupChecks((current) => ({ ...current, local_api: true }));
      setApiErrorMessage("");
      try {
        const nextConfigStatus = await fetchSaxoConfigStatus();
        setConfigStatus(nextConfigStatus);
        setSetupEnvironment(nextConfigStatus.environment);
      } catch (error) {
        setConfigStatus(null);
        setApiErrorMessage(error instanceof Error ? error.message : "SaxoローカルAPI設定を確認できませんでした。");
      }
      setMessage(nextStatus.message ?? nextStatus.connectionError ?? "");
    } catch (error) {
      setStatus(null);
      setConfigStatus(null);
      setLocalApiDown(true);
      const reachability = classifyLocalApiFetchFailure(error);
      setLocalApiReachability(reachability);
      setLocalApiSetupChecks((current) => ({ ...current, local_api: false }));
      const nextMessage = error instanceof Error ? error.message : "SaxoローカルAPIへ接続できません。";
      setApiErrorMessage(nextMessage);
      setMessage(nextMessage);
    }
  }

  async function refreshLocalApiStartupStatus() {
    setIsLoading(true);
    setLocalApiReachability("checking");
    setMessage("SaxoローカルAPIの起動状態を確認しています...");
    try {
      const nextStatus = await fetchSaxoStatus();
      setStatus(nextStatus);
      setLocalApiDown(false);
      setLocalApiReachability("up");
      setLocalApiSetupChecks((current) => ({ ...current, local_api: true }));
      setApiErrorMessage("");
      try {
        const nextConfigStatus = await fetchSaxoConfigStatus();
        setConfigStatus(nextConfigStatus);
        setSetupEnvironment(nextConfigStatus.environment);
      } catch (error) {
        setConfigStatus(null);
        setApiErrorMessage(error instanceof Error ? error.message : "SaxoローカルAPI設定を確認できませんでした。");
      }
      setMessage(
        createLocalApiStartupSuccessMessage(nextStatus),
      );
    } catch (error) {
      setStatus(null);
      setConfigStatus(null);
      setLocalApiDown(true);
      const reachability = classifyLocalApiFetchFailure(error);
      setLocalApiReachability(reachability);
      setLocalApiSetupChecks((current) => ({ ...current, local_api: false }));
      const nextMessage = error instanceof Error ? error.message : "SaxoローカルAPIへ接続できません。";
      setApiErrorMessage(nextMessage);
      setMessage(createLocalApiStartupResultMessage(reachability));
    } finally {
      setIsLoading(false);
    }
  }

  async function beginSaxoAuth() {
    if (localApiDown || !status) {
      setMessage("Saxo接続の前に、ローカルAPIを起動してください。");
      return;
    }
    setIsLoading(true);
    try {
      const nextStatus = await fetchSaxoStatus();
      setStatus(nextStatus);
      setLocalApiDown(false);
      setLocalApiReachability("up");
      if (!nextStatus.oauthConfigured) {
        setMessage("LIVE AppKey（Client ID）が未設定です。設定・診断内の接続セットアップで、Saxo Developer PortalのLIVE AppKeyを保存してください。");
        return;
      }
      if (nextStatus.environmentConfigured === false) {
        setMessage("SAXO_ENVIRONMENT が未設定です。実検証では SAXO_ENVIRONMENT=sim を明示して起動してください。");
        return;
      }
      startSaxoAuth();
    } catch (error) {
      setStatus(null);
      setLocalApiDown(true);
      const reachability = classifyLocalApiFetchFailure(error);
      setLocalApiReachability(reachability);
      setMessage(
        error instanceof Error
          ? error.message
          : "SaxoローカルAPIが起動していません。ローカルAPI補助ツールのフォルダで `npm run dev:saxo-api` を起動してください。",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function saveLocalConfig() {
    setIsSavingConfig(true);
    try {
      const nextConfigStatus = await saveSaxoLocalConfig({ clientId: setupClientId, environment: setupEnvironment });
      setConfigStatus(nextConfigStatus);
      setSetupClientId("");
      await refreshStatus();
      setMessage(nextConfigStatus.message ?? "ローカル設定を保存しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ローカル設定を保存できませんでした。");
    } finally {
      setIsSavingConfig(false);
    }
  }

  async function copyRedirectUri() {
    const redirectUri = status?.redirectUri ?? configStatus?.redirectUri ?? "http://127.0.0.1:18787/api/saxo/auth/callback";
    try {
      await navigator.clipboard.writeText(redirectUri);
      setMessage("redirect URIをコピーしました。");
    } catch {
      setMessage(`redirect URI: ${redirectUri}`);
    }
  }

  async function copyLocalApiStartCommand() {
    try {
      await navigator.clipboard.writeText(getSaxoLocalApiStartCommand(localApiOs));
      setStartCommandCopied(true);
      setMessage(
        localApiOs === "unknown"
          ? "MacまたはWindowsを選択してください。OSが分からない場合は、使っているPCに合わせて選び直してください。"
          : localApiOs === "windows"
          ? "起動コマンドをコピーしました。PowerShellでローカルAPI補助ツールのフォルダを開いて貼り付け、Enterを押してください。"
          : "起動コマンドをコピーしました。ターミナルでローカルAPI補助ツールのフォルダを開いて貼り付け、Enterを押してください。`>` が出た場合は Control + C でキャンセルして貼り直してください。",
      );
    } catch {
      setMessage("起動コマンドをコピーできませんでした。画面上のコマンドを手動でコピーしてください。");
    }
  }

  function toggleOnboardingCheck(id: SaxoOnboardingStepId, checked: boolean) {
    setOnboardingChecks((current) => ({ ...current, [id]: checked }));
  }

  function toggleLocalApiSetupCheck(id: SaxoLocalApiSetupStepId, checked: boolean) {
    setLocalApiSetupChecks((current) => ({ ...current, [id]: checked }));
  }

  async function copyFriendConsultationPrompt() {
    const prompt = [
      "目的:",
      "GitHub Pages公開版の米国株オプション建玉管理アプリで、Saxo OpenAPI Read-only接続を設定したいです。",
      "",
      "前提:",
      "アプリ本体はGitHub Pagesの公開版を使い続けます。",
      "Saxo API接続を使う場合だけ、Saxoとの通信を担当するPC側補助ツールを自分のPC上で起動する必要があります。",
      "この補助ツールは発注を行わず、Read-only取得だけを行います。",
      "",
      "あなたに伴走してほしいこと:",
      "1. 私のPCがMacかWindowsかを確認してください。",
      "2. Saxo Developer Portalに入る手順を案内してください。",
      "3. OpenAPI applicationを作る手順を案内してください。",
      "4. Redirect URIとして次を登録するよう案内してください。",
      "   http://127.0.0.1:18787/api/saxo/auth/callback",
      "5. LIVE AppKey（Client ID）を確認する手順を案内してください。",
      "6. PC側補助ツールの準備に必要なNode.js/npm、.env.local、起動コマンドの手順を、Mac/Windows別に案内してください。",
      "7. ローカルAPI起動後、次の成功ログが出ているか確認するよう案内してください。",
      "   Saxo read-only local API listening on http://127.0.0.1:18787",
      "8. Macでターミナルに `>` だけが出て止まった場合は、Control + Cでキャンセルして1行コマンドを貼り直すよう案内してください。",
      "9. アプリ画面に戻って「起動できたか確認」を押し、その後「Saxo接続」または「Saxo再接続」へ進むよう案内してください。",
      "",
      "絶対に共有しない情報:",
      "- Saxo ID",
      "- Saxoパスワード",
      "- 2FAコード",
      "- Client Secret",
      "- Saxo Account ID",
      "- OAuth token",
      "- refresh token",
      "- 口座番号",
      "- 口座残高や建玉の詳細スクリーンショット",
      "",
      "共有してよい情報:",
      "- OSがMacかWindowsか",
      "- 画面上の一般的な文言",
      "- Redirect URI",
      "- エラー文",
      "- 個人情報を隠したスクリーンショット",
      "- LIVE AppKeyが「取得済みかどうか」だけ",
      "",
      "重要:",
      "Client Secretはこのアプリでは使いません。",
      "Saxo ID、パスワード、2FAコード、OAuth tokenは、ChatGPT/Codexにもアプリ作者にも貼りません。",
      "このアプリは発注・注文変更・注文取消を行わないRead-only用途です。",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(prompt);
      setMessage("ChatGPT/Codexに渡す相談文をコピーしました。秘密情報は含めていません。");
    } catch {
      setMessage(prompt);
    }
  }

  async function loadAccounts() {
    if (localApiDown) {
      setMessage("SaxoローカルAPIが起動していません。先にローカルAPIを起動してください。");
      return;
    }
    if (connectionState !== "connected") {
      setMessage("Saxoに未接続のため、口座一覧を取得できません。先に「Saxo接続」を押して認証を完了してください。");
      setShowConnectionDetails(false);
      return;
    }
    setIsLoading(true);
    setMessage("口座一覧を取得中...");
    try {
      const response = await fetchSaxoAccounts();
      setAccounts(response.accounts);
      setShowPnSettings(true);
      setMessage(`${response.accounts.length}件のSaxo口座を取得しました。P口座 / N口座を割り当ててください。`);
      await refreshStatus();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Saxo口座一覧を取得できませんでした。";
      setMessage(isSaxoNotConnectedError(errorMessage)
        ? "Saxo接続が切れています。再接続してから口座一覧を取得してください。"
        : errorMessage);
      await refreshStatus();
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSnapshots() {
    if (localApiDown) {
      setMessage("SaxoローカルAPIが起動していません。先にローカルAPIを起動してください。");
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetchSaxoAccountsSnapshot();
      setSnapshots(response.accounts);
      setMessage("口座残高・証拠金を取得しました。反映前に差分を確認してください。");
      await refreshStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "口座残高・証拠金を取得できませんでした。");
      await refreshStatus();
    } finally {
      setIsLoading(false);
    }
  }

  async function loadPositions() {
    if (localApiDown) {
      setMessage("SaxoローカルAPIが起動していません。先にローカルAPIを起動してください。");
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetchSaxoPositionsSnapshot();
      setPositions(response.positions);
      setPositionsFetchedAt(response.fetchedAt);
      setMessage(`${response.positions.length}件の現在建玉を取得しました。P/N割当済み口座だけを照合対象にしています。`);
      await refreshStatus();
    } catch (error) {
      await refreshStatus();
      setMessage(error instanceof Error ? error.message : "現在建玉を取得できませんでした。");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadOrders() {
    if (localApiDown) {
      setMessage("SaxoローカルAPIが起動していません。先にローカルAPIを起動してください。");
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetchSaxoOrdersSnapshot();
      setOrders(response.orders);
      setOrdersFetchedAt(response.fetchedAt);
      setMessage(`${response.orders.length}件の未約定注文を取得しました。出口注文候補として表示しますが、自動反映はしません。`);
      await refreshStatus();
    } catch (error) {
      await refreshStatus();
      setMessage(error instanceof Error ? error.message : "未約定注文を取得できませんでした。");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadHistoryDiscovery() {
    if (localApiDown) {
      setMessage("SaxoローカルAPIが起動していません。先にローカルAPIを起動してください。");
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetchSaxoHistoryDiscovery();
      const mappedEndpoints = enrichHistoryEndpointsWithAccountMappings(response.endpoints, mappings);
      setHistoryEndpoints(mappedEndpoints);
      onHistoryCandidatesChange?.(mappedEndpoints.flatMap((endpoint) => endpoint.items ?? []));
      setHistoryFetchedAt(response.fetchedAt);
      setMessage("決済履歴・約定履歴の候補endpointを確認しました。取得値は下書き候補扱いです。");
      await refreshStatus();
    } catch (error) {
      await refreshStatus();
      setMessage(error instanceof Error ? error.message : "履歴系endpointを確認できませんでした。");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadAllReadOnlyData() {
    if (localApiDown) {
      setMessage("SaxoローカルAPIが起動していません。先にローカルAPIを起動してください。");
      return;
    }
    setIsLoading(true);
    const failures: string[] = [];
    try {
      try {
        await refreshStatus();
      } catch (error) {
        failures.push(`接続確認: ${error instanceof Error ? error.message : "失敗"}`);
      }
      try {
        const snapshotResponse = await fetchSaxoAccountsSnapshot();
        setSnapshots(snapshotResponse.accounts);
      } catch (error) {
        failures.push(`残高・証拠金: ${error instanceof Error ? error.message : "失敗"}`);
      }
      try {
        const positionsResponse = await fetchSaxoPositionsSnapshot();
        setPositions(positionsResponse.positions);
        setPositionsFetchedAt(positionsResponse.fetchedAt);
      } catch (error) {
        failures.push(`建玉: ${error instanceof Error ? error.message : "失敗"}`);
      }
      try {
        const ordersResponse = await fetchSaxoOrdersSnapshot();
        setOrders(ordersResponse.orders);
        setOrdersFetchedAt(ordersResponse.fetchedAt);
      } catch (error) {
        failures.push(`注文: ${error instanceof Error ? error.message : "失敗"}`);
      }
      try {
        const historyResponse = await fetchSaxoHistoryDiscovery();
        const mappedEndpoints = enrichHistoryEndpointsWithAccountMappings(historyResponse.endpoints, mappings);
        setHistoryEndpoints(mappedEndpoints);
        setHistoryFetchedAt(historyResponse.fetchedAt);
        onHistoryCandidatesChange?.(mappedEndpoints.flatMap((endpoint) => endpoint.items ?? []));
      } catch (error) {
        failures.push(`履歴候補: ${error instanceof Error ? error.message : "失敗"}`);
      }
      await refreshStatus();
      setMessage(
        failures.length > 0
          ? `まとめて取得は一部失敗しました。${failures.join(" / ")}。成功した取得値は保持しています。`
          : "まとめて取得が完了しました。反映待ちサマリーを確認してください。",
      );
      window.setTimeout(() => pendingSummaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } finally {
      setIsLoading(false);
    }
  }

  function scrollToSection(section: "mapping" | "snapshot" | "positions" | "orders" | "history" | "pending") {
    const target =
      section === "mapping"
        ? mappingRef.current
        : section === "snapshot"
          ? snapshotRef.current
          : section === "positions"
            ? positionsRef.current
            : section === "orders"
              ? ordersRef.current
              : section === "history"
        ? historyRef.current
        : pendingSummaryRef.current;
    if (section === "mapping") setShowPnSettings(true);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function goToEditorAnchor(anchorId: "option-entry-executions" | "option-close-executions" | "stock-acquisition-record", sourceTradeId?: string) {
    setIsOpen(false);
    if (onOpenHistoryTarget) {
      onOpenHistoryTarget(anchorId, sourceTradeId);
      setMessage(
        anchorId === "option-entry-executions"
          ? "建玉開始確認へ移動しました。反映候補の内容を確認してください。"
          : anchorId === "stock-acquisition-record"
            ? "6-A. 現物株の取得記録へ移動しました。P売り権利行使による株式取得を確認してください。"
            : "決済実績へ移動しました。反映候補の内容を確認してください。",
      );
      return;
    }
    const target = typeof document !== "undefined" ? document.getElementById(anchorId) : null;
    if (target) {
      window.setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      setMessage(anchorId === "option-entry-executions" ? "建玉開始確認へ移動しました。反映候補の内容を確認してください。" : "決済実績へ移動しました。反映候補の内容を確認してください。");
      return;
    }
    setMessage(
      anchorId === "option-entry-executions"
        ? "建玉入力カードを開いてから、3-A. 建玉開始の約定確認で反映候補を確認してください。"
        : anchorId === "stock-acquisition-record"
          ? "建玉入力カードを開いてから、6-A. 現物株の取得記録で権利行使候補を確認してください。"
          : "建玉入力カードを開いてから、7. 決済実績で反映候補を確認してください。",
    );
  }

  function showPositionCandidatesFromSummary() {
    const targetRow = positionRows.find(
      (row) =>
        row.position &&
        (row.status === "app_missing" ||
          row.status === "matched" ||
          row.status === "quantity_diff" ||
          row.status === "price_diff" ||
          row.status === "unknown"),
    );
    if (targetRow?.position) {
      setExpandedPositionId(targetRow.position.id);
      setHighlightedPositionId(targetRow.position.id);
      setMessage("建玉候補を表示しました。候補カードの詳細と主要操作を確認してから、下書き反映または既存建玉への紐づけを選んでください。");
      window.setTimeout(() => setHighlightedPositionId(""), 4500);
    }
    scrollToSection("positions");
  }

  async function disconnect() {
    try {
      const nextStatus = await logoutSaxo();
      setStatus(nextStatus);
      setMessage(nextStatus.message ?? "Saxo接続を解除しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Saxo接続解除に失敗しました。");
    }
  }

  async function enablePersistence() {
    setIsLoading(true);
    try {
      const nextStatus = await enableSaxoPersistence();
      setStatus(nextStatus);
      setShowPreparationDetails(false);
      setDismissedPersistencePrompt(false);
      setMessage(nextStatus.message ?? "このPCに接続保持を保存しました");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "接続保持を有効化できませんでした。");
      await refreshStatus();
    } finally {
      setIsLoading(false);
    }
  }

  async function disablePersistence() {
    setIsLoading(true);
    try {
      const nextStatus = await disableSaxoPersistence();
      setStatus(nextStatus);
      setMessage(nextStatus.message ?? "接続保持を解除しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "接続保持を解除できませんでした。");
      await refreshStatus();
    } finally {
      setIsLoading(false);
    }
  }

  function updateMapping(account: SaxoApiAccount, mappedCode: SaxoMappedCode) {
    setMappings((current) => {
      const withoutCurrentAccount = current.filter((item) => !(item.workspace === mappingWorkspace && item.accountKey === account.accountKey));
      const withoutDuplicateCode =
        mappedCode === "P" || mappedCode === "N"
          ? withoutCurrentAccount.filter((item) => !(item.workspace === mappingWorkspace && item.mappedCode === mappedCode))
          : withoutCurrentAccount;
      return [
        ...withoutDuplicateCode,
        {
          workspace: mappingWorkspace,
          accountKey: account.accountKey,
          accountId: account.accountId,
          displayName: account.displayName,
          currency: account.currency ?? "JPY",
          mappedCode,
          environment: account.environment,
          isTrialAccount: account.isTrialAccount,
          confirmedByUser: mappedCode === "P" || mappedCode === "N" || mappedCode === "ignore",
          confirmedAt: new Date().toISOString(),
        },
      ];
    });
  }

  function applySnapshot(accountCode: SaxoAccountCode, snapshot: SaxoApiAccountSnapshot) {
    const currentAccount = accountInputs[accountCode];
    const patch = createAccountPatchFromSaxoSnapshot(snapshot);
    const appliedFields = Object.entries(snapshot.values)
      .filter(([, value]) => value !== undefined && Number.isFinite(value))
      .map(([field]) => field);
    onApplyAccountState(accountCode, {
      ...patch,
      saxoSyncHistory: [
        ...(currentAccount.saxoSyncHistory ?? []),
        {
          id: `saxo-sync-${snapshot.accountKey}-${Date.now()}`,
          source: "saxo_api",
          accountKey: snapshot.accountKey,
          accountId: snapshot.accountId,
          displayName: snapshot.displayName,
          fetchedAt: snapshot.fetchedAt,
          appliedAt: new Date().toISOString(),
          appliedFields,
        },
      ],
    });
    setMessage(`${accountCode}口座へSaxo取得値を反映しました。`);
  }

  const connectionState: SaxoPanelConnectionState = localApiDown ? "local_api_down" : (status?.connectionState ?? (status?.connected ? "connected" : "disconnected"));
  const statusLabel =
    connectionState === "local_api_down"
        ? formatLocalApiHeaderStatus(localApiReachability)
      : connectionState === "connected"
      ? `Saxo接続中 ${status?.environment.toUpperCase() ?? "SIM"} / 発注機能なし`
      : connectionState === "reconnect_required"
        ? `Saxo再接続が必要 ${status?.environment.toUpperCase() ?? "SIM"} / 発注機能なし`
        : "Saxo未接続 / 発注機能なし";
  const isLive = connectionState === "connected" && status?.environment === "live";
  const setupGuidance = createSaxoSetupGuidance(status, apiErrorMessage);
  const hasSetupProblem = Boolean(
    !status?.clientIdConfigured ||
      status.environmentConfigured === false ||
      status?.redirectUri !== status?.expectedRedirectUri ||
      !configStatus?.clientIdConfigured ||
      configStatus?.environmentConfigured === false,
  );
  const showSetupSection = Boolean(status && connectionState === "disconnected" && hasSetupProblem);
  const isConnected = connectionState === "connected";
  const persistenceEnabled = isConnected && status?.tokenPersistence?.enabled === true;
  const canPersistConnection =
    isConnected &&
    status?.tokenPersistence?.supported !== false &&
    status?.tokenPersistence?.enabled !== true;
  const showPersistencePrompt = canPersistConnection && !dismissedPersistencePrompt;
  const showPreparationCard = Boolean(
    localApiDown ||
      connectionState === "disconnected" ||
      showSetupSection ||
      showPreparationDetails,
  );

  return (
    <section className={`rounded-lg border bg-white shadow-sm ${isLive ? "border-red-300" : "border-slate-200"}`}>
      <button
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setIsOpen((value) => !value)}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <Cable size={18} className={connectionState === "connected" ? "text-emerald-700" : connectionState === "reconnect_required" ? "text-amber-700" : "text-slate-500"} />
          <span className="font-bold text-slate-950">Saxo API Read-only版</span>
          <span
            className={`rounded px-2 py-0.5 text-xs font-bold ${
              connectionState === "local_api_down"
                ? "bg-red-100 text-red-800"
                : connectionState === "connected"
                ? isLive
                  ? "bg-red-100 text-red-800"
                  : "bg-emerald-100 text-emerald-800"
                : connectionState === "reconnect_required"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-slate-100 text-slate-700"
            }`}
          >
            {statusLabel}
          </span>
          <span className="inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">
            <ShieldCheck size={13} />
            Read-only
          </span>
          {connectionState === "local_api_down" ? (
            <span
              role="button"
              tabIndex={0}
              className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-900"
              onClick={(event) => {
                event.stopPropagation();
                setIsOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                setIsOpen(true);
              }}
            >
              起動手順
            </span>
          ) : null}
        </span>
        <span className="text-sm font-semibold text-slate-600">{isOpen ? "閉じる" : "接続・同期"}</span>
      </button>

      {isOpen ? (
        <div className="border-t border-slate-200 p-4">
          <div className="grid gap-3">
            <SaxoDailySummary
              statusLabel={statusLabel}
              connectionState={connectionState}
              environment={formatSaxoEnvironmentStatus(status)}
              status={status}
              pMapping={mappedSnapshots.find((item) => item.accountCode === "P")?.mapping}
              nMapping={mappedSnapshots.find((item) => item.accountCode === "N")?.mapping}
              workspace={workspace}
              lastSyncedAt={status?.lastSyncedAt}
              onOpenDiagnostics={() => setShowConnectionDetails((value) => !value)}
            />
            {showPersistencePrompt ? (
              <SaxoPersistencePromptCard
                isLoading={isLoading}
                onEnablePersistence={enablePersistence}
                onDismiss={() => setDismissedPersistencePrompt(true)}
              />
            ) : null}
            {persistenceEnabled && !showPreparationCard ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  onClick={() => setShowPreparationDetails(true)}
                >
                  準備手順を再表示
                </button>
              </div>
            ) : null}
            {showPreparationCard ? (
              <SaxoApiOnboardingSection
                checks={onboardingChecks}
                localApiOs={localApiOs}
                localApiSetupChecks={localApiSetupChecks}
                canCollapse={isConnected}
                onCollapse={() => setShowPreparationDetails(false)}
                onToggle={toggleOnboardingCheck}
                onOsChange={setLocalApiOs}
                onToggleLocalApiSetup={toggleLocalApiSetupCheck}
                onCopyConsultationPrompt={copyFriendConsultationPrompt}
              />
            ) : null}
            {localApiDown ? (
              <LocalApiDownCard
                isLoading={isLoading}
                reachability={localApiReachability}
                os={localApiOs}
                setupChecks={localApiSetupChecks}
                commandCopied={startCommandCopied}
                diagnosticsOpen={showConnectionDetails}
                onRefreshStatus={refreshLocalApiStartupStatus}
                onCopyCommand={copyLocalApiStartCommand}
                onToggleDiagnostics={() => setShowConnectionDetails((value) => !value)}
                onShowSetup={() => {
                  setMessage("導入手順を確認してください。Node.js LTS、ローカルAPI補助ツール、.env.local の順に準備します。");
                }}
              />
            ) : connectionState !== "connected" ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-amber-900">
                    SaxoローカルAPIは起動しています。Saxo公式ログインでLIVE接続してください。
                  </p>
                  <button className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-40" onClick={beginSaxoAuth} disabled={isLoading}>
                    <Cable size={15} />
                    {connectionState === "reconnect_required" ? "Saxo再接続" : "Saxo接続"}
                  </button>
                </div>
              </div>
            ) : null}
            {showConnectionDetails ? (
              <SaxoDiagnostics
                status={status}
                configStatus={configStatus}
                setupGuidance={setupGuidance}
                showSetupSection={showSetupSection}
                setupClientId={setupClientId}
                setupEnvironment={setupEnvironment}
                isSavingConfig={isSavingConfig}
                isLoading={isLoading}
                connectionState={connectionState}
                onClientIdChange={setSetupClientId}
                onEnvironmentChange={setSetupEnvironment}
                onCopyRedirectUri={copyRedirectUri}
                onSaveConfig={saveLocalConfig}
                onRefreshStatus={refreshStatus}
                onEnablePersistence={enablePersistence}
                onDisablePersistence={disablePersistence}
                onDisconnect={disconnect}
                localApiOnlyCommand={getSaxoLocalApiOnlyCommand(localApiOs)}
              />
            ) : null}
            {!showConnectionDetails && showSetupSection ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                接続設定の確認が必要です。詳細は「設定・診断を開く」内で確認してください。
              </div>
            ) : null}
            {isConnected ? (
              <SaxoMainActions
                isLoading={isLoading}
                localApiDown={localApiDown}
                onLoadAll={loadAllReadOnlyData}
                onShowPending={() => scrollToSection("pending")}
                onShowMapping={() => scrollToSection("mapping")}
                showIndividualFetch={showIndividualFetch}
                onToggleIndividualFetch={() => setShowIndividualFetch((value) => !value)}
                onLoadSnapshots={loadSnapshots}
                onLoadPositions={loadPositions}
                onLoadOrders={loadOrders}
                onLoadHistory={loadHistoryDiscovery}
              />
            ) : null}
            {message ? <p className="rounded-md bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">{message}</p> : null}
            {isConnected ? (
              <>
              <ReflectionPendingSummary
                ref={pendingSummaryRef}
                summary={reflectionSummary}
                onShowMapping={() => scrollToSection("mapping")}
                onShowSnapshot={() => scrollToSection("snapshot")}
                onShowPositions={showPositionCandidatesFromSummary}
                onShowOrders={() => scrollToSection("orders")}
                onShowHistory={() => scrollToSection("history")}
              />
              <div className="rounded-md border border-slate-200 p-3">
                <div ref={mappingRef} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-950">Saxo口座の割り当て</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      Saxoから取得した口座を、このアプリのP口座・N口座に対応づけます。割当済みのP/N口座だけを要約表示します。
                    </p>
                  </div>
                  <button
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-40"
                    onClick={() => setShowPnSettings((value) => !value)}
                  >
                    <Eye size={15} />
                    {showPnSettings ? "Saxo口座の割り当てを閉じる" : "Saxo口座の割り当て"}
                  </button>
                </div>
                <PnMappingSummary
                  pMapping={mappedSnapshots.find((item) => item.accountCode === "P")?.mapping}
                  nMapping={mappedSnapshots.find((item) => item.accountCode === "N")?.mapping}
                  otherCount={accountDisplayGroups.secondary.length}
                  workspace={workspace}
                />
                {showPnSettings ? (
                  <div className="mt-3 grid gap-2">
                    {connectionState !== "connected" ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
                        <p className="font-semibold">
                          Saxoに未接続のため、口座一覧を取得できません。
                        </p>
                        <p className="mt-1">
                          先に「Saxo接続」を押して認証を完了してください。
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 disabled:opacity-40"
                            onClick={refreshStatus}
                            disabled={isLoading}
                          >
                            接続状態を更新
                          </button>
                          {connectionState !== "local_api_down" ? (
                            <button
                              type="button"
                              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                              onClick={beginSaxoAuth}
                              disabled={isLoading}
                            >
                              Saxo接続へ
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    <div className="flex justify-end">
                      <button
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-40"
                        onClick={loadAccounts}
                      disabled={isLoading || localApiDown || connectionState !== "connected"}
                      >
                        <RefreshCw size={15} />
                        {isLoading ? "口座一覧を取得中..." : "口座一覧を取得"}
                      </button>
                    </div>
                    {accounts.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        {connectionState === "connected" ? "口座一覧を取得してください。" : "Saxo接続後に口座一覧を取得してください。"}
                      </p>
                    ) : (
                      <>
                      {accountDisplayGroups.primary.length === 0 ? (
                        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
                          P/N候補が標準表示にありません。必要ならその他の口座を開いて割当を確認してください。
                        </p>
                      ) : (
                        accountDisplayGroups.primary.map(({ account, mappedCode }) => (
                          <AccountMappingRow
                            key={account.accountKey}
                            account={account}
                            value={mappedCode}
                            allowNAccount={workspace !== "demo"}
                            onChange={(nextMappedCode) => updateMapping(account, nextMappedCode)}
                          />
                        ))
                      )}
                      {accountDisplayGroups.secondary.length > 0 ? (
                        <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-sm font-bold text-slate-700"
                            onClick={() => setShowOtherAccounts((value) => !value)}
                          >
                            <Eye size={14} />
                            {showOtherAccounts ? "その他の口座を隠す" : `その他の口座を表示（${accountDisplayGroups.secondary.length}件）`}
                          </button>
                          {showOtherAccounts ? (
                            <div className="mt-2 grid gap-2">
                              {accountDisplayGroups.secondary.map(({ account, mappedCode }) => (
                                <AccountMappingRow
                                  key={account.accountKey}
                                  account={account}
                                  value={mappedCode}
                                  allowNAccount={workspace !== "demo"}
                                  muted
                                  onChange={(nextMappedCode) => updateMapping(account, nextMappedCode)}
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                  </div>
                ) : null}
              </div>

              <div className="rounded-md border border-slate-200 p-3">
                <div ref={snapshotRef} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-950">口座残高・証拠金 差分プレビュー</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      Saxo取得値は即時上書きしません。P口座とN口座は別々に確認し、未取得項目は0扱いしません。
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-3">
                  {mappedSnapshots.map(({ accountCode, mapping, snapshot }) => (
                    <SnapshotPreview
                      key={accountCode}
                      accountCode={accountCode}
                      workspace={workspace}
                      account={accountInputs[accountCode]}
                      mapping={mapping}
                      snapshot={snapshot}
                      onApply={applySnapshot}
                    />
                  ))}
                </div>
              </div>

              <div ref={positionsRef} />
              <PositionsPreview
                rows={positionsFetchedAt ? positionRows : []}
                positions={mappedPositions}
                fetchedAt={positionsFetchedAt}
                isLoading={isLoading}
                expandedPositionId={expandedPositionId}
                highlightedPositionId={highlightedPositionId}
                draftPosition={draftPosition}
                draftedPositionIds={draftedPositionIds}
                simulations={simulations}
                stockTransfers={stockTransfers}
                historyItems={historyEndpoints.flatMap((endpoint) => endpoint.items ?? [])}
                resolveLinkedSimulation={resolveLinkedSimulation}
                positionActionErrors={positionActionErrors}
                positionActionNotices={positionActionNotices}
                onLoad={loadPositions}
                onToggleDetails={(id) => setExpandedPositionId((current) => (current === id ? "" : id))}
                onIgnore={(position) => {
                  setIgnoredPositionIds((current) => (current.includes(position.id) ? current : [...current, position.id]));
                  setPositionActionErrors((current) => {
                    const next = { ...current };
                    delete next[position.id];
                    return next;
                  });
                  setPositionActionNotices((current) => {
                    const next = { ...current };
                    delete next[position.id];
                    return next;
                  });
                  setMessage("このSaxo建玉を今回は無視にしました。正式建玉や口座残高は変更していません。");
                }}
                onLink={(row) => {
                  if (row.position) {
                    setExpandedPositionId(row.position.id);
                    setPositionActionErrors((current) => {
                      const next = { ...current };
                      delete next[row.position!.id];
                      return next;
                    });
                    if (!row.simulation) {
                      setPositionActionErrors((current) => ({
                        ...current,
                        [row.position!.id]: "紐づけ候補の既存建玉がありません。新規下書きとして作成して3-Aへ進むか、今回は無視してください。",
                      }));
                    }
                    window.setTimeout(() => positionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                  }
                  setMessage(
                    row.simulation
                      ? "既存建玉候補を表示しました。差分を確認して、既存建玉に反映するか判断してください。自動保存はしていません。"
                      : "紐づける既存建玉がありません。必要なら建玉入力へ下書き反映で確認してください。",
                  );
                }}
                onLinkExisting={(row) => {
                  if (!row.position || !row.simulation) {
                    setMessage("既存建玉に紐づける候補がありません。新規下書きとして扱うか、今回は無視してください。");
                    return;
                  }
                  setLinkedPositionIds((current) => (current.includes(row.position!.id) ? current : [...current, row.position!.id]));
                  setLinkedPositionTargets((current) => ({ ...current, [row.position!.id]: row.simulation!.id }));
                  setPositionActionErrors((current) => {
                    const next = { ...current };
                    delete next[row.position!.id];
                    return next;
                  });
                  setMessage(`${row.simulation.name} にSaxo建玉候補を紐づけ済みにしました。既存建玉の手入力項目は自動上書きしていません。`);
                }}
                onRepairLink={(row) => {
                  if (!row.position) return;
                  if (!row.simulation) {
                    setExpandedPositionId(row.position.id);
                    setPositionActionErrors((current) => ({
                      ...current,
                      [row.position!.id]: "紐づけ候補の既存建玉がありません。新規下書きとして作成して3-Aへ進むか、今回は無視してください。",
                    }));
                    setMessage("紐づけ先の候補が見つかりません。既存建玉候補を確認してください。");
                    window.setTimeout(() => positionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                    return;
                  }
                  setLinkedPositionIds((current) => (current.includes(row.position!.id) ? current : [...current, row.position!.id]));
                  setLinkedPositionTargets((current) => ({ ...current, [row.position!.id]: row.simulation!.id }));
                  setPositionActionErrors((current) => {
                    const next = { ...current };
                    delete next[row.position!.id];
                    return next;
                  });
                  setMessage(`${row.simulation.name} へ紐づけを修復しました。3-A約定確認へ進めます。`);
                }}
                onOpenLinked={(row, anchorId) => {
                  const resolved = resolveLinkedSimulation(row);
                  if (resolved.status !== "linked") {
                    if (row.position) {
                      setPositionActionErrors((current) => ({
                        ...current,
                        [row.position!.id]: "紐づけ先が見つかりません。既存建玉を選び直してください。",
                      }));
                      setExpandedPositionId(row.position.id);
                    }
                    setMessage("紐づけ済みの既存建玉が見つかりません。候補行で既存建玉を選び直してください。");
                    return;
                  }
                  setPositionActionErrors((current) => {
                    if (!row.position) return current;
                    const next = { ...current };
                    delete next[row.position.id];
                    return next;
                  });
                  onOpenLinkedSimulation?.(resolved.simulation.id, anchorId);
                  if (anchorId === "option-entry-executions") {
                    const needsEntryConfirmation = needsOptionEntryConfirmation(resolved.simulation);
                    setMessage(
                      needsEntryConfirmation
                        ? "このSaxo建玉は既存建玉と一致しています。約定確認を完了してください。"
                        : "このSaxo建玉は既存建玉と一致しており、建玉開始の約定確認も完了しています。確認済みの3-Aを開きました。",
                    );
                  } else {
                    setMessage("紐づけ済み建玉を開きました。既存建玉の入力画面で内容を確認してください。");
                  }
                }}
                onCreateDraft={(position) => {
                  if (draftedPositionIds.includes(position.id)) {
                    setMessage("このSaxo建玉候補はすでに下書き反映済みです。二重反映はできません。");
                    return;
                  }
                  if (linkedPositionIds.includes(position.id)) {
                    setMessage("このSaxo建玉候補は既存建玉へ紐づけ済みです。新規下書きを作る前に既存建玉側の差分を確認してください。");
                    return;
                  }
                  setDraftPosition(position);
                  setDraftedPositionIds((current) => (current.includes(position.id) ? current : [...current, position.id]));
                  const draftMessage = getPositionDraftCreatedMessage(position, simulations);
                  setPositionActionNotices((current) => ({
                    ...current,
                    [position.id]: draftMessage,
                  }));
                  onCreatePositionDraft?.(position, historyEndpoints.flatMap((endpoint) => endpoint.items ?? []));
                  setMessage(
                    onCreatePositionDraft
                      ? draftMessage
                      : "Saxo建玉から取込下書きを作成しました。正式な建玉保存はまだ行っていません。",
                  );
                }}
                onCreateDraftFromBroken={(position) => {
                  const missingItems = getMissingPositionDraftRequirements(position);
                  if (missingItems.length > 0) {
                    const message = `新規下書きを作成できませんでした。必須項目が不足しています。${missingItems.join("、")}を確認してください。`;
                    setPositionActionErrors((current) => ({ ...current, [position.id]: message }));
                    setMessage(message);
                    return;
                  }
                  if (draftedPositionIds.includes(position.id)) {
                    const message = "このSaxo建玉候補はすでに下書き反映済みです。建玉入力の3-Aで約定確認を確認してください。";
                    setPositionActionNotices((current) => ({ ...current, [position.id]: message }));
                    setPositionActionErrors((current) => {
                      const next = { ...current };
                      delete next[position.id];
                      return next;
                    });
                    setMessage(message);
                    return;
                  }
                  setLinkedPositionIds((current) => current.filter((id) => id !== position.id));
                  setLinkedPositionTargets((current) => {
                    const next = { ...current };
                    delete next[position.id];
                    return next;
                  });
                  setPositionActionErrors((current) => {
                    const next = { ...current };
                    delete next[position.id];
                    return next;
                  });
                  setDraftPosition(position);
                  setDraftedPositionIds((current) => (current.includes(position.id) ? current : [...current, position.id]));
                  const draftMessage = getPositionDraftCreatedMessage(position, simulations);
                  setPositionActionNotices((current) => ({
                    ...current,
                    [position.id]: draftMessage,
                  }));
                  onCreatePositionDraft?.(position, historyEndpoints.flatMap((endpoint) => endpoint.items ?? []));
                  setMessage(`壊れた紐づけを解除しました。${draftMessage}`);
                }}
                onDiscardDraft={(position) => {
                  setDraftPosition((current) => (current?.id === position.id ? null : current));
                  setDraftedPositionIds((current) => current.filter((id) => id !== position.id));
                  setMessage("Saxo建玉候補の下書き表示を破棄しました。正式建玉や口座残高は変更していません。");
                }}
                onCreateStockTransfer={(position, sourceSimulationId) => {
                  if (!onCreateStockTransferFromPosition) {
                    setMessage("P→N株式移管の記録処理が未接続です。手入力で移管記録を確認してください。");
                    return false;
                  }
                  const result = onCreateStockTransferFromPosition(position, sourceSimulationId);
                  if (result === false) return false;
                  setPositionActionNotices((current) => ({
                    ...current,
                    [position.id]: "P→N株式移管を記録しました。次は「N口座ホイールを確認」で、N株式保有になっていることを確認してください。確認後、JSONバックアップを保存してください。",
                  }));
                  return true;
                }}
                onOpenWheelManagement={onOpenWheelManagement}
                onDownloadJson={onDownloadJson}
                onOpenSimulationAt={(simulationId, anchorId) => {
                  onOpenLinkedSimulation?.(simulationId, anchorId);
                  setMessage("対応するP口座の権利行使済み建玉を開きました。");
                }}
              />
              <div ref={ordersRef} />
              <OrdersPreview
                orders={mappedOrders}
                fetchedAt={ordersFetchedAt}
                isLoading={isLoading}
                expandedOrderId={expandedOrderId}
                onLoad={loadOrders}
                onToggleDetails={(id) => setExpandedOrderId((current) => (current === id ? "" : id))}
              />
              <div ref={historyRef} />
              <HistoryDiscoveryPreview
                endpoints={historyEndpoints}
                fetchedAt={historyFetchedAt}
                isLoading={isLoading}
                historyDraft={historyDraft}
                reflectionStates={historyReflectionStates}
                actionMessages={historyActionMessages}
                onLoad={loadHistoryDiscovery}
                onGoEntry={() => goToEditorAnchor("option-entry-executions")}
                onGoClose={(sourceTradeId) => goToEditorAnchor("option-close-executions", sourceTradeId)}
                onGoAssignment={(sourceTradeId) => goToEditorAnchor("stock-acquisition-record", sourceTradeId)}
                onClosePanel={() => setIsOpen(false)}
                onIgnoreHistoryCandidate={ignoreHistoryCandidate}
                onUnignoreHistoryCandidate={unignoreHistoryCandidate}
                onCreateDraftAndOpen={(item) => createHistoryDraft(item, true)}
                onCreateDrafts={createHistoryDrafts}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800"
                  onClick={() => setIsOpen(false)}
                >
                  閉じる
                </button>
              </div>
              </>
            ) : null}
          </div>
          {workspace === "demo" ? (
            <p className="mt-3 text-xs leading-5 text-slate-500">
              DEMOワークスペースはJPYベース検証用です。Saxo APIのsim接続値を本番N口座の検証済みUSD台帳として扱わないでください。
            </p>
          ) : status?.environment === "sim" ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold leading-5 text-red-800">
              現在のSaxo接続はSIM環境です。REALワークスペースの口座残高・証拠金へは反映できません。実口座を反映する場合はLIVE環境で接続してください。
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-950">{value}</dd>
    </div>
  );
}

function SaxoApiOnboardingSection({
  checks,
  localApiOs,
  localApiSetupChecks,
  canCollapse = false,
  onCollapse,
  onToggle,
  onOsChange,
  onToggleLocalApiSetup,
  onCopyConsultationPrompt,
}: {
  checks: Record<SaxoOnboardingStepId, boolean>;
  localApiOs: SaxoLocalApiOs;
  localApiSetupChecks: Record<SaxoLocalApiSetupStepId, boolean>;
  canCollapse?: boolean;
  onCollapse?: () => void;
  onToggle: (id: SaxoOnboardingStepId, checked: boolean) => void;
  onOsChange: (os: SaxoLocalApiOs) => void;
  onToggleLocalApiSetup: (id: SaxoLocalApiSetupStepId, checked: boolean) => void;
  onCopyConsultationPrompt: () => void;
}) {
  const completed = SAXO_ONBOARDING_STEPS.filter((step) => checks[step.id]).length;
  const setupReady = isLocalApiReadyToStart(localApiSetupChecks);
  const setupCompleted = SAXO_LOCAL_API_SETUP_STEPS.filter((step) => localApiSetupChecks[step.id]).length;

  return (
    <section className="rounded-md border border-sky-200 bg-sky-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-sky-950">Saxo API接続準備</h3>
          <p className="mt-1 text-sm leading-6 text-sky-900">
            アプリ本体はGitHub Pagesの公開版を使います。Saxo API接続を使う場合だけ、PCにローカルAPI補助ツールを準備します。
            この補助ツールはSaxoとの通信だけを担当します。
          </p>
        </div>
        <span className="rounded bg-white px-2 py-1 text-xs font-bold text-sky-800">
          GitHub Pages公開版
        </span>
        {canCollapse ? (
          <button
            type="button"
            className="rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-bold text-sky-900 hover:bg-sky-100"
            onClick={onCollapse}
          >
            準備手順を閉じる
          </button>
        ) : null}
      </div>
      <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded-md border border-sky-200 bg-white p-3">
          <div className="font-bold text-slate-950">公開版と補助ツールの役割</div>
          <p className="mt-1 leading-6 text-slate-700">
            アプリ本体は、今まで通りGitHub Pagesの公開版を使います。Saxo API接続を使う場合だけ、Saxoとの通信を担当する補助ツールをあなたのPC上で起動します。
          </p>
        </div>
        <div className="rounded-md border border-sky-200 bg-white p-3">
          <div className="font-bold text-slate-950">なぜ必要か</div>
          <p className="mt-1 leading-6 text-slate-700">
            GitHub Pagesは静的Webアプリのため、SaxoのOAuth tokenを安全に保存したり、macOS Keychain/Windows側の保存領域を使ったり、Saxo APIの中継サーバになることはできません。
          </p>
        </div>
        <div className="rounded-md border border-sky-200 bg-white p-3">
          <div className="font-bold text-slate-950">セキュリティ上の意味</div>
          <p className="mt-1 leading-6 text-slate-700">
            この仕組みにより、Saxo ID、パスワード、2FA、OAuth token、口座情報はGitHub Pagesや作者側には保存されません。
          </p>
        </div>
      </div>
      <div className="mt-3 rounded-md border border-sky-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-950">Saxo接続用のPC側補助ツールを準備</h4>
            <p className="mt-1 text-xs leading-5 text-slate-700">
              初回は、Node.js LTS、ローカルAPI補助ツール、`.env.local` の準備が必要です。準備が終わるまでは起動コマンドを実行しても成功しません。
              アプリ本体の更新はGitHub Pages側で反映され、補助ツールはSaxo API接続に必要な通信だけを担当します。
            </p>
          </div>
          <span className={`rounded px-2 py-1 text-xs font-bold ${setupReady ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
            {setupCompleted}/{SAXO_LOCAL_API_SETUP_STEPS.length} 完了
          </span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {[
            { id: "mac" as const, label: "Mac" },
            { id: "windows" as const, label: "Windows" },
            { id: "unknown" as const, label: "まだ分からない" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rounded-md border px-3 py-2 text-sm font-bold ${
                localApiOs === item.id
                  ? "border-sky-500 bg-sky-100 text-sky-950"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => onOsChange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {SAXO_LOCAL_API_SETUP_STEPS.map((step) => (
            <label
              key={step.id}
              className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-100"
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-sky-700"
                checked={Boolean(localApiSetupChecks[step.id])}
                onChange={(event) => onToggleLocalApiSetup(step.id, event.target.checked)}
              />
              <span>{step.label}</span>
            </label>
          ))}
        </div>
        {!setupReady ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
            <div className="font-bold">導入手順</div>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>Node.js LTSをインストールします。</li>
              <li>ローカルAPI補助ツールをPCに準備します。</li>
              <li>{localApiOs === "windows" ? "PowerShellでローカルAPI補助ツールのフォルダを開きます。" : "ターミナルでローカルAPI補助ツールのフォルダを開きます。"}</li>
              <li>Saxo Developer PortalのLIVE AppKeyを使い、ローカルAPI補助ツール内に `.env.local` を作ります。</li>
              <li>準備チェックを埋めてから、OS別の起動コマンドを実行します。</li>
            </ol>
          </div>
        ) : (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold leading-5 text-emerald-900">
            起動準備は完了扱いです。下のSaxoローカルAPIカードでOS別の起動コマンドをコピーできます。
          </div>
        )}
        <p className="mt-3 text-xs font-semibold text-sky-800">
          Redirect URI: <code className="rounded bg-sky-50 px-1 py-0.5">http://127.0.0.1:18787/api/saxo/auth/callback</code>
        </p>
        <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700">
          <div className="font-bold text-slate-900">.env.local について</div>
          <p className="mt-1">
            `.env.local` はGitHub Pagesには保存されず、GitHubへpushしません。ローカルAPI補助ツール側で `.gitignore` 対象です。
            初回ユーザーは、自分のLIVE AppKey（Client ID）をこのPC内の `.env.local` に設定します。Client Secret、Saxo ID、パスワード、2FAコードの入力欄はありません。
          </p>
        </div>
      </div>
      <div className="mt-3 rounded-md border border-red-200 bg-white px-3 py-2 text-xs leading-5 text-red-800">
        <div className="font-bold">セキュリティ注意</div>
        <ul className="mt-1 list-disc pl-5">
          <li>Saxo ID、パスワード、2FAコードはこのアプリに保存しません。</li>
          <li>OAuth tokenはGitHubやChatGPT/Codexに貼らないでください。</li>
          <li>Client Secretはこのアプリでは使いません。入力欄も作りません。</li>
          <li>ローカル設定へ入れるのはLIVE AppKey（Client ID）だけです。</li>
        </ul>
      </div>
      <div className="mt-3 rounded-md border border-sky-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-slate-950">Developer Portal側の準備</h4>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              PC側補助ツールを起動する前後で、LIVE AppKeyとRedirect URIを確認します。
            </p>
          </div>
          <span className="rounded bg-sky-50 px-2 py-1 text-xs font-bold text-sky-800">
            {completed}/{SAXO_ONBOARDING_STEPS.length} 完了
          </span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {SAXO_ONBOARDING_STEPS.map((step) => (
            <label
              key={step.id}
              className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-100"
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-sky-700"
                checked={Boolean(checks[step.id])}
                onChange={(event) => onToggle(step.id, event.target.checked)}
              />
              <span>{step.label}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-white px-3 py-2 text-sm font-bold text-sky-900 hover:bg-sky-100"
          onClick={onCopyConsultationPrompt}
        >
          <Clipboard size={15} />
          ChatGPT/Codexに渡す相談文をコピー
        </button>
        <span className="text-xs leading-5 text-sky-800">
          相談文には秘密情報を含めていません。画面操作の伴走だけ依頼する内容です。
        </span>
      </div>
    </section>
  );
}

function SaxoDailySummary({
  statusLabel,
  connectionState,
  environment,
  status,
  pMapping,
  nMapping,
  workspace,
  lastSyncedAt,
  onOpenDiagnostics,
}: {
  statusLabel: string;
  connectionState: SaxoPanelConnectionState;
  environment: string;
  status: SaxoApiStatus | null;
  pMapping?: SaxoAccountMapping;
  nMapping?: SaxoAccountMapping;
  workspace: WorkspaceMode;
  lastSyncedAt?: string;
  onOpenDiagnostics: () => void;
}) {
  const persistence = status?.tokenPersistence;
  const persistenceEnabled = connectionState === "connected" && persistence?.enabled === true;
  const tone =
    connectionState === "local_api_down"
      ? "border-red-200 bg-red-50 text-red-900"
      : connectionState === "connected"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : connectionState === "reconnect_required"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-slate-200 bg-slate-50 text-slate-800";
  return (
    <div className={`rounded-md border px-3 py-2 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
        <span>{statusLabel.replace("Saxo", "").replace(" / 発注機能なし", "")}</span>
        <span className="rounded bg-white px-2 py-0.5 text-slate-900">Read-only / 発注機能なし</span>
        <span>{environment}</span>
        <span>P口座 JPY: {pMapping ? "割当済み" : "未割当"}</span>
        {workspace !== "demo" ? <span>N口座 USD: {nMapping ? "割当済み" : "未割当"}</span> : null}
        <span>最終取得: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString("ja-JP") : "未取得"}</span>
        <button type="button" className="ml-auto rounded border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-800" onClick={onOpenDiagnostics}>
          設定・診断を開く
        </button>
      </div>
      {persistenceEnabled ? (
        <div className="mt-2 rounded-md border border-emerald-200 bg-white/80 px-3 py-2 text-xs font-bold text-emerald-950">
          接続保持: 有効 / 保存先: {persistence?.storage ?? "macOS Keychain"}
        </div>
      ) : null}
    </div>
  );
}

function SaxoPersistencePromptCard({
  isLoading,
  onEnablePersistence,
  onDismiss,
}: {
  isLoading: boolean;
  onEnablePersistence: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-emerald-950">
            次回以降の再ログインを減らすため、接続保持を保存してください
          </h3>
          <p className="mt-1 text-sm leading-6 text-emerald-900">
            保存するのはOAuth接続保持情報だけです。Saxo ID、パスワード、2FAコード、口座情報は保存しません。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            onClick={onEnablePersistence}
            disabled={isLoading}
          >
            <Save size={15} />
            このPCに接続保持を保存
          </button>
          <button
            type="button"
            className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-bold text-emerald-900 hover:bg-emerald-100"
            onClick={onDismiss}
          >
            今は保存しない
          </button>
        </div>
      </div>
    </div>
  );
}

function isPublicGithubPagesRuntime(): boolean {
  return typeof window !== "undefined" && window.location.origin === SAXO_PUBLIC_UI_ALLOWED_ORIGIN;
}

function getSaxoLocalApiStartCommand(os: SaxoLocalApiOs): string {
  if (os === "windows") {
    return `$env:SAXO_LOCAL_UI_ALLOWED_ORIGIN="${SAXO_PUBLIC_UI_ALLOWED_ORIGIN}"; $env:SAXO_LOCAL_UI_RETURN_URL="${SAXO_PUBLIC_UI_RETURN_URL}"; npm run dev:saxo-api`;
  }
  if (os === "mac") {
    return `SAXO_LOCAL_UI_ALLOWED_ORIGIN=${SAXO_PUBLIC_UI_ALLOWED_ORIGIN} SAXO_LOCAL_UI_RETURN_URL=${SAXO_PUBLIC_UI_RETURN_URL} npm run dev:saxo-api`;
  }
  return "Mac または Windows を選択してください。";
}

function getSaxoLocalApiOnlyCommand(os: SaxoLocalApiOs): string {
  if (os === "windows") {
    return [
      `$env:SAXO_LOCAL_UI_ALLOWED_ORIGIN="${SAXO_PUBLIC_UI_ALLOWED_ORIGIN}"`,
      `$env:SAXO_LOCAL_UI_RETURN_URL="${SAXO_PUBLIC_UI_RETURN_URL}"`,
      "npm run dev:saxo-api",
    ].join("\n");
  }
  if (os === "mac") {
    return [
      `SAXO_LOCAL_UI_ALLOWED_ORIGIN=${SAXO_PUBLIC_UI_ALLOWED_ORIGIN} \\`,
      `SAXO_LOCAL_UI_RETURN_URL=${SAXO_PUBLIC_UI_RETURN_URL} \\`,
      "npm run dev:saxo-api",
    ].join("\n");
  }
  return "Mac または Windows を選択してください。";
}

function isLocalApiReadyToStart(checks: Record<SaxoLocalApiSetupStepId, boolean>): boolean {
  return Boolean(checks.repository && checks.node && checks.env_local);
}

function classifyLocalApiFetchFailure(error: unknown): LocalApiReachability {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Origin許可不足") || message.includes("CORS") || message.includes("Private Network Access")) {
    return isPublicGithubPagesRuntime() ? "cors_or_pna_blocked" : "down";
  }
  return "down";
}

function formatLocalApiHeaderStatus(reachability: LocalApiReachability): string {
  if (reachability === "checking") return "API確認中";
  if (reachability === "cors_or_pna_blocked") return "API接続不可: 公開版Origin/CORS設定を確認";
  return "API未起動: 起動コマンドをコピーしてターミナルで実行";
}

function createLocalApiStartupResultMessage(reachability: LocalApiReachability): string {
  if (reachability === "cors_or_pna_blocked") {
    return "公開版Origin許可不足、またはChromeのCORS/Private Network Accessブロック疑いです。公開版用の起動コマンドでローカルAPIを起動してください。";
  }
  return `まだ起動していません。ターミナル/PowerShellに成功ログ「${SAXO_LOCAL_API_SUCCESS_LOG}」が出ているか確認してください。Macで > が出て止まっている場合は Control + C でキャンセルし、1行コマンドを貼り直してください。`;
}

function createLocalApiStartupSuccessMessage(nextStatus: SaxoApiStatus): string {
  if (!nextStatus.oauthConfigured) {
    return "ローカルAPIは起動しました。次は設定・診断でLIVE AppKey（Client ID）を保存してください。";
  }
  if (nextStatus.environmentConfigured === false) {
    return "ローカルAPIは起動しました。次は設定・診断でSIM/LIVE環境を選択してください。";
  }
  if (nextStatus.connectionState === "reconnect_required") {
    return "ローカルAPIは起動しました。Saxo接続の期限が切れているため、次はSaxo再接続を押してください。";
  }
  if (nextStatus.connected) {
    return "接続済みです。まとめて取得へ進めます。";
  }
  return "ローカルAPIは起動しました。次はSaxo接続を押してください。";
}

function formatLocalApiCauseMessage(reachability: LocalApiReachability): string {
  if (reachability === "checking") return "確認中です。少し待ってください。";
  if (reachability === "cors_or_pna_blocked") {
    return "ローカルAPIは起動していても、公開版Origin許可またはPrivate Network Accessでブロックされている可能性があります。推奨コマンドで起動し直してください。";
  }
  return "SaxoローカルAPIが起動していない、またはこの画面から到達できません。まず推奨コマンドをコピーしてターミナルで実行してください。";
}

function LocalApiDownCard({
  isLoading,
  reachability,
  os,
  setupChecks,
  commandCopied,
  diagnosticsOpen,
  onRefreshStatus,
  onCopyCommand,
  onToggleDiagnostics,
  onShowSetup,
}: {
  isLoading: boolean;
  reachability: LocalApiReachability;
  os: SaxoLocalApiOs;
  setupChecks: Record<SaxoLocalApiSetupStepId, boolean>;
  commandCopied: boolean;
  diagnosticsOpen: boolean;
  onRefreshStatus: () => void;
  onCopyCommand: () => void;
  onToggleDiagnostics: () => void;
  onShowSetup: () => void;
}) {
  const setupReady = isLocalApiReadyToStart(setupChecks);
  const canCopyCommand = setupReady && os !== "unknown";
  const primaryAction =
    !setupReady
      ? { label: "導入手順を見る", onClick: onShowSetup, disabled: false, icon: <Eye size={15} /> }
      : os === "unknown"
        ? { label: "OSを選択してください", onClick: onShowSetup, disabled: true, icon: <Eye size={15} /> }
        : commandCopied
          ? { label: "起動できたか確認", onClick: onRefreshStatus, disabled: isLoading, icon: <RefreshCw size={15} /> }
          : { label: "起動コマンドをコピー", onClick: onCopyCommand, disabled: false, icon: <Clipboard size={15} /> };
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-amber-950">Saxo APIを使うには、先にこのPCでローカルAPIを起動します。</h3>
          <p className="mt-1 text-sm leading-6 text-amber-900">
            Saxo接続の前に、Node.js、ローカルAPI補助ツール、`.env.local` を準備し、選択したOSのコマンドを実行してください。起動できるまでSaxoログインやまとめて取得は使いません。
            GitHub Pages自体はSaxoへ接続せず、Client IDやtokenもGitHubへ保存しません。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled}
          >
            {primaryAction.icon}
            {primaryAction.label}
          </button>
          {setupReady && canCopyCommand && !commandCopied ? (
            <button
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-bold text-amber-900 disabled:opacity-40"
              onClick={onRefreshStatus}
              disabled={isLoading}
            >
              <RefreshCw size={15} />
              起動できたか確認
            </button>
          ) : null}
          {commandCopied ? (
            <button className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-bold text-amber-900" onClick={onCopyCommand}>
              <Clipboard size={15} />
              起動コマンドをコピーし直す
            </button>
          ) : null}
          <button className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-bold text-amber-900" onClick={onToggleDiagnostics}>
            {diagnosticsOpen ? "詳しい設定を閉じる" : "詳しい設定を見る"}
          </button>
        </div>
      </div>
      <div className="mt-3 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-950">
        {formatLocalApiCauseMessage(reachability)}
      </div>
      {!setupReady ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm leading-6 text-amber-950">
          <div className="font-bold">先に導入準備が必要です</div>
          <p className="mt-1">上の「ローカルAPI補助ツールの準備」で、補助ツール、Node.js/npm、`.env.local` の準備を確認してください。未導入の状態では起動コマンドを出しても成功しません。</p>
        </div>
      ) : (
        <>
          <ol className="mt-3 grid gap-2 text-sm text-amber-950 md:grid-cols-3">
            <li className="rounded-md border border-amber-200 bg-white p-3">
              <span className="mr-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">1</span>
              <span className="font-bold">{os === "windows" ? "PowerShellでローカルAPI補助ツールのフォルダを開く" : "ターミナルでローカルAPI補助ツールのフォルダを開く"}</span>
            </li>
            <li className="rounded-md border border-amber-200 bg-white p-3">
              <span className="mr-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">2</span>
              <span className="font-bold">{os === "windows" ? "PowerShell用コマンドを貼り付け、Enter" : "1行コマンドを貼り付け、Enter"}</span>
            </li>
            <li className="rounded-md border border-amber-200 bg-white p-3">
              <span className="mr-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">3</span>
              <span className="font-bold">成功ログを確認し、この画面で「起動できたか確認」</span>
            </li>
          </ol>
          <div className="mt-3 grid gap-3 text-xs">
            <div>
              <div className="font-bold text-amber-950">{os === "windows" ? "PowerShell用コマンド" : "1行起動コマンド"}</div>
              <pre className="mt-1 overflow-x-auto rounded bg-white p-2 text-slate-800">{getSaxoLocalApiStartCommand(os)}</pre>
            </div>
            <div className="rounded-md border border-amber-200 bg-white px-3 py-2 leading-5 text-amber-950">
              <div className="font-bold">成功ログ</div>
              <code className="mt-1 block rounded bg-amber-50 p-2 text-slate-800">{SAXO_LOCAL_API_SUCCESS_LOG}</code>
              {os === "mac" ? (
                <p className="mt-2">貼り付け後に `&gt;` だけが出て止まった場合は、Control + C でキャンセルし、上の1行コマンドを貼り直してください。</p>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SaxoDiagnostics({
  status,
  configStatus,
  setupGuidance,
  showSetupSection,
  setupClientId,
  setupEnvironment,
  isSavingConfig,
  isLoading,
  connectionState,
  onClientIdChange,
  onEnvironmentChange,
  onCopyRedirectUri,
  onSaveConfig,
  onRefreshStatus,
  onEnablePersistence,
  onDisablePersistence,
  onDisconnect,
  localApiOnlyCommand,
}: {
  status: SaxoApiStatus | null;
  configStatus: SaxoConfigStatus | null;
  setupGuidance: SaxoSetupGuidance;
  showSetupSection: boolean;
  setupClientId: string;
  setupEnvironment: "sim" | "live";
  isSavingConfig: boolean;
  isLoading: boolean;
  connectionState: SaxoPanelConnectionState;
  onClientIdChange: (value: string) => void;
  onEnvironmentChange: (value: "sim" | "live") => void;
  onCopyRedirectUri: () => void;
  onSaveConfig: () => void;
  onRefreshStatus: () => void;
  onEnablePersistence: () => void;
  onDisablePersistence: () => void;
  onDisconnect: () => void;
  localApiOnlyCommand: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-sm font-bold text-slate-950">設定・診断</h3>
      <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        <StatusRow label="ローカルAPI bind" value={status?.bindAddress ?? "127.0.0.1"} />
        <StatusRow label="注文系endpoint" value={status?.orderEndpointsEnabled ? "有効" : "なし"} />
        <StatusRow label="OAuth設定" value={status?.oauthConfigured ? "LIVE AppKey設定済み" : "LIVE AppKey未設定"} />
        <StatusRow label="接続期限" value={formatDateTime(status?.connectionExpiresAt)} />
        <StatusRow label="access token期限" value={formatDateTime(status?.tokenExpiresAt)} />
        <StatusRow label="接続維持" value={formatPersistenceState(status)} />
        <StatusRow label="保存先" value={status?.tokenPersistence?.storage ?? "macOS Keychain"} />
        <StatusRow label="redirect URI" value={status?.redirectUri ?? "http://127.0.0.1:18787/api/saxo/auth/callback"} />
        <StatusRow label="UI許可元" value={configStatus?.localUiAllowedOrigin ?? "未取得"} />
        <StatusRow label="OAuth後の戻り先" value={configStatus?.localUiReturnUrl ?? "未取得"} />
      </dl>
      <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700">
        GitHub Pages版でSaxo API Read-onlyを使う場合も、Saxo通信は各自のPC上のローカルAPI補助ツールだけが行います。
        GitHub PagesはSaxoへ直接接続せず、Client ID、OAuth token、口座データ、JSONバックアップを保存しません。
      </div>
      <ReadOnlyStorageNotice status={status} />
      <SetupGuidanceBox guidance={setupGuidance} redirectUri={status?.redirectUri ?? "http://127.0.0.1:18787/api/saxo/auth/callback"} />
      {connectionState === "local_api_down" ? (
        <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700">
          <div className="font-bold text-slate-900">詳細起動コマンド</div>
          <p className="mt-1">フロントエンドが既に起動済みで、SaxoローカルAPIだけを起動する場合:</p>
          <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-slate-800">{localApiOnlyCommand}</pre>
        </div>
      ) : null}
      {showSetupSection ? (
        <ConnectionSetupSection
          configStatus={configStatus}
          clientId={setupClientId}
          environment={setupEnvironment}
          isSaving={isSavingConfig}
          onClientIdChange={onClientIdChange}
          onEnvironmentChange={onEnvironmentChange}
          onCopyRedirectUri={onCopyRedirectUri}
          onSave={onSaveConfig}
        />
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800" onClick={onRefreshStatus}>
          <RefreshCw size={15} />
          {connectionState === "local_api_down" ? "起動できたか確認" : "接続状態を再確認"}
        </button>
        <button
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-40"
          onClick={onEnablePersistence}
          disabled={isLoading || connectionState !== "connected" || status?.tokenPersistence?.supported === false || status?.tokenPersistence?.enabled === true}
        >
          <Save size={15} />
          接続をこのMacに保持
        </button>
        <button
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 disabled:opacity-40"
          onClick={onDisablePersistence}
          disabled={isLoading || status?.tokenPersistence?.supported === false || status?.tokenPersistence?.enabled !== true}
        >
          <Ban size={15} />
          接続保持を解除
        </button>
        <button className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800" onClick={onDisconnect}>
          <LogOut size={15} />
          Saxo logout
        </button>
      </div>
    </div>
  );
}

function SaxoMainActions({
  isLoading,
  localApiDown,
  onLoadAll,
  onShowPending,
  onShowMapping,
  showIndividualFetch,
  onToggleIndividualFetch,
  onLoadSnapshots,
  onLoadPositions,
  onLoadOrders,
  onLoadHistory,
}: {
  isLoading: boolean;
  localApiDown: boolean;
  onLoadAll: () => void;
  onShowPending: () => void;
  onShowMapping: () => void;
  showIndividualFetch: boolean;
  onToggleIndividualFetch: () => void;
  onLoadSnapshots: () => void;
  onLoadPositions: () => void;
  onLoadOrders: () => void;
  onLoadHistory: () => void;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap gap-2">
        <button className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40" onClick={onLoadAll} disabled={isLoading || localApiDown}>
          <RefreshCw size={15} />
          まとめて取得
        </button>
        <button className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800" onClick={onShowPending}>
          反映待ちを確認
        </button>
        <button className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800" onClick={onShowMapping}>
          Saxo口座の割り当て
        </button>
        <button className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800 disabled:cursor-not-allowed disabled:opacity-40" onClick={onToggleIndividualFetch} disabled={localApiDown}>
          {showIndividualFetch ? "個別取得を隠す" : "個別に取得"}
        </button>
      </div>
      {showIndividualFetch ? (
        <div className="mt-3 flex flex-wrap gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 disabled:cursor-not-allowed disabled:opacity-40" onClick={onLoadSnapshots} disabled={isLoading || localApiDown}>
            残高だけ取得
          </button>
          <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 disabled:cursor-not-allowed disabled:opacity-40" onClick={onLoadPositions} disabled={isLoading || localApiDown}>
            建玉だけ取得
          </button>
          <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 disabled:cursor-not-allowed disabled:opacity-40" onClick={onLoadOrders} disabled={isLoading || localApiDown}>
            注文だけ取得
          </button>
          <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 disabled:cursor-not-allowed disabled:opacity-40" onClick={onLoadHistory} disabled={isLoading || localApiDown}>
            履歴だけ取得
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PnMappingSummary({
  pMapping,
  nMapping,
  otherCount,
  workspace,
}: {
  pMapping?: SaxoAccountMapping;
  nMapping?: SaxoAccountMapping;
  otherCount: number;
  workspace: WorkspaceMode;
}) {
  return (
    <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="text-xs font-bold text-slate-500">P口座</div>
        <div className="mt-1 font-semibold text-slate-950">
          {pMapping ? `${maskDisplayName(pMapping.displayName, pMapping.accountId, pMapping.accountKey)} / ${pMapping.currency} / ${pMapping.environment.toUpperCase()}` : "未割当"}
        </div>
      </div>
      {workspace !== "demo" ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-bold text-slate-500">N口座</div>
          <div className="mt-1 font-semibold text-slate-950">
            {nMapping ? `${maskDisplayName(nMapping.displayName, nMapping.accountId, nMapping.accountKey)} / ${nMapping.currency} / ${nMapping.environment.toUpperCase()}` : "未割当"}
          </div>
        </div>
      ) : null}
      {otherCount > 0 ? (
        <p className="text-xs leading-5 text-slate-500 md:col-span-2">その他{otherCount}口座は標準表示では非表示です。</p>
      ) : null}
    </div>
  );
}

type ReflectionSummary = {
  accountLines: Array<{ key: string; label: string; detail: string; actionable: boolean; actionLabel: string; target: "mapping" | "snapshot" }>;
  positionLine: { detail: string; actionable: boolean };
  orderLine: { detail: string; actionable: boolean };
  historyLine: { detail: string; actionable: boolean; actionLabel: string };
  hasPending: boolean;
};

const ReflectionPendingSummary = forwardRef<HTMLDivElement, {
  summary: ReflectionSummary;
  onShowMapping: () => void;
  onShowSnapshot: () => void;
  onShowPositions: () => void;
  onShowOrders: () => void;
  onShowHistory: () => void;
}>(function ReflectionPendingSummary(
  { summary, onShowMapping, onShowSnapshot, onShowPositions, onShowOrders, onShowHistory },
  ref,
) {
  return (
    <div ref={ref} className={`rounded-md border p-3 ${summary.hasPending ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-950">{summary.hasPending ? "反映待ちがあります" : "反映待ちはありません"}</h3>
        <span className="text-xs font-semibold text-slate-600">取得後に次の確認先を表示します</span>
      </div>
      <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
        {summary.accountLines.map((line) => (
          <PendingLine
            key={line.key}
            label={line.label}
            detail={line.detail}
            actionLabel={line.actionLabel}
            disabled={!line.actionable}
            onClick={line.target === "mapping" ? onShowMapping : onShowSnapshot}
          />
        ))}
        <PendingLine label="建玉候補" detail={summary.positionLine.detail} actionLabel="候補を確認" disabled={!summary.positionLine.actionable} onClick={onShowPositions} />
        <PendingLine label="注文候補" detail={summary.orderLine.detail} actionLabel="確認する" disabled={!summary.orderLine.actionable} onClick={onShowOrders} />
        <PendingLine label="履歴候補" detail={summary.historyLine.detail} actionLabel={summary.historyLine.actionLabel} disabled={!summary.historyLine.actionable} onClick={onShowHistory} />
      </div>
    </div>
  );
});

function PendingLine({
  label,
  detail,
  actionLabel,
  disabled,
  onClick,
}: {
  label: string;
  detail: string;
  actionLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/70 bg-white px-3 py-2">
      <div>
        <div className="text-xs font-bold text-slate-500">{label}</div>
        <div className="mt-0.5 font-semibold text-slate-900">{detail}</div>
      </div>
      <button
        type="button"
        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-bold text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onClick}
        disabled={disabled}
      >
        {actionLabel}
      </button>
    </div>
  );
}

function ReadOnlyStorageNotice({ status }: { status: SaxoApiStatus | null }) {
  const persistence = status?.tokenPersistence;
  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
      <div className="font-bold text-slate-800">保存しない情報</div>
      <p className="mt-1">
        Saxo Account ID、パスワード、2FAコードは保存しません。Saxoログインは公式画面で本人が行います。
      </p>
      <p className="mt-1">
        OAuth tokenはブラウザlocalStorageやGit管理下のファイルには保存しません。接続保持を有効にした場合だけ、このMacのmacOS Keychainに保存します。
      </p>
      <p className="mt-1">
        接続維持: <span className="font-bold">{persistence?.enabled ? "有効" : "無効"}</span> / 保存先:{" "}
        <span className="font-bold">{persistence?.storage ?? "macOS Keychain"}</span>
      </p>
      <p className="mt-1">
        {persistence?.enabled
          ? "次回ローカルAPI起動時に、refresh tokenが有効ならSaxoログインを省略できる可能性があります。期限切れや失効時だけ再ログインが必要です。"
          : "接続保持を有効にするまでは、ローカルAPI再起動やPC再起動後にSaxo公式画面で再ログインが必要です。"}
      </p>
      {persistence?.message ? <p className="mt-1 text-slate-500">{persistence.message}</p> : null}
    </div>
  );
}

function SetupGuidanceBox({ guidance, redirectUri }: { guidance: SaxoSetupGuidance; redirectUri: string }) {
  const className =
    guidance.tone === "danger"
      ? "border-red-200 bg-red-50 text-red-800"
      : guidance.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : guidance.tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-sky-200 bg-sky-50 text-sky-800";
  return (
    <div className={`mt-3 rounded-md border px-3 py-2 text-sm leading-6 ${className}`}>
      <div className="font-bold">{guidance.title}</div>
      <p>{guidance.detail}</p>
      {guidance.command ? <code className="mt-1 block font-mono text-xs">{guidance.command}</code> : null}
      <p className="mt-1 text-xs">redirect URI: <code className="font-mono">{redirectUri}</code></p>
    </div>
  );
}

function ConnectionSetupSection({
  configStatus,
  clientId,
  environment,
  isSaving,
  onClientIdChange,
  onEnvironmentChange,
  onCopyRedirectUri,
  onSave,
}: {
  configStatus: SaxoConfigStatus | null;
  clientId: string;
  environment: "sim" | "live";
  isSaving: boolean;
  onClientIdChange: (value: string) => void;
  onEnvironmentChange: (value: "sim" | "live") => void;
  onCopyRedirectUri: () => void;
  onSave: () => void;
}) {
  const redirectUri = configStatus?.redirectUri ?? "http://127.0.0.1:18787/api/saxo/auth/callback";
  const appKeyWarning = getLiveAppKeyInputWarning(clientId);
  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-bold">接続セットアップ</h4>
          <p className="mt-1 leading-6">
            ここで設定するのは、Saxo Developer Portalで作成した「LIVE AppKey（Client ID）」です。
            これはこのアプリがSaxo APIを使うためのアプリ識別子です。
            SaxoTraderGOのログインID、Saxo Account ID、P/N口座番号ではありません。
          </p>
          <p className="mt-1 leading-6">
            保存済みの場合は、通常は何も入力しません。別のLIVE AppKeyへ変更する時だけ貼り替えます。
            Saxo Account ID、パスワード、2FAコード、Client Secretはこの画面に入力しません。
          </p>
        </div>
        {configStatus?.clientIdMasked ? (
          <span className="rounded bg-white px-2 py-1 text-xs font-bold text-slate-700">LIVE AppKey設定済み: {configStatus.clientIdMasked}</span>
        ) : null}
      </div>
      <div className="mt-3 rounded-md border border-amber-200 bg-white px-3 py-2 text-xs leading-5 text-amber-900">
        <div className="font-bold text-slate-800">ログインIDとAppKeyの違い</div>
        <p className="mt-1">
          <span className="font-bold">Saxo Account ID:</span> Saxo公式ログイン画面だけで入力します。このアプリには保存しません。
        </p>
        <p className="mt-1">
          <span className="font-bold">LIVE AppKey（Client ID）:</span>{" "}
          このアプリをSaxo APIに接続するための識別子です。Saxo Developer Portalで確認し、この端末内に保存します。
        </p>
      </div>
      <div className="mt-3 grid gap-3">
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">LIVE AppKey（Client ID）</span>
          <input
            className="rounded-md border border-amber-300 bg-white px-3 py-2 font-mono text-sm text-slate-950"
            value={clientId}
            onChange={(event) => onClientIdChange(event.target.value)}
            placeholder={configStatus?.clientIdMasked ? "保存済みです。変更する場合だけLIVE AppKeyを貼り付け" : "Saxo Developer PortalのLIVE AppKeyを貼り付け"}
            autoComplete="off"
            spellCheck={false}
          />
          {appKeyWarning ? <span className="text-xs font-bold text-red-700">{appKeyWarning}</span> : null}
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-bold text-slate-700">環境</span>
          <select
            className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-slate-950"
            value={environment}
            onChange={(event) => onEnvironmentChange(event.target.value as "sim" | "live")}
          >
            <option value="sim">SIM</option>
            <option value="live">LIVE</option>
          </select>
        </label>
        <div className="rounded-md border border-amber-200 bg-white px-3 py-2">
          <div className="text-xs font-bold text-slate-700">redirect URI</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-slate-100 px-2 py-1 text-xs text-slate-900">{redirectUri}</code>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-bold text-slate-800"
              onClick={onCopyRedirectUri}
            >
              <Clipboard size={13} />
              コピー
            </button>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex w-fit items-center gap-1 rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onSave}
          disabled={isSaving || !clientId.trim() || Boolean(appKeyWarning)}
        >
          <Save size={15} />
          ローカル設定を保存
        </button>
      </div>
    </div>
  );
}

function getLiveAppKeyInputWarning(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/\s/g, "");
  const looksLikeShortNumeric = /^\d{4,12}$/.test(normalized);
  const looksLikePnAccountNumber = /^(?:\d{3,}\/)?[PN]\d{4,}$/i.test(normalized);
  const looksLikeAccountIdWithSeparator = /^[PN]:/i.test(normalized) || /\/[PN]\d{4,}$/i.test(normalized);
  if (looksLikeShortNumeric || looksLikePnAccountNumber || looksLikeAccountIdWithSeparator) {
    return "これはSaxoのログインIDや口座番号ではありません。Saxo Developer Portalで発行されたLIVE AppKeyを入力してください。";
  }
  return "";
}

function formatDateTime(value?: string): string {
  if (!value) return "未接続";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "未取得";
  return new Date(timestamp).toLocaleString("ja-JP");
}

function formatSaxoEnvironmentStatus(status: SaxoApiStatus | null): string {
  if (!status) return "未確認";
  if (status.environmentConfigured === false) return `${status.environment.toUpperCase()}扱い / SAXO_ENVIRONMENT未設定`;
  return status.environment.toUpperCase();
}

function formatPersistenceState(status: SaxoApiStatus | null): string {
  const persistence = status?.tokenPersistence;
  if (!persistence) return "未確認";
  if (!persistence.supported) return "無効 / macOS Keychain非対応";
  if (persistence.enabled) {
    if (persistence.restored) return "有効 / Keychainから復元";
    return "有効";
  }
  if (persistence.status === "expired" || persistence.status === "invalid") return "無効 / 再ログイン必要";
  return "無効";
}

function AccountMappingRow({
  account,
  value,
  allowNAccount,
  muted = false,
  onChange,
}: {
  account: SaxoApiAccount;
  value: SaxoMappedCode;
  allowNAccount: boolean;
  muted?: boolean;
  onChange: (mappedCode: SaxoMappedCode) => void;
}) {
  return (
    <div className={`grid gap-2 rounded-md border p-2 text-sm md:grid-cols-[1fr_auto] ${muted ? "border-slate-100 bg-white text-slate-600" : "border-slate-200 bg-slate-50"}`}>
      <div>
        <div className="font-bold text-slate-950">{maskDisplayName(account.displayName, account.accountId, account.accountKey)}</div>
        <div className="mt-0.5 text-xs text-slate-500">
          Key: {maskSaxoIdentifier(account.accountKey)} / 通貨: {account.currency ?? "未取得"} / {account.environment.toUpperCase()}
          {account.isTrialAccount ? " / Trial" : ""}
        </div>
      </div>
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm font-semibold"
        value={value}
        onChange={(event) => onChange(event.target.value as SaxoMappedCode)}
      >
        <option value="unmapped">未割当</option>
        <option value="P">P口座</option>
        <option value="N" disabled={!allowNAccount}>N口座</option>
        <option value="ignore">使わない</option>
      </select>
    </div>
  );
}

function SnapshotPreview({
  accountCode,
  workspace,
  account,
  mapping,
  snapshot,
  onApply,
}: {
  accountCode: SaxoAccountCode;
  workspace: WorkspaceMode;
  account: AccountState;
  mapping?: SaxoAccountMapping;
  snapshot?: SaxoApiAccountSnapshot;
  onApply: (accountCode: SaxoAccountCode, snapshot: SaxoApiAccountSnapshot) => void;
}) {
  const rows = snapshot ? createSaxoAccountDiffRows(account, snapshot) : [];
  const alreadyApplied = Boolean(snapshot && hasAppliedSaxoSnapshot(account, snapshot));
  const blockReason = getSaxoAccountReflectionBlockReason({ workspace, account, mapping, snapshot });
  const canApply = Boolean(
    !blockReason && mapping?.confirmedByUser && snapshot && !alreadyApplied && rows.some((row) => row.status === "changed"),
  );
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-slate-950">{accountCode}口座</h4>
          <p className="mt-0.5 text-xs text-slate-500">
            {mapping
              ? `${maskDisplayName(mapping.displayName, mapping.accountId, mapping.accountKey)} / ${mapping.currency} / ${mapping.environment.toUpperCase()}${mapping.isTrialAccount ? " / Trial" : ""}`
              : "P/N割当が未確定です。"}
          </p>
        </div>
        <button
          className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canApply || !snapshot}
          onClick={() => snapshot && onApply(accountCode, snapshot)}
        >
          <CheckCircle2 size={14} />
          {alreadyApplied ? "反映済み" : `${accountCode}口座へ反映`}
        </button>
      </div>
      {!mapping || !snapshot ? (
        <p className={`mt-2 text-sm ${mapping ? "text-slate-500" : "text-amber-700"}`}>{blockReason}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          {blockReason ? (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-6 text-red-800">
              {blockReason}
            </div>
          ) : null}
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1 pr-3">項目</th>
                <th className="py-1 pr-3 text-right">手入力値</th>
                <th className="py-1 pr-3 text-right">Saxo取得値</th>
                <th className="py-1 text-right">差分</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.field} className="border-b border-slate-100">
                  <td className="py-1.5 pr-3 font-semibold text-slate-700">{row.label}</td>
                  <td className="numeric-input py-1.5 pr-3 text-right">{formatMaybeValue(row.currentValue, row.currency)}</td>
                  <td className="numeric-input py-1.5 pr-3 text-right font-bold text-slate-950">{formatMaybeValue(row.saxoValue, row.currency)}</td>
                  <td className={`numeric-input py-1.5 text-right font-bold ${row.status === "missing" ? "text-amber-700" : row.status === "changed" ? "text-teal-700" : "text-slate-500"}`}>
                    {row.status === "missing" ? "未取得" : row.status === "same" ? "一致" : formatDiff(row.currentValue, row.saxoValue, row.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {snapshot.missingFields.length > 0 ? (
            <p className="mt-2 text-xs text-amber-700">未取得: {snapshot.missingFields.join(", ")}。0として扱わず、必要なら手動確認してください。</p>
          ) : null}
          {alreadyApplied ? <p className="mt-2 text-xs font-semibold text-emerald-700">この取得値は反映済みです。同じ取得結果を二重反映できません。</p> : null}
          {(account.saxoSyncHistory?.length ?? 0) > 0 ? (
            <p className="mt-2 text-xs text-slate-500">反映履歴: {account.saxoSyncHistory?.length ?? 0}件</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PositionsPreview({
  rows,
  positions,
  fetchedAt,
  isLoading,
  expandedPositionId,
  highlightedPositionId,
  draftPosition,
  draftedPositionIds,
  simulations,
  stockTransfers,
  historyItems,
  resolveLinkedSimulation,
  positionActionErrors,
  positionActionNotices,
  onLoad,
  onToggleDetails,
  onIgnore,
  onLink,
  onLinkExisting,
  onRepairLink,
  onOpenLinked,
  onCreateDraft,
  onCreateDraftFromBroken,
  onDiscardDraft,
  onCreateStockTransfer,
  onOpenWheelManagement,
  onDownloadJson,
  onOpenSimulationAt,
}: {
  rows: SaxoPositionReconciliationRow[];
  positions: SaxoApiPositionSnapshot[];
  fetchedAt: string;
  isLoading: boolean;
  expandedPositionId: string;
  highlightedPositionId: string;
  draftPosition: SaxoApiPositionSnapshot | null;
  draftedPositionIds: string[];
  simulations: TradeSimulation[];
  stockTransfers: StockTransferEvent[];
  historyItems: SaxoHistoryDiscoveryItem[];
  resolveLinkedSimulation: (row: SaxoPositionReconciliationRow) => LinkedSimulationResolution;
  positionActionErrors: Record<string, string>;
  positionActionNotices: Record<string, string>;
  onLoad: () => void;
  onToggleDetails: (id: string) => void;
  onIgnore: (position: SaxoApiPositionSnapshot) => void;
  onLink: (row: SaxoPositionReconciliationRow) => void;
  onLinkExisting: (row: SaxoPositionReconciliationRow) => void;
  onRepairLink: (row: SaxoPositionReconciliationRow) => void;
  onOpenLinked: (row: SaxoPositionReconciliationRow, anchorId?: string) => void;
  onCreateDraft: (position: SaxoApiPositionSnapshot) => void;
  onCreateDraftFromBroken: (position: SaxoApiPositionSnapshot) => void;
  onDiscardDraft: (position: SaxoApiPositionSnapshot) => void;
  onCreateStockTransfer: (position: SaxoApiPositionSnapshot, sourceSimulationId?: string) => boolean | void;
  onOpenWheelManagement?: (ticker?: string) => void;
  onDownloadJson?: () => void;
  onOpenSimulationAt: (simulationId: string, anchorId?: string) => void;
}) {
  const assignedP = positions.filter((position) => position.accountAssignment === "P").length;
  const assignedN = positions.filter((position) => position.accountAssignment === "N").length;
  const unassigned = positions.filter((position) => position.accountAssignment === "unassigned").length;
  const ignored = positions.filter((position) => position.accountAssignment === "ignored").length;
  const stockTransferRows = rows.filter((row) => isNAccountStockPosition(row.position));
  const pendingStockTransferRows = stockTransferRows.filter(
    (row) => row.position && !getRecordedStockTransferForPosition(row.position, simulations, stockTransfers),
  );
  const recordedStockTransferRows = stockTransferRows.filter(
    (row) => row.position && getRecordedStockTransferForPosition(row.position, simulations, stockTransfers),
  );
  const regularRows = rows.filter((row) => !isNAccountStockPosition(row.position));
  const draft = draftPosition ? createSaxoPositionDraftSummary(draftPosition, simulations) : null;
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-950">建玉候補</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Saxoの現在建玉をread-onlyで取得し、既存建玉と安全条件で照合します。取得建玉は自動保存せず、建玉入力への下書き反映に留めます。
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-5">
        <StatChip label="取得件数" value={`${positions.length}件`} />
        <StatChip label="P口座" value={`${assignedP}件`} />
        <StatChip label="N口座" value={`${assignedN}件`} />
        <StatChip label="未割当" value={`${unassigned}件`} />
        <StatChip label="P→N未処理候補" value={`${pendingStockTransferRows.length}件`} />
      </div>
      {recordedStockTransferRows.length > 0 ? (
        <p className="mt-1 text-xs font-semibold text-teal-700">
          照合済みの現在保有確認: {recordedStockTransferRows.length}件。記録済みのN口座現物株は未処理のP→N移管候補には含めません。
        </p>
      ) : null}
      {ignored > 0 ? <p className="mt-2 text-xs text-slate-500">使わない口座: {ignored}件</p> : null}
      <p className="mt-2 text-xs text-slate-500">最終取得: {fetchedAt ? new Date(fetchedAt).toLocaleString("ja-JP") : "未取得"}</p>
      {unassigned > 0 ? (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          未割当口座の建玉は照合対象外です。P/N/使わないをユーザー確認で割り当ててから再確認してください。
        </p>
      ) : null}
      {stockTransferRows.length > 0 ? (
        <NStockTransferCandidates
          rows={stockTransferRows}
          simulations={simulations}
          stockTransfers={stockTransfers}
          expandedPositionId={expandedPositionId}
          highlightedPositionId={highlightedPositionId}
          actionNoticeByPositionId={positionActionNotices}
          onToggleDetails={onToggleDetails}
          onIgnore={onIgnore}
          onCreateStockTransfer={onCreateStockTransfer}
          onOpenWheelManagement={onOpenWheelManagement}
          onDownloadJson={onDownloadJson}
          onOpenSimulationAt={onOpenSimulationAt}
        />
      ) : null}
      <div className="mt-3 overflow-x-auto">
        {regularRows.length === 0 ? (
          <p className="text-sm text-slate-500">
            {rows.length === 0 ? "Saxo接続後に現在建玉を取得してください。" : "通常のオプション建玉候補はありません。N口座の現物株候補は上の専用カードで確認してください。"}
          </p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1 pr-3">Saxo建玉</th>
                <th className="py-1 pr-3">口座</th>
                <th className="py-1 pr-3 text-right">数量</th>
                <th className="py-1 pr-3 text-right">現在値</th>
                <th className="py-1 pr-3 text-right">評価損益</th>
                <th className="py-1 pr-3">照合</th>
                <th className="py-1">操作</th>
              </tr>
            </thead>
            <tbody>
              {regularRows.map((row) => (
                <PositionRow
                  key={row.id}
                  row={row}
                  linkedResolution={resolveLinkedSimulation(row)}
                  expanded={Boolean(row.position && expandedPositionId === row.position.id)}
                  highlighted={Boolean(row.position && highlightedPositionId === row.position.id)}
                  onToggleDetails={onToggleDetails}
                  onIgnore={onIgnore}
                  onLink={onLink}
                  onLinkExisting={onLinkExisting}
                  onRepairLink={onRepairLink}
                  onOpenLinked={onOpenLinked}
                  onCreateDraft={onCreateDraft}
                  onCreateDraftFromBroken={onCreateDraftFromBroken}
                  drafted={Boolean(row.position && draftedPositionIds.includes(row.position.id))}
                  actionError={row.position ? positionActionErrors[row.position.id] : undefined}
                  actionNotice={row.position ? positionActionNotices[row.position.id] : undefined}
                  historyMatchCount={row.position ? findEntryHistoryMatches(row.position, historyItems).length : 0}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
      {draft && draftPosition ? (
        <div className="mt-3 rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-bold">建玉入力への反映下書き</h4>
            <span className="rounded bg-white px-2 py-1 text-xs font-bold text-teal-800">正式保存前 - 内容確認が必要です</span>
          </div>
          <p className="mt-1 text-xs leading-5">
            これはAPI取得値から作成した下書きです。銘柄、口座、売買方向、数量、権利行使価格、満期、建て価格を確認し、必要な不足項目を入力してから正式保存してください。
          </p>
          <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
            <DraftRow label="名前" value={draft.name} />
            <DraftRow label="口座" value={draft.accountCode ? `${draft.accountCode} / ${draft.settlementCurrency}` : "未割当"} />
            <DraftRow label="戦略候補" value={draft.strategyType} />
            <DraftRow label="銘柄" value={draft.ticker || "未取得"} />
            <DraftRow label="売買方向" value={draft.side} />
            <DraftRow label="オプション" value={draft.optionType ?? draftPosition.kind} />
            <DraftRow label="権利行使価格" value={formatMaybeValue(draft.strike, "USD")} />
            <DraftRow label="満期日" value={draft.expiry ?? "未取得"} />
            <DraftRow label="数量" value={formatMaybeValue(draft.quantity)} />
            <DraftRow label="建て価格" value={formatMaybeValue(draft.premiumOpenPrice, "USD")} />
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-teal-900">
              建玉入力カードで内容を確認し、「確認して正式保存する」を押してください。
            </span>
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
              onClick={() => onDiscardDraft(draftPosition)}
            >
              下書き表示を破棄
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NStockTransferCandidates({
  rows,
  simulations,
  stockTransfers,
  expandedPositionId,
  highlightedPositionId,
  actionNoticeByPositionId,
  onToggleDetails,
  onIgnore,
  onCreateStockTransfer,
  onOpenWheelManagement,
  onDownloadJson,
  onOpenSimulationAt,
}: {
  rows: SaxoPositionReconciliationRow[];
  simulations: TradeSimulation[];
  stockTransfers: StockTransferEvent[];
  expandedPositionId: string;
  highlightedPositionId: string;
  actionNoticeByPositionId: Record<string, string>;
  onToggleDetails: (id: string) => void;
  onIgnore: (position: SaxoApiPositionSnapshot) => void;
  onCreateStockTransfer: (position: SaxoApiPositionSnapshot, sourceSimulationId?: string) => boolean | void;
  onOpenWheelManagement?: (ticker?: string) => void;
  onDownloadJson?: () => void;
  onOpenSimulationAt: (simulationId: string, anchorId?: string) => void;
}) {
  return (
    <div className="mt-3 rounded-md border border-teal-300 bg-teal-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-teal-950">N口座の現物株候補</h4>
          <p className="mt-1 text-xs leading-5 text-teal-900">
            SaxoではN口座に現物株が確認されました。P口座で権利行使取得した株式のN口座移管候補として確認します。
            これは新規オプション建玉ではありません。3-Aには進みません。
          </p>
        </div>
        <span className="rounded bg-white px-2 py-1 text-xs font-bold text-teal-800">
          P→N未処理候補{" "}
          {rows.filter((row) => row.position && !getRecordedStockTransferForPosition(row.position, simulations, stockTransfers)).length}件
        </span>
      </div>
      <div className="mt-3 grid gap-3">
        {rows.map((row) => {
          const position = row.position;
          if (!position) return null;
          const matches = findPnTransferSourceSimulations(position, simulations);
          const primaryMatch = matches.length === 1 ? matches[0] : undefined;
          const expanded = expandedPositionId === position.id;
          const highlighted = highlightedPositionId === position.id;
          const notice = actionNoticeByPositionId[position.id];
          const transferShares = getSaxoStockShares(position);
          const recordedTransfer = primaryMatch
            ? stockTransfers.find(
                (transfer) =>
                  transfer.sourceSimulationId === primaryMatch.id &&
                  transfer.toAccountCode === "N" &&
                  Math.abs(transfer.shares - transferShares) <= 0.0001,
              )
            : undefined;
          const wheelTicker = recordedTransfer?.ticker ?? primaryMatch?.ticker ?? normalizeStockTicker(position.symbol ?? position.underlyingName ?? position.instrumentCode);
          const recordedMessage = `このN口座現物株は、保存済みのP→N株式移管記録と照合済みです。未処理のP→N移管候補ではありません。N口座ホイールで${wheelTicker || "対象銘柄"} ${formatMaybeValue(transferShares)}株の保有を確認し、JSONバックアップを保存してください。`;
          return (
            <div key={row.id} className={`rounded-md border bg-white p-3 ${highlighted || recordedTransfer ? "border-teal-500 ring-2 ring-teal-200" : "border-teal-200"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-slate-950">
                    {formatNStockTransferCandidateLabel(position, primaryMatch)}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    SaxoではN口座に{formatMaybeValue(getSaxoStockShares(position))}株があります。
                    {hasAutoAssignmentCorrelation(position) ? " AutoAssignmentがあるため、P売り権利行使由来の移管候補として扱います。" : " 既存のP口座取得株と照合して移管候補として確認します。"}
                  </p>
                </div>
                <span className="rounded bg-teal-100 px-2 py-1 text-xs font-bold text-teal-900">
                  {recordedTransfer ? "照合済みの現在保有確認" : "P→N移管確認候補"}
                </span>
              </div>
              <div className="mt-2 grid gap-2 text-xs sm:grid-cols-4">
                <StatChip label="口座" value="N口座 / USD" />
                <StatChip label="株数" value={`${formatMaybeValue(getSaxoStockShares(position))}株`} />
                <StatChip label="平均取得単価" value={formatMaybeValue(getSaxoStockAveragePrice(position), "USD")} />
                <StatChip label="取得元候補" value={primaryMatch ? primaryMatch.name : matches.length > 1 ? `${matches.length}件あり` : "未照合"} />
              </div>
              {primaryMatch ? (
                <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-900">
                  <div className="font-bold">対応するP口座の権利行使済み建玉候補があります</div>
                  <div>
                    {primaryMatch.ticker} / {primaryMatch.stockAcquisition?.shares ?? primaryMatch.stockPosition?.shares ?? 0}株 @ {formatMaybeValue(primaryMatch.stockAcquisition?.priceUSD ?? primaryMatch.stockPosition?.averageCostUSD, "USD")}
                  </div>
                </div>
              ) : matches.length > 1 ? (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                  一致候補が複数あります。対応するP口座の権利行使済み建玉を確認してから、今回は手入力で移管記録を確認してください。
                </div>
              ) : (
                <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                  N口座に現物株がありますが、既存のP口座取得株と一致しません。株数・取得単価・権利行使済み建玉を確認してください。
                </div>
              )}
              {recordedTransfer ? (
                <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-950">
                  <div className="font-bold">反映済み / 追加操作不要</div>
                  <p>{notice ?? recordedMessage}</p>
                  <p className="mt-1">
                    移管履歴: P口座からN口座へ{recordedTransfer.shares}株を移管 / 平均取得単価 {formatUSD(recordedTransfer.costBasisUSD)}
                  </p>
                </div>
              ) : notice ? (
                <p className="mt-2 rounded bg-teal-100 px-2 py-1 text-xs font-semibold text-teal-900">{notice}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {recordedTransfer ? (
                  <>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md bg-teal-700 px-3 py-2 text-sm font-bold text-white hover:bg-teal-800"
                      onClick={() => onOpenWheelManagement?.(wheelTicker)}
                    >
                      <RefreshCw size={15} />
                      N口座ホイールを確認
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700"
                      onClick={onDownloadJson}
                    >
                      <Download size={15} />
                      JSONバックアップを保存
                    </button>
                    <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                      移管記録済み
                    </span>
                  </>
                ) : primaryMatch ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md bg-teal-700 px-3 py-2 text-sm font-bold text-white hover:bg-teal-800"
                    onClick={() => onCreateStockTransfer(position, primaryMatch.id)}
                  >
                    <RefreshCw size={15} />
                    P→N株式移管を記録
                  </button>
                ) : null}
                {primaryMatch ? (
                  <button
                    type="button"
                    className="rounded-md border border-teal-300 bg-white px-3 py-2 text-sm font-bold text-teal-900"
                    onClick={() => onOpenSimulationAt(primaryMatch.id, "stock-acquisition-record")}
                  >
                    対応するP口座の権利行使済み建玉を開く
                  </button>
                ) : null}
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700"
                  onClick={() => onToggleDetails(position.id)}
                >
                  <Eye size={15} />
                  {expanded ? "詳細を閉じる" : "詳細を見る"}
                </button>
                {!recordedTransfer ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700"
                    onClick={() => onIgnore(position)}
                  >
                    <Ban size={15} />
                    今回は無視
                  </button>
                ) : null}
              </div>
              {expanded ? (
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                  <div className="font-bold text-slate-900">Saxo現在建玉から取得できた情報</div>
                  <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                    <DraftRow label="AssetType" value={position.assetType ?? "未取得"} />
                    <DraftRow label="Account Key" value={maskSaxoIdentifier(position.accountKey)} />
                    <DraftRow label="Position ID" value={maskSaxoIdentifier(position.positionId)} />
                    <DraftRow label="Correlation" value={hasAutoAssignmentCorrelation(position) ? "AutoAssignment" : "未取得"} />
                    <DraftRow label="symbol" value={position.symbol ?? "未取得"} />
                    <DraftRow label="current price" value={formatMaybeValue(position.currentStockPrice ?? position.currentPrice, position.currency)} />
                  </dl>
                  <p className="mt-2">
                    symbolが未取得でも、AutoAssignment、株数、平均取得単価、既存P口座の権利行使済み株式取得記録から候補提示します。未取得項目は0扱いしません。
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OrdersPreview({
  orders,
  fetchedAt,
  isLoading,
  expandedOrderId,
  onLoad,
  onToggleDetails,
}: {
  orders: SaxoApiOrderSnapshot[];
  fetchedAt: string;
  isLoading: boolean;
  expandedOrderId: string;
  onLoad: () => void;
  onToggleDetails: (id: string) => void;
}) {
  const assignedP = orders.filter((order) => order.accountAssignment === "P").length;
  const assignedN = orders.filter((order) => order.accountAssignment === "N").length;
  const unassigned = orders.filter((order) => order.accountAssignment === "unassigned").length;
  const exitCandidates = orders.filter((order) => order.isExitCandidate).length;
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-950">未約定注文・出口注文取得</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Saxoの未約定注文をread-onlyで取得します。決済指値・逆指値・OCO/IFD系は、アプリ側出口ルールとは別の「Saxo側候補」として表示します。
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-5">
        <StatChip label="取得件数" value={`${orders.length}件`} />
        <StatChip label="P口座" value={`${assignedP}件`} />
        <StatChip label="N口座" value={`${assignedN}件`} />
        <StatChip label="未割当" value={`${unassigned}件`} />
        <StatChip label="出口候補" value={`${exitCandidates}件`} />
      </div>
      <p className="mt-2 text-xs text-slate-500">最終取得: {fetchedAt ? new Date(fetchedAt).toLocaleString("ja-JP") : "未取得"}</p>
      <div className="mt-3 overflow-x-auto">
        {fetchedAt && orders.length === 0 ? (
          <p className="text-sm text-slate-500">Saxo側の未約定注文は0件です。</p>
        ) : !fetchedAt ? (
          <p className="text-sm text-slate-500">Saxo接続後に未約定注文を取得してください。</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1 pr-3">注文</th>
                <th className="py-1 pr-3">口座</th>
                <th className="py-1 pr-3 text-right">数量</th>
                <th className="py-1 pr-3 text-right">価格</th>
                <th className="py-1 pr-3">状態</th>
                <th className="py-1">操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <OrderRow key={order.id} order={order} expanded={expandedOrderId === order.id} onToggleDetails={onToggleDetails} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function OrderRow({
  order,
  expanded,
  onToggleDetails,
}: {
  order: SaxoApiOrderSnapshot;
  expanded: boolean;
  onToggleDetails: (id: string) => void;
}) {
  return (
    <>
      <tr className="border-b border-slate-100 align-top">
        <td className="py-2 pr-3">
          <div className="font-bold text-slate-950">{formatOrderLabel(order)}</div>
          <div className="mt-0.5 text-xs text-slate-500">{order.orderType ?? "注文種別未取得"} / {order.orderRelation ?? "関連注文未取得"}</div>
          {order.isExitCandidate ? <div className="mt-1 inline-block rounded bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800">Saxo側に設定あり</div> : null}
        </td>
        <td className="py-2 pr-3 text-xs font-semibold text-slate-700">{formatPositionAccount(order as unknown as SaxoApiPositionSnapshot)}</td>
        <td className="numeric-input py-2 pr-3 text-right">{formatMaybeValue(order.quantity)}</td>
        <td className="numeric-input py-2 pr-3 text-right">{formatMaybeValue(order.price ?? order.stopPrice, order.currency)}</td>
        <td className="py-2 pr-3 text-xs text-slate-700">{order.status ?? "未取得"}</td>
        <td className="py-2">
          <button className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-bold text-slate-700" onClick={() => onToggleDetails(order.id)}>
            <Eye size={13} />
            詳細を見る
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={6} className="px-3 py-2">
            <dl className="grid gap-1 text-xs text-slate-700 sm:grid-cols-3">
              <DraftRow label="Order ID" value={maskSaxoIdentifier(order.orderId)} />
              <DraftRow label="Account Key" value={maskSaxoIdentifier(order.accountKey)} />
              <DraftRow label="通貨" value={order.currency ?? "未取得"} />
              <DraftRow label="Stop price" value={formatMaybeValue(order.stopPrice, order.currency)} />
              <DraftRow label="Duration" value={order.duration ?? "未取得"} />
              <DraftRow label="未取得項目" value={order.missingFields.length > 0 ? order.missingFields.join(", ") : "なし"} />
            </dl>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function HistoryDiscoveryPreview({
  endpoints,
  fetchedAt,
  isLoading,
  historyDraft,
  reflectionStates,
  actionMessages,
  onLoad,
  onGoEntry,
  onGoClose,
  onGoAssignment,
  onClosePanel,
  onIgnoreHistoryCandidate,
  onUnignoreHistoryCandidate,
  onCreateDraftAndOpen,
  onCreateDrafts,
}: {
  endpoints: SaxoHistoryDiscoveryEndpoint[];
  fetchedAt: string;
  isLoading: boolean;
  historyDraft: SaxoHistoryDiscoveryItem | null;
  reflectionStates: Record<string, HistoryReflectionState>;
  actionMessages: Record<string, { tone: "success" | "error" | "info"; message: string }>;
  onLoad: () => void;
  onGoEntry: () => void;
  onGoClose: (sourceTradeId?: string) => void;
  onGoAssignment: (sourceTradeId?: string) => void;
  onClosePanel: () => void;
  onIgnoreHistoryCandidate: (item: SaxoHistoryDiscoveryItem) => void;
  onUnignoreHistoryCandidate: (item: SaxoHistoryDiscoveryItem) => void;
  onCreateDraftAndOpen: (item: SaxoHistoryDiscoveryItem) => boolean;
  onCreateDrafts: (items: SaxoHistoryDiscoveryItem[]) => void;
}) {
  const historyItems = endpoints.flatMap((endpoint) => endpoint.items ?? []);
  const actionableHistoryItems = historyItems.filter((item) => getSaxoHistoryCandidateTarget(item) !== "unknown");
  const isActualReflection = (item: SaxoHistoryDiscoveryItem) => {
    const state = reflectionStates[item.id];
    return state?.status === "candidate" || state?.status === "official";
  };
  const isPendingAssignmentReflection = (item: SaxoHistoryDiscoveryItem) => {
    const state = reflectionStates[item.id];
    return getSaxoHistoryCandidateTarget(item) === "assignment" && isActualReflection(item) && !isCompletedAssignmentReflection(state);
  };
  const creatableItems = actionableHistoryItems.filter((item) => {
    const state = reflectionStates[item.id] ?? { status: "none" as const };
    return state.status === "none";
  });
  const recoveryItems = actionableHistoryItems.filter((item) => reflectionStates[item.id]?.status === "broken");
  const hasCreatableItems = creatableItems.length > 0;
  const reflectedHistoryCount = actionableHistoryItems.filter(isActualReflection).length;
  const entryReflectedCount = historyItems.filter((item) => getSaxoHistoryCandidateTarget(item) === "entry" && isActualReflection(item)).length;
  const closeReflectedCount = historyItems.filter((item) => getSaxoHistoryCandidateTarget(item) === "close" && isActualReflection(item)).length;
  const assignmentReflectedCount = historyItems.filter(isPendingAssignmentReflection).length;
  const assignmentCompletedCount = historyItems.filter((item) => getSaxoHistoryCandidateTarget(item) === "assignment" && isCompletedAssignmentReflection(reflectionStates[item.id])).length;
  const assignmentImportantCount = historyItems.filter(
    (item) => {
      const state = reflectionStates[item.id] ?? { status: "none" as const };
      return (
        getSaxoHistoryCandidateTarget(item) === "assignment" &&
        findSaxoAssignmentStockAcquisitionItem(item, historyItems) &&
        !isCompletedAssignmentReflection(state) &&
        (state.status === "none" || state.status === "broken")
      );
    },
  ).length;
  const firstReflectedCloseItem = historyItems.find((item) => getSaxoHistoryCandidateTarget(item) === "close" && isActualReflection(item));
  const firstReflectedAssignmentItem = historyItems.find(isPendingAssignmentReflection);
  const brokenCount = recoveryItems.length;
  const ignoredCount = historyItems.filter((item) => reflectionStates[item.id]?.status === "ignored").length;
  const unknownCount = historyItems.filter((item) => getSaxoHistoryCandidateTarget(item) === "unknown").length;
  const statusLabel = !fetchedAt
    ? "未取得"
      : historyItems.length > 0 && actionableHistoryItems.length === 0
      ? "対象外または確認不要"
      : brokenCount > 0
        ? "監査用の復旧候補あり"
      : historyItems.length > 0 && !hasCreatableItems
        ? "反映候補作成済み"
        : "取得済み";
  const statusClass =
    statusLabel === "未取得"
      ? "bg-slate-100 text-slate-700"
      : statusLabel === "反映候補作成済み" || statusLabel === "対象外または確認不要"
        ? "bg-teal-100 text-teal-800"
        : statusLabel === "監査用の復旧候補あり"
          ? "bg-amber-100 text-amber-800"
        : "bg-blue-100 text-blue-800";

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-950">履歴候補</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            履歴系endpointから、建玉開始確認・決済実績へ流し込む候補を確認します。正式保存や現金残高反映は行いません。
          </p>
        </div>
        <span className={`rounded px-2 py-1 text-xs font-bold ${statusClass}`}>{statusLabel}</span>
      </div>
      <p className="mt-2 text-xs text-slate-500">最終確認: {fetchedAt ? new Date(fetchedAt).toLocaleString("ja-JP") : "未確認"}</p>
      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        {!fetchedAt ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm leading-6 text-slate-700">
              履歴候補は未取得です。Saxo履歴を取得すると、建玉開始確認や決済実績に使える候補を表示します。
            </p>
            <button
              type="button"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onLoad}
              disabled={isLoading}
            >
              履歴候補を取得
            </button>
          </div>
        ) : historyItems.length > 0 && hasCreatableItems ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm leading-6 text-slate-700">
              {assignmentImportantCount > 0 ? (
                <div className="mb-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-950">
                  <div className="font-bold">重要: P売り権利行使候補 {assignmentImportantCount}件</div>
                  <div>推奨アクション: 6-Aへ進む</div>
                </div>
              ) : null}
              <p>
                履歴候補があります。必要な候補を確認し、反映候補を作成してください。
                {brokenCount > 0 ? ` 監査用の復旧候補が${brokenCount}件あります。通常の未入力候補とは分けて確認します。` : ""}
                {unknownCount > 0 ? ` 対象外または確認不要の履歴候補が${unknownCount}件あります。Stock履歴は通常の3-A/7候補として自動反映しません。` : ""}
                {ignoredCount > 0 ? ` 無視済みの履歴候補が${ignoredCount}件あります。` : ""}
              </p>
            </div>
            <button
              type="button"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white"
              onClick={() => onCreateDrafts(creatableItems)}
            >
              不足している反映候補をまとめて作成
            </button>
          </div>
        ) : historyItems.length > 0 && actionableHistoryItems.length > 0 ? (
          <div className="grid gap-3">
            <p className="text-sm leading-6 text-slate-700">
              {brokenCount > 0
                ? "監査用の復旧候補があります。通常の未入力候補とは分けて表示しています。必要な場合だけ各行から再作成してください。"
                : "履歴候補から反映候補を作成済みです。建玉開始の履歴は3-A、通常決済の履歴は7、P売り権利行使の履歴は6-A 現物株の取得記録で確認してください。"}
            </p>
            {!hasCreatableItems ? (
              <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-bold text-teal-900">
                追加で作成が必要な履歴候補はありません。
              </div>
            ) : null}
            <div className="grid gap-2 text-xs font-semibold text-slate-700 sm:grid-cols-2">
              <div className="rounded bg-white px-3 py-2">反映済み: {reflectedHistoryCount}件</div>
              <div className="rounded bg-white px-3 py-2">対象外または確認不要: {unknownCount}件</div>
              <div className="rounded bg-white px-3 py-2 sm:col-span-2">追加で作成が必要: {creatableItems.length}件</div>
              <div className="rounded bg-white px-3 py-2">建玉開始の確認待ち: {entryReflectedCount}件</div>
              <div className="rounded bg-white px-3 py-2">決済実績の確認待ち: {closeReflectedCount}件</div>
              <div className="rounded bg-white px-3 py-2 sm:col-span-2">権利行使・株式取得の確認待ち: {assignmentReflectedCount}件</div>
              {assignmentCompletedCount > 0 ? <div className="rounded bg-white px-3 py-2 sm:col-span-2">権利行使・株式取得の確認済み: {assignmentCompletedCount}件</div> : null}
              {brokenCount > 0 ? <div className="rounded bg-white px-3 py-2 sm:col-span-2">監査用の復旧候補: {brokenCount}件（候補実体が見つかりません。必要な場合だけ行ごとに再作成します）</div> : null}
              {ignoredCount > 0 ? <div className="rounded bg-white px-3 py-2 sm:col-span-2">無視済み: {ignoredCount}件（復旧対象から除外）</div> : null}
              {unknownCount > 0 ? <div className="rounded bg-white px-3 py-2 sm:col-span-2">対象外または確認不要: {unknownCount}件（Stock履歴など。通常の3-A/7には自動反映しません）</div> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {entryReflectedCount > 0 ? (
                <button type="button" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white" onClick={onGoEntry}>
                  建玉開始確認へ移動（{entryReflectedCount}件）
                </button>
              ) : null}
              {closeReflectedCount > 0 ? (
                <button type="button" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white" onClick={() => onGoClose(firstReflectedCloseItem?.id)}>
                  決済実績へ移動（{closeReflectedCount}件）
                </button>
              ) : null}
              {assignmentReflectedCount > 0 ? (
                <button type="button" className="rounded-md bg-red-600 px-3 py-2 text-sm font-bold text-white" onClick={() => onGoAssignment(firstReflectedAssignmentItem?.id)}>
                  6-A 現物株取得へ移動（{assignmentReflectedCount}件）
                </button>
              ) : null}
              <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800" onClick={onClosePanel}>
                閉じる
              </button>
            </div>
          </div>
        ) : historyItems.length > 0 ? (
          <div className="rounded-md border border-teal-200 bg-teal-50 p-3 text-sm leading-6 text-teal-950">
            <div className="font-bold">追加で作成が必要な履歴候補はありません。</div>
            <div className="mt-1">
              取得済みの履歴は、Stock履歴など通常の3-A建玉開始確認・7決済実績へ流さない対象外または確認不要の候補です。必要な場合だけSaxo画面を確認し、手入力で補足してください。
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm leading-6 text-slate-700">
              履歴候補は取得済みですが、建玉開始確認や決済実績に使える候補はありませんでした。
            </p>
            <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800" onClick={onLoad} disabled={isLoading}>
              履歴候補を再取得
            </button>
          </div>
        )}
      </div>
      <div className="mt-3 grid gap-2">
        {endpoints.length === 0 ? (
          <p className="text-sm text-slate-500">Saxo接続後に履歴候補を取得してください。</p>
        ) : (
          endpoints.map((endpoint) => {
            const endpointItems = endpoint.items ?? [];
            const endpointReflectedCount = endpointItems.filter(isActualReflection).length;
            const endpointBrokenCount = endpointItems.filter((item) => reflectionStates[item.id]?.status === "broken").length;
            const endpointStatus =
              endpointBrokenCount > 0
                ? "監査用の復旧候補あり"
                :
              endpointItems.length > 0 && endpointReflectedCount === endpointItems.length
                ? "反映候補作成済み"
                : endpointItems.length > 0
                  ? "取得済み"
                  : "取得済み";
            return (
            <div key={endpoint.endpoint} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold text-slate-950">{endpoint.label}</div>
                <span className="rounded bg-white px-2 py-1 text-xs font-bold text-slate-700">{endpointStatus}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">{endpoint.endpoint} / 候補 {endpoint.itemCount}件</div>
              <p className="mt-1 text-xs leading-5 text-slate-600">{endpoint.message}</p>
              {endpoint.items && endpoint.items.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {sortHistoryCandidatesForDisplay(endpoint.items).slice(0, 5).map((item) => (
                    <HistoryCandidateRow
                      key={item.id}
                      item={item}
                      hasAssignmentStockItem={Boolean(findSaxoAssignmentStockAcquisitionItem(item, historyItems))}
                      reflectionState={reflectionStates[item.id] ?? { status: "none" }}
                      actionMessage={actionMessages[getSaxoHistoryStableKey(item)]}
                      onGoTarget={
                        getSaxoHistoryCandidateTarget(item) === "close"
                          ? () => onGoClose(item.id)
                          : getSaxoHistoryCandidateTarget(item) === "assignment"
                            ? () => onCreateDraftAndOpen(item)
                          : getSaxoHistoryCandidateTarget(item) === "entry"
                            ? onGoEntry
                            : () => undefined
                      }
                      onCreateDraftAndOpen={onCreateDraftAndOpen}
                      onIgnore={() => onIgnoreHistoryCandidate(item)}
                      onUnignore={() => onUnignoreHistoryCandidate(item)}
                    />
                  ))}
                  {endpoint.items.length > 5 ? (
                    <p className="text-xs text-slate-500">ほか {endpoint.items.length - 5}件。正式保存はしていません。</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
          })
        )}
      </div>
      {historyDraft ? (
        <div className="mt-3 rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-bold">
              {getSaxoHistoryCandidateTarget(historyDraft) === "close"
                ? "決済実績への反映候補"
                : getSaxoHistoryCandidateTarget(historyDraft) === "assignment"
                  ? "権利行使・現物株取得への反映候補"
                : getSaxoHistoryCandidateTarget(historyDraft) === "entry"
                  ? "建玉開始の約定確認への反映候補"
                  : "要確認の履歴候補"}
            </h4>
            <span className="rounded bg-white px-2 py-1 text-xs font-bold text-teal-800">正式保存前</span>
          </div>
          <p className="mt-1 text-xs leading-5">
            API履歴の取引ID、日付、価格、数量を二重反映防止キーとして保持しました。Saxo実現損益、記帳額、取引費用、為替など未取得の項目は手入力で補完してください。
          </p>
          <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
            <DraftRow label="日付" value={historyDraft.tradeDate ?? "未取得"} />
            <DraftRow label="銘柄" value={historyDraft.symbol ?? "未取得"} />
            <DraftRow label="売買" value={formatHistorySide(historyDraft)} />
            <DraftRow label="数量" value={formatMaybeValue(historyDraft.quantity)} />
            <DraftRow label="価格" value={formatMaybeValue(historyDraft.price, historyDraft.currency)} />
            <DraftRow label="損益" value={formatMaybeValue(historyDraft.profitLoss, historyDraft.currency)} />
          </dl>
        </div>
      ) : null}
      <div className="mt-3 flex justify-end">
        <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-800" onClick={onClosePanel}>
          閉じる
        </button>
      </div>
    </div>
  );
}

function HistoryCandidateRow({
  item,
  hasAssignmentStockItem,
  reflectionState,
  actionMessage,
  onGoTarget,
  onCreateDraftAndOpen,
  onIgnore,
  onUnignore,
}: {
  item: SaxoHistoryDiscoveryItem;
  hasAssignmentStockItem: boolean;
  reflectionState: HistoryReflectionState;
  actionMessage?: { tone: "success" | "error" | "info"; message: string };
  onGoTarget: () => void;
  onCreateDraftAndOpen: (item: SaxoHistoryDiscoveryItem) => boolean;
  onIgnore: () => void;
  onUnignore: () => void;
}) {
  const target = getSaxoHistoryCandidateTarget(item);
  const isAssignmentCompleted = target === "assignment" && isCompletedAssignmentReflection(reflectionState);
  const isAssignmentTransferred = target === "assignment" && isTransferredAssignmentReflection(reflectionState);
  const isPriorityAssignment =
    target === "assignment" &&
    hasAssignmentStockItem &&
    !isAssignmentCompleted &&
    (reflectionState.status === "none" || reflectionState.status === "broken");
  const labelParts = [
    item.tradeDate ?? "日付未取得",
    item.symbol ?? "銘柄未取得",
    item.assetType ?? "商品種別未取得",
    item.buySell ? (item.buySell === "buy" ? "買" : item.buySell === "sell" ? "売" : "売買不明") : "売買不明",
    item.openClose ? (item.openClose === "open" ? "建玉" : item.openClose === "close" ? "決済" : "新規/決済不明") : "新規/決済不明",
    item.quantity !== undefined ? `${formatNumber(item.quantity)}単位` : "数量未取得",
    item.price !== undefined ? `価格 ${formatNumber(item.price)}` : "価格未取得",
  ];
  const pnl =
    item.profitLoss !== undefined
      ? `損益 ${formatMaybeValue(item.profitLoss, item.currency)}`
      : item.profitLossBase !== undefined
        ? `損益 ${formatNumber(item.profitLossBase)}`
        : "損益未取得";
  return (
    <div className={`rounded border px-2 py-1 text-xs text-slate-700 ${isPriorityAssignment ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}>
      {isPriorityAssignment ? (
        <div className="mb-2 rounded-md border border-red-300 bg-white px-2 py-1.5 text-red-950">
          <div className="font-bold">重要: P売り権利行使候補</div>
          <div className="mt-0.5 font-semibold">推奨アクション: 6-Aへ進む</div>
          <p className="mt-1 leading-5">
            この履歴は価格0のPut買い決済です。通常の買戻しではなく、P売り権利行使として扱います。
            対応する現物株100株の買付履歴が見つかったため、6-A現物株取得へ進みます。
          </p>
        </div>
      ) : null}
      <div className="font-semibold text-slate-900">{labelParts.join(" / ")}</div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-slate-500">
          {pnl} / {getHistoryCandidateTargetLabel(item)} / 移動先: {getHistoryCandidateDestinationLabel(item)}
          {item.sourceIdMasked ? ` / ID ${item.sourceIdMasked}` : ""}
        </div>
        {target === "unknown" ? (
          <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs leading-5 text-amber-950">
            <div className="font-bold">要確認</div>
            <div>建玉開始か決済かを判定できないため、自動反映候補は作成しません。</div>
          </div>
        ) : reflectionState.status === "candidate" || reflectionState.status === "official" ? (
          <div className="rounded border border-teal-200 bg-teal-50 px-2 py-1 text-xs leading-5 text-teal-900">
            <div className="font-bold">{reflectionState.status === "official" ? "反映済み" : "反映候補作成済み"}</div>
            <div>
              {isAssignmentTransferred
                ? "P→N移管済み / N口座で株式保有中です。赤い反映待ち候補としては扱いません。"
                : isAssignmentCompleted
                  ? "6-A確認済み / 現物株取得反映済みです。追加の6-A確認は不要です。"
                : reflectionState.status === "official"
                  ? "正式保存済みです。重複作成は不要です。"
                : target === "assignment"
                  ? "6-Aで現物株取得を確認してください。通常の買戻し決済としては扱いません。"
                  : `${getHistoryCandidateDestinationLabel(item)}で確認してください`}
            </div>
            {!isAssignmentCompleted ? (
              <button
                type="button"
                className={`mt-1 rounded border px-2 py-0.5 text-xs font-bold ${
                  target === "assignment"
                    ? "border-red-300 bg-red-600 text-white"
                    : "border-teal-300 bg-white text-teal-900"
                }`}
                onClick={onGoTarget}
              >
                {target === "assignment" ? "推奨: 6-Aで現物株取得を確認" : target === "close" ? "この履歴を決済実績で確認" : "この履歴を3-Aで確認"}
              </button>
            ) : null}
          </div>
        ) : reflectionState.status === "broken" ? (
          <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs leading-5 text-amber-950">
            <div className="font-bold">監査用の復旧候補です</div>
            <div>
              この履歴は反映候補の記録だけが残っています。実際の入力候補が見つからないため、必要な場合だけ再作成します。
            </div>
            <div className="mt-0.5 text-amber-800">{reflectionState.reason}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              <button
                type="button"
                className="rounded bg-amber-900 px-2 py-0.5 text-xs font-bold text-white"
                onClick={() => onCreateDraftAndOpen(item)}
              >
                {target === "assignment" ? "推奨: 権利行使候補を作成して6-Aへ進む" : target === "close" ? "決済実績候補を作成して7へ進む" : "建玉開始候補を作成して3-Aへ進む"}
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-bold text-slate-700"
                onClick={onIgnore}
              >
                今回は無視
              </button>
            </div>
          </div>
        ) : reflectionState.status === "ignored" ? (
          <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs leading-5 text-slate-700">
            <div className="font-bold">無視済み</div>
            <div>この履歴候補は復旧必要件数から除外されています。</div>
            <button
              type="button"
              className="mt-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-bold text-slate-700"
              onClick={onUnignore}
            >
              無視を取り消す
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-bold text-slate-700"
            onClick={() => onCreateDraftAndOpen(item)}
          >
            <FilePlus2 size={13} />
            {target === "assignment" ? "推奨: 権利行使候補を作成して6-Aへ進む" : target === "close" ? "決済実績候補を作成して7へ進む" : "建玉開始候補を作成して3-Aへ進む"}
          </button>
        )}
      </div>
      {actionMessage ? (
        <div
          className={`mt-2 rounded px-2 py-1 text-xs leading-5 ${
            actionMessage.tone === "success"
              ? "border border-teal-200 bg-teal-50 text-teal-950"
              : actionMessage.tone === "error"
                ? "border border-rose-200 bg-rose-50 text-rose-950"
                : "border border-slate-200 bg-slate-50 text-slate-700"
          }`}
        >
          {actionMessage.message}
        </div>
      ) : null}
    </div>
  );
}

function sortHistoryCandidatesForDisplay(items: SaxoHistoryDiscoveryItem[]): SaxoHistoryDiscoveryItem[] {
  return [...items].sort((a, b) => getHistoryDisplayPriority(a) - getHistoryDisplayPriority(b));
}

function getHistoryDisplayPriority(item: SaxoHistoryDiscoveryItem): number {
  const target = getSaxoHistoryCandidateTarget(item);
  if (target === "assignment") return 0;
  if (target === "close") return 1;
  if (target === "entry") return 2;
  return 3;
}

function getHistoryCandidateTargetLabel(item: SaxoHistoryDiscoveryItem): string {
  const target = getSaxoHistoryCandidateTarget(item);
  if (target === "unknown") return "要確認";
  if (target === "assignment") return "権利行使履歴";
  return target === "close" ? "決済履歴" : "建玉開始履歴";
}

function getHistoryCandidateDestinationLabel(item: SaxoHistoryDiscoveryItem): string {
  const target = getSaxoHistoryCandidateTarget(item);
  if (target === "unknown") return "自動反映なし";
  if (target === "assignment") return "6-A. 現物株の取得記録";
  return target === "close" ? "7. 決済実績" : "3-A. 建玉開始の約定確認";
}

function getHistoryCandidateAnchorId(item: SaxoHistoryDiscoveryItem): "option-entry-executions" | "option-close-executions" | "stock-acquisition-record" {
  const target = getSaxoHistoryCandidateTarget(item);
  if (target === "assignment") return "stock-acquisition-record";
  return target === "close" ? "option-close-executions" : "option-entry-executions";
}

function PositionRow({
  row,
  linkedResolution,
  expanded,
  highlighted,
  onToggleDetails,
  onIgnore,
  onLink,
  onLinkExisting,
  onRepairLink,
  onOpenLinked,
  onCreateDraft,
  onCreateDraftFromBroken,
  drafted,
  actionError,
  actionNotice,
  historyMatchCount,
}: {
  row: SaxoPositionReconciliationRow;
  linkedResolution: LinkedSimulationResolution;
  expanded: boolean;
  highlighted: boolean;
  onToggleDetails: (id: string) => void;
  onIgnore: (position: SaxoApiPositionSnapshot) => void;
  onLink: (row: SaxoPositionReconciliationRow) => void;
  onLinkExisting: (row: SaxoPositionReconciliationRow) => void;
  onRepairLink: (row: SaxoPositionReconciliationRow) => void;
  onOpenLinked: (row: SaxoPositionReconciliationRow, anchorId?: string) => void;
  onCreateDraft: (position: SaxoApiPositionSnapshot) => void;
  onCreateDraftFromBroken: (position: SaxoApiPositionSnapshot) => void;
  drafted: boolean;
  actionError?: string;
  actionNotice?: string;
  historyMatchCount: number;
}) {
  const position = row.position;
  const label = position
    ? formatPositionLabel(position)
    : row.leg && row.simulation
      ? `${row.simulation.ticker} ${row.leg.type.toUpperCase()} ${row.leg.strikeUSD} / ${row.leg.expiryDate}`
      : "判定不可";
  const isNewCandidate = row.status === "app_missing";
  const isExistingCandidate = row.status === "matched";
  const isReviewCandidate = row.status === "quantity_diff" || row.status === "price_diff" || row.status === "unknown";
  const linkStatus = linkedResolution.status;
  const linkedNeedsEntryConfirmation = linkedResolution.status === "linked" ? needsOptionEntryConfirmation(linkedResolution.simulation) : true;
  const canCreateDraft = Boolean(position && position.accountAssignment === "P" || position && position.accountAssignment === "N");
  const createDraftLabel = isNewCandidate ? "建玉入力へ下書き反映" : "新規建玉として下書き作成";
  const linkReviewLabel = isReviewCandidate ? "候補を選んで紐づける" : "既存建玉に紐づける";
  const currentPositionInfo = position
    ? [
        ["口座割当", formatPositionAccount(position)],
        ["数量", formatMaybeValue(position.quantity)],
        ["売買方向", position.side],
        ["Put/Call", position.optionType ?? "未取得"],
        ["権利行使価格", formatMaybeValue(position.strike, "USD")],
        ["満期日", position.expiry ?? "未取得"],
        ["建て価格", formatMaybeValue(position.premiumOpenPrice, position.currency)],
        ["Position ID", maskSaxoIdentifier(position.positionId)],
        ["Account Key", maskSaxoIdentifier(position.accountKey)],
      ]
    : [];
  const inputUsableInfo = position
    ? [
        ["口座区分", formatPositionAccount(position)],
        ["数量", formatMaybeValue(position.quantity)],
        ["売買方向", position.side],
        ["Put/Call", position.optionType ?? "未取得"],
        ["権利行使価格", formatMaybeValue(position.strike, "USD")],
        ["満期日", position.expiry ?? "未取得"],
        ["建て価格", formatMaybeValue(position.premiumOpenPrice, position.currency)],
      ]
    : [];
  const historyRequiredInfo =
    position?.accountAssignment === "N"
      ? ["プレミアムUSD", "取引費用USD", "USD実績値"]
      : ["記帳額JPY", "プレミアムJPY", "取引費用JPY", "為替レート"];
  const actionButtons = position ? (
    <div className="flex min-w-[260px] flex-wrap gap-1">
      {linkStatus === "linked" ? (
        <>
          <button
            className="inline-flex items-center gap-1 rounded border border-teal-600 bg-teal-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-700"
            onClick={() => onOpenLinked(row, "option-entry-executions")}
          >
            <CheckCircle2 size={13} />
            {linkedNeedsEntryConfirmation ? "既存建玉の3-A約定確認へ進む（推奨）" : "確認済みの3-Aを開く"}
          </button>
          <button className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-bold text-slate-700" onClick={() => onToggleDetails(position.id)}>
            <Eye size={13} />
            詳細を見る
          </button>
        </>
      ) : linkStatus === "broken" ? (
        <>
          <button className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-bold text-slate-700" onClick={() => onToggleDetails(position.id)}>
            <Eye size={13} />
            詳細を見る
          </button>
          <button className="inline-flex items-center gap-1 rounded border border-amber-300 px-2 py-1 text-xs font-bold text-amber-800" onClick={() => onLink(row)}>
            <Link2 size={13} />
            既存建玉候補を確認
          </button>
          <button className="inline-flex items-center gap-1 rounded border border-orange-300 px-2 py-1 text-xs font-bold text-orange-800" onClick={() => onRepairLink(row)}>
            <RefreshCw size={13} />
            紐づけをやり直す
          </button>
          <button
            className="inline-flex items-center gap-1 rounded border border-teal-300 bg-teal-50 px-2 py-1 text-xs font-bold text-teal-800"
            onClick={() => onCreateDraftFromBroken(position)}
          >
            <FilePlus2 size={13} />
            新規下書きとして作成して3-Aへ進む
          </button>
        </>
      ) : isExistingCandidate && row.simulation ? (
        <>
          <button className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-bold text-slate-700" onClick={() => onToggleDetails(position.id)}>
            <Eye size={13} />
            詳細を見る
          </button>
          <button
            className="inline-flex items-center gap-1 rounded border border-emerald-300 px-2 py-1 text-xs font-bold text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => onLinkExisting(row)}
          >
            <Link2 size={13} />
            既存建玉に紐づける
          </button>
        </>
      ) : null}
      {linkStatus === "unlinked" && isReviewCandidate ? (
        <>
          <button className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-bold text-slate-700" onClick={() => onToggleDetails(position.id)}>
            <Eye size={13} />
            詳細を見る
          </button>
          <button className="inline-flex items-center gap-1 rounded border border-amber-300 px-2 py-1 text-xs font-bold text-amber-800" onClick={() => onLink(row)}>
            <Link2 size={13} />
            {linkReviewLabel}
          </button>
        </>
      ) : null}
      {linkStatus === "unlinked" && position ? (
        <button
          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => onCreateDraft(position)}
          disabled={drafted || !canCreateDraft}
        >
          <FilePlus2 size={13} />
          {drafted ? "下書き反映済み" : createDraftLabel}
        </button>
      ) : null}
      {linkStatus === "unlinked" && !isReviewCandidate && !(isExistingCandidate && row.simulation) ? (
        <button className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-bold text-slate-700" onClick={() => onToggleDetails(position.id)}>
          <Eye size={13} />
          詳細を見る
        </button>
      ) : null}
      <button className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-bold text-slate-700" onClick={() => onIgnore(position)}>
        <Ban size={13} />
        今回は無視
      </button>
    </div>
  ) : (
    <div className="text-xs text-slate-500">Saxo建玉候補がないため操作できません。</div>
  );
  return (
    <>
      <tr className={`border-b border-slate-100 align-top ${highlighted ? "bg-teal-50" : ""}`}>
        <td className="py-2 pr-3">
          <div className="font-bold text-slate-950">{label}</div>
          <div className="mt-0.5 text-xs text-slate-500">{position?.assetType ?? row.simulation?.name ?? "Saxo側に見つからない"}</div>
        </td>
        <td className="py-2 pr-3 text-xs font-semibold text-slate-700">{formatPositionAccount(position)}</td>
        <td className="numeric-input py-2 pr-3 text-right">{formatMaybeValue(position?.quantity ?? row.leg?.quantity)}</td>
        <td className="numeric-input py-2 pr-3 text-right">{formatMaybeValue(position?.currentPrice ?? position?.currentOptionPrice, position?.currency)}</td>
        <td className="numeric-input py-2 pr-3 text-right">{formatMaybeValue(position?.unrealizedPnl, position?.unrealizedPnlCurrency)}</td>
        <td className="py-2 pr-3">
          <span className={`rounded px-2 py-1 text-xs font-bold ${getMatchStatusClass(row.status)}`}>{getMatchStatusLabel(row.status)}</span>
          <p className="mt-1 max-w-[280px] text-xs leading-5 text-slate-500">{row.detail}</p>
          {row.simulation && position && linkStatus !== "linked" ? (
            <p className="mt-1 max-w-[280px] rounded bg-amber-50 px-2 py-1 text-xs leading-5 text-amber-800">
              既存建玉と一致候補があります。内容を確認して、既存建玉へ反映するか、新規下書きとして扱うか選んでください。
            </p>
          ) : null}
          {linkStatus === "linked" ? (
            <div className="mt-1 max-w-[320px] rounded border border-emerald-200 bg-emerald-50 px-2 py-2 text-xs leading-5 text-emerald-900">
              <div className="font-bold text-emerald-950">既存建玉と一致しています</div>
              <p className="mt-1">
                このSaxo建玉は、すでにアプリ内の建玉に紐づいています。新規作成は不要です。
                {linkedNeedsEntryConfirmation
                  ? "次に、既存建玉の約定確認を完了してください。"
                  : "建玉開始の約定確認は完了済みです。必要に応じて確認済みの3-Aを開けます。"}
              </p>
            </div>
          ) : null}
          {linkStatus === "broken" ? (
            <div className="mt-1 max-w-[320px] rounded bg-orange-50 px-2 py-1 text-xs font-semibold leading-5 text-orange-800">
              <p>
                紐づけ先が見つかりません。既存建玉を選び直してください。
                {linkedResolution.reason ? ` ${linkedResolution.reason}` : ""}
              </p>
              {!row.simulation && position ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-teal-300 bg-white px-2 py-1 text-xs font-bold text-teal-800"
                    onClick={() => onCreateDraftFromBroken(position)}
                  >
                    <FilePlus2 size={13} />
                    新規下書きとして作成して3-Aへ進む
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700"
                    onClick={() => onIgnore(position)}
                  >
                    <Ban size={13} />
                    今回は無視
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {actionError ? (
            <p className="mt-1 max-w-[280px] rounded bg-rose-50 px-2 py-1 text-xs font-semibold leading-5 text-rose-800">
              {actionError}
            </p>
          ) : null}
          {actionNotice ? (
            <p className="mt-1 max-w-[280px] rounded bg-teal-50 px-2 py-1 text-xs font-semibold leading-5 text-teal-800">
              {actionNotice}
            </p>
          ) : null}
          {position && historyMatchCount > 0 ? (
            <p className="mt-1 text-xs font-semibold text-teal-700">建玉開始の履歴補完候補 {historyMatchCount}件</p>
          ) : null}
        </td>
        <td className="py-2">
          {actionButtons}
        </td>
      </tr>
      {position && expanded ? (
        <tr className={`border-b border-slate-100 ${highlighted ? "bg-teal-50" : "bg-slate-50"}`}>
          <td colSpan={7} className="px-3 py-2">
            <div className="grid gap-3 text-xs text-slate-700 lg:grid-cols-3">
              <div className="rounded-md border border-slate-200 bg-white p-2">
                <h4 className="font-bold text-slate-800">Saxo現在建玉から取得できた情報</h4>
                <dl className="mt-2 grid gap-1">
                  {currentPositionInfo.map(([labelText, value]) => (
                    <DraftRow key={labelText} label={labelText} value={value} />
                  ))}
                </dl>
              </div>
              <div className="rounded-md border border-teal-200 bg-teal-50 p-2">
                <h4 className="font-bold text-teal-900">建玉入力に使える情報</h4>
                <dl className="mt-2 grid gap-1">
                  {inputUsableInfo.map(([labelText, value]) => (
                    <DraftRow key={labelText} label={labelText} value={value} />
                  ))}
                </dl>
                <p className="mt-2 rounded bg-white/70 px-2 py-1 text-[11px] leading-5 text-teal-900">
                  建玉入力に使える最低限の情報は取得済みです。約定実績の金額はSaxo取引履歴で補完するか、手入力してください。
                </p>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
                <h4 className="font-bold text-amber-900">取引履歴または手入力が必要な情報</h4>
                <p className="mt-2 leading-5 text-amber-900">{historyRequiredInfo.join("、")}</p>
                <p className="mt-2 rounded bg-white/70 px-2 py-1 text-[11px] leading-5 text-amber-900">
                  これらは現在建玉APIではなく、Saxo取引履歴APIから補完します。取引履歴APIでも取得できない場合は要手入力として、Saxo画面の取引履歴を見て入力してください。
                </p>
              </div>
            </div>
            <div className="mt-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
              <div className="font-bold text-slate-800">未取得項目の意味</div>
              <p className="mt-1">
                {position.missingFields.length > 0 ? position.missingFields.join("、") : "未取得項目はありません。"}
              </p>
              <p className="mt-1">
                `現在値 未取得`、`評価損益 未取得`、`Contract size 未取得` などは、Saxo現在建玉APIでは未取得という意味です。建玉入力に最低限必要な項目ではありません。反対売買判断や評価損益確認には、別途価格取得またはSaxo画面確認が必要です。
              </p>
            </div>
            <div className="mt-3 border-t border-slate-200 pt-2">
              <p className="mb-2 text-xs font-semibold text-slate-600">候補を確認した後、次の操作を選んでください。</p>
              {actionButtons}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[11px] font-bold text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-bold text-slate-950">{value}</div>
    </div>
  );
}

function DraftRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 rounded bg-white/70 px-2 py-1">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-950">{value}</dd>
    </div>
  );
}

function formatPositionLabel(position: SaxoApiPositionSnapshot): string {
  if (position.kind === "option") {
    return `${position.symbol ?? "未取得"} ${position.optionType === "call" ? "C" : position.optionType === "put" ? "P" : "?"} ${position.strike ?? "?"} / ${position.expiry ?? "満期未取得"} / ${position.side}`;
  }
  if (position.kind === "stock") {
    return `${position.symbol ?? "未取得"} / 株式`;
  }
  return `${position.symbol ?? "未取得"} / ${position.assetType ?? "種別未取得"}`;
}

function getSaxoStockShares(position: SaxoApiPositionSnapshot): number {
  const value = position.shareQuantity ?? position.quantity;
  return value !== undefined && Number.isFinite(value) ? Math.abs(value) : 0;
}

function getSaxoStockAveragePrice(position: SaxoApiPositionSnapshot): number | undefined {
  const value = position.averageOpenPrice ?? position.currentStockPrice ?? position.currentPrice;
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function normalizeStockTicker(value?: string): string {
  if (!value) return "";
  const normalized = value.trim().toUpperCase();
  const saxoOptionMatch = normalized.match(/^([A-Z.]+)\//);
  if (saxoOptionMatch?.[1]) return saxoOptionMatch[1];
  return normalized.replace(/[^A-Z.]/g, "");
}

function isNAccountStockPosition(position?: SaxoApiPositionSnapshot): boolean {
  return Boolean(position && position.kind === "stock" && position.accountAssignment === "N" && getSaxoStockShares(position) > 0);
}

function hasAutoAssignmentCorrelation(position: SaxoApiPositionSnapshot): boolean {
  try {
    return JSON.stringify(position.raw ?? {}).toLowerCase().includes("autoassignment");
  } catch {
    return false;
  }
}

function findPnTransferSourceSimulations(position: SaxoApiPositionSnapshot, simulations: TradeSimulation[]): TradeSimulation[] {
  const shares = getSaxoStockShares(position);
  const averagePrice = getSaxoStockAveragePrice(position);
  const positionTicker = normalizeStockTicker(position.symbol ?? position.underlyingName ?? position.instrumentCode);
  if (shares <= 0) return [];
  return simulations
    .filter((simulation) => {
      const acquisition = simulation.stockAcquisition;
      if (simulation.status !== "assigned") return false;
      if (simulation.accountEnvironment !== "PROD_P_JPY_SETTLEMENT") return false;
      if (!acquisition?.enabled) return false;
      if (acquisition.accountEnvironment !== "PROD_P_JPY_SETTLEMENT") return false;
      if (!Number.isFinite(acquisition.shares) || Math.abs(acquisition.shares - shares) > 0.0001) return false;
      if (averagePrice !== undefined && Number.isFinite(acquisition.priceUSD) && Math.abs(acquisition.priceUSD - averagePrice) > 0.05) {
        return false;
      }
      const simulationTicker = normalizeStockTicker(simulation.ticker);
      if (positionTicker && simulationTicker && positionTicker !== simulationTicker) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aDate = a.stockAcquisition?.acquisitionDate ?? "";
      const bDate = b.stockAcquisition?.acquisitionDate ?? "";
      return bDate.localeCompare(aDate);
    });
}

function formatNStockTransferCandidateLabel(position: SaxoApiPositionSnapshot, primaryMatch?: TradeSimulation): string {
  const ticker = normalizeStockTicker(position.symbol) || primaryMatch?.ticker || position.underlyingName || "銘柄未取得";
  const shares = getSaxoStockShares(position);
  const averagePrice = getSaxoStockAveragePrice(position);
  return `${ticker} ${formatMaybeValue(shares)}株 @ ${formatMaybeValue(averagePrice, "USD")} / N口座`;
}

function formatOrderLabel(order: SaxoApiOrderSnapshot): string {
  const option = order.optionType === "call" ? "C" : order.optionType === "put" ? "P" : "?";
  if (order.strike || order.expiry) {
    return `${order.symbol ?? "未取得"} ${option} ${order.strike ?? "?"} / ${order.expiry ?? "満期未取得"} / ${order.side ?? "unknown"}`;
  }
  return `${order.symbol ?? "未取得"} / ${order.side ?? "unknown"}`;
}

function formatHistorySide(item: SaxoHistoryDiscoveryItem): string {
  const target = getSaxoHistoryCandidateTarget(item);
  if (target === "assignment") return "買 / 権利行使候補";
  if (item.buySell === "buy") return target === "close" ? "買 / 決済候補" : "買 / 建玉開始候補";
  if (item.buySell === "sell") return target === "close" ? "売 / 決済候補" : "売 / 建玉開始候補";
  return "売買不明 / ユーザー確認";
}

function formatPositionAccount(position?: SaxoApiPositionSnapshot): string {
  if (!position) return "Saxo側なし";
  if (position.accountAssignment === "P" || position.accountAssignment === "N") return `${position.accountAssignment}口座`;
  if (position.accountAssignment === "ignored") return "使わない";
  return "未割当";
}

function getMatchStatusLabel(status: SaxoPositionReconciliationRow["status"]): string {
  switch (status) {
    case "matched":
      return "既存候補あり";
    case "quantity_diff":
    case "price_diff":
    case "unknown":
      return "要確認候補";
    case "app_missing":
      return "新規候補";
    case "saxo_missing":
      return "Saxo側に見つからない";
  }
}

function getMatchStatusClass(status: SaxoPositionReconciliationRow["status"]): string {
  switch (status) {
    case "matched":
      return "bg-emerald-100 text-emerald-800";
    case "quantity_diff":
    case "price_diff":
      return "bg-amber-100 text-amber-800";
    case "app_missing":
      return "bg-sky-100 text-sky-800";
    case "saxo_missing":
      return "bg-red-100 text-red-800";
    case "unknown":
      return "bg-slate-100 text-slate-700";
  }
}

function needsOptionEntryConfirmation(simulation: TradeSimulation): boolean {
  const executions = simulation.optionEntryExecutions ?? [];
  if (executions.length === 0) return true;
  return executions.some((execution) => {
    if (!execution.confirmed) return true;
    if (!execution.tradeDate || !Number.isFinite(execution.fillPriceUSD) || execution.fillPriceUSD <= 0) return true;
    if (!Number.isFinite(execution.contracts) || execution.contracts <= 0) return true;
    if (execution.settlementCurrency === "JPY") {
      return (
        execution.brokerBookedAmountJPY === undefined ||
        execution.brokerPremiumJPY === undefined ||
        execution.brokerTransactionCostJPY === undefined
      );
    }
    return execution.commissionUSD === undefined;
  });
}

function formatMaybeValue(value: number | undefined, currency?: string): string {
  if (value === undefined || !Number.isFinite(value)) return "未取得";
  if (currency === "JPY") return formatJPY(value);
  if (currency === "USD") return formatUSD(value);
  if (currency === "%") return formatPct(value);
  return formatNumber(value);
}

function formatDiff(currentValue: number | undefined, saxoValue: number | undefined, currency?: string): string {
  if (saxoValue === undefined || !Number.isFinite(saxoValue)) return "未取得";
  const diff = saxoValue - (currentValue ?? 0);
  if (currency === "JPY") return formatJPY(diff, { signed: true });
  if (currency === "USD") return `${diff > 0 ? "+" : ""}${formatUSD(diff)}`;
  if (currency === "%") return `${diff > 0 ? "+" : ""}${formatPct(diff)}`;
  return `${diff > 0 ? "+" : ""}${formatNumber(diff)}`;
}

function getMissingPositionDraftRequirements(position: SaxoApiPositionSnapshot): string[] {
  const missing: string[] = [];
  if (position.accountAssignment !== "P" && position.accountAssignment !== "N") missing.push("口座区分");
  if (!position.optionType) missing.push("Put/Call");
  if (position.strike === undefined || !Number.isFinite(position.strike)) missing.push("権利行使価格");
  if (!position.expiry) missing.push("満期日");
  if (position.quantity === undefined || !Number.isFinite(position.quantity) || position.quantity === 0) missing.push("数量");
  if (!position.side) missing.push("売買方向");
  return missing;
}

function getPositionDraftCreatedMessage(position: SaxoApiPositionSnapshot, simulations: TradeSimulation[] = []): string {
  const hasSymbol = Boolean(resolveSaxoPositionSymbol(position, simulations));
  return hasSymbol
    ? "Saxo建玉候補から3-Aの下書きを作成しました。約定履歴で補完できる項目を確認し、最後に『確認して正式保存する』を押してください。"
    : "Saxo建玉候補から3-Aの下書きを作成しました。銘柄は未取得のため、建玉入力の1.銘柄・価格で銘柄ティッカーを入力し、3-Aで約定確認を完了してください。";
}

function createHistoryReflectionStates(
  endpoints: SaxoHistoryDiscoveryEndpoint[],
  simulations: TradeSimulation[],
  reflectedHistoryIds: string[],
  ignoredHistoryIds: string[],
  stockTransfers: StockTransferEvent[],
): Record<string, HistoryReflectionState> {
  const states: Record<string, HistoryReflectionState> = {};
  const items = endpoints.flatMap((endpoint) => endpoint.items ?? []);
  for (const item of items) {
    const historyKeys = getSaxoHistoryCandidateKeys(item);
    const hasIgnoredKey = historyKeys.some((key) => ignoredHistoryIds.includes(key));
    const hasReflectedKey = historyKeys.some((key) => reflectedHistoryIds.includes(key));
    if (hasIgnoredKey) {
      states[item.id] = { status: "ignored" };
      continue;
    }
    const target = getSaxoHistoryCandidateTarget(item);
    if (target === "unknown") {
      states[item.id] = hasReflectedKey
        ? { status: "broken", target, reason: "過去の作成済みフラグはありますが、建玉開始か決済かを判定できないため候補実体を作成できません。" }
        : { status: "none" };
      continue;
    }
    const entryRecord = target === "entry"
      ? simulations.flatMap((simulation) =>
          simulation.optionLegs.flatMap((leg) =>
            (simulation.optionEntryExecutions ?? []).map((execution) => ({ simulation, leg, execution })),
          ),
        ).find(({ simulation, leg, execution }) =>
          (execution.historyCandidateIds ?? []).some((candidateId) => historyKeys.includes(candidateId)) ||
          isSaxoHistoryMatchingEntryExecution(simulation, leg, execution, item),
        )
      : undefined;
    if (entryRecord) {
      states[item.id] = {
        status: entryRecord.execution.confirmed ? "official" : "candidate",
        simulationId: entryRecord.simulation.id,
        recordId: entryRecord.execution.id,
        target,
      };
      continue;
    }
    const closeRecord = target === "close"
      ? simulations.flatMap((simulation) =>
          simulation.optionLegs.flatMap((leg) =>
            (simulation.optionCloseExecutions ?? []).map((execution) => ({ simulation, leg, execution })),
          ),
        ).find(({ simulation, leg, execution }) =>
          historyKeys.includes(execution.sourceCandidateId ?? "") ||
          historyKeys.includes(execution.sourceTradeId ?? "") ||
          isSaxoHistoryMatchingCloseExecution(simulation, leg, execution, item),
        )
      : undefined;
    if (closeRecord) {
      if (closeRecord.execution.confirmationStatus === "ignored") {
        states[item.id] = { status: "none" };
      } else if (closeRecord.execution.confirmationStatus === "invalid") {
        states[item.id] = {
          status: "broken",
          target,
          reason: closeRecord.execution.invalidReason ?? "決済実績候補はありますが、対象建玉または元履歴との照合に失敗しています。",
        };
      } else {
        states[item.id] = {
          status: closeRecord.execution.confirmed ? "official" : "candidate",
          simulationId: closeRecord.simulation.id,
          recordId: closeRecord.execution.id,
          target,
        };
      }
      continue;
    }
    const assignmentRecord = target === "assignment"
      ? simulations.find((simulation) => {
          const acquisition = simulation.stockAcquisition;
          if (!acquisition?.enabled) return false;
          return (
            historyKeys.includes(acquisition.sourceCandidateId ?? "") ||
            historyKeys.includes(acquisition.sourceTradeId ?? "") ||
            isSaxoHistoryMatchingStockAcquisition(simulation, acquisition, item)
          );
        })
      : undefined;
    if (assignmentRecord?.stockAcquisition) {
      const assignmentWorkflow = getAssignmentWorkflowState(assignmentRecord, stockTransfers);
      if (assignmentRecord.stockAcquisition.confirmationStatus === "ignored") {
        states[item.id] = { status: "none" };
      } else if (assignmentRecord.stockAcquisition.confirmationStatus === "invalid") {
        states[item.id] = {
          status: "broken",
          target,
          reason: "現物株取得候補はありますが、元Saxo履歴または対象建玉との照合に失敗しています。",
        };
      } else {
        states[item.id] = {
          status: assignmentWorkflow.completed ? "official" : "candidate",
          simulationId: assignmentRecord.id,
          recordId: assignmentRecord.stockAcquisition.sourceCandidateId ?? assignmentRecord.stockAcquisition.sourceTradeId ?? assignmentRecord.id,
          target,
          assignmentCompleted: assignmentWorkflow.completed,
          assignmentTransferred: assignmentWorkflow.transferred,
        };
      }
      continue;
    }
    states[item.id] = hasReflectedKey
      ? { status: "broken", target, reason: "作成済みフラグだけが残っており、対応する反映候補または正式保存済み実績が見つかりません。" }
      : { status: "none" };
  }
  return states;
}

function getAssignmentWorkflowState(
  simulation: TradeSimulation,
  stockTransfers: StockTransferEvent[],
): { completed: boolean; transferred: boolean } {
  const acquisition = simulation.stockAcquisition;
  const transferred = Boolean(findStockTransferForSimulation(simulation, stockTransfers));
  const completed =
    transferred ||
    acquisition?.confirmationStatus === "confirmed" ||
    isStockAcquisitionRequiredFieldsComplete(simulation);
  return { completed, transferred };
}

function isStockAcquisitionRequiredFieldsComplete(simulation: TradeSimulation): boolean {
  const acquisition = simulation.stockAcquisition;
  return Boolean(
    simulation.status === "assigned" &&
      acquisition?.enabled &&
      Number.isFinite(acquisition.shares) &&
      acquisition.shares > 0 &&
      Number.isFinite(acquisition.priceUSD) &&
      acquisition.priceUSD > 0,
  );
}

function findStockTransferForSimulation(
  simulation: TradeSimulation,
  stockTransfers: StockTransferEvent[],
): StockTransferEvent | undefined {
  const shares = simulation.stockPosition?.shares ?? simulation.stockAcquisition?.shares ?? 0;
  if (shares <= 0) return undefined;
  return stockTransfers.find(
    (transfer) =>
      transfer.sourceSimulationId === simulation.id &&
      transfer.toAccountCode === "N" &&
      Math.abs(transfer.shares - shares) <= 0.0001,
  );
}

function getRecordedStockTransferForPosition(
  position: SaxoApiPositionSnapshot,
  simulations: TradeSimulation[],
  stockTransfers: StockTransferEvent[],
): StockTransferEvent | undefined {
  const matches = findPnTransferSourceSimulations(position, simulations);
  const transferShares = getSaxoStockShares(position);
  if (transferShares <= 0) return undefined;
  return matches
    .map((simulation) =>
      stockTransfers.find(
        (transfer) =>
          transfer.sourceSimulationId === simulation.id &&
          transfer.toAccountCode === "N" &&
          Math.abs(transfer.shares - transferShares) <= 0.0001,
      ),
    )
    .find((transfer): transfer is StockTransferEvent => Boolean(transfer));
}

function isCompletedAssignmentReflection(state: HistoryReflectionState | undefined): boolean {
  if (!state || (state.status !== "candidate" && state.status !== "official")) return false;
  return state.target === "assignment" && (state.assignmentCompleted === true || state.status === "official");
}

function isTransferredAssignmentReflection(state: HistoryReflectionState | undefined): boolean {
  if (!state || (state.status !== "candidate" && state.status !== "official")) return false;
  return state.target === "assignment" && state.assignmentTransferred === true;
}

function createReflectionSummary({
  mappedSnapshots,
  accountInputs,
  positionRows,
  simulations,
  stockTransfers,
  orders,
  historyEndpoints,
  historyReflectionStates,
}: {
  mappedSnapshots: Array<{ accountCode: SaxoAccountCode; mapping?: SaxoAccountMapping; snapshot?: SaxoApiAccountSnapshot }>;
  accountInputs: AccountInputs;
  positionRows: SaxoPositionReconciliationRow[];
  simulations: TradeSimulation[];
  stockTransfers: StockTransferEvent[];
  orders: SaxoApiOrderSnapshot[];
  historyEndpoints: SaxoHistoryDiscoveryEndpoint[];
  historyReflectionStates: Record<string, HistoryReflectionState>;
}): ReflectionSummary {
  const accountLines = mappedSnapshots.map(({ accountCode, mapping, snapshot }) => {
    if (!mapping) {
      return {
        key: accountCode,
        label: `${accountCode}口座残高`,
        detail: "先にSaxo口座の割り当てが必要です。P/N口座を割り当てるまで、残高・建玉・履歴は正式反映できません。",
        actionable: true,
        actionLabel: "Saxo口座の割り当てへ",
        target: "mapping" as const,
      };
    }
    const rows = snapshot ? createSaxoAccountDiffRows(accountInputs[accountCode], snapshot) : [];
    const changed = rows.filter((row) => row.status === "changed").length;
    const missing = rows.filter((row) => row.status === "missing").length;
    return {
      key: accountCode,
      label: `${accountCode}口座残高`,
      detail: snapshot ? (changed > 0 ? `差分${changed}件` : missing > 0 ? `未取得${missing}件` : "差分なし") : "未取得",
      actionable: changed > 0,
      actionLabel: "確認して反映",
      target: "snapshot" as const,
    };
  });
  const stockTransferCandidateRows = positionRows.filter((row) => isNAccountStockPosition(row.position));
  const pendingStockTransferCandidateRows = stockTransferCandidateRows.filter(
    (row) => row.position && !getRecordedStockTransferForPosition(row.position, simulations, stockTransfers),
  );
  const recordedStockTransferCandidateRows = stockTransferCandidateRows.filter(
    (row) => row.position && getRecordedStockTransferForPosition(row.position, simulations, stockTransfers),
  );
  const regularPositionRows = positionRows.filter((row) => !isNAccountStockPosition(row.position));
  const stockTransferCandidates = pendingStockTransferCandidateRows.filter((row) =>
    row.position ? findPnTransferSourceSimulations(row.position, simulations).length > 0 : false,
  ).length;
  const newPositions = regularPositionRows.filter((row) => row.status === "app_missing").length;
  const matchedPositions = regularPositionRows.filter((row) => row.status === "matched").length;
  const unknownPositions = regularPositionRows.filter((row) => row.status === "unknown" || row.status === "quantity_diff" || row.status === "price_diff").length;
  const exitOrders = orders.filter((order) => order.isExitCandidate).length;
  const historyItems = historyEndpoints.flatMap((endpoint) => endpoint.items ?? []);
  const entryCandidates = historyItems.filter((item) => getSaxoHistoryCandidateTarget(item) === "entry").length;
  const closeCandidates = historyItems.filter((item) => getSaxoHistoryCandidateTarget(item) === "close").length;
  const assignmentCandidates = historyItems.filter((item) => getSaxoHistoryCandidateTarget(item) === "assignment").length;
  const unknownHistoryCandidates = historyItems.filter((item) => getSaxoHistoryCandidateTarget(item) === "unknown").length;
  const actionableHistoryItems = historyItems.filter((item) => getSaxoHistoryCandidateTarget(item) !== "unknown");
  const reflectedHistoryCount = actionableHistoryItems.filter((item) => {
    const state = historyReflectionStates[item.id];
    return state?.status === "candidate" || state?.status === "official";
  }).length;
  const brokenHistoryCount = historyItems.filter((item) => historyReflectionStates[item.id]?.status === "broken").length;
  const newCreatableHistoryItems = actionableHistoryItems.filter((item) => {
    const state = historyReflectionStates[item.id] ?? { status: "none" as const };
    return state.status === "none";
  });
  const recoveryHistoryItems = actionableHistoryItems.filter((item) => historyReflectionStates[item.id]?.status === "broken");
  const createNeededHistoryCount = newCreatableHistoryItems.length;
  const allHistoryReflected = actionableHistoryItems.length > 0 && reflectedHistoryCount === actionableHistoryItems.length;
  const anyHistoryReflected = reflectedHistoryCount > 0;
  const positionActionable = newPositions > 0 || matchedPositions > 0 || unknownPositions > 0 || pendingStockTransferCandidateRows.length > 0;
  const orderActionable = orders.length > 0;
  const historyActionable = createNeededHistoryCount > 0;
  return {
    accountLines,
    positionLine: {
      detail:
        positionRows.length === 0
          ? "未取得"
          : stockTransferCandidateRows.length > 0
            ? pendingStockTransferCandidateRows.length > 0
              ? `P→N移管候補${stockTransferCandidates}件${recordedStockTransferCandidateRows.length > 0 ? ` / 照合済み現在保有${recordedStockTransferCandidateRows.length}件` : ""}${regularPositionRows.length > 0 ? ` / 通常建玉候補${regularPositionRows.length}件` : ""}`
              : `照合済みの現在保有確認${recordedStockTransferCandidateRows.length}件${regularPositionRows.length > 0 ? ` / 通常建玉候補${regularPositionRows.length}件` : ""}`
            : `新規${newPositions}件 / 既存候補${matchedPositions}件 / 要確認${unknownPositions}件`,
      actionable: positionActionable,
    },
    orderLine: {
      detail: orders.length === 0 ? "0件" : `注文${orders.length}件 / 出口候補${exitOrders}件`,
      actionable: orderActionable,
    },
    historyLine: {
      detail:
        historyItems.length === 0
          ? "未取得または0件"
          : brokenHistoryCount > 0
            ? `監査用の復旧候補${recoveryHistoryItems.length}件 / 反映済み${reflectedHistoryCount}件 / 追加で作成が必要${createNeededHistoryCount}件${unknownHistoryCandidates > 0 ? ` / 対象外または確認不要${unknownHistoryCandidates}件` : ""}`
          : allHistoryReflected
            ? `反映済み${reflectedHistoryCount}件 / 対象外または確認不要${unknownHistoryCandidates}件 / 追加で作成が必要0件`
            : anyHistoryReflected
              ? `反映済み${reflectedHistoryCount}件 / 対象外または確認不要${unknownHistoryCandidates}件 / 追加で作成が必要${createNeededHistoryCount}件`
              : createNeededHistoryCount > 0
                ? `建玉${entryCandidates}件 / 決済${closeCandidates}件 / 権利行使${assignmentCandidates}件 / 追加で作成が必要${createNeededHistoryCount}件${unknownHistoryCandidates > 0 ? ` / 対象外または確認不要${unknownHistoryCandidates}件` : ""}`
                : `反映済み0件 / 対象外または確認不要${unknownHistoryCandidates}件 / 追加で作成が必要0件`,
      actionable: historyActionable,
      actionLabel: historyActionable
        ? brokenHistoryCount > 0
          ? "監査用の復旧候補を確認"
          : "履歴候補を確認"
        : "履歴候補は確認済み",
    },
    hasPending: accountLines.some((line) => line.actionable) || positionActionable || orderActionable || historyActionable,
  };
}

function loadMappings(): SaxoAccountMapping[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(SAXO_MAPPING_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SaxoAccountMapping[];
  } catch {
    return [];
  }
}

function saveMappings(mappings: SaxoAccountMapping[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SAXO_MAPPING_STORAGE_KEY, JSON.stringify(mappings));
}

function loadOnboardingChecks(): Record<SaxoOnboardingStepId, boolean> {
  const checks = SAXO_ONBOARDING_STEPS.reduce(
    (acc, step) => {
      acc[step.id] = false;
      return acc;
    },
    {} as Record<SaxoOnboardingStepId, boolean>,
  );
  if (typeof window === "undefined") return checks;
  const raw = window.localStorage.getItem(SAXO_ONBOARDING_CHECKS_KEY);
  if (!raw) return checks;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<SaxoOnboardingStepId, boolean>>;
    SAXO_ONBOARDING_STEPS.forEach((step) => {
      checks[step.id] = Boolean(parsed[step.id]);
    });
    return checks;
  } catch {
    return checks;
  }
}

function saveOnboardingChecks(checks: Record<SaxoOnboardingStepId, boolean>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SAXO_ONBOARDING_CHECKS_KEY, JSON.stringify(checks));
}

function detectLocalApiOs(): SaxoLocalApiOs {
  if (typeof window === "undefined") return "unknown";
  const platform = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "mac";
  return "unknown";
}

function loadLocalApiOs(): SaxoLocalApiOs {
  if (typeof window === "undefined") return "unknown";
  const raw = window.localStorage.getItem(SAXO_LOCAL_API_OS_KEY);
  if (raw === "mac" || raw === "windows" || raw === "unknown") return raw;
  return detectLocalApiOs();
}

function saveLocalApiOs(os: SaxoLocalApiOs): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SAXO_LOCAL_API_OS_KEY, os);
}

function loadLocalApiSetupChecks(): Record<SaxoLocalApiSetupStepId, boolean> {
  const checks = SAXO_LOCAL_API_SETUP_STEPS.reduce(
    (acc, step) => {
      acc[step.id] = false;
      return acc;
    },
    {} as Record<SaxoLocalApiSetupStepId, boolean>,
  );
  if (typeof window === "undefined") return checks;
  const raw = window.localStorage.getItem(SAXO_LOCAL_API_SETUP_KEY);
  if (!raw) return checks;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<SaxoLocalApiSetupStepId, boolean>>;
    SAXO_LOCAL_API_SETUP_STEPS.forEach((step) => {
      checks[step.id] = Boolean(parsed[step.id]);
    });
    return checks;
  } catch {
    return checks;
  }
}

function saveLocalApiSetupChecks(checks: Record<SaxoLocalApiSetupStepId, boolean>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SAXO_LOCAL_API_SETUP_KEY, JSON.stringify(checks));
}

function enrichHistoryEndpointsWithAccountMappings(
  endpoints: SaxoHistoryDiscoveryEndpoint[],
  mappings: SaxoAccountMapping[],
): SaxoHistoryDiscoveryEndpoint[] {
  return endpoints.map((endpoint) => ({
    ...endpoint,
    items: endpoint.items?.map((item) => {
      if (!item.accountKey) return item;
      const mapping = mappings.find(
        (candidate) =>
          candidate.confirmedByUser &&
          (candidate.accountKey === item.accountKey || maskSaxoIdentifier(candidate.accountKey) === item.accountKey),
      );
      if (!mapping || (mapping.mappedCode !== "P" && mapping.mappedCode !== "N")) return item;
      return { ...item, accountCode: mapping.mappedCode };
    }),
  }));
}

function loadReflectedHistoryIds(): string[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(SAXO_REFLECTED_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveReflectedHistoryIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SAXO_REFLECTED_HISTORY_KEY, JSON.stringify(ids));
}

function loadIgnoredHistoryIds(): string[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(SAXO_IGNORED_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveIgnoredHistoryIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SAXO_IGNORED_HISTORY_KEY, JSON.stringify(ids));
}

function loadDraftedPositionIds(): string[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(SAXO_DRAFTED_POSITION_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveDraftedPositionIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SAXO_DRAFTED_POSITION_KEY, JSON.stringify(ids));
}

function loadLinkedPositionIds(): string[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(SAXO_LINKED_POSITION_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveLinkedPositionIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SAXO_LINKED_POSITION_KEY, JSON.stringify(ids));
}

function loadLinkedPositionTargets(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(SAXO_LINKED_POSITION_TARGET_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function saveLinkedPositionTargets(targets: Record<string, string>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SAXO_LINKED_POSITION_TARGET_KEY, JSON.stringify(targets));
}

function isSaxoNotConnectedError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("401") || lower.includes("not_connected") || message.includes("Saxo接続が必要") || message.includes("未接続");
}

function shouldShowAccountByDefault(account: SaxoApiAccount, mappedCode: SaxoMappedCode): boolean {
  if (mappedCode === "P" || mappedCode === "N") return true;
  if (mappedCode === "ignore") return false;
  const name = `${account.displayName ?? ""} ${account.accountId ?? ""}`.toLowerCase();
  if (name.includes("option")) return true;
  if (name.includes("cfd") || name.includes("fx") || name.includes("cash equities") || name.includes("commodity")) return false;
  return false;
}

function maskDisplayName(displayName?: string, accountId?: string, accountKey?: string): string {
  if (displayName && displayName !== accountId && displayName !== accountKey) return displayName;
  return maskSaxoIdentifier(accountId ?? accountKey);
}
