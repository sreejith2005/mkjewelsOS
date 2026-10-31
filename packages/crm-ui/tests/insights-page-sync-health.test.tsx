// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,render,screen,waitFor} from "@testing-library/react";
const rpc=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({rpc})}));
vi.mock("@/components/dashboard-insights/CrmInsightsDashboard",()=>({CrmInsightsDashboard:()=> <h1>CRM insights</h1>}));
vi.mock("@/components/sync-health",()=>({SyncHealth:()=> <p>Protected sync health</p>}));
import DashboardPage from "@/app/(crm)/dashboard/page";
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("preserves the existing Super Admin sync health beside insights",async()=>{rpc.mockResolvedValue({data:[{role:"super_admin"}],error:null});render(<DashboardPage/>);expect(await screen.findByText("Protected sync health")).toBeTruthy();});
it("keeps optional profile failures from blocking the dashboard",async()=>{rpc.mockRejectedValue(new Error("offline"));render(<DashboardPage/>);expect(screen.getByRole("heading",{name:"CRM insights"})).toBeTruthy();await waitFor(()=>expect(screen.queryByText("Protected sync health")).toBeNull());});
it("omits sync health for ordinary CRM staff",async()=>{rpc.mockResolvedValue({data:[{role:"salesperson"}],error:null});render(<DashboardPage/>);expect(screen.getByRole("heading",{name:"CRM insights"})).toBeTruthy();await waitFor(()=>expect(screen.queryByText("Protected sync health")).toBeNull());});
