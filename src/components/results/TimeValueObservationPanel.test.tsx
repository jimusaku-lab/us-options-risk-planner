import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimeValueObservationPanel } from "./TimeValueObservationPanel";
import type { OptionLeg } from "@/types/domain";

const leg = (id: string, side: "buy" | "sell", state: "available" | "inconsistent"): OptionLeg => ({ id, type: "put", side, strikeUSD: 100, premiumUSD: 3, quantity: 1, contractSize: 100, expiryDate: "2026-10-16", valueObservations: [{ observationId: id, batchId: `batch-${id}`, snapshotDate: "2026-09-23", side, optionType: "put", strikeUSD: 100, expiryDate: "2026-10-16", quantity: 1, contractSize: 100, optionPriceUSD: state === "available" ? 2 : 1, underlyingPriceUSD: 105, intrinsicValueUSD: 0, rawTimeValueUSD: state === "available" ? 2 : -19, timeValueUSD: state === "available" ? 2 : undefined, decompositionState: state, reason: state === "inconsistent" ? "価格と株価の整合を確認" : undefined, source: "saxo", calculationVersion: "r14" }] });

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
    const saved = { ...leg("saved", "buy", "available"), closeCostUSD: 13 };
    saved.valueObservations = undefined;
    render(<TimeValueObservationPanel legs={[saved]} currentUnderlyingPriceUSD={110} />);
    expect(screen.getAllByText(/時点未確認の参考分解/).length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: /本質的価値 \$10\.00、時間価値 \$3\.00/ })).toBeInTheDocument();
    expect(screen.getByText(/価格推移・計算履歴 0件/)).toBeInTheDocument();
  });
});
