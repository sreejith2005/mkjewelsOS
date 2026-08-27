import { describe, expect, it } from "vitest";
import { recurringInstanceDisplayStatus, type RecurringInstance } from "./model";

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
