import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulationEditor } from "./SimulationEditor";
import type { TradeSimulation } from "@/types/domain";
import type { SaxoApiOrderSnapshot, SaxoHistoryDiscoveryItem } from "@/features/saxo/saxoAccountSync";

afterEach(() => {
  cleanup();
});

describe("SimulationEditor", () => {
  it("auto-selects a long-call entry leg created from a Saxo position draft", () => {
    const simulation = buildVisaLongCallSimulation();

    render(
      <SimulationEditor
        simulation={simulation}
        workspace="live"
        canUseExternalQuotes={false}
        externalQuoteModeLabel="無効"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getAllByText("C買い 340 / 2026-11-20 / 1枚").length).toBeGreaterThan(0);
    expect(screen.queryByText("対象脚未選択")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("-396166")).toBeInTheDocument();
    expect(screen.getByDisplayValue("-395797")).toBeInTheDocument();
    expect(screen.getByDisplayValue("-4288")).toBeInTheDocument();

    const targetLegSelect = screen.getByLabelText("対象脚");
    expect(targetLegSelect).toHaveValue("saxo-visa-c340-leg");
    expect(within(targetLegSelect).getByRole("option", { name: "C買い 340 / 2026-11-20 / 1枚" })).toBeInTheDocument();
  });

  it("repairs a missing entry leg id and complements P-account JPY values from Saxo history", async () => {
    const initialSimulation = buildVisaLongCallSimulation({
      optionEntryExecutions: [
        {
          id: "saxo-entry-visa-c340",
          legId: "missing-leg-id",
          tradeDate: "2026-06-30",
          contracts: 1,
          fillPriceUSD: 24.1,
          settlementCurrency: "JPY",
          referenceFxRateJPY: 164.23105,
          inputMode: "P_JPY_BROKER_STATEMENT",
          source: "saxo_api_estimate",
          saxoSourceType: "current_position",
          historyCompletionStatus: "unmatched",
          confirmed: false,
        },
      ],
    });
    function Harness() {
      const [current, setCurrent] = useState(initialSimulation);
      return (
        <SimulationEditor
          simulation={current}
          workspace="live"
          canUseExternalQuotes={false}
          externalQuoteModeLabel="無効"
          onChange={setCurrent}
          saxoHistoryCandidates={[visaEntryHistory]}
        />
      );
    }

    render(<Harness />);

    await waitFor(() => expect(screen.getByLabelText("対象脚")).toHaveValue("saxo-visa-c340-leg"));
    expect(screen.queryByText("対象脚未選択")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "確認して正式保存する" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Saxo取引履歴から補完" }));

    await waitFor(() => expect(screen.getByDisplayValue("-396166")).toBeInTheDocument());
    expect(screen.getByDisplayValue("-395797")).toBeInTheDocument();
    expect(screen.getByDisplayValue("-4288")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("164.23105").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/不足項目: 記帳額JPY/)).not.toBeInTheDocument();
  });

  it("recovers a missing option leg from Saxo draft metadata before history completion", async () => {
    const initialSimulation = buildVisaLongCallSimulation({
      optionLegs: [],
      optionEntryExecutions: [
        {
          id: "saxo-entry-visa-c340",
          legId: "saxo-visa-c340-leg",
          tradeDate: "2026-06-30",
          contracts: 1,
          fillPriceUSD: 24.1,
          settlementCurrency: "JPY",
          referenceFxRateJPY: 164.23105,
          inputMode: "P_JPY_BROKER_STATEMENT",
          source: "saxo_api_estimate",
          saxoSourceType: "current_position",
          historyCompletionStatus: "unmatched",
          historyCandidateIds: ["visa-c340-entry"],
          confirmed: false,
        },
      ],
    });
    function Harness() {
      const [current, setCurrent] = useState(initialSimulation);
      return (
        <SimulationEditor
          simulation={current}
          workspace="live"
          canUseExternalQuotes={false}
          externalQuoteModeLabel="無効"
          onChange={setCurrent}
          saxoHistoryCandidates={[visaEntryHistory]}
        />
      );
    }

    render(<Harness />);

    await waitFor(() => expect(screen.getByLabelText("対象脚")).toHaveValue("saxo-visa-c340-leg"));
    expect(screen.queryByText("対象脚未選択")).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("対象脚")).getByRole("option", { name: "C買い 340 / 2026-11-20 / 1枚" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Saxo取引履歴から補完" }));

    await waitFor(() => expect(screen.getByDisplayValue("-396166")).toBeInTheDocument());
    expect(screen.getByDisplayValue("-395797")).toBeInTheDocument();
    expect(screen.getByDisplayValue("-4288")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("164.23105").length).toBeGreaterThanOrEqual(2);
  });

  it("backfills a missing N-account fee as a standard value without a missing-fee warning", async () => {
    const initialSimulation = buildVisaLongCallSimulation({
      accountCode: "N",
      accountEnvironment: "PROD_N_USD_SETTLEMENT",
      accountCurrency: "USD",
      optionEntryExecutions: [
        {
          id: "n-entry",
          legId: "saxo-visa-c340-leg",
          tradeDate: "2026-06-30",
          contracts: 1,
          fillPriceUSD: 24.1,
          settlementCurrency: "USD",
          inputMode: "USD_EXECUTION_CALC",
          source: "saxo_api_estimate",
          saxoSourceType: "current_position",
          historyCompletionStatus: "unmatched",
          confirmed: false,
        },
      ],
    });
    function Harness() {
      const [current, setCurrent] = useState(initialSimulation);
      return <SimulationEditor simulation={current} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={setCurrent} />;
    }

    render(<Harness />);

    await waitFor(() => expect(screen.getByText(/費用出所: Saxoチケット確認済み開始標準/)).toBeInTheDocument());
    expect(screen.getAllByDisplayValue("2.24").length).toBeGreaterThan(0);
    expect(screen.queryByText(/不足項目: .*取引費用USD/)).not.toBeInTheDocument();
  });

  it("stores a manual Saxo total transaction cost as manual evidence and clears it back to missing instead of zero", () => {
    const onChange = vi.fn();
    render(
      <SimulationEditor
        simulation={buildVisaLongCallSimulation({ status: "entry_confirmation" })}
        workspace="live"
        canUseExternalQuotes={false}
        externalQuoteModeLabel="無効"
        onChange={onChange}
      />,
    );

    const input = screen.getByRole("spinbutton", { name: /Saxo総取引費用 JPY/ });
    fireEvent.change(input, { target: { value: "-4157" } });

    const afterManualInput = onChange.mock.calls.at(-1)?.[0] as TradeSimulation;
    expect(afterManualInput.optionEntryExecutions?.[0]).toMatchObject({
      brokerTotalTransactionCostJPY: -4157,
      openingFieldSources: { brokerTotalTransactionCostJPY: "manual" },
    });
    expect(afterManualInput.optionEntryExecutions?.[0].openingFieldEvidence?.brokerTotalTransactionCostJPY?.source).toBe("manual");

    fireEvent.change(input, { target: { value: "" } });
    const afterClear = onChange.mock.calls.at(-1)?.[0] as TradeSimulation;
    expect(afterClear.optionEntryExecutions?.[0].brokerTotalTransactionCostJPY).toBeUndefined();
    expect(afterClear.optionEntryExecutions?.[0].openingFieldSources?.brokerTotalTransactionCostJPY).toBeUndefined();
    expect(afterClear.optionEntryExecutions?.[0].openingFieldEvidence?.brokerTotalTransactionCostJPY).toBeUndefined();

    fireEvent.change(input, { target: { value: "0" } });
    const afterExplicitZero = onChange.mock.calls.at(-1)?.[0] as TradeSimulation;
    expect(afterExplicitZero.optionEntryExecutions?.[0]).toMatchObject({
      brokerTotalTransactionCostJPY: 0,
      openingFieldSources: { brokerTotalTransactionCostJPY: "manual" },
    });
  });

  it("stores a manually transcribed trade date with evidence", () => {
    const onChange = vi.fn();
    render(
      <SimulationEditor
        simulation={buildVisaLongCallSimulation({ status: "entry_confirmation" })}
        workspace="live"
        canUseExternalQuotes={false}
        externalQuoteModeLabel="無効"
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("取引日"), { target: { value: "2026-08-13" } });
    const afterManualInput = onChange.mock.calls.at(-1)?.[0] as TradeSimulation;
    expect(afterManualInput.optionEntryExecutions?.[0]).toMatchObject({
      tradeDate: "2026-08-13",
      openingFieldSources: { tradeDate: "manual" },
    });
    expect(afterManualInput.optionEntryExecutions?.[0].openingFieldEvidence?.tradeDate?.source).toBe("manual");
  });

  it("keeps card-level save as the only primary action while a 3-A card is unconfirmed", () => {
    render(
      <SimulationEditor
        simulation={buildVisaLongCallSimulation({ status: "entry_confirmation" })}
        workspace="live"
        canUseExternalQuotes={false}
        externalQuoteModeLabel="無効"
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "建玉開始を確認済みにする" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "確認して正式保存する" })).toHaveLength(1);
    expect(screen.getByText("3-A各カードで正式保存してください")).toBeInTheDocument();
  });

  it("auto-finalizes a Saxo draft on the last 3-A card save without a second bulk confirmation", () => {
    const onChange = vi.fn();
    render(
      <SimulationEditor
        simulation={buildVisaLongCallSimulation({ status: "entry_confirmation" })}
        workspace="live"
        canUseExternalQuotes={false}
        externalQuoteModeLabel="無効"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "確認して正式保存する" }));

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as TradeSimulation;
    expect(next.status).toBe("open");
    expect(next.name).toBe("V");
    expect(next.optionEntryExecutions?.[0]).toMatchObject({ confirmed: true });
    expect(next.fixtureMeta?.notes).toContain("正式保存しました");
  });

  it("persists the confirmed 3-A trade date as the simulation entry date", () => {
    const onChange = vi.fn();
    render(
      <SimulationEditor
        simulation={buildVisaLongCallSimulation({ entryDate: "2026-07-01", status: "entry_confirmation" })}
        workspace="live"
        canUseExternalQuotes={false}
        externalQuoteModeLabel="無効"
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("取引日"), { target: { value: "2026-06-30" } });
    fireEvent.click(screen.getByRole("button", { name: "確認して正式保存する" }));

    const next = onChange.mock.calls.at(-1)?.[0] as TradeSimulation;
    expect(next.entryDate).toBe("2026-06-30");
    expect(next.optionEntryExecutions?.[0]).toMatchObject({ tradeDate: "2026-06-30", confirmed: true });
  });

  it("keeps synthetic forward in entry confirmation after the last leg save when parent confirmation still remains", () => {
    const onChange = vi.fn();
    const simulation = buildVisaLongCallSimulation({
      status: "entry_confirmation",
      name: "NVDA / API取込下書き",
      ticker: "NVDA",
      strategyType: "synthetic_forward",
      accountCode: "N",
      accountEnvironment: "PROD_N_USD_SETTLEMENT",
      accountCurrency: "USD",
      optionLegs: [
        { id: "synthetic-call", type: "call", side: "buy", strikeUSD: 210, premiumUSD: 26.25, quantity: 1, expiryDate: "2026-12-18", assignmentPolicy: "unknown" },
        { id: "synthetic-put", type: "put", side: "sell", strikeUSD: 210, premiumUSD: 21.05, quantity: 1, expiryDate: "2026-12-18", putIntent: "accept_assignment", assignmentPolicy: "unknown" },
      ],
      optionEntryExecutions: [
        { id: "synthetic-entry-call", legId: "synthetic-call", tradeDate: "2026-07-16", contracts: 1, fillPriceUSD: 26.25, settlementCurrency: "USD", commissionUSD: 2.25, source: "saxo_api_estimate", historyCandidateIds: ["call-trade"], confirmed: true },
        { id: "synthetic-entry-put", legId: "synthetic-put", tradeDate: "2026-07-16", contracts: 1, fillPriceUSD: 21.05, settlementCurrency: "USD", commissionUSD: 2.25, source: "saxo_api_estimate", historyCandidateIds: ["put-trade"], confirmed: false },
      ],
      syntheticForwardTicket: undefined,
    });

    render(
      <SimulationEditor
        simulation={simulation}
        workspace="live"
        canUseExternalQuotes={false}
        externalQuoteModeLabel="無効"
        onChange={onChange}
      />,
    );

    expect(screen.queryByRole("button", { name: "建玉開始を確認済みにする" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "確認して正式保存する" }));

    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as TradeSimulation;
    expect(next.status).toBe("entry_confirmation");
    expect(next.optionEntryExecutions?.every((execution) => execution.confirmed)).toBe(true);
  });

  it("shows the synthetic-forward saved panel and hides draft actions after both legs are confirmed", () => {
    const onOpenDashboard = vi.fn();
    const simulation = buildVisaLongCallSimulation({
      status: "open", strategyType: "synthetic_forward", accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD",
      optionLegs: [
        { id: "synthetic-call", type: "call", side: "buy", strikeUSD: 210, premiumUSD: 26.25, quantity: 1, expiryDate: "2026-12-18", assignmentPolicy: "unknown" },
        { id: "synthetic-put", type: "put", side: "sell", strikeUSD: 210, premiumUSD: 21.05, quantity: 1, expiryDate: "2026-12-18", putIntent: "accept_assignment", assignmentPolicy: "unknown" },
      ],
      optionEntryExecutions: [
        { id: "synthetic-entry-call", legId: "synthetic-call", tradeDate: "2026-07-16", contracts: 1, fillPriceUSD: 26.25, settlementCurrency: "USD", commissionUSD: 2.25, source: "saxo_api_estimate", historyCandidateIds: ["call-trade"], confirmed: true },
        { id: "synthetic-entry-put", legId: "synthetic-put", tradeDate: "2026-07-16", contracts: 1, fillPriceUSD: 21.05, settlementCurrency: "USD", commissionUSD: 2.25, source: "saxo_api_estimate", historyCandidateIds: ["put-trade"], confirmed: true },
      ],
      syntheticForwardTicket: { orderId: "5425367936", netFillPriceUSD: 5.2, actualTotalCommissionUSD: 4.5, entryCostUSD: 524.5, requiredMarginUSD: 4_000 },
    });
    render(<SimulationEditor simulation={simulation} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={vi.fn()} onOpenDashboard={onOpenDashboard} />);
    expect(screen.getByText("シンセティックフォワードを保存済み")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Saxo取引履歴から補完" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下書きを破棄" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "建玉ダッシュボードで確認" }));
    expect(onOpenDashboard).toHaveBeenCalledOnce();
  });

  it.each(["call", "put"] as const)("shows an anonymous long-%s Saxo close target in the same UI and save set", (type) => {
    const simulation = buildSampleLongOptionCloseSimulation(type);
    render(<SimulationEditor simulation={simulation} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={vi.fn()} />);

    expect(screen.getAllByText(`${type === "call" ? "C" : "P"}買い 100 / 2026-12-18 / 1枚`).length).toBeGreaterThan(0);
    expect(screen.queryByText("対象脚未選択")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("対象脚").some((select) => (select as HTMLSelectElement).value === "sample-long-leg")).toBe(true);
    expect(screen.getByRole("button", { name: "確認して正式保存" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "この決済実績を確認する" })).not.toBeInTheDocument();
  });

  it("confirms a full close and changes status in the same update without a second status CTA", () => {
    const onChange = vi.fn();
    const simulation = buildSampleLongOptionCloseSimulation("call");
    render(<SimulationEditor simulation={simulation} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "確認して正式保存" }));
    expect(onChange).toHaveBeenCalledOnce();
    const next = onChange.mock.calls[0][0] as TradeSimulation;
    expect(next.status).toBe("closed");
    expect(next.optionCloseExecutions?.[0]).toMatchObject({ confirmed: true, confirmationStatus: "confirmed" });
    expect(screen.queryByRole("button", { name: "決済済みに変更" })).not.toBeInTheDocument();
  });

  it("previews both bear-put legs and confirms them in one parent update", async () => {
    let current = buildBearPutCloseDraftSimulation();
    const onChange = vi.fn((next: TradeSimulation) => { current = next; });
    function Harness() {
      const [simulation, setSimulation] = useState(current);
      return <SimulationEditor simulation={simulation} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={(next) => { onChange(next); setSimulation(next); }} />;
    }
    render(<Harness />);
    const shortCard = document.getElementById("option-close-execution-R11-close-short")!;
    expect(within(shortCard).getByText(/\$3\.52 \/ 参考JPY 未確認/)).toBeInTheDocument();
    expect(within(shortCard).getByText("参考為替は未確認です。USD実績の確認には不要です。")).toBeInTheDocument();
    expect(within(shortCard).queryByRole("button", { name: /正式保存/ })).not.toBeInTheDocument();
    expect(current.optionCloseExecutions?.every((execution) => !execution.confirmed)).toBe(true);
    const review = screen.getByRole("region", { name: "ベア・プット2脚の決済確認" });
    fireEvent.click(within(review).getByRole("button", { name: "2脚の決済内容を確認して正式保存" }));
    await waitFor(() => expect(current.status).toBe("closed"));
    expect(current.optionCloseExecutions?.every((execution) => execution.confirmed)).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("requires explicit per-leg consent before an intentional partial bear-put close", async () => {
    const base = buildBearPutCloseDraftSimulation();
    let current: TradeSimulation = { ...base, optionLegs: base.optionLegs.map((leg) => ({ ...leg, quantity: 2 })), optionEntryExecutions: base.optionEntryExecutions?.map((execution) => ({ ...execution, contracts: 2 })), optionCloseExecutions: [{ ...base.optionCloseExecutions![0], contracts: 1 }] };
    function Harness() {
      const [simulation, setSimulation] = useState(current);
      return <SimulationEditor simulation={simulation} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={(next) => { current = next; setSimulation(next); }} />;
    }
    render(<Harness />);
    expect(screen.getByRole("button", { name: "2脚の決済内容を確認して正式保存" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /この脚だけを正式保存/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "意図的な一部決済として脚別に確認" }));
    const perLegSave = screen.getByRole("button", { name: "この脚だけを正式保存（意図的な部分決済）" });
    expect(perLegSave).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /だけを正式保存し、反対脚を残すことを確認しました/ }));
    expect(perLegSave).toBeEnabled();
    fireEvent.click(perLegSave);
    await waitFor(() => expect(current.optionCloseExecutions?.[0].confirmed).toBe(true));
    expect(current.status).toBe("open");
    expect(current.optionCloseExecutions?.[0].contracts).toBe(1);
  });

  it("focuses the parent spread-close heading for the batch navigation anchor", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    render(<SimulationEditor simulation={buildBearPutCloseDraftSimulation()} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={vi.fn()} focusRequest={{ anchorId: "spread-close-batch-review", requestId: 12 }} />);
    const heading = screen.getByRole("heading", { name: "2脚の決済内容" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("blocks an invalid Saxo history close leg before it can change confirmation state", () => {
    const onChange = vi.fn();
    const simulation = buildSampleLongOptionCloseSimulation("call", "missing-leg");
    render(<SimulationEditor simulation={simulation} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={onChange} />);

    expect(screen.getByText("対象脚が現在の建玉から見つかりません。正式保存できません。")).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: "確認して正式保存" });
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("focuses the first missing avoid-assignment put exit-rule control", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const simulation = buildAvoidAssignmentShortPutSimulation();

    render(
      <SimulationEditor
        simulation={simulation}
        workspace="live"
        canUseExternalQuotes={false}
        externalQuoteModeLabel="無効"
        onChange={vi.fn()}
        focusRequest={{ anchorId: "exit-rule-avoid-put-leg", requestId: 1 }}
      />,
    );

    await waitFor(() => expect(document.getElementById("exit-rule-profit-take-enabled-avoid-put-leg")).toHaveFocus());
    expect(document.getElementById("exit-rule-avoid-put-leg")).toBeInTheDocument();
    expect(document.getElementById("exit-rules")).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("opens a read-only Saxo exit-order review for a long call and focuses the real review target", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const simulation = buildVisaLongCallSimulation({
      optionLegs: [{ ...buildVisaLongCallSimulation().optionLegs[0], saxoAccountKey: "anonymous-account", saxoUic: 990001 }],
    });
    const order: SaxoApiOrderSnapshot = {
      id: "anonymous-stop", accountKey: "anonymous-account", accountAssignment: "P", accountCode: "P",
      symbol: "V/20X26C340:XCBF", assetType: "StockOption", quantity: 1, side: "sell", optionType: "call",
      strike: 340, expiry: "2026-11-20", uic: 990001, status: "Working", orderType: "StopIfTraded",
      orderRelation: "StandAlone", openClose: "close", stopPrice: 0.5, missingFields: [], fetchedAt: "2026-09-15T01:02:03.000Z",
    };
    render(<SimulationEditor simulation={simulation} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={vi.fn()} saxoOrders={[order]} focusRequest={{ anchorId: "exit-order-review-saxo-visa-c340-leg", requestId: 2, exitOrderReview: true }} />);
    const review = await screen.findByRole("region", { name: "Vの決済注文レビュー" });
    await waitFor(() => expect(review).toHaveFocus());
    expect(review).toHaveTextContent("逆指値");
    expect(review).toHaveTextContent("$0.50");
    expect(review).toHaveTextContent("再入力は不要です");
    expect(review).not.toHaveTextContent("OCO");
  });

  it("shows a safe diagnostic instead of choosing another leg for a stale review target", async () => {
    render(<SimulationEditor simulation={buildVisaLongCallSimulation()} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={vi.fn()} focusRequest={{ anchorId: "exit-order-review-stale-leg", requestId: 3, exitOrderReview: true }} />);
    const review = await screen.findByRole("region", { name: "Vの決済注文レビュー" });
    expect(review).toHaveTextContent("対象脚が現在の建玉から見つかりません");
    expect(review).toHaveTextContent("別の建玉へ推定移動せず");
  });

  it("saves one matched Saxo OCO pair as an app-side exit rule and then shows the completion state", () => {
    const onOpenDashboard = vi.fn();
    const initial: TradeSimulation = {
      ...buildAvoidAssignmentShortPutSimulation(),
      id: "anonymous-oco", ticker: "SAMPLE", status: "open", accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD",
      optionLegs: [{ id: "oco-put", type: "put", side: "sell", strikeUSD: 400, premiumUSD: 7.9, quantity: 1, expiryDate: "2026-10-16", putIntent: "avoid_assignment", assignmentPolicy: "avoid", saxoAccountKey: "anonymous-account" }],
    };
    const baseOrder = {
      accountKey: "anonymous-account", accountAssignment: "N" as const, accountCode: "N" as const, symbol: "SAMPLE/16V26P400:XCBF", assetType: "StockOption" as const,
      optionType: "put" as const, strike: 400, expiry: "2026-10-16", side: "buy" as const, quantity: 1, status: "Working",
      orderRelation: "Oco", duration: "Gtc", missingFields: [], fetchedAt: "2026-09-04T00:00:00.000Z",
    };
    const orders: SaxoApiOrderSnapshot[] = [
      { ...baseOrder, id: "anonymous-limit", orderType: "Limit", price: 1.9 },
      { ...baseOrder, id: "anonymous-stop", orderType: "StopIfTraded", stopPrice: 6.2 },
    ];
    function Harness() {
      const [simulation, setSimulation] = useState(initial);
      return <SimulationEditor simulation={simulation} workspace="live" canUseExternalQuotes={false} externalQuoteModeLabel="無効" onChange={setSimulation} onOpenDashboard={onOpenDashboard} saxoOrders={orders} focusRequest={{ anchorId: "exit-rule-oco-put", requestId: 1, exitOrderReview: true }} />;
    }

    render(<Harness />);
    expect(screen.getByText("Saxo取得済みの決済注文候補")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "この内容でアプリに保存" }));
    expect(screen.queryByRole("button", { name: "この内容でアプリに保存" })).not.toBeInTheDocument();
    expect(screen.getByText("Saxoで稼働中の出口注文")).toBeInTheDocument();
    expect(screen.getByText(/OCOは、どちらか一方が約定するともう一方を取り消す組み合わせ/)).toBeInTheDocument();
    expect(screen.getByText("$1.90で買戻す指値")).toBeInTheDocument();
    expect(screen.getByText("$6.20で買戻す逆指値")).toBeInTheDocument();
    expect(screen.getByText(/税・手数料前 約75\.9%/)).toBeInTheDocument();
    expect(screen.getByText("アプリの参考ルールを表示・編集")).toBeInTheDocument();
    expect(screen.getByText("$3.16")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "ダッシュボードへ戻る" }));
    expect(onOpenDashboard).toHaveBeenCalledOnce();
  });
});

