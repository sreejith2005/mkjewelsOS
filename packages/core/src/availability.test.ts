import { describe, expect, it } from "vitest";
import { normalizeAvailabilityRange } from "./availability";

describe("normalizeAvailabilityRange", () => {
  it("uses the start date for a single-day update", () => {
    expect(normalizeAvailabilityRange("2026-08-22", "")).toEqual({ startDate: "2026-08-22", endDate: "2026-08-22" });
  });

  it("accepts an inclusive ordered range", () => {
    expect(normalizeAvailabilityRange("2026-08-22", "2026-08-24")).toEqual({ startDate: "2026-08-22", endDate: "2026-08-24" });
  });

  it("rejects invalid and reversed ranges", () => {
    expect(() => normalizeAvailabilityRange("", "")).toThrow("Start date is required");
    expect(() => normalizeAvailabilityRange("2026-08-24", "2026-08-22")).toThrow("End date cannot be before start date");
  });

  it("rejects a range longer than 367 inclusive days", () => {
    expect(() => normalizeAvailabilityRange("2026-01-01", "2027-01-03")).toThrow("Availability range cannot exceed 367 days");
  });
});
