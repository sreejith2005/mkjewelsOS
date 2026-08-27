import { describe, expect, it } from "vitest";
import { countTaskFeedStatuses, effectiveTaskDeadline, groupTaskFeedRows, isTaskFeedItemInCurrentDayOrOverdue, splitAssignedTaskFeed, taskMatchesStatus } from "./taskFeed";

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

  it("treats legacy in-progress work as pending until it is completed", () => {
    const tasks = [
      task("overdue", "user-1", "pending", "2026-08-06T12:00:00.000Z"),
      task("pending", "user-1"),
      task("progress", "user-1", "in_progress"),
      task("done", "user-1", "completed", "2026-08-06T12:00:00.000Z"),
    ];
    expect(countTaskFeedStatuses(tasks, now)).toEqual({ all: 4, overdue: 1, pending: 2 });
    expect(taskMatchesStatus(tasks[0]!, "overdue", now)).toBe(true);
    expect(taskMatchesStatus(tasks[0]!, "pending", now)).toBe(false);
    expect(taskMatchesStatus(tasks[2]!, "pending", now)).toBe(true);
  });

  it("keeps today pending work with independently overdue prior occurrences", () => {
    const start = "2026-08-07T00:00:00.000+05:30";
    const end = "2026-08-07T23:59:59.999+05:30";

    expect(isTaskFeedItemInCurrentDayOrOverdue(task("yesterday", "user-1", "pending", "2026-08-06T12:00:00.000Z"), start, end, now)).toBe(true);
    expect(isTaskFeedItemInCurrentDayOrOverdue(task("today", "user-1", "pending", "2026-08-07T12:00:00.000Z"), start, end, now)).toBe(true);
    expect(isTaskFeedItemInCurrentDayOrOverdue(task("tomorrow", "user-1", "pending", "2026-08-08T12:00:00.000Z"), start, end, now)).toBe(false);
    expect(isTaskFeedItemInCurrentDayOrOverdue(task("rejected", "user-1", "rejected", "2026-08-06T12:00:00.000Z"), start, end, now)).toBe(false);
  });

  it("puts assigned checklist work in My Tasks and assigned delegation work in Delegated", () => {
    const assigned = [
      { ...task("personal", "viewer"), task_type: "checklist" },
      { ...task("recurring", "viewer"), task_type: "checklist", task_template_id: "template" },
      { ...task("delegated", "viewer"), task_type: "delegation" },
    ];
    expect(splitAssignedTaskFeed(assigned)).toEqual({ myTasks: assigned.slice(0, 2), delegatedTasks: assigned.slice(2) });
  });

  it("uses revised, then independent due, then planned datetime", () => {
    expect(effectiveTaskDeadline({ planned_datetime: "planned", due_datetime: "due", revised_datetime: null })).toBe("due");
    expect(effectiveTaskDeadline({ planned_datetime: "planned", due_datetime: "due", revised_datetime: "revised" })).toBe("revised");
  });
});
