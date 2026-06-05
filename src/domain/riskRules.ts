import type { ChecklistItem, OptionLeg, RiskWarning, TradeSimulation } from "@/types/domain";
import {
  calculatePutAssignmentCapitalTotalJPY,
  calculatePutAssignmentCapitalTotalUSD,
  calculateUncoveredCallShares,
  getShortCallLegs,
  getShortPutLegs,
} from "./calculations";
import { getExitDeadlineInfo, getExitOrderLossAmount, getExitOrderPlan, getExitOrderPlanForLeg, getExitOrderStopValue, isAvoidAssignmentPut } from "./exitOrderPlan";
import { hasUnconfirmedOptionEntryExecutions } from "./optionEntryExecutions";
import { calculateOptionCloseExecutionResults } from "./optionCloseExecutions";

function hasAvoidPut(simulation: TradeSimulation): boolean {
  return isAvoidAssignmentPut(simulation);
}

function closeDecisionAction(simulation: TradeSimulation, leg: OptionLeg): Pick<RiskWarning, "actionAnchorId" | "actionLabel" | "actionLegId" | "actionLegType" | "actionSimulationId"> {
  return {
    actionLabel: "反対売買判断へ",
    actionSimulationId: simulation.id,
    actionLegId: leg.id,
    actionLegType: leg.type,
    actionAnchorId: `close-decision-${leg.type}-${leg.id}`,
  };
}

