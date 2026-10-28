// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyFmsAiOperations, fmsAiIdFactory, fmsDefinitionFingerprint, type FmsAiOperation, type FmsAiRequest, type FmsAiResponse, type FmsFlowDefinition } from "@jewelos/core";
import type { FmsData } from "../api";
import { fmsAiCatalogFromData } from "./catalog";
import { FmsAiPanel, type FmsAiPanelProps } from "./FmsAiPanel";
import { FmsAiCallError, type FmsAiSettings } from "./api";

const mocks = vi.hoisted(() => ({ askFmsAi: vi.fn(), saveDraft: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api")>()), askFmsAi: mocks.askFmsAi }));
vi.mock("@/features/forms/api", () => ({ saveDraft: mocks.saveDraft }));

const FORM = "00000000-0000-4000-8000-000000000001";
const NEHA = "00000000-0000-4000-8000-0000000000aa";
const data = {
  flows: [], stages: [], assignees: [], branchRules: [], contextDefaults: [], branches: [], departments: [], availability: [],
  forms: [{ id: FORM, name: "Stock request", version: 1, family_id: "fam", lifecycle: "published" }],
  formFields: { [FORM]: [{ key: "urgency", label: "Urgency", type: "select", required: true, shown: true, options: [{ value: "high", label: "High" }, { value: "low", label: "Low" }], optionValues: ["high", "low"] }] },
  users: [{ id: NEHA, employee_name: "Neha", user_role: "staff", branch_id: "b", department_id: "d", working_status: "active", account_status: "active", is_login_enabled: true }],
} as unknown as FmsData;
const empty: FmsFlowDefinition = { assignmentVersion: 2, name: "", description: "", scope: "tenant", manualTrigger: true, stages: [] };
const on: FmsAiSettings = { debuggerEnabled: true, builderEnabled: true, runDiagnosisEnabled: true, userDailyLimit: 30, usedToday: 2, canConfigure: false };
const op = (partial: Partial<FmsAiOperation> & Pick<FmsAiOperation, "op">): FmsAiOperation => ({ stageKey: null, afterStageKey: null, stageType: null, name: null, instructions: null, nextStageKey: null, route: null, assignment: null, formTemplateId: null, timing: null, decisionOptions: null, checklist: null, requiresUpload: null, requiresRemark: null, followUp: null, parallelTargets: null, joinRule: null, workflowDescription: null, ...partial });
const plan = [
  op({ op: "set_workflow_details", name: "Stock request", workflowDescription: "Request stock" }),
  op({ op: "add_stage", stageKey: "request", stageType: "form", name: "Request" }),
  op({ op: "link_form", stageKey: "request", formTemplateId: FORM }),
  op({ op: "add_stage", stageKey: "check", stageType: "task", name: "Check stock", afterStageKey: "request" }),
  op({ op: "set_assignment", stageKey: "check", assignment: { mode: "fixed_employee", employeeIds: [NEHA], hierarchy: null, role: null, sourceStageKey: null, questionKey: null, followFormAssignee: false, allowHandoff: false, fallback: "none", fallbackEmployeeId: null } }),
  op({ op: "set_timing", stageKey: "check", timing: { method: "tat", hours: 4, minutes: null } }),
];

/** What the Edge Function returns: it compiles with the same core code and seed. */
function proposalFor(request: FmsAiRequest, operations = plan): FmsAiResponse {
  const compiled = applyFmsAiOperations(request.draft as FmsFlowDefinition, operations, fmsAiCatalogFromData(data), fmsAiIdFactory(request.requestId));
  return { kind: "proposal", message: "A two-step stock workflow.", questions: [], assumptions: ["No deadline on the request form"], unresolvedItems: [], confidence: "high", evidence: [], suggestedFixes: [], operations, formsToCreate: [],
    schemaVersion: 1, sessionId: request.sessionId, requestId: request.requestId, mode: request.mode, baseFingerprint: request.baseFingerprint, proposedFingerprint: compiled.ok ? fmsDefinitionFingerprint(compiled.definition) : null,
    validationIssues: [], findingIds: [], runDataIncluded: false, usage: { model: "claude-opus-5-5", requests: 1, inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 } };
}

function renderPanel(props: Partial<FmsAiPanelProps> = {}) {
  const onApply = vi.fn(); const onGoToStage = vi.fn();
  const view = render(<FmsAiPanel data={data} definition={empty} onApply={onApply} onClose={() => undefined} onGoToStage={onGoToStage} published={null} selectedStageKey={null} settings={on} {...props} />);
  return { onApply, onGoToStage, view, user: userEvent.setup() };
}
const ask = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByLabelText("Message the AI assistant"), text);
  await user.click(screen.getByRole("button", { name: "Send" }));
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("FMS AI assistant panel (one chat for build, check and debug)", () => {
  it("has one message box and no separate Check / Ask / Build / Run sections", () => {
    renderPanel();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByLabelText("Message the AI assistant")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Check this workflow for problems/ })).toBeTruthy();
    expect(mocks.askFmsAi).not.toHaveBeenCalled();
  });

  it("builds from plain English: review shows the diff, Apply commits exactly once", async () => {
    mocks.askFmsAi.mockImplementation((request: FmsAiRequest) => Promise.resolve(proposalFor(request)));
    const { user, onApply } = renderPanel();
    await ask(user, "Stock requests go to Neha who checks within 4 hours");
    const review = await screen.findByRole("region", { name: "Review: Review the changes" });
    expect(within(review).getByText(/Add Check stock/)).toBeTruthy();
    expect(mocks.askFmsAi.mock.calls[0]![0]).toMatchObject({ mode: "build", includeRunData: false, instanceId: null, readOnly: false, baseFingerprint: fmsDefinitionFingerprint(empty) });
    await user.click(within(review).getByRole("button", { name: "Apply to editor" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect((onApply.mock.calls[0]![0] as FmsFlowDefinition).stages.map((stage) => stage.key)).toEqual(["request", "check"]);
    expect(within(review).queryByRole("button", { name: "Apply to editor" })).toBeNull();
    expect(within(review).getByText(/Use Undo to revert/)).toBeTruthy();
  });

  it("answers a check question in the same chat and can apply its suggested fix", async () => {
    mocks.askFmsAi.mockImplementation((request: FmsAiRequest) => Promise.resolve({ ...proposalFor(request), kind: "explanation", message: "The workflow has no steps.", operations: [], proposedFingerprint: null, suggestedFixes: [{ title: "Add the steps", stageKey: null, steps: ["Add a request form"], operations: plan }] }));
    const { user, onApply } = renderPanel();
    await ask(user, "Is anything wrong with this workflow?");
    expect(await screen.findByText("The workflow has no steps.")).toBeTruthy();
    const fix = await screen.findByRole("region", { name: "Review: Preview this fix" });
    await user.click(within(fix).getByRole("button", { name: "Apply to editor" }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("with only the check switch on, it answers but never applies edits", async () => {
    mocks.askFmsAi.mockImplementation((request: FmsAiRequest) => Promise.resolve(proposalFor(request)));
    const { user, onApply } = renderPanel({ settings: { ...on, builderEnabled: false } });
    await ask(user, "Build it");
    expect(mocks.askFmsAi.mock.calls[0]![0]).toMatchObject({ mode: "debug", readOnly: true });
    expect(await screen.findByText(/This version is read-only/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply to editor" })).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("refuses to apply over edits made while the assistant was working", async () => {
    let resolve: (value: FmsAiResponse) => void = () => undefined;
    mocks.askFmsAi.mockImplementation((request: FmsAiRequest) => new Promise<FmsAiResponse>((done) => { resolve = () => done(proposalFor(request)); }));
    const { user, view, onApply } = renderPanel();
    await ask(user, "Build it");
    view.rerender(<FmsAiPanel data={data} definition={{ ...empty, name: "Edited meanwhile" }} onApply={onApply} onClose={() => undefined} onGoToStage={() => undefined} published={null} selectedStageKey={null} settings={on} />);
    resolve(undefined as never);
    const review = await screen.findByRole("region", { name: "Review: Review the changes" });
    expect(within(review).getByText(/You changed the workflow after asking/)).toBeTruthy();
    expect((within(review).getByRole("button", { name: "Apply to editor" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("rejects a reply whose compiled result differs from what the browser compiles", async () => {
    mocks.askFmsAi.mockImplementation((request: FmsAiRequest) => Promise.resolve({ ...proposalFor(request), proposedFingerprint: "fms1-0000000000000000" }));
    const { user } = renderPanel();
    await ask(user, "Build it");
    const review = await screen.findByRole("region", { name: "Review: Review the changes" });
    expect(within(review).getByText(/no longer matches the Forms or people/)).toBeTruthy();
    expect((within(review).getByRole("button", { name: "Apply to editor" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the server's error message and cancels an in-flight request without changing anything", async () => {
    mocks.askFmsAi.mockRejectedValueOnce(new FmsAiCallError("rate_limited", "You have reached the daily limit. Manual editing still works."));
    const { user, onApply } = renderPanel();
    await ask(user, "Why is this step blocked?");
    expect(await screen.findByText(/reached the daily limit/)).toBeTruthy();
    mocks.askFmsAi.mockImplementation((_request: FmsAiRequest, signal: AbortSignal) => new Promise((_done, fail) => signal.addEventListener("abort", () => fail(new FmsAiCallError("cancelled", "Cancelled.")))));
    await ask(user, "Why is this step blocked?");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText(/Nothing was changed/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });
});
