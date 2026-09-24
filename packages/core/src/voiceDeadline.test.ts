import { describe, expect, it } from "vitest";
import {
  resolveVoiceDeadline,
  VOICE_DEADLINE_DEFAULT_TIME,
  zonedDateKey,
  zonedWallTimeToInstant,
  type VoiceDeadline,
} from "./voiceDeadline.ts";

// Every test uses a fixed reference instant; none depends on the real clock.
// Thursday 24 September 2026, 10:00 in Asia/Kolkata.
const THURSDAY = "2026-09-24T10:00:00+05:30";
const KOLKATA = "Asia/Kolkata";

function resolve(dateExpression: string | null, timeExpression: string | null = null, now: string = THURSDAY, timeZone = KOLKATA): VoiceDeadline {
  return resolveVoiceDeadline({ dateExpression, timeExpression, now, timeZone });
}

/** Resolved local day and time, or the status when nothing was resolved. */
function when(dateExpression: string | null, timeExpression: string | null = null, now: string = THURSDAY): string {
  const deadline = resolve(dateExpression, timeExpression, now);
  return deadline.status === "resolved" ? `${deadline.date} ${deadline.time}` : deadline.status;
}

/** Local reference instants for each weekday of the week of 21 September 2026. */
const WEEK = {
  monday: "2026-09-21T10:00:00+05:30",
  tuesday: "2026-09-22T10:00:00+05:30",
  wednesday: "2026-09-23T10:00:00+05:30",
  thursday: "2026-09-24T10:00:00+05:30",
  friday: "2026-09-25T10:00:00+05:30",
  saturday: "2026-09-26T10:00:00+05:30",
  sunday: "2026-09-27T10:00:00+05:30",
} as const;
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

describe("resolveVoiceDeadline - product examples (reference Thursday 24 Sep 2026)", () => {
  it("resolves the documented regression examples", () => {
    const nextMonday = resolve("next Monday");
    expect(nextMonday).toMatchObject({ status: "resolved", date: "2026-09-28", time: "19:00", timeSource: "default", plannedDatetime: "2026-09-28T13:30:00.000Z" });
    expect(when("tomorrow")).toBe("2026-09-25 19:00");
    expect(when("tomorrow", "3 PM")).toBe("2026-09-25 15:00");
    expect(when("next Friday")).toBe("2026-10-02 19:00");
    expect(when("Monday of next week", "11 AM")).toBe("2026-09-28 11:00");
  });

  it("keeps the spoken words for review and diagnosis", () => {
    expect(resolve("next Monday", "3 pm")).toMatchObject({
      dateExpression: "next Monday", timeExpression: "3 pm", hasExplicitDate: true, hasExplicitTime: true, timeSource: "spoken",
    });
    expect(resolve("next Monday").note).toBe("“next Monday” → Mon 28 Sep 2026, 7:00 PM (no time said, default 7:00 PM)");
  });

  it("uses 7:00 PM local time when no time is said", () => {
    expect(VOICE_DEADLINE_DEFAULT_TIME).toBe("19:00");
    for (const expression of ["tomorrow", "next Monday", "30 September", "in 3 days", "end of next month"]) {
      expect(resolve(expression)).toMatchObject({ status: "resolved", time: "19:00", timeSource: "default", hasExplicitTime: false });
    }
  });
});

describe("resolveVoiceDeadline - days relative to today", () => {
  it("resolves today, tonight, tomorrow and day after tomorrow", () => {
    expect(when("today")).toBe("2026-09-24 19:00");
    expect(when("tonight")).toBe("2026-09-24 19:00");
    expect(when("tonight", "at 9")).toBe("2026-09-24 21:00");
    expect(when("tomorrow")).toBe("2026-09-25 19:00");
    expect(when("day after tomorrow")).toBe("2026-09-26 19:00");
    expect(when("the day after tomorrow", "at 4:30 p.m.")).toBe("2026-09-26 16:30");
    expect(when("end of day")).toBe("2026-09-24 19:00");
  });

  it("counts days, weeks and months from today", () => {
    expect(when("in 2 days")).toBe("2026-09-26 19:00");
    expect(when("in three days")).toBe("2026-09-27 19:00");
    expect(when("in a week")).toBe("2026-10-01 19:00");
    expect(when("in 2 weeks")).toBe("2026-10-08 19:00");
    expect(when("one month from now")).toBe("2026-10-24 19:00");
    expect(when("2 days from now")).toBe("2026-09-26 19:00");
  });

  it("resolves an hour offset to an exact instant", () => {
    expect(resolve(null, "in 2 hours")).toMatchObject({ status: "resolved", date: "2026-09-24", time: "12:00", plannedDatetime: "2026-09-24T06:30:00.000Z" });
  });
});

