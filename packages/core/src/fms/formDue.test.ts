import { describe, expect, it } from "vitest";
import { normalizeFmsDefinition, validateFmsDefinition } from "./engine";
import { fmsAutoDueDateFields, fmsAutoFormDueApplies, fmsDueUrgency, fmsFormDueIssues, isFmsDueDateQuestion, fmsFormDueSummary, fmsIncomingFormStages, normalizeFmsFormDue, suggestFmsDueSource } from "./formDue";
import { decodeFmsBoard, fmsBoardColumns, fmsWorkspaceFilter, defaultFmsWorkspaceFilters, decodeFmsRecords } from "./taskWorkspace";
import { createFmsFragment, parseFmsTransfer } from "./transfer";
import type { FmsFlowDefinition, FmsFormFieldRef, FmsStageDefinition } from "./types";

const stage = (key: string, order: number, patch: Partial<FmsStageDefinition> = {}): FmsStageDefinition => ({
  key, name: key.toUpperCase(), type: "form", order, required: true, completionRule: "any_doer", allowMultipleDoers: false, requiresUpload: false, requiresRemark: false,
  checklist: [], assigneeRules: [], requiresNextDoerHandoff: false, canMoveBackward: false, canReject: false, canRequestRevision: false, canEscalate: false,
  branchRules: [], parallelTargetStageKeys: [], joinRequiredStageKeys: [], formTemplateId: "11111111-1111-4111-8111-111111111111", sla: { dueDate: "", deadlineEnabled: false }, ...patch,
});
const fields: FmsFormFieldRef[] = [
  { key: "status", label: "Client status", type: "text" },
  { key: "next_date", label: "Next Follow-up Date", type: "date" },
  { key: "next_time", label: "Follow-up Time", type: "text" },
];
const flow = (stages: FmsStageDefinition[]): FmsFlowDefinition => ({ name: "Funnel", scope: "tenant", manualTrigger: true, stages });

