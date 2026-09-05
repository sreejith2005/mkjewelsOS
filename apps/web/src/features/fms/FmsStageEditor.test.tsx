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
  flows: [], stages: [], assignees: [], branchRules: [], forms: [{ id: "00000000-0000-4000-8000-000000000001", name: "Initial details", version: 1, family_id: "fam-1", lifecycle: "published" }],
  formFields: { "00000000-0000-4000-8000-000000000001": [{ key: "customer_type", label: "Customer type", options: [{ value: "retail", label: "Retail buyer" }, { value: "wholesale", label: "Wholesale buyer" }, { value: "distributor", label: "Distributor" }], optionValues: ["retail", "wholesale", "distributor"] }, { key: "notes", label: "Notes" }] },
  statusOptions: [{ label: "Follow Up", value: "follow_up" }, { label: "Interested", value: "interested" }], availability: [],
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
  return <FmsStageEditor data={data} onChange={setStage} onDelete={() => undefined} stage={stage} stages={[stage]} />;
}

function LaterFormHarness() {
  const first = { ...newFmsStage("form", 0), key: "initial", formTemplateId: data.forms[0]!.id };
  const [later, setLater] = useState<FmsStageDefinition>(() => ({ ...newFmsStage("form", 1), key: "later" }));
  return <FmsStageEditor data={data} onChange={setLater} onDelete={() => undefined} stage={later} stages={[first, later]} />;
}

let latestStage: FmsStageDefinition | null = null;

function RoutingHarness() {
  const first = { ...newFmsStage("form", 0), key: "initial", name: "Initial details", formTemplateId: data.forms[0]!.id, defaultNextStageKey: "qualify" };
  const wholesale = { ...newFmsStage("task", 2), key: "wholesale_desk", name: "Wholesale desk" };
  const [stage, setStage] = useState<FmsStageDefinition>(() => ({ ...newFmsStage("task", 1), key: "qualify", name: "Customer qualification", formTemplateId: data.forms[0]!.id }));
  latestStage = stage;
  return <FmsStageEditor data={data} onChange={(value) => { latestStage = value; setStage(value); }} onDelete={() => undefined} stage={stage} stages={[first, stage, wholesale]} />;
}

function DecisionHarness() {
  const [stages, setStages] = useState<FmsStageDefinition[]>(() => {
    const first = { ...newFmsStage("form", 0), key: "initial", name: "Initial details", formTemplateId: data.forms[0]!.id, defaultNextStageKey: "decision" };
    const decision = { ...newFmsStage("task", 1), key: "decision", name: "Approve request", defaultNextStageKey: "follow_up" };
    const followUp = { ...newFmsStage("task", 2), key: "follow_up", name: "Follow up" };
    return [first, decision, followUp];
  });
  const [selected, setSelected] = useState(1);
  return <><button onClick={() => setSelected(1)}>Edit decision</button><button onClick={() => setSelected(2)}>Edit follow up</button><FmsStageEditor data={data} onChange={(value) => setStages((current) => current.map((item, index) => index === selected ? value : item))} onDelete={() => undefined} stage={stages[selected]!} stages={stages} /></>;
}

