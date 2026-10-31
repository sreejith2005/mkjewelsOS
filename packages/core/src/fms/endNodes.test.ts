import { describe, expect, it } from "vitest";
import { normalizeFmsDefinition, validateFmsDefinition } from "./engine";
import { convertFmsEndToStage, convertFmsStageToEnd, suggestFmsTerminalOutcome, decodeFmsFlowRecords, decodeFmsFlowReport, decodeFmsJourney, fmsConversionPercent, fmsJourneyLines, fmsRecordFilterJson, fmsReportFilterJson, defaultFmsRecordFilters, defaultFmsReportFilters } from "./outcomes";
import { simulateFmsDefinition } from "./simulation";
import { fmsStageTemplate } from "./stageTemplate";
import { exportFmsWorkflow, parseFmsTransfer } from "./transfer";
import type { FmsBranchRule, FmsFlowDefinition, FmsStageDefinition, FmsTerminalOutcome } from "./types";

const formId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const step = (key: string, order: number, patch: Partial<FmsStageDefinition> = {}): FmsStageDefinition => ({
  ...fmsStageTemplate("form", order, () => `${key}-route`), key, name: key, order, formTemplateId: formId,
  assigneeRules: [{ type: "specific_user", userProfileId: userId }], sla: { dueDate: "", deadlineEnabled: false }, ...patch,
});
const end = (key: string, order: number, outcome: FmsTerminalOutcome, patch: Partial<FmsStageDefinition> = {}): FmsStageDefinition => ({
  ...fmsStageTemplate("end", order, () => "x"), key, name: key, ...patch, sla: { dueDate: "", deadlineEnabled: false, terminal: { outcome }, ...patch.sla },
});
let routeSeq = 0;
const route = (value: string, nextStageKey: string, order: number): FmsBranchRule => ({ id: `route_${++routeSeq}`, source: "form_answer", sourceKey: "status", operator: "equals", value, nextStageKey, order });
const fields = { formFields: { [formId]: [{ key: "status", label: "Client status", type: "text" }] } };

/** The Instagram sales funnel from the owner's brief: one Lead Closed shared by every step. */
function funnel(): FmsFlowDefinition {
  return { name: "Instagram sales funnel", scope: "tenant", manualTrigger: true, stages: [
    step("start", 0, { defaultNextStageKey: "intro" }),
    step("intro", 1, { branchRules: [route("interested", "demo", 0), route("follow_up", "f1", 1), route("lost", "lead_closed", 2), route("dnc", "dnc", 3)] }),
    step("demo", 2, { branchRules: [route("order", "order", 0), route("follow_up", "f1", 1), route("lost", "lead_closed", 2)] }),
    step("f1", 3, { branchRules: [route("continue", "f2", 0), route("demo", "demo", 1), route("lost", "lead_closed", 2)] }),
    step("f2", 4, { branchRules: [route("continue", "f3", 0), route("lost", "lead_closed", 1)] }),
    step("f3", 5, { branchRules: [route("intro", "intro", 0), route("lost", "lead_closed", 1)] }),
    step("order", 6, { branchRules: [route("paid", "sales_closed", 0), route("lost", "lead_closed", 1)] }),
    end("sales_closed", 7, "won"), end("lead_closed", 8, "lost"), end("dnc", 9, "do_not_contact"),
  ] };
}

