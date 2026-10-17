import { fmsOutgoingStageKeys } from "./engine";
import type { FmsAssignmentConfig, FmsAssignmentSource } from "./workContracts";
import type { FmsFlowDefinition, FmsFormFieldRef, FmsStageDefinition } from "./types";

export const FMS_ASSIGNMENT_LABELS: Readonly<Record<FmsAssignmentConfig["mode"], string>> = {
  previous_form: "Previous Form User Answer", fixed_employee: "Fixed Employee", hierarchy: "Role / Hierarchy Rule",
  previous_stage_employee: "Previous Stage Employee", manual_handoff: "Manual Handoff", configured_fallback: "Configured Fallback",
};
export function fmsSourceQuestions(stages: readonly FmsStageDefinition[], fields: Readonly<Record<string, readonly FmsFormFieldRef[]>>, _targetKey: string, usersOnly = true) {
  return stages.flatMap(stage => !stage.formTemplateId ? [] : (fields[stage.formTemplateId] ?? [])
    .filter(field => usersOnly ? field.type === "user_dropdown" : !["section_header", "divider"].includes(field.type ?? "text"))
    .map(field => ({ label: `${stage.name} · ${field.label}`, key: `${stage.key}:${field.key}`,
      source: { sourceStageKey: stage.key, formTemplateId: stage.formTemplateId!, fieldKey: field.key } satisfies FmsAssignmentSource })));
}
export function suggestFmsAssignment(previous: FmsStageDefinition | undefined, fields: Readonly<Record<string, readonly FmsFormFieldRef[]>>): FmsAssignmentConfig {
  const questions = previous?.formTemplateId ? (fields[previous.formTemplateId] ?? []).filter(field => field.type === "user_dropdown" && field.required && field.shown !== false && !field.hasCondition) : [];
  return previous?.formTemplateId && questions.length === 1 ? { mode: "previous_form", allowHandoff: true,
    sources: [{ sourceStageKey: previous.key, formTemplateId: previous.formTemplateId, fieldKey: questions[0]!.key }] }
    : { mode: "manual_handoff", allowHandoff: true, sources: [] };
}
/** The form that supplies a required owner cannot be skipped by Complete. */
export function requireFmsAssignmentSourceForms(flow: FmsFlowDefinition): FmsFlowDefinition {
  if (flow.assignmentVersion !== 2) return flow;
  const required = new Set(flow.stages.flatMap(stage => stage.sla.assignment?.mode === "previous_form" && !stage.sla.assignment.fallbackRule ? stage.sla.assignment.sources.map(source => source.sourceStageKey) : []));
  return { ...flow, stages: flow.stages.map(stage => required.has(stage.key) ? { ...stage, sla: { ...stage.sla, completionFormRequired: true } } : stage) };
}

/** The first form needs an incoming owner only when a configured route returns to it. */
export function fmsStageNeedsAssignment(stages: readonly FmsStageDefinition[], stageKey: string): boolean {
  return stages[0]?.key !== stageKey || stages.some(stage => fmsOutgoingStageKeys(stage).includes(stageKey));
}
