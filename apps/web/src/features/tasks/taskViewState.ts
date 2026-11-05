import { taskSearchPayload, type TaskDateScope, type TaskFeedStatusFilter, type TaskSearchFilters, type TaskWorkspaceView } from "@jewelos/core";

export type TaskViewState = { actorId: string; view: TaskWorkspaceView; calendarScope: TaskDateScope | null; status: TaskFeedStatusFilter; offset: number; filters: TaskSearchFilters };

/** Transient view settings only; work and counts always reload from the server. */
export function readTaskViewState(actorId: string | undefined): TaskViewState | null {
  if (!actorId) return null;
  const value: unknown = window.history.state?.taskView;
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.actorId !== actorId || typeof row.view !== "string" || !["mine", "delegated", "inLoop", "fms", "all"].includes(row.view)
    || row.calendarScope !== null && (typeof row.calendarScope !== "string" || !["today", "overall", "overdue"].includes(row.calendarScope))
    || typeof row.status !== "string" || !["pending", "overdue", "completed"].includes(row.status)
    || typeof row.offset !== "number" || !Number.isInteger(row.offset) || row.offset < 0
    || !row.filters || typeof row.filters !== "object") return null;
  const filters = row.filters as Record<string, unknown>;
  if (!["query", "kind", "status", "priority", "from", "to", "subsection", "requirement", "sort"].every(key => typeof filters[key] === "string")) return null;
  // The shape above and the shared validator below check every field of this UI snapshot.
  try { taskSearchPayload(filters as TaskSearchFilters); } catch { return null; }
  return row as TaskViewState;
}

export function saveTaskViewState(state: TaskViewState): void {
  window.history.replaceState({ ...window.history.state, taskView: state }, "");
}
