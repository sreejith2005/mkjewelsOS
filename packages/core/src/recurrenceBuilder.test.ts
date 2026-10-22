import { describe, expect, it } from "vitest";
import { recurrenceOccurrenceDates, shouldGenerateRecurringTask } from "./recurrence";
import {
  SCHEDULE_PRESETS,
  buildScheduleRule,
  changeSchedulePattern,
  describeScheduleRule,
  describeScheduleSpec,
  firstScheduleDate,
  isSupportedTaskRrule,
  parseScheduleRule,
  scheduleSkipsShortMonths,
  upcomingScheduleDates,
  validateScheduleSpec,
  type ScheduleSpec,
} from "./recurrenceBuilder";

const never = { type: "never" } as const;

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Every day in a window on which the scheduler would create work. */
function generatorDays(rule: string, startsOn: string, from: string, days: number): string[] {
  const out: string[] = [];
  for (let index = 0; index < days; index += 1) {
    const day = addDays(from, index);
    if (shouldGenerateRecurringTask(rule, day, startsOn)) out.push(day);
  }
  return out;
}

const CASES: ReadonlyArray<readonly [string, ScheduleSpec, string]> = [
  ["daily", { pattern: "daily", interval: 1, end: never }, "FREQ=DAILY"],
  ["every 15 days", { pattern: "daily", interval: 15, end: never }, "FREQ=DAILY;INTERVAL=15"],
  ["every monday", { pattern: "weekly", interval: 1, weekdays: ["MO"], end: never }, "FREQ=WEEKLY;BYDAY=MO"],
  ["monday & thursday", { pattern: "weekly", interval: 1, weekdays: ["TH", "MO"], end: never }, "FREQ=WEEKLY;BYDAY=MO,TH"],
  ["every 2 weeks", { pattern: "weekly", interval: 2, weekdays: ["SA"], end: never }, "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA"],
  ["1st monthly", { pattern: "monthly_dates", interval: 1, days: [1], end: never }, "FREQ=MONTHLY;BYMONTHDAY=1"],
  ["1st to 5th", { pattern: "monthly_dates", interval: 1, days: [5, 1, 2, 3, 4], end: never }, "FREQ=MONTHLY;BYMONTHDAY=1,2,3,4,5"],
  ["last day", { pattern: "monthly_dates", interval: 1, days: [-1], end: never }, "FREQ=MONTHLY;BYMONTHDAY=-1"],
  ["quarterly", { pattern: "monthly_dates", interval: 3, days: [22], end: never }, "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=22"],
  ["3rd saturday", { pattern: "monthly_weekday", interval: 1, ordinal: 3, weekday: "SA", end: never }, "FREQ=MONTHLY;BYDAY=3SA"],
  ["last friday", { pattern: "monthly_weekday", interval: 1, ordinal: -1, weekday: "FR", end: never }, "FREQ=MONTHLY;BYDAY=-1FR"],
  ["yearly", { pattern: "yearly", interval: 1, months: [9], day: 22, end: never }, "FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=22"],
  ["quarter months", { pattern: "yearly", interval: 1, months: [10, 1, 4, 7], day: 5, end: never }, "FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=5"],
  ["count", { pattern: "daily", interval: 1, end: { type: "count", count: 5 } }, "FREQ=DAILY;COUNT=5"],
  ["until", { pattern: "weekly", interval: 1, weekdays: ["FR"], end: { type: "until", date: "2026-12-31" } }, "FREQ=WEEKLY;BYDAY=FR;UNTIL=20261231T235959Z"],
];

