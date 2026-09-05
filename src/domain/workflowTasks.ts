import type { TradeSimulation, WorkflowTask } from "@/types/domain";
import { getLongOptionLegs, getShortCallLegs, getShortOptionLegs, getShortPutLegs } from "./calculations";
import {
  getOptionCloseCompletion,
  getOptionLegOperationalCloseProgress,
  hasUnconfirmedCloseExecutionDraft,
} from "./optionCloseExecutions";
import { hasUnconfirmedOptionEntryExecutions } from "./optionEntryExecutions";

function task(simulation: TradeSimulation, task: Omit<WorkflowTask, "simulationId">): WorkflowTask {
  return { ...task, simulationId: simulation.id };
}

export function getWorkflowTasks(simulation: TradeSimulation): WorkflowTask[] {
  const shortLegs = getShortOptionLegs(simulation);
  const longLegs = getLongOptionLegs(simulation);
  const closeCompletion = getOptionCloseCompletion(simulation);
  const tasks: WorkflowTask[] = [];

  if (simulation.status === "planned") {
    return [
      task(simulation, {
        id: `${simulation.id}-confirm-order`,
        type: "review_close_decision",
        severity: "info",
        label: "注文内容を確認",
        detail: "注文前の予定値です。Saxoチケットと建玉入力を確認します。",
        actionLabel: "入力欄を開く",
        targetAnchor: "simulation-editor",
      }),
    ];
  }

  if (simulation.status === "entry_confirmation") {
    return [
      task(simulation, {
        id: `${simulation.id}-confirm-synthetic-entry`,
        type: "confirm_entry_execution",
        severity: "warning",
        label: "約定確認を開く",
        detail: "Saxoで約定済みの親注文と二脚を確認して、建玉中として正式保存してください。",
        actionLabel: "約定確認を開く",
        targetAnchor: "option-entry-executions",
      }),
    ];
  }

  if (simulation.status === "open") {
    const firstShortLeg = shortLegs[0];
    const firstLongLeg = longLegs[0];
    if ((shortLegs.length > 0 || longLegs.length > 0) && hasUnconfirmedOptionEntryExecutions(simulation)) {
      tasks.push(
        task(simulation, {
          id: `${simulation.id}-confirm-entry`,
          type: "confirm_entry_execution",
          severity: "warning",
          label: "約定確認へ",
          detail: "Saxo取引履歴を見ながら、建玉約定確認を完了してください。",
          actionLabel: "約定確認へ進む",
          targetAnchor: "option-entry-executions",
          focusField: "brokerBookedAmountJPY",
        }),
      );
    } else if (hasUnconfirmedCloseExecutionDraft(simulation)) {
      tasks.push(
        task(simulation, {
          id: `${simulation.id}-confirm-close-execution`,
          type: "enter_close_execution",
          severity: "warning",
          label: "決済実績を確認",
          detail: "決済実績の下書きがあります。Saxo注文履歴を見て確認済みにしてください。",
          actionLabel: "決済実績へ進む",
          targetAnchor: "option-close-executions",
          focusField: "broker-realized-pnl-jpy",
        }),
      );
    } else if (closeCompletion.state === "invalid") {
      tasks.push(
        task(simulation, {
          id: `${simulation.id}-invalid-close-quantity`,
          type: "enter_close_execution",
          severity: "danger",
          label: "決済数量を確認",
          detail: closeCompletion.reason ?? "確認済み決済実績の対象脚と数量を確認してください。",
          actionLabel: "決済実績へ進む",
          targetAnchor: "option-close-executions",
          focusField: "broker-realized-pnl-jpy",
        }),
      );
    } else if (closeCompletion.state === "partial") {
      const progress = getOptionLegOperationalCloseProgress(simulation);
      for (const legProgress of progress.legs) {
        if ((legProgress.state !== "open" && legProgress.state !== "partial") || !legProgress.remainingContracts) continue;
        const leg = simulation.optionLegs.find((item) => item.id === legProgress.legId);
        if (!leg) continue;
        const isLongCall = leg.type === "call" && leg.side === "buy";
        const isShortPut = leg.type === "put" && leg.side === "sell";
        const label = isShortPut
          ? "P売りを反対売買判断"
          : isLongCall
            ? "C買いを反対売買で決済"
            : "残存脚を反対売買判断";
        tasks.push(task(simulation, {
          id: `${simulation.id}-review-close-${leg.id}`,
          type: "review_close_decision",
          severity: "warning",
          label,
          detail: `残り${legProgress.remainingContracts}枚です。決済済みの脚は再評価・再決済しません。`,
          actionLabel: "反対売買判断へ",
          targetAnchor: "close-decision",
          focusField: `close-decision-${leg.type}-${leg.id}`,
        }));
      }
    } else {
      const isLongOnly = longLegs.length > 0 && shortLegs.length === 0;
      tasks.push(
        task(simulation, {
          id: `${simulation.id}-review-close`,
          type: "review_close_decision",
          severity: "info",
          label: isLongOnly ? "反対売買で決済" : "反対売買判断",
          detail: isLongOnly
            ? "買いオプションは原則として満期前に反対売買で決済します。利確/損切りラインと満期接近を確認してください。"
            : "建玉中です。必要に応じて買戻し価格を確認します。",
          actionLabel: "反対売買判断へ",
          targetAnchor: "close-decision",
          focusField: firstShortLeg
            ? `close-decision-${firstShortLeg.type}-${firstShortLeg.id}`
            : firstLongLeg
              ? `close-decision-${firstLongLeg.type}-${firstLongLeg.id}`
              : undefined,
        }),
      );
    }
    return tasks;
  }

  if (simulation.status === "closed") {
    if (closeCompletion.state !== "complete" || closeCompletion.terminalStatus !== "closed") {
      return [
        task(simulation, {
          id: `${simulation.id}-enter-close`,
          type: "enter_close_execution",
          severity: "danger",
          label: "決済実績を入力",
          detail: "決済済みですが、Saxo注文履歴の決済実績が未入力です。",
          actionLabel: "決済実績へ進む",
          targetAnchor: "option-close-executions",
          focusField: "closePriceUSD",
        }),
      ];
    }
    return [completeTask(simulation)];
  }

  if (simulation.status === "expired") {
    if (closeCompletion.state !== "complete" || closeCompletion.terminalStatus !== "expired") {
      return [
        task(simulation, {
          id: `${simulation.id}-confirm-expiry`,
          type: "confirm_expiry",
          severity: "warning",
          label: "満期終了を確認",
          detail: "満期終了ですが、買戻しなしの満期終了履歴が未確認です。",
          actionLabel: "満期終了履歴へ",
          targetAnchor: "option-close-executions",
        }),
      ];
    }
    return [completeTask(simulation)];
  }

  if (simulation.status === "assigned") {
    if (getShortPutLegs(simulation).length > 0 && !hasValidStockAcquisition(simulation)) {
      tasks.push(
        task(simulation, {
          id: `${simulation.id}-stock-acquisition`,
          type: "enter_stock_acquisition",
          severity: "danger",
          label: "株式取得を記録",
          detail: "P売り権利行使による株式取得記録が未入力です。",
          actionLabel: "取得記録へ進む",
          targetAnchor: "stock-acquisition",
          focusField: "shares",
        }),
      );
    }
    if (getShortCallLegs(simulation).length > 0 && !simulation.stockSettlement?.enabled) {
      tasks.push(
        task(simulation, {
          id: `${simulation.id}-stock-settlement`,
          type: "enter_stock_settlement",
          severity: "danger",
          label: "株式譲渡を記録",
          detail: "C売り権利行使による株式譲渡記録が未入力です。",
          actionLabel: "譲渡記録へ進む",
          targetAnchor: "stock-settlement",
          focusField: "shares",
        }),
      );
    }
    return tasks.length > 0 ? tasks : [completeTask(simulation)];
  }

  return [completeTask(simulation)];
}

function hasValidStockAcquisition(simulation: TradeSimulation): boolean {
  const acquisition = simulation.stockAcquisition;
  return Boolean(
    acquisition?.enabled &&
      Number.isFinite(acquisition.shares) &&
      acquisition.shares > 0 &&
      Number.isFinite(acquisition.priceUSD) &&
      acquisition.priceUSD > 0,
  );
}

export function getPrimaryWorkflowTask(simulation: TradeSimulation): WorkflowTask {
  return getWorkflowTasks(simulation)[0] ?? completeTask(simulation);
}

export function getWorkflowTargetAnchorId(task: WorkflowTask): string {
  if (task.targetAnchor === "stock-acquisition") return "stock-acquisition-record";
  if (task.targetAnchor === "stock-settlement") return "stock-settlement-record";
  return task.targetAnchor;
}

function completeTask(simulation: TradeSimulation): WorkflowTask {
  return task(simulation, {
    id: `${simulation.id}-complete`,
    type: "complete",
    severity: "info",
    label: "入力完了",
    detail: "現在の状態で必要な実績入力は完了しています。",
    actionLabel: "確認",
    targetAnchor: "simulation-editor",
  });
}
