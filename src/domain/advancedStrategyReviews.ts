import { getConservativeEntryPrice, evaluateOptionLiquidity } from "@/domain/optionLiquidity";
import type {
  AdvancedStrategyReview,
  ChartRegime,
  OptionLegDraft,
  PublicOptionCandidateInput,
  PublicScreeningCandidateInput,
  PublicStrategyFitLevel,
  StrategyCandidateKind,
} from "@/types/screening";

type AdvancedReviewBuildInput = Pick<
  PublicScreeningCandidateInput,
  "symbol" | "underlyingPrice" | "chartAnalysis" | "optionCandidates" | "capital" | "existingPosition" | "event"
>;

type LegIntent = {
  optionType: "call" | "put";
  side: "buy" | "sell";
  strikeMin?: number;
  strikeMax?: number;
  dteMin?: number;
  dteMax?: number;
  sameExpiry?: string;
  sameStrike?: number;
};

type AdvancedReviewParams = Omit<
  AdvancedStrategyReview,
  "id" | "symbol" | "chartRegime" | "confidence" | "scenarios" | "reasons" | "warnings" | "missingFields" | "manualReviewReasons"
> & {
  scenarios: Array<string | undefined>;
  reasons: Array<string | undefined>;
  warnings: Array<string | undefined>;
  missingFields: Array<string | undefined>;
  manualReviewReasons: Array<string | undefined>;
};

const advancedStrategyOrder: StrategyCandidateKind[] = [
  "wheel",
  "short_strangle_covered",
  "short_strangle_advanced_review",
  "synthetic_forward",
  "combo",
  "itm_short_put_buy_to_own",
  "long_straddle_event",
  "protective_collar",
];

export function buildAdvancedStrategyReviewsForCandidate(input: AdvancedReviewBuildInput): AdvancedStrategyReview[] {
  const reviews = [
    buildWheelReview(input),
    buildShortStrangleReview(input),
    buildSyntheticForwardReview(input),
    buildComboReview(input),
    buildItmShortPutReview(input),
    buildLongStraddleEventReview(input),
    buildProtectiveCollarReview(input),
  ];
  return reviews.filter((review): review is AdvancedStrategyReview => Boolean(review));
}

export function getAdvancedStrategyOrder(): StrategyCandidateKind[] {
  return advancedStrategyOrder;
}

function buildWheelReview(input: AdvancedReviewBuildInput): AdvancedStrategyReview | undefined {
  const price = input.underlyingPrice;
  const putLeg = findLeg(input, { optionType: "put", side: "sell", strikeMin: ratio(price, 0.9), strikeMax: ratio(price, 0.97), dteMin: 30, dteMax: 90 });
  const requiredCapitalUSD = isFiniteNumber(putLeg?.strikePrice) ? putLeg.strikePrice * 100 : undefined;
  const availableCashUSD = availableCapital(input);
  const insufficientCapital = isFiniteNumber(requiredCapitalUSD) && isFiniteNumber(availableCashUSD) && availableCashUSD < requiredCapitalUSD;
  const bearish = isBearish(input.chartAnalysis?.regime);
  if (!putLeg && !input.chartAnalysis) return undefined;
  return makeReview(input, {
    strategy: "wheel",
    level: bearish || insufficientCapital ? "avoid" : "manual_review_required",
    legs: compact([putLeg]),
    requiredCapitalUSD,
    maxLossUSD: isFiniteNumber(requiredCapitalUSD) && isFiniteNumber(putLeg?.conservativePrice) ? Math.max(0, requiredCapitalUSD - putLeg.conservativePrice * 100) : undefined,
    effectiveAcquisitionCostUSD: isFiniteNumber(putLeg?.strikePrice) && isFiniteNumber(putLeg?.conservativePrice) ? putLeg.strikePrice - putLeg.conservativePrice : undefined,
    scenarios: ["start_with_short_put", "covered_call_after_assignment", "watch_only"],
    reasons: ["P売りから割当後カバードコールへ移るサイクルとして確認します。"],
    warnings: [
      "単発建玉ではなくサイクル管理として手動確認します。",
      bearish ? "下落加速局面のためwheel開始候補にしません。" : undefined,
      insufficientCapital ? "100株取得資金が不足しています。" : undefined,
    ],
    missingFields: [
      !putLeg ? "optionCandidates.shortPut" : undefined,
      !isFiniteNumber(availableCashUSD) ? "capital.assignmentCapitalAvailableUSD" : undefined,
    ],
    manualReviewReasons: ["本当に100株保有してよい銘柄か、割当後のカバードコール移行を確認してください。"],
  });
}

