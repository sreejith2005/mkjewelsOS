// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FmsFlowDefinition, FmsStageDefinition } from "@jewelos/core";
import type { FmsData } from "./api";
import type { FmsCanvasCommand } from "./FmsGraphCanvas";
import { FmsFlowBuilder } from "./FmsFlowBuilder";

const mocks = vi.hoisted(() => ({ saveFmsDraft: vi.fn(), publishFmsFlow: vi.fn(), saveFmsContextAssigneeDefault: vi.fn(), discard: vi.fn() }));
vi.mock("./api", () => ({ saveFmsDraft: mocks.saveFmsDraft, publishFmsFlow: mocks.publishFmsFlow, saveFmsContextAssigneeDefault: mocks.saveFmsContextAssigneeDefault }));
vi.mock("./questionnaire", async (importOriginal) => ({ ...await importOriginal<typeof import("./questionnaire")>(), discardQuestionnaireDraft: mocks.discard }));

/**
 * The questionnaire editor talks to the Forms RPCs; here it is two buttons that
 * report "a draft now exists" and "the draft is published", so these tests
 * check what the builder does with those events: attach, pin, and save.
 */
vi.mock("./FmsQuestionnaireStudio", () => ({
  FmsQuestionnaireStudio: ({ stage, onDraftAttached, onUse, onClose }: { stage: FmsStageDefinition; onDraftAttached: (id: string) => Promise<void>; onUse: (id: string) => Promise<void>; onClose: () => void }) => <section aria-label="Questionnaire studio">
    <p>Editing {stage.name}</p>
    <button onClick={() => void onDraftAttached(DRAFT_ID)}>attach draft</button>
    <button onClick={() => void onUse(DRAFT_ID).then(onClose)}>use in workflow</button>
    <button onClick={onClose}>close studio</button>
  </section>,
  FmsQuestionnairePreview: () => null,
}));

/**
 * The canvas is replaced by plain buttons so these tests exercise the graph
 * transitions the real pointer gestures drive, without emulating pointer
 * capture and hit testing in jsdom. Canvas gestures themselves are covered in
 * FmsGraphCanvas.test.tsx.
 */
let latest: FmsFlowDefinition | null = null;
let latestFocusRequest: { key: string; id: number } | null = null;
let latestSelection: readonly string[] = [];
vi.mock("./FmsGraphCanvas", async () => {
  const { forwardRef } = await import("react");
  return {
    FmsGraphCanvas: forwardRef(function Canvas({ definition, focusRequest, selectedKeys, onSelectionChange, onCommand, onConnect, onDisconnect, onReconnect, onMove, onEditRoute }: {
      definition: FmsFlowDefinition;
      focusRequest?: { key: string; id: number } | null;
      selectedKeys: readonly string[];
      onSelectionChange: (keys: readonly string[]) => void;
      onCommand: (command: FmsCanvasCommand, options?: { anchor?: { x: number; y: number }; text?: string }) => void;
      onConnect: (from: string, to: string) => void;
      onDisconnect: (from: string, to: string, ruleId?: string) => void;
      onReconnect: (from: string, previousTo: string, nextTo: string, ruleId?: string) => void;
      onMove: (positions: Record<string, { x: number; y: number }>) => void;
      onEditRoute?: (from: string, ruleId?: string) => void;
    }, _ref) {
      latest = definition;
      latestFocusRequest = focusRequest ?? null;
      latestSelection = selectedKeys;
      const start = definition.stages[0];
      const a = definition.stages[1]?.key ?? "";
      const b = definition.stages[2]?.key ?? "";
      const routeId = start?.branchRules[0]?.id;
      return <div>
        <button onClick={() => onConnect(start!.key, a)}>connect a</button>
        <button onClick={() => onConnect(start!.key, b)}>connect b</button>
        <button onClick={() => onConnect(b, start!.key)}>make cycle</button>
        <button onClick={() => onDisconnect(start!.key, start!.defaultNextStageKey ?? "")}>disconnect default</button>
        <button onClick={() => onDisconnect(start!.key, b, routeId)}>disconnect route</button>
        <button onClick={() => onReconnect(start!.key, start!.defaultNextStageKey ?? "", b)}>reconnect default</button>
        <button onClick={() => onMove({ [start!.key]: { x: 640, y: 320 } })}>move</button>
        <button onClick={() => onSelectionChange(definition.stages.slice(1).map((stage) => stage.key))}>select steps</button>
        <button onClick={() => onEditRoute?.(start!.key, routeId)}>edit route</button>
        {(["copy", "cut", "paste", "duplicate", "delete", "selectAll", "undo"] as const).map((command) => <button key={command} onClick={() => onCommand(command, { anchor: { x: 100, y: 600 } })}>{`command ${command}`}</button>)}
      </div>;
    }),
  };
});

