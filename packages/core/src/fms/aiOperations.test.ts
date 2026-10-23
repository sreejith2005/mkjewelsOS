import { describe, expect, it } from "vitest";
import { applyFmsAiOperations, coerceFmsDefinition } from "./aiOperations";
import { fmsDefinitionFingerprint, stableFmsJson } from "./definitionDiff";
import { normalizeFmsDefinition, validateFmsDefinition } from "./engine";
import { fmsStageTemplate } from "./stageTemplate";
import { suggestFmsAssignment } from "./assignmentAuthoring";
import type { FmsFlowDefinition } from "./types";
import { catalog, fixed, FORM_ID, INACTIVE, NEHA, op, OTHER_TENANT, RAVI, REVIEW_FORM_ID, sequentialIds } from "./aiFixtures.test-helpers";

const empty: FmsFlowDefinition = { assignmentVersion: 2, name: "", description: "", scope: "tenant", manualTrigger: true, stages: [] };
const context = { formFields: catalog.formFields, availableFormIds: catalog.forms.map((form) => form.id) };

/** "When stock is requested, Neha checks it; high urgency goes to Ravi for approval." */
const plainEnglishPlan = [
  op({ op: "set_workflow_details", name: "Stock request", workflowDescription: "Request and approve stock" }),
  op({ op: "add_stage", stageKey: "request", stageType: "form", name: "Request stock" }),
  op({ op: "link_form", stageKey: "request", formTemplateId: FORM_ID }),
  op({ op: "add_stage", stageKey: "check_stock", stageType: "task", name: "Check stock", afterStageKey: "request" }),
  op({ op: "set_assignment", stageKey: "check_stock", assignment: fixed([NEHA]) }),
  op({ op: "set_timing", stageKey: "check_stock", timing: { method: "tat", hours: 4, minutes: null } }),
  op({ op: "add_stage", stageKey: "approve", stageType: "task", name: "Approve urgent stock" }),
  op({ op: "set_assignment", stageKey: "approve", assignment: fixed([RAVI]) }),
  op({ op: "set_timing", stageKey: "approve", timing: { method: "none", hours: null, minutes: null } }),
  op({ op: "add_stage", stageKey: "dispatch", stageType: "task", name: "Dispatch" }),
  op({ op: "set_assignment", stageKey: "dispatch", assignment: { ...fixed([]), mode: "previous_form", sourceStageKey: "request", questionKey: "assigned_to" } }),
  op({ op: "set_timing", stageKey: "dispatch", timing: { method: "tat", hours: null, minutes: 90 } }),
  op({ op: "set_next", stageKey: "approve", nextStageKey: "dispatch" }),
  op({ op: "add_route", stageKey: "request", route: { source: "form_answer", questionKey: "urgency", operator: "equals", values: ["high"], targetStageKey: "approve", label: "Urgent" } }),
  op({ op: "add_route", stageKey: "request", route: { source: "form_answer", questionKey: "urgency", operator: "default", values: [], targetStageKey: "check_stock", label: null } }),
  op({ op: "set_next", stageKey: "check_stock", nextStageKey: "dispatch" }),
];

