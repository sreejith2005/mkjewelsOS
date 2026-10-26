import { fmsOutgoingStageKeys } from "./engine.ts";
import { fmsStageFormFields } from "./formSections.ts";
import type { FmsAssignmentConfig, FmsAssignmentSource } from "./workContracts.ts";
import type { FmsFlowDefinition, FmsFormFieldRef, FmsStageDefinition } from "./types.ts";

export const FMS_ASSIGNMENT_LABELS: Readonly<Record<FmsAssignmentConfig["mode"], string>> = {
  previous_form: "Previous Form User Answer", fixed_employee: "Fixed Employee", hierarchy: "Role / Hierarchy Rule",
  previous_stage_employee: "Previous Stage Employee", manual_handoff: "Manual Handoff", configured_fallback: "Configured Fallback",
};
export function fmsSourceQuestions(stages: readonly FmsStageDefinition[], fields: Readonly<Record<string, readonly FmsFormFieldRef[]>>, _targetKey: string, usersOnly = true) {
  return stages.flatMap(stage => !stage.formTemplateId ? [] : fmsStageFormFields(stage, fields)
    .filter(field => usersOnly ? field.type === "user_dropdown" : !["section_header", "divider"].includes(field.type ?? "text"))
    .map(field => ({ label: `${stage.name} · ${field.label}`, key: `${stage.key}:${field.key}`,
      source: { sourceStageKey: stage.key, formTemplateId: stage.formTemplateId!, fieldKey: field.key } satisfies FmsAssignmentSource })));
}
const ASSIGNED_TO_NAMES: ReadonlySet<string> = new Set(["assignedto", "assignto"]);
const normalizedQuestionName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
/**
 * Which User question "Assigned To from the previous form" follows, given the
 * User questions the previous step answers (its section only). Mirrors
 * `fms_form_chain_choice` (0347): a question named Assigned To / Assign To (or
 * the step's `assignmentFieldKey`) wins; otherwise the only User question does,
 * when answered. With neither, the previous employee keeps the work.
 */
export function fmsFormAssigneeQuestions<T extends Readonly<{ key: string; label: string }>>(userQuestions: readonly T[], assignmentFieldKey?: string): Readonly<{ named: readonly T[]; only: T | undefined }> {
  const named = userQuestions.filter(field => field.key === assignmentFieldKey || ASSIGNED_TO_NAMES.has(normalizedQuestionName(field.key)) || ASSIGNED_TO_NAMES.has(normalizedQuestionName(field.label)));
  return { named, only: !named.length && userQuestions.length === 1 ? userQuestions[0] : undefined };
}
/** Plain words, per incoming human step, for who receives `targetKey` under "Assigned To from the previous form". */
export function fmsFormAssignmentPreview(stages: readonly FmsStageDefinition[], fields: Readonly<Record<string, readonly FmsFormFieldRef[]>>, targetKey: string): readonly string[] {
  return stages.filter(source => ["form", "task", "approval"].includes(source.type) && fmsOutgoingStageKeys(source).includes(targetKey)).map(source => {
    const { named, only } = fmsFormAssigneeQuestions(fmsStageFormFields(source, fields).filter(field => field.type === "user_dropdown"), source.sla.assignmentFieldKey);
    if (named.length > 1) return `After "${source.name}": its form has more than one Assigned To question. Keep one, or use an advanced rule.`;
    const question = named[0] ?? only;
    if (question) return `After "${source.name}": the employee chosen in "${question.label}"${only ? " (the same employee if it is left blank)" : ""}.`;
    return `After "${source.name}": the same employee who did "${source.name}". Its form has no employee question.`;
  });
}
/**
 * Whether the completing employee may keep the suggested employee or choose
 * another. Mirrors `fms_assignment_allows_handoff` (0348): never for a fixed
 * employee; always when the step follows the previous form's Assigned To.
 */
export function fmsAssignmentAllowsHandoff(config: Pick<FmsAssignmentConfig, "mode" | "allowHandoff" | "followFormAssignee"> | undefined): boolean {
  return !!config && config.mode !== "fixed_employee" && (config.allowHandoff || config.followFormAssignee === true);
}
export function suggestFmsAssignment(previous: FmsStageDefinition | undefined, fields: Readonly<Record<string, readonly FmsFormFieldRef[]>>): FmsAssignmentConfig {
  const questions = previous?.formTemplateId ? fmsStageFormFields(previous, fields).filter(field => field.type === "user_dropdown" && field.required && field.shown !== false && !field.hasCondition) : [];
  return { mode: "previous_form", allowHandoff: true, followFormAssignee: true,
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