function buildShortStrangleReview(input: AdvancedReviewBuildInput): AdvancedStrategyReview | undefined {
  const price = input.underlyingPrice;
  const callLeg = findLeg(input, { optionType: "call", side: "sell", strikeMin: ratio(price, 1.03), dteMin: 14, dteMax: 30 });
  const putLeg = findLeg(input, {
    optionType: "put",
    side: "sell",
    strikeMax: ratio(price, 0.97),
    dteMin: 14,
    dteMax: 30,
    sameExpiry: callLeg?.expiry,
  });
  const stockShares = stockSharesFor(input);
  const covered = isFiniteNumber(stockShares) && stockShares >= 100;
  const putRequiredCapital = isFiniteNumber(putLeg?.strikePrice) ? putLeg.strikePrice * 100 : undefined;
  const availableCashUSD = availableCapital(input);
  const putCapitalShortage = isFiniteNumber(putRequiredCapital) && isFiniteNumber(availableCashUSD) && availableCashUSD < putRequiredCapital;
  const strategy: StrategyCandidateKind = covered ? "short_strangle_covered" : "short_strangle_advanced_review";
  if (!callLeg && !putLeg && input.chartAnalysis?.regime !== "range_neutral") return undefined;
  return makeReview(input, {
    strategy,
    level: putCapitalShortage ? "avoid" : "manual_review_required",
    legs: compact([callLeg, putLeg]),
    netPremiumUSD: sumPrices([callLeg, putLeg]),
    requiredCapitalUSD: putRequiredCapital,
    stockEquivalentNotionalUSD: isFiniteNumber(price) ? price * 200 : undefined,
    breakEvenUpperUSD: isFiniteNumber(callLeg?.strikePrice) && isFiniteNumber(callLeg?.conservativePrice) && isFiniteNumber(putLeg?.conservativePrice)
      ? callLeg.strikePrice + callLeg.conservativePrice + putLeg.conservativePrice
      : undefined,
    breakEvenLowerUSD: isFiniteNumber(putLeg?.strikePrice) && isFiniteNumber(callLeg?.conservativePrice) && isFiniteNumber(putLeg?.conservativePrice)
      ? putLeg.strikePrice - callLeg.conservativePrice - putLeg.conservativePrice
      : undefined,
    scenarios: ["レンジ内: 合計プレミアム確認", "上抜け: コール側の株カバー確認", "下抜け: P割当資金確認"],
    reasons: ["横ばいレンジ候補をカバードコール + P売りとして比較します。"],
    warnings: [
      covered ? undefined : "naked_call_risk: 100株カバーが確認できないため通常候補にしません。",
      putCapitalShortage ? "P割当資金が不足しています。" : undefined,
      callLeg?.expiry && putLeg?.expiry && callLeg.expiry !== putLeg.expiry ? "同一満期ではありません。" : undefined,
    ],
    missingFields: [
      !callLeg ? "optionCandidates.shortCall" : undefined,
      !putLeg ? "optionCandidates.shortPut" : undefined,
      covered ? undefined : "capital.stockShares",
      !isFiniteNumber(availableCashUSD) ? "capital.assignmentCapitalAvailableUSD" : undefined,
    ],
    manualReviewReasons: ["裸コール化しないこと、最大200株相当の資金枠、同一満期、決算日を確認してください。"],
  });
}

