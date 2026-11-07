// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newFmsStartTrigger, type FmsFlowDefinition } from "@jewelos/core";
import type { FmsData } from "./api";

const mocks = vi.hoisted(() => ({ saveFmsDraft: vi.fn(), publishFmsFlow: vi.fn(), test: vi.fn(), samples: vi.fn(), source: vi.fn(), crmForms: vi.fn(async () => ({})), stepForms: vi.fn(async () => new Set<string>()) }));
vi.mock("./api", () => ({ saveFmsDraft: mocks.saveFmsDraft, publishFmsFlow: mocks.publishFmsFlow, saveFmsContextAssigneeDefault: vi.fn() }));
vi.mock("./triggerApi", () => ({ testFmsStartTrigger: mocks.test, listFmsTriggerSamples: mocks.samples, loadFmsInstanceTriggerSource: mocks.source, loadCrmFormFamilies: mocks.crmForms, loadFmsStepFormFamilies: mocks.stepForms }));
let latest: FmsFlowDefinition | null = null;
vi.mock("./FmsGraphCanvas", async () => {
  const { forwardRef } = await import("react");
  return { FmsGraphCanvas: forwardRef(function Canvas({ definition }: { definition: FmsFlowDefinition }, _ref) { latest = definition; return <div>canvas with {definition.stages.length} steps</div>; }) };
});

import { FmsFlowBuilder } from "./FmsFlowBuilder";
import { FmsStartTriggerPanel, triggerFormFamily, triggerSourceForForm } from "./FmsStartTriggerPanel";
import { FmsTriggerSource } from "./FmsTriggerSource";

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.crmForms.mockImplementation(async () => ({})); mocks.stepForms.mockImplementation(async () => new Set<string>()); latest = null; });

const data = {
  flows: [], stages: [], assignees: [], branchRules: [], forms: [], formFields: {},
  users: [{ id: "u1", employee_name: "Synthetic Seller", user_role: "staff", branch_id: "b1", department_id: "d1", working_status: "active", is_login_enabled: true }],
  availability: [], branches: [{ id: "b1", name: "Main" }], departments: [], contextDefaults: [],
} as unknown as FmsData;

describe("new automatic workflow", () => {
  it("starts without a form, opens the Start trigger, and saves the trigger with the draft", async () => {
    const user = userEvent.setup();
    mocks.saveFmsDraft.mockResolvedValue("flow-1");
    render(<FmsFlowBuilder canManageForms data={data} flow={null} onClose={() => undefined} onSaved={async () => undefined} />);
    await user.type(screen.getByLabelText("Workflow name *"), "NOT BOUGHT FOLLOW-UP");
    await user.type(screen.getByLabelText("Purpose *"), "Call clients who did not buy");
    await user.click(screen.getByRole("radio", { name: /Automatic Trigger/ }));
    await user.click(screen.getByRole("button", { name: /Open builder/ }));

    const panel = await screen.findByTestId("fms-start-trigger");
    expect(within(panel).getByRole("radio", { name: /Automatic Trigger/ })).toHaveProperty("checked", true);
    // One picker: Form Builder forms only. With no walk-in form linked in CRM it shows none chosen.
    expect(within(panel).queryByLabelText("Trigger source")).toBeNull();
    expect(within(panel).getByLabelText("Trigger form")).toHaveProperty("value", "");
    expect(within(panel).getAllByTestId("trigger-rule")).toHaveLength(1);
    await user.click(within(panel).getByRole("button", { name: "Use these start settings" }));

    expect(latest!.stages[0]!.type).toBe("task");
    expect(screen.queryByText("Start form")).toBeNull();
    const anchor = screen.getByTestId("fms-start-anchor");
    expect(anchor.textContent).toContain("WHEN CRM WALK-IN VISIT IS SAVED");
    expect(anchor.textContent).toContain("IF VISIT STATUS (BOUGHT?) = NO");
    expect(anchor.textContent).toContain("START NOT BOUGHT FOLLOW-UP");

    await user.click(screen.getByRole("button", { name: /Save draft/ }));
    const saved = mocks.saveFmsDraft.mock.calls[0]![1] as FmsFlowDefinition;
    expect(saved.startMode).toBe("automatic");
    expect(saved.startTrigger?.source.type).toBe("crm_walkin");
    expect(saved.stages.every((stage) => stage.type !== "form")).toBe(true);
  });

  it("keeps the starting form for a form-started workflow", async () => {
    const user = userEvent.setup();
    render(<FmsFlowBuilder canManageForms data={data} flow={null} onClose={() => undefined} onSaved={async () => undefined} />);
    await user.type(screen.getByLabelText("Workflow name *"), "Repairs");
    await user.type(screen.getByLabelText("Purpose *"), "Repair intake");
    await user.click(screen.getByRole("button", { name: /Open builder/ }));
    expect(latest!.stages[0]!.type).toBe("form");
    expect(screen.queryByTestId("fms-start-anchor")).toBeNull();
  });
});

