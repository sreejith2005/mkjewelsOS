import { describe, expect, it } from "vitest";
import { describeDue, formatKolkataDateTime } from "./dueLabel";

// 22 Oct 2026, 12:00 IST
const now = new Date("2026-10-22T06:30:00Z");

describe("plain-language due dates", () => {
  it("handles missing and invalid dates", () => {
    expect(describeDue(null, now)).toEqual({ label: "No due date", tone: "none" });
    expect(describeDue("nonsense", now).tone).toBe("none");
  });

  it("names today and tomorrow by the Kolkata calendar day", () => {
    expect(describeDue("2026-10-22T11:30:00Z", now)).toEqual({ label: "Due today, 5:00 pm", tone: "today" });
    expect(describeDue("2026-10-23T04:30:00Z", now)).toEqual({ label: "Due tomorrow, 10:00 am", tone: "upcoming" });
    // 23 Oct 00:30 IST is tomorrow in Kolkata although it is still 22 Oct in UTC.
    expect(describeDue("2026-10-22T19:00:00Z", now).label).toBe("Due tomorrow, 12:30 am");
  });

  it("says how late overdue work is", () => {
    expect(describeDue("2026-10-22T04:30:00Z", now)).toEqual({ label: "Overdue since 10:00 am today", tone: "overdue" });
    expect(describeDue("2026-10-21T04:30:00Z", now)).toEqual({ label: "Overdue by 1 day", tone: "overdue" });
    expect(describeDue("2026-10-19T04:30:00Z", now).label).toBe("Overdue by 3 days");
  });

  it("shows later dates and adds the year only when it differs", () => {
    expect(describeDue("2026-10-30T04:30:00Z", now).label).toBe("Due 30 Oct, 10:00 am");
    expect(describeDue("2027-01-05T04:30:00Z", now).label).toBe("Due 5 Jan 2027, 10:00 am");
  });

  it("keeps completed work calm", () => {
    expect(describeDue("2026-10-19T04:30:00Z", now, { completed: true })).toEqual({ label: "Was due 19 Oct", tone: "done" });
  });
});

describe("submission stamps", () => {
  it("formats in Kolkata time and tolerates missing values", () => {
    expect(formatKolkataDateTime("2026-10-22T09:00:00Z")).toBe("22 Oct 2026, 2:30 pm");
    expect(formatKolkataDateTime(null)).toBe("");
    expect(formatKolkataDateTime("bad")).toBe("");
  });
});
