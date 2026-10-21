import { kolkataDateKey } from "./recurrence";
import type { Json } from "./database.types";
import { decodeTaskPage, type TaskPageScope, type TaskWorkspaceView } from "./taskPage";
import type { TaskWorkKindFilter } from "./taskControlView";

export type TaskSearchFilters = Readonly<{
  query: string; kind: TaskWorkKindFilter; status: "all" | "pending" | "overdue" | "completed";
  priority: "all" | "high" | "medium" | "low"; from: string; to: string;
  subsection: "any" | TaskWorkspaceView; requirement: "all" | "upload" | "form" | "remark";
  sort: "due" | "newest" | "priority";
}>;
export const TASK_SUBSECTION_LABELS: Readonly<Record<TaskWorkspaceView, string>> = { mine: "My Tasks", delegated: "Delegated", inLoop: "In Loop", fms: "FMS", all: "All Tasks" };
export const defaultTaskSearch = (): TaskSearchFilters => ({ query: "", kind: "all", status: "all", priority: "all", from: "", to: "", subsection: "any", requirement: "all", sort: "due" });
export function taskSearchDateRange(preset: "today" | "week", now = new Date()): { from: string; to: string } {
  const today = kolkataDateKey(now);
  if (preset === "today") return { from: today, to: today };
  const monday = new Date(`${today}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}
export function taskSearchFilterCount(value: TaskSearchFilters): number {
  return Number(value.kind !== "all") + Number(value.status !== "all") + Number(value.priority !== "all")
    + Number(Boolean(value.from || value.to)) + Number(value.subsection !== "any")
    + Number(value.requirement !== "all") + Number(value.sort !== "due");
}
export const taskSearchActive = (value: TaskSearchFilters): boolean => Boolean(value.query.trim()) || taskSearchFilterCount(value) > 0;
export function taskSearchPayload(value: TaskSearchFilters): Json {
  const date = (day: string) => !day || (/^\d{4}-\d{2}-\d{2}$/.test(day) && !day.startsWith("0000") && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day);
  if (value.query.trim().length > 200 || !date(value.from) || !date(value.to) || (value.from && value.to && value.from > value.to)) throw new Error("Enter a valid date range and search up to 200 characters.");
  if (!["all", "one_time", "recurring", "crm", "fms"].includes(value.kind)
    || !["all", "pending", "overdue", "completed"].includes(value.status)
    || !["all", "high", "medium", "low"].includes(value.priority)
    || !["any", "mine", "delegated", "inLoop", "fms", "all"].includes(value.subsection)
    || !["all", "upload", "form", "remark"].includes(value.requirement)
    || !["due", "newest", "priority"].includes(value.sort)) throw new Error("Invalid task filter.");
  return { ...value, query: value.query.trim() };
}
export function decodeTaskSearchPage(value: unknown): TaskPageScope & { sections: Record<string, TaskWorkspaceView> } {
  const page = decodeTaskPage(value);
  if (typeof value !== "object" || value === null || !("sections" in value) || typeof value.sections !== "object" || value.sections === null || Array.isArray(value.sections)) throw new Error("Invalid task search sections");
  const sections: Record<string, TaskWorkspaceView> = {};
  for (const [id, section] of Object.entries(value.sections)) {
    if (!page.ids.includes(id) || (section !== "mine" && section !== "delegated" && section !== "inLoop" && section !== "fms" && section !== "all")) throw new Error("Invalid task search sections");
    sections[id] = section;
  }
  if (page.ids.some(id => !sections[id])) throw new Error("Invalid task search sections");
  return { ...page, sections };
}
