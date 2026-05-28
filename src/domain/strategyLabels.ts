import type { DenominatorMode, SimulationStatus, StrategyType } from "@/types/domain";

export const strategyLabels: Record<StrategyType, string> = {
  covered_call: "カバードコール",
  short_put: "プット売り",
  covered_call_plus_short_put: "カバードコール＋追加P売り",
  wheel: "ホイール戦略",
  short_strangle: "ショートストラングル",
  custom: "カスタム",
};

export const denominatorLabels: Record<DenominatorMode, string> = {
  broker_margin_only: "証券会社チケット証拠金ベース",
  stock_plus_ticket_margin: "現物株＋チケット証拠金",
  stock_plus_margin: "現物株＋使用証拠金ベース",
  cash_secured: "キャッシュセキュアードベース",
  conservative_common: "保守的共通分母",
  custom: "カスタム分母",
};

export const denominatorExplanations: Record<DenominatorMode, string> = {
  broker_margin_only:
    "証券会社の注文チケットに表示される証拠金をベースにした利回りです。権利行使された場合の株式買付資金は含まれていません。",
  stock_plus_ticket_margin:
    "保有株の時価と、注文チケットに表示された証拠金を足した分母です。バッファ前の見方です。",
  stock_plus_margin:
    "既に保有している現物株の時価と、バッファ後の使用証拠金を合計した分母です。カバードコール＋追加プット売りの実務的な見方です。",
  cash_secured:
    "プットが権利行使された場合に株を買う資金まで用意している前提の分母です。",
  conservative_common:
    "現物株、使用証拠金、権利行使時の追加資金をすべて含めた保守的な分母です。証券会社が今要求する金額ではありません。",
  custom: "ユーザーが任意に設定した資金管理上の分母です。",
};

export const statusLabels: Record<SimulationStatus, string> = {
  planned: "注文前",
  open: "建玉中",
  closed: "決済済み",
  assigned: "権利行使済み",
  expired: "満期終了",
};

export function getStrategyLabel(strategyType: StrategyType): string {
  return strategyLabels[strategyType];
}

export function getDenominatorLabel(mode: DenominatorMode): string {
  return denominatorLabels[mode];
}

export function getDenominatorExplanation(mode: DenominatorMode): string {
  return denominatorExplanations[mode];
}

export function getStatusLabel(status: SimulationStatus): string {
  return statusLabels[status];
}