function buildSyntheticForwardReview(input: AdvancedReviewBuildInput): AdvancedStrategyReview | undefined {
  const price = input.underlyingPrice;
  const callLeg = findLeg(input, { optionType: "call", side: "buy", strikeMin: ratio(price, 0.98), strikeMax: ratio(price, 1.05), dteMin: 30 });
  const putLeg = findLeg(input, {
    optionType: "put",
    side: "sell",
    strikeMin: callLeg?.strikePrice,
    strikeMax: callLeg?.strikePrice,
    sameExpiry: callLeg?.expiry,
  });
  if (!callLeg && !putLeg && !isBullish(input.chartAnalysis?.regime)) return undefined;
  return makeReview(input, {
    strategy: "synthetic_forward",
    level: "manual_review_required",
    legs: compact([callLeg, putLeg]),
    netPremiumUSD: isFiniteNumber(callLeg?.conservativePrice) || isFiniteNumber(putLeg?.conservativePrice)
      ? (callLeg?.conservativePrice ?? 0) - (putLeg?.conservativePrice ?? 0)
      : undefined,
    requiredCapitalUSD: isFiniteNumber(putLeg?.strikePrice) ? putLeg.strikePrice * 100 : undefined,
    stockEquivalentNotionalUSD: isFiniteNumber(price) ? price * 100 : undefined,
    breakEvenUpperUSD: isFiniteNumber(callLeg?.strikePrice) && isFiniteNumber(callLeg?.conservativePrice) && isFiniteNumber(putLeg?.conservativePrice)
      ? callLeg.strikePrice + callLeg.conservativePrice - putLeg.conservativePrice
      : undefined,
    scenarios: ["上昇時: 株式同等のデルタを狙う", "下落時: コール損失とP割当リスクを同時に確認"],
    reasons: ["Call買いAskとPut売りBidの組み合わせをシンセティックとして比較します。"],
    warnings: ["fit相当でも上級レビューとして扱い、自動建玉化しません。"],
    missingFields: [!callLeg ? "optionCandidates.longCall" : undefined, !putLeg ? "optionCandidates.shortPutSameExpiryStrike" : undefined],
    manualReviewReasons: ["同一満期・同一strike、P割当資金、下落時の複合損失を確認してください。"],
  });
}

function buildComboReview(input: AdvancedReviewBuildInput): AdvancedStrategyReview | undefined {
  const price = input.underlyingPrice;
  const callLeg = findLeg(input, { optionType: "call", side: "buy", strikeMin: ratio(price, 1), strikeMax: ratio(price, 1.05), dteMin: 30 });
  const putLeg = findLeg(input, {
    optionType: "put",
    side: "sell",
    strikeMin: ratio(price, 0.9),
    strikeMax: ratio(price, 0.97),
    sameExpiry: callLeg?.expiry,
  });
  if (!callLeg && !putLeg && !isBullish(input.chartAnalysis?.regime)) return undefined;
  return makeReview(input, {
    strategy: "combo",
    level: "manual_review_required",
    legs: compact([callLeg, putLeg]),
    netPremiumUSD: isFiniteNumber(callLeg?.conservativePrice) || isFiniteNumber(putLeg?.conservativePrice)
      ? (callLeg?.conservativePrice ?? 0) - (putLeg?.conservativePrice ?? 0)
      : undefined,
    requiredCapitalUSD: isFiniteNumber(putLeg?.strikePrice) ? putLeg.strikePrice * 100 : undefined,
    scenarios: ["school_same_expiry", "practical_split_expiry", "上昇時: Call買い優位", "下落時: P割当資金を確認"],
    reasons: ["上昇期待と買いたいP売りを組み合わせて比較します。"],
    warnings: ["比較カードに留め、複数脚の自動建玉案にはしません。"],
    missingFields: [!callLeg ? "optionCandidates.longCall" : undefined, !putLeg ? "optionCandidates.shortPut" : undefined],
    manualReviewReasons: ["単体Call買い、P売り単体、同一満期/分割満期の違いを確認してください。"],
  });
}

