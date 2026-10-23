// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyFmsAiOperations, fmsAiIdFactory, fmsDefinitionFingerprint, type FmsAiOperation, type FmsAiRequest, type FmsAiResponse, type FmsFlowDefinition } from "@jewelos/core";
import type { FmsData } from "../api";
import { fmsAiCatalogFromData } from "./catalog";
import { FmsAiPanel, type FmsAiPanelProps } from "./FmsAiPanel";
import { FmsAiCallError, type FmsAiSettings } from "./api";

const mocks = vi.hoisted(() => ({ askFmsAi: vi.fn(), loadFmsRunSnapshot: vi.fn(), saveDraft: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api")>()), askFmsAi: mocks.askFmsAi, loadFmsRunSnapshot: mocks.loadFmsRunSnapshot }));
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
  const view = render(<FmsAiPanel data={data} definition={empty} onApply={onApply} onClose={() => undefined} onGoToStage={onGoToStage} published={null} readOnly={false} selectedStageKey={null} settings={on} {...props} />);
  return { onApply, onGoToStage, view, user: userEvent.setup() };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("FMS assistant panel", () => {
  it("shows only the tools that are switched on, and the deterministic check needs no AI", () => {
    renderPanel({ settings: { ...on, debuggerEnabled: false, builderEnabled: false, runDiagnosisEnabled: false } });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Check (2)"]);
    expect(screen.getByText("A flow must contain at least one stage")).toBeTruthy();
    expect(mocks.askFmsAi).not.toHaveBeenCalled();
  });

  it("navigates to the step of a finding", async () => {
    const definition: FmsFlowDefinition = { ...empty, name: "X", stages: [{ key: "start", name: "Start", type: "task", order: 0, required: true, completionRule: "any_doer", allowMultipleDoers: false, requiresUpload: false, requiresRemark: false, checklist: [], assigneeRules: [], requiresNextDoerHandoff: false, canMoveBackward: false, canReject: false, canRequestRevision: false, canEscalate: false, branchRules: [], parallelTargetStageKeys: [], joinRequiredStageKeys: [], sla: { dueDate: "" } }] };
    const { user, onGoToStage } = renderPanel({ definition });
    const finding = screen.getByText("The first stage must be a Form").closest("li")!;
    await user.click(within(finding).getByRole("button", { name: /Go to step/ }));
    expect(onGoToStage).toHaveBeenCalledWith("start", expect.objectContaining({ code: "first_stage_must_be_form", source: "validator" }));
  });

  it("builds from plain English: review shows the diff, Apply commits exactly once", async () => {
    mocks.askFmsAi.mockImplementation((request: FmsAiRequest) => Promise.resolve(proposalFor(request)));
    const { user, onApply } = renderPanel({ initialTab: "build" });
    await user.type(screen.getByLabelText("Describe the workflow or change"), "Stock requests go to Neha who checks within 4 hours");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const review = await screen.findByRole("region", { name: "Review: Review the proposed workflow" });
    expect(within(review).getByText(/Add Check stock/)).toBeTruthy();
    expect(mocks.askFmsAi.mock.calls[0]![0]).toMatchObject({ mode: "build", includeRunData: false, readOnly: false, baseFingerprint: fmsDefinitionFingerprint(empty) });
    await user.click(within(review).getByRole("button", { name: "Apply to editor" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect((onApply.mock.calls[0]![0] as FmsFlowDefinition).stages.map((stage) => stage.key)).toEqual(["request", "check"]);
    expect(within(review).queryByRole("button", { name: "Apply to editor" })).toBeNull();
    expect(within(review).getByText(/Use Undo to revert/)).toBeTruthy();
  });

  it("refuses to apply over edits made while the assistant was working", async () => {
    let resolve: (value: FmsAiResponse) => void = () => undefined;
    mocks.askFmsAi.mockImplementation((request: FmsAiRequest) => new Promise<FmsAiResponse>((done) => { resolve = () => done(proposalFor(request)); }));
    const { user, view, onApply } = renderPanel({ initialTab: "build" });
    await user.type(screen.getByLabelText("Describe the workflow or change"), "Build it");
    await user.click(screen.getByRole("button", { name: "Send" }));
    view.rerender(<FmsAiPanel data={data} definition={{ ...empty, name: "Edited meanwhile" }} onApply={onApply} onClose={() => undefined} onGoToStage={() => undefined} published={null} readOnly={false} selectedStageKey={null} settings={on} initialTab="build" />);
    resolve(undefined as never);
    const review = await screen.findByRole("region", { name: "Review: Review the proposed workflow" });
    expect(within(review).getByText(/You changed the workflow after asking/)).toBeTruthy();
    expect((within(review).getByRole("button", { name: "Apply to editor" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("rejects a reply whose compiled result differs from what the browser compiles", async () => {
    mocks.askFmsAi.mockImplementation((request: FmsAiRequest) => Promise.resolve({ ...proposalFor(request), proposedFingerprint: "fms1-0000000000000000" }));
    const { user } = renderPanel({ initialTab: "build" });
    await user.type(screen.getByLabelText("Describe the workflow or change"), "Build it");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const review = await screen.findByRole("region", { name: "Review: Review the proposed workflow" });
    expect(within(review).getByText(/no longer matches the Forms or people/)).toBeTruthy();
    expect((within(review).getByRole("button", { name: "Apply to editor" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("in read-only (published) mode offers a new version instead of applying", async () => {
    const onCreateRevision = vi.fn();
    mocks.askFmsAi.mockImplementation((request: FmsAiRequest) => Promise.resolve({ ...proposalFor(request), kind: "explanation", operations: [], proposedFingerprint: null, suggestedFixes: [{ title: "Add a check step", stageKey: null, steps: ["Add a step"], operations: plan }] }));
    const { user } = renderPanel({ readOnly: true, onApply: undefined, onCreateRevision, initialTab: "ask" });
    expect(screen.queryByRole("tab", { name: "Build" })).toBeNull();
    await user.type(screen.getByLabelText("Ask the FMS assistant"), "Is any path missing a fallback?");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(await screen.findByRole("button", { name: /Create a new version to apply this/ }));
    expect(onCreateRevision).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Apply to editor" })).toBeNull();
  });

  it("cancels an in-flight request without changing anything", async () => {
    mocks.askFmsAi.mockImplementation((_request: FmsAiRequest, signal: AbortSignal) => new Promise((_done, fail) => signal.addEventListener("abort", () => fail(new FmsAiCallError("cancelled", "Cancelled.")))));
    const { user, onApply } = renderPanel({ initialTab: "ask" });
    await user.type(screen.getByLabelText("Ask the FMS assistant"), "Why is this step blocked?");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText(/Nothing was changed/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("sends run records only after explicit consent", async () => {
    const runId = "00000000-0000-4000-8000-0000000000bb";
    mocks.loadFmsRunSnapshot.mockResolvedValue({ generatedAt: "", instance: { id: runId, referenceNumber: "FMS-9", status: "active", flowId: "f", flowVersion: 1, assignmentVersion: 2, executionVersion: 2, startedAt: null, completedAt: null, startedBy: null, held: false, cancelled: false }, flow: { id: "f", name: "Stock", version: 1, status: "published" }, stages: [], assignmentDecisions: [], logs: [], pendingRequests: [], diagnosticEvents: [], routeAnswers: [], people: [], truncated: [], redacted: ["remarks"], absent: [], diagnosticHistorySince: null });
    mocks.askFmsAi.mockImplementation((request: FmsAiRequest) => Promise.resolve({ ...proposalFor(request), kind: "explanation", operations: [], proposedFingerprint: null }));
    const { user } = renderPanel({ initialTab: "run", runCandidates: [{ id: runId, label: "FMS-9 · active" }] });
    await user.selectOptions(screen.getByLabelText("Run to diagnose"), runId);
    expect(await screen.findByText("The run is active but no step is open")).toBeTruthy();
    await user.type(screen.getByLabelText("Ask the FMS assistant"), "Why is it stuck?");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(mocks.askFmsAi.mock.calls[0]![0]).toMatchObject({ includeRunData: false, instanceId: null });
    await user.click(screen.getByRole("checkbox", { name: /Include this run's records/ }));
    await user.type(screen.getByLabelText("Ask the FMS assistant"), "And now?");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(mocks.askFmsAi.mock.calls[1]![0]).toMatchObject({ includeRunData: true, instanceId: runId });
  });
});