describe("resolveVoiceDeadline - weekdays against the Monday-Sunday week", () => {
  it("resolves every weekday from a Thursday", () => {
    const expected = {
      // next X: that day in the week starting Monday 28 Sep.
      next: ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"],
      // X / coming X: the next occurrence after today.
      coming: ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-09-25", "2026-09-26", "2026-09-27"],
    };
    WEEKDAYS.forEach((weekday, index) => {
      expect(resolve(`next ${weekday}`).date).toBe(expected.next[index]);
      expect(resolve(`${weekday} of next week`).date).toBe(expected.next[index]);
      expect(resolve(`coming ${weekday}`).date).toBe(expected.coming[index]);
      expect(resolve(`on ${weekday}`).date).toBe(expected.coming[index]);
    });
  });

  it("resolves every weekday from every reference weekday", () => {
    WEEKDAYS.forEach((reference, referenceIndex) => {
      const today = addDays("2026-09-21", referenceIndex);
      WEEKDAYS.forEach((target, targetIndex) => {
        const now = WEEK[reference];
        const nextWeek = addDays("2026-09-28", targetIndex);
        const ahead = (targetIndex - referenceIndex + 7) % 7 || 7;
        expect(resolve(`next ${target}`, null, now).date, `next ${target} from ${reference}`).toBe(nextWeek);
        expect(resolve(`${target} next week`, null, now).date, `${target} next week from ${reference}`).toBe(nextWeek);
        expect(resolve(`coming ${target}`, null, now).date, `coming ${target} from ${reference}`).toBe(addDays(today, ahead));
        expect(resolve(target, null, now).date, `${target} from ${reference}`).toBe(addDays(today, ahead));
        const thisWeek = resolve(`this ${target}`, null, now);
        if (targetIndex >= referenceIndex) expect(thisWeek.date, `this ${target} from ${reference}`).toBe(addDays("2026-09-21", targetIndex));
        else expect(thisWeek.status, `this ${target} from ${reference}`).toBe("ambiguous");
      });
    });
  });

  it("treats next Monday said on a Sunday as the next day, because the week ends on Sunday", () => {
    expect(when("next Monday", null, WEEK.sunday)).toBe("2026-09-28 19:00");
    expect(when("next Sunday", null, WEEK.sunday)).toBe("2026-10-04 19:00");
    expect(when("Monday", null, WEEK.monday)).toBe("2026-09-28 19:00");
  });

  it("asks for confirmation when this <weekday> has already passed", () => {
    const deadline = resolve("this Monday");
    expect(deadline).toMatchObject({ status: "ambiguous", plannedDatetime: null, date: "2026-09-21" });
    expect(deadline.note).toContain("already passed this week");
    expect(when("this Friday")).toBe("2026-09-25 19:00");
  });

  it("resolves the ends of a week", () => {
    expect(when("end of this week")).toBe("2026-09-27 19:00");
    expect(when("end of next week")).toBe("2026-10-04 19:00");
    expect(when("start of next week")).toBe("2026-09-28 19:00");
    expect(when("Monday after next")).toBe("2026-10-05 19:00");
  });
});

