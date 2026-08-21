import { describe, expect, it } from "vitest";
import { resolveCurrentEstimateFx } from "./currentEstimateFx";
import type { TradeSimulation } from "@/types/domain";

const simulation = { referenceFxRateJPY: 151, fxRateJPY: 152 } as TradeSimulation;

describe("current estimate FX resolver", () => {
  it("prioritizes a valid read-only USDJPY quote and rejects invalid candidates", () => {
    const quote = { pair: "USDJPY" as const, rate: 150, date: "2026-08-14", source: "local_proxy" as const, fetchedAt: "2026-08-14T00:00:00.000Z" };
    expect(resolveCurrentEstimateFx(simulation, quote)).toMatchObject({ kind: "resolved", rateJPYPerUSD: 150, source: "readonly_current_quote", provider: "local_proxy" });
    expect(resolveCurrentEstimateFx(simulation, { ...quote, pair: "EURJPY" as never })).toMatchObject({ rateJPYPerUSD: 151, source: "saved_reference_fx" });
    expect(resolveCurrentEstimateFx(simulation, { ...quote, rate: 0 })).toMatchObject({ rateJPYPerUSD: 151, source: "saved_reference_fx" });
  });
});
