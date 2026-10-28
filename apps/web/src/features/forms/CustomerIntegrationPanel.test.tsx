// @vitest-environment jsdom
import { afterEach,expect,it,vi } from "vitest";
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { CustomerIntegrationPanel } from "./CustomerIntegrationPanel";
const mocks=vi.hoisted(()=>({load:vi.fn(async()=>null),save:vi.fn(async(_id:string,mapping:unknown)=>({id:"mapping",version:1,digest:"test",mapping}))}));
vi.mock("./customerIntegrationApi",()=>({loadCustomerMapping:mocks.load,saveCustomerMapping:mocks.save}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const definition={name:"Synthetic form",fields:[{key:"client",label:"Customer name",type:"text" as const,sortOrder:0},{key:"owner",label:"Assigned to",type:"user_dropdown" as const,sortOrder:1}]};
function openPanel(){const details=screen.getByText("Customer Data Integration").closest("details")!;details.open=true;fireEvent(details,new Event("toggle"));}
it("waits until opened before loading configuration",async()=>{render(<CustomerIntegrationPanel definition={definition} templateId="form"/>);expect(mocks.load).not.toHaveBeenCalled();openPanel();await waitFor(()=>expect(mocks.load).toHaveBeenCalledWith("form"));});
it("saves stable question keys and keeps employee answers operational",async()=>{
 render(<CustomerIntegrationPanel definition={definition} templateId="form"/>);
 openPanel();
 await waitFor(()=>expect(mocks.load).toHaveBeenCalled());
 fireEvent.change(screen.getByLabelText("Source account scope"),{target:{value:"synthetic-account"}});
 fireEvent.change(screen.getByLabelText("Save Customer name"),{target:{value:"both"}});
 fireEvent.change(screen.getByLabelText("Destination for Customer name"),{target:{value:"primary_name"}});
 expect(screen.queryByLabelText("Save Assigned to")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Save customer mapping"}));
 await waitFor(()=>expect(mocks.save).toHaveBeenCalledWith("form",expect.objectContaining({fields:[{fieldKey:"client",mode:"both",destination:"primary_name"}]})));
});
