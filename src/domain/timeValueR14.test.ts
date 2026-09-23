import { describe, expect, it } from "vitest";
import { buildOptionValueObservation, calculateOptionValueDecomposition, getTimeValueObservationTimeline, upsertTimeValueObservation } from "@/domain/timeValue";
import { buildLongOptionValueSnapshot } from "@/domain/optionValueSnapshot";

describe("R14 option time-value observations", () => {
  it("stops on negative time value without clamping", () => {
    expect(calculateOptionValueDecomposition({ optionType: "call", optionPriceUSD: 2, underlyingPriceUSD: 110, strikeUSD: 100 })).toMatchObject({ state: "inconsistent", rawTimeValueUSD: -8 });
    const legacy = buildLongOptionValueSnapshot({ snapshotDate: "2026-09-23", underlyingPrice: 110, optionExitPrice: 2, strike: 100, expiry: "2026-10-16", dte: 23, optionType: "call", source: "saxo" });
    expect(legacy?.timeValue).toBe(-8);
    expect(legacy?.timeValueRatio).toBeUndefined();
  });
  it("keeps sell-leg and explicit zero observations idempotent", () => {
    const first = buildOptionValueObservation({ observationId: "obs-1", batchId: "batch-1", snapshotDate: "2026-09-23", side: "sell", optionType: "put", optionPriceUSD: 3, underlyingPriceUSD: 105, strikeUSD: 100, expiry: "2026-10-16", quantity: 1, contractSize: 100, selectedField: "ask", source: "saxo" });
    expect(first?.timeValueUSD).toBe(3);
    const replacement = buildOptionValueObservation({ observationId: "obs-2", snapshotDate: "2026-09-23", side: "sell", optionType: "put", optionPriceUSD: 0, underlyingPriceUSD: 105, strikeUSD: 100, expiry: "2026-10-16", quantity: 1, contractSize: 100, source: "saxo" });
    expect(upsertTimeValueObservation([first!], replacement!)[0]).toMatchObject({ observationId: "obs-2", decompositionState: "zero_price" });
  });
  it("uses call/put intrinsic formulas without changing the option price basis", () => {
    expect(calculateOptionValueDecomposition({ optionType: "call", optionPriceUSD: 13, underlyingPriceUSD: 110, strikeUSD: 100 })).toMatchObject({ state: "available", intrinsicValueUSD: 10, timeValueUSD: 3 });
    expect(calculateOptionValueDecomposition({ optionType: "put", optionPriceUSD: 3, underlyingPriceUSD: 105, strikeUSD: 100 })).toMatchObject({ state: "available", intrinsicValueUSD: 0, timeValueUSD: 3 });
    expect(calculateOptionValueDecomposition({ optionType: "put", optionPriceUSD: 7, underlyingPriceUSD: 95, strikeUSD: 100 })).toMatchObject({ state: "available", intrinsicValueUSD: 5, timeValueUSD: 2 });
  });
  it("does not copy current quantity or multiplier into legacy history and marks quantity changes", () => {
    const legacy = getTimeValueObservationTimeline({ id: "legacy-leg", type: "put", side: "sell", strikeUSD: 100, premiumUSD: 8, quantity: 2, contractSize: 100, expiryDate: "2026-10-16", valueSnapshots: [{ snapshotDate: "2026-09-22", underlyingPrice: 105, optionExitPrice: 3, strike: 100, expiry: "2026-10-16", dte: 24, intrinsicValue: 0, timeValue: 3, source: "saxo" }] });
    expect(legacy[0]).toMatchObject({ quantity: undefined, contractSize: undefined });
    const first = buildOptionValueObservation({ observationId: "a", snapshotDate: "2026-09-22", side: "sell", optionType: "put", optionPriceUSD: 3, underlyingPriceUSD: 105, strikeUSD: 100, expiry: "2026-10-16", quantity: 2, contractSize: 100, source: "saxo" });
    const next = buildOptionValueObservation({ observationId: "b", snapshotDate: "2026-09-23", side: "sell", optionType: "put", optionPriceUSD: 2.5, underlyingPriceUSD: 105, strikeUSD: 100, expiry: "2026-10-16", quantity: 1, contractSize: 100, source: "saxo" });
    expect(upsertTimeValueObservation([first!], next!)[1]).toMatchObject({ quantityChanged: true, previousQuantity: 2 });
  });
  it("recomputes legacy raw time value and keeps explicit zero distinct", () => {
    const timeline = getTimeValueObservationTimeline({ id: "legacy-raw", type: "call", side: "buy", strikeUSD: 100, premiumUSD: 8, quantity: 1, contractSize: 100, expiryDate: "2026-10-16", valueSnapshots: [
      { snapshotDate: "2026-09-21", underlyingPrice: 110, optionExitPrice: 2, strike: 100, expiry: "2026-10-16", dte: 25, intrinsicValue: 10, timeValue: 0, source: "saxo" },
      { snapshotDate: "2026-09-22", underlyingPrice: 110, optionExitPrice: 0, strike: 100, expiry: "2026-10-16", dte: 24, intrinsicValue: 10, timeValue: 0, source: "saxo" },
    ] });
    expect(timeline[0]).toMatchObject({ rawTimeValueUSD: -8, decompositionState: "inconsistent" });
    expect(timeline[0].timeValueUSD).toBeUndefined();
    expect(timeline[1]).toMatchObject({ rawTimeValueUSD: -10, decompositionState: "zero_price" });
    expect(timeline[1].timeValueUSD).toBeUndefined();
  });
  it("does not duplicate one source observation when its captured day is corrected", () => {
    const first = buildOptionValueObservation({ observationId: "stable-source", evidenceRevision: "rev-1", snapshotDate: "2026-09-22", side: "sell", optionType: "put", optionPriceUSD: 3, underlyingPriceUSD: 105, strikeUSD: 100, expiry: "2026-10-16", quantity: 1, contractSize: 100, source: "saxo" });
    const corrected = buildOptionValueObservation({ observationId: "stable-source", evidenceRevision: "rev-1", snapshotDate: "2026-09-23", side: "sell", optionType: "put", optionPriceUSD: 2.9, underlyingPriceUSD: 105, strikeUSD: 100, expiry: "2026-10-16", quantity: 1, contractSize: 100, source: "saxo" });
    expect(upsertTimeValueObservation([first!], corrected!)).toHaveLength(1);
    expect(upsertTimeValueObservation([first!], corrected!)[0].snapshotDate).toBe("2026-09-23");
  });
  it("keeps distinct daily quotes when only the accounting evidence revision is shared", () => {
    const first = buildOptionValueObservation({ observationId: "quote-1", evidenceRevision: "same-entry", snapshotDate: "2026-09-22", side: "sell", optionType: "put", optionPriceUSD: 3, underlyingPriceUSD: 105, strikeUSD: 100, expiry: "2026-10-16", quantity: 1, contractSize: 100, source: "saxo" });
    const next = buildOptionValueObservation({ observationId: "quote-2", evidenceRevision: "same-entry", snapshotDate: "2026-09-23", side: "sell", optionType: "put", optionPriceUSD: 2.8, underlyingPriceUSD: 105, strikeUSD: 100, expiry: "2026-10-16", quantity: 1, contractSize: 100, source: "saxo" });
    expect(upsertTimeValueObservation([first!], next!)).toHaveLength(2);
  });
});