const DRAFT_ID = "00000000-0000-4000-8000-0000000000d1";
const formId = "00000000-0000-4000-8000-000000000001";
const data = {
  flows: [], stages: [], assignees: [], branchRules: [],
  forms: [{ id: formId, name: "Intake", version: 1, family_id: "fam-intake", lifecycle: "published" }],
  formFields: { [formId]: [{ key: "customer_type", label: "Customer type", options: [{ value: "retail", label: "Retail buyer" }, { value: "wholesale", label: "Wholesale buyer" }], optionValues: ["retail", "wholesale"] }] },
  users: [], availability: [], branches: [], departments: [], contextDefaults: [],
} as unknown as FmsData;

const stage = (key: string) => latest!.stages.find((item) => item.key === key)!;

async function openBuilder(builderData: FmsData = data) {
  const user = userEvent.setup();
  render(<FmsFlowBuilder canManageForms data={builderData} flow={null} onClose={() => undefined} onSaved={async () => undefined} />);
  await user.type(screen.getByLabelText("Workflow name *"), "Qualification");
  await user.type(screen.getByLabelText("Purpose *"), "Route by customer type");
  await user.click(screen.getByRole("button", { name: /Open builder/ }));
  // Adding a step wires it in after the selected one, giving start -> A -> B.
  await user.click(screen.getByRole("button", { name: /Add Step/ }));
  await user.click(screen.getByRole("button", { name: /Add Step/ }));
  const [start, a, b] = latest!.stages.map((item) => item.key) as [string, string, string];
  return { user, start, a, b };
}

/** The tools drawer is closed by default. */
async function openTools(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Open workflow tools" }));
}
async function linkStartForm(user: ReturnType<typeof userEvent.setup>) {
  await openTools(user);
  await user.click(screen.getByRole("button", { name: /The form that starts the workflow/ }));
  await user.click(screen.getByRole("button", { name: "Link existing form" }));
  await user.selectOptions(screen.getByLabelText("Initial details form"), formId);
}

const flowId = "00000000-0000-4000-8000-0000000000f1";
const savedFlowData = {
  ...data,
  flows: [{ id: flowId, family_id: "fam-saved", version: 1, assignment_version: 2, name: "Saved sales flow", description: "Existing", status: "draft", scope_type: "tenant", branch_id: null, department_id: null, is_active: true, usage_count: 0 }],
  stages: ["start_form", "follow_up"].map((stage_key, sort_order) => ({ id: `00000000-0000-4000-8000-00000000000${sort_order + 1}`, fms_flow_id: flowId, stage_key, name: stage_key === "start_form" ? "Start form" : "Follow up", method: null, step_type: sort_order === 0 ? "form" : "task", sort_order, is_required: true, planned_time_rule: { deadlineEnabled: false }, completion_rule: "any_doer", allow_multiple_doers: false, requires_upload: false, requires_remark: false, checklist_definition: [], form_template_id: sort_order === 0 ? formId : null, requires_next_doer_handoff: false, can_move_backward: false, can_reject: false, can_request_revision: false, can_escalate: false, default_next_stage_id: null, parallel_target_stage_ids: [], join_rule: null, join_required_stage_ids: [], split_to_flow_id: null, canvas_position: { x: 80 + sort_order * 320, y: 120 } })),
} as unknown as FmsData;

