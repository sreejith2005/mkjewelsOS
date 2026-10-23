// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FmsFlowDefinition } from "@jewelos/core";
import type { FmsData } from "./api";
import { FmsFlowBuilder } from "./FmsFlowBuilder";

const mocks = vi.hoisted(() => ({ saveFmsDraft: vi.fn(), publishFmsFlow: vi.fn(), saveFmsContextAssigneeDefault: vi.fn() }));
vi.mock("./api", () => ({ saveFmsDraft: mocks.saveFmsDraft, publishFmsFlow: mocks.publishFmsFlow, saveFmsContextAssigneeDefault: mocks.saveFmsContextAssigneeDefault }));
vi.mock("./FmsFormAuthoring", async importOriginal => {
  const actual = await importOriginal<typeof import("./FmsFormAuthoring")>();
  return { ...actual, FmsFormAuthoring: ({ target, onClose }: { target: { flowId: string; stageKey: string; formTemplateId?: string }; onClose: () => void }) => <section aria-label="Linked Forms workspace"><p>{target.flowId} / {target.formTemplateId}</p><button onClick={onClose}>Return to workflow step</button></section> };
});

/**
 * The canvas is replaced by plain buttons so these tests exercise the graph
 * transitions the real pointer gestures drive, without emulating pointer
 * capture and hit testing in jsdom.
 */
let latest: FmsFlowDefinition | null = null;
let latestFocusRequest: { key: string; id: number } | null = null;
vi.mock("./FmsGraphCanvas", () => ({
  FmsGraphCanvas: ({ definition, focusRequest, onConnect, onDisconnect, onReconnect, onMove }: {
    definition: FmsFlowDefinition;
    focusRequest?: { key: string; id: number } | null;
    onConnect: (from: string, to: string) => void;
    onDisconnect: (from: string, to: string, ruleId?: string) => void;
    onReconnect: (from: string, previousTo: string, nextTo: string, ruleId?: string) => void;
    onMove: (positions: Record<string, { x: number; y: number }>) => void;
  }) => {
    latest = definition;
    latestFocusRequest = focusRequest ?? null;
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
    </div>;
  },
}));

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
  render(<FmsFlowBuilder data={builderData} flow={null} onClose={() => undefined} onSaved={async () => undefined} />);
  await user.type(screen.getByLabelText("Workflow name *"), "Qualification");
  await user.type(screen.getByLabelText("Purpose *"), "Route by customer type");
  await user.click(screen.getByRole("button", { name: /Open builder/ }));
  await user.click(screen.getByRole("button", { name: "Canvas Mode" }));
  // Adding a step wires it in after the selected one, giving start -> A -> B.
  await user.click(screen.getByRole("button", { name: /Add Step/ }));
  await user.click(screen.getByRole("button", { name: /Add Step/ }));
  const [start, a, b] = latest!.stages.map((item) => item.key) as [string, string, string];
  return { user, start, a, b };
}

/** The Building blocks palette now lives in the Workflow tools drawer, closed by default. */
async function openTools(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Open workflow tools" }));
}

const flowId = "00000000-0000-4000-8000-0000000000f1";
const savedFlowData = {
  ...data,
  flows: [{ id: flowId, family_id: "fam-saved", version: 1, assignment_version: 2, name: "Saved sales flow", description: "Existing", status: "draft", scope_type: "tenant", branch_id: null, department_id: null, is_active: true, usage_count: 0 }],
  stages: ["start_form", "follow_up"].map((stage_key, sort_order) => ({ id: `00000000-0000-4000-8000-00000000000${sort_order + 1}`, fms_flow_id: flowId, stage_key, name: stage_key === "start_form" ? "Start form" : "Follow up", method: null, step_type: sort_order === 0 ? "form" : "task", sort_order, is_required: true, planned_time_rule: { deadlineEnabled: false }, completion_rule: "any_doer", allow_multiple_doers: false, requires_upload: false, requires_remark: false, checklist_definition: [], form_template_id: sort_order === 0 ? formId : null, requires_next_doer_handoff: false, can_move_backward: false, can_reject: false, can_request_revision: false, can_escalate: false, default_next_stage_id: null, parallel_target_stage_ids: [], join_rule: null, join_required_stage_ids: [], split_to_flow_id: null, canvas_position: { x: 80 + sort_order * 320, y: 120 } })),
} as unknown as FmsData;

