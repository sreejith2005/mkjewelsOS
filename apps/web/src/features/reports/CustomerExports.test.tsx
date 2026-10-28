// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {CustomerExports} from "./CustomerExports";
const mocks=vi.hoisted(()=>({allowed:true,rpc:vi.fn()}));
vi.mock("@/auth/AuthContext",()=>({useAuth:()=>({access:{}})}));
vi.mock("@jewelos/core",async original=>({...await original<typeof import("@jewelos/core")>(),hasPermission:()=>mocks.allowed}));
vi.mock("@jewelos/api-client",()=>({supabase:{rpc:mocks.rpc}}));
afterEach(()=>{cleanup();vi.clearAllMocks();mocks.allowed=true;});
function open(){const element=screen.getByText("Customer & Stage Exports").closest("details")!;element.open=true;fireEvent(element,new Event("toggle"));}
it("does not load export configuration before the panel is opened",()=>{render(<CustomerExports/>);expect(mocks.rpc).not.toHaveBeenCalled();});
it("hides export controls without report permission",()=>{mocks.allowed=false;render(<CustomerExports/>);expect(screen.queryByText("Customer & Stage Exports")).toBeNull();});
it("queues the existing private export lifecycle with India business dates",async()=>{
 mocks.rpc.mockImplementation(async(name:string)=>({data:name==="customer_export_options"?{flows:[],stages:[],employees:[]}:name==="get_customer_export_layouts"?[]:{id:"job"},error:null}));
 render(<CustomerExports/>);open();await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledWith("get_customer_export_layouts",{}));
 fireEvent.change(screen.getByLabelText("From"),{target:{value:"2026-10-01"}});fireEvent.change(screen.getByLabelText("Through"),{target:{value:"2026-10-02"}});
 fireEvent.click(screen.getByRole("button",{name:"Queue private CSV export"}));
 await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledWith("request_customer_export",expect.objectContaining({p_key:"customer_master",p_filters:{from:"2026-09-30T18:30:00.000Z",until:"2026-10-02T18:30:00.000Z"}})));
 await screen.findByText(/Export queued/);
});
