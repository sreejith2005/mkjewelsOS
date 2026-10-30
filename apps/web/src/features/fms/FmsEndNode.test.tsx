// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFmsJourney, type FmsFlowDefinition, type FmsStageDefinition, type FmsWorkResult } from "@jewelos/core";
import type { FmsData } from "./api";
import { newFmsStage } from "./definition";
import { FmsGraphCanvas } from "./FmsGraphCanvas";
import { FmsStageEditor } from "./FmsStageEditor";
import { FmsWorkOutcome } from "./FmsWorkOutcome";
import { FmsJourneyTimeline } from "./workspace/FmsJourneyTimeline";

const data = { flows: [], stages: [], assignees: [], branchRules: [], forms: [], formFields: {}, statusOptions: [], availability: [], branches: [], departments: [], users: [] } as unknown as FmsData;
const intro: FmsStageDefinition = { ...newFmsStage("form", 0), key: "intro", name: "Introduction", defaultNextStageKey: "lead_closed" };
const demo: FmsStageDefinition = { ...newFmsStage("task", 1), key: "demo", name: "Demo", defaultNextStageKey: "lead_closed" };
const leadClosed: FmsStageDefinition = { ...newFmsStage("end", 2), key: "lead_closed", name: "Lead Closed", sla: { ...newFmsStage("end", 2).sla, terminal: { outcome: "lost" } } };

afterEach(cleanup);
beforeEach(() => { try { window.localStorage.setItem("jewelos.fms.canvasTip.v1", "1"); } catch { /* ignore */ } });

function Harness({ onChange }: { onChange?: (stage: FmsStageDefinition) => void }) {
  const [stage, setStage] = useState(leadClosed);
  return <FmsStageEditor data={data} endCounts={new Map([["lead_closed", 20]])} onChange={(next) => { setStage(next); onChange?.(next); }} onDelete={() => undefined} stage={stage} stages={[intro, demo, stage]} />;
}

describe("End Node inspector", () => {
  it("shows only End Node settings: name, End type, reason, automatic closure, incoming connections and the count", () => {
    render(<Harness />);
    expect(screen.getByText("End Node settings")).toBeTruthy();
    expect(screen.getByText("Reaching this node automatically ends the workflow. No task or form is created.")).toBeTruthy();
    expect(screen.getByText("Incoming connections (2)")).toBeTruthy();
    expect(screen.getByText("Introduction")).toBeTruthy();
    expect(screen.getByText("20")).toBeTruthy();
    for (const hidden of ["Assigned to", "When / Deadline", "Checklist", "Task naming", "Completion controls", "Questions"]) expect(screen.queryByText(hidden)).toBeNull();
    expect(screen.queryByLabelText("Continue to")).toBeNull();
  });
  it("stores the End type and reason as stable codes", async () => {
    const changes = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={changes} />);
    await user.click(screen.getByRole("button", { name: /Do not contact/ }));
    expect(changes.mock.lastCall?.[0].sla.terminal).toEqual({ outcome: "do_not_contact" });
    await user.type(screen.getByPlaceholderText("e.g. not_interested"), "Price High");
    expect(changes.mock.lastCall?.[0].sla.terminal).toEqual({ outcome: "do_not_contact", reasonCode: "price_high" });
  });
});

