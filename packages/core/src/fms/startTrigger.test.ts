import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FMS_TRIGGER_SOURCES, describeFmsStartTrigger, evaluateFmsTriggerConditions, fmsTriggerContext, fmsTriggerDue, fmsTriggerFieldTypeForQuestion,
  fmsTriggerRuleMatches, fmsTriggerSource, fmsTriggerTitle, newFmsStartTrigger, parseFmsStartTrigger, validateFmsStartTrigger,
  type FmsStartTrigger, type FmsTriggerFieldType, type FmsTriggerGroup,
} from "./startTrigger.ts";
import { validateFmsDefinition } from "./engine.ts";
import { simulateFmsDefinition } from "./simulation.ts";
import { fmsStageNeedsAssignment } from "./assignmentAuthoring.ts";
import type { FmsFlowDefinition, FmsStageDefinition } from "./types.ts";

const TODAY = "2026-11-03";
const walkin = fmsTriggerSource("crm_walkin")!;
const typeOf = (key: string): FmsTriggerFieldType => walkin.fields.find((field) => field.key === key)?.type ?? "text";
let next = 0;
const id = () => `n${(next += 1)}`;

describe("trigger rules (same cases as the 0374 pgTAP file)", () => {
  const cases: Array<[string, Parameters<typeof fmsTriggerRuleMatches>[0], unknown, FmsTriggerFieldType, boolean]> = [
    ["equals ignores case", { operator: "equals", value: "NO" }, "no", "choice", true],
    ["equals refuses another value", { operator: "equals", value: "NO" }, "YES", "choice", false],
    ["a missing answer never equals", { operator: "equals", value: "NO" }, undefined, "choice", false],
    ["a missing answer is not equal", { operator: "not_equals", value: "NO" }, undefined, "choice", true],
    ["blank text is empty", { operator: "is_empty" }, "  ", "text", true],
    ["an empty list is empty", { operator: "is_empty" }, [], "multi_choice", true],
    ["contains matches a list item", { operator: "contains", value: "Price" }, ["Design", "PRICE"], "multi_choice", true],
    ["does not contain", { operator: "not_contains", value: "Price" }, ["Design"], "multi_choice", true],
    ["is one of", { operator: "in", value: ["NO", "PRICE_CALCULATION"] }, "price_calculation", "choice", true],
    ["number greater than", { operator: "greater_than", value: 0 }, 2, "number", true],
    ["a list counts as its length", { operator: "greater_than", value: 0 }, ["a", "b"], "number", true],
    ["a non-number never compares", { operator: "greater_than", value: "x" }, 2, "number", false],
    ["date on or after today", { operator: "greater_than_or_equal", value: "today" }, "2026-11-03", "date", true],
    ["date-time compares by date", { operator: "less_than", value: "2026-12-01" }, "2026-11-30T10:00:00", "date", true],
    ["yes is true", { operator: "equals", value: true }, "yes", "boolean", true],
    ["number equality across text", { operator: "equals", value: "5" }, 5, "number", true],
  ];
  it.each(cases)("%s", (_name, rule, actual, type, expected) => {
    expect(fmsTriggerRuleMatches(rule, actual, type, TODAY)).toBe(expected);
  });
});

describe("condition groups", () => {
  const tree: FmsTriggerGroup = {
    id: "g", kind: "group", combinator: "and", enabled: true, children: [
      { id: "a", kind: "rule", field: "visit_status", operator: "equals", value: "NO", enabled: true },
      { id: "g2", kind: "group", combinator: "or", enabled: true, children: [
        { id: "b", kind: "rule", field: "product_requirement", operator: "not_empty", enabled: true },
        { id: "c", kind: "rule", field: "seen_count", operator: "greater_than", value: 0, enabled: true },
      ] },
    ],
  };
  it("matches Visit Status = NO AND (requirement OR products seen)", () => {
    expect(evaluateFmsTriggerConditions(tree, { visit_status: "NO", seen_count: 2 }, typeOf, TODAY).matched).toBe(true);
    expect(evaluateFmsTriggerConditions(tree, { visit_status: "NO", seen_count: 0 }, typeOf, TODAY).matched).toBe(false);
    expect(evaluateFmsTriggerConditions(tree, { visit_status: "YES", product_requirement: "Ring" }, typeOf, TODAY).matched).toBe(false);
  });
  it("explains each rule", () => {
    const result = evaluateFmsTriggerConditions(tree, { visit_status: "NO", seen_count: 0 }, typeOf, TODAY);
    expect(result.rules.map((rule) => [rule.id, rule.passed])).toEqual([["a", true], ["b", false], ["c", false]]);
  });
  it("skips disabled rules and empty groups; nothing enabled never matches", () => {
    const partly: FmsTriggerGroup = { ...tree, children: [tree.children[0]!, { id: "x", kind: "rule", field: "visit_status", operator: "equals", value: "YES", enabled: false }, { id: "e", kind: "group", combinator: "or", enabled: true, children: [] }] };
    expect(evaluateFmsTriggerConditions(partly, { visit_status: "NO" }, typeOf, TODAY).matched).toBe(true);
    expect(evaluateFmsTriggerConditions({ ...tree, children: [] }, {}, typeOf, TODAY).matched).toBe(false);
  });
});

