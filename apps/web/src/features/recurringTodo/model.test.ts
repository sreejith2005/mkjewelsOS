import { describe, expect, it } from "vitest";
import {
  parseRecurringWorkspace,
  recurringInstanceDisplayStatus,
  recurringInstanceNeedsWork,
  type RecurringInstance,
} from "./model";

function instance(overrides: Partial<RecurringInstance> = {}): RecurringInstance {
  return {
    actual_datetime: null,
    assignees: [],
    checklist: [],
    due_datetime: null,
    id: "task-1",
    planned_datetime: "2026-08-26T10:00:00.000Z",
    revised_datetime: null,
    status: "pending",
    has_attachment: false,
    has_form_submission: false,
    ...overrides,
  } as RecurringInstance;
}

describe("recurringInstanceDisplayStatus", () => {
  it("shows an unfinished prior occurrence as overdue without rewriting its persisted status", () => {
    expect(recurringInstanceDisplayStatus(instance(), "2026-08-27T10:00:00.000Z")).toBe("overdue");
  });

  it("keeps an unfinished current occurrence pending", () => {
    expect(recurringInstanceDisplayStatus(instance({ planned_datetime: "2026-08-27T12:00:00.000Z" }), "2026-08-27T10:00:00.000Z")).toBe("pending");
  });
});

describe("recurringInstanceNeedsWork", () => {
  it("returns a rejected occurrence to the doer as work still owed", () => {
    expect(recurringInstanceNeedsWork(instance({ status: "rejected" }))).toBe(true);
  });

  it("treats a completed occurrence as finished", () => {
    expect(recurringInstanceNeedsWork(instance({ status: "completed" }))).toBe(false);
  });
});

describe("parseRecurringWorkspace", () => {
  it("reads the on-time, rejected and on-behalf counters the workspace now reports", () => {
    const workspace = parseRecurringWorkspace({
      templates: [],
      instances: [],
      stats: { total: 9, completed: 4, rejected: 1, on_time: 3, delayed: 1, completed_on_behalf: 2 },
    });

    expect(workspace.stats).toMatchObject({
      completed: 4,
      completed_on_behalf: 2,
      delayed: 1,
      on_time: 3,
      rejected: 1,
      total: 9,
    });
    expect(workspace.stats.manager_review).toBe(0);
  });
});
