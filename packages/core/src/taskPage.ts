import type { Json } from "./database.types";
import type { TaskFeedStatusFilter } from "./taskFeed";

export const TASK_PAGE_SIZE = 50;
export type TaskWorkspaceView = "mine" | "delegated" | "inLoop" | "all";
export type TaskPageCounts = Record<TaskFeedStatusFilter | "open", number>;
export type TaskPageScope = Readonly<{ ids: string[]; total: number; counts: TaskPageCounts }>;
export type TaskAdminEdit = Readonly<{ title: string; description: string; priority: "low" | "medium" | "high"; planned: string; due: string }>;

/** Controls edit in the application's scheduling zone, independently of device timezone. */
export function taskAdminInitialEdit(task: Readonly<{ title: string | null; description: string | null; priority: string | null; planned_datetime: string | null; due_datetime: string | null; revised_datetime: string | null }>): TaskAdminEdit {
  const local = (value: string | null) => value ? new Date(new Date(value).getTime() + 330 * 60000).toISOString().slice(0, 16) : "";
  return { title: task.title ?? "", description: task.description ?? "", priority: task.priority === "high" || task.priority === "low" ? task.priority : "medium",
    planned: local(task.planned_datetime), due: local(task.revised_datetime ?? task.due_datetime ?? task.planned_datetime) };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Validate server JSON at the boundary, rather than trusting a type assertion. */
export function decodeTaskPage(value: unknown): TaskPageScope {
  if (!record(value) || !Array.isArray(value.ids) || value.ids.length > TASK_PAGE_SIZE
    || !value.ids.every((id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    || new Set(value.ids).size !== value.ids.length || !count(value.total) || value.ids.length > value.total
    || !record(value.counts) || !count(value.counts.pending) || !count(value.counts.overdue)
    || !count(value.counts.completed) || !count(value.counts.open)
    || value.counts.open !== value.counts.pending + value.counts.overdue) throw new Error("Invalid task page response");
  return { ids: value.ids, total: value.total, counts: {
    pending: value.counts.pending, overdue: value.counts.overdue, completed: value.counts.completed, open: value.counts.open,
  } };
}

export function taskAdminEditPayload(edit: TaskAdminEdit): Json {
  const schedulingDate = (value: string) => new Date(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}+05:30` : value);
  const start = schedulingDate(edit.planned);
  const end = schedulingDate(edit.due);
  if (!edit.title.trim() || edit.title.trim().length > 300 || edit.description.length > 10000
    || !["low", "medium", "high"].includes(edit.priority)) throw new Error("Enter a title, description and valid priority.");
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) throw new Error("Enter a due time after the start time.");
  return { title: edit.title.trim(), description: edit.description.trim(), priority: edit.priority,
    planned_datetime: start.toISOString(), due_datetime: end.toISOString() };
}
