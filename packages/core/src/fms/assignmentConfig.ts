import { fmsStageNeedsAssignment } from "./assignmentAuthoring";
import { FMS_ASSIGNMENT_MODES } from "./workContracts";
import type { FmsFlowDefinition, FmsValidationContext, FmsValidationIssue } from "./types";

/** The server repeats these publication checks; this copy makes errors actionable in both editors. */
export function validateFmsAssignmentConfig(flow: FmsFlowDefinition, context: FmsValidationContext): readonly FmsValidationIssue[] {
  if (flow.assignmentVersion !== 2) return [];
  const issues: FmsValidationIssue[] = [];
  const automatic = new Set(["branch", "parallel_start", "parallel_join", "notification", "end"]);
  for (const stage of flow.stages) {
    if (automatic.has(stage.type) || !fmsStageNeedsAssignment(flow.stages, stage.key)) continue;
    const fail = (code: string, message: string) => issues.push({ code, message, stageKey: stage.key });
    const config = stage.sla.assignment;
    if (!config || !FMS_ASSIGNMENT_MODES.includes(config.mode)) {
      fail("missing_assignment_strategy", "Choose how this step receives its employee."); continue;
    }
    if (config.mode === "fixed_employee" && !stage.assigneeRules.some(r => r.type === "specific_user" && r.userProfileId)) {
      fail("fixed_owner_required", "Choose the employee locked to this step.");
    }
    if (config.mode === "hierarchy" && stage.assigneeRules.length === 0) fail("missing_assignment_rule", "Choose a role or hierarchy assignment rule.");
    if (config.mode === "configured_fallback" && !config.fallbackRule) fail("missing_assignment_fallback", "Choose an explicit fallback rule.");
    if (config.mode === "previous_form") {
      if (config.sources.length === 0 && !config.fallbackRule) fail("missing_assignment_source", "Choose the previous form's User question or an explicit fallback.");
      for (const source of config.sources) {
        const previous = flow.stages.find(s => s.key === source.sourceStageKey);
        const question = context.formFields?.[source.formTemplateId]?.find(f => f.key === source.fieldKey);
        if (source.routeRuleId && !previous?.branchRules.some(rule => rule.id === source.routeRuleId)) {
          fail("invalid_assignment_route", "Choose a route belonging to the exact assignment source step.");
        }
        if (!previous || previous.formTemplateId !== source.formTemplateId || (context.formFields && (!question || question.type !== "user_dropdown"))) {
          fail("invalid_assignment_source", "The assignment question must belong to the exact linked source form version.");
        } else if (question && (!question.required || question.shown === false || question.hasCondition) && !config.fallbackRule) {
          fail("assignment_route_uncovered", "This assignment question may be hidden or unanswered. Configure an explicit fallback.");
        }
      }
    }
    if (stage.sla.completionFormRequired && !stage.formTemplateId) fail("missing_required_completion_form", "Select the required completion form.");
    const display = stage.sla.taskDisplay;
    if (display?.referenceField && !display.fields.some(field => field.sourceStageKey === display.referenceField?.sourceStageKey && field.formTemplateId === display.referenceField.formTemplateId && field.fieldKey === display.referenceField.fieldKey)) fail("invalid_reference_question", "Choose a reference from the configured work-information questions.");
    const cap = stage.sla.followUp;
    if (cap && (!Number.isInteger(cap.maxVisits) || cap.maxVisits < 1 || !["hold", "escalate"].includes(cap.onLimit))) fail("invalid_visit_limit", "Choose a positive visit limit and a hold or escalation outcome.");
  }
  return issues;
}
