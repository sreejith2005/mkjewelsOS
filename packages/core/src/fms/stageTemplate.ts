import { suggestFmsAssignment } from "./assignmentAuthoring.ts";
import type { FmsStageDefinition } from "./types.ts";

/**
 * The defaults of a newly authored stage. The web builder's `newFmsStage` and
 * the AI workflow compiler both build stages from this one definition, so a
 * stage added by hand and a stage added by AI are indistinguishable.
 * `newId` supplies route ids (the browser and Edge runtime use crypto.randomUUID).
 */
export function fmsStageTemplate(type: FmsStageDefinition["type"], order: number, newId: () => string): FmsStageDefinition {
  if (type === "end") return {
    key: `stage_${order + 1}`, name: "End", type, order, required: true, completionRule: "any_doer",
    allowMultipleDoers: false, requiresUpload: false, requiresRemark: false, checklist: [], assigneeRules: [],
    requiresNextDoerHandoff: false, canMoveBackward: false, canReject: false, canRequestRevision: false, canEscalate: false,
    branchRules: [], parallelTargetStageKeys: [], joinRequiredStageKeys: [],
    // An End Node creates no work: no assignee, deadline, form or decision. Its outcome is all it records.
    sla: { timingMethod: "completion_date", deadlineEnabled: false, dueDate: "", decisionMode: "normal", terminal: { outcome: "other" } },
  };
  return {
    key: `stage_${order + 1}`,
    name: type.split("_").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" "),
    type, order, required: true,
    completionRule: type === "approval" ? "manager_approval" : "any_doer",
    allowMultipleDoers: false, requiresUpload: false, requiresRemark: false, checklist: [], assigneeRules: [],
    requiresNextDoerHandoff: false, canMoveBackward: false, canReject: type === "approval", canRequestRevision: type === "approval", canEscalate: false,
    branchRules: type === "branch" ? [{ id: newId(), source: "outcome", operator: "default", order: 0 }] : [],
    parallelTargetStageKeys: [], joinRequiredStageKeys: [],
    sla: { assignment: suggestFmsAssignment(undefined, {}), timingMethod: "completion_date", deadlineEnabled: !(type === "form" && order === 0), dueDate: "", decisionMode: "normal" },
  };
}
