import { describe, expect, it } from "vitest";
import {
  availabilityWeekDays,
  availabilityWeekStart,
  isWithinAvailabilityWeek,
} from "./availabilityWeek";

describe("availability week", () => {
  it("starts the week on the Monday of the Kolkata business day", () => {
    expect(availabilityWeekStart("2026-09-10")).toBe("2026-09-07");
    expect(availabilityWeekStart("2026-09-07")).toBe("2026-09-07");
    expect(availabilityWeekStart("2026-09-13")).toBe("2026-09-07");
  });

  it("uses the Kolkata day, not the UTC day, near midnight", () => {
    // 2026-09-06T19:00Z is already Monday 2026-09-07 in Asia/Kolkata.
    expect(availabilityWeekStart("2026-09-06T19:00:00Z")).toBe("2026-09-07");
    expect(availabilityWeekStart("2026-09-06T17:00:00Z")).toBe("2026-08-31");
  });

  it("lists Monday to Sunday and flags past, today, and future days", () => {
    const days = availabilityWeekDays("2026-09-10");
    expect(days).toHaveLength(7);
    expect(days.map((day) => day.date)).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
    expect(days[0].weekdayLabel).toBe("Monday");
    expect(days[6].shortLabel).toBe("Sun");
    expect(days.filter((day) => day.isPast).map((day) => day.date)).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
    ]);
    expect(days.find((day) => day.isToday)?.date).toBe("2026-09-10");
    expect(days.filter((day) => day.isFuture)).toHaveLength(3);
  });

  it("crosses a month boundary without drifting", () => {
    expect(availabilityWeekDays("2026-10-01").map((day) => day.date)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("accepts only the days of the current week for self-service edits", () => {
    expect(isWithinAvailabilityWeek("2026-09-07", "2026-09-10")).toBe(true);
    expect(isWithinAvailabilityWeek("2026-09-13", "2026-09-10")).toBe(true);
    expect(isWithinAvailabilityWeek("2026-09-06", "2026-09-10")).toBe(false);
    expect(isWithinAvailabilityWeek("2026-09-14", "2026-09-10")).toBe(false);
  });
});
