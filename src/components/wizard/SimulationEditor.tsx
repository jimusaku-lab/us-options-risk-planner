import type { ChangeEvent } from "react";
import { useState } from "react";
import { JapaneseYen, RotateCw } from "lucide-react";
import type { DenominatorMode, PutIntent, SimulationStatus, StrategyType, TradeSimulation } from "@/types/domain";
import type { WorkspaceMode } from "@/store/useOptionsStore";
import { calculateDte } from "@/domain/calculations";
import { NumberInput } from "@/components/ui/NumberInput";
import { fetchStooqQuote, fetchUsdJpyRate, normalizeTicker } from "@/lib/marketData";

type SimulationEditorProps = {
  simulation: TradeSimulation;
  workspace: WorkspaceMode;
  canUseExternalQuotes: boolean;
  externalQuoteModeLabel: string;
  onChange: (simulation: TradeSimulation) => void;
};

export function SimulationEditor({ simulation, workspace, canUseExternalQuotes, externalQuoteModeLabel, onChange }: SimulationEditorProps) {
  const [quoteStatus, setQuoteStatus] = useState<string>("");
  const callLeg = simulation.optionLegs.find((leg) => leg.type === "call");
  const putLeg = simulation.optionLegs.find((leg) => leg.type === "put");
  const needsCall = ["covered_call", "covered_call_plus_short_put", "short_strangle", "wheel"].includes(
    simulation.strategyType,
  );
  const needsPut = ["short_put", "covered_call_plus_short_put", "short_strangle", "wheel"].includes(
    simulation.strategyType,
  );
  const needsStock = ["covered_call", "covered_call_plus_short_put", "short_strangle", "wheel"].includes(
    simulation.strategyType,
  );
  const needsBrokerMarginInput = ["short_put", "covered_call_plus_short_put", "short_strangle", "wheel", "custom"].includes(
    simulation.strategyType,
  );
  const defaultStockSettlement = {
    enabled: false,
    kind: "manual_sale" as const,
    settlementDate: simulation.expiryDate,
    shares: simulation.stockPosition?.shares ?? 100,
    sellPriceUSD: callLeg?.strikeUSD || simulation.currentPriceUSD,
    costBasisUSD: simulation.stockPosition?.averageCostUSD ?? simulation.currentPriceUSD,
    fxRateJPY: simulation.fxRateJPY,
    commissionUSD: 0,
    commissionJPY: 0,
  };
  const stockSettlement = simulation.stockSettlement ?? defaultStockSettlement;

  const update = (patch: Partial<TradeSimulation>) => onChange({ ...simulation, ...patch });
  const updateAccountEnvironment = (accountEnvironment: TradeSimulation["accountEnvironment"]) => {
    const accountCode = accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "N" : "P";
    onChange({
      ...simulation,
      accountCode,
      accountEnvironment,
      accountCurrency: accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "USD" : "JPY",
      referenceFxRateJPY: simulation.referenceFxRateJPY ?? simulation.fxRateJPY,
      brokerMarginUSD: accountEnvironment === "PROD_N_USD_SETTLEMENT" ? simulation.brokerMarginUSD ?? (simulation.fxRateJPY > 0 ? simulation.brokerMarginJPY / simulation.fxRateJPY : 0) : simulation.brokerMarginUSD,
    });
  };
  const updateStockSettlement = (patch: Partial<NonNullable<TradeSimulation["stockSettlement"]>>) => {
    update({
      stockSettlement: {
        ...defaultStockSettlement,
        ...stockSettlement,
        ...patch,
      },
    });
  };
  const updateStrategy = (strategyType: StrategyType) => {
    const nextNeedsCall = ["covered_call", "covered_call_plus_short_put", "short_strangle", "wheel"].includes(
      strategyType,
    );
    const nextNeedsPut = ["short_put", "covered_call_plus_short_put", "short_strangle", "wheel"].includes(
      strategyType,
    );
    const nextNeedsStock = ["covered_call", "covered_call_plus_short_put", "short_strangle", "wheel"].includes(
      strategyType,
    );
    const nextLegs = [
      ...(nextNeedsCall
        ? [
            callLeg ?? {
              id: `${simulation.id}-call`,
              type: "call" as const,
              side: "sell" as const,
              strikeUSD: 0,
              premiumUSD: 0,
              quantity: 1,
              expiryDate: simulation.expiryDate,
              isCovered: nextNeedsStock,
              assignmentPolicy: "unknown" as const,
            },
          ]
        : []),
      ...(nextNeedsPut
        ? [
            putLeg ?? {
              id: `${simulation.id}-put`,
              type: "put" as const,
              side: "sell" as const,
              strikeUSD: 0,
              premiumUSD: 0,
              quantity: 1,
              expiryDate: simulation.expiryDate,
              putIntent: "can_buy" as const,
              assignmentPolicy: "unknown" as const,
            },
          ]
        : []),
    ];
    onChange({
      ...simulation,
      strategyType,
      optionLegs: nextLegs,
      stockPosition: nextNeedsStock
        ? simulation.stockPosition ?? {
            shares: 0,
            averageCostUSD: 0,
            denominatorPriceMode: "current_price",
          }
        : null,
      brokerMarginJPY: nextNeedsPut ? simulation.brokerMarginJPY : 0,
      denominatorMode: strategyType === "short_put" ? "cash_secured" : simulation.denominatorMode,
    });
  };
  const updateLeg = (id: string, patch: Partial<TradeSimulation["optionLegs"][number]>) => {
    update({
      optionLegs: simulation.optionLegs.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)),
    });
  };
  const putIntentValue =
    putLeg?.putIntent === "do_not_want_to_buy" || putLeg?.putIntent === "cannot_buy" || putLeg?.putIntent === "avoid_assignment"
      ? "avoid_assignment"
      : "accept_assignment";

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="sr-only">建玉入力欄</h2>
          <p className="text-sm text-slate-600">Saxo TraderGOのチケット表示を見ながら入力します。API接続は使いません。</p>
        </div>
        <label className="flex max-w-xl items-start gap-2 text-sm font-semibold text-slate-700">
          <input
            className="mt-1"
            type="checkbox"
            checked={simulation.beginnerMode ?? true}
            onChange={(event) => update({ beginnerMode: event.target.checked })}
          />
          <span>
            <span className="block">初心者モード</span>
            <span className="block text-xs font-normal leading-5 text-slate-500">
              ONの場合、裸コールなど初心者には避けたい構成を注文前NGとして扱います。
            </span>
          </span>
        </label>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-bold text-slate-950">1. 銘柄・価格</h3>
          <div className="mt-3 grid gap-3">
          <Select
            label="Saxo口座"
            value={simulation.accountEnvironment}
            onChange={(accountEnvironment) => updateAccountEnvironment(accountEnvironment as TradeSimulation["accountEnvironment"])}
            options={
              workspace === "demo"
                ? [["DEMO_JPY_BASE", "DEMO / JPYベース"]]
                : [
                    ["PROD_P_JPY_SETTLEMENT", "本番P口座: JPY決済"],
                    ["PROD_N_USD_SETTLEMENT", "本番N口座: USD決済"],
                  ]
            }
          />
          <Select
            label="建玉状態"
            value={simulation.status}
            onChange={(status) => update({ status: status as SimulationStatus })}
            options={[
              ["planned", "注文前"],
              ["open", "建玉中"],
              ["closed", "決済済み"],
              ["assigned", "権利行使済み"],
              ["expired", "満期終了"],
            ]}
          />
          <Select
            label="戦略"
            value={simulation.strategyType}
            onChange={(value) => updateStrategy(value as StrategyType)}
            options={[
              ["covered_call", "カバードコール"],
              ["short_put", "プット売り"],
              ["covered_call_plus_short_put", "カバードコール＋追加P売り"],
              ["short_strangle", "ショートストラングル"],
              ["wheel", "ホイール戦略"],
            ]}
          />
          <TextInput
            label="銘柄ティッカー"
            value={simulation.ticker}
            placeholder="例: NVDA, AMZN, NFLX"
            onChange={(ticker) => update({ ticker })}
          />
          <p className="-mt-2 text-xs leading-5 text-slate-500">
            株価取得には米国株ティッカーを使います。NVIDIA、Amazon、アマゾン等は代表ティッカーへ自動変換します。
          </p>
          <div className="grid gap-1.5 text-sm font-medium text-slate-700">
            <div className="flex items-center justify-between gap-2">
              <span>現在株価</span>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                title={canUseExternalQuotes ? "公開クオートから現在株価を取得" : externalQuoteModeLabel}
                disabled={!canUseExternalQuotes}
                onClick={async () => {
                  if (!canUseExternalQuotes) return;
                  const ticker = normalizeTicker(simulation.ticker);
                  if (!ticker) {
                    setQuoteStatus("先に銘柄ティッカーを入力してください。");
                    return;
                  }
                  setQuoteStatus("株価を取得中...");
                  try {
                    const quote = await fetchStooqQuote(ticker);
                    update({ ticker, currentPriceUSD: quote.price });
                    setQuoteStatus(
                      `${ticker}: ${quote.price.toLocaleString("en-US", {
                        maximumFractionDigits: 2,
                      })} USDを反映しました。${quote.date ?? ""} ${quote.time ?? ""}`,
                    );
                  } catch (error) {
                    setQuoteStatus(error instanceof Error ? error.message : "株価を取得できませんでした。");
                  }
                }}
              >
                <RotateCw size={13} />
                取得
              </button>
            </div>
            <NumberInput label="" value={simulation.currentPriceUSD} suffix="USD" onChange={(currentPriceUSD) => update({ currentPriceUSD })} />
            {quoteStatus ? <p className="text-xs leading-5 text-slate-500">{quoteStatus}</p> : null}
          </div>
          <div className="grid gap-1.5 text-sm font-medium text-slate-700">
            <div className="flex items-center justify-between gap-2">
              <span>為替</span>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                title={canUseExternalQuotes ? "公開クオートからUSD/JPYを取得" : externalQuoteModeLabel}
                disabled={!canUseExternalQuotes}
                onClick={async () => {
                  if (!canUseExternalQuotes) return;
                  setQuoteStatus("USD/JPYを取得中...");
                  try {
                    const quote = await fetchUsdJpyRate();
                    update({ fxRateJPY: quote.rate });
                    setQuoteStatus(
                      `USD/JPY: ${quote.rate.toLocaleString("en-US", {
                        maximumFractionDigits: 3,
                      })} を反映しました。${quote.date ?? ""} ${quote.time ?? ""}`,
                    );
                  } catch (error) {
                    setQuoteStatus(error instanceof Error ? error.message : "為替を取得できませんでした。");
                  }
                }}
              >
                <JapaneseYen size={13} />
                取得
              </button>
            </div>
            <NumberInput
              label=""
              value={simulation.fxRateJPY}
              suffix="JPY/USD"
              onChange={(fxRateJPY) => update({ fxRateJPY, referenceFxRateJPY: simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? simulation.referenceFxRateJPY ?? fxRateJPY : fxRateJPY })}
            />
            {simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? (
              <p className="-mt-2 text-xs leading-5 text-slate-500">
                N口座ではUSD損益・USD年率を主計算にします。JPYは参考換算で、税務上の確定値ではありません。
              </p>
            ) : workspace === "demo" ? (
              <p className="-mt-2 text-xs leading-5 text-slate-500">
                DEMOはJPYベース検証用です。名称としてP口座とは扱わず、本番USD決済口座の残高管理の完全検証には使いません。
              </p>
            ) : null}
          </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-bold text-slate-950">2. 保有株・取引資金</h3>
          <div className="mt-3 grid gap-3">
          {needsStock ? (
            <>
              <NumberInput
                label="保有株数"
                value={simulation.stockPosition?.shares ?? 0}
                suffix="株"
                onChange={(shares) =>
                  update({
                    stockPosition: {
                      shares,
                      averageCostUSD: simulation.stockPosition?.averageCostUSD ?? simulation.currentPriceUSD,
                      denominatorPriceMode: simulation.stockPosition?.denominatorPriceMode ?? "current_price",
                    },
                  })
                }
              />
              <NumberInput
                label="現物取得単価"
                value={simulation.stockPosition?.averageCostUSD ?? 0}
                suffix="USD"
                onChange={(averageCostUSD) =>
                  update({
                    stockPosition: {
                      shares: simulation.stockPosition?.shares ?? 0,
                      averageCostUSD,
                      denominatorPriceMode: simulation.stockPosition?.denominatorPriceMode ?? "current_price",
                    },
                  })
                }
              />
            </>
          ) : (
            <div className="rounded-md border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-600">
              プット売り単体では、現物株の保有入力は使いません。P権利行使時に買う資金は分母比較で確認します。
            </div>
          )}
          {needsBrokerMarginInput ? (
            <>
              <NumberInput
                label="チケット表示証拠金"
                value={simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? simulation.brokerMarginUSD ?? 0 : simulation.brokerMarginJPY}
                suffix={simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? "USD" : "JPY"}
                onChange={(value) =>
                  update(
                    simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
                      ? { brokerMarginUSD: value, brokerMarginJPY: value * simulation.fxRateJPY }
                      : { brokerMarginJPY: value },
                  )
                }
              />
              <NumberInput
                label="証拠金バッファ"
                value={simulation.marginBufferMultiplier}
                suffix="倍"
                min={1}
                onChange={(marginBufferMultiplier) => update({ marginBufferMultiplier })}
              />
            </>
          ) : (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-950">
              カバードコールは保有株でカバーするため、この建玉ではチケット表示証拠金を0として扱います。Saxoの決済チケットでも必要証拠金が0なら入力不要です。
            </div>
          )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-bold text-slate-950">3. オプション脚</h3>
          <div className="mt-3 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="建玉日"
              value={simulation.entryDate}
              type="date"
              onChange={(entryDate) => update({ entryDate, dte: calculateDte(entryDate, simulation.expiryDate) })}
            />
            <TextInput
              label="満期日"
              value={simulation.expiryDate}
              type="date"
              onChange={(expiryDate) =>
                update({
                  expiryDate,
                  dte: calculateDte(simulation.entryDate, expiryDate),
                  optionLegs: simulation.optionLegs.map((leg) => ({ ...leg, expiryDate })),
                })
              }
            />
          </div>
          {needsCall && callLeg ? (
            <>
              <NumberInput label="C権利行使価格" value={callLeg.strikeUSD} suffix="USD" onChange={(strikeUSD) => updateLeg(callLeg.id, { strikeUSD })} />
              <NumberInput label="Cプレミアム" value={callLeg.premiumUSD} suffix="USD/株" onChange={(premiumUSD) => updateLeg(callLeg.id, { premiumUSD })} />
              {needsStock ? (
                <Select
                  label="C売りの方針"
                  value={simulation.stockPosition?.canSellAtStrike === false ? "keep_stock" : "can_sell"}
                  onChange={(value) =>
                    update({
                      stockPosition: {
                        shares: simulation.stockPosition?.shares ?? 0,
                        averageCostUSD: simulation.stockPosition?.averageCostUSD ?? simulation.currentPriceUSD,
                        denominatorPriceMode: simulation.stockPosition?.denominatorPriceMode ?? "current_price",
                        canSellAtStrike: value === "can_sell",
                      },
                    })
                  }
                  options={[
                    ["can_sell", "株を売却されてもよい"],
                    ["keep_stock", "株を残したい"],
                  ]}
                />
              ) : null}
            </>
          ) : null}
          {needsPut && putLeg ? (
            <>
              <NumberInput label="P権利行使価格" value={putLeg.strikeUSD} suffix="USD" onChange={(strikeUSD) => updateLeg(putLeg.id, { strikeUSD })} />
              <NumberInput label="Pプレミアム" value={putLeg.premiumUSD} suffix="USD/株" onChange={(premiumUSD) => updateLeg(putLeg.id, { premiumUSD })} />
              <Select
                label="P売りの方針"
                value={putIntentValue}
                onChange={(putIntent) =>
                  updateLeg(putLeg.id, {
                    putIntent: putIntent as PutIntent,
                    assignmentPolicy: putIntent === "accept_assignment" ? "accept" : "avoid",
                  })
                }
                options={[
                  ["accept_assignment", "株を取得してもよい"],
                  ["avoid_assignment", "株を取得したくない"],
                ]}
              />
            </>
          ) : null}
          {simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT" ? (
            <NumberInput
              label="取引手数料（USD）"
              value={simulation.brokerCommissionUSD ?? 0}
              suffix="USD"
              min={0}
              onChange={(brokerCommissionUSD) => update({ brokerCommissionUSD })}
            />
          ) : (
            <>
              <NumberInput
                label="取引手数料・諸費用（JPY）"
                value={simulation.brokerCommissionJPY ?? 0}
                suffix="JPY"
                min={0}
                onChange={(brokerCommissionJPY) => update({ brokerCommissionJPY })}
              />
              <NumberInput
                label="USD手数料（任意）"
                value={simulation.brokerCommissionUSD ?? 0}
                suffix="USD"
                min={0}
                onChange={(brokerCommissionUSD) => update({ brokerCommissionUSD })}
              />
            </>
          )}
          <p className="-mt-2 text-xs leading-5 text-slate-500">
            P口座取引には0.25%を一律上乗せしません。N口座はUSDを主計算、JPYは参考換算です。
          </p>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <h3 className="text-sm font-bold text-slate-950">4. ルール・表示設定</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          注文前に決めておく利確・損切りルールと、分母や比較年率などの表示設定です。途中決済の買戻し価格は下の「反対売買判断」で入力します。
        </p>
        <div className="mt-3 grid gap-3 xl:grid-cols-4">
          <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              checked={simulation.profitTakeRule?.enabled ?? false}
              onChange={(event) =>
                update({
                  profitTakeRule: {
                    targetPremiumKeepPercent: simulation.profitTakeRule?.targetPremiumKeepPercent ?? 60,
                    latestCloseDaysBeforeExpiry: simulation.profitTakeRule?.latestCloseDaysBeforeExpiry ?? 7,
                    enabled: event.target.checked,
                  },
                })
              }
            />
            <span>
              <span className="font-semibold text-slate-900">利確ルールを使う</span>
              <span className="block text-xs leading-5 text-slate-500">途中で買い戻して利益確定する目安を持つ場合にON。</span>
            </span>
          </label>
          <NumberInput
            label="プレミアム確保率"
            value={simulation.profitTakeRule?.targetPremiumKeepPercent ?? 60}
            suffix="%"
            min={0}
            onChange={(targetPremiumKeepPercent) =>
              update({
                profitTakeRule: {
                  enabled: simulation.profitTakeRule?.enabled ?? false,
                  latestCloseDaysBeforeExpiry: simulation.profitTakeRule?.latestCloseDaysBeforeExpiry ?? 7,
                  targetPremiumKeepPercent,
                },
              })
            }
          />
          <NumberInput
            label="満期何日前までに判断"
            value={simulation.profitTakeRule?.latestCloseDaysBeforeExpiry ?? 7}
            suffix="日前"
            min={0}
            onChange={(latestCloseDaysBeforeExpiry) =>
              update({
                profitTakeRule: {
                  enabled: simulation.profitTakeRule?.enabled ?? false,
                  targetPremiumKeepPercent: simulation.profitTakeRule?.targetPremiumKeepPercent ?? 60,
                  latestCloseDaysBeforeExpiry,
                },
              })
            }
          />
          <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              checked={simulation.stopLossRule?.enabled ?? false}
              onChange={(event) =>
                update({
                  stopLossRule: {
                    type: simulation.stopLossRule?.type ?? "option_buyback_price",
                    value: simulation.stopLossRule?.value ?? 0,
                    enabled: event.target.checked,
                  },
                })
              }
            />
            <span>
              <span className="font-semibold text-slate-900">損切りルールを使う</span>
              <span className="block text-xs leading-5 text-slate-500">株を取得したくないP売りでは、注文前NG判定に使います。</span>
            </span>
          </label>
          <Select
            label="損切りルール種別"
            value={simulation.stopLossRule?.type ?? "option_buyback_price"}
            onChange={(type) =>
              update({
                stopLossRule: {
                  enabled: simulation.stopLossRule?.enabled ?? false,
                  value: simulation.stopLossRule?.value ?? 0,
                  type: type as NonNullable<TradeSimulation["stopLossRule"]>["type"],
                },
              })
            }
            options={[
              ["option_buyback_price", "買戻し価格"],
              ["stock_price_line", "株価ライン"],
              ["loss_amount_jpy", "損失額"],
            ]}
          />
          <NumberInput
            label="損切りルール値"
            value={simulation.stopLossRule?.value ?? 0}
            suffix={
              simulation.stopLossRule?.type === "loss_amount_jpy"
                ? simulation.accountEnvironment === "PROD_N_USD_SETTLEMENT"
                  ? "USD"
                  : "JPY"
                : simulation.stopLossRule?.type === "stock_price_line"
                  ? "USD"
                  : "USD/株"
            }
            min={0}
            onChange={(value) =>
              update({
                stopLossRule: {
                  enabled: simulation.stopLossRule?.enabled ?? false,
                  type: simulation.stopLossRule?.type ?? "option_buyback_price",
                  value,
                },
              })
            }
          />
          <Select
            label="主分母"
            value={simulation.denominatorMode}
            onChange={(denominatorMode) => update({ denominatorMode: denominatorMode as DenominatorMode })}
            options={[
              ["broker_margin_only", "証拠金のみ"],
              ["stock_plus_margin", "現物株＋使用証拠金"],
              ["cash_secured", "キャッシュセキュアード"],
              ["conservative_common", "保守的共通分母"],
            ]}
          />
          <NumberInput label="NISA等 比較年率" value={simulation.nisaExpectedAnnualReturnPct ?? 6} suffix="%" onChange={(nisaExpectedAnnualReturnPct) => update({ nisaExpectedAnnualReturnPct })} />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-950">5. 現物株の譲渡記録</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              カバードコールで株を渡した、または現物株を売却した場合だけ入力します。オプション損益とは別に「上場株式等の譲渡所得等」として表示します。
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={stockSettlement.enabled}
              onChange={(event) => updateStockSettlement({ enabled: event.target.checked })}
            />
            現物株の譲渡を記録する
          </label>
        </div>
        {stockSettlement.enabled ? (
          <div className="mt-3 grid gap-3 xl:grid-cols-4">
            <Select
              label="譲渡の種類"
              value={stockSettlement.kind}
              onChange={(kind) => updateStockSettlement({ kind: kind as NonNullable<TradeSimulation["stockSettlement"]>["kind"] })}
              options={[
                ["manual_sale", "通常の現物売却"],
                ["covered_call_assignment", "C権利行使で株を渡した"],
                ["other", "その他"],
              ]}
            />
            <TextInput
              label="譲渡日"
              value={stockSettlement.settlementDate}
              type="date"
              onChange={(settlementDate) => updateStockSettlement({ settlementDate })}
            />
            <NumberInput
              label="譲渡株数"
              value={stockSettlement.shares}
              suffix="株"
              min={0}
              onChange={(shares) => updateStockSettlement({ shares })}
            />
            <NumberInput
              label="売却単価"
              value={stockSettlement.sellPriceUSD}
              suffix="USD"
              min={0}
              onChange={(sellPriceUSD) => updateStockSettlement({ sellPriceUSD })}
            />
            <NumberInput
              label="取得単価"
              value={stockSettlement.costBasisUSD}
              suffix="USD"
              min={0}
              onChange={(costBasisUSD) => updateStockSettlement({ costBasisUSD })}
            />
            <NumberInput
              label="譲渡時為替"
              value={stockSettlement.fxRateJPY ?? simulation.fxRateJPY}
              suffix="JPY/USD"
              min={0}
              onChange={(fxRateJPY) => updateStockSettlement({ fxRateJPY })}
            />
            <NumberInput
              label="売却手数料"
              value={stockSettlement.commissionUSD ?? 0}
              suffix="USD"
              min={0}
              onChange={(commissionUSD) => updateStockSettlement({ commissionUSD })}
            />
            <NumberInput
              label="売却手数料"
              value={stockSettlement.commissionJPY ?? 0}
              suffix="JPY"
              min={0}
              onChange={(commissionJPY) => updateStockSettlement({ commissionJPY })}
            />
          </div>
        ) : (
          <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-600">
            現物株を売却していない建玉ではOFFのままで問題ありません。OFFの場合、税務区分別の「上場株式等の譲渡所得等」は未集計として表示されます。
          </p>
        )}
      </div>
    </section>
  );
}

function TextInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <input
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-600"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <select
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-teal-600"
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
      >
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>
            {labelText}
          </option>
        ))}
      </select>
    </label>
  );
}