describe("due date from a form answer", () => {
  it("suggests the only clearly named date question, with its time question", () => {
    expect(suggestFmsDueSource("intro", fields)).toEqual({ stageKey: "intro", dateFieldKey: "next_date", timeFieldKey: "next_time" });
    expect(suggestFmsDueSource("demo", [{ key: "meet", label: "Next Meeting Date and Time", type: "datetime" }])).toEqual({ stageKey: "demo", dateFieldKey: "meet" });
  });
  it("never guesses between several date questions or an unclear name", () => {
    expect(suggestFmsDueSource("intro", [...fields, { key: "dob", label: "Date of birth", type: "date" }])).toBeUndefined();
    expect(suggestFmsDueSource("intro", [{ key: "dob", label: "Date of birth", type: "date" }])).toBeUndefined();
  });
  it("finds every form step that can lead to a step, through automatic steps", () => {
    const stages = [stage("intro", 0, { branchRules: [{ id: "r", source: "form_answer", operator: "equals", value: "x", nextStageKey: "f1", order: 0 }], defaultNextStageKey: "demo" }),
      stage("demo", 1, { defaultNextStageKey: "split" }), stage("split", 2, { type: "branch", formTemplateId: undefined, defaultNextStageKey: "f1" }), stage("f1", 3)];
    expect(fmsIncomingFormStages({ stages }, "f1").map((item) => item.key).sort()).toEqual(["demo", "intro"]);
  });
  it("normalizes and survives the definition normalizer and import", () => {
    const rule = { sources: [{ stageKey: "INTRO", dateFieldKey: "next_date", timeFieldKey: "" }], onMissing: "require", defaultTime: "25:00" };
    expect(normalizeFmsFormDue(rule)).toEqual({ sources: [{ stageKey: "intro", dateFieldKey: "next_date" }], onMissing: "require" });
    const normalized = normalizeFmsDefinition(flow([stage("intro", 0), stage("f1", 1, { sla: { dueDate: "", formDue: { sources: [{ stageKey: "intro", dateFieldKey: "next_date" }], onMissing: "none" } } })]));
    expect(normalized.stages[1]!.sla.formDue).toEqual({ sources: [{ stageKey: "intro", dateFieldKey: "next_date" }], onMissing: "none" });
    const fragment = createFmsFragment(flow([stage("intro", 0), stage("f1", 1, { sla: { dueDate: "", formDue: { sources: [{ stageKey: "intro", dateFieldKey: "next_date" }], onMissing: "fallback" } } })]), ["intro", "f1"], new Map());
    const imported = parseFmsTransfer(JSON.stringify(fragment));
    expect(imported.stages.find((item) => item.key === "f1")!.sla.formDue).toEqual({ sources: [{ stageKey: "intro", dateFieldKey: "next_date" }], onMissing: "fallback" });
  });
  it("skips the fallback timing check only when there is no fallback", () => {
    const base = [stage("intro", 0, { defaultNextStageKey: "f1" })];
    const noFallback = flow([...base, stage("f1", 1, { sla: { dueDate: "", timingMethod: "completion_date", formDue: { sources: [{ stageKey: "intro", dateFieldKey: "next_date" }], onMissing: "none" } } })]);
    expect(validateFmsDefinition(noFallback).filter((issue) => issue.code === "invalid_deadline")).toEqual([]);
    const withFallback = flow([...base, stage("f1", 1, { sla: { dueDate: "", timingMethod: "completion_date", formDue: { sources: [{ stageKey: "intro", dateFieldKey: "next_date" }], onMissing: "fallback" } } })]);
    expect(validateFmsDefinition(withFallback).some((issue) => issue.code === "invalid_deadline")).toBe(true);
  });
  it("reports missing questions, the first step and duplicates like the server", () => {
    const def = flow([stage("intro", 0), stage("f1", 1)]);
    const rule = (sources: { stageKey: string; dateFieldKey: string; timeFieldKey?: string }[]) => ({ ...def.stages[1]!, sla: { dueDate: "", formDue: { sources, onMissing: "none" as const } } });
    const lookup = { "11111111-1111-4111-8111-111111111111": fields };
    expect(fmsFormDueIssues(def, rule([{ stageKey: "intro", dateFieldKey: "next_date", timeFieldKey: "next_time" }]), 1, lookup)).toEqual([]);
    expect(fmsFormDueIssues(def, rule([{ stageKey: "intro", dateFieldKey: "status" }]), 1, lookup)).toEqual(["Choose a date question from INTRO"]);
    expect(fmsFormDueIssues(def, rule([]), 1, lookup)).toContain("Choose the earlier step and the date question for the due date");
    expect(fmsFormDueIssues(def, rule([{ stageKey: "intro", dateFieldKey: "next_date" }, { stageKey: "intro", dateFieldKey: "next_date" }]), 1, lookup)).toContain("Choose one due-date question per earlier step");
    expect(fmsFormDueIssues(def, rule([{ stageKey: "intro", dateFieldKey: "next_date" }]), 0, lookup)).toContain("The first step has no earlier form to take a due date from");
    expect(fmsFormDueSummary(def, { sources: [{ stageKey: "intro", dateFieldKey: "next_date", timeFieldKey: "next_time" }], onMissing: "none" }, lookup)).toBe("From form · Next Follow-up Date + Follow-up Time");
  });
});

describe("automatic due date from the previous form", () => {
  it("reads follow-up, next and appointment questions, never past events", () => {
    for (const label of ["NEXT FOLLOW UP DATE", "APPOINTMENT IS SET FOR", "Follow-up date", "Call back date"]) expect(isFmsDueDateQuestion(label)).toBe(true);
    for (const label of ["DM RECEIVED DATE", "Date of birth", "Last visit date", "Order date"]) expect(isFmsDueDateQuestion(label)).toBe(false);
    expect(fmsAutoDueDateFields([{ key: "dm", label: "DM RECEIVED DATE", type: "date" }, { key: "next", label: "NEXT FOLLOW UP DATE", type: "date" }, { key: "note", label: "Next step", type: "text" }]).map((field) => field.key)).toEqual(["next"]);
  });
  it("applies only to a person's step without its own deadline, unless turned off", () => {
    expect(fmsAutoFormDueApplies(stage("f1", 1))).toBe(true);
    expect(fmsAutoFormDueApplies(stage("f1", 1, { sla: { dueDate: "", deadlineEnabled: false, autoFormDue: false } }))).toBe(false);
    expect(fmsAutoFormDueApplies(stage("f1", 1, { sla: { dueDate: "", deadlineEnabled: true, timingMethod: "tat_hours", tatMinutes: 60 } }))).toBe(false);
    expect(fmsAutoFormDueApplies(stage("f1", 1, { sla: { dueDate: "", deadlineEnabled: false, formDue: { sources: [], onMissing: "none" } } }))).toBe(false);
    expect(fmsAutoFormDueApplies(stage("end", 1, { type: "end" }))).toBe(false);
  });
  it("keeps the off switch through the normalizer and import", () => {
    const definition = flow([stage("intro", 0), stage("f1", 1, { sla: { dueDate: "", deadlineEnabled: false, autoFormDue: false } })]);
    expect(normalizeFmsDefinition(definition).stages[1]!.sla.autoFormDue).toBe(false);
    expect(normalizeFmsDefinition(flow([stage("intro", 0), stage("f1", 1)])).stages[1]!.sla.autoFormDue).toBeUndefined();
    const imported = parseFmsTransfer(JSON.stringify(createFmsFragment(definition, ["intro", "f1"], new Map())));
    expect(imported.stages.find((item) => item.key === "f1")!.sla.autoFormDue).toBe(false);
  });
});

