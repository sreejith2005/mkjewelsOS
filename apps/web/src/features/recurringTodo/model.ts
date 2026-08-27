import { isTaskFeedItemOverdue, type Tables } from "@jewelos/core";

export type RecurringTemplate = Tables<"task_templates">;
export type RecurringInstance = Tables<"task_instances"> & {
  assignees: Array<{ id: string; name: string; is_original: boolean }>;
  checklist: Tables<"task_checklists">[];
  has_attachment: boolean;
  has_form_submission: boolean;
};
export type RecurringStats = { total: number; pending: number; in_progress: number; completed: number; overdue: number; coverage_required: number; manager_review: number };
export type RecurringWorkspace = { templates: RecurringTemplate[]; instances: RecurringInstance[]; stats: RecurringStats };

/** Keeps stored workflow state intact while displaying a missed occurrence as overdue. */
export function recurringInstanceDisplayStatus(
  instance: RecurringInstance,
  now: Date | string = new Date(),
): string | null {
  if (["completed", "rejected", "blocked"].includes(instance.status ?? "")) return instance.status;
  return isTaskFeedItemOverdue({ ...instance, assignee_id: null }, now)
    ? "overdue"
    : instance.status;
}

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function parseRecurringWorkspace(value: unknown): RecurringWorkspace {
  if (!object(value) || !Array.isArray(value.templates) || !Array.isArray(value.instances) || !object(value.stats)) throw new Error("Recurring workspace response is invalid");
  const stats = value.stats;
  const number = (key: keyof RecurringStats) => typeof stats[key] === "number" ? stats[key] : 0;
  return { templates: value.templates as RecurringTemplate[], instances: value.instances as RecurringInstance[], stats: { total: number("total"), pending: number("pending"), in_progress: number("in_progress"), completed: number("completed"), overdue: number("overdue"), coverage_required: number("coverage_required"), manager_review: number("manager_review") } };
}