const visaEntryHistory: SaxoHistoryDiscoveryItem = {
  id: "visa-c340-entry",
  kind: "trade",
  accountKey: "p-key",
  accountCode: "P",
  symbol: "V/20X26C340:XCBF",
  instrumentCode: "V/20X26C340:XCBF",
  assetType: "StockOption",
  buySell: "buy",
  openClose: "unknown",
  quantity: 1,
  price: 24.1,
  tradeDate: "2026-06-30",
  currency: "USD",
  bookedAmount: -396166,
  premiumAmount: -395797,
  transactionCost: -4288,
  exchangeRate: 164.23105,
};

function buildVisaLongCallSimulation(patch: Partial<TradeSimulation> = {}): TradeSimulation {
  return {
    id: "saxo-position-draft-visa-c340",
    status: "open",
    name: "V / API取込下書き",
    ticker: "V",
    underlyingName: "Visa Inc.",
    strategyType: "long_call",
    currentPriceUSD: 335,
    fxRateJPY: 164.23105,
    accountCode: "P",
    accountEnvironment: "PROD_P_JPY_SETTLEMENT",
    entryDate: "2026-06-30",
    expiryDate: "2026-11-20",
    dte: 143,
    accountCurrency: "JPY",
    referenceFxRateJPY: 164.23105,
    stockPosition: null,
    optionLegs: [
      {
        id: "saxo-visa-c340-leg",
        type: "call",
        side: "buy",
        strikeUSD: 340,
        premiumUSD: 24.1,
        quantity: 1,
        expiryDate: "2026-11-20",
        isCovered: false,
        assignmentPolicy: "unknown",
        brokerSymbol: "V/20X26C340:XCBF",
      },
    ],
    optionEntryExecutions: [
      {
        id: "saxo-entry-visa-c340",
        legId: "saxo-visa-c340-leg",
        tradeDate: "2026-06-30",
        contracts: 1,
        fillPriceUSD: 24.1,
        settlementCurrency: "JPY",
        brokerBookedAmountJPY: -396166,
        brokerPremiumJPY: -395797,
        brokerTransactionCostJPY: -4288,
        brokerExchangeRateJPY: 164.23105,
        referenceFxRateJPY: 164.23105,
        inputMode: "P_JPY_BROKER_STATEMENT",
        source: "saxo_api_estimate",
        saxoSourceType: "current_position",
        historyCompletionStatus: "matched",
        historyCandidateIds: ["visa-c340-entry"],
        confirmed: false,
      },
    ],
    optionCloseExecutions: [],
    brokerMarginJPY: 0,
    brokerMarginUSD: 0,
    marginBufferMultiplier: 1,
    marginUsagePercent: 0,
    availableCashJPY: 0,
    denominatorMode: "custom",
    taxProfileId: "japan_derivative_separate_tax_user_confirm",
    nisaExpectedAnnualReturnPct: 8,
    brokerCommissionUSD: 2.25,
    fixtureMeta: {
      source: "live",
      isRealMoney: true,
      broker: "SaxoBank",
      purpose: "development-fixture",
      createdAt: "2026-06-30",
      notes: "Saxo API read-onlyの現在建玉候補から作成した下書き",
      saxoInstrumentCode: "V/20X26C340:XCBF",
    },
    ...patch,
  };
}

