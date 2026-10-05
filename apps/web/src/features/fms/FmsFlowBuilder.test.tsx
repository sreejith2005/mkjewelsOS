// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FmsFlowDefinition } from "@jewelos/core";
import type { FmsData } from "./api";
import { FmsFlowBuilder } from "./FmsFlowBuilder";

const mocks = vi.hoisted(() => ({ saveFmsDraft: vi.fn(), publishFmsFlow: vi.fn(), saveFmsContextAssigneeDefault: vi.fn() }));
vi.mock("./api", () => ({ saveFmsDraft: mocks.saveFmsDraft, publishFmsFlow: mocks.publishFmsFlow, saveFmsContextAssigneeDefault: mocks.saveFmsContextAssigneeDefault }));

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
  // Adding a step wires it in after the selected one, giving start -> A -> B.
  await user.click(screen.getByRole("button", { name: /Add Step/ }));
  await user.click(screen.getByRole("button", { name: /Add Step/ }));
  const [start, a, b] = latest!.stages.map((item) => item.key) as [string, string, string];
  return { user, start, a, b };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); latest = null; latestFocusRequest = null; });

describe("FMS builder graph wiring", () => {
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
    await user.click(screen.getByRole("button", { name: /Pre-assign users after building the flow/ }));
    await user.click(screen.getAllByRole("radio", { name: "Asha" })[0]!);
    await user.click(screen.getByRole("checkbox", { name: "Use the first step's person for all steps" }));
    expect(latest!.stages.filter((item) => ["form", "task", "approval"].includes(item.type)).every((item) => item.assigneeRules[0]?.userProfileId === personId)).toBe(true);
    await user.click(screen.getAllByRole("button", { name: "Clear assignee" })[1]!);
    expect(latest!.stages[1]?.assigneeRules).toEqual([]);
    expect((screen.getByRole("checkbox", { name: "Use the first step's person for all steps" }) as HTMLInputElement).checked).toBe(false);
  });

  /**
   * Compact-screen containment. jsdom does not lay anything out, so these lock
   * in the structural choices that keep the builder inside a narrow viewport
   * rather than measuring pixels: a stacking grid whose columns may shrink, a
   * palette that scrolls inside itself, and named icon-only controls.
   */
  describe("compact layout", () => {
    it("stacks the palette above the canvas until xl and lets both columns shrink", async () => {
      await openBuilder();
      const grid = document.querySelector("[class*='xl:grid-cols-']");
      expect(grid).toBeTruthy();
      // `minmax(0,1fr)` is what stops a wide canvas forcing document-level
      // horizontal scroll; `1fr` alone would blow the grid out.
      expect(grid!.className).toContain("minmax(0,1fr)");
      // No column template below xl means one stacked column on a phone.
      expect(grid!.className).not.toMatch(/(?<!xl:)grid-cols-\[/);
    });

    it("scrolls the building-block palette inside its own bounded height", async () => {
      await openBuilder();
      const palette = screen.getByText("Building blocks").closest("aside");
      expect(palette).toBeTruthy();
      expect(palette!.className).toContain("overflow-y-auto");
      expect(palette!.className).toMatch(/max-h-/);
    });

    it("keeps the header actions reachable without widening the page", async () => {
      await openBuilder();
      const header = document.querySelector("header");
      expect(header).toBeTruthy();
      expect(header!.className).toMatch(/scroll-x|overflow-x-auto/);
    });

    it("gives every icon-only control an accessible name", async () => {
      await openBuilder();
      for (const name of ["Undo", "Redo", "Check workflow"]) {
        expect(screen.getByRole("button", { name })).toBeTruthy();
      }
    });

    it("lets the publish-readiness bar wrap instead of overflowing", async () => {
      await openBuilder();
      const bar = screen.getByText("Publish readiness").closest("section");
      expect(bar).toBeTruthy();
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