function buildItmShortPutReview(input: AdvancedReviewBuildInput): AdvancedStrategyReview | undefined {
  const price = input.underlyingPrice;
  const putLeg = findLeg(input, { optionType: "put", side: "sell", strikeMin: price, dteMin: 14, dteMax: 90 });
  if (!putLeg && !isBullish(input.chartAnalysis?.regime)) return undefined;
  const requiredCapitalUSD = isFiniteNumber(putLeg?.strikePrice) ? putLeg.strikePrice * 100 : undefined;
  const availableCashUSD = availableCapital(input);
  const capitalShortage = isFiniteNumber(requiredCapitalUSD) && isFiniteNumber(availableCashUSD) && availableCashUSD < requiredCapitalUSD;
  const bearish = isBearish(input.chartAnalysis?.regime);
  return makeReview(input, {
    strategy: "itm_short_put_buy_to_own",
    level: capitalShortage || bearish ? "avoid" : "manual_review_required",
    legs: compact([putLeg]),
    requiredCapitalUSD,
    maxLossUSD: isFiniteNumber(requiredCapitalUSD) && isFiniteNumber(putLeg?.conservativePrice) ? Math.max(0, requiredCapitalUSD - putLeg.conservativePrice * 100) : undefined,
    effectiveAcquisitionCostUSD: isFiniteNumber(putLeg?.strikePrice) && isFiniteNumber(putLeg?.conservativePrice) ? putLeg.strikePrice - putLeg.conservativePrice : undefined,
    scenarios: ["現物100株購入との比較", "ITMのため権利行使可能性が高い"],
    reasons: ["ITM P売りを実質取得単価でレビューします。"],
    warnings: [
      "ITMのため割当可能性が高い前提です。",
      bearish ? "下落局面ではITM P売り取得前提を候補にしません。" : undefined,
      capitalShortage ? "100株取得資金が不足しています。" : undefined,
    ],
    missingFields: [!putLeg ? "optionCandidates.itmShortPut" : undefined, !isFiniteNumber(availableCashUSD) ? "capital.assignmentCapitalAvailableUSD" : undefined],
    manualReviewReasons: ["本当にそのstrikeで100株取得してよいか確認してください。"],
  });
}

function buildLongStraddleEventReview(input: AdvancedReviewBuildInput): AdvancedStrategyReview | undefined {
  const price = input.underlyingPrice;
  const callLeg = findLeg(input, { optionType: "call", side: "buy", strikeMin: ratio(price, 0.98), strikeMax: ratio(price, 1.02), dteMin: 1, dteMax: 60 });
  const putLeg = findLeg(input, {
    optionType: "put",
    side: "buy",
    strikeMin: callLeg?.strikePrice,
    strikeMax: callLeg?.strikePrice,
    sameExpiry: callLeg?.expiry,
  });
  const totalPremium = sumPrices([callLeg, putLeg]);
  const strike = callLeg?.strikePrice ?? putLeg?.strikePrice;
  if (!callLeg && !putLeg && input.chartAnalysis?.regime !== "event_large_move_unknown") return undefined;
  return makeReview(input, {
    strategy: "long_straddle_event",
    level: callLeg && putLeg && input.event ? "manual_review_required" : "insufficient_data",
    legs: compact([callLeg, putLeg]),
    netPremiumUSD: totalPremium,
    requiredCapitalUSD: isFiniteNumber(totalPremium) ? totalPremium * 100 : undefined,
    maxLossUSD: isFiniteNumber(totalPremium) ? totalPremium * 100 : undefined,
    breakEvenUpperUSD: isFiniteNumber(strike) && isFiniteNumber(totalPremium) ? strike + totalPremium : undefined,
    breakEvenLowerUSD: isFiniteNumber(strike) && isFiniteNumber(totalPremium) ? strike - totalPremium : undefined,
    scenarios: ["イベント後大幅上昇", "イベント後大幅下落", "動かなければ合計支払プレミアムを失う"],
    reasons: ["方向不明のイベント大変動候補をCall買い + Put買いで確認します。"],
    warnings: ["IV上昇後の高いプレミアムに注意します。"],
    missingFields: [
      !callLeg ? "optionCandidates.atmCallAsk" : undefined,
      !putLeg ? "optionCandidates.atmPutAsk" : undefined,
      !input.event ? "event" : undefined,
    ],
    manualReviewReasons: ["イベント日、IV、過去イベント変動率、上下損益分岐点を確認してください。"],
  });
}