describe("Start trigger panel", () => {
  const definition: FmsFlowDefinition = { name: "Not bought", scope: "tenant", manualTrigger: true, startMode: "automatic", startTrigger: newFmsStartTrigger("crm_walkin", () => crypto.randomUUID().slice(0, 8)), stages: [] };
  it("adds, nests, switches off and removes conditions and applies them", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<FmsStartTriggerPanel data={data} definition={definition} flowId="flow-1" onApply={onApply} onClose={() => undefined} />);
    await user.click(screen.getAllByRole("button", { name: /Add group/ })[0]!);
    const groups = screen.getAllByTestId("trigger-group");
    expect(groups).toHaveLength(2);
    await user.click(within(groups[1]!).getByRole("button", { name: /Add condition/ }));
    await user.selectOptions(within(groups[1]!).getByLabelText("Condition field"), "product_requirement");
    await user.selectOptions(within(groups[1]!).getByLabelText("Condition operator"), "not_empty");
    await user.click(within(groups[1]!).getByRole("button", { name: /Add condition/ }));
    await user.selectOptions(within(groups[1]!).getAllByLabelText("Condition field")[1]!, "seen_count");
    await user.selectOptions(within(groups[1]!).getAllByLabelText("Condition operator")[1]!, "greater_than");
    await user.type(within(groups[1]!).getAllByLabelText("Condition value")[0]!, "0");
    await user.click(within(groups[1]!).getAllByRole("checkbox", { name: "On" })[2]!);
    await user.click(screen.getByRole("button", { name: "Use these start settings" }));
    const applied = onApply.mock.calls[0]![0].startTrigger;
    const nested = applied.conditions.children[1];
    expect(nested.kind).toBe("group");
    expect(nested.combinator).toBe("or");
    expect(nested.children.map((rule: { field: string; operator: string; enabled: boolean }) => [rule.field, rule.operator, rule.enabled])).toEqual([["product_requirement", "not_empty", true], ["seen_count", "greater_than", false]]);
  });

  it("tests conditions on the server and shows matched rules, assignee and deadline", async () => {
    const user = userEvent.setup();
    mocks.test.mockResolvedValue({ matched: true, rules: [{ id: "r", field: "visit_status", operator: "equals", passed: true }], title: "Not bought · Asha", context: { client_code: "MKC-1" }, dueAt: "2026-11-10T15:30:00Z", firstStage: { key: "f1", name: "Follow-Up 1", type: "task" }, assignee: { method: "source_staff", name: "Synthetic Seller" } });
    render(<FmsStartTriggerPanel data={data} definition={definition} flowId="flow-1" onApply={vi.fn()} onClose={() => undefined} />);
    await user.type(screen.getByLabelText("Sample Visit status (bought?)"), "NO");
    await user.click(screen.getByRole("button", { name: /Test conditions/ }));
    const result = await screen.findByTestId("trigger-test-result");
    expect(result.textContent).toContain("Matched");
    expect(result.textContent).toContain("Follow-Up 1");
    expect(result.textContent).toContain("Synthetic Seller");
    expect(mocks.test).toHaveBeenCalledWith("flow-1", expect.objectContaining({ source: { type: "crm_walkin" } }), { visit_status: "NO" });
  });

  it("refuses a trigger with every condition switched off", async () => {
    const user = userEvent.setup();
    render(<FmsStartTriggerPanel data={data} definition={definition} flowId="flow-1" onApply={vi.fn()} onClose={() => undefined} />);
    await user.click(screen.getAllByRole("checkbox", { name: "On" })[0]!);
    expect(screen.getByText(/at least one switched-on condition/)).toBeTruthy();
  });
});

