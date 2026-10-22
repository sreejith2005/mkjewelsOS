import {
  buildScheduleRule,
  firstScheduleDate,
  isSupportedTaskRrule,
  parseScheduleRule,
  validateScheduleSpec,
  type ScheduleSpec,
} from "./recurrenceBuilder.ts";
import { TASK_TRIGGER_LABEL_MAX } from "./taskImport/frequency.ts";

/**
 * A recurring task or as-needed duty as Create Task and the Task Control
 * template form author it, and the one payload both send to
 * `save_recurring_todo_template_with_audit`.
 *
 * A schedule template has one owner, so several selected people become one
 * schedule each (the "separate" assignment of Create Task). The database
 * re-checks every field; this decides only what the form offers and sends.
 */

export type ScheduledTaskPriority = "high" | "medium" | "low";

export type ScheduledTaskTiming =
  /** A calendar schedule. `keepRule` carries a stored rule the author did not change. */
  | Readonly<{
      type: "calendar";
      spec: ScheduleSpec | null;
      startsOn: string;
      keepRule?: Readonly<{ recurrenceRule: string; scheduleKind: string }> | null;
    }>
  /** A standing as-needed duty, started by the employee or assigned now by a manager. */
  | Readonly<{ type: "as_required"; triggerLabel: string }>;

export type ScheduledTaskDraft = Readonly<{
  title: string;
  description: string;
  /** "task" completes with an upload; "checklist" with ticked items. */
  mode: "task" | "checklist";
  checklistItems: readonly string[];
  priority: ScheduledTaskPriority;
  formTemplateId: string;
  startTime: string;
  dueTime: string;
  timing: ScheduledTaskTiming;
  verificationRequired: boolean;
  verifierId: string;
  followupEnabled: boolean;
  requiresRemark: boolean;
  buddy: boolean;
  /** A paused schedule stays paused when it is edited. */
  active: boolean;
  personalPerformance: boolean;
}>;

export type ScheduledTaskAssignee = Readonly<{
  id: string;
  branch_id: string | null;
  department_id: string | null;
}>;

/** Event wording offered for an as-needed duty; any other text may be typed. */
export const AS_NEEDED_TRIGGER_SUGGESTIONS = [
  "As Required", "As Applicable", "As Assigned", "As Scheduled", "Per Customer", "Per Lead", "Per Enquiry",
  "Per Visit", "After Customer Visit", "Per Product", "Per Refill", "Per Order", "Per Follow-up", "Per Interaction",
] as const;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The calendar rule this draft saves, or null for an as-needed duty. */
export function scheduledTaskRule(draft: Pick<ScheduledTaskDraft, "timing">): Readonly<{ recurrenceRule: string; scheduleKind: string }> | null {
  if (draft.timing.type !== "calendar") return null;
  if (draft.timing.keepRule) return draft.timing.keepRule;
  return draft.timing.spec ? buildScheduleRule(draft.timing.spec) : null;
}

/**
 * The date a new calendar schedule is stored with: its first real date on or
 * after the chosen start, because the first occurrence is created on
 * `starts_on`. An edited schedule keeps the date it has.
 */
export function scheduledTaskStartsOn(draft: Pick<ScheduledTaskDraft, "timing">, isNew: boolean): string | null {
  if (draft.timing.type !== "calendar") return null;
  if (!isNew || draft.timing.keepRule) return draft.timing.startsOn;
  const rule = scheduledTaskRule(draft);
  return rule ? firstScheduleDate(rule.recurrenceRule, draft.timing.startsOn) ?? draft.timing.startsOn : draft.timing.startsOn;
}

/** Why the draft cannot be saved, in the form's own words, or null. */
export function validateScheduledTaskDraft(
  draft: ScheduledTaskDraft,
  assignees: readonly ScheduledTaskAssignee[],
): string | null {
  if (!draft.title.trim()) return "Add a title.";
  if (draft.title.trim().length > 200) return "The title must be at most 200 characters.";
  if (assignees.length === 0) return "Choose who does this work.";
  if (draft.mode === "checklist" && draft.checklistItems.some((item) => !item.trim())) return "Checklist items cannot be empty.";
  if (draft.verificationRequired && !draft.verifierId) return "Choose who verifies the completed work, or turn verification off.";
  if (draft.timing.type === "as_required") {
    if (draft.timing.triggerLabel.trim().length > TASK_TRIGGER_LABEL_MAX) return `The trigger wording must be at most ${TASK_TRIGGER_LABEL_MAX} characters.`;
    return null;
  }
  if (!TIME.test(draft.startTime)) return "Choose a start time.";
  if (!TIME.test(draft.dueTime)) return "Choose a due time.";
  if (draft.dueTime <= draft.startTime) return "Due Time must be later than the Scheduled Start Time.";
  if (draft.timing.keepRule) {
    return isSupportedTaskRrule(draft.timing.keepRule.recurrenceRule) ? null : "This schedule's stored rule can no longer be saved. Choose a repeat pattern.";
  }
  if (!draft.timing.spec) return "Choose how often this repeats.";
  return validateScheduleSpec(draft.timing.spec, draft.timing.startsOn);
}

