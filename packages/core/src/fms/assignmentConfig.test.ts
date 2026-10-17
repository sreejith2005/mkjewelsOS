import { describe, expect, it } from "vitest";
import { normalizeFmsDefinition, validateFmsDefinition } from "./engine";
import type { FmsFlowDefinition, FmsStageDefinition } from "./types";

const formId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
function flow(): FmsFlowDefinition {
  const base: FmsStageDefinition = { key: "intake", name: "Intake", type: "form", order: 0,
    required: true, completionRule: "any_doer", allowMultipleDoers: false, requiresUpload: false,
    requiresRemark: false, checklist: [], formTemplateId: formId, assigneeRules: [],
    requiresNextDoerHandoff: false, canMoveBackward: false, canReject: false,
    canRequestRevision: false, canEscalate: false, branchRules: [], parallelTargetStageKeys: [],
    joinRequiredStageKeys: [], defaultNextStageKey: "call", sla: { dueDate: "", deadlineEnabled: false } };
  return { name: "Enquiry", scope: "tenant", manualTrigger: true, assignmentVersion: 2,
    stages: [base, { ...base, key: "call", name: "Call", type: "task", order: 1,
      formTemplateId: undefined, defaultNextStageKey: undefined,
      sla: { dueDate: "", deadlineEnabled: false, assignment: { mode: "previous_form", allowHandoff: true,
        sources: [{ sourceStageKey: "intake", formTemplateId: formId, fieldKey: "Assigned_To" }] } } }] };
}
const fields = { formFields: { [formId]: [{ key: "Assigned_To", label: "Owner", type: "user_dropdown", required: true, shown: true }] } };

describe("versioned FMS assignment authoring", () => {
  it("rejects a source route that does not belong to the pinned source step", () => {
    const original = flow();
    const configured = { ...original, stages: original.stages.map(stage => stage.key === "call" ? { ...stage, sla: { ...stage.sla, assignment: { ...stage.sla.assignment!, sources: [{ sourceStageKey: "intake", formTemplateId: formId, fieldKey: "Assigned_To", routeRuleId: "foreign-route" }] } } } : stage) };
    expect(validateFmsDefinition(configured, fields).some(issue => issue.code === "invalid_assignment_route")).toBe(true);
  });
  it("preserves exact pinned field identities and assignment settings during normalization", () => {
    const result = normalizeFmsDefinition(flow());
    expect(result.assignmentVersion).toBe(2);
    expect(result.stages[1]?.sla.assignment).toEqual(flow().stages[1]?.sla.assignment);
    expect(validateFmsDefinition(result, fields)).toEqual([]);
  });
  it("requires an incoming assignment strategy for each new human stage", () => {
    const original = flow();
    const result = { ...original, stages: original.stages.map(s => s.key === "call" ? { ...s, sla: { dueDate: "", deadlineEnabled: false } } : s) };
    expect(validateFmsDefinition(result, fields).some(i => i.code === "missing_assignment_strategy" && i.stageKey === "call")).toBe(true);
  });
  it("rejects hidden or conditional sources without an explicit fallback", () => {
    const conditional = { formFields: { [formId]: [{ ...fields.formFields[formId]![0]!, hasCondition: true }] } };
    expect(validateFmsDefinition(flow(), conditional).some(i => i.code === "assignment_route_uncovered")).toBe(true);
  });
  it("accepts a conditional answer with an explicit eligible-rule fallback", () => {
    const original = flow();
    const result = { ...original, stages: original.stages.map(s => s.key === "call" ? { ...s,
      sla: { ...s.sla, assignment: { ...s.sla.assignment!, fallbackRule: { type: "specific_user" as const, userProfileId: userId } } } } : s) };
    const conditional = { formFields: { [formId]: [{ ...fields.formFields[formId]![0]!, hasCondition: true }] } };
    expect(validateFmsDefinition(result, conditional)).toEqual([]);
    expect(normalizeFmsDefinition(result).stages[1]?.sla.assignment?.fallbackRule?.userProfileId).toBe(userId);
  });
  it("requires a named owner for a locked fixed stage", () => {
    const original = flow();
    const result = { ...original, stages: original.stages.map(s => s.key === "call" ? { ...s,
      sla: { ...s.sla, assignment: { mode: "fixed_employee" as const, allowHandoff: false, sources: [] } } } : s) };
    expect(validateFmsDefinition(result, fields).some(i => i.code === "fixed_owner_required")).toBe(true);
  });
  it("does not require new assignment configuration on legacy definitions", () => {
    const original = flow();
    const legacy = { ...original, assignmentVersion: 1 as const, stages: original.stages.map(s => ({ ...s, sla: { dueDate: "", deadlineEnabled: false } })) };
    expect(validateFmsDefinition(legacy, fields)).toEqual([]);
  });
  it("preserves required completion, presentation, and follow-up settings", () => {
    const original = flow();
    const configured = { ...original, stages: original.stages.map(s => ({ ...s, sla: { ...s.sla,
      completionFormRequired: true, taskDisplay: { instructions: "Call client", expectedResult: "Record response", fields: [] },
      followUp: { maxVisits: 5, onLimit: "hold" as const } } })) };
    expect(normalizeFmsDefinition(configured).stages[0]?.sla).toMatchObject({ completionFormRequired: true,
      taskDisplay: { instructions: "Call client" }, followUp: { maxVisits: 5, onLimit: "hold" } });
  });
  it("requires assignment on a return route to the initial form", () => {
    const original = flow();
    const returned = { ...original, stages: original.stages.map(stage => stage.key === "call" ? { ...stage, defaultNextStageKey: "intake" } : stage) };
    expect(validateFmsDefinition(returned, fields).some(issue => issue.code === "missing_assignment_strategy" && issue.stageKey === "intake")).toBe(true);
  });

});
