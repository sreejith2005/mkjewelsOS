// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {DropdownListInsights} from "@/features/dropdowns/api";

const mocks=vi.hoisted(()=>({insights:vi.fn(),refresh:undefined as (()=>Promise<void>)|undefined}));
vi.mock("@jewelos/api-client",()=>({supabase:{rpc:vi.fn()}}));
vi.mock("@/auth/AuthContext",()=>({useAuth:()=>({access:{},profile:{tenant_id:"t1"}})}));
vi.mock("@jewelos/core",async(original)=>({...await original<typeof import("@jewelos/core")>(),hasPermission:()=>true}));
vi.mock("@/features/realtime/useTenantRealtimeRefresh",()=>({useTenantRealtimeRefresh:({refresh}:{refresh:()=>Promise<void>})=>{mocks.refresh=refresh;}}));
vi.mock("@/features/dropdowns/api",()=>({invalidateMasterOptions:()=>undefined,loadDropdownListInsights:mocks.insights,loadDropdownMasterRows:async()=>[{id:"occasion",tenant_id:"t1",master_type:"occasion",label:"Wedding",value:"wedding",sort_order:0,is_active:true,created_by:"u1",updated_by:"u1",created_at:"2026-10-20T10:00:00Z",updated_at:"2026-10-20T10:00:00Z"}]}));

import {DropdownMasterPage} from "./DropdownMasterPage";

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>((yes)=>{resolve=yes;});return {promise,resolve};}
const facts:DropdownListInsights={madeInForms:new Map([["occasion","2026-10-28T09:00:00Z"]]),builtIn:new Set(),usedBy:new Map([["occasion",[{formTemplateId:"f1",name:"Visit form",lifecycle:"published",questions:["Occasion"]}]]]),complete:true};
beforeEach(()=>{window.history.replaceState({},"","/dropdown-master");mocks.insights.mockResolvedValue(facts);});
afterEach(()=>{cleanup();vi.resetAllMocks();});

it("opens a list while optional origin and form usage insights are still loading",async()=>{
  const slow=deferred<DropdownListInsights>();mocks.insights.mockReturnValue(slow.promise);
  render(<DropdownMasterPage/>);
  const occasion=await screen.findByRole("button",{name:"Open Occasion"});
  expect(screen.getByRole("button",{name:"Made in forms"})).toHaveProperty("disabled",true);
  fireEvent.click(occasion);
  expect(screen.getByText("Wedding")).toBeTruthy();
  expect(screen.queryByText(/No form questions use this list yet/)).toBeNull();
  await act(async()=>slow.resolve(facts));
  expect(await screen.findByText("Visit form")).toBeTruthy();
});

it("keeps lists usable when optional insights fail",async()=>{
  mocks.insights.mockRejectedValue(new Error("Optional metadata unavailable"));
  render(<DropdownMasterPage/>);
  expect(await screen.findByText(/Some details .*could not be loaded/)).toBeTruthy();
  fireEvent.click(await screen.findByRole("button",{name:"Open Occasion"}));
  expect(screen.getByText("Wedding")).toBeTruthy();
});

it("ignores stale optional insights after a newer refresh",async()=>{
  const older=deferred<DropdownListInsights>();mocks.insights.mockReturnValue(older.promise);
  render(<DropdownMasterPage/>);
  await act(async()=>undefined);
  mocks.insights.mockResolvedValue(facts);
  await act(async()=>{await mocks.refresh?.();});
  const occasion=await screen.findByRole("button",{name:"Open Occasion"});
  expect(within(occasion).getByText("Made in a form")).toBeTruthy();
  await act(async()=>older.resolve({...facts,madeInForms:new Map(),builtIn:new Set(["occasion"])}));
  expect(within(occasion).getByText("Made in a form")).toBeTruthy();
});
