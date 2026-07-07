import type {
  NumericCheck,
  RequiredCheck,
  ScreeningCandidate,
  StrategyCandidateInput,
  StrategyCandidateKind,
  StrategyFitLevel,
  StrategyFitResult,
} from "@/types/screening";

export const screeningStrategyLabels: Record<StrategyCandidateKind, string> = {
  cash_secured_put_buy_to_own: "P売り、買ってよい",
  cash_secured_put_avoid_assignment: "買わないプット売り",
  covered_call: "カバードコール",
  long_call: "コール買い",
  wheel: "ホイール",
  short_strangle: "ショートストラングル",
  short_strangle_covered: "カバー付きショートストラングル",
  short_strangle_advanced_review: "ショートストラングル上級確認",
  synthetic_forward: "シンセティック",
  combo: "コンボ",
  itm_short_put_buy_to_own: "ITM P売り取得前提",
  long_straddle_event: "イベント・ロングストラドル",
  protective_collar: "プロテクティブカラー",
};

function inRange(value: number | undefined, min: number, max: number): boolean {
  return value !== undefined && value >= min && value <= max;
}

function numericCheck(id: string, label: string, value: number | undefined, min: number, max: number): NumericCheck {
  return {
    id,
    label,
    value,
    min,
    max,
    passed: inRange(value, min, max),
  };
}

function requiredCheck(id: string, label: string, passed?: boolean): RequiredCheck {
  return { id, label, passed };
}

function missingCoreFields(input: StrategyCandidateInput, currentPrice: number | undefined): string[] {
  const missing: string[] = [];
  if (currentPrice === undefined || currentPrice <= 0) missing.push("underlyingPrice");
  if (input.dte === undefined) missing.push("dte");
  if (input.strikePrice === undefined) missing.push("strikePrice");
  return missing;
}

function optionChainMissing(candidate: ScreeningCandidate): boolean {
  return !candidate.optionChainQuality.hasOptionChain;
}

function strikeRatio(input: StrategyCandidateInput, currentPrice: number | undefined): number | undefined {
  if (currentPrice === undefined || currentPrice <= 0 || input.strikePrice === undefined) return undefined;
  return input.strikePrice / currentPrice;
}

function makeResult(params: {
  strategy: StrategyCandidateKind;
  fitLevel: StrategyFitLevel;
  reasons?: string[];
  warnings?: string[];
  missingFields?: string[];
  requiredChecks?: RequiredCheck[];
  numericChecks?: NumericCheck[];
}): StrategyFitResult {
  return {
    strategy: params.strategy,
    fitLevel: params.fitLevel,
    reasons: params.reasons ?? [],
    warnings: params.warnings ?? [],
    missingFields: params.missingFields ?? [],
    requiredChecks: params.requiredChecks ?? [],
    numericChecks: params.numericChecks ?? [],
  };
}

function applyCommonDataQuality(candidate: ScreeningCandidate, input: StrategyCandidateInput, currentPrice = candidate.underlyingPrice): StrategyFitResult | null {
  if (optionChainMissing(candidate)) {
    return makeResult({
      strategy: input.strategy,
      fitLevel: "insufficient_data",
      warnings: ["オプションチェーンが未確認のため戦略適合を判定できません。"],
      missingFields: ["optionChainQuality.hasOptionChain"],
    });
  }
  const missing = missingCoreFields(input, currentPrice);
  if (missing.length > 0) {
    return makeResult({
      strategy: input.strategy,
      fitLevel: "insufficient_data",
      warnings: ["現在株価、DTE、権利行使価格のいずれかが不足しています。"],
      missingFields: missing,
    });
  }
  return null;
}

function evaluateBuyToOwnPut(candidate: ScreeningCandidate, input: StrategyCandidateInput): StrategyFitResult {
  const common = applyCommonDataQuality(candidate, input);
  if (common) return common;
  const ratio = strikeRatio(input, candidate.underlyingPrice);
  const dte = input.dte;
  const numericChecks = [
    numericCheck("dte-30-90", "DTE 30から90日", dte, 30, 90),
    numericCheck("strike-current-0.90-0.97", "権利行使価格 / 現在株価 0.90から0.97", ratio, 0.9, 0.97),
  ];
  const requiredChecks = [
    requiredCheck("confirm-buy-100-shares", "その価格で本当に100株買ってよい銘柄か", input.longTermHoldEligible),
    requiredCheck("assignment-capital", "権利行使時の100株購入資金と余力を確認する", input.availableCash !== undefined && input.assignmentCapitalRequired !== undefined ? input.availableCash >= input.assignmentCapitalRequired : undefined),
    requiredCheck("covered-call-transition", "権利行使後にカバードコールへ移行できるか", input.coveredCallTransitionPossible),
  ];
  const fitLevel: StrategyFitLevel = numericChecks.every((check) => check.passed) ? "fit" : "watch";
  return makeResult({
    strategy: input.strategy,
    fitLevel,
    reasons: fitLevel === "fit" ? ["買いたいプット売りのDTEと権利行使価格レンジに入っています。"] : [],
    warnings: fitLevel === "watch" ? ["DTEまたは権利行使価格が買いたいプット売りの目安から外れています。"] : [],
    requiredChecks,
    numericChecks,
  });
}