function buildProtectiveCollarReview(input: AdvancedReviewBuildInput): AdvancedStrategyReview | undefined {
  const price = input.underlyingPrice;
  const putLeg = findLeg(input, { optionType: "put", side: "buy", strikeMax: ratio(price, 0.97), dteMin: 14, dteMax: 90 });
  const callLeg = findLeg(input, { optionType: "call", side: "sell", strikeMin: ratio(price, 1.03), dteMin: 14, dteMax: 90, sameExpiry: putLeg?.expiry });
  const stockShares = stockSharesFor(input);
  const hasStock = isFiniteNumber(stockShares) && stockShares >= 100;
  if (!putLeg && !callLeg && !isBearish(input.chartAnalysis?.regime)) return undefined;
  return makeReview(input, {
    strategy: "protective_collar",
    level: hasStock ? "manual_review_required" : "avoid",
    legs: compact([putLeg, callLeg]),
    netPremiumUSD: isFiniteNumber(putLeg?.conservativePrice) || isFiniteNumber(callLeg?.conservativePrice)
      ? (putLeg?.conservativePrice ?? 0) - (callLeg?.conservativePrice ?? 0)
      : undefined,
    stockEquivalentNotionalUSD: isFiniteNumber(price) ? price * 100 : undefined,
    scenarios: ["下落時: Putで保険", "上昇時: Call strike以上の上値を渡す", "保有株向けの防御レビュー"],
    reasons: ["既存保有株の下落保険候補として確認します。"],
    warnings: [hasStock ? undefined : "既存株100株がないため新規主候補にしません。"],
    missingFields: [
      hasStock ? undefined : "existingPosition.stockShares",
      !putLeg ? "optionCandidates.longPut" : undefined,
      !callLeg ? "optionCandidates.shortCall" : undefined,
    ],
    manualReviewReasons: ["保険コスト、上値放棄、既存株の含み益/含み損を確認してください。"],
  });
}

function makeReview(
  input: AdvancedReviewBuildInput,
  params: AdvancedReviewParams,
): AdvancedStrategyReview {
  const legWarnings = params.legs.flatMap((leg) => leg.liquidityWarnings);
  const legMissing = params.legs.flatMap((leg) => leg.missingFields);
  return {
    ...params,
    id: `${input.symbol.trim().toUpperCase()}-${params.strategy}`,
    symbol: input.symbol.trim().toUpperCase(),
    chartRegime: input.chartAnalysis?.regime,
    confidence: input.chartAnalysis?.confidence,
    scenarios: unique(params.scenarios),
    reasons: unique(params.reasons),
    warnings: unique([...params.warnings, ...legWarnings, legWarnings.length ? "流動性不足または要確認のレッグがあります。" : undefined]),
    missingFields: unique([...params.missingFields, ...legMissing]),
    manualReviewReasons: unique(params.manualReviewReasons),
  };
}

