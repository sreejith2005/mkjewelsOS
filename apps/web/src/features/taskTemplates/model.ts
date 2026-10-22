import { describeScheduleRule, isOnDemandSchedule, onDemandTriggerLabel, upcomingScheduleDates } from "@jewelos/core";

/**
 * Task Templates directory row.
 *
 * Shape of one row returned by the `get_task_template_directory` RPC. Every
 * field is produced by Postgres from `task_templates` plus its joined owner,
 * department, branch and import bookkeeping — nothing here is derived in the
 * browser except presentation labels.
 */
export type TaskTemplateDirectoryRow = Readonly<{
  id: string;
  title: string;
  description: string | null;
  assignee_user_id: string | null;
  assignee_name: string;
  assignee_type: string;
  department_id: string | null;
  department_name: string;
  branch_id: string | null;
  branch_name: string;
  task_type: "checklist" | "delegation";
  schedule_kind: string;
  /** Sheet wording for an as-needed duty ("Per Customer"); null otherwise. */
  trigger_label?: string | null;
  recurrence_rule: string | null;
  starts_on: string | null;
  planned_time: string | null;
  due_time: string | null;
  priority: string;
  requires_upload: boolean;
  requires_form: boolean;
  verification_required: boolean;
  followup_enabled: boolean;
  buddy_assignment_allowed: boolean;
  is_active: boolean;
  assignment_status: string;
  schedule_status: "ready" | "paused" | "needs_start_date" | "assigning_left";
  source: "web_app" | "bulk_import";
  checklist_count: number;
  created_at: string | null;
  updated_at: string | null;
}>;

export type TaskTemplateDirectory = Readonly<{ templates: TaskTemplateDirectoryRow[] }>;

export type TaskTemplateDeletion = Readonly<{
  outcome: "deleted" | "archived";
  open_instances_removed: number;
  instances_preserved: number;
  title: string;
}>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTaskTemplateDirectory(value: unknown): TaskTemplateDirectory {
  if (!isObject(value) || !Array.isArray(value.templates)) throw new Error("Task template directory response is invalid");
  return { templates: value.templates as TaskTemplateDirectoryRow[] };
}

export function parseTaskTemplateDeletion(value: unknown): TaskTemplateDeletion {
  if (!isObject(value) || (value.outcome !== "deleted" && value.outcome !== "archived")) {
    throw new Error("Task template deletion response is invalid");
  }
  const count = (key: string) => (typeof value[key] === "number" ? (value[key] as number) : 0);
  return {
    outcome: value.outcome,
    open_instances_removed: count("open_instances_removed"),
    instances_preserved: count("instances_preserved"),
    title: typeof value.title === "string" ? value.title : "",
  };
}

/** CHECKBOX / UPLOAD, matching the two task-completion modes the app supports. */
export function templateWorkTypeLabel(row: TaskTemplateDirectoryRow): "CHECKBOX" | "UPLOAD" {
  return row.task_type === "delegation" || row.requires_upload ? "UPLOAD" : "CHECKBOX";
}

export function templateFrequencyLabel(row: TaskTemplateDirectoryRow): string {
  if (isOnDemandSchedule(row)) return onDemandTriggerLabel(row.trigger_label).toUpperCase();
  return row.schedule_kind.replaceAll("_", " ").toUpperCase();
}

export function templateStatusLabel(row: TaskTemplateDirectoryRow): string {
  if (row.schedule_status === "assigning_left") return "ASSIGNING LEFT";
  if (row.schedule_status === "needs_start_date") return "NEEDS START DATE";
  // An as-needed duty is never "active": it runs when started or assigned now.
  if (isOnDemandSchedule(row)) return "ON DEMAND";
  return row.is_active ? "ACTIVE" : "INACTIVE";
}

/** Assign now creates one occurrence of an assigned as-needed duty. */
export function templateCanAssignNow(row: TaskTemplateDirectoryRow): boolean {
  return isOnDemandSchedule(row) && row.schedule_status !== "assigning_left";
}

export function templateSourceLabel(row: TaskTemplateDirectoryRow): string {
  return row.source === "bulk_import" ? "BULK IMPORT" : "WEB APP";
}

/** A template can go live only once it has a start date and a named owner. */
export function templateCanActivate(row: TaskTemplateDirectoryRow): boolean {
  return row.schedule_kind !== "as_required" && row.schedule_status !== "assigning_left" && Boolean(row.starts_on);
}

/** The schedule in words ("Every month on the 3rd Saturday"), or null for an as-needed duty. */
export function templateScheduleDescription(row: TaskTemplateDirectoryRow): string | null {
  if (isOnDemandSchedule(row) || !row.recurrence_rule) return null;
  if (row.schedule_kind === "one_time") return row.starts_on ? `Once on ${row.starts_on}` : "Once";
  return describeScheduleRule(row.recurrence_rule, row.starts_on);
}

/**
 * The next business date the scheduler will create, read through the same
 * engine. "ended" when the end date or count is used up, null when the row
 * has no calendar (an as-needed duty, or no start date yet).
 */
export function templateNextDate(row: TaskTemplateDirectoryRow, today: string): string | "ended" | null {
  if (isOnDemandSchedule(row) || !row.recurrence_rule || !row.starts_on) return null;
  if (row.schedule_kind === "one_time") return row.starts_on >= today ? row.starts_on : "ended";
  return upcomingScheduleDates(row.recurrence_rule, row.starts_on, 1, today)[0] ?? "ended";
}

/** Run now creates today's occurrence of an active calendar schedule. */
export function templateCanRunNow(row: TaskTemplateDirectoryRow): boolean {
  return !isOnDemandSchedule(row) && row.is_active && row.schedule_status === "ready";
}