describe("schedule rule builder", () => {
  it.each(CASES)("writes %s in the importer's token order", (_label, spec, rule) => {
    expect(buildScheduleRule(spec).recurrenceRule).toBe(rule);
    expect(isSupportedTaskRrule(rule)).toBe(true);
  });

  it("records the schedule kind the import contract accepts", () => {
    expect(buildScheduleRule(CASES[0]![1]).scheduleKind).toBe("daily");
    expect(buildScheduleRule(CASES[2]![1]).scheduleKind).toBe("weekly");
    expect(buildScheduleRule(CASES[5]![1]).scheduleKind).toBe("monthly");
    expect(buildScheduleRule(CASES[8]![1]).scheduleKind).toBe("quarterly");
    expect(buildScheduleRule(CASES[9]![1]).scheduleKind).toBe("monthly");
    expect(buildScheduleRule(CASES[11]![1]).scheduleKind).toBe("yearly");
    expect(buildScheduleRule(CASES[12]![1]).scheduleKind).toBe("quarterly");
  });

  it.each(CASES)("reads %s back into the same spec", (_label, spec, rule) => {
    const parsed = parseScheduleRule(rule, "2026-09-22");
    expect(parsed).not.toBeNull();
    expect(buildScheduleRule(parsed!).recurrenceRule).toBe(rule);
  });

  it("fills an older rule's missing day from its start date", () => {
    expect(parseScheduleRule("FREQ=WEEKLY", "2026-09-22")).toMatchObject({ pattern: "weekly", weekdays: ["TU"] });
    expect(parseScheduleRule("FREQ=MONTHLY", "2026-09-22")).toMatchObject({ pattern: "monthly_dates", days: [22] });
    expect(parseScheduleRule("FREQ=MONTHLY;INTERVAL=3", "2026-09-22")).toMatchObject({ pattern: "monthly_dates", interval: 3, days: [22] });
    expect(parseScheduleRule("FREQ=YEARLY", "2026-09-22")).toMatchObject({ pattern: "yearly", months: [9], day: 22 });
    expect(parseScheduleRule("FREQ=DAILY;COUNT=1", "2026-09-22")).toMatchObject({ pattern: "daily", end: { type: "count", count: 1 } });
  });

  it("refuses rules the form cannot represent instead of guessing", () => {
    expect(parseScheduleRule("FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1")).toBeNull();
    expect(parseScheduleRule("FREQ=HOURLY")).toBeNull();
    expect(parseScheduleRule("FREQ=WEEKLY")).toBeNull();
    expect(parseScheduleRule("FREQ=MONTHLY;BYDAY=5SA")).toBeNull();
    expect(describeScheduleRule("FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1")).toBe("FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1");
  });

  it("describes schedules in plain words", () => {
    expect(describeScheduleSpec(CASES[9]![1])).toBe("Every month on the 3rd Saturday");
    expect(describeScheduleSpec(CASES[10]![1])).toBe("Every month on the last Friday");
    expect(describeScheduleSpec(CASES[3]![1])).toBe("Every week on Monday and Thursday");
    expect(describeScheduleSpec(CASES[1]![1])).toBe("Every 15 days");
    expect(describeScheduleSpec(CASES[7]![1])).toBe("Every month on the last day");
    expect(describeScheduleSpec(CASES[12]![1])).toBe("Every year on the 5th of January, April, July and October");
    expect(describeScheduleSpec(CASES[14]![1])).toBe("Every week on Friday, until 2026-12-31");
    expect(describeScheduleSpec(CASES[13]![1])).toBe("Every day, 5 times");
  });
});

