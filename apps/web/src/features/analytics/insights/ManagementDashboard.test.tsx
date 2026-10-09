// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen,fireEvent,waitFor} from "@testing-library/react";
const api=vi.hoisted(()=>({fetchManagementInsights:vi.fn(),fetchInsightsOptions:vi.fn(),fetchManagementInsightRecords:vi.fn(),listDashboardViews:vi.fn(),saveDashboardView:vi.fn(),deleteDashboardView:vi.fn()}));
vi.mock("@jewelos/data/analytics/index",()=>api);
vi.mock("@/auth/AuthContext",()=>({useAuth:()=>({profile:null})}));
vi.mock("@/features/realtime/useTenantRealtimeRefresh",()=>({useTenantRealtimeRefresh:()=>{}}));
import {ManagementDashboard} from "./ManagementDashboard";
const payload={version:1,generatedAt:"2026-10-09T08:00:00Z",timezone:"Asia/Kolkata",from:"2026-10-01",to:"2026-10-09",scopeLabel:"Authorized scope",moduleStates:{tasks:true,workflows:false,forms:false,people:false,crm:false},metrics:[{key:"overdue",label:"Overdue tasks",value:4,previous:null,numerator:null,denominator:null,module:"tasks",basis:"current"}],trend:[],groups:[],groupBasis:"Recorded work scope",missingDeadline:0};
afterEach(()=>{cleanup();vi.clearAllMocks();window.history.replaceState({},"","/");});
describe("management insights",()=>{
 it("opens the records behind an attention finding",async()=>{api.fetchManagementInsights.mockResolvedValue(payload);api.fetchInsightsOptions.mockResolvedValue({branches:[],departments:[],designations:[],employees:[],categories:[],flows:[],taskTypes:[],sources:[]});api.listDashboardViews.mockResolvedValue([]);api.fetchManagementInsightRecords.mockResolvedValue({rows:[],total:4,offset:0,limit:25});render(<ManagementDashboard/>);fireEvent.click(await screen.findByRole("button",{name:/Review overdue work/}));await waitFor(()=>expect(api.fetchManagementInsightRecords).toHaveBeenCalledWith(expect.objectContaining({metricKey:"overdue"})));expect(await screen.findByRole("dialog")).toBeTruthy();});
});

it("closes old-scope records on history restoration",async()=>{api.fetchManagementInsights.mockResolvedValue(payload);api.fetchInsightsOptions.mockResolvedValue({branches:[],departments:[],designations:[],employees:[],categories:[],flows:[],taskTypes:[],sources:[]});api.listDashboardViews.mockResolvedValue([]);api.fetchManagementInsightRecords.mockResolvedValue({rows:[],total:4,offset:0,limit:25});render(<ManagementDashboard/>);fireEvent.click(await screen.findByRole("button",{name:/Review overdue work/}));expect(screen.getByRole("dialog")).toBeTruthy();window.history.replaceState({},"","/?preset=today");fireEvent(window,new PopStateEvent("popstate"));await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());});
