// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { FmsBranchRule, FmsStageDefinition } from "@jewelos/core";
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

function RoutingHarness({ rule }: { rule?: FmsBranchRule } = {}) {
  const first = { ...newFmsStage("form", 0), key: "initial", name: "Initial details", formTemplateId: data.forms[0]!.id, defaultNextStageKey: "qualify" };
  const wholesale = { ...newFmsStage("task", 2), key: "wholesale_desk", name: "Wholesale desk" };
  const [stage, setStage] = useState<FmsStageDefinition>(() => ({ ...newFmsStage("task", 1), key: "qualify", name: "Customer qualification", formTemplateId: data.forms[0]!.id, branchRules: rule ? [rule] : [] }));
  latestStage = stage;
  return <FmsStageEditor data={data} onChange={(value) => { latestStage = value; setStage(value); }} onDelete={() => undefined} stage={stage} stages={[first, stage, wholesale]} />;
}

function DecisionHarness() {
  const [stages, setStages] = useState<FmsStageDefinition[]>(() => {
    const first = { ...newFmsStage("form", 0), key: "initial", name: "Initial details", formTemplateId: data.forms[0]!.id, defaultNextStageKey: "decision" };
    // A Decision Step saved by an earlier version: kept and editable, never offered for new steps.
    const decision = { ...newFmsStage("task", 1), key: "decision", name: "Approve request", defaultNextStageKey: "follow_up", sla: { ...newFmsStage("task", 1).sla, decisionMode: "decision" as const, decisionOptions: [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }] } };
    const followUp = { ...newFmsStage("task", 2), key: "follow_up", name: "Follow up" };
    return [first, decision, followUp];
  });
  const [selected, setSelected] = useState(1);
  return <><button onClick={() => setSelected(1)}>Edit decision</button><button onClick={() => setSelected(2)}>Edit follow up</button><FmsStageEditor data={data} onChange={(value) => setStages((current) => current.map((item, index) => index === selected ? value : item))} onDelete={() => undefined} stage={stages[selected]!} stages={stages} /></>;
}