// Each test types a workflow name and renders the whole workspace; allow for a busy machine.
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => { cleanup(); vi.clearAllMocks(); latest = null; latestFocusRequest = null; latestSelection = []; window.sessionStorage.clear(); });

describe("FMS builder graph wiring", () => {
  it("no longer asks for workflow context or CRM scope when creating a workflow", () => {
    render(<FmsFlowBuilder data={data} flow={null} onClose={() => undefined} onSaved={async () => undefined} />);
    expect(screen.queryByLabelText("Workflow context")).toBeNull();
    expect(screen.queryByText("All branches")).toBeNull();
    expect(screen.getByLabelText("Workflow name *")).toBeTruthy();
  });

  it("adds a step as a plain next step, keeping simple flows single-path, with no deadline until one is switched on", async () => {
    const { start, a, b } = await openBuilder();
    expect(stage(start).defaultNextStageKey).toBe(a);
    expect(stage(start).branchRules).toHaveLength(0);
    expect(stage(a).defaultNextStageKey).toBe(b);
    expect(stage(a).sla.deadlineEnabled).toBe(false);
    expect(stage(a).sla.decisionMode).toBe("normal");
  });

  it("never asks to choose between a Normal step and a Decision step", async () => {
    await openBuilder();
    expect(screen.queryByText(/Normal step/)).toBeNull();
    expect(screen.queryByText(/Decision step/)).toBeNull();
    expect(screen.getByRole("region", { name: "Questions & Form" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Routing" })).toBeTruthy();
  });

  it("turns a second outgoing connection into a route instead of replacing the first", async () => {
    const { user, start, a, b } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "connect b" }));
    expect(stage(start).defaultNextStageKey).toBe(a);
    expect(stage(start).branchRules.map((rule) => rule.nextStageKey)).toEqual([b]);
    expect(stage(start).branchRules[0]?.source).toBe("context");
  });

  it("seeds an extra connection from the linked form's first question once a Form is attached", async () => {
    const { user, start, b } = await openBuilder();
    await linkStartForm(user);
    expect(stage(start).formTemplateId).toBe(formId);
    await user.click(screen.getByRole("button", { name: "connect b" }));
    expect(stage(start).branchRules[0]).toMatchObject({ source: "form_answer", sourceKey: "customer_type", operator: "equals", nextStageKey: b });
  });

  it("does not duplicate a connection that already exists", async () => {
    const { user, start } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "connect a" }));
    expect(stage(start).branchRules).toHaveLength(0);
  });

  it("removes the plain next step and a route independently", async () => {
    const { user, start, a } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "connect b" }));
    await user.click(screen.getByRole("button", { name: "disconnect route" }));
    expect(stage(start).branchRules).toHaveLength(0);
    expect(stage(start).defaultNextStageKey).toBe(a);
    await user.click(screen.getByRole("button", { name: "disconnect default" }));
    expect(stage(start).defaultNextStageKey).toBeUndefined();
  });

  it("moves an existing connection onto another step without leaving a duplicate", async () => {
    const { user, start, b } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "reconnect default" }));
    expect(stage(start).defaultNextStageKey).toBe(b);
    expect(stage(start).branchRules).toHaveLength(0);
  });

  it("keeps a dragged card's coordinates on the stage so they can be saved", async () => {
    const { user, start } = await openBuilder();
    expect(stage(start).position).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "move" }));
    expect(stage(start).position).toEqual({ x: 640, y: 320 });
  });

  it("undoes a connection change from the toolbar and from the keyboard command", async () => {
    const { user, start, a } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "disconnect default" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(stage(start).defaultNextStageKey).toBe(a);
    await user.click(screen.getByRole("button", { name: "disconnect default" }));
    await user.click(screen.getByRole("button", { name: "command undo" }));
    expect(stage(start).defaultNextStageKey).toBe(a);
  });

  it("reports unresolved publish readiness issues instead of publishing", async () => {
    await openBuilder();
    expect(screen.getByText("Publish readiness")).toBeTruthy();
    expect(screen.getByText(/issues? to resolve/)).toBeTruthy();
    expect(mocks.publishFmsFlow).not.toHaveBeenCalled();
  });

  it("opens the affected step when a publish issue is clicked", async () => {
    const { user, start } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "Close inspector" }));
    await user.click(screen.getByRole("button", { name: /Start form: The initial Form requires/ }));
    expect(latestFocusRequest?.key).toBe(start);
    expect(screen.getByText("The initial Form requires an exact published template version")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close inspector" })).toBeTruthy();
  });

  it("opens a closed loop that needs an exit", async () => {
    const { user, b } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "make cycle" }));
    await user.click(screen.getAllByRole("button", { name: /Step: This step has no path to a completion step/ })[0]!);
    expect(latestFocusRequest?.key).toBe(b);
    const destination = screen.getByLabelText("Continue to");
    expect(document.activeElement).toBe(destination);
    expect(destination.className).toContain("ring-danger");
  });

  it("keeps a switched-on deadline's values when its section is collapsed, and focuses the date for a date issue", async () => {
    const { user, b } = await openBuilder();
    const deadline = screen.getByRole("switch", { name: "Set deadline" });
    expect((deadline as HTMLInputElement).checked).toBe(false);
    await user.click(deadline);
    expect(stage(b).sla.deadlineEnabled).toBe(true);
    await user.click(screen.getAllByRole("button", { name: /Step: Choose a valid completion due date/ })[0]!);
    const dueDate = screen.getByLabelText("Due date");
    expect(document.activeElement).toBe(dueDate);
    expect(dueDate.className).toContain("ring-danger");
    await user.type(dueDate, "2030-01-15");
    const summary = screen.getByText("When / Deadline").closest("summary")!;
    await user.click(summary); // collapse
    expect(stage(b).sla).toMatchObject({ deadlineEnabled: true, dueDate: "2030-01-15" });
    await user.click(summary); // reopen
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("2030-01-15");
  });

  it("focuses the exact route field for a route issue", async () => {
    const { user } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "connect b" }));
    await user.click(screen.getAllByRole("button", { name: /Route 1.*needs the question or process field/ })[0]!);
    expect(document.activeElement).toBe(screen.getByLabelText("Route 1 field key"));
    expect(screen.getByLabelText("Route 1 field key").className).toContain("ring-danger");
  });

  it("opens the route's own settings from the canvas route editor", async () => {
    const { user, start } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "connect b" }));
    await user.click(screen.getByRole("button", { name: "Close inspector" }));
    await user.click(screen.getByRole("button", { name: "edit route" }));
    expect(screen.getByRole("complementary", { name: `Configure ${stage(start).name}` })).toBeTruthy();
    expect(document.activeElement?.closest("[data-route-id]")?.getAttribute("data-route-id")).toBe(stage(start).branchRules[0]!.id);
  });

  it("copies the first assignee to every step and permits a later override", async () => {
    const personId = "00000000-0000-4000-8000-000000000023";
    const builderData = { ...data, users: [{ id: personId, employee_name: "Asha", employee_code: "A1", account_status: "active", user_role: "staff", branch_id: "", department_id: "", working_status: "active", is_login_enabled: true }] } as FmsData;
    const { user } = await openBuilder(builderData);
    await openTools(user);
    await user.click(screen.getByRole("button", { name: /Pre-assign people to steps/ }));
    await user.click(screen.getAllByRole("radio", { name: "Asha" })[0]!);
    await user.click(screen.getByRole("checkbox", { name: "Use the first step's person for all steps" }));
    expect(latest!.stages.filter((item) => ["form", "task", "approval"].includes(item.type)).every((item) => item.assigneeRules[0]?.userProfileId === personId)).toBe(true);
    await user.click(screen.getAllByRole("button", { name: "Clear assignee" })[1]!);
    expect(latest!.stages[1]?.assigneeRules).toEqual([]);
  });
});

