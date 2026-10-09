import { describe, expect, it } from "vitest";
import { KIARA_PERIODS, isIsoDate, kiaraRangeDays, kiaraRangeFromInput, kiaraToday, resolveKiaraPeriod } from "./period";

const IST = "Asia/Kolkata";
// Friday 9 October 2026, 23:50 IST (18:20 UTC).
const lateFriday = new Date("2026-10-09T18:20:00Z");
// Friday 9 October 2026 00:10 IST is still 8 October in UTC.
const earlyFriday = new Date("2026-10-08T18:40:00Z");

describe("Kiara periods", () => {
  it("uses the tenant's calendar day, not UTC", () => {
    expect(kiaraToday(earlyFriday, IST)).toBe("2026-10-09");
    expect(kiaraToday(new Date("2026-10-09T18:31:00Z"), IST)).toBe("2026-10-10");
  });

  it.each([
    ["today", "2026-10-09", "2026-10-09"],
    ["yesterday", "2026-10-08", "2026-10-08"],
    ["tomorrow", "2026-10-10", "2026-10-10"],
    ["this_week", "2026-10-05", "2026-10-11"],
    ["last_week", "2026-09-28", "2026-10-04"],
    ["next_7_days", "2026-10-09", "2026-10-15"],
    ["this_month", "2026-10-01", "2026-10-31"],
    ["last_month", "2026-09-01", "2026-09-30"],
    ["last_7_days", "2026-10-03", "2026-10-09"],
    ["last_30_days", "2026-09-10", "2026-10-09"],
  ] as const)("%s resolves in Asia/Kolkata", (period, from, to) => {
    expect(resolveKiaraPeriod(period, lateFriday, IST)).toEqual({ from, to });
    expect(resolveKiaraPeriod(period, earlyFriday, IST)).toEqual({ from, to });
  });

  it("starts weeks on Monday, including on a Sunday", () => {
    const sunday = new Date("2026-10-11T06:00:00Z");
    expect(resolveKiaraPeriod("this_week", sunday, IST)).toEqual({ from: "2026-10-05", to: "2026-10-11" });
  });

  it("handles month and year boundaries", () => {
    const newYear = new Date("2027-01-01T04:00:00Z");
    expect(resolveKiaraPeriod("last_month", newYear, IST)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(resolveKiaraPeriod("yesterday", newYear, IST)).toEqual({ from: "2026-12-31", to: "2026-12-31" });
    const leap = new Date("2028-02-10T04:00:00Z");
    expect(resolveKiaraPeriod("this_month", leap, IST)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("covers every declared period", () => {
    for (const period of KIARA_PERIODS) expect(kiaraRangeDays(resolveKiaraPeriod(period, lateFriday, IST))).toBeGreaterThan(0);
  });
});

describe("tool input ranges", () => {
  it("accepts a period, explicit dates, a single date, or nothing", () => {
    expect(kiaraRangeFromInput({ period: "tomorrow" }, lateFriday, IST)).toEqual({ ok: true, range: { from: "2026-10-10", to: "2026-10-10" } });
    expect(kiaraRangeFromInput({ from: "2026-10-01", to: "2026-10-05" }, lateFriday, IST)).toEqual({ ok: true, range: { from: "2026-10-01", to: "2026-10-05" } });
    expect(kiaraRangeFromInput({ from: "2026-10-01" }, lateFriday, IST)).toEqual({ ok: true, range: { from: "2026-10-01", to: "2026-10-01" } });
    expect(kiaraRangeFromInput({}, lateFriday, IST)).toEqual({ ok: true, range: null });
  });

  it("rejects mixed, malformed, reversed, and over-long ranges", () => {
    expect(kiaraRangeFromInput({ period: "today", from: "2026-10-01" }, lateFriday, IST).ok).toBe(false);
    expect(kiaraRangeFromInput({ period: "kal" }, lateFriday, IST).ok).toBe(false);
    expect(kiaraRangeFromInput({ from: "2026-02-30" }, lateFriday, IST).ok).toBe(false);
    expect(kiaraRangeFromInput({ from: "2026-10-05", to: "2026-10-01" }, lateFriday, IST).ok).toBe(false);
    expect(kiaraRangeFromInput({ from: "2026-01-01", to: "2026-12-31" }, lateFriday, IST, 90).ok).toBe(false);
  });

  it("validates dates strictly", () => {
    expect(isIsoDate("2026-10-09")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("9 Oct")).toBe(false);
  });
});
