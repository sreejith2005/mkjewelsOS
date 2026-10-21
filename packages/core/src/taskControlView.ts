/**
 * Task Control's presentation decisions: who may see which panel, what each
 * panel is called, and the two derivations its rows need.
 *
 * These sat inline in `apps/web/src/pages/TaskTemplatesPage.tsx` and in its tab
 * components. Both clients draw the same workspace, so they live here and both
 * consume them. Nothing here grants access — the RPCs and RLS do that; hiding a
 * tab is presentation, as rule 4 of the playbook says.
 */

export const TASK_CONTROL_OVERSIGHT_ROLES = ["super_admin", "admin", "manager", "hr"] as const;
export const TASK_CONTROL_MANAGE_ROLES = ["super_admin", "admin"] as const;
export const TASK_CONTROL_BRANCH_SELECT_ROLES = ["super_admin", "admin", "hr"] as const;

/**
 * Task performance scores (docs/superpowers/specs/2026-09-18-task-performance-score-design.md).
 * Both are negative percentages: 0 is perfect, -100 is nothing done / nothing
 * on time. No assigned work is `null` ("No data"), never a failing score.
 */
export type TaskPerformanceCounts = Readonly<{
  assigned: number;
  completed: number;
  onTimeCompleted: number;
}>;

/** One decimal, halves away from zero -- the same as Postgres `round(numeric, 1)`. */
function roundScore(value: number): number {
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * 10)) / 10;
  return rounded === 0 ? 0 : rounded;
}

export function taskPendingScore({ assigned, completed }: TaskPerformanceCounts): number | null {
  return assigned > 0 ? roundScore((completed / assigned) * 100 - 100) : null;
}

export function taskDelayedScore({ assigned, completed, onTimeCompleted }: TaskPerformanceCounts): number | null {
  if (assigned === 0) return null;
  return completed === 0 ? -100 : roundScore((onTimeCompleted / completed) * 100 - 100);
}

/** A score for display, with a true minus sign; perfect work reads "−0.0%". */
export function formatTaskPerformanceScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "No data";
  return `−${Math.abs(value).toFixed(1)}%`;
}

export const TASK_PENDING_SCORE_LABEL = "Work not done";
export const TASK_DELAYED_SCORE_LABEL = "Work not done on time";

export const TASK_CONTROL_TAB_LABELS: ReadonlyArray<readonly ["overview" | "people" | "tasks" | "templates", string]> = [
  ["overview", "Overview"],
  ["people", "People"],
  ["tasks", "Tasks"],
  ["templates", "Templates"],
];

export const TASK_CONTROL_TAB_DESCRIPTIONS: Readonly<Record<string, string>> = {
  overview: "Who is behind, what is overdue, and which evidence is still missing.",
  people: "Assigned, completed, remaining and overdue work for every person in scope.",
  tasks: "Every piece of work assigned in scope — one-time, recurring, FMS and CRM — each labelled with its type.",
  templates: "Recurring rules, schedules and source-linked task templates.",
};

/** Task Control opens at all only for a leader. */
export const canViewTaskControl = (role: string): boolean =>
  (TASK_CONTROL_OVERSIGHT_ROLES as readonly string[]).includes(role);

/** Only these roles get the Templates tab and the Add Task / row actions. */
export const canManageTaskTemplates = (role: string): boolean =>
  (TASK_CONTROL_MANAGE_ROLES as readonly string[]).includes(role);

/**
 * A manager is pinned to their own branch by the server, so the branch control
 * is hidden from them rather than offering a scope the RPC would reject.
 */
export const canSelectTaskControlBranch = (role: string): boolean =>
  (TASK_CONTROL_BRANCH_SELECT_ROLES as readonly string[]).includes(role);

/** Templates is the one tab that depends on the viewer's role. */
export function taskControlTabsFor(role: string): readonly ("overview" | "people" | "tasks" | "templates")[] {
  return TASK_CONTROL_TAB_LABELS.map(([value]) => value).filter(
    (tab) => tab !== "templates" || canManageTaskTemplates(role),
  );
}

/** The search box appears only where the server-side search actually applies. */
export const taskControlShowsSearch = (tab: string): boolean => tab === "tasks" || tab === "templates";

/** The seven chips over the evidence list, in the web page's order and wording. */
export const TASK_VIEW_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["all", "All tasks"],
  ["remaining", "Not completed"],
  ["overdue", "Overdue"],
  ["completed", "Completed"],
  ["checklist", "Checklist"],
  ["upload", "Upload"],
  ["awaiting_evidence", "Awaiting evidence"],
];