describe("resolveVoiceDeadline - weeks and months", () => {
  it("reports a week or weekend as a range instead of inventing a day", () => {
    expect(resolve("this week")).toMatchObject({ status: "ambiguous", plannedDatetime: null, range: { start: "2026-09-21", end: "2026-09-27" } });
    expect(resolve("next week")).toMatchObject({ status: "ambiguous", range: { start: "2026-09-28", end: "2026-10-04" } });
    expect(resolve("this weekend")).toMatchObject({ status: "ambiguous", range: { start: "2026-09-26", end: "2026-09-27" } });
    expect(resolve("next weekend")).toMatchObject({ status: "ambiguous", range: { start: "2026-10-03", end: "2026-10-04" } });
    expect(resolve("next month")).toMatchObject({ status: "ambiguous", range: { start: "2026-10-01", end: "2026-10-31" } });
    expect(resolve("next week").note).toBe("“next week” covers Mon 28 Sep 2026 – Sun 4 Oct 2026. Choose the exact day.");
  });

  it("defines week N of a month as the week starting on its Nth Monday", () => {
    // October 2026 Mondays: 5, 12, 19, 26.
    expect(resolve("first week of next month").range).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    expect(resolve("second week of next month").range).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(resolve("third week of next month").range).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(resolve("fourth week of next month").range).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(resolve("last week of next month").range).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(resolve("next month second week").range).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(resolve("fifth week of next month").status).toBe("invalid");
    // September 2026 Mondays: 7, 14, 21, 28.
    expect(resolve("second week of this month")).toMatchObject({ status: "past", range: { start: "2026-09-14", end: "2026-09-20" } });
    expect(resolve("last week of this month")).toMatchObject({ status: "ambiguous", range: { start: "2026-09-28", end: "2026-10-04" } });
  });

  it("resolves a weekday inside a week of a month exactly", () => {
    expect(when("Friday of the second week of next month")).toBe("2026-10-16 19:00");
    expect(when("Monday of the first week of next month")).toBe("2026-10-05 19:00");
    expect(when("Sunday of the last week of next month")).toBe("2026-11-01 19:00");
  });

  it("resolves the Nth or last weekday of a month", () => {
    expect(when("first Monday of next month")).toBe("2026-10-05 19:00");
    expect(when("second Monday of next month")).toBe("2026-10-12 19:00");
    expect(when("third Friday of next month")).toBe("2026-10-16 19:00");
    expect(when("last Friday of next month")).toBe("2026-10-30 19:00");
    expect(when("last Monday of this month")).toBe("2026-09-28 19:00");
    expect(resolve("fifth Monday of next month").status).toBe("invalid");
    expect(resolve("first Monday of this month").status).toBe("past");
  });

  it("resolves the beginning, middle and end of a month", () => {
    expect(when("beginning of next month")).toBe("2026-10-01 19:00");
    expect(when("start of next month")).toBe("2026-10-01 19:00");
    expect(when("middle of next month")).toBe("2026-10-15 19:00");
    expect(when("end of next month")).toBe("2026-10-31 19:00");
    expect(when("end of this month")).toBe("2026-09-30 19:00");
    expect(resolve("middle of this month").status).toBe("past");
    expect(resolve("beginning of this month").status).toBe("past");
  });
});

describe("resolveVoiceDeadline - month and year boundaries", () => {
  const DEC_31 = "2026-12-31T10:00:00+05:30";
  it("crosses December into January", () => {
    expect(when("tomorrow", null, DEC_31)).toBe("2027-01-01 19:00");
    expect(when("next Monday", null, DEC_31)).toBe("2027-01-04 19:00");
    expect(when("first Monday of next month", null, DEC_31)).toBe("2027-01-04 19:00");
    expect(when("end of next month", null, DEC_31)).toBe("2027-01-31 19:00");
    expect(resolve("second week of next month", null, DEC_31).range).toEqual({ start: "2027-01-11", end: "2027-01-17" });
    expect(when("5 January", null, "2026-12-20T10:00:00+05:30")).toBe("2027-01-05 19:00");
  });

  it("crosses January into February, clamping a month step to the month's last day", () => {
    const JAN_31_2027 = "2027-01-31T10:00:00+05:30";
    expect(when("tomorrow", null, JAN_31_2027)).toBe("2027-02-01 19:00");
    expect(when("in 1 month", null, JAN_31_2027)).toBe("2027-02-28 19:00");
    expect(when("end of next month", null, "2027-01-10T10:00:00+05:30")).toBe("2027-02-28 19:00");
  });

  it("handles leap-year February", () => {
    expect(when("end of next month", null, "2028-01-10T10:00:00+05:30")).toBe("2028-02-29 19:00");
    expect(when("in 1 month", null, "2028-01-31T10:00:00+05:30")).toBe("2028-02-29 19:00");
    expect(when("tomorrow", null, "2028-02-28T10:00:00+05:30")).toBe("2028-02-29 19:00");
    expect(when("29 February", null, "2027-10-01T10:00:00+05:30")).toBe("2028-02-29 19:00");
    expect(resolve("29/02/2027").status).toBe("invalid");
  });

  it("knows 30- and 31-day months", () => {
    expect(when("end of this month", null, "2027-04-10T10:00:00+05:30")).toBe("2027-04-30 19:00");
    expect(when("end of this month", null, "2027-05-10T10:00:00+05:30")).toBe("2027-05-31 19:00");
    expect(when("tomorrow", null, "2027-04-30T10:00:00+05:30")).toBe("2027-05-01 19:00");
    expect(resolve("31 April 2027").status).toBe("invalid");
    expect(when("31 May 2027")).toBe("2027-05-31 19:00");
  });
});