describe("FMS stage editor", () => {
  it("defaults the initial Form deadline to off while later steps remain on", () => {
    expect(newFmsStage("form", 0).sla.deadlineEnabled).toBe(false);
    expect(newFmsStage("task", 1).sla.deadlineEnabled).toBe(true);
  });

  it("keeps assignment controls out of each individual stage", () => {
    render(<Harness />);
    expect(screen.queryByLabelText("Department")).toBeNull();
    expect(screen.queryByLabelText("Primary assignee")).toBeNull();
    expect(screen.queryByLabelText("Fallback assignee")).toBeNull();
  });
  it("offers optional deadlines and a normalized hours/minutes TAT", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByLabelText("Set deadline")).toBeTruthy();
    expect(screen.getByLabelText("Completion due date").getAttribute("type")).toBe("date");
    await user.click(screen.getByRole("button", { name: /TAT \(hours\)/ }));
    expect(screen.getByLabelText("TAT value")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("TAT unit"), "minutes");
    expect((screen.getByLabelText("TAT unit") as HTMLSelectElement).value).toBe("minutes");
    expect(screen.getByLabelText("Trigger from")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Days before date/ }));
    expect(screen.getByLabelText("Future date")).toBeTruthy();
    expect(screen.getByLabelText("Days before")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Specific clock time/ }));
    expect(screen.getByLabelText("Clock time")).toBeTruthy();
    await user.click(screen.getByLabelText("Set deadline"));
    expect(screen.queryByLabelText("TAT value")).toBeNull();
    expect(screen.queryByLabelText("Escalate after")).toBeNull();
  });
  it("shows the linked form selector directly, without an optional-information toggle", () => {
    render(<LaterFormHarness />);
    expect(screen.queryByLabelText("Add additional information")).toBeNull();
    expect(screen.queryByLabelText("Initial details form")).toBeNull();
    const select = screen.getByLabelText("Linked form") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.textContent).toContain("Initial details");
  });

  it("keeps instructions and completion controls available but secondary", () => {
    render(<Harness />);
    expect(screen.getByLabelText("How / instructions")).toBeTruthy();
    expect(screen.getByText("How / instructions (optional)").tagName).toBe("SUMMARY");
    expect(screen.getByText("Completion controls").tagName).toBe("SUMMARY");
    expect(screen.getByLabelText("Require evidence")).toBeTruthy();
  });

  it("routes on a linked form answer using the stable field key and option value", async () => {
    const user = userEvent.setup();
    render(<RoutingHarness />);
    await user.click(screen.getByRole("button", { name: "Add conditional route" }));
    expect((screen.getByLabelText("Route 1 source") as HTMLSelectElement).value).toBe("form_answer");
    expect((screen.getByLabelText("Route 1 question") as HTMLSelectElement).value).toBe("customer_type");
    await user.selectOptions(screen.getByLabelText("Route 1 answer"), "wholesale");
    await user.selectOptions(screen.getByLabelText("Route 1 then go to"), "wholesale_desk");
    const rule = latestStage!.branchRules[0]!;
    expect(rule).toMatchObject({ source: "form_answer", sourceKey: "customer_type", operator: "equals", value: "wholesale", nextStageKey: "wholesale_desk" });
    expect(screen.getByText("Otherwise (fallback) go to")).toBeTruthy();
  });
  it("offers the question's option labels while still matching on the stable option value", async () => {
    const user = userEvent.setup();
    render(<RoutingHarness />);
    await user.click(screen.getByRole("button", { name: "Add conditional route" }));
    const answers = screen.getByLabelText("Route 1 answer") as HTMLSelectElement;
    expect([...answers.options].map((option) => option.textContent)).toEqual(["Select an answer", "Retail buyer", "Wholesale buyer", "Distributor"]);
    await user.selectOptions(answers, "Wholesale buyer");
    expect(latestStage!.branchRules[0]!.value).toBe("wholesale");
  });
  it("warns until an unmatched answer has somewhere to go", async () => {
    const user = userEvent.setup();
    render(<RoutingHarness />);
    await user.click(screen.getByRole("button", { name: "Add conditional route" }));
    expect(screen.getByText(/An answer that matches no route must still have somewhere to go/)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Otherwise (fallback) go to"), "wholesale_desk");
    expect(screen.queryByText(/An answer that matches no route must still have somewhere to go/)).toBeNull();
  });
  it("configures conditions only from dynamic earlier-decision options", async () => {
    const user = userEvent.setup();
    render(<DecisionHarness />);
    await user.click(screen.getByRole("button", { name: /Decision step/ }));
    await user.click(screen.getByRole("button", { name: "Add decision option" }));
    await user.type(screen.getByLabelText("Decision option 3"), " Call Back Required");
    await user.click(screen.getByRole("button", { name: "Edit follow up" }));
    const conditional = screen.getByLabelText("Enable conditional step");
    await user.click(conditional);
    expect((screen.getByLabelText("Earlier decision") as HTMLSelectElement).value).toBe("decision");
    expect(screen.getByLabelText("Run when answer is").textContent).toContain("Call Back Required");
    expect(screen.queryByLabelText("Condition field")).toBeNull();
    expect(screen.queryByLabelText("Condition operator")).toBeNull();
    expect(screen.queryByLabelText("Status value")).toBeNull();
  });
});
