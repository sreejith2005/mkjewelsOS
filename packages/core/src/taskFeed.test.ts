import { describe, expect, it } from "vitest";
import { countTaskFeedStatuses, groupTaskFeedRows, taskMatchesStatus } from "./taskFeed";

const now = "2026-08-07T12:00:00.000Z";

function task(id: string, assignee: string | null, status = "pending", planned = "2026-08-08T12:00:00.000Z") {
  return {
    actual_datetime: null,
    assignee_id: assignee,
    id,
    planned_datetime: planned,
    revised_datetime: null,
    status,
  };
}

describe("task feed presentation", () => {
  it("groups repeated doer rows into one task", () => {
    const grouped = groupTaskFeedRows([task("task-1", "user-1"), task("task-1", "user-2"), task("task-2", null)]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]?.assigneeIds).toEqual(["user-1", "user-2"]);
    expect(grouped[1]?.assigneeIds).toEqual([]);
  });

  it("derives truthful, mutually useful counts", () => {
    const tasks = [
      task("overdue", "user-1", "pending", "2026-08-06T12:00:00.000Z"),
      task("pending", "user-1"),
      task("progress", "user-1", "in_progress"),
      task("done", "user-1", "completed", "2026-08-06T12:00:00.000Z"),
    ];
    expect(countTaskFeedStatuses(tasks, now)).toEqual({ all: 4, overdue: 1, pending: 1, in_progress: 1 });
    expect(taskMatchesStatus(tasks[0]!, "overdue", now)).toBe(true);
    expect(taskMatchesStatus(tasks[0]!, "pending", now)).toBe(false);
  });
});
