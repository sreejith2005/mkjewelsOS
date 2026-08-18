// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { FmsStageDefinition } from "@jewelos/core";
import type { FmsData } from "./api";
import { newFmsStage } from "./definition";
import { FmsStageEditor } from "./FmsStageEditor";

const data: FmsData = {
  flows: [], stages: [], assignees: [], branchRules: [], forms: [{ id: "00000000-0000-4000-8000-000000000001", name: "Initial details", version: 1 }], statusOptions: [{ label: "Follow Up", value: "follow_up" }, { label: "Interested", value: "interested" }], availability: [],
  branches: [{ id: "b1", name: "Main" }],
  departments: [{ id: "d1", branch_id: null, name: "Sales" }],
  users: [
    { id: "u1", employee_name: "Primary Person", employee_code: "EMP-1", account_status: "active", user_role: "staff", branch_id: "b1", department_id: "d1", working_status: "active", is_login_enabled: true },
    { id: "u2", employee_name: "Fallback Person", employee_code: "EMP-2", account_status: "invited", user_role: "staff", branch_id: "b2", department_id: "d1", working_status: "active", is_login_enabled: false },
  ],
};

afterEach(cleanup);

function Harness() {
  const [stage, setStage] = useState<FmsStageDefinition>(() => ({ ...newFmsStage("task", 0), key: "task" }));
  return <FmsStageEditor data={data} flowBranchId="b1" onChange={setStage} onDelete={() => undefined} stage={stage} stages={[stage]} />;
}

function LaterFormHarness() {
  const first = { ...newFmsStage("form", 0), key: "initial", formTemplateId: data.forms[0]!.id };
  const [later, setLater] = useState<FmsStageDefinition>(() => ({ ...newFmsStage("form", 1), key: "later" }));
  return <FmsStageEditor data={data} flowBranchId="b1" onChange={setLater} onDelete={() => undefined} stage={later} stages={[first, later]} />;
}

function DecisionHarness() {
  const [stages, setStages] = useState<FmsStageDefinition[]>(() => {
    const first = { ...newFmsStage("form", 0), key: "initial", name: "Initial details", formTemplateId: data.forms[0]!.id, defaultNextStageKey: "decision" };
    const decision = { ...newFmsStage("task", 1), key: "decision", name: "Approve request", defaultNextStageKey: "follow_up" };
    const followUp = { ...newFmsStage("task", 2), key: "follow_up", name: "Follow up" };
    return [first, decision, followUp];
  });
  const [selected, setSelected] = useState(1);
  return <><button onClick={() => setSelected(1)}>Edit decision</button><button onClick={() => setSelected(2)}>Edit follow up</button><FmsStageEditor data={data} flowBranchId="b1" onChange={(value) => setStages((current) => current.map((item, index) => index === selected ? value : item))} onDelete={() => undefined} stage={stages[selected]!} stages={stages} /></>;
}

describe("FMS stage assignment", () => {
  it("keeps the department selected and exposes primary and same-department fallback people", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.selectOptions(screen.getByLabelText("Department"), "d1");
    expect(screen.getByText("2 people available from Users for this department.")).toBeTruthy();

    const primary = screen.getByLabelText("Primary assignee");
    expect(primary.textContent).toContain("Primary Person");
    expect(primary.textContent).toContain("Fallback Person");
    await user.selectOptions(primary, "u1");

    const fallback = screen.getByLabelText("Fallback assignee");
    expect(fallback.textContent).toContain("Fallback Person");
    expect(fallback.textContent).not.toContain("Primary Person");
  });
  it("offers all supported timing methods without minute-based SLA fields", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByLabelText("Completion due date").getAttribute("type")).toBe("date");
    await user.click(screen.getByRole("button", { name: /TAT \(hours\)/ }));
    expect(screen.getByLabelText("TAT (hours)")).toBeTruthy();
    expect(screen.getByLabelText("Trigger from")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Days before date/ }));
    expect(screen.getByLabelText("Future date")).toBeTruthy();
    expect(screen.getByLabelText("Days before")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Specific clock time/ }));
    expect(screen.getByLabelText("Clock time")).toBeTruthy();
    expect(screen.queryByLabelText("SLA minutes")).toBeNull();
    expect(screen.queryByLabelText("Escalate after")).toBeNull();
  });
  it("requires the initial details form but keeps every later form attachment optional", async () => {
    const user = userEvent.setup();
    render(<LaterFormHarness />);
    expect(screen.queryByLabelText("Initial details form")).toBeNull();
    expect(screen.queryByLabelText("Optional linked form")).toBeNull();
    await user.click(screen.getByLabelText("Add additional information"));
    await user.click(screen.getByLabelText("Attach an optional form"));
    expect(screen.getByLabelText("Optional linked form")).toBeTruthy();
  });
  it("configures a Status condition and retains the earlier Yes or No alternative", async () => {
    const user = userEvent.setup();
    render(<DecisionHarness />);
    await user.click(screen.getByRole("button", { name: /Decision step \(Yes\/No\)/ }));
    await user.click(screen.getByRole("button", { name: "Edit follow up" }));
    const conditional = screen.getByLabelText("Enable conditional step");
    await user.click(conditional);
    expect((screen.getByLabelText("Condition field") as HTMLSelectElement).value).toBe("status");
    expect((screen.getByLabelText("Status value") as HTMLSelectElement).value).toBe("follow_up");
    await user.selectOptions(screen.getByLabelText("Condition field"), "decision");
    expect((screen.getByLabelText("Earlier decision") as HTMLSelectElement).value).toBe("decision");
  });
});