describe("validation", () => {
  const notBought = newFmsStartTrigger("crm_walkin", id);
  it("accepts the default Not Bought trigger", () => {
    expect(validateFmsStartTrigger(notBought, walkin.fields, "task")).toEqual([]);
  });
  it("refuses a trigger without switched-on conditions", () => {
    const off: FmsStartTrigger = { ...notBought, conditions: { ...notBought.conditions, children: notBought.conditions.children.map((rule) => ({ ...rule, enabled: false })) } };
    expect(validateFmsStartTrigger(off, walkin.fields).map((issue) => issue.code)).toContain("trigger_no_rules");
  });
  it("refuses unknown fields, removed options, wrong operators and a phone field", () => {
    const rule = (field: string, operator: string, value?: unknown) => ({ ...notBought, conditions: { ...notBought.conditions, children: [{ id: "r", kind: "rule" as const, field, operator: operator as never, value: value as never, enabled: true }] } });
    expect(validateFmsStartTrigger(rule("phone", "equals", "1"), walkin.fields).map((issue) => issue.code)).toContain("trigger_field_missing");
    expect(validateFmsStartTrigger(rule("visit_status", "equals", "MAYBE"), walkin.fields).map((issue) => issue.code)).toContain("trigger_option_missing");
    expect(validateFmsStartTrigger(rule("seen_count", "contains", "1"), walkin.fields).map((issue) => issue.code)).toContain("trigger_operator");
    expect(validateFmsStartTrigger(rule("next_visit_date", "greater_than", "soon"), walkin.fields).map((issue) => issue.code)).toContain("trigger_value");
  });
  it("refuses deep nesting, reserved context keys and a non-date deadline", () => {
    const deep: FmsTriggerGroup = { id: "1", kind: "group", combinator: "and", enabled: true, children: [{ id: "2", kind: "group", combinator: "and", enabled: true, children: [{ id: "3", kind: "group", combinator: "and", enabled: true, children: [{ id: "4", kind: "group", combinator: "and", enabled: true, children: [{ id: "5", kind: "group", combinator: "and", enabled: true, children: [{ id: "6", kind: "rule", field: "visit_status", operator: "equals", value: "NO", enabled: true }] }] }] }] }] };
    expect(validateFmsStartTrigger({ ...notBought, conditions: deep }, walkin.fields).map((issue) => issue.code)).toContain("trigger_too_deep");
    expect(validateFmsStartTrigger({ ...notBought, mapping: [{ key: "status", label: "Status", field: "visit_status" }] }, walkin.fields).map((issue) => issue.code)).toContain("trigger_mapping");
    expect(validateFmsStartTrigger({ ...notBought, dueField: "client_name" }, walkin.fields).map((issue) => issue.code)).toContain("trigger_due");
    expect(validateFmsStartTrigger(notBought, walkin.fields, "end").map((issue) => issue.code)).toContain("trigger_first_stage");
  });
});

describe("mapping, title and deadline", () => {
  const trigger = newFmsStartTrigger("crm_walkin", id);
  const answers = { client_name: "Synthetic Client", client_code: "MKC-77", visit_date: "2026-11-03", visit_status: "NO", not_bought_reasons: ["Price", "Design"], product_requirement: " ", next_visit_date: "2026-11-10" };
  it("copies mapped values and skips blanks", () => {
    expect(fmsTriggerContext(trigger, answers)).toEqual({ client_code: "MKC-77", visit_date: "2026-11-03", visit_status: "NO", not_bought_reason: "Price, Design", next_visit_date: "2026-11-10" });
    expect(fmsTriggerContext({ ...trigger, mapping: [{ key: "requirement", label: "Requirement", field: "product_requirement", fallback: "Not given" }] }, answers)).toEqual({ requirement: "Not given" });
  });
  it("titles the run from the client name", () => {
    expect(fmsTriggerTitle(trigger, answers, "NOT BOUGHT FOLLOW-UP")).toBe("NOT BOUGHT FOLLOW-UP · Synthetic Client");
    expect(fmsTriggerTitle(trigger, {}, "NOT BOUGHT FOLLOW-UP")).toBe("NOT BOUGHT FOLLOW-UP");
  });
  it("uses the next visit date at 9 PM India time, never a past date", () => {
    expect(fmsTriggerDue(trigger, answers, new Date("2026-11-03T06:00:00Z"))?.toISOString()).toBe("2026-11-10T15:30:00.000Z");
    expect(fmsTriggerDue(trigger, { next_visit_date: "2026-10-01" }, new Date("2026-11-03T06:00:00Z"))).toBeNull();
    expect(fmsTriggerDue(trigger, {}, new Date("2026-11-03T06:00:00Z"))).toBeNull();
  });
  it("describes the trigger for the canvas", () => {
    expect(describeFmsStartTrigger(trigger, walkin.fields, "Not bought follow-up")).toEqual(["WHEN CRM WALK-IN VISIT IS SAVED", "IF VISIT STATUS (BOUGHT?) = NO", "START NOT BOUGHT FOLLOW-UP"]);
  });
  it("parses only well-formed stored triggers", () => {
    expect(parseFmsStartTrigger(null)).toBeUndefined();
    expect(parseFmsStartTrigger({ source: { type: "fax" } })).toBeUndefined();
    expect(parseFmsStartTrigger(JSON.parse(JSON.stringify(trigger)))).toEqual(JSON.parse(JSON.stringify(trigger)));
  });
  it("never offers phones or files as trigger fields", () => {
    expect(fmsTriggerFieldTypeForQuestion("phone")).toBeNull();
    expect(fmsTriggerFieldTypeForQuestion("file")).toBeNull();
    expect(fmsTriggerFieldTypeForQuestion("checkbox", true)).toBe("multi_choice");
    expect(fmsTriggerFieldTypeForQuestion("checkbox", false)).toBe("boolean");
  });
});