/**
 * What a Task Control row is. The server derives it once
 * (`get_task_evidence_workspace`, migration 0285): FMS steps and start forms
 * come from the FMS tables, CRM from the task's source, recurring from its
 * template link, and everything else is one-time work.
 */
export type TaskWorkKind = "one_time" | "recurring" | "crm" | "fms_step" | "fms_start";
export type TaskWorkKindFilter = "all" | "one_time" | "recurring" | "crm" | "fms";

/** The type chips over the list, in display order. */
export const TASK_WORK_KIND_FILTERS: ReadonlyArray<readonly [TaskWorkKindFilter, string]> = [
  ["all", "All types"],
  ["one_time", "One-time"],
  ["recurring", "Recurring"],
  ["fms", "FMS"],
  ["crm", "CRM"],
];

export const TASK_WORK_KIND_LABELS: Readonly<Record<TaskWorkKind, string>> = {
  one_time: "One-time",
  recurring: "Recurring",
  crm: "CRM",
  fms_step: "FMS step",
  fms_start: "FMS start",
};

/**
 * A row's kind. A server that predates 0285 sends no `work_kind`; its FMS rows
 * are still typed `fms`, and the rest cannot be told apart, so they read as
 * one-time rather than as a guess.
 */
export function taskWorkKind(row: Readonly<{ work_kind?: string | null; task_type: string }>): TaskWorkKind {
  const kind = row.work_kind;
  if (kind && Object.prototype.hasOwnProperty.call(TASK_WORK_KIND_LABELS, kind)) return kind as TaskWorkKind;
  return row.task_type === "fms" ? "fms_step" : "one_time";
}

export const isFmsWorkKind = (kind: TaskWorkKind): boolean => kind === "fms_step" || kind === "fms_start";

/** FMS work Task Control can still cancel: finished FMS history is never removed. */
export const OPEN_FMS_WORK_STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "in_review", "overdue"]);

/**
 * Whether a Task Control row can be deleted (singly or in bulk): every Tasks-section
 * row, and FMS work only while it is still open.
 */
export function canDeleteTaskControlRow(row: Readonly<{ work_kind?: string | null; task_type: string; task_status: string }>): boolean {
  return !isFmsWorkKind(taskWorkKind(row)) || OPEN_FMS_WORK_STATUSES.has(row.task_status);
}

/** Byte counts as the evidence panels print them. */
export function evidenceFileSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1_048_576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** A template's start date, in the tenant's own calendar. */
export function prettyTemplateDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00+05:30`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      });
}

/** A template's start or due clock time, as a 12-hour label. */
export function prettyTemplateTime(value: string | null): string {
  if (!value) return "—";
  const [hours, minutes] = value.split(":");
  const hour = Number(hours);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(display).padStart(2, "0")}:${minutes ?? "00"} ${suffix}`;
}

/** The dot beside a task row: completed, rejected, overdue, or still running. */
export function taskRowTone(row: {
  task_status: string;
  overdue: boolean;
}): "success" | "danger" | "warning" {
  if (row.task_status === "completed") return "success";
  if (row.task_status === "rejected") return "danger";
  return row.overdue ? "danger" : "warning";
}

/** What the evidence cell says when there is no file on the row. */
export function evidenceCellState(row: {
  attachments: readonly unknown[];
  requires_upload: boolean;
}): "files" | "missing" | "not-required" {
  if (row.attachments.length > 0) return "files";
  return row.requires_upload ? "missing" : "not-required";
}

/**
 * Schedules have no occurrence date/status; full deletion scopes their owner and work type.
 * A schedule is recurring work, so a list narrowed to another kind (one-time, CRM, FMS)
 * never pulls schedules into "Delete all matching".
 */
export function taskControlScheduleMatchesBulkScope(
  row: Readonly<{ branch_id: string | null; department_id: string | null; assignee_user_id: string | null; task_type: string; requires_upload: boolean }>,
  filter: Readonly<Record<string, string | number | undefined>>,
): boolean {
  const upload = row.task_type === "delegation" || row.requires_upload;
  return (!filter.kind || filter.kind === "all" || filter.kind === "recurring")
    && (!filter.branch_id || row.branch_id === filter.branch_id)
    && (!filter.department_id || row.department_id === filter.department_id)
    && (!filter.user_profile_id || row.assignee_user_id === filter.user_profile_id)
    && (filter.view !== "checklist" || !upload)
    && (!["upload", "awaiting_evidence"].includes(String(filter.view)) || upload);
}
