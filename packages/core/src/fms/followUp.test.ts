import { expect, it } from "vitest";
import { fmsFollowUpDateTime } from "./workContracts";

it("schedules the next IST date at 11:00 by default", () => {
  expect(fmsFollowUpDateTime({}, {}, new Date("2026-10-10T17:30:00Z"))).toBe("2026-10-11T05:30:00.000Z");
});
it("uses a selected date and time before defaults", () => {
  expect(fmsFollowUpDateTime({ dateFieldKey: "date", timeFieldKey: "time" }, { date: "2026-10-12", time: "14:15" }, new Date("2026-10-10T04:00:00Z"))).toBe("2026-10-12T08:45:00.000Z");
  expect(fmsFollowUpDateTime({ dateFieldKey: "date" }, { date: "2026-10-12" }, new Date("2026-10-10T04:00:00Z"))).toBe("2026-10-12T05:30:00.000Z");
});
it("supports elapsed hours and optional weekdays without moving an explicit customer date", () => {
  const now = new Date("2026-10-09T04:00:00Z");
  expect(fmsFollowUpDateTime({ delay: 3, unit: "hours" }, {}, now)).toBe("2026-10-09T07:00:00.000Z");
  expect(fmsFollowUpDateTime({ workingDaysOnly: true }, {}, now)).toBe("2026-10-12T05:30:00.000Z");
  expect(fmsFollowUpDateTime({ workingDaysOnly: true, dateFieldKey: "date" }, { date: "2026-10-10" }, now)).toBe("2026-10-10T05:30:00.000Z");
});
it("rejects invalid dates and schedule metadata", () => {
  expect(() => fmsFollowUpDateTime({ dateFieldKey: "date" }, { date: "2026-02-30" })).toThrow();
  expect(() => fmsFollowUpDateTime({ delay: -1 }, {})).toThrow();
});
