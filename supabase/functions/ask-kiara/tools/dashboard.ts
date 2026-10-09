import {
  type ExecutorContext,
  type ToolArgs,
  type ToolOutcome,
  argText,
  isOutcome,
  isRecord,
  num,
  outcomeForError,
  kiaraRangeOrNull,
  resolveOne,
  selectByIds,
  text,
} from "./shared.ts";

/** Dashboard metrics Kiara passes on. The retired public CRM counts are dropped. */
export const DASHBOARD_METRIC_KEYS = [
  "tasks_assigned", "tasks_completed", "task_completion_rate", "task_pending_score", "task_delayed_score",
  "on_time_completed", "overdue_open", "average_completion_delay", "checklist_completion",
  "active_fms_stages", "completed_fms_stages", "fms_sla_breaches", "forms_submitted", "forms_awaiting_submission",
  "unread_notifications", "active_people", "people_available", "people_availability_rate",
  "fms_instances_active", "form_reviews_pending", "notification_delivery_health",
] as const;

function pick(source: unknown, keys: readonly string[]): Record<string, number | null> {
  const record = isRecord(source) ? source : {};
  return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, num(record[key])]));
}

/**
 * `get_dashboard_metrics` mirrors the Dashboard section: the same
 * `get_dashboard_metrics` RPC the Dashboard calls, as the caller, so its own
 * scope rules apply (assigned work for staff, the manager's branch, the tenant
 * for admins; the section gate is inside the RPC). The previous period of the
 * same length comes from the RPC too.
 */
export async function getDashboardMetrics(context: ExecutorContext, args: ToolArgs): Promise<ToolOutcome> {
  const { actor } = context;
  // Without a period the Dashboard's own default (today) applies.
  const range = kiaraRangeOrNull(args, context, 366);
  if (isOutcome(range)) return range;
  const branch = await resolveOne(actor, "branches", argText(args, "branch"));
  if (isOutcome(branch)) return branch;
  const department = await resolveOne(actor, "departments", argText(args, "department"));
  if (isOutcome(department)) return department;

  const filters: Record<string, string> = range ? { preset: "custom", from: range.from, to: range.to } : { preset: "today" };
  if (branch) filters.branch_id = branch.id;
  if (department) filters.department_id = department.id;
  const { data, error } = await actor.rpc("get_dashboard_metrics", { p_context: filters });
  if (error) return outcomeForError(error);
  if (!isRecord(data)) return { result: { error: "unavailable", message: "This information could not be loaded right now." }, isError: true };

  const scope = isRecord(data.context) ? data.context : {};
  const scopeBranch = text(scope.branch_id);
  const scopeDepartment = text(scope.department_id);
  const names = await selectByIds(actor, "branches", "id,name", scopeBranch ? [scopeBranch] : []);
  const departments = await selectByIds(actor, "departments", "id,name", scopeDepartment ? [scopeDepartment] : []);
  // The RPC's context reports the base role, but its task scope follows
  // dashboard authority (`current_profile()`), so the label uses the effective role.
  const role = context.effectiveRole;
  const ownOnly = role !== "super_admin" && role !== "admin" && role !== "manager";

  return {
    result: {
      period: { from: text(scope.local_start), to_exclusive: text(scope.local_end_exclusive) },
      scope: ownOnly
        ? "Only work assigned to the user (their Dashboard scope)."
        : scopeBranch
          ? `Branch ${isOutcome(names) ? "" : names[0]?.name ?? ""}`.trim()
          : "All branches",
      ...(scopeDepartment && !isOutcome(departments) ? { department: departments[0]?.name ?? null } : {}),
      metrics: pick(data.metrics, DASHBOARD_METRIC_KEYS),
      previous_period: pick(data.previous, ["tasks_assigned", "tasks_completed", "task_pending_score", "task_delayed_score"]),
      task_status_counts: isRecord(data.task_status_distribution) ? pick(data.task_status_distribution, Object.keys(data.task_status_distribution)) : {},
      notes: "Scores: pending score = completed share of assigned minus 100; delayed score = on-time share of completed minus 100 (0 is best). overdue_open counts all open overdue work in scope, not only this period.",
    },
    isError: false,
  };
}