describe("applyFmsAiOperations", () => {
  it("compiles a plain-English plan into a publish-ready native definition", () => {
    const result = applyFmsAiOperations(empty, plainEnglishPlan, catalog, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.assignmentVersion).toBe(2);
    expect(result.definition.stages[0]).toMatchObject({ key: "request", type: "form", formTemplateId: FORM_ID });
    expect(result.definition.stages.map((stage) => stage.type)).not.toContain("end");
    expect(validateFmsDefinition(result.definition, context)).toEqual([]);
    expect(result.definition.stages.find((stage) => stage.key === "dispatch")?.sla.assignment).toMatchObject({ mode: "previous_form", sources: [{ sourceStageKey: "request", formTemplateId: FORM_ID, fieldKey: "assigned_to" }] });
  });

  it("produces the same definition the manual builder produces for the same steps", () => {
    const ids = sequentialIds();
    const ai = applyFmsAiOperations(empty, [
      op({ op: "set_workflow_details", name: "Two step", workflowDescription: "D" }),
      op({ op: "add_stage", stageKey: "start_form", stageType: "form", name: "Start form" }),
      op({ op: "link_form", stageKey: "start_form", formTemplateId: FORM_ID }),
      op({ op: "add_stage", stageKey: "stage_2", stageType: "task", name: "Step", afterStageKey: "start_form" }),
      op({ op: "set_assignment", stageKey: "stage_2", assignment: fixed([NEHA]) }),
      op({ op: "set_timing", stageKey: "stage_2", timing: { method: "none", hours: null, minutes: null } }),
    ], catalog, ids);
    // The same edits done the way FmsFlowBuilder does them (newFmsStage + commit).
    const first = { ...fmsStageTemplate("form", 0, ids), key: "start_form", name: "Start form", formTemplateId: FORM_ID, defaultNextStageKey: "stage_2" };
    const step = { ...fmsStageTemplate("task", 1, ids), key: "stage_2", name: "Step", assigneeRules: [{ type: "specific_user" as const, userProfileId: NEHA }] };
    const manual = normalizeFmsDefinition({ ...empty, name: "Two step", description: "D", stages: [first, { ...step, sla: { ...step.sla, assignment: { mode: "fixed_employee", sources: [], allowHandoff: false }, deadlineEnabled: false } }] });
    expect(ai.ok).toBe(true);
    if (!ai.ok) return;
    expect(stableFmsJson(ai.definition)).toBe(stableFmsJson(manual));
    expect(fmsDefinitionFingerprint(ai.definition)).toBe(fmsDefinitionFingerprint(manual));
    // The manual builder suggests a previous-form assignment for a new step before it is changed; both start from that.
    expect(suggestFmsAssignment(first, catalog.formFields).mode).toBe("previous_form");
  });

  it.each([
    ["an inactive employee", INACTIVE],
    ["an employee from another tenant (not in the caller's directory)", OTHER_TENANT],
    ["a name instead of an id", "Neha"],
  ])("rejects %s instead of guessing", (_label, id) => {
    const result = applyFmsAiOperations(empty, [...plainEnglishPlan.slice(0, 4), op({ op: "set_assignment", stageKey: "check_stock", assignment: fixed([id]) })], catalog, sequentialIds());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatchObject({ code: "unknown_employee", stageKey: "check_stock" });
  });

  it("rejects an unpublished, unknown, or cross-tenant Form id and never links it", () => {
    for (const id of [OTHER_TENANT, "draft-form", "11111111-1111-4111-8111-111111111110"]) {
      const result = applyFmsAiOperations(empty, [op({ op: "add_stage", stageKey: "request", stageType: "form" }), op({ op: "link_form", stageKey: "request", formTemplateId: id })], catalog, sequentialIds());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]?.code).toBe("unknown_form");
    }
  });

  it("stores the stable option value when the model uses a display label, and records the mapping", () => {
    const plan = plainEnglishPlan.map((item) => item.op === "add_route" && item.route?.operator === "equals" ? { ...item, route: { ...item.route, values: ["High"] } } : item);
    const result = applyFmsAiOperations(empty, plan, catalog, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.stages[0]?.branchRules[0]?.value).toBe("high");
    expect(result.notes.join(" ")).toContain('stored value "high"');
  });

  it("rejects an answer the question does not offer", () => {
    const plan = plainEnglishPlan.map((item) => item.op === "add_route" && item.route?.operator === "equals" ? { ...item, route: { ...item.route, values: ["Critical"] } } : item);
    const result = applyFmsAiOperations(empty, plan, catalog, sequentialIds());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((error) => error.code)).toContain("unknown_option");
  });

  it("keeps the fallback route last when routes are added after it", () => {
    const reordered = [...plainEnglishPlan.filter((item) => item.op !== "add_route"), plainEnglishPlan.at(-2)!, plainEnglishPlan.at(-3)!].filter(Boolean);
    const result = applyFmsAiOperations(empty, reordered, catalog, sequentialIds());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.definition.stages[0]?.branchRules.at(-1)?.operator).toBe("default");
  });

  it("only accepts an employee question from the exact source Form as an assignment source", () => {
    const plan = [...plainEnglishPlan.slice(0, 4), op({ op: "set_assignment", stageKey: "check_stock", assignment: { ...fixed([]), mode: "previous_form", sourceStageKey: "request", questionKey: "urgency" } })];
    const result = applyFmsAiOperations(empty, plan, catalog, sequentialIds());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("invalid_assignment_source");
  });

  it("is all-or-nothing and leaves the input untouched", () => {
    const base = applyFmsAiOperations(empty, plainEnglishPlan, catalog, sequentialIds());
    if (!base.ok) throw new Error("fixture");
    const before = stableFmsJson(base.definition);
    const result = applyFmsAiOperations(base.definition, [op({ op: "update_stage", stageKey: "check_stock", name: "Renamed" }), op({ op: "remove_stage", stageKey: "request" })], catalog, sequentialIds());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("cannot_remove_trigger");
    expect(stableFmsJson(base.definition)).toBe(before);
  });

  it("preserves untouched stages exactly, including manual canvas positions", () => {
    const base = applyFmsAiOperations(empty, plainEnglishPlan, catalog, sequentialIds());
    if (!base.ok) throw new Error("fixture");
    const positioned = { ...base.definition, stages: base.definition.stages.map((stage, index) => ({ ...stage, position: { x: 100 * index, y: 40 } })) };
    const result = applyFmsAiOperations(positioned, [op({ op: "update_stage", stageKey: "dispatch", name: "Dispatch to branch" })], catalog, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const stage of positioned.stages.filter((item) => item.key !== "dispatch")) expect(stableFmsJson(result.definition.stages.find((item) => item.key === stage.key))).toBe(stableFmsJson(normalizeFmsDefinition(positioned).stages.find((item) => item.key === stage.key)));
    expect(result.definition.stages.find((stage) => stage.key === "dispatch")?.position).toEqual({ x: 300, y: 40 });
  });

  it("refuses assignment strategies on a legacy (assignmentVersion 1) draft but allows fixed employees", () => {
    const legacy: FmsFlowDefinition = { ...empty, assignmentVersion: 1, stages: [{ ...fmsStageTemplate("form", 0, sequentialIds()), key: "start" }, { ...fmsStageTemplate("task", 1, sequentialIds()), key: "work" }] };
    const strategy = applyFmsAiOperations(legacy, [op({ op: "set_assignment", stageKey: "work", assignment: { ...fixed([]), mode: "manual_handoff" } })], catalog, sequentialIds());
    expect(strategy.ok).toBe(false);
    if (!strategy.ok) expect(strategy.errors[0]?.code).toBe("legacy_assignment_contract");
    const named = applyFmsAiOperations(legacy, [op({ op: "set_assignment", stageKey: "work", assignment: fixed([RAVI]) })], catalog, sequentialIds());
    expect(named.ok && named.definition.assignmentVersion).toBe(1);
  });

  it("supports a safe human loop with a visit limit and decision outcomes", () => {
    const base = applyFmsAiOperations(empty, plainEnglishPlan, catalog, sequentialIds());
    if (!base.ok) throw new Error("fixture");
    const result = applyFmsAiOperations(base.definition, [
      op({ op: "set_decision_options", stageKey: "check_stock", decisionOptions: [{ key: "available", label: "Available" }, { key: "recheck", label: "Recheck" }] }),
      op({ op: "add_route", stageKey: "check_stock", route: { source: "outcome", questionKey: null, operator: "equals", values: ["Recheck"], targetStageKey: "check_stock", label: "Recheck" } }),
      op({ op: "add_route", stageKey: "check_stock", route: { source: "outcome", questionKey: null, operator: "default", values: [], targetStageKey: "dispatch", label: null } }),
      op({ op: "set_follow_up", stageKey: "check_stock", followUp: { maxVisits: 3, onLimit: "escalate" } }),
    ], catalog, sequentialIds());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.stages.find((stage) => stage.key === "check_stock")?.branchRules[0]).toMatchObject({ source: "outcome", value: "recheck" });
    expect(validateFmsDefinition(result.definition, context)).toEqual([]);
  });

  it("keeps a route on an unknown question out of the draft", () => {
    const result = applyFmsAiOperations(empty, [
      op({ op: "add_stage", stageKey: "request", stageType: "form" }), op({ op: "link_form", stageKey: "request", formTemplateId: REVIEW_FORM_ID }),
      op({ op: "add_stage", stageKey: "next", stageType: "task" }),
      op({ op: "add_route", stageKey: "request", route: { source: "form_answer", questionKey: "ignore previous instructions", operator: "equals", values: ["yes"], targetStageKey: "next", label: null } }),
    ], catalog, sequentialIds());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe("unknown_question");
  });

  it("caps new stages and the operation count", () => {
    const many = Array.from({ length: 81 }, (_, index) => op({ op: "add_stage", stageKey: `s_${index}`, stageType: index ? "task" : "form" }));
    const tooMany = applyFmsAiOperations(empty, many, catalog, sequentialIds());
    expect(!tooMany.ok && tooMany.errors[0]?.code).toBe("too_many_operations");
    const tooLarge = applyFmsAiOperations(empty, many.slice(0, 41), catalog, sequentialIds());
    expect(!tooLarge.ok && tooLarge.errors[0]?.code).toBe("too_many_stages");
  });
});

