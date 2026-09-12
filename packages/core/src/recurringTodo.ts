import { isTaskFeedItemOverdue, type TaskFeedLike } from "./taskFeed";

/**
 * The Recurring / To-Do workspace, reduced to decisions.
 *
 * These rules used to live inside `apps/web/src/pages/RecurringTodoPage.tsx`
 * and `apps/web/src/features/tasks/TaskForms.tsx`. They decide which
 * occurrences a bucket shows, which actions a card offers, whether a remark is
 * owed, and what a saved schedule sends to the server. A phone and a browser
 * must not be able to disagree about any of it, so they live here and both
 * clients call them.
 *
 * Everything here is presentation-level: the RPCs re-check the caller. What
 * these functions return decides what is *shown*, never what is *allowed*.
 */

export type RecurringTodoTab =
  | "today"
  | "overdue"
  | "rejected"
  | "completed"
  | "coverage"
  | "manager_review"
  | "my_work"
  | "schedules"
  | "verification"
  | "followups"
  | "performance";

/** The buckets, in the order and with the wording the approved web page uses. */
export const RECURRING_TODO_TABS: ReadonlyArray<readonly [RecurringTodoTab, string]> = [
  ["today", "Today"],
  ["overdue", "Overdue"],
  ["rejected", "Rejected"],
  ["completed", "Completed"],
  ["coverage", "Coverage Required"],
  ["manager_review", "Manager Review"],
  ["my_work", "My Work"],
  ["schedules", "Schedules"],
  ["verification", "Verification"],
  ["followups", "Follow-ups"],
  ["performance", "Performance"],
];

/**
 * One occurrence, reduced to the fields the workspace decides on.
 *
 * A `task_instances` row carries its assignees as a list rather than the feed's
 * single `assignee_id`, so that one field is optional here.
 */
export type RecurringInstanceLike = Omit<TaskFeedLike, "assignee_id"> &
  Readonly<{
    assignee_id?: string | null;
    task_type?: string | null;
    task_template_id?: string | null;
    coverage_status?: string | null;
    verification_status?: string | null;
    verifier_user_profile_id?: string | null;
    requires_form?: boolean | null;
    requires_upload?: boolean | null;
    requires_remark?: boolean | null;
    form_template_id?: string | null;
    has_attachment?: boolean;
    has_form_submission?: boolean;
    on_time_status?: string | null;
    completion_mode?: string | null;
    assignees?: ReadonlyArray<{ id: string; name: string }>;
    checklist?: ReadonlyArray<{ is_required?: boolean | null; is_completed?: boolean | null }>;
  }>;

/**
 * Keeps stored workflow state intact while displaying a missed occurrence as
 * overdue.
 */
export function recurringInstanceDisplayStatus(
  instance: Pick<RecurringInstanceLike, "actual_datetime" | "due_datetime" | "id" | "planned_datetime" | "revised_datetime" | "status">,
  now: Date | string = new Date(),
): string | null {
  if (["completed", "rejected", "blocked"].includes(instance.status ?? "")) return instance.status;
  return isTaskFeedItemOverdue({ ...instance, assignee_id: null }, now) ? "overdue" : instance.status;
}

/**
 * A rejected verification withdraws the completion, so the occurrence is work
 * the doer still owes rather than finished work.
 */
export function recurringInstanceNeedsWork(instance: Pick<RecurringInstanceLike, "status">): boolean {
  return instance.status !== "completed" && instance.status !== "blocked";
}

function assigneeIds(task: RecurringInstanceLike): readonly string[] {
  return (task.assignees ?? []).map((assignee) => assignee.id);
}

/**
 * Whether a bucket shows this occurrence.
 *
 * `todayKey` and `plannedKey` are supplied by the caller because the calendar
 * day is a Kolkata day, and formatting it is the caller's concern.
 */
