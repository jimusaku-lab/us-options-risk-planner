import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { useOptionsStore } from "@/store/useOptionsStore";
import { emptyStrategyLedger } from "@/domain/strategyLedger";
import { valuationFixture, valuationRows } from "./fixtures/saxoValuation";
import { applyCurrentOptionPricePreview } from "@/domain/bulkOptionPrice";
import { fetchStooqQuote, fetchUsdJpyRate, type FxQuote, type StockQuote } from "@/lib/marketData";

vi.mock("@/components/results/Charts",()=>({DenominatorChart:()=>null,PayoffChart:()=>null}));
vi.mock("@/components/dashboard/YearlyPerformanceSummaryCard",()=>({YearlyPerformanceSummaryCard:()=>null}));
vi.mock("@/lib/marketData",async importOriginal=>({...await importOriginal<typeof import("@/lib/marketData")>(),fetchStooqQuote:vi.fn(),fetchUsdJpyRate:vi.fn()}));
const original=useOptionsStore.getState();
const fx:FxQuote={pair:"USDJPY",rate:155,source:"local_proxy",date:"2026-09-26",fetchedAt:"2026-09-26T00:00:00Z"};
function deferred<T>() {let resolve!:(v:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
beforeEach(()=>{
  localStorage.clear();localStorage.setItem("us-options-first-run-notice-accepted","true");
  const s=valuationFixture();
  useOptionsStore.setState({activeWorkspace:"live",simulations:[s],simulationsByWorkspace:{demo:[],live:[s]},strategyLedgersByWorkspace:{demo:emptyStrategyLedger(),live:emptyStrategyLedger()},selectedSimulationId:"",selectedSimulationIds:{demo:"",live:""},wheelCycles:[],wheelEvents:[],stockTransfers:[],wheelCyclesByWorkspace:{demo:[],live:[]},wheelEventsByWorkspace:{demo:[],live:[]}});
  vi.mocked(fetchUsdJpyRate).mockResolvedValue(fx);
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({environment:"live",connected:false,hasToken:false,readOnly:true,configurationWarnings:[]})})));
  Object.defineProperty(Element.prototype,"scrollIntoView",{configurable:true,value:vi.fn()});
});
afterEach(()=>{cleanup();useOptionsStore.setState(original);localStorage.clear();vi.resetAllMocks();vi.unstubAllGlobals();});
async function mount(){render(<App/>);await waitFor(()=>expect(fetchUsdJpyRate).toHaveBeenCalled());}
function adopt(){const s=useOptionsStore.getState().simulations[0];useOptionsStore.getState().applySimulationBatch(applyCurrentOptionPricePreview([s],valuationRows(s),{includeConfirmedReferences:true}));return useOptionsStore.getState().simulations[0];}
describe("R16.1 asynchronous header market updates",()=>{
 it.each(["為替","株価"])("late %s response cannot roll back adopted option valuation",async kind=>{
   await mount();const pending=deferred<FxQuote & StockQuote>();
   if(kind==="為替")vi.mocked(fetchUsdJpyRate).mockReturnValueOnce(pending.promise);else vi.mocked(fetchStooqQuote).mockReturnValueOnce(pending.promise);
   fireEvent.click(screen.getByRole("button",{name:kind}));
   let saved!:ReturnType<typeof adopt>;act(()=>{saved=adopt();});
   await act(async()=>pending.resolve({...fx,source:"local_proxy",symbol:"ABC",price:112}));
   const actual=useOptionsStore.getState().simulations[0];
   expect(actual.currentValuationBasis).toEqual(saved.currentValuationBasis);
   expect(actual.optionLegs).toEqual(saved.optionLegs);
   expect(kind==="為替"?actual.fxRateJPY:actual.currentPriceUSD).toBe(kind==="為替"?155:112);
 });
 it("does not resurrect deleted records when FX responds",async()=>{
   await mount();const pending=deferred<FxQuote>();vi.mocked(fetchUsdJpyRate).mockReturnValueOnce(pending.promise);
   fireEvent.click(screen.getByRole("button",{name:"為替"}));
   act(()=>useOptionsStore.getState().deleteSimulation("anonymous"));await act(async()=>pending.resolve(fx));
   expect(useOptionsStore.getState().simulations).toEqual([]);
 });
 it("does not write a live request into a different workspace",async()=>{
   await mount();const pending=deferred<FxQuote>();vi.mocked(fetchUsdJpyRate).mockReturnValueOnce(pending.promise);
   fireEvent.click(screen.getByRole("button",{name:"為替"}));act(()=>useOptionsStore.getState().switchWorkspace("demo"));
   await act(async()=>pending.resolve(fx));expect(useOptionsStore.getState().simulationsByWorkspace.demo).toEqual([]);
 });
 it("ignores an older FX response after a newer request finished",async()=>{
   await mount();const first=deferred<FxQuote>(),second=deferred<FxQuote>();
   vi.mocked(fetchUsdJpyRate).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
   fireEvent.click(screen.getByRole("button",{name:"為替"}));fireEvent.click(screen.getByRole("button",{name:"為替"}));
   await act(async()=>second.resolve({...fx,rate:156}));await act(async()=>first.resolve({...fx,rate:154}));
   expect(useOptionsStore.getState().simulations[0].fxRateJPY).toBe(156);
 });
 it("invalidates live-demo-live ABA requests",async()=>{
   await mount();const pending=deferred<FxQuote>();vi.mocked(fetchUsdJpyRate).mockReturnValueOnce(pending.promise);
   fireEvent.click(screen.getByRole("button",{name:"為替"}));
   act(()=>useOptionsStore.getState().switchWorkspace("demo"));act(()=>useOptionsStore.getState().switchWorkspace("live"));
   await act(async()=>pending.resolve({...fx,rate:170}));expect(useOptionsStore.getState().simulations[0].fxRateJPY).toBe(150);
 });
 it("preserves a manual field edit made while a request is pending",async()=>{
   await mount();const pending=deferred<FxQuote>();vi.mocked(fetchUsdJpyRate).mockReturnValueOnce(pending.promise);
   fireEvent.click(screen.getByRole("button",{name:"為替"}));
   act(()=>{const s=useOptionsStore.getState().simulations[0];useOptionsStore.getState().upsertSimulation({...s,fxRateJPY:160});});
   await act(async()=>pending.resolve(fx));expect(useOptionsStore.getState().simulations[0].fxRateJPY).toBe(160);
 });
 it("ignores an older stock response and preserves option evidence",async()=>{
   await mount();const first=deferred<StockQuote>(),second=deferred<StockQuote>();
   vi.mocked(fetchStooqQuote).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
   fireEvent.click(screen.getByRole("button",{name:"株価"}));fireEvent.click(screen.getByRole("button",{name:"株価"}));
   act(()=>{adopt();});
   await act(async()=>second.resolve({symbol:"ABC",price:114,source:"local_proxy"}));await act(async()=>first.resolve({symbol:"ABC",price:111,source:"local_proxy"}));
   expect(useOptionsStore.getState().simulations[0].currentPriceUSD).toBe(114);
   expect(useOptionsStore.getState().simulations[0].currentValuationBasis?.kind).toBe("saxo-position");
 });
});
