import { describe, expect, it } from "vitest";
import { countLeaveDays, leaveInformStatus, validateLeaveDates } from "./leave";

describe("Apps Script leave rules", () => {
  it("counts same-day and Sunday exclusions", () => {
    expect(countLeaveDays("FULL DAY", "2026-09-24", "2026-09-24", "2026-09-24", "2ND HALF")).toBe(0.5);
    expect(countLeaveDays("2ND HALF", "2026-09-24", "2026-09-24", "2026-09-24", "2ND HALF")).toBe(0);
    expect(countLeaveDays("FULL DAY", "2026-09-26", "2026-09-27", "2026-09-28", "1ST HALF")).toBe(1);
    expect(countLeaveDays("FULL DAY", "2026-09-27", "2026-09-27", "2026-09-27", "2ND HALF")).toBe(0.5);
  });
  it("retains the source long second-half special case", () => {
    expect(countLeaveDays("2ND HALF", "2026-09-24", "2026-09-28", "2026-09-29", "2ND HALF")).toBe(4.5);
  });
  it("classifies advance notice using source thresholds", () => {
    expect(leaveInformStatus("2026-09-01", "2026-09-24", "2026-09-24")).toBe("Inform Adv");
    expect(leaveInformStatus("2026-09-23", "2026-09-24", "2026-09-24")).toBe("Not inform In Adv");
  });
  it("rejects impossible or reversed dates", () => {
    expect(() => validateLeaveDates("2026-02-30", "2026-03-02", "2026-03-03")).toThrow();
    expect(() => validateLeaveDates("2026-09-25", "2026-09-24", "2026-09-26")).toThrow();
    expect(() => validateLeaveDates("2026-09-24", "2026-09-26", "2026-09-25")).toThrow();
  });
});
