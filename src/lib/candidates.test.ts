import { describe, expect, it } from "vitest";
import { parseCandidateCsv, parseCandidateImport, parseCompactNumber, parsePercent, parseUsdPrice } from "./candidates";

describe("candidate parsers", () => {
  it("parses compatible numeric strings without zero filling", () => {
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
    expect(result.candidates[0].source).toBe("legacy_tradingview");
  });

  it("uses moomoo/manual-oriented source names for new candidate file imports", () => {
    const csv = "Rank,Symbol,Company,Price,Score,SuggestedUse\n1,NVDA,NVIDIA,110 USD,80,screening candidate";
    const csvResult = parseCandidateImport(csv, "moomoo_candidates.csv", "2026-06-23T00:00:00.000Z");
    const jsonResult = parseCandidateImport(
      JSON.stringify([{ Rank: "1", Symbol: "MSFT", Company: "Microsoft", Price: "500 USD", Score: "70", SuggestedUse: "screening candidate" }]),
      "screening_candidates.json",
      "2026-06-23T00:00:00.000Z",
    );

    expect(csvResult.candidates[0].source).toBe("moomoo_file_import");
    expect(jsonResult.candidates[0].source).toBe("manual_import");
  });

  it("keeps legacy tradingview source values compatible", () => {
    const result = parseCandidateImport(
      JSON.stringify([{ Rank: "1", Symbol: "AAPL", Company: "Apple", Price: "200 USD", Score: "60", SuggestedUse: "legacy candidate" }]),
      "tradingview_candidates.json",
      "2026-06-23T00:00:00.000Z",
    );

    expect(result.candidates[0].source).toBe("legacy_tradingview");
  });

  it("normalizes moomoo-compatible JSON into ScreeningCandidate", () => {
    const result = parseCandidateImport(
      JSON.stringify({
        schemaVersion: "us_options_screening_candidates.v1",
        source: "moomoo_file_import",
        asOf: "2026-06-23T00:00:00+09:00",
        candidates: [
          {
            symbol: "NVDA",
            name: "NVIDIA",
            market: "US",
            sector: "Technology",
            underlyingPrice: 100,
            priceAsOf: "2026-06-23T00:00:00+09:00",
            delayStatus: "delayed",
            technicalSnapshot: {
              dailyClose: 100,
              sma25: 95,
              sma50: 90,
              trendNotes: [],
              movingAverageSlopes: { ma25: "up", ma50: "up", ma200: "flat" },
              signalEvents: [
                { type: "slowkd_golden_cross", occurredAt: "2026-06-01", lookbackTradingDays: 10, strength: "normal" },
                { type: "macd_golden_cross", occurredAt: "2026-06-05", lookbackTradingDays: 7, strength: "normal" },
                { type: "ma25_50_golden_cross", occurredAt: "2026-06-10", lookbackTradingDays: 2, strength: "normal" },
              ],
            },
            optionChainQuality: { hasOptionChain: true, volume: 1000, openInterest: 5000, qualityWarnings: [] },
            candidateStrategies: [
              { strategy: "long_call", dte: 160, strikePrice: 103, premium: 8 },
              {
                strategy: "cash_secured_put_buy_to_own",
                dte: 45,
                strikePrice: 95,
                longTermHoldEligible: true,
                assignmentCapitalRequired: 9500,
                availableCash: 12000,
              },
            ],
            riskFlags: [],
            missingFields: [],
          },
        ],
      }),
      "moomoo_candidates.json",
      "2026-06-23T00:00:00.000Z",
    );

    expect(result.summary).toMatchObject({
      totalRows: 1,
      importedCount: 1,
      errorCount: 0,
      source: "moomoo_file_import",
      format: "json",
      asOf: "2026-06-23T00:00:00+09:00",
    });
    expect(result.candidates[0].screeningCandidate?.symbol).toBe("NVDA");
    expect(result.candidates[0].strategyFitResults?.map((item) => item.strategy)).toEqual([
      "long_call",
      "cash_secured_put_buy_to_own",
    ]);
    expect(result.candidates[0].technicalTimingPatterns?.[0].kind).toBe("upside_reversal_combo");
  });

  it("normalizes moomoo-compatible CSV and maps ticker to symbol", () => {
    const csv = [
      "ticker,name,market,sector,underlyingPrice,priceAsOf,delayStatus,sma25,sma50,sma200,ma25Slope,ma50Slope,ma200Slope,macdHistogram,slowK,slowD,rsi,callExpiry,callDte,callStrike,callBid,callAsk,callVolume,callOpenInterest,putExpiry,putDte,putStrike,putBid,putAsk,putVolume,putOpenInterest,impliedVolatility,longTermHoldEligible,assignmentCapitalAvailable",
      "MSFT,Microsoft,US,Technology,500,2026-06-23T00:00:00+09:00,delayed,490,480,420,up,up,flat,1.2,70,60,55,2026-08-21,60,505,20,21,100,1000,2026-08-21,60,505,19,20,100,1000,0.32,true,60000",
    ].join("\n");

    const result = parseCandidateImport(csv, "moomoo_candidates.csv", "2026-06-23T00:00:00.000Z");

    expect(result.candidates[0].symbol).toBe("MSFT");
    expect(result.candidates[0].screeningCandidate?.underlyingPrice).toBe(500);
    expect(result.candidates[0].source).toBe("moomoo_file_import");
    expect(result.candidates[0].strategyFitResults?.length).toBeGreaterThan(0);
    expect(result.candidates[0].syntheticForwardCandidates?.[0].kind).toBe("synthetic_forward");
  });

  it("keeps valid rows when another row has required-field errors", () => {
    const csv = [
      "symbol,name,market,underlyingPrice,priceAsOf",
      "AAPL,Apple,US,200,2026-06-23T00:00:00+09:00",
      "BROKEN,Broken,US,,2026-06-23T00:00:00+09:00",
    ].join("\n");

    const result = parseCandidateImport(csv, "moomoo_candidates.csv", "2026-06-23T00:00:00.000Z");

    expect(result.candidates).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]).toMatchObject({ rowNumber: 2, field: "underlyingPrice" });
    expect(result.summary).toMatchObject({ totalRows: 2, importedCount: 1, errorCount: 1 });
  });

  it("does not keep credentials, account numbers, api keys, or local paths in raw source rows", () => {
    const csv = [
      "symbol,name,market,underlyingPrice,priceAsOf,apiKey,accountNumber,notes",
      "NVDA,NVIDIA,US,100,2026-06-23T00:00:00+09:00,secret-api-key,123456789,/Users/motomichi/private.csv",
    ].join("\n");

    const result = parseCandidateImport(csv, "moomoo_candidates.csv", "2026-06-23T00:00:00.000Z");
    const serialized = JSON.stringify(result.candidates[0].rawSourceRow);

    expect(serialized).not.toContain("secret-api-key");
    expect(serialized).not.toContain("123456789");
    expect(serialized).not.toContain("/Users/");
    expect(serialized).toContain("[removed-local-path]");
  });
});