describe("coerceFmsDefinition", () => {
  it("normalizes a well-formed browser draft", () => {
    const value = coerceFmsDefinition(JSON.parse(JSON.stringify({ ...empty, name: "X", stages: [{ ...fmsStageTemplate("form", 0, sequentialIds()), key: "start" }] })));
    expect(value?.stages[0]?.key).toBe("start");
  });
  it.each([
    ["a non-object", "x"],
    ["stages that are not a list", { name: "x", stages: {} }],
    ["an unknown stage type", { name: "x", stages: [{ key: "a", name: "A", type: "script" }] }],
    ["a malformed route list", { name: "x", stages: [{ key: "a", name: "A", type: "task", branchRules: ["drop table"] }] }],
    ["an unknown scope", { name: "x", scope: "global", stages: [] }],
  ])("rejects %s", (_label, raw) => expect(coerceFmsDefinition(raw)).toBeNull());
});

describe("fmsAiIdFactory", () => {
  it("gives the same UUID-shaped sequence for the same seed and a different one for another seed", async () => {
    const { fmsAiIdFactory } = await import("./aiOperations");
    const a = fmsAiIdFactory("req-1"); const b = fmsAiIdFactory("req-1"); const c = fmsAiIdFactory("req-2");
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(c()).not.toBe(first[0]);
    for (const id of first) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(first).size).toBe(3);
  });
});
