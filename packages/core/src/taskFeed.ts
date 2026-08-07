import { calculateSla } from "./sla";

export type TaskFeedStatusFilter = "all" | "overdue" | "pending" | "in_progress";

export type TaskFeedLike = Readonly<{
  actual_datetime: string | null;
  assignee_id: string | null;
  id: string | null;
  planned_datetime: string | null;
  revised_datetime: string | null;
  status: string | null;
}>;

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

export function isTaskFeedItemOverdue(task: TaskFeedLike, now: Date | string = new Date()): boolean {
  if (!task.planned_datetime || task.status === "completed") return false;
  if (task.status === "overdue") return true;
  return calculateSla(task.revised_datetime ?? task.planned_datetime, task.actual_datetime, now).status === "overdue";
}

export function taskMatchesStatus(
  task: TaskFeedLike,
  filter: TaskFeedStatusFilter,
  now: Date | string = new Date(),
): boolean {
  if (filter === "all") return true;
  const overdue = isTaskFeedItemOverdue(task, now);
  if (filter === "overdue") return overdue;
  if (filter === "pending") return task.status === "pending" && !overdue;
  return task.status === "in_progress";
}

export function countTaskFeedStatuses(tasks: readonly TaskFeedLike[], now: Date | string = new Date()) {
  return tasks.reduce((counts, task) => {
    counts.all += 1;
    if (isTaskFeedItemOverdue(task, now)) counts.overdue += 1;
    else if (task.status === "pending") counts.pending += 1;
    if (task.status === "in_progress") counts.in_progress += 1;
    return counts;
  }, { all: 0, overdue: 0, pending: 0, in_progress: 0 });
}