export function isRecurringInstanceInTab(input: {
  task: RecurringInstanceLike;
  tab: RecurringTodoTab;
  viewerId: string | null | undefined;
  todayKey: string;
  plannedKey: string;
  followupEnabled: boolean;
  now?: Date | string;
}): boolean {
  const { task, tab, viewerId, todayKey, plannedKey, followupEnabled } = input;
  const now = input.now ?? new Date();
  if (tab === "today") return plannedKey === todayKey && task.status !== "completed";
  if (tab === "overdue") return recurringInstanceDisplayStatus(task, now) === "overdue";
  if (tab === "rejected") return task.status === "rejected";
  if (tab === "completed") return task.status === "completed";
  if (tab === "coverage") return task.coverage_status === "coverage_required";
  if (tab === "manager_review") return task.coverage_status === "manager_review";
  if (tab === "my_work") return assigneeIds(task).some((id) => id === viewerId);
  if (tab === "verification") return task.status === "completed" && task.verification_status === "pending";
  if (tab === "followups")
    return recurringInstanceNeedsWork(task) && Boolean(task.task_template_id && followupEnabled);
  return false;
}

/** One row of the Performance table. */
export type RecurringPerformanceRow = Readonly<{
  name: string;
  assigned: number;
  completed: number;
  verified: number;
  onTime: number;
  delayed: number;
  onBehalf: number;
}>;

/** Per-employee totals across the loaded occurrences, best completion first. */
export function recurringPerformanceRows(
  instances: readonly RecurringInstanceLike[],
): RecurringPerformanceRow[] {
  const rows = new Map<string, { name: string; assigned: number; completed: number; verified: number; onTime: number; delayed: number; onBehalf: number }>();
  for (const task of instances)
    for (const assignee of task.assignees ?? []) {
      const current = rows.get(assignee.id) ?? {
        name: assignee.name,
        assigned: 0,
        completed: 0,
        verified: 0,
        onTime: 0,
        delayed: 0,
        onBehalf: 0,
      };
      current.assigned += 1;
      if (task.status === "completed") current.completed += 1;
      if (task.verification_status === "verified") current.verified += 1;
      if (task.on_time_status === "on_time") current.onTime += 1;
      if (task.on_time_status === "delayed") current.delayed += 1;
      if (task.completion_mode === "on_behalf") current.onBehalf += 1;
      rows.set(assignee.id, current);
    }
  return [...rows.values()].sort(
    (left, right) => right.completed - left.completed || left.name.localeCompare(right.name),
  );
}

/** The percentages the Performance table prints beside the counts. */
export function recurringPerformancePercents(row: RecurringPerformanceRow): Readonly<{ completion: number; onTime: number }> {
  return {
    completion: row.assigned ? Math.round((row.completed / row.assigned) * 100) : 0,
    onTime: row.onTime + row.delayed ? Math.round((row.onTime / (row.onTime + row.delayed)) * 100) : 0,
  };
}

export type RecurringStatusTone = "danger" | "warning" | "success" | "neutral";

/** The label and tone of the pill on a work card. */
export function recurringStatusPill(
  task: RecurringInstanceLike,
  now: Date | string = new Date(),
): Readonly<{ label: string; tone: RecurringStatusTone }> {
  const special = task.coverage_status;
  const displayStatus = recurringInstanceDisplayStatus(task, now);
  const label = special ?? displayStatus;
  const tone: RecurringStatusTone =
    special === "coverage_required" || displayStatus === "overdue"
      ? "danger"
      : special === "manager_review"
        ? "warning"
        : displayStatus === "completed"
          ? "success"
          : "neutral";
  return { label: label ?? "pending", tone };
}

/**
 * `get_recurring_todo_workspace` admits super_admin and admin only, so the
 * manager-only affordances this workspace renders could never run for anyone
 * else. The check is by role rather than by permission key because the RPC's
 * own grant is by role.
 */
export function canManageRecurringWorkspace(role: string | null | undefined): boolean {
  return !!role && ["super_admin", "admin"].includes(role);
}