describe("work page source", () => {
  it("shows the copied values and links the CRM client only when the server sends the id", async () => {
    mocks.source.mockResolvedValue({ sourceType: "crm_walkin", occurredAt: "2026-11-03T06:00:00Z", values: [{ label: "Client code", value: "MKC-77" }], crmClientId: "c1", caseOpen: true });
    render(<FmsTriggerSource instanceId="i1" />);
    expect(await screen.findByText("Started automatically")).toBeTruthy();
    expect(screen.getByText("MKC-77")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open CRM client profile" }).getAttribute("href")).toBe("/crm/clients/c1");
    cleanup();
    mocks.source.mockResolvedValue({ sourceType: "crm_walkin", occurredAt: null, values: [], crmClientId: null, caseOpen: true });
    render(<FmsTriggerSource instanceId="i2" />);
    expect(await screen.findByText("Started automatically")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("renders nothing for a form-started run", async () => {
    mocks.source.mockResolvedValue(null);
    const { container } = render(<FmsTriggerSource instanceId="i3" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toBe("");
  });
});

describe("trigger form picker", () => {
  const crm = { queue: "fam-queue", lead: "fam-lead", walkin: "fam-walkin" };
  it("wires a CRM-linked form to its CRM save and any other form to Forms Library submissions", () => {
    expect(triggerSourceForForm("fam-walkin", "t-w", crm)).toEqual({ type: "crm_walkin" });
    expect(triggerSourceForForm("fam-queue", "t-q", crm)).toEqual({ type: "crm_linked_form", formFamilyId: "fam-queue", formTemplateId: "t-q", purpose: "queue" });
    expect(triggerSourceForForm("fam-lead", "t-l", crm)).toEqual({ type: "crm_linked_form", formFamilyId: "fam-lead", formTemplateId: "t-l", purpose: "lead" });
    expect(triggerSourceForForm("fam-other", "t-o", crm)).toEqual({ type: "jewelos_form", formFamilyId: "fam-other", formTemplateId: "t-o" });
    expect(triggerSourceForForm("fam-queue", "t-q", {})).toEqual({ type: "jewelos_form", formFamilyId: "fam-queue", formTemplateId: "t-q" });
  });

  it("shows saved CRM starts as the form CRM uses for them", () => {
    expect(triggerFormFamily({ type: "crm_walkin" }, crm)).toBe("fam-walkin");
    expect(triggerFormFamily({ type: "crm_queue" }, crm)).toBe("fam-queue");
    expect(triggerFormFamily({ type: "crm_lead" }, {})).toBe("");
    expect(triggerFormFamily({ type: "crm_linked_form", formFamilyId: "fam-lead", purpose: "lead" }, crm)).toBe("fam-lead");
  });

  it("lists each form once, marks the CRM ones, and picks the CRM event when a CRM form is chosen", async () => {
    const user = userEvent.setup();
    mocks.crmForms.mockImplementation(async () => crm);
    mocks.stepForms.mockImplementation(async () => new Set(["fam-step"]));
    const form = (id: string, family: string, name: string, version: number) => ({ id, family_id: family, name, version, lifecycle: "published" });
    const withForms = { ...data, forms: [form("t-q1", "fam-queue", "Client queue", 1), form("t-q2", "fam-queue", "Client queue", 2), form("t-o", "fam-other", "Repair intake", 1), form("t-s", "fam-step", "INTRODUCTION CALL — INSTAGRAM LEADS", 1)], formFields: {} } as unknown as FmsData;
    const onApply = vi.fn();
    const definition = { name: "Flow", stages: [{ key: "s1", name: "Call", type: "task" }] } as unknown as FmsFlowDefinition;
    render(<FmsStartTriggerPanel data={withForms} definition={{ ...definition, startMode: "automatic", startTrigger: newFmsStartTrigger("jewelos_form", () => crypto.randomUUID()) }} flowId={null} onApply={onApply} onClose={() => undefined} />);
    const picker = await screen.findByLabelText("Trigger form");
    await screen.findByRole("option", { name: "Client queue (v2) · CRM client queue" });
    await waitFor(() => expect(screen.queryByRole("option", { name: /INTRODUCTION CALL/ })).toBeNull());
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual(["Choose a form from the Form Builder", "Client queue (v2) · CRM client queue", "Repair intake (v1)"]);
    await user.selectOptions(picker, "fam-queue");
    expect(picker).toHaveProperty("value", "fam-queue");
  });
});
