import { describe, expect, it } from "vitest";
import { normalizeAvailabilityRange } from "./dateRange";

describe("normalizeAvailabilityRange", () => {
  it("uses the start date for a single-day update", () => {
    expect(normalizeAvailabilityRange("2026-08-22", "")).toEqual({ startDate: "2026-08-22", endDate: "2026-08-22" });
  });

  it("accepts an inclusive ordered range", () => {
    expect(normalizeAvailabilityRange("2026-08-22", "2026-08-24")).toEqual({ startDate: "2026-08-22", endDate: "2026-08-24" });
  });

  it("rejects a reversed range", () => {
    expect(() => normalizeAvailabilityRange("2026-08-24", "2026-08-22")).toThrow("End date cannot be before start date");
  });
});
