import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TimeValueObservationPanel } from "./TimeValueObservationPanel";
import type { OptionLeg } from "@/types/domain";

afterEach(cleanup);

const leg = (id: string, side: "buy" | "sell", state: "available" | "inconsistent"): OptionLeg => ({ id, type: "put", side, strikeUSD: 100, premiumUSD: 3, quantity: 1, contractSize: 100, expiryDate: "2026-10-16", valueObservations: [{ observationId: id, batchId: `batch-${id}`, snapshotDate: "2026-09-23", side, optionType: "put", strikeUSD: 100, expiryDate: "2026-10-16", quantity: 1, contractSize: 100, optionPriceUSD: state === "available" ? 2 : 1, underlyingPriceUSD: 105, intrinsicValueUSD: 0, rawTimeValueUSD: state === "available" ? 2 : -19, timeValueUSD: state === "available" ? 2 : undefined, decompositionState: state, reason: state === "inconsistent" ? "価格と株価の整合を確認" : undefined, source: "saxo", calculationVersion: "r14" }] });
const historyObservation = (id: string, snapshotDate: string, optionPriceUSD: number, intrinsicValueUSD: number | undefined, timeValueUSD: number | undefined, extra: Record<string, unknown> = {}) => ({ observationId: id, legId: "p", batchId: "batch-1", snapshotDate, side: "sell" as const, optionType: "put" as const, strikeUSD: 100, expiryDate: "2026-10-16", quantity: 1, contractSize: 100, optionPriceUSD, intrinsicValueUSD, rawTimeValueUSD: timeValueUSD, timeValueUSD, decompositionState: "available" as const, source: "saxo" as const, selectedField: "ask" as const, quality: "current" as const, capturedAt: `${snapshotDate}T15:00:00Z`, calculationVersion: "r14" as const, ...extra });
const historyLeg = (id: string, side: "buy" | "sell", observations: OptionLeg["valueObservations"]): OptionLeg => ({ id, type: "put", side, strikeUSD: 100, premiumUSD: 3, quantity: 1, contractSize: 100, expiryDate: "2026-10-16", valueObservations: observations });

