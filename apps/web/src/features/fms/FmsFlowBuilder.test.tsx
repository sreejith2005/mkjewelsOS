// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
vi.mock("./FmsGraphCanvas", () => ({
  FmsGraphCanvas: ({ definition, onConnect, onDisconnect, onReconnect, onMove }: {
    definition: FmsFlowDefinition;
    onConnect: (from: string, to: string) => void;
    onDisconnect: (from: string, to: string, ruleId?: string) => void;
    onReconnect: (from: string, previousTo: string, nextTo: string, ruleId?: string) => void;
    onMove: (positions: Record<string, { x: number; y: number }>) => void;
  }) => {
    latest = definition;
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
  forms: [{ id: formId, name: "Intake", version: 1 }],
  formFields: { [formId]: [{ key: "customer_type", label: "Customer type", optionValues: ["retail", "wholesale"] }] },
  users: [], availability: [], branches: [], departments: [], contextDefaults: [],
} as unknown as FmsData;

const stage = (key: string) => latest!.stages.find((item) => item.key === key)!;

async function openBuilder() {
  const user = userEvent.setup();
  render(<FmsFlowBuilder data={data} flow={null} onClose={() => undefined} onSaved={async () => undefined} />);
  await user.type(screen.getByLabelText("Workflow name *"), "Qualification");
  await user.type(screen.getByLabelText("Purpose *"), "Route by customer type");
  await user.click(screen.getByRole("button", { name: /Open builder/ }));
  // Adding a step wires it in after the selected one, giving start -> A -> B.
  await user.click(screen.getByRole("button", { name: /Add Step/ }));
  await user.click(screen.getByRole("button", { name: /Add Step/ }));
  const [start, a, b] = latest!.stages.map((item) => item.key) as [string, string, string];
  return { user, start, a, b };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); latest = null; });

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
});
