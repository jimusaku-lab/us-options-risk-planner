import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { valuationFixture, valuationPositions, valuationRows } from "@/test/fixtures/saxoValuation";
import { projectPriceAdoption, summarizePriceAdoption } from "./priceAdoptionProjection";
import { applyCurrentPricePreview, createCurrentStockPricePreviewRow, getCurrentStockPriceTargets, getBulkOptionPricePreviewCounts } from "./bulkOptionPrice";
import { BulkOptionPricePreview } from "@/components/dashboard/Dashboard";
import { calculatePositionBasisEvaluation } from "./positionBasisEvaluation";

describe("R16.1 adoption outcome not price-response success",()=>{
  it("separates stock-only success from option evidence and reports actual missing reasons",()=>{
    const s=valuationFixture(false);delete s.optionLegs[0].contractSize;
    const stock=createCurrentStockPricePreviewRow(getCurrentStockPriceTargets([s])[0],{symbol:s.ticker,price:111,source:"local_proxy"});
    const next=applyCurrentPricePreview([s],[],[stock]);
    const report=summarizePriceAdoption([s],next,next);
    expect(report).toMatchObject({stockUpdates:1,optionUpdates:0,optionLegUpdates:0,evaluationAvailable:0});
    expect(report.message).toContain("オプション価格・評価証拠保存0建玉");expect(report.problems.join()).toContain("契約倍率");
  });
  it("counts all active reference evaluations, including broker fallback, not just old vertical calculator",()=>{
    const s=valuationFixture();const next=applyCurrentPricePreview([s],valuationRows(s),[],{includeConfirmedReferences:true});
    expect(summarizePriceAdoption([s],next,next)).toMatchObject({optionUpdates:1,optionLegUpdates:2,evaluationAvailable:1});
    expect(summarizePriceAdoption([s],next,[s]).optionUpdates).toBe(0);
    expect(summarizePriceAdoption([s],next,[s]).problems.join()).toContain("保存後");
  });
  it("complete Mid but missing app entry economics chooses complete broker amount without manufacturing entries",()=>{
    const s=valuationFixture();s.optionEntryExecutions=[];const before=JSON.stringify(s);
    const rows=valuationRows(s,valuationPositions(s),true);
    expect(getBulkOptionPricePreviewCounts(rows,[s]).confirmableReference).toBe(2);
    const preview=projectPriceAdoption([s],rows,[],true)[0];
    expect(preview.basis).toBe("saxo-position");expect(preview.reference.amount).toBe(-55.45);
    expect(preview.conservative.kind).toBe("missing");expect(JSON.stringify(s)).toBe(before);
    expect(projectPriceAdoption([s],rows,[],false)[0].reference.kind).toBe("missing");
    const saved=applyCurrentPricePreview([s],rows,[],{includeConfirmedReferences:true})[0];
    expect(saved.optionEntryExecutions).toEqual([]);expect(saved.optionLegs.map(l=>l.closePlan)).toEqual(s.optionLegs.map(l=>l.closePlan));
    expect(calculatePositionBasisEvaluation(JSON.parse(JSON.stringify(saved))).reference.amount).toBe(-55.45);
  });
  it("direct multiplier and current FX make legacy P/JPY Mid computable in both preview and actual apply",()=>{
    const s=valuationFixture(false);s.accountCode="P";s.accountCurrency="JPY";s.accountEnvironment="PROD_P_JPY_SETTLEMENT";
    delete s.optionLegs[0].contractSize;s.fxRateJPY=undefined as unknown as number;
    Object.assign(s.optionEntryExecutions![0],{settlementCurrency:"JPY",brokerBookedAmountJPY:-100000,commissionUSD:undefined});
    const fx={pair:"USDJPY" as const,rate:150,source:"local_proxy" as const,date:"2026-09-26",fetchedAt:"2026-09-26T00:00:00Z"};
    const rows=valuationRows(s,valuationPositions(s),true),projected=projectPriceAdoption([s],rows,[],true,fx)[0];
    expect(projected.basis).toBe("midpoint");expect(projected.reference.kind).toBe("available");
    expect(projected.legs[0]).toMatchObject({candidateMultiplier:100,afterMultiplier:100});
    const next=applyCurrentPricePreview([s],rows,[],{includeConfirmedReferences:true,currentFx:fx})[0];
    expect(calculatePositionBasisEvaluation(next,fx).reference.amount).toBe(projected.reference.amount);
    expect(s.optionLegs[0].contractSize).toBeUndefined();
  });
  it("DOM exposes projected outcome only in collapsed details and contains no identity",()=>{
    const s=valuationFixture();s.optionEntryExecutions=[];
    render(<BulkOptionPricePreview rows={valuationRows(s,valuationPositions(s),true)} stockRows={[]} diagnostics={new Map()} simulations={[s]} referenceConfirmed onReferenceConfirmedChange={()=>{}} />);
    const details=screen.getByLabelText("反映後の評価見込み診断");
    expect(details.tagName).toBe("DETAILS");expect(details).not.toHaveAttribute("open");
    expect(within(details).getByText(/Saxo評価/)).toBeInTheDocument();expect(details.textContent).toContain("55.45");
    expect(details.textContent).not.toMatch(/fiction-account|fiction-position/);
  });
  it("blocks stock-only apply until every confirmable option reference is explicitly confirmed",()=>{
    const s=valuationFixture();
    const optionRows=valuationRows(s,valuationPositions(s),false);
    const stockRow=createCurrentStockPricePreviewRow(getCurrentStockPriceTargets([s])[0],{symbol:s.ticker,price:111,source:"local_proxy"});
    const onApply=vi.fn();
    render(<BulkOptionPricePreview rows={optionRows} stockRows={[stockRow]} diagnostics={new Map()} simulations={[s]} referenceConfirmed={false} onReferenceConfirmedChange={vi.fn()} onApply={onApply} />);
    const button=screen.getByRole("button",{name:/株価1銘柄/});
    expect(button).toBeDisabled();
    expect(screen.getByText("参考値の確認が必要です。確認するまで株価だけの一括反映もできません。")).toBeInTheDocument();
    fireEvent.click(button);
    expect(onApply).not.toHaveBeenCalled();
  });
});
