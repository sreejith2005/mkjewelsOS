import { describe, expect, it } from "vitest";
import { requireFmsAssignmentSourceForms, suggestFmsAssignment } from "./assignmentAuthoring";
import { normalizeFmsDefinition } from "./engine";
import type { FmsFlowDefinition, FmsStageDefinition } from "./types";
const stage = { key: "call", name: "Call", formTemplateId: "form", sla: {}, assigneeRules: [] } as unknown as FmsStageDefinition;
describe("assignment authoring defaults", () => {
  it("infers one required visible User question and requests manual choice for ambiguity", () => {
    const field = { key: "employee", label: "Employee", type: "user_dropdown", required: true, shown: true };
    expect(suggestFmsAssignment(stage, { form: [field] }).sources[0]?.sourceStageKey).toBe("call");
    expect(suggestFmsAssignment(stage, { form: [field, { ...field, key: "other" }] }).mode).toBe("manual_handoff");
    expect(suggestFmsAssignment(stage, { form: [{ ...field, hasCondition: true }] }).mode).toBe("manual_handoff");
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
});
