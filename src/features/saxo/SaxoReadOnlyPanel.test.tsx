import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SyntheticForwardHoldRow, SyntheticForwardPairRow } from "./SaxoReadOnlyPanel";
import type { SaxoSyntheticForwardHold, SaxoSyntheticForwardPair } from "./saxoAccountSync";

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

it("renders an unresolved pair without individual reflection controls", () => {
  const hold: SaxoSyntheticForwardHold = { id: "hold", callPosition, putPosition, accountCode: "N", expiry: "2026-12-18", strike: 210, quantity: 1, reason: "原資産識別子をSaxoから取得できませんでした。" };
  render(<table><tbody><SyntheticForwardHoldRow hold={hold} /></tbody></table>);

  expect(screen.getByText("統合保留")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