/** The `save_recurring_todo_template_with_audit` payload for one assignee. */
export function buildScheduledTaskPayload(
  draft: ScheduledTaskDraft,
  assignee: ScheduledTaskAssignee,
  isNew: boolean,
): Record<string, unknown> {
  const asNeeded = draft.timing.type === "as_required";
  const rule = scheduledTaskRule(draft);
  const checklist = draft.mode === "checklist"
    ? draft.checklistItems.map((item, index) => ({ item_text: item.trim(), is_required: true, sort_order: index }))
    : [];
  const payload: Record<string, unknown> = {
    title: draft.title.trim(),
    description: draft.description.trim(),
    // An as-needed duty is never generated on a calendar; the stored rule is
    // the one-shot rule the Recurring / To-Do form always saved for it.
    recurrence_rule: asNeeded ? "FREQ=DAILY;COUNT=1" : rule?.recurrenceRule ?? "",
    schedule_kind: asNeeded ? "as_required" : rule?.scheduleKind ?? "recurring",
    planned_time: TIME.test(draft.startTime) ? draft.startTime : "11:00",
    due_time: TIME.test(draft.dueTime) ? draft.dueTime : "",
    priority: draft.priority,
    branch_id: assignee.branch_id,
    department_id: assignee.department_id,
    default_assignee_type: "specific_user",
    default_assignee_user_id: assignee.id,
    default_assignee_role: "",
    task_type: draft.mode === "task" ? "delegation" : "checklist",
    buddy_assignment_allowed: draft.buddy,
    checklist_items: checklist,
    requires_upload: draft.mode === "task",
    requires_remark: draft.requiresRemark,
    requires_form: Boolean(draft.formTemplateId),
    form_template_id: draft.formTemplateId,
    is_active: asNeeded ? false : draft.active,
    verification_required: draft.verificationRequired,
    verifier_user_profile_id: draft.verificationRequired ? draft.verifierId : "",
    followup_enabled: draft.followupEnabled,
    personal_performance_enabled: draft.personalPerformance,
  };
  if (asNeeded) {
    payload.trigger_label = draft.timing.triggerLabel.trim();
  } else {
    payload.starts_on = scheduledTaskStartsOn(draft, isNew);
  }
  return payload;
}

/** The fields of a stored template the form edits. */
export type ScheduledTaskTemplateLike = Readonly<{
  title?: string | null;
  description?: string | null;
  task_type?: string | null;
  checklist_items?: unknown;
  priority?: string | null;
  form_template_id?: string | null;
  planned_time?: string | null;
  due_time?: string | null;
  schedule_kind?: string | null;
  recurrence_rule?: string | null;
  starts_on?: string | null;
  trigger_label?: string | null;
  verification_required?: boolean | null;
  verifier_user_profile_id?: string | null;
  followup_enabled?: boolean | null;
  requires_remark?: boolean | null;
  buddy_assignment_allowed?: boolean | null;
  is_active?: boolean | null;
  personal_performance_enabled?: boolean | null;
}>;

function checklistTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && typeof (item as { item_text?: unknown }).item_text === "string") return [(item as { item_text: string }).item_text];
    return [];
  });
}

/**
 * A draft that, saved unchanged, writes back what the template already holds.
 * Everything the older form silently reset (priority, verification, the
 * verifier, follow-ups, a remark rule, checklist items and the exact rule) is
 * carried through.
 */
export function scheduledTaskDraftFromTemplate(template: ScheduledTaskTemplateLike, today: string): ScheduledTaskDraft {
  const asNeeded = template.schedule_kind === "as_required";
  const startsOn = template.starts_on ?? today;
  const rule = template.recurrence_rule ?? "";
  const priority = template.priority === "high" || template.priority === "low" ? template.priority : "medium";
  return {
    title: template.title ?? "",
    description: template.description ?? "",
    mode: template.task_type === "delegation" ? "task" : "checklist",
    checklistItems: checklistTexts(template.checklist_items),
    priority,
    formTemplateId: template.form_template_id ?? "",
    startTime: template.planned_time?.slice(0, 5) ?? "",
    dueTime: template.due_time?.slice(0, 5) ?? template.planned_time?.slice(0, 5) ?? "",
    timing: asNeeded
      ? { type: "as_required", triggerLabel: template.trigger_label ?? "" }
      : {
          type: "calendar",
          spec: parseScheduleRule(rule, startsOn),
          startsOn,
          keepRule: rule ? { recurrenceRule: rule, scheduleKind: template.schedule_kind ?? "recurring" } : null,
        },
    verificationRequired: Boolean(template.verification_required),
    verifierId: template.verifier_user_profile_id ?? "",
    followupEnabled: Boolean(template.followup_enabled),
    requiresRemark: Boolean(template.requires_remark),
    buddy: template.buddy_assignment_allowed ?? true,
    active: template.is_active ?? true,
    personalPerformance: template.personal_performance_enabled ?? true,
  };
}

/**
 * What saving an edit does to work already created, stated from what
 * `save_recurring_todo_template_with_audit` actually changes.
 */
export const SCHEDULE_EDIT_EFFECT =
  "Saving changes future occurrences. Occurrences already created keep their dates; open ones take the new review rule, " +
  "and an open occurrence on the start date takes the new due time and task type. Completed work and its history never change.";
