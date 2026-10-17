import { fmsOutgoingStageKeys } from "./engine";
import { fmsStageNeedsAssignment, requireFmsAssignmentSourceForms, suggestFmsAssignment } from "./assignmentAuthoring";
import type { FmsFlowDefinition, FmsFormFieldRef } from "./types";

/** Explicit draft-only upgrade; existing rules, forms, routes and historical
 * published versions are retained. Ambiguous sources remain an editor choice. */
export function upgradeFmsAssignmentContract(flow: FmsFlowDefinition, fields: Readonly<Record<string, readonly FmsFormFieldRef[]>>): FmsFlowDefinition {
  if (flow.lifecycle && flow.lifecycle !== "draft") throw new Error("Create a draft revision before changing assignment behavior.");
  return requireFmsAssignmentSourceForms({ ...flow, assignmentVersion: 2, stages: flow.stages.map((stage) => {
    if (!fmsStageNeedsAssignment(flow.stages, stage.key) || !["form", "task", "approval"].includes(stage.type) || stage.sla.assignment) return stage;
    const incoming = flow.stages.filter(source => fmsOutgoingStageKeys(source).includes(stage.key));
    const suggestion = suggestFmsAssignment(incoming.length === 1 ? incoming[0] : undefined, fields);
    const assignment = suggestion.mode === "previous_form" || !stage.assigneeRules.length ? suggestion
      : { mode: "hierarchy" as const, sources: [], allowHandoff: true };
    return { ...stage, sla: { ...stage.sla, assignment } };
  }) });
}
