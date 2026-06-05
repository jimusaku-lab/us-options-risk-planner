import type { TradeSimulation, WorkflowTask } from "@/types/domain";
import { getShortCallLegs, getShortOptionLegs, getShortPutLegs } from "./calculations";
import { calculateOptionCloseExecutionResults } from "./optionCloseExecutions";
import { hasUnconfirmedOptionEntryExecutions } from "./optionEntryExecutions";

function task(simulation: TradeSimulation, task: Omit<WorkflowTask, "simulationId">): WorkflowTask {
  return { ...task, simulationId: simulation.id };
}

export function getWorkflowTasks(simulation: TradeSimulation): WorkflowTask[] {
  const shortLegs = getShortOptionLegs(simulation);
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

  if (simulation.status === "open") {
    const firstShortLeg = shortLegs[0];
    if (shortLegs.length > 0 && hasUnconfirmedOptionEntryExecutions(simulation)) {
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
    } else {
      tasks.push(
        task(simulation, {
          id: `${simulation.id}-review-close`,
          type: "review_close_decision",
          severity: "info",
          label: "反対売買判断",
          detail: "建玉中です。必要に応じて買戻し価格を確認します。",
          actionLabel: "反対売買判断へ",
          targetAnchor: "close-decision",
          focusField: firstShortLeg ? `close-decision-${firstShortLeg.type}-${firstShortLeg.id}` : undefined,
        }),
      );
    }
    return tasks;
  }

  if (simulation.status === "closed") {
    if (calculateOptionCloseExecutionResults(simulation).length === 0) {
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
    if (!(simulation.optionCloseExecutions ?? []).some((execution) => execution.closeKind === "expired")) {
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
    if (getShortPutLegs(simulation).length > 0 && !simulation.stockAcquisition?.enabled) {
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
