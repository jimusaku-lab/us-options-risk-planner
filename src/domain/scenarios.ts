import type { ScenarioResult, TradeSimulation } from "@/types/domain";
import {
  calculateNetInitialPremiumJPY,
  getShortCallLegs,
  getShortPutLegs,
} from "./calculations";

export function calculateScenarioResults(simulation: TradeSimulation): ScenarioResult[] {
  const premiumJPY = calculateNetInitialPremiumJPY(simulation);
  const calls = getShortCallLegs(simulation);
  const puts = getShortPutLegs(simulation);
  const callStrike = calls[0]?.strikeUSD;
  const putStrike = puts[0]?.strikeUSD;
  const putPremium = puts[0]?.premiumUSD ?? 0;
  const putIntent = puts[0]?.putIntent;
  const avoidPutAssignment =
    putIntent === "avoid_assignment" || putIntent === "do_not_want_to_buy" || putIntent === "cannot_buy";

  if (simulation.strategyType === "short_put" && putStrike) {
    const breakeven = Math.max(0, putStrike - putPremium);
    if (avoidPutAssignment) {
      return [
        {
          id: "put-above-strike",
          title: "プレミアム獲得ケース",
          stockPriceCondition: `満期時の株価が${putStrike} USD以上`,
          premiumJPY,
          stockChange: "株は取得せず、受け取ったプレミアムが利益上限",
          nextAction: "利益が十分なら買い戻して終了するか、満期まで待つかを決める",
          notes: [
            "株を取得したくない方針なので、権利行使されない状態が狙いです。",
            "最大利益は、最初に受け取ったプレミアムから手数料を引いた金額です。",
          ],
        },
        {
          id: "put-near-strike",
          title: "権利行使リスクが近づくケース",
          stockPriceCondition: `${breakeven.toFixed(2)} USDから${putStrike} USD付近`,
          premiumJPY,
          stockChange: "株を取得する可能性が高まり、プレミアム目的から外れ始める",
          nextAction: "満期前に買い戻して閉じるか、損切りルールに従うかを決める",
          notes: [
            `概算の損益分岐点は${breakeven.toFixed(2)} USDです。`,
            "株を取得したくない方針なら、この付近から途中決済の判断が重要になります。",
          ],
        },
        {
          id: "put-below-breakeven",
          title: "取得を避けたい下落ケース",
          stockPriceCondition: `満期時の株価が${breakeven.toFixed(2)} USD未満`,
          premiumJPY,
          stockChange: "P売りが権利行使され、株を買い受ける可能性",
          nextAction: "株取得を避ける前提なら、買い戻し・損切りで閉じるかを判断する",
          notes: [
            "この方針では、権利行使されること自体が想定外の方向です。",
            "実現損を避けるためにも、いつまで待つか、どの価格で閉じるかを事前に決めます。",
          ],
        },
      ];
    }

    return [
      {
        id: "put-above-strike",
        title: "株を取得せず終わるケース",
        stockPriceCondition: `満期時の株価が${putStrike} USD以上`,
        premiumJPY,
        stockChange: "株は取得せず、受け取ったプレミアムが利益上限",
        nextAction: "株取得は起きないため、プレミアム利益で終えるか、早めに買い戻すかを判断する",
        notes: [
          "株価が権利行使価格以上なら、P売りによる株取得は発生しません。",
          "最大利益は、最初に受け取ったプレミアムから手数料を引いた金額です。",
        ],
      },
      {
        id: "put-near-strike",
        title: "株取得に近づくケース",
        stockPriceCondition: `${breakeven.toFixed(2)} USDから${putStrike} USD付近`,
        premiumJPY,
        stockChange: "満期時の株価次第で、株を取得する可能性",
        nextAction: "取得資金と、取得後に保有する前提の価格かを確認する",
        notes: [
          `概算の損益分岐点は${breakeven.toFixed(2)} USDです。`,
          "株を取得してもよい方針なので、権利行使は想定内です。",
          "ただし取得直後から含み損になる可能性はあります。",
        ],
      },
      {
        id: "put-below-breakeven",
        title: "株を取得し含み損を抱えるケース",
        stockPriceCondition: `満期時の株価が${breakeven.toFixed(2)} USD未満`,
        premiumJPY,
        stockChange: "P売りが権利行使され、100株を買い受ける可能性",
        nextAction: "取得後も保有する前提で、資金余力と許容できる含み損を確認する",
        notes: [
          "割安取得を狙うプット売りでは、権利行使は戦略上の想定内です。",
          "株を買い受けて保有するだけなら、実現損ではなく評価損・含み損です。",
        ],
      },
    ];
  }

  return [
    {
      id: "upside",
      title: "上昇シナリオ",
      stockPriceCondition: callStrike ? `株価が${callStrike} USD以上` : "株価が上昇",
      premiumJPY,
      stockChange: callStrike ? "C売りが権利行使され、保有株を売却する可能性" : "株式変化なし",
      nextAction:
        simulation.stockPosition?.canSellAtStrike === false
          ? "株を残したい方針なら、Cを買い戻して閉じるかを満期前に判断する"
          : "株を売却されてもよい方針なら、権利行使時の売却価格と機会損失を確認する",
      notes: [
        "プレミアムは受け取り済みとして扱います。",
        simulation.stockPosition?.canSellAtStrike === false
          ? "株を残したい場合、株価が権利行使価格を上回るほど買い戻しコストが増えやすくなります。"
          : "株を売却されてもよい場合、上方向の利益は権利行使価格付近で頭打ちになります。",
      ],
    },
    {
      id: "range",
      title: "レンジシナリオ",
      stockPriceCondition:
        callStrike && putStrike ? `${putStrike} USDから${callStrike} USDの間` : "権利行使価格の範囲内",
      premiumJPY,
      stockChange: "オプションは権利行使されず、プレミアム獲得を想定",
      nextAction: "利益が十分なら買い戻して終了するか、満期まで待つかを決める",
      notes: ["途中決済する場合は買戻しコストを別シナリオで見ます。"],
    },
    {
      id: "downside",
      title: "下落シナリオ",
      stockPriceCondition: putStrike ? `株価が${putStrike} USD未満` : "株価が下落",
      premiumJPY,
      stockChange: putStrike ? "P売りが権利行使され、追加100株を取得する可能性" : "株式含み損に注意",
      nextAction: "下落時に、株を買い受けるか、損切りして閉じるかを決める",
      notes: ["P権利行使時には、権利行使価格で株を買い受ける資金が必要になります。"],
    },
  ];
}