describe("FMS builder selection, clipboard and bulk actions", () => {
  it("duplicates selected connected steps with fresh keys and their internal connection, as one undo step", async () => {
    const { user, a, b } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "select steps" }));
    await user.click(screen.getByRole("button", { name: "command duplicate" }));
    expect(latest!.stages).toHaveLength(5);
    const [copyA, copyB] = latest!.stages.slice(3);
    expect([copyA!.key, copyB!.key]).not.toContain(a);
    expect(copyA!.defaultNextStageKey).toBe(copyB!.key);
    expect(copyA!.name).toBe(stage(a).name);
    expect(latestSelection).toEqual([copyA!.key, copyB!.key]);
    // Nothing points from the originals to the copies.
    expect(stage(b).defaultNextStageKey).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(latest!.stages).toHaveLength(3);
  });

  it("copies steps from one workflow and pastes them into another with new identifiers", async () => {
    const { user, a } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "select steps" }));
    await user.click(screen.getByRole("button", { name: "command copy" }));
    expect(await screen.findByText(/Copied 2 steps/)).toBeTruthy();
    cleanup();

    render(<FmsFlowBuilder data={savedFlowData} flow={savedFlowData.flows[0]!} onClose={() => undefined} onSaved={async () => undefined} />);
    expect(latest!.stages.map((item) => item.key)).toEqual(["start_form", "follow_up"]);
    await user.click(screen.getByRole("button", { name: "command paste" }));
    expect(latest!.stages).toHaveLength(4);
    const pasted = latest!.stages.slice(2);
    expect(pasted.map((item) => item.key)).not.toContain(a);
    expect(pasted[0]!.defaultNextStageKey).toBe(pasted[1]!.key);
    expect(pasted[0]!.position).toEqual({ x: 100, y: 600 });
    expect(latest!.stages.find((item) => item.key === "follow_up")!.defaultNextStageKey).toBeUndefined();
    expect(screen.getByText(/Pasted 2 steps/)).toBeTruthy();
  });

  it("asks once before deleting several steps and their connections, keeps the Start form, and undoes in one step", async () => {
    const { user, start } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "command selectAll" }));
    expect(latestSelection).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "command delete" }));
    expect(screen.getByText(/The Start form is the workflow trigger and stays/)).toBeTruthy();
    const dialog = screen.getByRole("dialog", { name: "Delete steps" });
    expect(within(dialog).getByText("Delete 2 steps and 2 related connections?")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(latest!.stages.map((item) => item.key)).toEqual([start]);
    expect(stage(start).defaultNextStageKey).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(latest!.stages).toHaveLength(3);
  });

  it("cuts steps to the clipboard and removes them", async () => {
    const { user } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "select steps" }));
    await user.click(screen.getByRole("button", { name: "command cut" }));
    expect(await screen.findByText(/Copied 2 steps/)).toBeTruthy();
    expect(latest!.stages).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "command paste" }));
    expect(latest!.stages).toHaveLength(3);
  });
});

