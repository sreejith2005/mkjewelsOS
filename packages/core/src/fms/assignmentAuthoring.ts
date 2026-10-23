import { fmsOutgoingStageKeys } from "./engine.ts";
import type { FmsAssignmentConfig, FmsAssignmentSource } from "./workContracts.ts";
import type { FmsFlowDefinition, FmsFormFieldRef, FmsStageDefinition } from "./types.ts";

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
  return { mode: "previous_form", allowHandoff: false, followFormAssignee: true,
    fallbackRule: { type: "previous_step_doer" },
    sources: previous?.formTemplateId && questions.length === 1
      ? [{ sourceStageKey: previous.key, formTemplateId: previous.formTemplateId, fieldKey: questions[0]!.key }] : [] };
}
/** The form that supplies a required owner cannot be skipped by Complete. */
export function requireFmsAssignmentSourceForms(flow: FmsFlowDefinition): FmsFlowDefinition {
  if (flow.assignmentVersion !== 2) return flow;
  const required = new Set(flow.stages.flatMap(stage => stage.sla.assignment?.mode === "previous_form" && !stage.sla.assignment.fallbackRule ? stage.sla.assignment.sources.map(source => source.sourceStageKey) : []));
  for (const target of flow.stages.filter(stage => stage.sla.assignment?.followFormAssignee)) {
    const visited = new Set<string>();
    const pending = [target.key];
    while (pending.length) {
      const destination = pending.pop()!;
      if (visited.has(destination)) continue;
      visited.add(destination);
      for (const source of flow.stages.filter(stage => fmsOutgoingStageKeys(stage).includes(destination))) {
        if (["form", "task", "approval"].includes(source.type)) { if (source.formTemplateId) required.add(source.key); }
        else pending.push(source.key);
      }
    }
  }
  return { ...flow, stages: flow.stages.map(stage => required.has(stage.key) ? { ...stage, sla: { ...stage.sla, completionFormRequired: true } } : stage) };
}

/** The first form needs an incoming owner only when a configured route returns to it. */
export function fmsStageNeedsAssignment(stages: readonly FmsStageDefinition[], stageKey: string): boolean {
  return stages[0]?.key !== stageKey || stages.some(stage => fmsOutgoingStageKeys(stage).includes(stageKey));
}