function AssignmentHarness({ invalid = false }: { invalid?: boolean }) {
  const formId = data.forms[0]!.id;
  const linkedData: FmsData = { ...data, formFields: { [formId]: [
    { key: "assigned_to", label: "Assigned to", type: "user_dropdown", required: true, shown: true },
    { key: "optional_user", label: "Optional user", type: "user_dropdown", required: false },
  ] } };
  const [stage, setStage] = useState<FmsStageDefinition>(() => ({ ...newFmsStage("form", 0), key: "start_form", formTemplateId: formId, sla: { ...newFmsStage("form", 0).sla, ...(invalid ? { assignmentFieldKey: "removed_question" } : {}) } }));
  return <><output aria-label="Selected assignment">{stage.sla.assignmentFieldKey ?? "default"}</output><FmsStageEditor data={linkedData} onChange={setStage} onDelete={() => undefined} stage={stage} stages={[stage]} /></>;
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
    const deadline = screen.getByRole("switch", { name: "Set deadline" });
    expect(screen.getByLabelText("Due date").getAttribute("type")).toBe("date");
    const methods = screen.getByRole("group", { name: "Deadline method" });
    // All four deadline types are visible choices, each with its explanation.
    expect(within(methods).getAllByRole("button").map((button) => button.querySelector("span")?.textContent)).toEqual(["Completion date", "TAT (hours)", "Days before date", "Specific clock time"]);
    expect(within(methods).getByRole("button", { name: /Completion date/ }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(methods).getByRole("button", { name: /TAT \(hours\)/ }));
    expect(within(methods).getByRole("button", { name: /TAT \(hours\)/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("TAT value")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("TAT unit"), "minutes");
    expect((screen.getByLabelText("TAT unit") as HTMLSelectElement).value).toBe("minutes");
    expect(screen.getByLabelText("Counted from")).toBeTruthy();
    await user.click(within(methods).getByRole("button", { name: /Days before date/ }));
    expect(screen.getByLabelText("Future date")).toBeTruthy();
    expect(screen.getByLabelText("Days before")).toBeTruthy();
    await user.click(within(methods).getByRole("button", { name: /Specific clock time/ }));
    expect(screen.getByLabelText("Clock time")).toBeTruthy();
    await user.click(deadline);
    expect(screen.queryByLabelText("TAT value")).toBeNull();
    expect(screen.queryByLabelText("Escalate after")).toBeNull();
  }, 20_000);
  it("offers the questionnaire choices first and the existing-form list only when linking", async () => {
    const user = userEvent.setup();
    render(<LaterFormHarness />);
    expect(screen.queryByLabelText("Initial details form")).toBeNull();
    expect(screen.queryByLabelText("Linked form")).toBeNull();
    expect((screen.getByRole("button", { name: "No questionnaire" }) as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    // Creating or importing needs Forms authoring permission, which this harness does not grant.
    expect(screen.queryByRole("button", { name: "Create questionnaire" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Link existing form" }));
    const select = screen.getByLabelText("Linked form") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.textContent).toContain("Initial details");
  });
  it("offers a linked-form assignment question while retaining named defaults", () => {
    render(<RoutingHarness />);
    expect(screen.getByLabelText("User question that assigns later steps")).toBeTruthy();
  });

  it("saves an eligible question and can explicitly restore workflow defaults", async () => {
    const user = userEvent.setup();
    render(<AssignmentHarness />);
    const select = screen.getByLabelText("User question that assigns later steps");
    expect(select.textContent).not.toContain("Optional user");
    await user.selectOptions(select, "assigned_to");
    expect(screen.getByLabelText("Selected assignment").textContent).toBe("assigned_to");
    await user.selectOptions(select, "");
    expect(screen.getByLabelText("Selected assignment").textContent).toBe("default");
  });

  it("keeps an unavailable assignment visible for correction instead of clearing it", () => {
    render(<AssignmentHarness invalid />);
    expect(screen.getByLabelText("Selected assignment").textContent).toBe("removed_question");
    expect(screen.getByLabelText("User question that assigns later steps").getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps instructions and completion controls available but secondary", () => {
    render(<Harness />);
    expect(screen.getByLabelText("How / instructions")).toBeTruthy();
    expect(screen.getByText("Instructions").closest("summary")).toBeTruthy();
    expect(screen.getByText("Completion controls").closest("summary")).toBeTruthy();
    expect((screen.getByText("Completion controls").closest("details") as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByLabelText("Require evidence")).toBeTruthy();
  });

  it("routes on a linked form answer using the stable field key and option value", async () => {
    const user = userEvent.setup();
    render(<RoutingHarness />);
    await user.click(screen.getByRole("button", { name: "Add conditional route" }));
    expect((screen.getByLabelText("Route 1 source") as HTMLSelectElement).value).toBe("form_answer");
    expect((screen.getByLabelText("Route 1 question") as HTMLSelectElement).value).toBe("customer_type");
    await user.click(screen.getByRole("checkbox", { name: "Wholesale buyer" }));
    await user.selectOptions(screen.getByLabelText("Route 1 then go to"), "wholesale_desk");
    const rule = latestStage!.branchRules[0]!;
    expect(rule).toMatchObject({ source: "form_answer", sourceKey: "customer_type", operator: "equals", value: "wholesale", nextStageKey: "wholesale_desk" });
    expect(screen.getByText("Otherwise go to")).toBeTruthy();
  });
  it("offers the question's option labels while still matching on the stable option value", async () => {
    const user = userEvent.setup();
    render(<RoutingHarness />);
    await user.click(screen.getByRole("button", { name: "Add conditional route" }));
    expect(screen.getByRole("group", { name: "Route 1 answer" }).textContent).toContain("Retail buyer");
    await user.click(screen.getByRole("checkbox", { name: "Wholesale buyer" }));
    expect(latestStage!.branchRules[0]!.value).toBe("wholesale");
  });
  it("uses the same destination for any selected answer and supports deselection", async () => {
    const user = userEvent.setup();
    render(<RoutingHarness />);
    await user.click(screen.getByRole("button", { name: "Add conditional route" }));
    await user.click(screen.getByRole("checkbox", { name: "Wholesale buyer" }));
    await user.click(screen.getByRole("checkbox", { name: "Distributor" }));
    await user.selectOptions(screen.getByLabelText("Route 1 then go to"), "wholesale_desk");
    expect(latestStage!.branchRules[0]).toMatchObject({ operator: "in", value: ["wholesale", "distributor"], nextStageKey: "wholesale_desk" });
    expect((screen.getByRole("checkbox", { name: "Wholesale buyer" }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Wholesale buyer" }));
    expect(latestStage!.branchRules[0]).toMatchObject({ operator: "in", value: ["distributor"], nextStageKey: "wholesale_desk" });
  });
  it("restores saved multi-answer routes and keeps removed choices visible", () => {
    render(<RoutingHarness rule={{ id: "saved", source: "form_answer", sourceKey: "customer_type", operator: "in", value: ["wholesale", "retired"], order: 0, nextStageKey: "wholesale_desk" }} />);
    expect((screen.getByRole("checkbox", { name: "Wholesale buyer" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "retired (removed)" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Route 1 then go to") as HTMLSelectElement).value).toBe("wholesale_desk");
  });
  it("preserves single selection for is-not conditions", async () => {
    const user = userEvent.setup();
    render(<RoutingHarness rule={{ id: "saved", source: "form_answer", sourceKey: "customer_type", operator: "not_equals", value: "retail", order: 0 }} />);
    await user.selectOptions(screen.getByLabelText("Route 1 answer"), "wholesale");
    expect(latestStage!.branchRules[0]).toMatchObject({ operator: "not_equals", value: "wholesale" });
  });
  it("keeps Otherwise optional: an unmatched answer completes the workflow", async () => {
    const user = userEvent.setup();
    render(<RoutingHarness />);
    await user.click(screen.getByRole("button", { name: "Add conditional route" }));
    expect(screen.queryByText("Choose where any other answer goes.")).toBeNull();
    const otherwise = screen.getByLabelText("Otherwise (fallback) go to") as HTMLSelectElement;
    expect(otherwise.selectedOptions[0]?.textContent).toBe("Complete workflow here");
    expect(screen.getByText("Optional. If no condition matches, the workflow completes here.")).toBeTruthy();
    await user.selectOptions(otherwise, "wholesale_desk");
    expect(screen.queryByText("Optional. If no condition matches, the workflow completes here.")).toBeNull();
  });
  it("keeps a legacy decision's outcomes editable and configures conditions only from them", async () => {
    const user = userEvent.setup();
    render(<DecisionHarness />);
    expect(screen.queryByRole("button", { name: /Decision step/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add outcome" }));
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