describe("FMS End Nodes: authoring", () => {
  it("accepts several End Nodes, with one shared by many steps", () => expect(validateFmsDefinition(funnel(), fields)).toEqual([]));
  it("a new End Node carries no assignee, deadline or form and defaults to Other", () => {
    const node = fmsStageTemplate("end", 3, () => "x");
    expect(node).toMatchObject({ type: "end", assigneeRules: [], checklist: [], sla: { deadlineEnabled: false, terminal: { outcome: "other" } } });
    expect(node.sla.assignment).toBeUndefined();
  });
  const codes = (definition: FmsFlowDefinition) => validateFmsDefinition(definition, fields).map((issue) => issue.code);
  const withLeadClosed = (patch: Partial<FmsStageDefinition>) => ({ ...funnel(), stages: funnel().stages.map((item) => item.key === "lead_closed" ? { ...item, ...patch } : item) });
  it("refuses an outgoing connection", () => expect(codes(withLeadClosed({ defaultNextStageKey: "intro" }))).toContain("end_has_outgoing"));
  it("refuses an assignee", () => expect(codes(withLeadClosed({ assigneeRules: [{ type: "specific_user", userProfileId: userId }] }))).toContain("end_has_assignee"));
  it("refuses a form, evidence or a checklist", () => {
    expect(codes(withLeadClosed({ formTemplateId: formId }))).toContain("end_has_work");
    expect(codes(withLeadClosed({ requiresUpload: true }))).toContain("end_has_work");
    expect(codes(withLeadClosed({ checklist: [{ key: "a", label: "A", required: true }] }))).toContain("end_has_work");
  });
  it("refuses an unknown outcome code and a malformed reason code", () => {
    expect(codes(withLeadClosed({ sla: { dueDate: "", terminal: { outcome: "sold" as FmsTerminalOutcome } } }))).toContain("invalid_end_outcome");
    expect(codes(withLeadClosed({ sla: { dueDate: "", terminal: { outcome: "lost", reasonCode: "Not interested!" } } }))).toContain("invalid_end_reason");
  });
  it("refuses an End Node nothing reaches", () => {
    const definition = { ...funnel(), stages: [...funnel().stages, end("orphan", 10, "other")] };
    expect(validateFmsDefinition(definition, fields).filter((issue) => issue.stageKey === "orphan").map((issue) => issue.code)).toContain("unreachable_stage");
  });
  it("refuses an End Node as the first step", () => expect(codes({ ...funnel(), stages: [end("first", 0, "won"), ...funnel().stages.map((item) => ({ ...item, order: item.order + 1 }))] })).toContain("end_first_stage"));
  it("keeps implicit completion valid for workflows without End Nodes", () => expect(validateFmsDefinition({ name: "Legacy", scope: "tenant", manualTrigger: true, stages: [step("start", 0, { defaultNextStageKey: "done" }), step("done", 1)] })).toEqual([]));
  it("normalizes the outcome and reason codes", () => {
    const normalized = normalizeFmsDefinition(withLeadClosed({ sla: { dueDate: "", terminal: { outcome: "lost", reasonCode: " Price_Too_High " } } }));
    expect(normalized.stages.find((item) => item.key === "lead_closed")?.sla.terminal).toEqual({ outcome: "lost", reasonCode: "price_too_high" });
  });
  it("exports and imports End Nodes with their outcome", () => {
    const parsed = parseFmsTransfer(JSON.stringify(exportFmsWorkflow(funnel(), new Map())));
    expect(parsed.stages.find((item) => item.key === "dnc")).toMatchObject({ type: "end", sla: { terminal: { outcome: "do_not_contact" } } });
  });
});