describe("resolveVoiceDeadline - explicit dates and times", () => {
  it("keeps supporting the explicit date forms", () => {
    for (const expression of ["September 30", "30 September", "September 30th", "30th of September", "30/09/2026", "30-09-2026", "2026-09-30", "Wednesday 30th September"]) {
      expect(when(expression), expression).toBe("2026-09-30 19:00");
    }
    expect(when("by the 30th")).toBe("2026-09-30 19:00");
  });

  it("combines an explicit date with an explicit time", () => {
    expect(when("30 September", "3:15 pm")).toBe("2026-09-30 15:15");
    expect(when("2026-09-30", "18:30")).toBe("2026-09-30 18:30");
    expect(when("September 30th at 10 am")).toBe("2026-09-30 10:00");
  });

  it("combines a relative date with an explicit time", () => {
    expect(when("next Monday at 3 PM")).toBe("2026-09-28 15:00");
    expect(when("tomorrow", "10:30 in the morning")).toBe("2026-09-25 10:30");
    expect(when("tomorrow morning")).toBe("2026-09-25 10:00");
    expect(when("tomorrow afternoon")).toBe("2026-09-25 15:00");
    expect(when("tomorrow", "noon")).toBe("2026-09-25 12:00");
    expect(when("tomorrow", "half past 4")).toBe("2026-09-25 16:30");
  });

  it("reads a bare hour by shop hours: 1-7 PM, 8-11 AM, 12 noon", () => {
    expect(when("Friday", "6")).toBe("2026-09-25 18:00");
    expect(when("Friday at 6")).toBe("2026-09-25 18:00");
    expect(when("Friday", "at 8")).toBe("2026-09-25 08:00");
    expect(when("Friday", "11:30")).toBe("2026-09-25 11:30");
    expect(when("Friday", "12")).toBe("2026-09-25 12:00");
    expect(when("Friday", "at 6 in the morning")).toBe("2026-09-25 06:00");
    expect(when("Friday", "16:00")).toBe("2026-09-25 16:00");
  });

  it("refuses a date that is not on the calendar", () => {
    expect(resolve("31 September")).toMatchObject({ status: "invalid", plannedDatetime: null });
    expect(resolve("31/09/2026").status).toBe("invalid");
    expect(resolve("2026-13-01").status).toBe("invalid");
  });

  it("refuses a time that is not on the clock", () => {
    expect(resolve("tomorrow", "15 pm")).toMatchObject({ status: "invalid", plannedDatetime: null });
    expect(resolve("tomorrow", "25:00").status).not.toBe("resolved");
  });

  it("asks when a spoken weekday contradicts the date", () => {
    const deadline = resolve("Monday 30 September");
    expect(deadline).toMatchObject({ status: "ambiguous", plannedDatetime: null });
    expect(deadline.note).toContain("is a Wednesday, not a Monday");
  });

  it("takes the nearest year for a year-less date and never reaches into last year silently", () => {
    expect(resolve("September 3").status).toBe("past");
    expect(when("March 1")).toBe("2027-03-01 19:00");
  });

  it("asks before trusting a date more than a year away", () => {
    expect(resolve("30 September 2028")).toMatchObject({ status: "ambiguous", plannedDatetime: null, date: "2028-09-30" });
  });
});

