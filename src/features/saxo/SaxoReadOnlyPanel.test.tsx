import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createEffectiveHistoryEndpoints, ReflectionPendingSummary, SyntheticForwardHoldRow, SyntheticForwardPairRow } from "./SaxoReadOnlyPanel";
import type { ReflectionSummary } from "./SaxoReadOnlyPanel";
import type { SaxoHistoryDiscoveryItem, SaxoSyntheticForwardHold, SaxoSyntheticForwardPair } from "./saxoAccountSync";

afterEach(cleanup);

const callPosition = {
  id: "call", accountKey: "account", accountAssignment: "N" as const, kind: "option" as const, side: "long" as const,
  optionType: "call" as const, quantity: 1, strike: 210, expiry: "2026-12-18", missingFields: [], fetchedAt: "2026-07-17T00:00:00.000Z",
};
const putPosition = { ...callPosition, id: "put", side: "short" as const, optionType: "put" as const, quantity: -1 };
const pair: SaxoSyntheticForwardPair = {
  id: "pair", callPosition, putPosition, ticker: "ANON", underlyingIdentity: "uic:700001:stock", accountCode: "N", accountKey: "account", expiry: "2026-12-18", strike: 210, quantity: 1,
};

it("renders one composite CTA for a paired synthetic forward and no individual draft CTA", () => {
  const onCreateDraft = vi.fn();
  render(<table><tbody><SyntheticForwardPairRow pair={pair} drafted={false} onCreateDraft={onCreateDraft} /></tbody></table>);

  expect(screen.getAllByRole("button", { name: "2脚をシンセティックとして下書き反映" })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "建玉入力へ下書き反映" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "2脚をシンセティックとして下書き反映" }));
  expect(onCreateDraft).toHaveBeenCalledWith(pair);
});

it("uses the filled-state CTA and reopens an integrated 3-A without creating another draft", () => {
  const onCreateDraft = vi.fn();
  const { rerender } = render(<table><tbody><SyntheticForwardPairRow pair={pair} drafted={false} filled onCreateDraft={onCreateDraft} /></tbody></table>);
  expect(screen.getByRole("button", { name: "約定済み二脚を統合して3-Aで確認" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "約定済み二脚を統合して3-Aで確認" }));
  expect(onCreateDraft).toHaveBeenCalledWith(pair);
  rerender(<table><tbody><SyntheticForwardPairRow pair={pair} drafted filled integrated onCreateDraft={onCreateDraft} /></tbody></table>);
  expect(screen.getByRole("button", { name: "親シンセティックの確定情報を確認" })).toBeEnabled();
  rerender(<table><tbody><SyntheticForwardPairRow pair={pair} drafted filled integrated saved onCreateDraft={onCreateDraft} onOpenDashboard={vi.fn()} /></tbody></table>);
  expect(screen.getByRole("button", { name: "建玉ダッシュボードで確認" })).toBeEnabled();
});

it("keeps a recovery CTA active when only the stale drafted marker remains", () => {
  const onCreateDraft = vi.fn();
  render(<table><tbody><SyntheticForwardPairRow pair={pair} drafted recoveryRequired onCreateDraft={onCreateDraft} /></tbody></table>);
  const button = screen.getByRole("button", { name: "シンセティック建玉を復旧して確認" });
  expect(button).toBeEnabled(); fireEvent.click(button); expect(onCreateDraft).toHaveBeenCalledWith(pair);
});