afterEach(() => { cleanup(); vi.clearAllMocks(); latest = null; latestFocusRequest = null; });

describe("FMS builder graph wiring", () => {
  it("saves before opening Forms and returns to the same step with its version intact", async () => {
    mocks.saveFmsDraft.mockResolvedValue("saved-flow");
    const { user, start } = await openBuilder();
    await openTools(user);
    await user.click(screen.getByRole("button", { name: /Configure the initial details form/ }));
    await user.selectOptions(screen.getByLabelText("Initial details form"), formId);
    await user.click(screen.getByRole("button", { name: "Preview Form" }));
    expect(await screen.findByRole("region", { name: "Linked Forms workspace" })).toBeTruthy();
    expect(screen.getByText(`saved-flow / ${formId}`)).toBeTruthy();
    expect(mocks.saveFmsDraft).toHaveBeenCalledWith(null, expect.objectContaining({ name: "Qualification" }));
    await user.click(screen.getByRole("button", { name: "Return to workflow step" }));
    expect((screen.getByLabelText("Initial details form") as HTMLSelectElement).value).toBe(formId);
    expect(stage(start).formTemplateId).toBe(formId);
  });
  it("no longer asks for workflow context or CRM scope when creating a workflow", () => {
    render(<FmsFlowBuilder data={data} flow={null} onClose={() => undefined} onSaved={async () => undefined} />);
    expect(screen.queryByLabelText("Workflow context")).toBeNull();
    expect(screen.queryByText("All branches")).toBeNull();
    expect(screen.queryByText("One department")).toBeNull();
    expect(screen.getByLabelText("Workflow name *")).toBeTruthy();
  });

  it("adds a step as a plain next step, keeping simple flows single-path", async () => {
    const { start, a, b } = await openBuilder();
    expect(stage(start).defaultNextStageKey).toBe(a);
    expect(stage(start).branchRules).toHaveLength(0);
    expect(stage(a).defaultNextStageKey).toBe(b);
  });

  it("turns a second outgoing connection into a route instead of replacing the first", async () => {
    const { user, start, a, b } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "connect b" }));
    expect(stage(start).defaultNextStageKey).toBe(a);
    expect(stage(start).branchRules.map((rule) => rule.nextStageKey)).toEqual([b]);
    // With no Form linked yet there is no answer to read, so the route falls
    // back to a process-data condition the user still has to fill in.
    expect(stage(start).branchRules[0]?.source).toBe("context");
  });

  it("seeds an extra connection from the linked form's first question once a Form is attached", async () => {
    const { user, start, b } = await openBuilder();
    await openTools(user);
    await user.click(screen.getByRole("button", { name: /Configure the initial details form/ }));
    await user.selectOptions(screen.getByLabelText("Initial details form"), formId);
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

  it("recreates a connection after it was removed", async () => {
    const { user, start, a } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "disconnect default" }));
    expect(stage(start).defaultNextStageKey).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "connect a" }));
    expect(stage(start).defaultNextStageKey).toBe(a);
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

  it("undoes a connection change", async () => {
    const { user, start, a } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "disconnect default" }));
    await user.click(screen.getByRole("button", { name: "Undo" }));
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
    expect(screen.getByRole("button", { name: "Close inspector" })).toBeTruthy();
    expect(screen.getByText("The initial Form requires an exact published template version")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Initial details form"));
    expect(screen.getByLabelText("Initial details form").className).toContain("ring-danger");
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
  it("focuses and highlights the due-date question for a date issue", async () => {
    const { user } = await openBuilder();
    await user.click(screen.getAllByRole("button", { name: /Step: Choose a valid completion due date/ })[0]!);
    const dueDate = screen.getByLabelText("Completion due date");
    expect(document.activeElement).toBe(dueDate);
    expect(dueDate.className).toContain("ring-danger");
  });
  it("focuses the exact route field for a route issue", async () => {
    const { user } = await openBuilder();
    await user.click(screen.getByRole("button", { name: "connect b" }));
    await user.click(screen.getAllByRole("button", { name: /Route 1.*needs the question or process field/ })[0]!);
    expect(document.activeElement).toBe(screen.getByLabelText("Route 1 field key"));
    expect(screen.getByLabelText("Route 1 field key").className).toContain("ring-danger");
  });

  it("copies the first assignee to every step and permits a later override", async () => {
    const personId = "00000000-0000-4000-8000-000000000023";
    const builderData = { ...data, users: [{ id: personId, employee_name: "Asha", employee_code: "A1", account_status: "active", user_role: "staff", branch_id: "", department_id: "", working_status: "active", is_login_enabled: true }] } as FmsData;
    const { user } = await openBuilder(builderData);
    await openTools(user);
    await user.click(screen.getByRole("button", { name: /Pre-assign users after building the flow/ }));
    await user.click(screen.getAllByRole("radio", { name: "Asha" })[0]!);
    await user.click(screen.getByRole("checkbox", { name: "Use the first step's person for all steps" }));
    expect(latest!.stages.filter((item) => ["form", "task", "approval"].includes(item.type)).every((item) => item.assigneeRules[0]?.userProfileId === personId)).toBe(true);
    await user.click(screen.getAllByRole("button", { name: "Clear assignee" })[1]!);
    expect(latest!.stages[1]?.assigneeRules).toEqual([]);
    expect((screen.getByRole("checkbox", { name: "Use the first step's person for all steps" }) as HTMLInputElement).checked).toBe(false);
  });

  /**
   * Full-screen workspace. jsdom does not lay anything out, so these lock in
   * the structure: the canvas is the default view, the palette is an overlay
   * drawer that starts closed, and the inspector opens only for a chosen step.
   */
  describe("full-screen workspace", () => {
    it("opens a saved workflow directly on the canvas with no inspector or drawer covering it", () => {
      render(<FmsFlowBuilder data={savedFlowData} flow={savedFlowData.flows[0]!} onClose={() => undefined} onSaved={async () => undefined} />);
      expect(screen.getByRole("button", { name: "Canvas Mode" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: "connect a" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Close inspector" })).toBeNull();
      expect(screen.queryByText("Building blocks")).toBeNull();
      const toggle = screen.getByRole("button", { name: "Open workflow tools" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(latest!.stages.map((item) => item.position)).toEqual([{ x: 80, y: 120 }, { x: 400, y: 120 }]);
    });

    it("sizes the workspace to the window below its own top edge", () => {
      const { container } = render(<FmsFlowBuilder data={savedFlowData} flow={savedFlowData.flows[0]!} onClose={() => undefined} onSaved={async () => undefined} />);
      const workspace = container.firstElementChild as HTMLElement;
      expect(workspace.style.height).toBe(`${window.innerHeight}px`);
      expect(workspace.className).toContain("overflow-hidden");
      expect(workspace.className).not.toMatch(/md:pr-/);
    });

    it("opens and closes the Workflow tools drawer from its rail, its Close button, Escape, and outside clicks", async () => {
      const user = userEvent.setup();
      render(<FmsFlowBuilder data={savedFlowData} flow={savedFlowData.flows[0]!} onClose={() => undefined} onSaved={async () => undefined} />);
      await openTools(user);
      expect(screen.getByText("Building blocks")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Open workflow tools" }).getAttribute("aria-expanded")).toBe("true");
      await user.click(screen.getByRole("button", { name: "Close workflow tools" }));
      expect(screen.queryByText("Building blocks")).toBeNull();
      await openTools(user);
      await user.keyboard("{Escape}");
      expect(screen.queryByText("Building blocks")).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open workflow tools" }));
      await openTools(user);
      await user.pointer({ keys: "[MouseLeft>]", target: screen.getByRole("complementary", { name: "Workflow tools drawer" }).previousElementSibling! });
      expect(screen.queryByText("Building blocks")).toBeNull();
    });

    it("selects a new step and opens its inspector, then closing it restores the bare canvas", async () => {
      const user = userEvent.setup();
      render(<FmsFlowBuilder data={savedFlowData} flow={savedFlowData.flows[0]!} onClose={() => undefined} onSaved={async () => undefined} />);
      await user.click(screen.getByRole("button", { name: "Add Step" }));
      const inspector = screen.getByRole("complementary", { name: "Configure Step" });
      expect(inspector.className).toContain("absolute");
      expect(within(inspector).getByLabelText("Step name")).toBeTruthy();
      expect(latest!.stages).toHaveLength(3);
      await user.click(screen.getByRole("button", { name: "Close inspector" }));
      expect(screen.queryByRole("complementary", { name: /Configure/ })).toBeNull();
      expect(screen.getByRole("button", { name: "connect a" })).toBeTruthy();
    });

    it("keeps Guided Mode available as an optional view", async () => {
      const user = userEvent.setup();
      render(<FmsFlowBuilder data={savedFlowData} flow={savedFlowData.flows[0]!} onClose={() => undefined} onSaved={async () => undefined} />);
      await user.click(screen.getByRole("button", { name: "Guided Mode" }));
      expect(screen.getByRole("list", { name: "Workflow steps" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "connect a" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Canvas Mode" }));
      expect(screen.getByRole("button", { name: "connect a" })).toBeTruthy();
    });

    it("keeps the toolbar reachable without widening the page and names every icon-only control", async () => {
      await openBuilder();
      const header = document.querySelector("header");
      expect(header!.className).toMatch(/scroll-x|overflow-x-auto/);
      for (const name of ["Back to FMS", "Undo", "Redo", "Check workflow", "Simulate workflow", "Save draft", "Open workflow tools", "Add Step"]) {
        expect(screen.getByRole("button", { name })).toBeTruthy();
      }
    });

    it("lets the floating publish-readiness bar wrap instead of overflowing", async () => {
      await openBuilder();
      const bar = screen.getByText("Publish readiness").closest("section");
      expect(bar!.className).toContain("absolute");
      expect(bar!.querySelector(".flex-wrap")).toBeTruthy();
    });
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

  it("opens on the step list with the editor closed and every header action reachable", async () => {
    await openPhoneBuilder();
    expect(screen.getByRole("list", { name: "Workflow steps" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Steps" }).getAttribute("aria-selected")).toBe("true");
    for (const name of ["Back", "Save draft", "Undo", "Redo"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Publish$/ })).toBeTruthy();
    // No palette, no canvas, and no editor sheet covering the list.
    expect(screen.queryByText("Building blocks")).toBeNull();
    expect(screen.queryByRole("button", { name: "connect a" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close inspector" })).toBeNull();
  });

  it("adds a step after a chosen step without any dragging", async () => {
    const user = await openPhoneBuilder();
    await user.click(screen.getByRole("button", { name: "Add next step after Start form" }));
    await user.click(screen.getByRole("button", { name: "Close inspector" }));
    await user.click(screen.getByRole("button", { name: "Add next step after Start form" }));
    await user.click(screen.getByRole("button", { name: "Close inspector" }));
    const items = within(screen.getByRole("list", { name: "Workflow steps" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[1]!.textContent).toContain("Step");
  });

  it("opens the editor when a step is tapped", async () => {
    const user = await openPhoneBuilder();
    await user.click(screen.getByRole("button", { name: "Edit Start form" }));
    expect(screen.getByRole("button", { name: "Close inspector" })).toBeTruthy();
  });

  it("switches to the map and lists readiness issues on demand", async () => {
    const user = await openPhoneBuilder();
    await user.click(screen.getByRole("tab", { name: "Map" }));
    expect(screen.getByRole("button", { name: "connect a" })).toBeTruthy();
    const readiness = screen.getByRole("button", { name: /Publish readiness/ });
    expect(readiness.getAttribute("aria-expanded")).toBe("false");
    await user.click(readiness);
    expect(readiness.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });
});
