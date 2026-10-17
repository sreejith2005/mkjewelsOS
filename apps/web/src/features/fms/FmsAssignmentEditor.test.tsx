// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FmsAssignmentEditor } from "./FmsAssignmentEditor";
import { newFmsStage } from "./definition";
import type { FmsData } from "./api";
import type { FmsStageDefinition } from "@jewelos/core";
afterEach(cleanup);
const initial = { ...newFmsStage("form", 0), key: "initial", name: "Enquiry", formTemplateId: "form" };
const next = { ...newFmsStage("task", 1), key: "call", name: "Call", formTemplateId: "completion" };
const data: FmsData = { flows: [], stages: [], assignees: [], branchRules: [], forms: [], users: [{id:"employee",employee_name:"Employee B",user_role:"staff",branch_id:"branch",department_id:"sales",working_status:"active",is_login_enabled:true}], formFields: {form:[{key:"owner",label:"Next employee",type:"user_dropdown",required:true,shown:true}]},availability:[],branches:[],departments:[] };
function Editor() { const [stage,setStage]=useState<FmsStageDefinition>(next); return <FmsAssignmentEditor stage={stage} stages={[initial,stage]} data={data} onChange={setStage} />; }
describe("versioned assignment editor",()=>{
  it("lets a pinned source question apply only to a selected route", async () => {
    const onChange = vi.fn();
    const source = { ...initial, branchRules: [{ id: "yes-route", order: 0, source: "outcome" as const, operator: "equals" as const, value: "yes", label: "Yes", nextStageKey: "call" }] };
    const stage = { ...next, sla: { ...next.sla, assignment: { mode: "previous_form" as const, allowHandoff: true, sources: [{ sourceStageKey: "initial", formTemplateId: "form", fieldKey: "owner" }] } } };
    render(<FmsAssignmentEditor stage={stage} stages={[source, stage]} data={data} onChange={onChange} />);
    await userEvent.setup().selectOptions(screen.getByLabelText("Route for Enquiry · Next employee"), "yes-route");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sla: expect.objectContaining({ assignment: expect.objectContaining({ sources: [expect.objectContaining({ routeRuleId: "yes-route" })] }) }) }));
  });
  it("offers the pinned source question and a locked named employee",async()=>{
    const user=userEvent.setup(); render(<Editor />);
    await user.selectOptions(screen.getByLabelText("How this step receives its employee"),"previous_form");
    await user.click(within(screen.getByRole("group", { name: "Source User questions" })).getByLabelText("Enquiry · Next employee"));
    await user.selectOptions(screen.getByLabelText("How this step receives its employee"),"fixed_employee");
    await user.selectOptions(screen.getByLabelText("Locked employee"),"employee");
    expect(screen.queryByLabelText("Allow the completing employee to choose an eligible replacement")).toBeNull();
    expect(screen.getByText(/This owner is locked/)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("How this step receives its employee"),"previous_form");
    expect((within(screen.getByRole("group", { name: "Source User questions" })).getByLabelText("Enquiry · Next employee") as HTMLInputElement).checked).toBe(true);
  });
});
