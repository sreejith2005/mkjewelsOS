import { describe, expect, it } from "vitest";
import { fmsAssignmentAllowsHandoff, fmsFormAssigneeQuestions, fmsFormAssignmentPreview, fmsSourceQuestions, requireFmsAssignmentSourceForms, suggestFmsAssignment } from "./assignmentAuthoring";
import { normalizeFmsDefinition } from "./engine";
import type { FmsFlowDefinition, FmsStageDefinition } from "./types";
const stage = { key: "call", name: "Call", type: "form", formTemplateId: "form", defaultNextStageKey: "demo", branchRules: [], parallelTargetStageKeys: [], sla: {}, assigneeRules: [] } as unknown as FmsStageDefinition;
describe("assignment authoring defaults", () => {
  it("defaults to the preceding form selection with previous-owner continuity", () => {
    const field = { key: "employee", label: "Employee", type: "user_dropdown", required: true, shown: true };
    expect(suggestFmsAssignment(stage, { form: [field] }).sources[0]?.sourceStageKey).toBe("call");
    expect(suggestFmsAssignment(stage, { form: [] })).toMatchObject({ mode: "previous_form", followFormAssignee: true, fallbackRule: { type: "previous_step_doer" } });
    expect(suggestFmsAssignment(undefined, {})).toMatchObject({ followFormAssignee: true });
  });
  it("requires source forms only for the versioned required assignment contract", () => {
    const flow = { assignmentVersion: 2, stages: [stage, { ...stage, key: "demo", sla: { assignment: suggestFmsAssignment(stage, { form: [{key:"owner",label:"Owner",type:"user_dropdown",required:true}] }) } }] } as unknown as FmsFlowDefinition;
    expect(requireFmsAssignmentSourceForms(flow).stages[0]?.sla.completionFormRequired).toBe(true);
    expect(requireFmsAssignmentSourceForms({ ...flow, assignmentVersion: 1 }).stages[0]?.sla.completionFormRequired).toBeUndefined();
  });
  it("lets the completing employee replace a form-assigned employee but never a fixed one", () => {
    expect(fmsAssignmentAllowsHandoff({ mode: "previous_form", allowHandoff: false, followFormAssignee: true })).toBe(true);
    expect(fmsAssignmentAllowsHandoff({ mode: "previous_form", allowHandoff: false })).toBe(false);
    expect(fmsAssignmentAllowsHandoff({ mode: "manual_handoff", allowHandoff: true })).toBe(true);
    expect(fmsAssignmentAllowsHandoff({ mode: "fixed_employee", allowHandoff: true, followFormAssignee: true })).toBe(false);
    expect(fmsAssignmentAllowsHandoff(undefined)).toBe(false);
    expect(suggestFmsAssignment(undefined, {}).allowHandoff).toBe(true);
  });
  it("follows a named Assigned To first, otherwise the only employee question", () => {
    const user = (key: string, label: string) => ({ key, label, type: "user_dropdown" });
    expect(fmsFormAssigneeQuestions([user("sales", "Salesperson"), user("assigned_to", "Assigned To")])).toMatchObject({ named: [{ key: "assigned_to" }], only: undefined });
    expect(fmsFormAssigneeQuestions([user("sales", "Salesperson")])).toMatchObject({ named: [], only: { key: "sales" } });
    expect(fmsFormAssigneeQuestions([user("sales", "Salesperson"), user("closer", "Closer")])).toMatchObject({ named: [], only: undefined });
    expect(fmsFormAssigneeQuestions([user("sales", "Salesperson"), user("closer", "Closer")], "closer")).toMatchObject({ named: [{ key: "closer" }] });
  });
  it("describes who receives a step for each incoming step", () => {
    const fields = { form: [{ key: "sales", label: "Salesperson", type: "user_dropdown" }], blank: [] };
    const stages = [
      { ...stage, key: "call", name: "Call" },
      { ...stage, key: "visit", name: "Visit", formTemplateId: "blank" },
      { ...stage, key: "demo", name: "Demo", defaultNextStageKey: undefined },
    ] as unknown as FmsStageDefinition[];
    expect(fmsFormAssignmentPreview(stages, fields as never, "demo")).toEqual([
      'After "Call": the employee chosen in "Salesperson" (the same employee if it is left blank).',
      'After "Visit": the same employee who did "Visit". Its form has no employee question.',
    ]);
  });
  it("preserves a legacy named fallback while normalizing", () => {
    const flow = { stages: [{ ...stage, assigneeRules: [{ type: "specific_user", userProfileId: "owner", fallbackUserProfileId: "cover" }] }] } as unknown as FmsFlowDefinition;
    expect(normalizeFmsDefinition(flow).stages[0]?.assigneeRules[0]?.fallbackUserProfileId).toBe("cover");
  });
  it("requires only causal source forms, preserving unrelated custom optional forms", () => {
    const source = { ...stage, key: "source", defaultNextStageKey: "simple", branchRules: [], parallelTargetStageKeys: [] };
    const simple = { ...stage, key: "simple", formTemplateId: undefined, branchRules: [], parallelTargetStageKeys: [], sla: { assignment: suggestFmsAssignment(source, {}) } };
    const unrelated = { ...stage, key: "custom", branchRules: [], parallelTargetStageKeys: [], sla: { completionFormRequired: false } };
    const result = requireFmsAssignmentSourceForms({ assignmentVersion: 2, stages: [source, simple, unrelated] } as unknown as FmsFlowDefinition);
    expect(result.stages[0]?.sla.completionFormRequired).toBe(true);
    expect(result.stages[2]?.sla.completionFormRequired).toBe(false);
  });
  it("allows a loop to use the previous visit of its own linked form", () => {
    expect(fmsSourceQuestions([stage], { form: [{ key: "employee", label: "Employee", type: "user_dropdown" }] }, stage.key)).toHaveLength(1);
  });

});
