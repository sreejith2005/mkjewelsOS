// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";

const mocks=vi.hoisted(()=>({permissions:new Set<string>(["reports.view","reports.export","crm.view"]),role:"manager",rpc:vi.fn()}));
vi.mock("@/auth/AuthContext",()=>({useAuth:()=>({access:{},profile:{user_role:mocks.role,tenant_id:"t1"}})}));
vi.mock("@jewelos/core",async(original)=>({...await original<typeof import("@jewelos/core")>(),hasPermission:(_access:unknown,key:string)=>mocks.permissions.has(key)}));
vi.mock("@jewelos/api-client",()=>({supabase:{rpc:mocks.rpc,from:()=>({select:()=>({eq:()=>({order:async()=>({data:[],error:null})})})})}}));
vi.mock("@/features/realtime/useTenantRealtimeRefresh",()=>({useTenantRealtimeRefresh:()=>()=>undefined}));

import {ReportsView} from "./ReportsView";

const empty={rows:[],total:0};
beforeEach(()=>{
  window.history.replaceState({},"","/reports");
  mocks.rpc.mockImplementation(async(name:string,args:{p_report_key?:string;p_filters?:Record<string,unknown>})=>{
    if(name==="get_report_filter_options")return {data:{forms:[{id:"8f6b1c1e-2f0a-4c1e-9a55-5b1f1d2c3e4f",name:"Walk-in enquiry"}],flows:[],stages:[],employees:[]},error:null};
    if(name==="get_report_data"&&args.p_report_key==="export_history")return {data:empty,error:null};
    if(name==="get_report_data"&&args.p_report_key==="form_answers")return {data:args.p_filters?.form_family_id
      ?{rows:[{submission_id:"s1",form_name:"Walk-in enquiry","q:customer_name":"Asha Synthetic","q:customer_number":"9876543210",submitted_at:"2026-11-02T04:30:00Z"}],total:1,columns:[{key:"form_name",label:"Form"},{key:"q:customer_name",label:"Customer Name"},{key:"q:customer_number",label:"Customer Number",phone:true}]}
      :{rows:[{submission_id:"s1",form_name:"Walk-in enquiry",answers:"Customer Name: Asha Synthetic",answer_list:[{label:"Customer Name",value:"Asha Synthetic"}],status:"submitted"}],total:1},error:null};
    if(name==="get_report_data")return {data:{rows:[],total:0,summary:{}},error:null};
    return {data:{id:"job"},error:null};
  });
});
afterEach(()=>{cleanup();vi.clearAllMocks();mocks.permissions=new Set(["reports.view","reports.export","crm.view"]);mocks.role="manager";});

it("groups the business reports into two categories and opens the first report (the old CRM reports are gone)",async()=>{
  render(<ReportsView/>);
  const categories=screen.getByRole("navigation",{name:"Report categories"});
  expect(within(categories).getAllByRole("button").map((button)=>button.textContent)).toEqual(["Forms, FMS & Tasks","Employee Performance"]);
  expect(await screen.findAllByText("Customer Name: Asha Synthetic")).not.toHaveLength(0);
  expect(mocks.rpc).not.toHaveBeenCalledWith("request_customer_export",expect.anything());
  expect(screen.queryByText("Notification delivery health")).toBeNull();
  expect(screen.queryByText(/Customer & CRM/)).toBeNull();
});

it("never offers people reports to staff",async()=>{
  mocks.permissions=new Set(["reports.view","reports.export"]);mocks.role="staff";
  render(<ReportsView/>);
  expect(screen.queryByRole("button",{name:"Customer & CRM"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Employee Performance"})).toBeNull();
  expect(await screen.findByText("All Form Submissions",{selector:"span"})).toBeTruthy();
});

it("shows one column per question for a chosen form and sends a custom date range",async()=>{
  window.history.replaceState({},"","/reports?report=form_answers");
  render(<ReportsView/>);
  await screen.findAllByText("Customer Name: Asha Synthetic");
  const firstCall=mocks.rpc.mock.calls.find(([name,args])=>name==="get_report_data"&&args.p_report_key==="form_answers");
  expect(firstCall?.[1].p_filters).toMatchObject({preset:"custom"});
  fireEvent.change(await screen.findByLabelText("Form"),{target:{value:"8f6b1c1e-2f0a-4c1e-9a55-5b1f1d2c3e4f"}});
  expect(await screen.findAllByText("Customer Number")).not.toHaveLength(0);
  expect(screen.getAllByRole("link",{name:"9876543210"})[0]?.getAttribute("href")).toBe("tel:9876543210");
});