function evaluateAvoidAssignmentPut(candidate: ScreeningCandidate, input: StrategyCandidateInput): StrategyFitResult {
  const common = applyCommonDataQuality(candidate, input);
  if (common) return common;
  const ratio = strikeRatio(input, candidate.underlyingPrice);
  const numericChecks = [
    numericCheck("dte-30-90", "DTE 30から90日", input.dte, 30, 90),
    numericCheck("strike-current-0.60-0.80", "権利行使価格 / 現在株価 0.60から0.80", ratio, 0.6, 0.8),
  ];
  const requiredChecks = [
    requiredCheck("profit-take-rule", "利確ルールが決まっているか", input.profitTakeRuleSet),
    requiredCheck("stop-loss-rule", "損切りルールが決まっているか", input.stopLossRuleSet),
    requiredCheck("latest-close-date", "満期1週間前までの撤退期限が決まっているか", input.latestCloseDateSet),
  ];
  const missingRequired = requiredChecks.filter((check) => check.passed === false).map((check) => check.id);
  const fitLevel: StrategyFitLevel = numericChecks.every((check) => check.passed) && missingRequired.length === 0 ? "fit" : "watch";
  return makeResult({
    strategy: input.strategy,
    fitLevel,
    reasons: numericChecks.every((check) => check.passed) ? ["買いたくないプット売りのDTEと遠い権利行使価格レンジに入っています。"] : [],
    warnings: [
      ...(numericChecks.every((check) => check.passed) ? [] : ["DTEまたは権利行使価格が買いたくないプット売りの目安から外れています。"]),
      ...(missingRequired.length > 0 ? ["利確、損切り、満期前撤退期限のいずれかが未設定です。"] : []),
    ],
    missingFields: missingRequired,
    requiredChecks,
    numericChecks,
  });
}

function evaluateCoveredCall(candidate: ScreeningCandidate, input: StrategyCandidateInput): StrategyFitResult {
  const common = applyCommonDataQuality(candidate, input);
  if (common) return common;
  const coveredShares = input.stockShares;
  if (coveredShares === undefined) {
    return makeResult({
      strategy: input.strategy,
      fitLevel: "insufficient_data",
      warnings: ["カバードコールのカバー株数が未入力です。"],
      missingFields: ["stockShares"],
    });
  }
  const ratio = strikeRatio(input, candidate.underlyingPrice);
  const dteCheck = numericCheck("dte-30-90", "DTE 30から90日", input.dte, 30, 90);
  const premiumStrikeCheck = numericCheck("premium-strike-1.03-1.05", "プレミアム重視の権利行使価格 / 現在株価 1.03から1.05", ratio, 1.03, 1.05);
  const capitalGainStrikeCheck = numericCheck("capital-gain-strike-1.20-1.30", "値上がり益重視の権利行使価格 / 現在株価 1.20から1.30", ratio, 1.2, 1.3);
  const strikeBelowCost = input.stockCostBasis !== undefined && input.strikePrice !== undefined && input.strikePrice < input.stockCostBasis;
  const hasCover = coveredShares >= 100;
  if (!hasCover) {
    return makeResult({
      strategy: input.strategy,
      fitLevel: "avoid",
      warnings: ["100株のカバー根拠がないため、裸コール化リスクがあります。"],
      requiredChecks: [requiredCheck("covered-shares", "100株のカバーがあるか", false)],
      numericChecks: [dteCheck, premiumStrikeCheck, capitalGainStrikeCheck],
    });
  }
  const strikeFits = premiumStrikeCheck.passed || capitalGainStrikeCheck.passed;
  return makeResult({
    strategy: input.strategy,
    fitLevel: dteCheck.passed && strikeFits && !strikeBelowCost ? "fit" : "watch",
    reasons: strikeFits ? ["カバードコールの権利行使価格レンジに入っています。"] : [],
    warnings: [
      ...(strikeFits ? [] : ["権利行使価格がカバードコールの目安レンジから外れています。"]),
      ...(strikeBelowCost ? ["権利行使価格が取得単価を下回っています。"] : []),
    ],
    requiredChecks: [requiredCheck("covered-shares", "100株のカバーがあるか", true), requiredCheck("acceptable-sale-price", "売却されてもよい価格か", undefined)],
    numericChecks: [dteCheck, premiumStrikeCheck, capitalGainStrikeCheck],
  });
}