export type RecurringWorkCardState = Readonly<{
  isOwnWork: boolean;
  canVerify: boolean;
  /** Every required checklist item done, and any owed evidence supplied. */
  canComplete: boolean;
  /**
   * A template that requires a remark and an on-behalf completion both have to
   * be explained, so neither may be completed silently.
   */
  needsRemark: boolean;
  /** The question to ask for that remark. */
  remarkPrompt: string;
  showCompleteForm: boolean;
  /** The form action is offered but the version is not readable by this account. */
  completeFormDisabled: boolean;
  showCompleteChecklist: boolean;
  showComplete: boolean;
  showUpload: boolean;
  showFollowup: boolean;
  showVerify: boolean;
  /** Checklist items are hidden when a form carries the work instead. */
  showChecklist: boolean;
}>;

/** Decides what one Recurring / To-Do work card offers. */
export function deriveRecurringWorkCardState(input: {
  task: RecurringInstanceLike;
  viewerId: string | null | undefined;
  canManage: boolean;
  followupEnabled: boolean;
}): RecurringWorkCardState {
  const { task, viewerId, canManage, followupEnabled } = input;
  const isOwnWork = assigneeIds(task).some((id) => id === viewerId);
  const canVerify = canManage || task.verifier_user_profile_id === viewerId;
  const needsRemark = Boolean(task.requires_remark) || !isOwnWork;
  const requiresForm = Boolean(task.requires_form);
  const completed = task.status === "completed";
  const coverageRequired = task.coverage_status === "coverage_required";
  const canComplete =
    (task.checklist ?? []).filter((item) => item.is_required).every((item) => item.is_completed) &&
    (!task.requires_upload || Boolean(task.has_attachment)) &&
    (!task.requires_form || Boolean(task.has_form_submission));
  return {
    isOwnWork,
    canVerify,
    canComplete,
    needsRemark,
    remarkPrompt: isOwnWork ? "Completion remark" : "Why are you completing this on behalf of the doer?",
    showCompleteForm: requiresForm && !completed && !coverageRequired,
    completeFormDisabled: !task.form_template_id,
    showCompleteChecklist: !requiresForm && task.task_type === "checklist" && !completed,
    showComplete: !requiresForm && task.task_type !== "checklist" && !completed && !coverageRequired && canComplete,
    showUpload:
      !requiresForm && task.task_type === "delegation" && Boolean(task.requires_upload) && !task.has_attachment,
    showFollowup: !requiresForm && followupEnabled && canManage && !completed,
    showVerify: !requiresForm && canVerify && completed && task.verification_status === "pending",
    showChecklist: !requiresForm && (task.checklist ?? []).length > 0,
  };
}

/** The filter option values the workspace offers, in the web page's order. */
export const RECURRING_STATUS_FILTERS = ["pending", "in_progress", "completed", "rejected", "blocked"] as const;
export const RECURRING_PRIORITY_FILTERS = ["high", "medium", "low"] as const;
export const RECURRING_FREQUENCY_FILTERS = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
  "one_time",
  "as_required",
  "recurring",
] as const;

/** The stat tiles above the buckets, in the web page's order and wording. */
export const RECURRING_STAT_TILES: ReadonlyArray<readonly [string, string]> = [
  ["Total", "total"],
  ["Pending", "pending"],
  ["In progress", "in_progress"],
  ["Completed", "completed"],
  ["Overdue", "overdue"],
  ["Rejected", "rejected"],
  ["On time", "on_time"],
  ["Delayed", "delayed"],
  ["On behalf", "completed_on_behalf"],
  ["Coverage required", "coverage_required"],
  ["Manager review", "manager_review"],
];

/* ------------------------------------------------------------------ *
 * Schedule authoring — the rules behind the New / Edit schedule form. *
 * ------------------------------------------------------------------ */