describe("due urgency", () => {
  const now = new Date("2026-11-05T09:00:00Z"); // 2:30 PM in India
  it("classifies overdue, due today, upcoming and no deadline in India time", () => {
    expect(fmsDueUrgency("2026-11-05T08:59:00Z", now)).toBe("overdue");
    expect(fmsDueUrgency("2026-11-05T10:00:00Z", now)).toBe("today"); // 3:30 PM IST
    expect(fmsDueUrgency("2026-11-05T18:29:59Z", now)).toBe("today"); // 11:59 PM IST
    expect(fmsDueUrgency("2026-11-05T18:30:00Z", now)).toBe("upcoming"); // midnight IST
    expect(fmsDueUrgency(null, now)).toBe("none");
  });
});

describe("board contract", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const card = (n: number, urgency = "overdue") => ({ id: id(n), name: `Lead ${n}`, reference: `R-${n}`, description: "", dueAt: "2026-11-05T10:00:00Z", status: "pending", visitNumber: 1,
    priority: "high", urgency, assignees: [{ id: id(90), name: "Riya Mahto" }], target: { kind: "stage", instanceId: id(50 + n), instanceStageId: id(n) } });
  const stageRow = (n: number, patch: Record<string, unknown> = {}) => ({ id: `${id(n)}:stage`, flowId: id(99), stageId: id(n), name: `Step ${n}`, version: 1, stepType: "form", count: 0, overdue: 0, dueToday: 0,
    pipeline: "", order: n, starting: false, nextStageIds: [], records: [], ...patch });
  const board = { name: "Funnel", counts: { active: 2, overdue: 1, dueToday: 1, upcoming: 0, noDue: 0, waiting: 0, completed: 0, shown: 2 },
    stages: [stageRow(1, { count: 2, overdue: 1, dueToday: 1, nextStageIds: [id(2)], records: [card(11), card(12, "today")] }), stageRow(2, { stepType: "end" }), stageRow(3, { stepType: "branch" }), stageRow(4)] };
  it("decodes exact counts and cards and keeps only person's steps as columns", () => {
    const decoded = decodeFmsBoard(board);
    expect(decoded.stages[0]!.records.map((record) => [record.urgency, record.priority, record.assignees[0]!.name])).toEqual([["overdue", "high", "Riya Mahto"], ["today", "high", "Riya Mahto"]]);
    expect(fmsBoardColumns(decoded).map((column) => column.name)).toEqual(["Step 1", "Step 4"]);
  });
  it("refuses inconsistent counts, more cards than the count, and duplicate cards", () => {
    expect(() => decodeFmsBoard({ ...board, counts: { ...board.counts, overdue: 2 } })).toThrow();
    expect(() => decodeFmsBoard({ ...board, stages: [stageRow(1, { count: 1, records: [card(11), card(12)] })] })).toThrow();
    expect(() => decodeFmsBoard({ ...board, stages: [stageRow(1, { count: 1, records: [card(11)] }), stageRow(2, { count: 1, records: [card(11)] })] })).toThrow();
  });
  it("older pages without the new fields still decode", () => {
    const old = decodeFmsRecords({ total: 1, records: [{ ...card(11), priority: undefined, urgency: undefined, assignees: undefined, dueAt: null }] });
    expect(old.records[0]).toMatchObject({ priority: null, urgency: "none", assignees: [] });
  });
  it("sends board filters only when they narrow or reorder", () => {
    expect(fmsWorkspaceFilter({ ...defaultFmsWorkspaceFilters(), scope: "mine", due: "all", priority: "all", sort: "due" })).toEqual(defaultFmsWorkspaceFilters());
    expect(fmsWorkspaceFilter({ ...defaultFmsWorkspaceFilters(), scope: "all", due: "today", priority: "high", sort: "priority", assigneeId: id(1) }))
      .toMatchObject({ scope: "all", due: "today", priority: "high", sort: "priority", assigneeId: id(1) });
    expect(() => fmsWorkspaceFilter({ ...defaultFmsWorkspaceFilters(), assigneeId: "riya" })).toThrow();
  });
});