describe("FMS builder questionnaires", () => {
  it("keeps the editor inside the builder and records the draft on the step so a reload finds it", async () => {
    mocks.saveFmsDraft.mockResolvedValue(flowId);
    const { user, b } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "Create questionnaire" }));
    expect(screen.getByRole("region", { name: "Questionnaire studio" })).toBeTruthy();
    expect(screen.getByText("command copy")).toBeTruthy(); // the canvas stays mounted underneath
    await user.click(screen.getByRole("button", { name: "attach draft" }));
    await vi.waitFor(() => expect(mocks.saveFmsDraft).toHaveBeenCalled());
    const saved = mocks.saveFmsDraft.mock.calls.at(-1)![1] as FmsFlowDefinition;
    expect(saved.stages.find((item) => item.key === b)!.sla.questionnaire).toEqual({ origin: "stage", draftFormId: DRAFT_ID });
    expect(stage(b).sla.questionnaire?.draftFormId).toBe(DRAFT_ID);
  });

  it("pins the published questionnaire to the step on Use in workflow", async () => {
    mocks.saveFmsDraft.mockResolvedValue(flowId);
    const { user, b } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "Create questionnaire" }));
    await user.click(screen.getByRole("button", { name: "use in workflow" }));
    await vi.waitFor(() => expect(screen.queryByRole("region", { name: "Questionnaire studio" })).toBeNull());
    const saved = mocks.saveFmsDraft.mock.calls.at(-1)![1] as FmsFlowDefinition;
    expect(saved.stages.find((item) => item.key === b)).toMatchObject({ formTemplateId: DRAFT_ID, sla: expect.objectContaining({ questionnaire: { origin: "stage" } }) });
    expect(screen.getByText(/Questionnaire published and in use/)).toBeTruthy();
  });

  it("does not offer questionnaire creation without Forms authoring permission", async () => {
    const user = userEvent.setup();
    render(<FmsFlowBuilder data={savedFlowData} flow={savedFlowData.flows[0]!} onClose={() => undefined} onSaved={async () => undefined} />);
    await user.click(screen.getByRole("button", { name: "Add Step" }));
    expect(screen.queryByRole("button", { name: "Create questionnaire" })).toBeNull();
    expect(screen.getByRole("button", { name: "Link existing form" })).toBeTruthy();
  });
});

