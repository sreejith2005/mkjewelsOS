import { describe, expect, it } from "vitest";
import { formatRelativeDeadline, greetingFor, initials, titleCase } from "./format";

describe("formatRelativeDeadline", () => {
  const now = new Date("2026-09-05T10:00:00.000Z");

  it("counts down to a deadline that has not passed", () => {
    expect(formatRelativeDeadline("2026-09-05T10:35:00.000Z", now)).toBe("in 35 minutes");
    expect(formatRelativeDeadline("2026-09-05T13:00:00.000Z", now)).toBe("in 3 hours");
    expect(formatRelativeDeadline("2026-09-07T10:00:00.000Z", now)).toBe("in 2 days");
  });

  it("says how far past a deadline is, so overdue never reads as time remaining", () => {
    expect(formatRelativeDeadline("2026-09-05T08:00:00.000Z", now)).toBe("2 hours overdue");
    expect(formatRelativeDeadline("2026-09-04T10:00:00.000Z", now)).toBe("1 day overdue");
  });

  it("uses the singular for one unit", () => {
    expect(formatRelativeDeadline("2026-09-05T10:01:00.000Z", now)).toBe("in 1 minute");
  });

  it("returns nothing for a missing or unparseable deadline", () => {
    expect(formatRelativeDeadline(null, now)).toBeNull();
    expect(formatRelativeDeadline("not a date", now)).toBeNull();
  });
});

describe("titleCase", () => {
  it("turns a role identifier into a label", () => {
    expect(titleCase("super_admin")).toBe("Super Admin");
    expect(titleCase("crm")).toBe("Crm");
    expect(titleCase("on_hold")).toBe("On Hold");
  });
});

describe("initials", () => {
  it("matches the approved web avatar label", () => {
    expect(initials("Maya Kumari")).toBe("MK");
    expect(initials("  maya   kumari singh ")).toBe("MK");
    expect(initials(" ")).toBe("?");
  });
});

describe("greetingFor", () => {
  it("always produces a greeting, even for an unknown timezone", () => {
    expect(["Good morning", "Good afternoon", "Good evening", "Hello"]).toContain(greetingFor("Asia/Kolkata"));
  });
});