describe("workflows without a starting form", () => {
  const stage = (key: string, type: FmsStageDefinition["type"], order: number, nextKey?: string): FmsStageDefinition => ({
    key, name: key, type, order, required: true, completionRule: type === "approval" ? "manager_approval" : "any_doer", allowMultipleDoers: false, requiresUpload: false, requiresRemark: false,
    checklist: [], assigneeRules: [], requiresNextDoerHandoff: false, canMoveBackward: false, canReject: false, canRequestRevision: false, canEscalate: false,
    defaultNextStageKey: nextKey, branchRules: [], parallelTargetStageKeys: [], joinRequiredStageKeys: [], sla: { timingMethod: "tat_hours", tatMinutes: 60 } as never,
  });
  const base: FmsFlowDefinition = { name: "Not bought", scope: "tenant", manualTrigger: true, stages: [stage("follow_1", "task", 0, "follow_2"), stage("follow_2", "task", 1)] };
  const codes = (flow: FmsFlowDefinition) => validateFmsDefinition(flow).map((issue) => issue.code);
  it("keeps the starting Form rule for form-started workflows", () => {
    expect(codes(base)).toContain("first_stage_must_be_form");
  });
  it("lets automatic and manual workflows begin with a Task", () => {
    expect(codes({ ...base, startMode: "automatic", startTrigger: newFmsStartTrigger("crm_walkin", id) })).not.toContain("first_stage_must_be_form");
    expect(codes({ ...base, startMode: "manual" })).not.toContain("missing_form");
  });
  it("refuses an End Node first even without a form", () => {
    expect(codes({ ...base, startMode: "manual", stages: [stage("done", "end", 0)] })).toContain("invalid_first_stage");
  });
  it("assigns the first step by its own strategy", () => {
    expect(fmsStageNeedsAssignment(base.stages, "follow_1")).toBe(false);
    expect(fmsStageNeedsAssignment(base.stages, "follow_1", "automatic")).toBe(true);
  });
  it("simulates the trigger assignee without creating anything", () => {
    const flow: FmsFlowDefinition = { ...base, startMode: "automatic" };
    const result = simulateFmsDefinition(flow, { answers: {}, triggerAssigneeId: "sales-1" });
    expect(result.events[0]).toMatchObject({ stageKey: "follow_1", selectedUserId: "sales-1" });
  });
});

describe("parity with migration 0374", () => {
  const sql = readFileSync(fileURLToPath(new URL("../../../../supabase/migrations/0374_fms_start_triggers.sql", import.meta.url)), "utf8");
  const rows = [...sql.matchAll(/\('(crm_walkin|crm_queue|crm_lead|crm_linked_form|jewelos_form)','([a-z_]+)','([a-z_]+)',array\[([^\]]*)\]/g)]
    .map(([, source, key, type, options]) => ({ source, key, type, options: (options ?? "").split(",").map((item) => item.trim().replace(/^'|'$/g, "")).filter(Boolean) }));
  it("has the same fields, types and option values for every source", () => {
    const fromCore = FMS_TRIGGER_SOURCES.flatMap((source) => source.fields.map((field) => ({ source: source.type, key: field.key, type: field.type, options: (field.options ?? []).map((option) => option.value) })));
    const sort = (list: typeof rows) => [...list].sort((a, b) => `${a.source}.${a.key}`.localeCompare(`${b.source}.${b.key}`));
    expect(sort(rows)).toEqual(sort(fromCore));
  });
});
