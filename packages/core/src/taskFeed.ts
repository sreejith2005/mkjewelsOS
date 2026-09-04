import { calculateSla } from "./sla";

export type TaskFeedStatusFilter = "completed" | "overdue" | "pending";

export type TaskFeedLike = Readonly<{
  actual_datetime: string | null;
  assignee_id: string | null;
  due_datetime?: string | null;
  id: string | null;
  planned_datetime: string | null;
  revised_datetime: string | null;
  status: string | null;
}>;

export function effectiveTaskDeadline(task: Pick<TaskFeedLike, "due_datetime" | "planned_datetime" | "revised_datetime">): string | null {
  return task.revised_datetime ?? task.due_datetime ?? task.planned_datetime;
}

export type GroupedTaskFeedRow<T extends TaskFeedLike> = Readonly<{
  assigneeIds: readonly string[];
  row: T;
}>;

export function groupTaskFeedRows<T extends TaskFeedLike>(rows: readonly T[]): GroupedTaskFeedRow<T>[] {
  const grouped = new Map<string, { assigneeIds: string[]; row: T }>();
  for (const row of rows) {
    if (!row.id) continue;
    const existing = grouped.get(row.id);
    if (!existing) {
      grouped.set(row.id, {
        assigneeIds: row.assignee_id ? [row.assignee_id] : [],
        row,
      });
      continue;
    }
    if (row.assignee_id && !existing.assigneeIds.includes(row.assignee_id)) {
      existing.assigneeIds.push(row.assignee_id);
    }
  }
  return [...grouped.values()];
}

export type SplittableAssignedTask = Readonly<{
  task_template_id?: string | null;
  task_type: string | null;
}>;

/**
 * My Tasks holds recurring work of any schedule (occurrences generated from a task template)
 * plus FMS stage work. Everything else assigned from the Tasks section is one-time work and
 * belongs in Delegated.
 */
export function isRecurringOrWorkflowTask(task: SplittableAssignedTask): boolean {
  return Boolean(task.task_template_id) || task.task_type === "fms";
}

export function splitAssignedTaskFeed<T extends SplittableAssignedTask>(tasks: readonly T[]) {
  return tasks.reduce<{ delegatedTasks: T[]; myTasks: T[] }>((result, task) => {
    (isRecurringOrWorkflowTask(task) ? result.myTasks : result.delegatedTasks).push(task);
    return result;
  }, { delegatedTasks: [], myTasks: [] });
}

export function isTaskFeedItemOverdue(task: TaskFeedLike, now: Date | string = new Date()): boolean {
  const deadline = effectiveTaskDeadline(task);
  if (!deadline || task.status === "completed") return false;
  if (task.status === "overdue") return true;
  return calculateSla(deadline, task.actual_datetime, now).status === "overdue";
}

export function taskMatchesStatus(
  task: TaskFeedLike,
  filter: TaskFeedStatusFilter,
  now: Date | string = new Date(),
): boolean {
  if (filter === "completed") return task.status === "completed";
  const overdue = isTaskFeedItemOverdue(task, now);
  if (filter === "overdue") return overdue;
  return !overdue && task.status !== "completed";
}

export function countTaskFeedStatuses(tasks: readonly TaskFeedLike[], now: Date | string = new Date()) {
  return tasks.reduce((counts, task) => {
    if (task.status === "completed") counts.completed += 1;
    else counts.open += 1;
    if (isTaskFeedItemOverdue(task, now)) counts.overdue += 1;
    else if (task.status !== "completed") counts.pending += 1;
    return counts;
  }, { completed: 0, open: 0, overdue: 0, pending: 0 });
}

/** Keeps the strict current-day board focused while retaining independently overdue work. */
export function isTaskFeedItemInCurrentDayOrOverdue(
  task: TaskFeedLike,
  start: Date | string,
  end: Date | string,
  now: Date | string = new Date(),
): boolean {
  const deadline = effectiveTaskDeadline(task);
  if (!deadline) return false;
  const deadlineMs = new Date(deadline).getTime();
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if ([deadlineMs, startMs, endMs].some(Number.isNaN)) return false;
  if (deadlineMs >= startMs && deadlineMs <= endMs) return true;
  if (["completed", "rejected", "blocked"].includes(task.status ?? "")) return false;
  return isTaskFeedItemOverdue(task, now);
}
