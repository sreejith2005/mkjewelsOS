import { describe, expect, it } from "vitest";
import { fmsSourceQuestions, requireFmsAssignmentSourceForms, suggestFmsAssignment } from "./assignmentAuthoring";
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
