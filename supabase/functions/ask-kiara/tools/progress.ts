import { resolveKiaraPeriod } from "../../../../packages/core/src/assistant/period.ts";
import {
  type ExecutorContext,
  type ToolArgs,
  type ToolOutcome,
  argText,
  isOutcome,
  isRecord,
  localTime,
  num,
  outcomeForError,
  rangeFor,
  records,
  resolveOne,
  text,
  untrusted,
} from "./shared.ts";

export const PROGRESS_EMPLOYEE_CAP = 30;
export const PROGRESS_GROUP_CAP = 30;
export const OVERDUE_TASK_CAP = 10;

const counts = (row: Record<string, unknown>) => ({
  assigned: num(row.assigned),
  completed: num(row.completed),
  on_time_completed: num(row.on_time_completed),
  remaining: num(row.remaining),
  overdue: num(row.overdue),
});

/**
 * `get_team_progress` mirrors Task Control: `get_employee_task_progress` (the
 * Progress tab) and `get_task_evidence_workspace` with view "overdue" (the task
 * list), the same RPCs Task Control calls, as the caller. Both clamp a manager
 * to their own branch and refuse roles below manager (42501), so Kiara never
 * answers a team question from the wider raw task RLS (spec 3.2).
 */
export async function getTeamProgress(context: ExecutorContext, args: ToolArgs): Promise<ToolOutcome> {
  const { actor, timeZone } = context;
  // Task Control's task list defaults to the last 30 days; Kiara uses the same window.
  const range = rangeFor(args, context, ({ now, timeZone: zone }) => resolveKiaraPeriod("last_30_days", now, zone));
  if (isOutcome(range)) return range;
  const branch = await resolveOne(actor, "branches", argText(args, "branch"));
  if (isOutcome(branch)) return branch;
  const department = await resolveOne(actor, "departments", argText(args, "department"));
  if (isOutcome(department)) return department;

  const filter: Record<string, string | number> = { from: range.from, to: range.to };
  if (branch) filter.branch_id = branch.id;
  if (department) filter.department_id = department.id;
  const [progress, overdue] = await Promise.all([
    actor.rpc("get_employee_task_progress", { p_context: filter }),
    actor.rpc("get_task_evidence_workspace", { p_filter: { ...filter, view: "overdue", page: 1, page_size: OVERDUE_TASK_CAP } }),
  ]);
  if (progress.error) return outcomeForError(progress.error);
  if (overdue.error) return outcomeForError(overdue.error);
  if (!isRecord(progress.data) || !isRecord(overdue.data)) return { result: { error: "unavailable", message: "This information could not be loaded right now." }, isError: true };

  const employeeName = argText(args, "employee_name")?.toLocaleLowerCase() ?? null;
  const employees = records(progress.data.employees)
    .filter((row) => !employeeName || (text(row.employee_name)?.toLocaleLowerCase().includes(employeeName) ?? false))
    .map((row) => ({ name: text(row.employee_name), branch: text(row.branch_name), department: text(row.department_name), ...counts(row) }))
    // Most overdue first, then by name: the order the questions ask for.
    .sort((left, right) => (right.overdue ?? 0) - (left.overdue ?? 0) || (left.name ?? "").localeCompare(right.name ?? ""));
  const departments = records(progress.data.departments).map((row) => ({ department: text(row.department_name), ...counts(row) }));
  const branches = records(progress.data.branches).map((row) => ({ branch: text(row.branch_name), ...counts(row) }));
  const overdueTasks = records(overdue.data.tasks).map((row) => ({
    title: untrusted(row.task_title),
    assignees: text(row.assignee_names),
    branch: text(row.branch_name),
    department: text(row.department_name),
    status: text(row.task_status),
    due: localTime(text(row.due_datetime) ?? text(row.planned_datetime), timeZone),
  }));
  const overdueTotal = num(overdue.data.tasks_total) ?? overdueTasks.length;
  const truncated = employees.length > PROGRESS_EMPLOYEE_CAP || departments.length > PROGRESS_GROUP_CAP || branches.length > PROGRESS_GROUP_CAP || overdueTotal > overdueTasks.length;

  return {
    result: {
      period: { from: range.from, to: range.to, counts_tasks_planned_in_period: true },
      ...(branch ? { branch: branch.name } : {}),
      ...(department ? { department: department.name } : {}),
      employees: employees.slice(0, PROGRESS_EMPLOYEE_CAP),
      employees_total: employees.length,
      departments: departments.slice(0, PROGRESS_GROUP_CAP),
      branches: branches.slice(0, PROGRESS_GROUP_CAP),
      overdue_tasks: overdueTasks,
      overdue_tasks_total: overdueTotal,
      ...(truncated ? { truncated: true } : {}),
      scope: "Task Control scope: managers see their own branch, admins and super admins the company.",
    },
    isError: false,
  };
}
