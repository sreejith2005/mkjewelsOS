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

export const TASK_CONTROL_TAB_LABELS: ReadonlyArray<readonly ["overview" | "people" | "tasks" | "templates", string]> = [
  ["overview", "Overview"],
  ["people", "People"],
  ["tasks", "Tasks"],
  ["templates", "Templates"],
];

export const TASK_CONTROL_TAB_DESCRIPTIONS: Readonly<Record<string, string>> = {
  overview: "Who is behind, what is overdue, and which evidence is still missing.",
  people: "Assigned, completed, remaining and overdue work for every person in scope.",
  tasks: "Every task assigned in scope — checklist and upload alike — with its evidence on the row.",
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
    : parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
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
