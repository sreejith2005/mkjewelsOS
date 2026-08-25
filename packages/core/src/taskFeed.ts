import { calculateSla } from "./sla";

export type TaskFeedStatusFilter = "all" | "overdue" | "pending";

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

export function splitAssignedTaskFeed<T extends { task_type: string | null }>(tasks: readonly T[]) {
  return tasks.reduce<{ delegatedTasks: T[]; myTasks: T[] }>((result, task) => {
    (task.task_type === "delegation" ? result.delegatedTasks : result.myTasks).push(task);
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
  if (filter === "all") return true;
  const overdue = isTaskFeedItemOverdue(task, now);
  if (filter === "overdue") return overdue;
  return !overdue && task.status !== "completed";
}

export function countTaskFeedStatuses(tasks: readonly TaskFeedLike[], now: Date | string = new Date()) {
  return tasks.reduce((counts, task) => {
    counts.all += 1;
    if (isTaskFeedItemOverdue(task, now)) counts.overdue += 1;
    else if (task.status !== "completed") counts.pending += 1;
    return counts;
  }, { all: 0, overdue: 0, pending: 0 });
}
