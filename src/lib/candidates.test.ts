import { describe, expect, it } from "vitest";
import { parseCandidateCsv, parseCandidateImport, parseCompactNumber, parsePercent, parseUsdPrice } from "./candidates";

describe("candidate parsers", () => {
  it("parses TradingView numeric strings without zero filling", () => {
    expect(parseUsdPrice("1,065.00 USD")).toBe(1065);
    expect(parsePercent("−1.07%")).toBe(-1.07);
    expect(parseCompactNumber("13.38 M")).toBe(13_380_000);
    expect(parseCompactNumber("4.62 T USD")).toBe(4_620_000_000_000);
    expect(parseCompactNumber("958.67 B USD")).toBe(958_670_000_000);
    expect(parseUsdPrice("not a price")).toBeUndefined();
  });

  it("parses BOM CSV rows with quoted commas", () => {
    const rows = parseCandidateCsv(
      "\uFEFFRank,Symbol,Company,Price,ChangePercent,Volume,RelativeVolume,MarketCap,PER,Sector,AnalystRating,NextEarningsDate,EarningsWarning,Score,SuggestedUse,Memo\n" +
        '1,LLY,Eli Lilly and Company,"1,065.00 USD",+2.24%,3.47 M,1.17,1 T USD,38.34,Healthcare,Buy,,,65,Covered Call / Cash Secured Put candidate,manual check',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].Price).toBe("1,065.00 USD");
  });

  it("normalizes candidate imports and keeps raw source rows", () => {
    const result = parseCandidateImport(
      JSON.stringify([
        {
          Rank: "1",
          Symbol: "GOOG",
          Company: "Alphabet Inc. Class C",
          Price: "379.38 USD",
          ChangePercent: "−1.07%",
          Volume: "13.38 M",
          RelativeVolume: "0.78",
          MarketCap: "4.62 T USD",
          PER: "28.94",
          Sector: "Technology",
          AnalystRating: "Strong buy",
          NextEarningsDate: "",
          EarningsWarning: "",
          Score: "75",
          SuggestedUse: "Covered Call / Cash Secured Put candidate",
          Memo: "manual check",
        },
      ]),
      "tradingview_candidates.json",
      "2026-05-28T00:00:00.000Z",
    );

    expect(result.candidates[0]).toMatchObject({
      symbol: "GOOG",
      priceUSD: 379.38,
      changePercent: -1.07,
      volume: 13_380_000,
      marketCapUSD: 4_620_000_000_000,
      score: 75,
    });
    expect(result.candidates[0].rawSourceRow?.Price).toBe("379.38 USD");
  });
});