function buildAvoidAssignmentShortPutSimulation(): TradeSimulation {
  return buildVisaLongCallSimulation({
    status: "planned",
    strategyType: "short_put",
    optionLegs: [
      {
        id: "avoid-put-leg",
        type: "put",
        side: "sell",
        strikeUSD: 300,
        premiumUSD: 5,
        quantity: 1,
        expiryDate: "2026-11-20",
        putIntent: "do_not_want_to_buy",
        assignmentPolicy: "unknown",
      },
    ],
    optionEntryExecutions: [],
  });
}

function buildSampleLongOptionCloseSimulation(type: "call" | "put", executionLegId = "sample-long-leg"): TradeSimulation {
  const simulationId = "sample-long-option";
  return {
    id: simulationId, status: "open", name: "SAMPLE", ticker: "SAMPLE", strategyType: type === "call" ? "long_call" : "long_put",
    currentPriceUSD: 100, fxRateJPY: 150, accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD",
    entryDate: "2026-08-01", expiryDate: "2026-12-18", dte: 139, referenceFxRateJPY: 150, stockPosition: null,
    optionLegs: [{ id: "sample-long-leg", type, side: "buy", strikeUSD: 100, premiumUSD: 10, quantity: 1, expiryDate: "2026-12-18", isCovered: false, assignmentPolicy: "unknown" }],
    optionEntryExecutions: [{ id: "sample-entry", legId: "sample-long-leg", tradeDate: "2026-08-01", contracts: 1, fillPriceUSD: 10, commissionUSD: 1, settlementCurrency: "USD", inputMode: "USD_EXECUTION_CALC", source: "manual", confirmed: true }],
    optionCloseExecutions: [{ id: "sample-close", legId: executionLegId, closeDate: "2026-08-10", contracts: 1, closePriceUSD: 12, commissionUSD: 1, settlementCurrency: "USD", source: "saxo_history", sourceCandidateId: "anonymous-candidate", sourceTradeId: "anonymous-trade", targetPositionId: simulationId, confirmationStatus: "pending", confirmed: false }],
    brokerMarginJPY: 0, brokerMarginUSD: 0, marginBufferMultiplier: 1, marginUsagePercent: 0, availableCashJPY: 0, denominatorMode: "custom", taxProfileId: "japan_derivative_separate_tax_user_confirm", nisaExpectedAnnualReturnPct: 8, brokerCommissionUSD: 1,
  };
}