describe("FMS End Nodes: simulation", () => {
  const answers = (...pairs: [string, string[]][]) => Object.fromEntries(pairs.map(([key, values]) => [key, values.map((status) => ({ status }))]));
  it("Introduction -> Lead Closed stops at once with a lost outcome and no work at the End Node", () => {
    const run = simulateFmsDefinition(funnel(), { starterId: userId, answers: answers(["intro", ["lost"]]) });
    expect(run.events.map((event) => `${event.stageKey}:${event.status}`)).toEqual(["start:simulated", "intro:simulated", "lead_closed:ended"]);
    expect(run.terminal).toMatchObject({ stageKey: "lead_closed", outcome: "lost" });
    expect(run.events.at(-1)).toMatchObject({ selectedUserIds: [], terminalOutcome: "lost" });
  });
  it("a follow-up loop keeps visit numbers, then reaches the shared Lead Closed", () => {
    const run = simulateFmsDefinition(funnel(), { starterId: userId, answers: answers(["intro", ["follow_up", "follow_up"]], ["f1", ["continue", "lost"]], ["f2", ["continue"]], ["f3", ["intro"]]) });
    expect(run.events.map((event) => `${event.stageKey}#${event.visit}`)).toEqual(["start#1", "intro#1", "f1#1", "f2#1", "f3#1", "intro#2", "f1#2", "lead_closed#1"]);
    expect(run.terminal?.outcome).toBe("lost");
  });
  it("Order & Payment -> Sales Closed is won", () => {
    const run = simulateFmsDefinition(funnel(), { starterId: userId, answers: answers(["intro", ["interested"]], ["demo", ["order"]], ["order", ["paid"]]) });
    expect(run.terminal).toMatchObject({ stageKey: "sales_closed", outcome: "won" });
  });
  it("a parallel branch reaching an End Node ends the whole run", () => {
    const definition: FmsFlowDefinition = { name: "Parallel", scope: "tenant", manualTrigger: true, stages: [
      step("start", 0, { defaultNextStageKey: "split" }),
      { ...fmsStageTemplate("parallel_start", 1, () => "p"), key: "split", name: "Split", parallelTargetStageKeys: ["a", "b"] },
      step("a", 2, { defaultNextStageKey: "closed" }), step("b", 3, { defaultNextStageKey: "b2" }), step("b2", 4), end("closed", 5, "other"),
    ] };
    const run = simulateFmsDefinition(definition, { starterId: userId, answers: {} });
    expect(run.terminal).toMatchObject({ stageKey: "closed" });
    // Like the server, work still queued when the End Node is reached never starts.
    expect(run.terminal?.stoppedStageKeys).toEqual(["b2"]);
    expect(run.events.some((event) => event.stageKey === "b2")).toBe(false);
  });
});