/** Frequency value, the label the form shows, and the rule it saves. */
export const RECURRING_FREQUENCIES = [
  ["daily", "DAILY", "FREQ=DAILY"],
  ["weekly", "WEEKLY", "FREQ=WEEKLY"],
  ["monthly", "MONTHLY", "FREQ=MONTHLY"],
  ["quarterly", "QUARTERLY", "FREQ=MONTHLY;INTERVAL=3"],
  ["yearly", "YEARLY", "FREQ=YEARLY"],
  ["one_time", "ONE TIME", "FREQ=DAILY;COUNT=1"],
  ["as_required", "AS REQUIRED", "FREQ=DAILY;COUNT=1"],
] as const;

/** Falls back to daily for a schedule kind the form cannot represent. */
export function recurringTemplateFrequency(template: { schedule_kind?: string | null } | null | undefined): string {
  const kind = template?.schedule_kind;
  if (!kind) return "daily";
  return RECURRING_FREQUENCIES.some(([value]) => value === kind) ? kind : "daily";
}

export function recurringRecurrenceRule(frequency: string): string {
  return RECURRING_FREQUENCIES.find(([value]) => value === frequency)?.[2] ?? "FREQ=DAILY";
}

export type RecurringTemplateDraft = Readonly<{
  title: string;
  description: string;
  frequency: string;
  start: string;
  startTime: string;
  dueTime: string;
  mode: "task" | "checklist";
  buddy: boolean;
}>;

export type RecurringTemplateAssignee = Readonly<{
  id: string;
  branch_id: string | null;
  department_id: string | null;
}>;

/**
 * The web form's own validation, in its own words. The due time must be later
 * than the start time; everything else is simply required.
 */
export function validateRecurringTemplateDraft(
  draft: RecurringTemplateDraft,
  assignee: RecurringTemplateAssignee | null | undefined,
): string | null {
  if (!assignee || !draft.title || !draft.start || !draft.startTime || !draft.dueTime)
    return "Complete all required task details.";
  if (draft.dueTime <= draft.startTime) return "Due Time must be later than the Scheduled Start Time.";
  return null;
}

/** The payload `save_recurring_todo_template_with_audit` is given. */
export function buildRecurringTemplatePayload(
  draft: RecurringTemplateDraft,
  assignee: RecurringTemplateAssignee,
): Record<string, unknown> {
  return {
    title: draft.title,
    description: draft.description,
    recurrence_rule: recurringRecurrenceRule(draft.frequency),
    schedule_kind: draft.frequency,
    starts_on: draft.start,
    planned_time: draft.startTime,
    due_time: draft.dueTime,
    priority: "medium",
    branch_id: assignee.branch_id,
    department_id: assignee.department_id,
    default_assignee_type: "specific_user",
    default_assignee_user_id: assignee.id,
    default_assignee_role: "",
    task_type: draft.mode === "task" ? "delegation" : "checklist",
    buddy_assignment_allowed: draft.buddy,
    checklist_items: [],
    requires_upload: draft.mode === "task",
    requires_remark: false,
    requires_form: false,
    form_template_id: "",
    is_active: true,
    verification_required: false,
    verifier_user_profile_id: "",
    followup_enabled: false,
    personal_performance_enabled: true,
  };
}

/**
 * A schedule may be paused only when it actually runs on a schedule. An
 * as-required schedule has nothing to pause.
 */
export function canPauseRecurringTemplate(template: { schedule_kind?: string | null }): boolean {
  return template.schedule_kind !== "as_required";
}

/** Run now is offered for an as-required schedule even while it is inactive. */
export function canRunRecurringTemplateNow(template: {
  is_active?: boolean | null;
  schedule_kind?: string | null;
}): boolean {
  return Boolean(template.is_active) || template.schedule_kind === "as_required";
}

/** The confirmation the Delete action asks for, in the web page's wording. */
export function recurringTemplateDeletePrompt(title: string): string {
  return `Delete ${title}? Used schedules will be archived to preserve task history.`;
}