function buildBearPutCloseDraftSimulation(): TradeSimulation {
  return {
    id: "R11-spread", status: "open", name: "Anonymous spread", ticker: "TEST", strategyType: "bear_put_spread",
    currentPriceUSD: 95, fxRateJPY: 0, accountCode: "N", accountEnvironment: "PROD_N_USD_SETTLEMENT", accountCurrency: "USD",
    entryDate: "2026-09-01", expiryDate: "2026-10-02", dte: 31, stockPosition: null,
    optionLegs: [
      { id: "R11-long", type: "put", side: "buy", strikeUSD: 100, premiumUSD: 4.92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02" },
      { id: "R11-short", type: "put", side: "sell", strikeUSD: 90, premiumUSD: 0.92, quantity: 1, contractSize: 100, expiryDate: "2026-10-02" },
    ],
    optionEntryExecutions: [
      { id: "R11-entry-long", legId: "R11-long", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 4.92, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true },
      { id: "R11-entry-short", legId: "R11-short", tradeDate: "2026-09-01", contracts: 1, fillPriceUSD: 0.92, commissionUSD: 2.24, settlementCurrency: "USD", source: "broker_statement", confirmed: true },
    ],
    optionCloseExecutions: [
      { id: "R11-close-short", legId: "R11-short", closeKind: "buyback", closeDate: "2026-09-10", contracts: 1, closePriceUSD: 0.84, commissionUSD: 2.24, settlementCurrency: "USD", source: "saxo_history", sourceCandidateId: "R11-candidate-short", confirmationStatus: "pending", confirmed: false },
      { id: "R11-close-long", legId: "R11-long", closeKind: "buyback", closeDate: "2026-09-10", contracts: 1, closePriceUSD: 4.5, commissionUSD: 2.24, settlementCurrency: "USD", source: "saxo_history", sourceCandidateId: "R11-candidate-long", confirmationStatus: "pending", confirmed: false },
    ],
    brokerMarginJPY: 0, brokerMarginUSD: 0, marginBufferMultiplier: 1, marginUsagePercent: 0,
    availableCashJPY: 0, denominatorMode: "custom", taxProfileId: "none_nisa_or_tax_free_comparison", nisaExpectedAnnualReturnPct: 8,
  };
}
