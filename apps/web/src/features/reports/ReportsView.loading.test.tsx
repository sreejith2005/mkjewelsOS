// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import type {ReportPayload} from "./api";

const mocks=vi.hoisted(()=>({fetchReport:vi.fn(),refresh:undefined as (()=>Promise<void>)|undefined,requestExport:vi.fn()}));
vi.mock("@/auth/AuthContext",()=>({useAuth:()=>({access:{},profile:{user_role:"staff",tenant_id:"t1"}})}));
vi.mock("@jewelos/core",async(original)=>({...await original<typeof import("@jewelos/core")>(),hasPermission:(_access:unknown,key:string)=>key==="reports.view"||key==="reports.export"}));
vi.mock("@jewelos/api-client",()=>({supabase:{}}));
vi.mock("@/lib/crmProject",()=>({crmProjectConfig:{url:"",anonKey:""}}));
vi.mock("./api",async(original)=>({...await original<typeof import("./api")>(),fetchReport:mocks.fetchReport,fetchReportFilterOptions:async()=>({forms:[],flows:[],stages:[],employees:[]}),requestExport:mocks.requestExport}));
vi.mock("@/features/realtime/useTenantRealtimeRefresh",()=>({useTenantRealtimeRefresh:({refresh}:{refresh:()=>Promise<void>})=>{mocks.refresh=refresh;return ()=>void mocks.refresh?.();}}));

import {ReportsView} from "./ReportsView";

const preview:ReportPayload={report_key:"form_answers",rows:[{submission_id:"s1",form_name:"Synthetic form",answers:"Visible report answer",status:"submitted"}],total:1};
const emptyHistory:ReportPayload={report_key:"export_history",rows:[],total:0};
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(reason:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const historyCalls=()=>mocks.fetchReport.mock.calls.filter(([key])=>key==="export_history").length;
const previewCalls=()=>mocks.fetchReport.mock.calls.filter(([key])=>key==="form_answers").length;
beforeEach(()=>{
  window.history.replaceState({},"","/reports?report=form_answers");
  mocks.fetchReport.mockImplementation(async(key:string)=>key==="export_history"?emptyHistory:preview);
  mocks.requestExport.mockResolvedValue({id:"job"});
});
afterEach(()=>{cleanup();vi.resetAllMocks();vi.useRealTimers();});

it("renders a report while export history is still pending",async()=>{
  const history=deferred<ReportPayload>();
  mocks.fetchReport.mockImplementation(async(key:string)=>key==="export_history"?history.promise:preview);
  render(<ReportsView/>);
  expect(await screen.findByText("Visible report answer")).toBeTruthy();
  expect((screen.getByRole("button",{name:/Export CSV/}) as HTMLButtonElement).disabled).toBe(false);
  await act(async()=>history.resolve(emptyHistory));
});

it("keeps the report visible when export history fails and offers a separate retry",async()=>{
  mocks.fetchReport.mockImplementation(async(key:string)=>{if(key==="export_history")throw new Error("Export history unavailable");return preview;});
  render(<ReportsView/>);
  expect(await screen.findByText("Visible report answer")).toBeTruthy();
  expect(await screen.findByText("Export history unavailable")).toBeTruthy();
  mocks.fetchReport.mockImplementation(async(key:string)=>key==="export_history"?emptyHistory:preview);
  fireEvent.click(screen.getByRole("button",{name:"Retry"}));
  await waitFor(()=>expect(screen.queryByText("Export history unavailable")).toBeNull());
  expect(previewCalls()).toBe(1);
});

it("changes report filters without refetching unrelated export history",async()=>{
  render(<ReportsView/>);
  await screen.findByText("Visible report answer");
  fireEvent.click(screen.getByRole("button",{name:"Today"}));
  await waitFor(()=>expect(previewCalls()).toBe(2));
  expect(historyCalls()).toBe(1);
});

it("refreshes exports after queueing a job without refetching the report",async()=>{
  render(<ReportsView/>);
  await screen.findByText("Visible report answer");
  fireEvent.click(screen.getByRole("button",{name:/Export CSV/}));
  await waitFor(()=>expect(historyCalls()).toBe(2));
  expect(previewCalls()).toBe(1);
});

it("ignores an older export response after a newer refresh completes",async()=>{
  const older=deferred<ReportPayload>();
  mocks.fetchReport.mockImplementation(async(key:string)=>key==="export_history"?older.promise:preview);
  render(<ReportsView/>);
  await act(async()=>undefined);
  mocks.fetchReport.mockImplementation(async(key:string)=>key==="export_history"?emptyHistory:preview);
  await act(async()=>{await mocks.refresh?.();});
  await act(async()=>older.resolve({report_key:"export_history",rows:[{export_id:"stale",report_key:"form_answers",status:"queued"}],total:1}));
  expect(screen.getByRole("button",{name:"Your exports"}).textContent).toBe("Your exports");
});

it("polls only pending exports, waits for slow history and stops when finished",async()=>{
  vi.useFakeTimers();
  const slowHistory=deferred<ReportPayload>();
  mocks.fetchReport.mockImplementation(async(key:string)=>key==="export_history"?{report_key:"export_history",rows:[{export_id:"pending",report_key:"form_answers",status:"queued"}],total:1}:preview);
  render(<ReportsView/>);
  await act(async()=>undefined);
  mocks.fetchReport.mockImplementation(async(key:string)=>key==="export_history"?slowHistory.promise:preview);
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
  expect(historyCalls()).toBe(2);
  expect(previewCalls()).toBe(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
  expect(historyCalls()).toBe(2);
  await act(async()=>slowHistory.resolve(emptyHistory));
  await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
  expect(historyCalls()).toBe(2);
});

it("keeps the latest filtered report when an older preview resolves last",async()=>{
  const older=deferred<ReportPayload>();
  mocks.fetchReport.mockImplementation(async(key:string)=>key==="export_history"?emptyHistory:older.promise);
  render(<ReportsView/>);
  mocks.fetchReport.mockImplementation(async(key:string)=>key==="export_history"?emptyHistory:{...preview,rows:[{...preview.rows[0],answers:"Latest filtered answer"}]});
  fireEvent.click(screen.getByRole("button",{name:"Today"}));
  expect(await screen.findByText("Latest filtered answer")).toBeTruthy();
  await act(async()=>older.resolve(preview));
  expect(screen.queryByText("Visible report answer")).toBeNull();
  expect(screen.getByText("Latest filtered answer")).toBeTruthy();
});
