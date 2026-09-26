import { describe, expect, it } from "vitest";
import type { TradeSimulation } from "@/types/domain";
import type { SaxoOptionPremiumCandidate } from "@/features/saxo/saxoAccountSync";
import { getCurrentOptionPriceTargets, createCurrentOptionPricePreviewRow, applyCurrentOptionPricePreview } from "./bulkOptionPrice";
import { diagnosePriceUpdate } from "./priceUpdateDiagnostic";
const at = "2026-09-26T00:00:00Z";
const sim: TradeSimulation = { id: "parent", name: "TEST", ticker: "TEST", strategyType: "bull_call_spread", status: "open", accountCode: "N", accountCurrency: "USD", accountEnvironment: "PROD_N_USD_SETTLEMENT", currentPriceUSD: 110, fxRateJPY: 150, entryDate: "2026-09-01", expiryDate: "2026-12-18", dte: 83, stockPosition: null, brokerMarginJPY: 0, marginBufferMultiplier: 1, denominatorMode: "custom", taxProfileId: "none_nisa_or_tax_free_comparison", optionLegs: [
  { id: "a", type: "call", side: "buy", strikeUSD: 100, premiumUSD: 10, quantity: 1, contractSize: 100, expiryDate: "2026-12-18" },
  { id: "b", type: "call", side: "sell", strikeUSD: 120, premiumUSD: 2, quantity: 1, contractSize: 100, expiryDate: "2026-12-18" },
] };
const quote = (bid: number | undefined, ask: number | undefined, quality = "Indicative"): SaxoOptionPremiumCandidate => ({ status: "available", classification: "available", message: "fixture", environment: "live", source: "fixture", fetchedAt: at, symbol: "TEST", optionType: "call", strike: 100, expiry: "2026-12-18", bid, ask, quoteDiagnostics: { priceTypeBid: quality, priceTypeAsk: quality } });
const rows = (a = quote(8, 12), b = quote(2, 4)) => getCurrentOptionPriceTargets([sim]).map((target, i) => createCurrentOptionPricePreviewRow(target, i ? b : a));
describe("typed price update diagnostics", () => {
  it("keeps a received but one-sided first quote distinct from API failure and a saved quote", () => {
    const diagnostic = diagnosePriceUpdate(sim, rows(quote(undefined, 12)))!;
    expect(diagnostic).toMatchObject({ acquisition: "received", evaluation: "unavailable", adoption: "blocked", storage: "none", hasSavedMid: false, summary: "中間値を取得できませんでした" });
    expect(diagnostic.reason).toContain("C買い: Bidが未取得");
    expect(diagnostic.reason).toContain("全脚");
    expect(diagnostic.legs[0].ask).toBe(12);
    expect(diagnosePriceUpdate(sim, rows({ ...quote(undefined, undefined), status: "unavailable", classification: "NoMarket" }))?.legs[0]).toMatchObject({ acquisition: "received", evaluation: "unavailable" });
    expect(diagnosePriceUpdate(sim, [{ target: getCurrentOptionPriceTargets([sim])[0], status: "unavailable", reason: "API timeout" }])?.legs[0]).toMatchObject({ acquisition: "failed", reason: "API timeout" });
  });
  it("separates preview, confirmation, atomic adoption and actual persistence", () => {
    const old = rows(quote(8, 12, "OldIndicative"), quote(2, 4, "OldIndicative"));
    expect(diagnosePriceUpdate(sim, old)?.summary).toBe("参考価格の使用確認待ち");
    expect(diagnosePriceUpdate(sim, old, true)).toMatchObject({ adoption: "eligible", storage: "not_applied" });
    const saved = applyCurrentOptionPricePreview([sim], old, { includeConfirmedReferences: true, capturedAt: at })[0];
    expect(diagnosePriceUpdate(saved, old, false, { simulationIds: [sim.id], referenceConfirmed: true })).toMatchObject({ storage: "updated", summary: "中間値を更新しました" });
    expect(diagnosePriceUpdate(saved, rows(quote(undefined, 12)))).toMatchObject({ storage: "previous", hasSavedMid: true, summary: "今回未更新・保存済み参考値" });
    expect(diagnosePriceUpdate(JSON.parse(JSON.stringify(saved)), [])).toBeUndefined();
  });
  it("allows explicit Bid0 for Mid while refusing missing/invalid/unknown quality and mismatched targets", () => {
    expect(diagnosePriceUpdate(sim, rows(quote(0, 2)))?.evaluation).toBe("ready");
    for (const candidate of [quote(undefined, 2), quote(-1, 2), quote(3, 2), quote(1, 2, "NoAccess"), quote(1, 2, "unknown")]) expect(diagnosePriceUpdate(sim, rows(candidate))?.evaluation).toBe("unavailable");
    const mismatch = rows(); mismatch[0] = { ...mismatch[0], target: { ...mismatch[0].target, quantity: 2 } };
    expect(diagnosePriceUpdate(sim, mismatch)?.legs[0].acquisition).toBe("unmatched");
    expect(diagnosePriceUpdate(sim, [rows()[0], rows()[0], rows()[1]])?.legs[0].acquisition).toBe("unmatched");
  });
  it("does not write either parent Mid on a failed sibling or confuse stale adoption with saved success", () => {
    const preview = rows(quote(undefined, 12));
    const applied = applyCurrentOptionPricePreview([sim], preview)[0];
    expect(applied.optionLegs.every(leg => !leg.referenceQuote)).toBe(true);
    const changed = { ...sim, optionLegs: sim.optionLegs.map(leg => ({ ...leg, quantity: 2 })) };
    expect(diagnosePriceUpdate(changed, rows(), true, { simulationIds: [sim.id], referenceConfirmed: true })?.storage).not.toBe("updated");
  });
});
