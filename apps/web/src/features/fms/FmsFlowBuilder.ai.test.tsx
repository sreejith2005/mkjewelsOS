// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyFmsAiOperations, fmsAiIdFactory, fmsDefinitionFingerprint, type FmsAiOperation, type FmsAiRequest, type FmsAiResponse, type FmsFlowDefinition } from "@jewelos/core";
import type { FmsData } from "./api";
import { FmsFlowBuilder } from "./FmsFlowBuilder";
import { fmsAiCatalogFromData } from "./ai/catalog";
import type { FmsAiSettings } from "./ai/api";

const mocks = vi.hoisted(() => ({ saveFmsDraft: vi.fn(), publishFmsFlow: vi.fn(), saveFmsContextAssigneeDefault: vi.fn(), askFmsAi: vi.fn() }));
vi.mock("./api", () => ({ saveFmsDraft: mocks.saveFmsDraft, publishFmsFlow: mocks.publishFmsFlow, saveFmsContextAssigneeDefault: mocks.saveFmsContextAssigneeDefault }));
vi.mock("./ai/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./ai/api")>()), askFmsAi: mocks.askFmsAi }));

const FORM = "00000000-0000-4000-8000-000000000001";
const NEHA = "00000000-0000-4000-8000-0000000000aa";
const data = {
  flows: [], stages: [], assignees: [], branchRules: [], contextDefaults: [], branches: [], departments: [], availability: [],
  forms: [{ id: FORM, name: "Stock request", version: 1, family_id: "fam", lifecycle: "published" }],
  formFields: { [FORM]: [{ key: "urgency", label: "Urgency", type: "select", required: true, shown: true, options: [{ value: "high", label: "High" }], optionValues: ["high"] }] },
  users: [{ id: NEHA, employee_name: "Neha", user_role: "staff", branch_id: "b", department_id: "d", working_status: "active", account_status: "active", is_login_enabled: true }],
} as unknown as FmsData;
const settings: FmsAiSettings = { debuggerEnabled: true, builderEnabled: true, runDiagnosisEnabled: false, userDailyLimit: 30, usedToday: 0, canConfigure: false };
const op = (partial: Partial<FmsAiOperation> & Pick<FmsAiOperation, "op">): FmsAiOperation => ({ stageKey: null, afterStageKey: null, stageType: null, name: null, instructions: null, nextStageKey: null, route: null, assignment: null, formTemplateId: null, timing: null, decisionOptions: null, checklist: null, requiresUpload: null, requiresRemark: null, followUp: null, parallelTargets: null, joinRule: null, workflowDescription: null, ...partial });
const plan = [
  op({ op: "set_workflow_details", name: "Stock request", workflowDescription: "Request stock" }),
  op({ op: "add_stage", stageKey: "request", stageType: "form", name: "Request stock" }),
  op({ op: "link_form", stageKey: "request", formTemplateId: FORM }),
  op({ op: "add_stage", stageKey: "check", stageType: "task", name: "Check stock", afterStageKey: "request" }),
  op({ op: "set_assignment", stageKey: "check", assignment: { mode: "fixed_employee", employeeIds: [NEHA], hierarchy: null, role: null, sourceStageKey: null, questionKey: null, followFormAssignee: false, allowHandoff: false, fallback: "none", fallbackEmployeeId: null } }),
  op({ op: "set_timing", stageKey: "check", timing: { method: "none", hours: null, minutes: null } }),
];
function reply(request: FmsAiRequest): FmsAiResponse {
  const compiled = applyFmsAiOperations(request.draft as FmsFlowDefinition, plan, fmsAiCatalogFromData(data), fmsAiIdFactory(request.requestId));
  return { kind: "proposal", message: "Stock request workflow.", questions: [], assumptions: [], unresolvedItems: [], confidence: "high", evidence: [], suggestedFixes: [], operations: plan, formsToCreate: [], schemaVersion: 1, sessionId: request.sessionId, requestId: request.requestId, mode: "build", baseFingerprint: request.baseFingerprint, proposedFingerprint: compiled.ok ? fmsDefinitionFingerprint(compiled.definition) : null, validationIssues: [], findingIds: [], runDataIncluded: false, usage: null };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("FMS builder with the assistant", () => {
  it("is unchanged when the assistant is not configured", () => {
    render(<FmsFlowBuilder data={data} flow={null} onClose={() => undefined} onSaved={async () => undefined} />);
    expect(screen.getByLabelText("Workflow name *")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "FMS assistant" })).toBeNull();
  });

  it("is unchanged when every assistant switch is off", () => {
    render(<FmsFlowBuilder ai={{ settings: { ...settings, debuggerEnabled: false, builderEnabled: false }, startWithAi: true }} data={data} flow={null} onClose={() => undefined} onSaved={async () => undefined} />);
    expect(screen.getByLabelText("Workflow name *")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "FMS assistant" })).toBeNull();
  });

  it("Build with AI applies one reviewed proposal as one undoable edit, then Save stays manual", async () => {
    const user = userEvent.setup();
    mocks.askFmsAi.mockImplementation((request: FmsAiRequest) => Promise.resolve(reply(request)));
    render(<FmsFlowBuilder ai={{ settings, startWithAi: true }} data={data} flow={null} onClose={() => undefined} onSaved={async () => undefined} />);
    expect(screen.getByText("This workflow has no steps yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Publish/ })).toBeTruthy();
    await user.type(screen.getByLabelText("Describe the workflow or change"), "Stock requests go to Neha");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const review = await screen.findByRole("region", { name: "Review: Review the proposed workflow" });
    await user.click(within(review).getByRole("button", { name: "Apply to editor" }));
    expect(mocks.saveFmsDraft).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close FMS assistant" }));
    expect(screen.getAllByText("Check stock").length).toBeGreaterThan(0);
    expect(screen.getByText(/Assistant changes applied/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("This workflow has no steps yet.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getAllByText("Check stock").length).toBeGreaterThan(0);
    mocks.saveFmsDraft.mockResolvedValue("new-flow");
    await user.click(screen.getByRole("button", { name: /Save draft/ }));
    expect(mocks.saveFmsDraft).toHaveBeenCalledTimes(1);
    expect(mocks.saveFmsDraft.mock.calls[0]![0]).toBeNull();
    expect((mocks.saveFmsDraft.mock.calls[0]![1] as FmsFlowDefinition).stages.map((stage) => stage.key)).toEqual(["request", "check"]);
  });

  it("on a phone keeps Save and Publish reachable while the assistant is open", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    render(<FmsFlowBuilder ai={{ settings, startWithAi: true }} data={data} flow={null} onClose={() => undefined} onSaved={async () => undefined} />);
    expect(screen.getByRole("dialog", { name: "FMS assistant" })).toBeTruthy();
    const header = screen.getByRole("button", { name: "Publish" }).closest("header")!;
    expect(within(header).getByRole("button", { name: "Save draft" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "FMS assistant" }).contains(header)).toBe(false);
  });

  it("Go to step closes the assistant and opens that step's inspector", async () => {
    const user = userEvent.setup();
    const flow = { id: "f1", family_id: "fam-f", version: 1, assignment_version: 2, name: "Draft", description: "D", status: "draft" as const, scope_type: "tenant" as const, branch_id: null, department_id: null, is_active: true, usage_count: 0 };
    const withFlow = { ...data, flows: [flow], stages: [{ id: "s1", fms_flow_id: "f1", stage_key: "start", name: "Start", method: null, step_type: "task", sort_order: 0, is_required: true, planned_time_rule: { deadlineEnabled: false, dueDate: "" }, completion_rule: "any_doer", allow_multiple_doers: false, requires_upload: false, requires_remark: false, checklist_definition: [], form_template_id: null, requires_next_doer_handoff: false, can_move_backward: false, can_reject: false, can_request_revision: false, can_escalate: false, default_next_stage_id: null, parallel_target_stage_ids: [], join_rule: null, join_required_stage_ids: [], split_to_flow_id: null }] } as unknown as FmsData;
    render(<FmsFlowBuilder ai={{ settings }} data={withFlow} flow={flow} onClose={() => undefined} onSaved={async () => undefined} />);
    await user.click(screen.getByRole("button", { name: "FMS assistant" }));
    const finding = screen.getByText("The first stage must be a Form").closest("li")!;
    await user.click(within(finding).getByRole("button", { name: /Go to step/ }));
    expect(screen.queryByRole("dialog", { name: "FMS assistant" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close inspector" })).toBeTruthy();
  });
});
