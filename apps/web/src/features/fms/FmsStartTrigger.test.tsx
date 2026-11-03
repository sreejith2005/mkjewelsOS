// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newFmsStartTrigger, type FmsFlowDefinition } from "@jewelos/core";
import type { FmsData } from "./api";

const mocks = vi.hoisted(() => ({ saveFmsDraft: vi.fn(), publishFmsFlow: vi.fn(), test: vi.fn(), samples: vi.fn(), source: vi.fn() }));
vi.mock("./api", () => ({ saveFmsDraft: mocks.saveFmsDraft, publishFmsFlow: mocks.publishFmsFlow, saveFmsContextAssigneeDefault: vi.fn() }));
vi.mock("./triggerApi", () => ({ testFmsStartTrigger: mocks.test, listFmsTriggerSamples: mocks.samples, loadFmsInstanceTriggerSource: mocks.source }));
let latest: FmsFlowDefinition | null = null;
vi.mock("./FmsGraphCanvas", async () => {
  const { forwardRef } = await import("react");
  return { FmsGraphCanvas: forwardRef(function Canvas({ definition }: { definition: FmsFlowDefinition }, _ref) { latest = definition; return <div>canvas with {definition.stages.length} steps</div>; }) };
});

import { FmsFlowBuilder } from "./FmsFlowBuilder";
import { FmsStartTriggerPanel } from "./FmsStartTriggerPanel";
import { FmsTriggerSource } from "./FmsTriggerSource";

afterEach(() => { cleanup(); vi.clearAllMocks(); latest = null; });

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
    expect(within(panel).getByLabelText("Trigger source")).toHaveProperty("value", "crm_walkin");
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
