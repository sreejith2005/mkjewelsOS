import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DAY_HALF_DUE_TIMES,
  dayHalfDeadlineAfter,
  dayHalfOfDeadline,
  describeDayHalf,
  parseDayHalfLabel,
} from "./dayHalfDeadline";

const ist = (local: string) => new Date(`${local}+05:30`);
const istText = (iso: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date(iso)).replace(",", "");

describe("dayHalfDeadlineAfter", () => {
  it.each([
    ["2026-11-03T11:00:00", "2026-11-03 21:00", "second_half"],
    ["2026-11-03T12:30:00", "2026-11-03 21:00", "second_half"],
    ["2026-11-03T14:59:00", "2026-11-03 21:00", "second_half"],
    ["2026-11-03T14:59:59.999", "2026-11-03 21:00", "second_half"],
    ["2026-11-03T15:00:00", "2026-11-04 15:00", "first_half"],
    ["2026-11-03T16:30:00", "2026-11-04 15:00", "first_half"],
    ["2026-11-03T17:45:00", "2026-11-04 15:00", "first_half"],
    ["2026-11-03T20:59:00", "2026-11-04 15:00", "first_half"],
    ["2026-11-03T21:00:00", "2026-11-04 15:00", "first_half"],
    ["2026-11-03T23:59:00", "2026-11-04 15:00", "first_half"],
    ["2026-11-03T00:00:00", "2026-11-03 21:00", "second_half"],
  ] as const)("work activated %s IST is due %s IST (%s)", (activated, expected, half) => {
    const result = dayHalfDeadlineAfter(ist(activated));
    expect(istText(result.dueAt)).toBe(expected);
    expect(result.half).toBe(half);
    expect(result.dueDate).toBe(expected.slice(0, 10));
  });

  it("crosses month and year ends", () => {
    expect(istText(dayHalfDeadlineAfter(ist("2026-11-30T18:00:00")).dueAt)).toBe("2026-12-01 15:00");
    expect(istText(dayHalfDeadlineAfter(ist("2026-12-31T15:00:00")).dueAt)).toBe("2027-01-01 15:00");
    expect(istText(dayHalfDeadlineAfter(ist("2028-02-28T16:00:00")).dueAt)).toBe("2028-02-29 15:00");
  });

  it("does not skip weekends", () => {
    // Saturday 7 Nov 2026, 4 pm -> Sunday 8 Nov, 3 pm.
    expect(istText(dayHalfDeadlineAfter(ist("2026-11-07T16:00:00")).dueAt)).toBe("2026-11-08 15:00");
  });

  it("depends on the instant, not the caller's timezone", () => {
    // 09:40 UTC is 15:10 IST: after the first-half deadline even though it is morning in UTC.
    expect(dayHalfDeadlineAfter("2026-11-03T09:40:00Z")).toEqual({ dueAt: "2026-11-04T09:30:00.000Z", half: "first_half", dueDate: "2026-11-04" });
    // 19:00 UTC on 2 Nov is 00:30 IST on 3 Nov: a new India day.
    expect(dayHalfDeadlineAfter("2026-11-02T19:00:00Z").dueAt).toBe("2026-11-03T15:30:00.000Z");
  });

  it("rejects an invalid reference", () => {
    expect(() => dayHalfDeadlineAfter("not a date")).toThrow("Reference time is invalid");
  });
});

describe("dayHalfOfDeadline", () => {
  it("names only deadlines exactly on 3:00 PM or 9:00 PM India time", () => {
    expect(dayHalfOfDeadline("2026-11-03T09:30:00Z")).toBe("first_half");
    expect(dayHalfOfDeadline("2026-11-03T15:30:00Z")).toBe("second_half");
    expect(dayHalfOfDeadline("2026-11-03T07:30:00Z")).toBeNull();
    expect(dayHalfOfDeadline("2026-11-03T09:31:00Z")).toBeNull();
    expect(dayHalfOfDeadline(null)).toBeNull();
    expect(dayHalfOfDeadline("bad")).toBeNull();
  });

  it("describes a half in plain words", () => {
    expect(describeDayHalf("first_half")).toBe("First half · 3:00 PM");
    expect(describeDayHalf("second_half")).toBe("Second half · 9:00 PM");
  });
});

describe("parseDayHalfLabel", () => {
  it.each(["First Half", "FIRST HALF", "first-half", "First_Half", "1st half", "1st Half", "first  half", "First half of the day", "(First Half)", "firsthalf"])(
    "%s is the first half", (label) => expect(parseDayHalfLabel(label)).toBe("first_half"));
  it.each(["Second Half", "SECOND-HALF", "2nd half", "2nd Half", "second half of day", "secondhalf"])(
    "%s is the second half", (label) => expect(parseDayHalfLabel(label)).toBe("second_half"));
  it.each(["Opening", "Closing", "Morning", "Evening", "General", "Manual", "Half", "Half day", "Third half", "Daily", ""])(
    "%s is not a half", (label) => expect(parseDayHalfLabel(label)).toBeNull());
});

describe("database parity", () => {
  it("migration 0371 uses the same fixed deadlines", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/0371_day_half_deadlines.sql", import.meta.url), "utf8");
    const policy = /create function day_half_deadline[\s\S]*?\$\$;/.exec(sql)?.[0] ?? "";
    expect(policy).toContain(`< time '${DAY_HALF_DUE_TIMES.first_half}'`);
    expect(policy).toContain(`+ time '${DAY_HALF_DUE_TIMES.second_half}'`);
    expect(policy).toContain(`+ 1 + time '${DAY_HALF_DUE_TIMES.first_half}'`);
    expect(policy).toContain("'Asia/Kolkata'");
  });
});
