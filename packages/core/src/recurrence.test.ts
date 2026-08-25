import { describe, expect, it } from "vitest";
import {
  isUserAvailableForRecurringTask,
  kolkataDateKey,
  resolveRecurringAssignment,
  shouldGenerateRecurringTask,
  type RecurringAvailabilityProfile,
} from "./recurrence";

const doer: RecurringAvailabilityProfile = {
  buddy_id: "buddy-1",
  id: "doer-1",
  reports_to_user_id: "manager-1",
  secondary_buddy_id: "buddy-2",
  week_off: ["Sunday"],
  working_status: "active",
};
const buddy: RecurringAvailabilityProfile = {
  buddy_id: null,
  id: "buddy-1",
  reports_to_user_id: null,
  secondary_buddy_id: null,
  week_off: ["Sunday"],
  working_status: "active",
};

describe("shouldGenerateRecurringTask", () => {
  it("expands daily rules", () => {
    expect(shouldGenerateRecurringTask("FREQ=DAILY", "2026-08-07")).toBe(true);
  });

  it("anchors interval-based weekly schedules to the date the schedule starts", () => {
    expect(shouldGenerateRecurringTask("FREQ=WEEKLY;INTERVAL=2", "2026-08-03", "2026-08-03")).toBe(true);
    expect(shouldGenerateRecurringTask("FREQ=WEEKLY;INTERVAL=2", "2026-08-10", "2026-08-03")).toBe(false);
    expect(shouldGenerateRecurringTask("FREQ=WEEKLY;INTERVAL=2", "2026-08-17", "2026-08-03")).toBe(true);
  });

  it("does not generate a yearly schedule before its scheduled start date", () => {
    expect(shouldGenerateRecurringTask("FREQ=YEARLY", "2026-08-07", "2027-08-07")).toBe(false);
    expect(shouldGenerateRecurringTask("FREQ=YEARLY", "2027-08-07", "2027-08-07")).toBe(true);
  });

  it("honors selected weekdays", () => {
    const rule = "FREQ=WEEKLY;BYDAY=MO,FR";
    expect(shouldGenerateRecurringTask(rule, "2026-08-07")).toBe(true);
    expect(shouldGenerateRecurringTask(rule, "2026-08-08")).toBe(false);
  });

  it("honors a monthly day of month", () => {
    const rule = "FREQ=MONTHLY;BYMONTHDAY=15";
    expect(shouldGenerateRecurringTask(rule, "2026-08-15")).toBe(true);
    expect(shouldGenerateRecurringTask(rule, "2026-08-16")).toBe(false);
  });

  it("expands the first Saturday of a month with BYSETPOS", () => {
    const rule = "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1";
    expect(shouldGenerateRecurringTask(rule, "2026-08-01")).toBe(true);
    expect(shouldGenerateRecurringTask(rule, "2026-08-08")).toBe(false);
  });

  it("expands the third Monday of each quarter with BYSETPOS", () => {
    const rule = [
      "DTSTART:20260101T000000Z",
      "RRULE:FREQ=MONTHLY;INTERVAL=3;BYDAY=MO;BYSETPOS=3",
    ].join("\n");
    expect(shouldGenerateRecurringTask(rule, "2026-01-19")).toBe(true);
    expect(shouldGenerateRecurringTask(rule, "2026-04-20")).toBe(true);
    expect(shouldGenerateRecurringTask(rule, "2026-02-16")).toBe(false);
  });

  it("rejects invalid RRULE input", () => {
    expect(() => shouldGenerateRecurringTask("FREQ=NOT_A_FREQUENCY", "2026-08-07")).toThrow();
  });

  it("uses Asia/Kolkata when an instant crosses a local date boundary", () => {
    const instant = "2026-08-06T20:00:00.000Z";
    expect(kolkataDateKey(instant)).toBe("2026-08-07");
    expect(shouldGenerateRecurringTask("FREQ=WEEKLY;BYDAY=FR", instant)).toBe(true);
    expect(shouldGenerateRecurringTask("FREQ=WEEKLY;BYDAY=TH", instant)).toBe(false);
  });
});

describe("recurring task availability", () => {
  it("keeps an active employee available without an availability row on a normal workday", () => {
    expect(isUserAvailableForRecurringTask(doer, undefined, "2026-08-07")).toBe(true);
    expect(resolveRecurringAssignment(
      doer,
      buddy,
      new Map(),
      "2026-08-07",
    )).toEqual({
      effective_assignee_id: doer.id,
      original_assignee_id: doer.id,
      resolution: "original",
    });
  });

  it("treats an explicit absent exception as unavailable", () => {
    expect(isUserAvailableForRecurringTask(doer, "absent", "2026-08-07")).toBe(false);
  });

  it("excludes a scheduled week-off when availability is missing", () => {
    expect(isUserAvailableForRecurringTask(doer, undefined, "2026-08-09")).toBe(false);
  });

  it("uses an active available buddy when the original doer is unavailable", () => {
    expect(resolveRecurringAssignment(
      doer,
      buddy,
      new Map([[doer.id, "absent"]]),
      "2026-08-07",
    )).toEqual({
      effective_assignee_id: buddy.id,
      original_assignee_id: doer.id,
      resolution: "primary_buddy",
    });
  });

  it("blocks coverage when both the original doer and buddy are unavailable", () => {
    expect(resolveRecurringAssignment(
      doer,
      buddy,
      new Map([[doer.id, "absent"], [buddy.id, "absent"]]),
      "2026-08-07",
    )).toEqual({
      effective_assignee_id: null,
      original_assignee_id: doer.id,
      resolution: "coverage_required",
    });
  });

  it("treats an inactive employee without an availability row as unavailable", () => {
    expect(isUserAvailableForRecurringTask(
      { ...doer, working_status: "inactive" },
      undefined,
      "2026-08-07",
    )).toBe(false);
  });
});