/**
 * Full-screen workspace. jsdom does not lay anything out, so these lock in
 * the structure: the canvas is the only editor, the tools drawer starts
 * closed, and the inspector opens only for a chosen step.
 */
describe("full-screen workspace", () => {
  it("opens a saved workflow directly on the canvas with no inspector or drawer covering it, and no Guided Mode", () => {
    render(<FmsFlowBuilder data={savedFlowData} flow={savedFlowData.flows[0]!} onClose={() => undefined} onSaved={async () => undefined} />);
    expect(screen.getByRole("button", { name: "connect a" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Guided Mode" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Canvas Mode" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close inspector" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Workflow tools drawer" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open workflow tools" }).getAttribute("aria-expanded")).toBe("false");
    expect(latest!.stages.map((item) => item.position)).toEqual([{ x: 80, y: 120 }, { x: 400, y: 120 }]);
  });

  it("sizes the workspace to the window below its own top edge", () => {
    const { container } = render(<FmsFlowBuilder data={savedFlowData} flow={savedFlowData.flows[0]!} onClose={() => undefined} onSaved={async () => undefined} />);
    const workspace = container.firstElementChild as HTMLElement;
    expect(workspace.style.height).toBe(`${window.innerHeight}px`);
    expect(workspace.className).toContain("overflow-hidden");
  });

  it("opens and closes the Workflow tools drawer from its rail, its Close button, Escape, and outside clicks", async () => {
    const user = userEvent.setup();
    render(<FmsFlowBuilder data={savedFlowData} flow={savedFlowData.flows[0]!} onClose={() => undefined} onSaved={async () => undefined} />);
    const drawer = () => screen.queryByRole("complementary", { name: "Workflow tools drawer" });
    await openTools(user);
    expect(drawer()).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close workflow tools" }));
    expect(drawer()).toBeNull();
    await openTools(user);
    await user.keyboard("{Escape}");
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open workflow tools" }));
    await openTools(user);
    await user.pointer({ keys: "[MouseLeft>]", target: drawer()!.previousElementSibling! });
    expect(drawer()).toBeNull();
  });

  it("selects a new step and opens its inspector, then closing it restores the bare canvas", async () => {
    const user = userEvent.setup();
    render(<FmsFlowBuilder data={savedFlowData} flow={savedFlowData.flows[0]!} onClose={() => undefined} onSaved={async () => undefined} />);
    await user.click(screen.getByRole("button", { name: "Add Step" }));
    const inspector = screen.getByRole("complementary", { name: "Configure Step" });
    expect(inspector.className).toContain("absolute");
    expect(within(inspector).getByLabelText("Step name")).toBeTruthy();
    // Optional settings start collapsed.
    for (const title of ["Task naming", "When / Deadline", "Instructions", "Checklist", "Completion controls", "Advanced settings"]) {
      expect((within(inspector).getByText(title).closest("details") as HTMLDetailsElement).open).toBe(false);
    }
    await user.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(screen.queryByRole("complementary", { name: /Configure/ })).toBeNull();
  });

  it("keeps the toolbar reachable without widening the page and names every icon-only control", async () => {
    await openBuilder();
    const header = document.querySelector("header");
    expect(header!.className).toMatch(/scroll-x|overflow-x-auto/);
    for (const name of ["Back to FMS", "Undo", "Redo", "Import or export", "Check workflow", "Simulate workflow", "Save draft", "Open workflow tools", "Add Step"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("imports pasted workflow JSON as new draft steps", async () => {
    const user = userEvent.setup();
    render(<FmsFlowBuilder data={savedFlowData} flow={savedFlowData.flows[0]!} onClose={() => undefined} onSaved={async () => undefined} />);
    await user.click(screen.getByRole("button", { name: "Import or export" }));
    await user.click(screen.getByRole("button", { name: "Paste JSON" }));
    const json = JSON.stringify({ format: "mkjewels.fms.fragment", version: 1, stages: [{ key: "proposal", name: "Proposal", type: "task", order: 0, sla: { dueDate: "" } }, { key: "negotiation", name: "Negotiation", type: "task", order: 1, defaultNextStageKey: "missing", sla: { dueDate: "" } }] });
    await user.click(screen.getByLabelText("Workflow JSON"));
    await user.paste(json);
    expect(screen.getByText(/2 steps: Proposal, Negotiation/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add to this workflow" }));
    expect(latest!.stages.map((item) => item.name)).toEqual(["Start form", "Follow up", "Proposal", "Negotiation"]);
    expect(screen.getByText(/1 link to steps that were not copied was removed/)).toBeTruthy();
    expect(mocks.publishFmsFlow).not.toHaveBeenCalled();
  });

  it("refuses an n8n workflow file with a clear reason", async () => {
    const user = userEvent.setup();
    render(<FmsFlowBuilder data={savedFlowData} flow={savedFlowData.flows[0]!} onClose={() => undefined} onSaved={async () => undefined} />);
    await user.click(screen.getByRole("button", { name: "Import or export" }));
    await user.click(screen.getByRole("button", { name: "Paste JSON" }));
    await user.click(screen.getByLabelText("Workflow JSON"));
    await user.paste(JSON.stringify({ nodes: [], connections: {} }));
    expect(screen.getByText(/n8n workflow files are not supported/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add to this workflow" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

/**
 * Phone layout. `useIsMobile` reads `(max-width: 767px)`, so matching every
 * media query puts the builder in its phone layout.
 */
describe("FMS builder on a phone", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  async function openPhoneBuilder() {
    const user = userEvent.setup();
    render(<FmsFlowBuilder data={data} flow={null} onClose={() => undefined} onSaved={async () => undefined} />);
    await user.type(screen.getByLabelText("Workflow name *"), "Qualification");
    await user.type(screen.getByLabelText("Purpose *"), "Route by customer type");
    await user.click(screen.getByRole("button", { name: /Open builder/ }));
    return user;
  }

  it("opens on the canvas with the editor closed and every header action reachable", async () => {
    await openPhoneBuilder();
    expect(screen.getByRole("button", { name: "connect a" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Steps" })).toBeNull();
    for (const name of ["Back", "Save draft", "Undo", "Redo", "Simulate workflow", "Import or export", "Add Step"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Publish$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close inspector" })).toBeNull();
  });

  it("adds a step from the floating button and edits it in a bottom sheet", async () => {
    const user = await openPhoneBuilder();
    await user.click(screen.getByRole("button", { name: "Add Step" }));
    const sheet = screen.getByRole("complementary", { name: "Configure Step" });
    expect(sheet.className).toContain("bottom-[calc(4.5rem+env(safe-area-inset-bottom))]");
    expect(latest!.stages).toHaveLength(2);
  });

  it("lists readiness issues on demand", async () => {
    const user = await openPhoneBuilder();
    const readiness = screen.getByRole("button", { name: /Publish readiness/ });
    expect(readiness.getAttribute("aria-expanded")).toBe("false");
    await user.click(readiness);
    expect(readiness.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });
});
