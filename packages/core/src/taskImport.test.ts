import { describe, expect, it } from "vitest";
import {
  buildImportSchedule,
  chunkTaskImportRows,
  normalizeImportBoolean,
  normalizeLegacyFrequency,
} from "./taskImport";

describe("task import rules", () => {
  it("normalizes every supported legacy frequency", () => {
    expect(["Once", "Daily", "Weekly", "Monthly", "Quarterly", "Yearly", "As Required"].map(normalizeLegacyFrequency))
      .toEqual(["one_time", "daily", "weekly", "monthly", "quarterly", "yearly", "as_required"]);
  });

  it("builds anchored quarterly and yearly rules", () => {
    expect(buildImportSchedule("quarterly", "2026-09-17").recurrenceRule).toBe("FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=17");
    expect(buildImportSchedule("yearly", "2026-09-17").recurrenceRule).toBe("FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=17");
  });

  it("rejects blank explicit booleans", () => {
    expect(() => normalizeImportBoolean("")).toThrow(/required/i);
    expect(normalizeImportBoolean("YES")).toBe(true);
    expect(normalizeImportBoolean("0")).toBe(false);
  });

  it("chunks without losing row order", () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({ source_row: index + 2 }));
    expect(chunkTaskImportRows(rows).map((part) => part.length)).toEqual([100, 100, 1]);
    expect(chunkTaskImportRows(rows).flat()).toEqual(rows);
  });
});