describe("schedule preview matches the generator", () => {
  // 2026-10-21 is a Wednesday.
  const start = "2026-10-21";

  it.each(CASES)("lists exactly the generator's days for %s", (_label, spec) => {
    const { recurrenceRule } = buildScheduleRule(spec);
    const anchored = firstScheduleDate(recurrenceRule, start)!;
    const window = 460;
    const fromGenerator = generatorDays(recurrenceRule, anchored, start, window);
    const fromPreview = recurrenceOccurrenceDates(recurrenceRule, anchored, start, 1000).filter((day) => day < addDays(start, window));
    expect(fromPreview).toEqual(fromGenerator);
  });

  it("puts the 3rd Saturday where it falls", () => {
    expect(upcomingScheduleDates("FREQ=MONTHLY;BYDAY=3SA", "2026-10-21", 4, "2026-10-21"))
      .toEqual(["2026-11-21", "2026-12-19", "2027-01-16", "2027-02-20"]);
    expect(upcomingScheduleDates("FREQ=MONTHLY;BYDAY=-1FR", "2026-10-21", 3, "2026-10-21"))
      .toEqual(["2026-10-30", "2026-11-27", "2026-12-25"]);
    expect(upcomingScheduleDates("FREQ=MONTHLY;BYMONTHDAY=-1", "2026-10-21", 3, "2026-10-21"))
      .toEqual(["2026-10-31", "2026-11-30", "2026-12-31"]);
  });

  it("anchors a new schedule on its first real date", () => {
    expect(firstScheduleDate("FREQ=MONTHLY;BYDAY=3SA", "2026-10-21")).toBe("2026-11-21");
    expect(firstScheduleDate("FREQ=MONTHLY;BYDAY=3SA", "2026-10-17")).toBe("2026-10-17");
    expect(firstScheduleDate("FREQ=WEEKLY;BYDAY=MO,TH", "2026-10-21")).toBe("2026-10-22");
    expect(firstScheduleDate("FREQ=DAILY;INTERVAL=15", "2026-10-21")).toBe("2026-10-21");
  });

  it("keeps the same dates after re-anchoring", () => {
    for (const [, spec] of CASES) {
      const { recurrenceRule } = buildScheduleRule({ ...spec, end: never });
      const anchored = firstScheduleDate(recurrenceRule, start)!;
      expect(recurrenceOccurrenceDates(recurrenceRule, anchored, start, 12))
        .toEqual(recurrenceOccurrenceDates(recurrenceRule, start, start, 12));
    }
  });

  it("stops at the end condition", () => {
    expect(upcomingScheduleDates("FREQ=DAILY;COUNT=3", start, 10, start)).toEqual(["2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(upcomingScheduleDates("FREQ=WEEKLY;BYDAY=FR;UNTIL=20261106T235959Z", start, 10, start)).toEqual(["2026-10-23", "2026-10-30", "2026-11-06"]);
    expect(generatorDays("FREQ=WEEKLY;BYDAY=FR;UNTIL=20261106T235959Z", start, start, 40)).toEqual(["2026-10-23", "2026-10-30", "2026-11-06"]);
  });

  it("returns nothing for an unreadable rule instead of throwing", () => {
    expect(upcomingScheduleDates("not a rule", start, 3, start)).toEqual([]);
  });
});

describe("schedule validation", () => {
  const start = "2026-10-21";

  it("accepts every preset", () => {
    for (const preset of SCHEDULE_PRESETS) expect(validateScheduleSpec(preset.spec(start), start)).toBeNull();
  });

  it("explains what is wrong next to the choice", () => {
    expect(validateScheduleSpec({ pattern: "weekly", interval: 1, weekdays: [], end: never }, start)).toMatch(/weekday/);
    expect(validateScheduleSpec({ pattern: "daily", interval: 0, end: never }, start)).toMatch(/1 to 99/);
    expect(validateScheduleSpec({ pattern: "monthly_dates", interval: 1, days: [], end: never }, start)).toMatch(/date of the month/);
    expect(validateScheduleSpec({ pattern: "daily", interval: 1, end: { type: "until", date: "2026-10-01" } }, start)).toMatch(/on or after/);
    expect(validateScheduleSpec({ pattern: "daily", interval: 1, end: { type: "count", count: 0 } }, start)).toMatch(/occurrences/);
    expect(validateScheduleSpec({ pattern: "yearly", interval: 1, months: [2], day: 31, end: never }, start)).toMatch(/never produces/);
    expect(validateScheduleSpec({ pattern: "daily", interval: 1, end: never }, "2026-02-30")).toMatch(/start date/);
  });

  it("warns when short months skip a date", () => {
    expect(scheduleSkipsShortMonths({ pattern: "monthly_dates", interval: 1, days: [31], end: never })).toBe(true);
    expect(scheduleSkipsShortMonths({ pattern: "monthly_dates", interval: 1, days: [-1], end: never })).toBe(false);
  });

  it("keeps what still applies when the pattern changes", () => {
    const weekly: ScheduleSpec = { pattern: "weekly", interval: 2, weekdays: ["MO"], end: { type: "count", count: 4 } };
    expect(changeSchedulePattern(weekly, "monthly_weekday", "2026-10-17")).toEqual({ pattern: "monthly_weekday", interval: 1, ordinal: 3, weekday: "SA", end: { type: "count", count: 4 } });
    expect(changeSchedulePattern(weekly, "monthly_dates", "2026-10-31")).toMatchObject({ days: [31] });
  });
});

describe("database rule grammar mirror", () => {
  it.each([
    ["FREQ=DAILY", true],
    ["RRULE:FREQ=WEEKLY;BYDAY=MO,TH", true],
    ["DTSTART:20261021T000000Z\nRRULE:FREQ=DAILY", true],
    ["FREQ=MONTHLY;BYDAY=3SA", true],
    ["FREQ=MONTHLY;BYDAY=-1FR", true],
    ["FREQ=MONTHLY;BYMONTHDAY=-1", true],
    ["FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1", true],
    ["FREQ=DAILY;UNTIL=20261231T235959Z", true],
    ["FREQ=HOURLY", false],
    ["FREQ=DAILY;FREQ=DAILY", false],
    ["FREQ=DAILY;INTERVAL=0", false],
    ["FREQ=MONTHLY;BYMONTHDAY=0", false],
    ["FREQ=MONTHLY;BYMONTHDAY=32", false],
    ["FREQ=YEARLY;BYMONTH=13", false],
    ["FREQ=DAILY;BYSETPOS=1", false],
    ["FREQ=DAILY;EXDATE=20261021", false],
    ["BYDAY=MO", false],
    ["", false],
  ])("treats %j as %s", (rule, supported) => {
    expect(isSupportedTaskRrule(rule)).toBe(supported);
  });
});