it("renders an unresolved pair without individual reflection controls", () => {
  const hold: SaxoSyntheticForwardHold = { id: "hold", callPosition, putPosition, accountCode: "N", expiry: "2026-12-18", strike: 210, quantity: 1, reason: "原資産識別子をSaxoから取得できませんでした。" };
  render(<table><tbody><SyntheticForwardHoldRow hold={hold} /></tbody></table>);

  expect(screen.getByText("統合保留")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

const closeHistory: SaxoHistoryDiscoveryItem = { id: "anonymous-close", kind: "trade", accountCode: "N", symbol: "SAMPLE", assetType: "StockOption", optionType: "call", strike: 100, expiry: "2026-12-18", tradeDate: "2026-08-11", quantity: 1, buySell: "sell", openClose: "close", price: 12.5 };
function summaryWithHistoryAction(action: ReflectionSummary["historyActions"][number]): ReflectionSummary {
  return { accountLines: [], positionLine: { detail: "0件", actionable: false, actionLabel: "確認" }, orderLine: { detail: "0件", actionable: false }, historyLine: { detail: "決済1件", actionable: true, actionLabel: "履歴候補一覧を見る" }, historyActions: [action], requiredActionCount: 1, hasPending: true, hasNewPositionCandidates: false, historyIsSupplemental: false };
}
it("shows a close-specific direct CTA that only requests one Section 7 draft", () => {
  const onOpenHistoryAction = vi.fn();
  render(<ReflectionPendingSummary summary={summaryWithHistoryAction({ item: closeHistory, target: "close", mode: "create" })} onShowMapping={vi.fn()} onShowSnapshot={vi.fn()} onShowPositions={vi.fn()} onShowOrders={vi.fn()} onShowHistory={vi.fn()} onOpenHistoryAction={onOpenHistoryAction} />);
  expect(screen.getByText(/SAMPLE \/ C \/ 行使価格 100 \/ 2026-12-18 \/ 2026-08-11 \/ 決済/)).toBeInTheDocument();
  expect(screen.getByText("Section 7へ確認用下書きを作成して移動します。まだ正式保存されません。")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "SAMPLEの決済内容を確認する" }));
  expect(onOpenHistoryAction).toHaveBeenCalledTimes(1);
  expect(onOpenHistoryAction).toHaveBeenCalledWith(closeHistory);
});
it("uses a return CTA for an existing draft and no direct creation CTA for blocked history", () => {
  const onOpenHistoryAction = vi.fn();
  const { rerender } = render(<ReflectionPendingSummary summary={summaryWithHistoryAction({ item: closeHistory, target: "close", mode: "return" })} onShowMapping={vi.fn()} onShowSnapshot={vi.fn()} onShowPositions={vi.fn()} onShowOrders={vi.fn()} onShowHistory={vi.fn()} onOpenHistoryAction={onOpenHistoryAction} />);
  fireEvent.click(screen.getByRole("button", { name: "SAMPLEの決済確認へ戻る" }));
  expect(onOpenHistoryAction).toHaveBeenCalledTimes(1);
  const onShowHistory = vi.fn();
  rerender(<ReflectionPendingSummary summary={summaryWithHistoryAction({ item: { ...closeHistory, buySell: "unknown" }, target: "close", mode: "review", reason: "自動反映できません。履歴一覧で理由を確認してください。" })} onShowMapping={vi.fn()} onShowSnapshot={vi.fn()} onShowPositions={vi.fn()} onShowOrders={vi.fn()} onShowHistory={onShowHistory} onOpenHistoryAction={onOpenHistoryAction} />);
  expect(screen.queryByRole("button", { name: /決済内容を確認する/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "履歴候補一覧を見る" }).at(-1)!);
  expect(onShowHistory).toHaveBeenCalledTimes(1);
});

it("keeps a merged effective close candidate intact for the history display path", () => {
  const trade = { ...closeHistory, id: "trade", accountCode: "P" as const, accountCurrency: "JPY", profitLoss: undefined, bookedAmountUSD: 3235.23 };
  const merged = { ...trade, profitLossAccountCurrency: 119265, relatedCandidateKeys: ["closed"] };
  const endpoints = createEffectiveHistoryEndpoints(
    [{ endpoint: "trades", label: "約定", classification: "ok", itemCount: 1, message: "", items: [trade] }, { endpoint: "closed", label: "決済", classification: "ok", itemCount: 1, message: "", items: [{ ...closeHistory, id: "closed", accountCode: "P" as const, accountCurrency: "JPY", profitLossAccountCurrency: 119265 }] }],
    [merged],
  );
  expect(endpoints).toHaveLength(1);
  expect(endpoints[0].items).toEqual([merged]);
});