function findLeg(input: AdvancedReviewBuildInput, intent: LegIntent): OptionLegDraft | undefined {
  const price = input.underlyingPrice;
  return (input.optionCandidates ?? [])
    .filter((option) => option.optionType === intent.optionType)
    .filter((option) => intent.sameExpiry === undefined || option.expiry === intent.sameExpiry)
    .filter((option) => intent.sameStrike === undefined || strike(option) === intent.sameStrike)
    .map((option) => scoredLeg(input.symbol, option, intent, price))
    .filter((item): item is { leg: OptionLegDraft; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score)[0]?.leg;
}

function scoredLeg(symbol: string, option: PublicOptionCandidateInput, intent: LegIntent, price?: number): { leg: OptionLegDraft; score: number } | undefined {
  const conservative = getConservativeEntryPrice(option, intent.side);
  const strikePrice = strike(option);
  const liquidity = evaluateOptionLiquidity(option);
  if (!isFiniteNumber(conservative.price) || !conservative.field) return undefined;
  const dte = option.dte;
  const strikeInRange =
    (intent.strikeMin === undefined || (isFiniteNumber(strikePrice) && strikePrice >= intent.strikeMin)) &&
    (intent.strikeMax === undefined || (isFiniteNumber(strikePrice) && strikePrice <= intent.strikeMax));
  const dteInRange =
    (intent.dteMin === undefined || (isFiniteNumber(dte) && dte >= intent.dteMin)) &&
    (intent.dteMax === undefined || (isFiniteNumber(dte) && dte <= intent.dteMax));
  const distanceScore = isFiniteNumber(price) && isFiniteNumber(strikePrice) ? Math.max(0, 20 - Math.abs(strikePrice - price)) : 0;
  const score =
    (strikeInRange ? 40 : -20) +
    (dteInRange ? 30 : -10) +
    (liquidity.level === "ok" ? 20 : liquidity.level === "watch" ? 5 : -30) +
    distanceScore +
    Math.min(10, (option.volume ?? 0) / 50) +
    Math.min(10, (option.openInterest ?? 0) / 100);
  return {
    score,
    leg: {
      id: option.id ?? `${symbol}-${intent.optionType}-${intent.side}-${option.expiry ?? "unknown"}-${strikePrice ?? "unknown"}`,
      optionType: intent.optionType,
      side: intent.side,
      expiry: option.expiry,
      dte,
      strikePrice,
      conservativePrice: conservative.price,
      conservativePriceField: conservative.field,
      mid: conservative.mid,
      last: conservative.last,
      quantity: 1,
      liquidityWarnings: unique([...conservative.warnings, ...liquidity.warnings, liquidity.level === "avoid" ? "流動性不足" : undefined]),
      missingFields: unique([...conservative.missingFields, ...liquidity.missingFields]),
    },
  };
}

function availableCapital(input: AdvancedReviewBuildInput): number | undefined {
  return finitePositive(input.capital?.assignmentCapitalAvailableUSD) ?? finitePositive(input.capital?.availableCashUSD) ?? finitePositive(input.capital?.buyingPowerUSD);
}

function stockSharesFor(input: AdvancedReviewBuildInput): number | undefined {
  return finitePositive(input.existingPosition?.stockShares) ?? finitePositive(input.capital?.stockShares);
}

function strike(option: PublicOptionCandidateInput): number | undefined {
  return option.strikePrice ?? option.strike;
}

function ratio(price: number | undefined, value: number): number | undefined {
  return isFiniteNumber(price) ? price * value : undefined;
}

function sumPrices(legs: Array<OptionLegDraft | undefined>): number | undefined {
  const prices = legs.map((leg) => leg?.conservativePrice).filter(isFiniteNumber);
  return prices.length ? prices.reduce((sum, value) => sum + value, 0) : undefined;
}

function isBullish(regime?: ChartRegime): boolean {
  return regime === "bullish_continuation" || regime === "upside_reversal" || regime === "bullish_pullback";
}

function isBearish(regime?: ChartRegime): boolean {
  return regime === "bearish_breakdown" || regime === "downtrend";
}

function finitePositive(value: unknown): number | undefined {
  return isFiniteNumber(value) && value >= 0 ? value : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function compact<T>(items: Array<T | undefined>): T[] {
  return items.filter((item): item is T => item !== undefined);
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
