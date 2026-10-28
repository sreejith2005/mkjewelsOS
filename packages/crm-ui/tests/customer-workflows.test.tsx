// @vitest-environment jsdom
import { afterEach,expect,it,vi } from "vitest";
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { CustomerWorkflows } from "@/components/customer-workflows";
const history=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/customer-integration",()=>({customerHistory:history,customerCommercial:()=>Promise.resolve({classification:"Non-Buyer/Prospect",first:null,latest:null})}));
afterEach(()=>{cleanup();history.mockReset();});
const row={id:"source.1",at:"2026-10-01T10:20:30Z",actorId:"employee",sourceActorId:"source-employee",channel:"INSTAGRAM",kind:"form.submitted",workflow:{instanceId:"instance",instanceStageId:"visit",stageName:"Negotiation",actorName:"Synthetic actor"},provenance:{},answers:[{key:"status",label:"Status",original:"not_interested",labels:["DECISION PENDING"]},{key:"nested",label:"Other evidence",original:{count:0,confirmed:false},labels:[]}]};
function open(){const panel=screen.getByText("Workflow history").closest("details")!;panel.open=true;fireEvent(panel,new Event("toggle"));}
it("loads customer history only when opened and uses original option meaning",async()=>{history.mockResolvedValue([row]);render(<CustomerWorkflows clientId="customer"/>);expect(history).not.toHaveBeenCalled();open();await screen.findByText("DECISION PENDING");expect(screen.getByText("Synthetic actor",{exact:false})).toBeTruthy();expect(screen.getByText("0")).toBeTruthy();expect(screen.getByText("No")).toBeTruthy();expect(screen.getByRole("link",{name:"Open this work"}).getAttribute("href")).toBe("/tasks/fms?instance=instance&stage=visit");});
it("does not append an old customer's delayed page to a new profile",async()=>{
 let finish:(value:unknown)=>void=()=>{};history.mockResolvedValueOnce(Array.from({length:25},(_,i)=>({...row,id:`source.${i}`}))).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce([{...row,id:"new",workflow:{stageName:"New profile evidence"}}]);
 const view=render(<CustomerWorkflows clientId="first"/>);open();await screen.findByRole("button",{name:"Show older"});fireEvent.click(screen.getByRole("button",{name:"Show older"}));view.rerender(<CustomerWorkflows clientId="second"/>);await screen.findByText("New profile evidence");finish([{...row,id:"old",workflow:{stageName:"Wrong customer's answer"}}]);await waitFor(()=>expect(screen.queryByText("Wrong customer's answer")).toBeNull());
});