describe("FMS outcome reports", () => {
  const report = { period: { from: null, to: null }, started: 100, running: 40, onHold: 0, completed: 60, cancelled: 0, won: 30, lost: 20, doNotContact: 10, other: 0, unspecified: 0,
    conversionPercent: 30, endNodes: [{ stageKey: "sales_closed", name: "Sales Closed", outcome: "won", instances: 30 }], stages: [{ stageKey: "intro", name: "Introduction", type: "form", instances: 100, visits: 104 }],
    completedInPeriod: { completed: 60, won: 30, lost: 20, doNotContact: 10, other: 0, unspecified: 0 } };
  it("decodes a consistent report", () => expect(decodeFmsFlowReport(report).conversionPercent).toBe(30));
  it("refuses totals that do not add up", () => expect(() => decodeFmsFlowReport({ ...report, running: 41 })).toThrow());
  it("computes conversion from won and started", () => {
    expect(fmsConversionPercent(30, 100)).toBe(30);
    expect(fmsConversionPercent(1, 3)).toBe(33.3);
    expect(fmsConversionPercent(5, 0)).toBe(0);
  });
  it("sends only the filters that are set", () => {
    expect(fmsReportFilterJson({ ...defaultFmsReportFilters(), from: "2026-10-01" })).toEqual({ from: "2026-10-01" });
    expect(fmsRecordFilterJson({ ...defaultFmsRecordFilters(), status: "won", query: "  ABC " })).toEqual({ status: "won", query: "ABC" });
    expect(() => fmsReportFilterJson({ ...defaultFmsReportFilters(), from: "2026-10-30", to: "2026-10-01" })).toThrow();
  });
  it("decodes a record page and refuses duplicates", () => {
    const record = { id: "00000000-0000-4000-8000-0000000000aa", reference: "FMS-1", title: "ABC", name: "ABC Customer", status: "completed", outcome: "lost", endStageName: "Lead Closed", closedAt: null, startedAt: null, updatedAt: null, version: 1, overdue: false, current: [] };
    expect(decodeFmsFlowRecords({ total: 1, records: [record] }).records[0]?.outcome).toBe("lost");
    expect(() => decodeFmsFlowRecords({ total: 2, records: [record, record] })).toThrow();
  });
  it("turns a persisted journey into readable lines with visit numbers and the ending", () => {
    const visit = (id: string, stageKey: string, visitNumber: number, patch: Record<string, unknown> = {}) => ({ id: `00000000-0000-4000-8000-0000000000${id}`, stageKey, stageName: stageKey, stageType: "form", visitNumber, status: "completed", outcome: null, remark: null,
      stopped: false, skipped: false, activatedAt: null, completedAt: null, dueAt: null, completedBy: "Asha", assignees: [], formName: null, submittedAt: null, routeLabel: null, nextStages: [], answers: [], events: [], ...patch });
    const journey = decodeFmsJourney({ instance: { id: "00000000-0000-4000-8000-0000000000ff", reference: "FMS-9", title: "XYZ", name: "XYZ Customer", status: "completed", version: 1, workflowName: "Funnel", startedAt: null, completedAt: null, startedBy: null, cancelledAt: null, cancelReason: null, holdReason: null },
      outcome: { stageName: "Lead Closed", outcome: "lost", reasonCode: null, closedAt: "2026-10-30T10:00:00Z", routeLabel: null, sourceStageName: "F1", sourceQuestion: "Client status", sourceValue: "Not interested", stoppedCount: 0, closedBy: null },
      visits: [visit("01", "f1", 1, { answers: [{ label: "Client status", value: "follow up" }] }), visit("02", "f1", 2), { ...visit("03", "Lead Closed", 1), stageType: "end" }] });
    const lines = fmsJourneyLines(journey);
    expect(lines.map((line) => line.title)).toEqual(["f1 (visit 1)", "f1 (visit 2)", "Lead Closed"]);
    expect(lines[0]?.detail).toContain("Client status: follow up");
    expect(lines[2]).toMatchObject({ tone: "end", detail: ["Workflow ended automatically", "Final outcome: Lost"] });
  });
});

describe("turning a last step into an End Node", () => {
  it("keeps the key, name and incoming routes, drops the work, and guesses the End type from the name", () => {
    const lost = step("lost_sale", 9, { name: "Lost Sale", checklist: [{ key: "a", label: "A", required: true }], requiresRemark: true });
    const converted = convertFmsStageToEnd(lost);
    expect(converted).toMatchObject({ key: "lost_sale", name: "Lost Sale", type: "end", assigneeRules: [], checklist: [], requiresRemark: false, sla: { deadlineEnabled: false, terminal: { outcome: "lost" } } });
    expect(converted.formTemplateId).toBeUndefined();
    const definition = { ...funnel(), stages: [...funnel().stages.map((item) => item.key === "intro" ? { ...item, branchRules: [...item.branchRules, route("gone", "lost_sale", 4)] } : item), converted] };
    expect(validateFmsDefinition(definition, fields)).toEqual([]);
  });
  it("suggests outcomes from common names", () => {
    expect(suggestFmsTerminalOutcome("Sales Closure")).toBe("won");
    expect(suggestFmsTerminalOutcome("Lost Sale")).toBe("lost");
    expect(suggestFmsTerminalOutcome("Lead Closed / Not interested")).toBe("lost");
    expect(suggestFmsTerminalOutcome("Do Not Contact")).toBe("do_not_contact");
    expect(suggestFmsTerminalOutcome("Archive")).toBe("other");
  });
  it("turns an End Node back into an ordinary step", () => {
    const back = convertFmsEndToStage(end("closing", 3, "won"), fmsStageTemplate("task", 3, () => "x"));
    expect(back).toMatchObject({ key: "closing", type: "task", sla: { deadlineEnabled: false } });
    expect(back.sla.terminal).toBeUndefined();
  });
});