function evaluateLongCall(candidate: ScreeningCandidate, input: StrategyCandidateInput): StrategyFitResult {
  const common = applyCommonDataQuality(candidate, input);
  if (common) return common;
  const ratio = strikeRatio(input, candidate.underlyingPrice);
  const numericChecks = [
    numericCheck("dte-150-plus", "DTE 150日以上", input.dte, 150, Number.POSITIVE_INFINITY),
    numericCheck("strike-current-1.00-1.05", "権利行使価格 / 現在株価 1.00から1.05", ratio, 1, 1.05),
  ];
  const fitLevel: StrategyFitLevel = numericChecks.every((check) => check.passed) ? "fit" : "watch";
  return makeResult({
    strategy: input.strategy,
    fitLevel,
    reasons: fitLevel === "fit" ? ["コール買いのDTEと権利行使価格レンジに入っています。"] : [],
    warnings: fitLevel === "watch" ? ["DTEまたは権利行使価格がコール買いの目安から外れています。"] : [],
    requiredChecks: [
      requiredCheck("close-by-offset", "権利行使ではなく反対売買による決済を前提にする", true),
      requiredCheck("profit-take-1.30", "利確目安は支払プレミアム x 1.30以上", undefined),
      requiredCheck("stop-loss-0.60", "損切り目安は支払プレミアム x 0.60", undefined),
    ],
    numericChecks,
  });
}

function evaluateDeferredComplexStrategy(candidate: ScreeningCandidate, input: StrategyCandidateInput): StrategyFitResult {
  if (optionChainMissing(candidate)) {
    return makeResult({
      strategy: input.strategy,
      fitLevel: "insufficient_data",
      warnings: ["オプションチェーンが未確認のため戦略適合を判定できません。"],
      missingFields: ["optionChainQuality.hasOptionChain"],
    });
  }
  const warnings =
    input.strategy === "short_strangle"
      ? ["ショートストラングルは200株相当の資金枠、同一口座、同一満期の確認が必要です。"]
      : input.strategy === "short_strangle_covered" || input.strategy === "short_strangle_advanced_review"
        ? ["ショートストラングル系は裸コール化、200株相当資金、同一満期を上級レビューで確認します。"]
      : input.strategy === "synthetic_forward"
        ? ["シンセティックは同一満期のコール買いとプット売りを組み合わせるため、下落時の複合損失確認が必要です。"]
        : input.strategy === "combo"
          ? ["コンボはATM付近のコール買いと買ってよいプット売りの組み合わせとして、後続工程で詳細判定します。"]
          : ["上級戦略は自動建玉化せず、上級戦略レビューで手動確認します。"];
  return makeResult({
    strategy: input.strategy,
    fitLevel: "watch",
    warnings,
    requiredChecks: [
      requiredCheck("same-account", "同一口座で扱えるか", input.sameAccount),
      requiredCheck("same-expiry", "同一満期で扱えるか", input.sameExpiry),
    ],
  });
}

export function evaluateStrategyFit(candidate: ScreeningCandidate, input: StrategyCandidateInput): StrategyFitResult {
  switch (input.strategy) {
    case "cash_secured_put_buy_to_own":
      return evaluateBuyToOwnPut(candidate, input);
    case "cash_secured_put_avoid_assignment":
      return evaluateAvoidAssignmentPut(candidate, input);
    case "covered_call":
      return evaluateCoveredCall(candidate, input);
    case "long_call":
      return evaluateLongCall(candidate, input);
    case "short_strangle":
    case "short_strangle_covered":
    case "short_strangle_advanced_review":
    case "synthetic_forward":
    case "combo":
    case "wheel":
    case "itm_short_put_buy_to_own":
    case "long_straddle_event":
    case "protective_collar":
      return evaluateDeferredComplexStrategy(candidate, input);
    default:
      return makeResult({
        strategy: input.strategy,
        fitLevel: "insufficient_data",
        warnings: ["未対応の戦略候補です。"],
      });
  }
}

export function evaluateScreeningCandidate(candidate: ScreeningCandidate): StrategyFitResult[] {
  return candidate.candidateStrategies.map((input) => evaluateStrategyFit(candidate, input));
}
