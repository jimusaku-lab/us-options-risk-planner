import type { ChecklistItem, RiskWarning, TradeSimulation } from "@/types/domain";
import {
  calculatePutAssignmentCapitalTotalJPY,
  calculatePutAssignmentCapitalTotalUSD,
  calculateUncoveredCallShares,
  getShortCallLegs,
  getShortPutLegs,
} from "./calculations";

function hasAvoidPut(simulation: TradeSimulation): boolean {
  return getShortPutLegs(simulation).some(
    (leg) =>
      leg.putIntent === "avoid_assignment" ||
      leg.putIntent === "do_not_want_to_buy" ||
      leg.putIntent === "cannot_buy",
  );
}

export function generateRiskWarnings(simulation: TradeSimulation): RiskWarning[] {
  const warnings: RiskWarning[] = [];
  const uncoveredCallShares = calculateUncoveredCallShares(simulation);
  const avoidPut = hasAvoidPut(simulation);

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
    warnings.push({
      id: simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "n-covered-call-share-shortage" : "uncovered-call",
      severity: "danger",
      title: simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "N口座カバードコールの株数が不足しています" : "裸コール部分があります",
      message:
        simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
          ? `N口座の保有株だけで確認します。未カバー株数は${uncoveredCallShares}株です。P口座株や未移管株はN口座のカバーに使いません。`
          : `このコール売りは完全にはカバーされていません。未カバー株数は${uncoveredCallShares}株です。`,
      blocking: simulation.beginnerMode ?? true,
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
    warnings.push({
      id: "missing-call-hedge",
      severity: "danger",
      title: "裸コールの上方向ルールが未設定です",
      message: "裸コール部分があります。買い逆指値などの上方向リスク管理ルールが未設定です。",
      blocking: simulation.beginnerMode ?? true,
    });
  }

  if (avoidPut && !simulation.stopLossRule?.enabled) {
    warnings.push({
      id: "avoid-put-no-stop",
      severity: "danger",
      title: "損切りルールが未設定です",
      message: "株を取得したくないプット売りでは、損切りルールが必須です。",
      blocking: true,
    });
  }

  if (avoidPut && simulation.stopLossRule?.enabled && simulation.stopLossRule.value <= 0) {
    warnings.push({
      id: "avoid-put-empty-stop-value",
      severity: "danger",
      title: "損切りルールの値が未入力です",
      message: "損切りルールをONにした場合は、買戻し価格、株価ライン、損失額のいずれかの数値を入れてください。",
      blocking: true,
    });
  }

  if (avoidPut && !simulation.profitTakeRule?.enabled) {
    warnings.push({
      id: "avoid-put-no-profit-take",
      severity: "danger",
      title: "利確ルールが未設定です",
      message: "株を取得したくないプット売りでは、利確ルールを注文前に決めてください。",
      blocking: true,
    });
  }

  if (avoidPut && simulation.profitTakeRule?.latestCloseDaysBeforeExpiry === undefined) {
    warnings.push({
      id: "avoid-put-no-close-deadline",
      severity: "danger",
      title: "満期前決済期限が未設定です",
      message: "満期直前まで放置しないため、何日前までに閉じるかを設定してください。",
      blocking: true,
    });
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