export function generateRiskWarnings(simulation: TradeSimulation): RiskWarning[] {
  const warnings: RiskWarning[] = [];
  const uncoveredCallShares = calculateUncoveredCallShares(simulation);
  const avoidPut = hasAvoidPut(simulation);
  const exitOrderPlan = getExitOrderPlan(simulation);

  const closeExecutionResults = calculateOptionCloseExecutionResults(simulation);
  if (hasUnconfirmedOptionEntryExecutions(simulation)) {
    warnings.push({
      id: "option-entry-unconfirmed",
      severity: "warning",
      title: "約定情報未確認",
      message: "建玉中ですが、建玉約定確認が未完了です。P口座ではSaxo取引履歴のプレミアムJPYと取引費用JPYを確認してください。",
      blocking: false,
      actionLabel: "建玉約定確認へ",
      actionSimulationId: simulation.id,
      actionAnchorId: "option-entry-executions",
    });
  }
  if (simulation.status === "closed" && closeExecutionResults.length === 0) {
    warnings.push({
      id: "closed-without-option-close-execution",
      severity: "danger",
      title: "決済実績が未入力です",
      message: "決済済みですが、決済実績が未入力です。Saxo注文履歴から約定価格と手数料を入力してください。",
      blocking: false,
      actionLabel: "決済実績を入力",
      actionSimulationId: simulation.id,
      actionAnchorId: "option-close-executions",
    });
  }

  if (
    simulation.status === "expired" &&
    !(simulation.optionCloseExecutions ?? []).some((execution) => execution.closeKind === "expired")
  ) {
    warnings.push({
      id: "expired-without-option-expiry-record",
      severity: "danger",
      title: "満期終了履歴が未入力です",
      message: "満期終了ですが、買戻しなしの満期終了履歴が未入力です。7. 決済実績で満期終了モードの記録を確認してください。",
      blocking: false,
      actionLabel: "満期終了履歴を入力",
      actionSimulationId: simulation.id,
      actionAnchorId: "option-close-executions",
    });
  }

  if (simulation.status === "assigned") {
    const hasPut = getShortPutLegs(simulation).length > 0;
    const hasCall = getShortCallLegs(simulation).length > 0;
    if (hasPut && !simulation.stockAcquisition?.enabled) {
      warnings.push({
        id: "assigned-put-without-stock-acquisition",
        severity: "danger",
        title: "株式取得記録が未入力です",
        message: "P売りが権利行使済みですが、現物株の取得記録が未入力です。株式取得は譲渡損益ではありませんが、取得株数と取得単価を記録してください。",
        blocking: false,
        actionLabel: "現物株の取得記録へ",
        actionSimulationId: simulation.id,
        actionAnchorId: "stock-acquisition-record",
      });
    }
    if (hasCall && !simulation.stockSettlement?.enabled) {
      warnings.push({
        id: "assigned-call-without-stock-settlement",
        severity: "danger",
        title: "株式譲渡記録が未入力です",
        message: "C売りが権利行使済みですが、現物株の譲渡記録が未入力です。オプション損益と株式譲渡損益は自動通算しません。",
        blocking: false,
        actionLabel: "現物株の譲渡記録へ",
        actionSimulationId: simulation.id,
        actionAnchorId: "stock-settlement-record",
      });
    }
    if (hasCall && uncoveredCallShares > 0) {
      warnings.push({
        id: "assigned-uncovered-call",
        severity: "danger",
        title: "現物不足のC売りが権利行使済みです",
        message: "現物株が不足しているC売りが権利行使済みです。Saxo上の決済処理、株式手当、損益を確認して記録してください。",
        blocking: true,
        actionLabel: "決済実績とメモを確認",
        actionSimulationId: simulation.id,
        actionAnchorId: "option-close-executions",
      });
    }
  }

  if (!Number.isFinite(simulation.fxRateJPY) || simulation.fxRateJPY <= 0) {
    warnings.push({
      id: "missing-fx-rate",
      severity: "danger",
      title: "為替レートが未入力です",
      message: "円換算のプレミアム、使用分母、年率はUSD/JPYが0だとすべて0円になります。上部の為替ボタン、または入力欄の取得ボタンでUSD/JPYを入れてください。",
      blocking: true,
    });
  }

  if (simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT") {
    warnings.push({
      id: "n-reference-jpy",
      severity: "info",
      title: "N口座のJPY換算は参考表示です",
      message: "N口座の損益と年率はUSDで管理します。JPY換算は現在の表示用USD/JPYによる参考値で、円転または税務上の確定損益ではありません。",
    });
  }

  if (simulation.dte <= 0) {
    warnings.push({
      id: "invalid-dte",
      severity: "danger",
      title: "満期日が不正です",
      message: "満期までの日数が0以下のため、年率やシナリオを計算できません。",
      blocking: true,
    });
  }

  if (uncoveredCallShares > 0) {
    const firstCall = getShortCallLegs(simulation)[0];
    warnings.push({
      id: simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "n-covered-call-share-shortage" : "uncovered-call",
      severity: "danger",
      title: simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "N口座カバードコールの株数が不足しています" : "裸コール部分があります",
      message:
        simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
          ? `N口座の保有株だけで確認します。未カバー株数は${uncoveredCallShares}株です。P口座株や未移管株はN口座のカバーに使いません。`
          : `このC売りは完全にはカバーされていません。C売り対象株数と保有株数を分けて確認してください。未カバー株数は${uncoveredCallShares}株です。`,
      blocking: simulation.beginnerMode ?? true,
      ...(firstCall ? closeDecisionAction(simulation, firstCall) : {}),
    });
  }

  if (simulation.accountEnvironment === "PROD_P_JPY_SETTLEMENT" && simulation.status === "assigned" && (simulation.stockPosition?.shares ?? 0) > 0) {
    warnings.push({
      id: "p-assigned-stock-transfer-pending",
      severity: "warning",
      title: "P口座で取得した株式が残っています",
      message: "N口座へ株式移管してカバードコール管理へ進めるか確認してください。株式移管は売却損益として扱いません。",
    });
  }

  if (
    uncoveredCallShares > 0 &&
    getShortCallLegs(simulation).some((leg) => leg.hedgeBuyStopUSD === undefined)
  ) {
    const firstMissingCall = getShortCallLegs(simulation).find((leg) => leg.hedgeBuyStopUSD === undefined);
    warnings.push({
      id: "missing-call-hedge",
      severity: "danger",
      title: "裸コールの上方向ルールが未設定です",
      message: "未カバーC売り部分があります。逆指値ラインなどの上抜け時の買戻し方針が未設定です。",
      blocking: simulation.beginnerMode ?? true,
      ...(firstMissingCall ? closeDecisionAction(simulation, firstMissingCall) : {}),
    });
  }

  for (const [legIndex, leg] of getShortPutLegs(simulation).entries()) {
    const legAvoidPut =
      leg.putIntent === "avoid_assignment" || leg.putIntent === "do_not_want_to_buy" || leg.putIntent === "cannot_buy";
    const legExitOrderPlan = getExitOrderPlanForLeg(simulation, leg);
    if (legAvoidPut && !legExitOrderPlan.stopLossEnabled) {
      warnings.push({
        id: legIndex === 0 ? "avoid-put-no-stop" : `avoid-put-no-stop-${leg.id}`,
        severity: "danger",
        title: "P売りの損切りルールが未設定です",
        message: "株を取得したくないP売りでは、そのP売り脚に損切りルールが必須です。",
        blocking: true,
        ...closeDecisionAction(simulation, leg),
      });
    }
    const legStopValue =
      legExitOrderPlan.stopLossType === "loss_amount"
        ? getExitOrderLossAmount(legExitOrderPlan, simulation)
        : getExitOrderStopValue(legExitOrderPlan);
    if (legAvoidPut && legExitOrderPlan.stopLossEnabled && legStopValue <= 0) {
      warnings.push({
        id: legIndex === 0 ? "avoid-put-empty-stop-value" : `avoid-put-empty-stop-value-${leg.id}`,
        severity: "danger",
        title: "P売りの損切りルール値が未入力です",
        message: "損切りルールをONにしたP売り脚には、買戻し価格、株価ライン、損失額のいずれかを入れてください。",
        blocking: true,
        ...closeDecisionAction(simulation, leg),
      });
    }
    if (legAvoidPut && !legExitOrderPlan.profitTakeEnabled) {
      warnings.push({
        id: legIndex === 0 ? "avoid-put-no-profit-take" : `avoid-put-no-profit-take-${leg.id}`,
        severity: "danger",
        title: "P売りの利確ルールが未設定です",
        message: "株を取得したくないP売りでは、そのP売り脚の利確ルールを注文前に決めてください。",
        blocking: true,
        ...closeDecisionAction(simulation, leg),
      });
    }
    if (legAvoidPut && legExitOrderPlan.latestCloseDaysBeforeExpiry === undefined) {
      warnings.push({
        id: legIndex === 0 ? "avoid-put-no-close-deadline" : `avoid-put-no-close-deadline-${leg.id}`,
        severity: "danger",
        title: "P売りの満期前決済期限が未設定です",
        message: "満期直前まで放置しないため、そのP売り脚を何日前までに閉じるかを設定してください。",
        blocking: true,
        ...closeDecisionAction(simulation, leg),
      });
    }
    const exitDeadline = getExitDeadlineInfo(simulation, legExitOrderPlan);
    if (exitDeadline.isPast && legExitOrderPlan.latestCloseDaysBeforeExpiryUserSet && ["planned", "open"].includes(simulation.status)) {
      warnings.push({
        id: `exit-deadline-past-${leg.id}`,
        severity: legAvoidPut ? "danger" : "warning",
        title: `${leg.type === "put" ? "P売り" : "C売り"}の満期前判断期限に到達しています`,
        message: legAvoidPut
          ? `満期前の判断期限（${exitDeadline.deadlineDate}）に到達しています。P買戻し価格を反対売買判断で確認してください。`
          : `設定した決済判断期限（${exitDeadline.deadlineDate}）に到達しています。反対売買判断で現在の買戻し価格を確認してください。`,
        blocking: legAvoidPut,
        ...closeDecisionAction(simulation, leg),
      });
    }
  }

  for (const leg of getShortCallLegs(simulation)) {
    const nakedCall =
      leg.callExitIntent === "naked_buyback" ||
      (uncoveredCallShares > 0 && leg.callExitIntent !== "covered_keep_stock" && simulation.stockPosition?.canSellAtStrike !== false);
    const keepStockCall = !nakedCall && simulation.stockPosition?.canSellAtStrike === false;
    const legExitOrderPlan = getExitOrderPlanForLeg(simulation, leg);
    if (nakedCall) {
      if (!leg.hedgeBuyStopUSD || !legExitOrderPlan.stopLossBuybackPriceUSD || !getExitOrderLossAmount(legExitOrderPlan, simulation) || !legExitOrderPlan.latestCloseDaysBeforeExpiryUserSet || !leg.nakedCallRiskAcknowledged) {
        warnings.push({
          id: `naked-call-exit-rule-missing-${leg.id}`,
          severity: "danger",
          title: "未カバーC売りの出口ルールが未設定です",
          message: "現物なし・上抜け時は買戻し方針では、逆指値ライン、買戻し価格ライン、許容損失額、満期前判断期限、不利約定リスクの確認を入力してください。",
          blocking: simulation.beginnerMode ?? true,
          ...closeDecisionAction(simulation, leg),
        });
      }
    }
    const exitDeadline = getExitDeadlineInfo(simulation, legExitOrderPlan);
    if (
      (nakedCall || keepStockCall) &&
      exitDeadline.isPast &&
      legExitOrderPlan.latestCloseDaysBeforeExpiryUserSet &&
      ["planned", "open"].includes(simulation.status)
    ) {
      warnings.push({
        id: `call-exit-deadline-past-${leg.id}`,
        severity: nakedCall ? "danger" : "warning",
        title: "C売りの満期前判断期限に到達しています",
        message: nakedCall
          ? `現物なしのC売りです。判断期限（${exitDeadline.deadlineDate}）に到達しています。上抜け時の買戻し価格または逆指値ラインを反対売買判断で確認してください。`
          : `株を残したい方針のC売りです。判断期限（${exitDeadline.deadlineDate}）に到達しています。C買戻し価格を反対売買判断で確認してください。`,
        blocking: nakedCall && (simulation.beginnerMode ?? true),
        ...closeDecisionAction(simulation, leg),
      });
    }
  }

  for (const leg of getShortPutLegs(simulation)) {
    if (
      (leg.putIntent === "avoid_assignment" ||
        leg.putIntent === "do_not_want_to_buy" ||
        leg.putIntent === "cannot_buy") &&
      leg.strikeUSD > simulation.currentPriceUSD * 0.8
    ) {
      warnings.push({
        id: `put-too-close-${leg.id}`,
        severity: "warning",
        title: "買いたくないP売りとしては権利行使価格が近い可能性があります",
        message: "プレミアム額だけでなく、現在株価からの距離、損切り、分母を確認してください。",
      });
    }
  }

  if ((simulation.marginUsagePercent ?? 0) >= 60) {
    warnings.push({
      id: "high-margin-usage",
      severity: "danger",
      title: "証拠金使用率が高いです",
      message: "建玉を増やしすぎると、損切り覚悟で決済せざるを得ない可能性があります。",
    });
  }

  const putAssignmentCapitalJPY = calculatePutAssignmentCapitalTotalJPY(simulation);
  const putAssignmentCapitalUSD = calculatePutAssignmentCapitalTotalUSD(simulation);
  if (
    simulation.availableCashJPY !== undefined &&
    putAssignmentCapitalJPY > 0 &&
    simulation.availableCashJPY < putAssignmentCapitalJPY
  ) {
    warnings.push({
      id: "put-assignment-cash-shortage",
      severity: "danger",
      title: simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "N口座のUSD現金残高が不足している可能性があります" : "JPYベース口座の現金残高が不足している可能性があります",
      message:
        simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
          ? `P/N余力は合算しません。N口座内のUSD現金残高と、権利行使時の買付資金 ${putAssignmentCapitalUSD.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD を比較してください。`
          : "権利行使価格で株を買い受ける資金を、JPYベースの現金残高と比較して確認します。",
    });
  }

  for (const leg of getShortCallLegs(simulation)) {
    if (simulation.stockPosition && leg.strikeUSD < simulation.stockPosition.averageCostUSD) {
      warnings.push({
        id: `covered-call-below-cost-${leg.id}`,
        severity: "warning",
        title: "取得単価より低いカバードコールです",
        message: "この権利行使価格で売却されると、株式部分は損切りになる可能性があります。",
      });
    }
  }

  return warnings;
}

export function generateChecklist(simulation: TradeSimulation): ChecklistItem[] {
  const avoidPut = hasAvoidPut(simulation);
  return [
    {
      id: "premium-and-denominator",
      label: "プレミアム額だけでなく、使用分母と年率を確認した",
      passed: false,
    },
    {
      id: "assignment-action",
      label: "権利行使された場合の行動を決めた",
      passed: false,
      blocking: avoidPut,
    },
    {
      id: "profit-take",
      label: "利確ルールを決めた",
      passed: false,
      blocking: avoidPut,
    },
    {
      id: "close-before-expiry",
      label: "満期何日前までに閉じるかを決めた",
      passed: false,
      blocking: avoidPut,
    },
    {
      id: "no-blocking-risk",
      label: "注文前NGの警告が残っていない",
      passed: false,
      blocking: true,
    },
  ];
}
