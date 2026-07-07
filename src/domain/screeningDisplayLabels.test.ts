import { describe, expect, it } from "vitest";
import {
  screeningDisplayItems,
  screeningDisplayLabel,
  screeningFieldLabel,
  screeningMissingFieldLabel,
  screeningStrategyLabel,
} from "./screeningDisplayLabels";

describe("screeningDisplayLabels", () => {
  it("translates screening levels, chart states, confidence, and timeframes", () => {
    expect(screeningDisplayLabel("completeness", "level_2_chart_ready")).toBe("L2 チャート確認可");
    expect(screeningDisplayLabel("chartRegime", "bullish_continuation")).toBe("上昇継続");
    expect(screeningDisplayLabel("chartRegime", "range_neutral")).toBe("レンジ・中立");
    expect(screeningDisplayLabel("chartRegime", "downtrend")).toBe("下落トレンド");
    expect(screeningDisplayLabel("chartConfidence", "medium")).toBe("中");
    expect(screeningDisplayLabel("timeframe", "daily")).toBe("日足");
    expect(screeningDisplayLabel("publicFitLevel", "insufficient_data")).toBe("データ不足");
  });

  it("translates strategies and missing field codes without changing schemas", () => {
    expect(screeningStrategyLabel("covered_call")).toBe("カバードコール");
    expect(screeningStrategyLabel("synthetic_forward")).toBe("シンセティック・フォワード");
    expect(screeningMissingFieldLabel("optionCandidates.bidAsk")).toBe("オプションBid/Ask不足");
    expect(screeningMissingFieldLabel("capital.availableCashOrRiskBudget")).toBe("利用可能資金または許容損失未入力");
    expect(screeningFieldLabel("dataSource")).toBe("データ取得元");
    expect(screeningDisplayItems("missingFields", ["optionCandidates.bidAsk", "chartAnalysis.orDailyOhlcv"])).toEqual([
      "オプションBid/Ask不足",
      "チャート分析または日足データ不足",
    ]);
  });

  it("falls back safely for unknown display codes", () => {
    expect(screeningDisplayLabel("chartRegime", "unknown_internal_code")).toContain("未対応項目");
    expect(screeningFieldLabel("rawInternalKey")).toContain("未対応項目");
    expect(screeningMissingFieldLabel("vendor.secret.path")).toContain("未対応項目");
  });
});