describe("R14 time-value panel", () => {
  it("shows the integrity reason", () => {
    render(<TimeValueObservationPanel title="時間価値・買戻し判断" legs={[leg("p", "sell", "inconsistent")]} />);
    expect(screen.getByRole("region", { name: "時間価値・買戻し判断" })).toHaveTextContent("価格と株価の整合を確認");
  });
  it("does not silently combine different batches", () => {
    render(<TimeValueObservationPanel legs={[leg("c", "buy", "available"), leg("p", "sell", "available")]} />);
    expect(screen.getByText(/両脚の差引評価額（手数料前） 未計算/)).toBeInTheDocument();
  });
  it("shows signed intrinsic and time value for a same-batch vertical", () => {
    const call = leg("c", "buy", "available");
    const put = leg("p", "sell", "available");
    call.valueObservations![0] = { ...call.valueObservations![0], batchId: "same", side: "buy", optionType: "call", optionPriceUSD: 13, underlyingPriceUSD: 110, intrinsicValueUSD: 10, rawTimeValueUSD: 3, timeValueUSD: 3 };
    put.valueObservations![0] = { ...put.valueObservations![0], batchId: "same", side: "sell", optionType: "put", optionPriceUSD: 3, underlyingPriceUSD: 105, intrinsicValueUSD: 0, rawTimeValueUSD: 3, timeValueUSD: 3 };
    render(<TimeValueObservationPanel legs={[call, put]} />);
    expect(screen.getByText(/本質的価値 \+\$1,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/時間価値 \$0\.00/)).toBeInTheDocument();
  });
  it("shows a read-only reference decomposition for a saved price without inventing history", () => {
    const saved = { ...leg("saved", "buy", "available"), type: "call" as const, closeCostUSD: 13 };
    saved.valueObservations = undefined;
    render(<TimeValueObservationPanel legs={[saved]} currentUnderlyingPriceUSD={110} />);
    expect(screen.getAllByText(/時点未確認の参考分解/).length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: /本質的価値 \$10\.00、時間価値 \$3\.00/ })).toBeInTheDocument();
    expect(screen.getByText(/価格推移・計算履歴 0件/)).toBeInTheDocument();
  });

  it("plots same-leg history proportionally and uses the shared intrinsic/time colors", () => {
    const history = [historyObservation("p-1", "2026-09-22", 10, 6, 4), historyObservation("p-2", "2026-09-23", 5, 2, 3, { quantityChanged: true, previousQuantity: 2, feeUSD: 0.25, feeSource: "fixture fee" })];
    render(<TimeValueObservationPanel legs={[historyLeg("p", "sell", history)]} />);
    fireEvent.click(screen.getByText("価格推移・計算履歴 2件"));
    const first = screen.getByRole("img", { name: /2026-09-22 価格 \$10\.00/ });
    const second = screen.getByRole("img", { name: /2026-09-23 価格 \$5\.00/ });
    expect(first.firstElementChild).toHaveStyle({ width: "100%" });
    expect(second.firstElementChild).toHaveStyle({ width: "50%" });
    expect(second.querySelector(".bg-emerald-500")).toHaveStyle({ width: "40%" });
    expect(second.querySelector(".bg-rose-400")).toHaveStyle({ width: "60%" });
    screen.getAllByText("計算根拠").forEach((summary) => fireEvent.click(summary));
    expect(screen.getAllByText(/価格種別 Ask/).length).toBe(2);
    expect(screen.getByText(/数量変更（前回 2枚）/)).toBeInTheDocument();
    expect(screen.getAllByText(/費用 \$0\.25/).length).toBe(2);
  });

  it("keeps the scale independent for each option leg", () => {
    const call = historyLeg("call", "buy", [historyObservation("call-1", "2026-09-23", 20, 10, 10)]);
    const put = historyLeg("put", "sell", [historyObservation("put-1", "2026-09-24", 5, 1, 4)]);
    render(<TimeValueObservationPanel legs={[call, put]} />);
    screen.getAllByText("価格推移・計算履歴 1件").forEach((summary) => fireEvent.click(summary));
    expect(screen.getByRole("img", { name: /2026-09-23 価格 \$20\.00/ }).firstElementChild).toHaveStyle({ width: "100%" });
    expect(screen.getByRole("img", { name: /2026-09-24 価格 \$5\.00/ }).firstElementChild).toHaveStyle({ width: "100%" });
  });

  it.each([
    ["zero", historyObservation("zero", "2026-09-23", 0, 0, 0)],
    ["missing", historyObservation("missing", "2026-09-23", 4, undefined, undefined, { decompositionState: "missing" })],
    ["negative time", historyObservation("negative", "2026-09-23", 4, 5, -1, { decompositionState: "inconsistent" })],
    ["inconsistent total", historyObservation("mismatch", "2026-09-23", 4, 1, 1)],
    ["non-finite", historyObservation("nan", "2026-09-23", Number.NaN, 1, 1)],
  ])("does not draw false decomposition for %s", (_label, item) => {
    render(<TimeValueObservationPanel legs={[historyLeg("p", "sell", [item])]} />);
    fireEvent.click(screen.getByText("価格推移・計算履歴 1件"));
    const panel = screen.getByRole("region", { name: "時間価値・反対売買判断" });
    expect(panel.querySelectorAll(".bg-emerald-500, .bg-rose-400")).toHaveLength(0);
    expect(screen.queryByText(/\$NaN/)).not.toBeInTheDocument();
    if (item.optionPriceUSD === 0) expect(screen.getByText("価格0・バーなし")).toBeInTheDocument();
    else expect(screen.getAllByText(/未確認|分解未確認|価格未確認/).length).toBeGreaterThan(0);
  });

  it("matches the current decomposition colors and keeps empty-history guidance", () => {
    const saved = { ...historyLeg("saved", "buy", []), closeCostUSD: 4 };
    render(<TimeValueObservationPanel legs={[saved]} currentUnderlyingPriceUSD={99} />);
    const bar = screen.getByRole("img", { name: /現在値: 本質的価値 \$1\.00、時間価値 \$3\.00/ });
    expect(bar.querySelector(".bg-emerald-500")).toHaveStyle({ width: "25%" });
    expect(bar.querySelector(".bg-rose-400")).toHaveStyle({ width: "75%" });
    expect(screen.getAllByText("記録は次回の価格反映から").length).toBeGreaterThan(0);
    expect(screen.getByText("緑: 本質価値 / 赤: 時間価値")).toBeInTheDocument();
  });
});