describe("resolveVoiceDeadline - missing, ambiguous and past deadlines", () => {
  it("leaves a missing deadline unresolved without defaulting to today", () => {
    expect(resolve(null)).toMatchObject({ status: "missing", date: null, plannedDatetime: null, note: null, hasExplicitDate: false });
    expect(resolve("   ")).toMatchObject({ status: "missing", plannedDatetime: null });
    const timeOnly = resolve(null, "5 pm");
    expect(timeOnly).toMatchObject({ status: "missing", plannedDatetime: null, hasExplicitTime: true });
    expect(timeOnly.note).toContain("no day");
  });

  it("leaves words it cannot place unresolved", () => {
    for (const expression of ["sometime soon", "whenever possible", "after the audit", "30"]) {
      expect(resolve(expression), expression).toMatchObject({ status: "ambiguous", plannedDatetime: null });
    }
  });

  it("does not fill in a deadline that has already passed", () => {
    const evening = "2026-09-24T20:00:00+05:30";
    expect(resolve("today", null, evening)).toMatchObject({ status: "past", plannedDatetime: null, date: "2026-09-24" });
    expect(resolve("today", "9 am")).toMatchObject({ status: "past", plannedDatetime: null });
    expect(when("today", "9 pm", evening)).toBe("2026-09-24 21:00");
  });
});

describe("resolveVoiceDeadline - timezones", () => {
  it("counts days in the tenant's timezone near midnight, not in UTC", () => {
    // 00:15 on Friday 25 Sep in Kolkata is still Thursday 24 Sep in UTC.
    const afterMidnight = "2026-09-24T18:45:00Z";
    expect(resolve("today", null, afterMidnight)).toMatchObject({ date: "2026-09-25", plannedDatetime: "2026-09-25T13:30:00.000Z" });
    expect(resolve("tomorrow", null, afterMidnight)).toMatchObject({ date: "2026-09-26", plannedDatetime: "2026-09-26T13:30:00.000Z" });
    expect(resolve("next Monday", null, afterMidnight).date).toBe("2026-09-28");
    // 23:30 on Thursday in Kolkata: "tomorrow" is Friday even though UTC says 18:00 Thursday.
    const beforeMidnight = "2026-09-24T18:00:00Z";
    expect(resolve("tomorrow", null, beforeMidnight).date).toBe("2026-09-25");
    expect(resolve("tonight", "11:45 pm", beforeMidnight)).toMatchObject({ status: "resolved", plannedDatetime: "2026-09-24T18:15:00.000Z" });
  });

  it("applies the zone's own offset, including daylight saving", () => {
    const newYork = resolveVoiceDeadline({ dateExpression: "tomorrow", timeExpression: "9 am", now: "2026-10-31T12:00:00-04:00", timeZone: "America/New_York" });
    // 1 Nov 2026 is the day US clocks fall back to UTC-5.
    expect(newYork).toMatchObject({ status: "resolved", date: "2026-11-01", time: "09:00", plannedDatetime: "2026-11-01T14:00:00.000Z" });
    expect(zonedWallTimeToInstant("2027-03-14", "02:30", "America/New_York")).toBeNull();
    expect(zonedWallTimeToInstant("2026-09-28", "19:00", KOLKATA)).toBe("2026-09-28T13:30:00.000Z");
    expect(zonedDateKey("2026-09-24T18:45:00Z", KOLKATA)).toBe("2026-09-25");
  });

  it("falls back to Asia/Kolkata for an unknown timezone", () => {
    expect(resolveVoiceDeadline({ dateExpression: "tomorrow", timeExpression: null, now: THURSDAY, timeZone: "Not/AZone" }))
      .toMatchObject({ timeZone: KOLKATA, plannedDatetime: "2026-09-25T13:30:00.000Z" });
  });

  it("refuses an unusable reference instant", () => {
    expect(resolve("tomorrow", null, "not a date")).toMatchObject({ status: "invalid", plannedDatetime: null });
  });
});
