// @vitest-environment jsdom
import { afterEach,expect,it,vi } from "vitest";
import { cleanup,render,screen } from "@testing-library/react";
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("@jewelos/api-client",()=>({supabase:{rpc:mocks.rpc}}));
import { FmsCustomerLink } from "./FmsCustomerLink";
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("shows nothing for workflows without customer mapping",async()=>{
 mocks.rpc.mockResolvedValue({data:{state:"not_configured",pendingUpdates:0},error:null});
 const {container}=render(<FmsCustomerLink instanceId="i1"/>);
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(container.textContent).toBe("");
 expect(mocks.rpc).toHaveBeenCalledWith("get_fms_customer_sync_status",{p_instance_id:"i1"});
});
it("links a linked customer in one tap",async()=>{
 mocks.rpc.mockResolvedValue({data:{state:"linked",pendingUpdates:1,clientId:"c1"},error:null});
 render(<FmsCustomerLink instanceId="i1"/>);
 expect(await screen.findByText("Linked to CRM customer")).toBeTruthy();
 expect(screen.getByRole("link",{name:"Open CRM customer profile"}).getAttribute("href")).toBe("/crm/clients/c1");
 expect(screen.getByText(/1 update still sending/)).toBeTruthy();
});
it("explains a pending state without a customer link for people without CRM access",async()=>{
 mocks.rpc.mockResolvedValue({data:{state:"waiting_authorization",pendingUpdates:1,reason:"mapping_unapproved"},error:null});
 render(<FmsCustomerLink instanceId="i1"/>);
 expect(await screen.findByText("Waiting for CRM authorization")).toBeTruthy();
 expect(screen.getByText(/the form mapping is not approved/)).toBeTruthy();
 expect(screen.queryByRole("link")).toBeNull();
});
it("never blocks work when the status read fails",async()=>{
 mocks.rpc.mockResolvedValue({data:null,error:{message:"Workflow access required"}});
 const {container}=render(<FmsCustomerLink instanceId="i1"/>);
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(container.textContent).toBe("");
});