describe("End the workflow here switch", () => {
  function StepHarness({ start, onChange }: { start: FmsStageDefinition; onChange: (stage: FmsStageDefinition) => void }) {
    const [stage, setStage] = useState(start);
    return <FmsStageEditor data={data} onChange={(next) => { setStage(next); onChange(next); }} onDelete={() => undefined} stage={stage} stages={[intro, demo, stage]} />;
  }
  it("turns a last step into an End Node, keeping its name and key, and back again", async () => {
    const lostSale: FmsStageDefinition = { ...newFmsStage("task", 3), key: "lost_sale", name: "Lost Sale" };
    const changes = vi.fn();
    const user = userEvent.setup();
    render(<StepHarness onChange={changes} start={lostSale} />);
    await user.click(screen.getByRole("checkbox", { name: "End the workflow at this step" }));
    expect(changes.mock.lastCall?.[0]).toMatchObject({ key: "lost_sale", name: "Lost Sale", type: "end", sla: { terminal: { outcome: "lost" } } });
    expect(screen.getByText("End Node settings")).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "End the workflow at this step" }));
    expect(changes.mock.lastCall?.[0]).toMatchObject({ key: "lost_sale", type: "task" });
  });
  it("cannot end the workflow at a step that still leads somewhere", () => {
    render(<StepHarness onChange={vi.fn()} start={{ ...demo }} />);
    expect((screen.getByRole("checkbox", { name: "End the workflow at this step" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Only a last step can end the workflow. Remove its next step or routes first.")).toBeTruthy();
  });
});

describe("End Node on the canvas", () => {
  const definition: FmsFlowDefinition = { name: "Funnel", scope: "tenant", manualTrigger: true, stages: [intro, demo, leadClosed] };
  const props = () => ({ definition, formFields: {}, selectedKeys: [] as readonly string[], inspectedKey: null, invalidKeys: new Set<string>(), onSelectionChange: vi.fn(), onOpen: vi.fn(), onCommand: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn(), onAddAfter: vi.fn(), onConnect: vi.fn(), onDisconnect: vi.fn(), onReconnect: vi.fn(), onMove: vi.fn(), onEditRoute: vi.fn() });
  it("shows the outcome and the count, accepts connections but has no outgoing handle or Add next step", () => {
    const { container } = render(<FmsGraphCanvas {...props()} endCounts={new Map([["lead_closed", 20]])} />);
    const node = container.querySelector<HTMLElement>('[data-node-key="lead_closed"]')!;
    expect(within(node).getByText("End · Lost")).toBeTruthy();
    expect(within(node).getByText("20")).toBeTruthy();
    expect(node.querySelector("[data-node-output]")).toBeNull();
    expect(within(node).queryByRole("button", { name: /Add next step/ })).toBeNull();
    expect(within(node).getByText("End Node · closes automatically")).toBeTruthy();
    expect(within(container.querySelector<HTMLElement>('[data-node-key="demo"]')!).queryByText("Last step · needs Mark as done")).toBeNull();
  });
  it("marks a last normal step as needing Mark as done", () => {
    const lastStep: FmsStageDefinition = { ...newFmsStage("task", 3), key: "sales_closure", name: "Sales Closure" };
    const { container } = render(<FmsGraphCanvas {...props()} definition={{ ...definition, stages: [intro, { ...demo, defaultNextStageKey: "sales_closure" }, lastStep, leadClosed] }} />);
    expect(within(container.querySelector<HTMLElement>('[data-node-key="sales_closure"]')!).getByText("Last step · needs Mark as done")).toBeTruthy();
  });
});

describe("automatic closure feedback", () => {
  it("names the End Node reached instead of asking for more work", () => {
    const result: FmsWorkResult = { state: "workflow_completed", submissionId: "s", instanceId: "i", sourceInstanceStageId: "v", referenceNumber: "FMS-1", destinations: [], ownWorkTargets: [], terminal: { stageName: "Lead Closed", outcome: "lost" } };
    render(<FmsWorkOutcome result={result} />);
    expect(screen.getByText("Workflow closed automatically at Lead Closed (Lost). No further steps.")).toBeTruthy();
    expect(screen.queryByText(/Mark as Done/i)).toBeNull();
  });
});

describe("journey timeline", () => {
  const visit = (id: string, stageKey: string, stageName: string, visitNumber: number, patch: Record<string, unknown> = {}) => ({ id: `00000000-0000-4000-8000-0000000000${id}`, stageKey, stageName, stageType: "form", visitNumber, status: "completed", outcome: null, remark: null,
    stopped: false, skipped: false, activatedAt: "2026-10-30T04:30:00Z", completedAt: "2026-10-30T04:32:00Z", dueAt: null, completedBy: "Asha", assignees: ["Asha"], formName: null, submittedAt: null, routeLabel: null, nextStages: [], answers: [], events: [], ...patch });
  it("lists only executed steps with repeat visits and the final outcome, read-only", () => {
    const journey = decodeFmsJourney({ instance: { id: "00000000-0000-4000-8000-0000000000ff", reference: "FMS-9", title: "XYZ", name: "XYZ Customer", status: "completed", version: 1, workflowName: "Funnel", startedAt: "2026-10-30T04:30:00Z", completedAt: null, startedBy: "Asha", cancelledAt: null, cancelReason: null, holdReason: null },
      outcome: { stageName: "Lead Closed", outcome: "lost", reasonCode: "not_interested", closedAt: "2026-10-30T05:00:00Z", routeLabel: "Not interested", sourceStageName: "Follow-up 1", sourceQuestion: "Client status", sourceValue: "NOT INTERESTED", stoppedCount: 0, closedBy: null },
      visits: [visit("01", "intro", "Introduction", 1, { answers: [{ label: "Client status", value: "follow_up" }] }), visit("02", "f1", "Follow-up 1", 1), visit("03", "demo", "Demo", 1), visit("04", "f1", "Follow-up 1", 2), { ...visit("05", "lead_closed", "Lead Closed", 1), stageType: "end" }] });
    render(<FmsJourneyTimeline journey={journey} />);
    expect(screen.getByText("Follow-up 1 (visit 2)")).toBeTruthy();
    expect(screen.getByText("Client status: follow_up")).toBeTruthy();
    expect(screen.getByText("Final outcome: Lost · Lead Closed")).toBeTruthy();
    expect(screen.getByText(/because Client status was "NOT INTERESTED"/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
