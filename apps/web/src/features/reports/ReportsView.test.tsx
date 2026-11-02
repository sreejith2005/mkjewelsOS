// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";

const mocks=vi.hoisted(()=>({permissions:new Set<string>(["reports.view","reports.export","crm.view"]),role:"manager",rpc:vi.fn(),crmReport:vi.fn(),crmCustomers:vi.fn()}));
vi.mock("@/auth/AuthContext",()=>({useAuth:()=>({access:{},profile:{user_role:mocks.role,tenant_id:"t1"}})}));
vi.mock("@jewelos/core",async(original)=>({...await original<typeof import("@jewelos/core")>(),hasPermission:(_access:unknown,key:string)=>mocks.permissions.has(key)}));
vi.mock("@jewelos/api-client",()=>({supabase:{rpc:mocks.rpc,from:()=>({select:()=>({eq:()=>({order:async()=>({data:[],error:null})})})})}}));
vi.mock("@jewelos/crm-ui/analytics",()=>({createCrmReportReader:()=>({report:mocks.crmReport,options:async()=>({branches:[],employees:[],crmNames:[],sources:[{id:"Instagram",name:"Instagram"}]}),customers:mocks.crmCustomers})}));
vi.mock("@/lib/crmProject",()=>({crmProjectConfig:{url:"https://crm.example.invalid",anonKey:"anon"}}));
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
  mocks.crmReport.mockResolvedValue({rows:[{customer_id:"MKC-1",name:"Asha Synthetic",primary_phone:"+91 9876543210",purchase_status:"Buyer",last_interaction:"2026-11-01T18:45:00Z"}],total:1});
  mocks.crmCustomers.mockResolvedValue([{client_id:"7d6b1c1e-2f0a-4c1e-9a55-5b1f1d2c3e4f",customer_id:"MKC-1",name:"Asha Synthetic",phone:"+91 9876543210"}]);
});
afterEach(()=>{cleanup();vi.clearAllMocks();mocks.permissions=new Set(["reports.view","reports.export","crm.view"]);mocks.role="manager";});

it("groups the business reports into three categories and opens the customer master by default",async()=>{
  render(<ReportsView/>);
  const categories=screen.getByRole("navigation",{name:"Report categories"});
  expect(within(categories).getAllByRole("button").map((button)=>button.textContent)).toEqual(["Customer & CRM","Forms, FMS & Tasks","Employee Performance"]);
  expect(await screen.findAllByText("Asha Synthetic")).not.toHaveLength(0);
  expect(mocks.crmReport).toHaveBeenCalledWith("customer_report_master",{},0,25);
  expect(screen.queryByText("Notification delivery health")).toBeNull();
  expect(screen.queryByText(/Customer & Stage Exports/)).toBeNull();
});

it("hides CRM reports without CRM access and never offers people reports to staff",async()=>{
  mocks.permissions=new Set(["reports.view","reports.export"]);mocks.role="staff";
  render(<ReportsView/>);
  expect(screen.queryByRole("button",{name:"Customer & CRM"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Employee Performance"})).toBeNull();
  expect(await screen.findByText("All Form Submissions",{selector:"span"})).toBeTruthy();
  expect(mocks.crmReport).not.toHaveBeenCalled();
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

it("queues a CRM export through the customer export path with CRM filter names",async()=>{
  render(<ReportsView/>);
  await screen.findAllByText("Asha Synthetic");
  fireEvent.change(screen.getByLabelText("Purchase status"),{target:{value:"Buyer"}});
  await waitFor(()=>expect(mocks.crmReport).toHaveBeenLastCalledWith("customer_report_master",{purchaseClass:"Buyer"},0,25));
  fireEvent.click(screen.getByRole("button",{name:/Export CSV/}));
  await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledWith("request_customer_export",expect.objectContaining({p_key:"customer_report_master",p_filters:{purchaseClass:"Buyer"}})));
  expect(await screen.findByText(/CRM administrator access/)).toBeTruthy();
});

it("asks for a customer before showing the 360° journey",async()=>{
  window.history.replaceState({},"","/reports?report=customer_report_journey");
  render(<ReportsView/>);
  expect(await screen.findByText(/Search for a customer above/)).toBeTruthy();
  expect(mocks.crmReport).not.toHaveBeenCalled();
  expect((screen.getByRole("button",{name:/Export CSV/}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByPlaceholderText("Type at least 2 characters"),{target:{value:"Asha"}});
  fireEvent.click(await screen.findByRole("button",{name:/Asha Synthetic/}));
  await waitFor(()=>expect(mocks.crmReport).toHaveBeenCalledWith("customer_report_journey",{clientId:"7d6b1c1e-2f0a-4c1e-9a55-5b1f1d2c3e4f"},0,25));
});
