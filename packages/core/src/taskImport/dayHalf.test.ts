import { describe, expect, it } from "vitest";
import { IDEAL_TASK_IMPORT_HEADERS, normalizeBusinessTaskSheet } from "./businessSheet";
import { createDefaultTaskImportTimingPresets, planTaskImportFrequency } from "./frequency";
import { LEGACY_TASK_HEADERS, normalizeLegacyTaskSheet } from "./legacySheet";

const businessRow = (overrides: Record<string, string> = {}) =>
  Object.fromEntries(IDEAL_TASK_IMPORT_HEADERS.map((header) => [header, overrides[header] ?? ""]));
const business = (overrides: Record<string, string>) => normalizeBusinessTaskSheet([businessRow({ "MAIN TASK": "Count stock", ...overrides })], {
  format: "ideal_business_sheet", defaultStartsOn: "2026-11-03", timingPresets: createDefaultTaskImportTimingPresets(),
});
const legacyRow = (overrides: Record<string, string> = {}) => Object.fromEntries(LEGACY_TASK_HEADERS.map((header) => [header, overrides[header] ?? ({
  "EMPLOYEE EMAIL": "person@example.com", "EMPLOYEE NAME": "Person", DEPARTMENT: "Sales", "BRANCH NAME": "Bandra",
  "TASK TYPE": "TASK", "CORE TASK": "Opening", TASK: "Open showroom", "TASK DESCRIPTION": "", FREQUENCY: "Daily",
  "TASK START DATE": "2026-11-03", "START TIME": "", "DUE TIME": "", PRIORITY: "Medium",
  "EVIDENCE REQUIRED": "No", "VERIFICATION REQUIRED": "No", VERIFIER: "", "BUDDY ALLOWED": "No", ACTIVE: "Yes",
} as Record<string, string>)[header] ?? ""]));

describe("First Half / Second Half frequencies", () => {
  it.each([
    ["First Half", "daily", "FREQ=DAILY", "first_half"],
    ["1st Half", "daily", "FREQ=DAILY", "first_half"],
    ["Daily - First Half", "daily", "FREQ=DAILY", "first_half"],
    ["Daily \u2013 2nd Half", "daily", "FREQ=DAILY", "second_half"],
    ["Daily/Second Half", "daily", "FREQ=DAILY", "second_half"],
    ["Daily (Second Half)", "daily", "FREQ=DAILY", "second_half"],
    ["Every Monday - First Half", "weekly", "FREQ=WEEKLY;BYDAY=MO", "first_half"],
    ["Monthly - Second-Half", "monthly", "FREQ=MONTHLY;BYMONTHDAY=3", "second_half"],
    ["As Required - First Half", "as_required", "FREQ=DAILY", "first_half"],
  ] as const)("%s keeps its schedule and is due in the %s", (label, kind, rule, half) => {
    const plan = planTaskImportFrequency(label, "2026-11-03", "Count stock");
    expect(plan).toMatchObject({ scheduleKind: kind, recurrenceRule: rule, dueHalf: half });
  });

  it("keeps both halves as one task with two checkpoints, due at the end of the second half", () => {
    for (const label of ["First & Second Half", "Daily - First Half & Second Half", "Both Halves", "first and second half"]) {
      expect(planTaskImportFrequency(label, "2026-11-03", "Count stock")).toMatchObject({
        scheduleKind: "daily", recurrenceRule: "FREQ=DAILY", dueHalf: "second_half",
        generatedCheckpoints: ["First half: Count stock", "Second half: Count stock"],
      });
    }
  });

  it("does not treat Opening, Closing, Morning, Evening, General or Manual as a half", () => {
    for (const label of ["Daily - Opening", "Daily - Closing", "Daily - Morning", "Morning & Evening", "Daily", "As Required"]) {
      expect(planTaskImportFrequency(label, "2026-11-03", "Task").dueHalf).toBeUndefined();
    }
  });

  it("still rejects an unknown schedule with a half", () => {
    expect(() => planTaskImportFrequency("Sometimes - First Half", "2026-11-03", "Task")).toThrow("Unsupported frequency");
    expect(() => planTaskImportFrequency("First Half - Second Half", "2026-11-03", "Task")).toThrow("Unsupported frequency");
  });
});

describe("import rows with a half", () => {
  it("uses 3:00 PM for First Half and needs no timing preset", () => {
    const result = business({ "TASK FREQUENCY": "Daily - First Half" });
    expect(result.issues).toEqual([]);
    expect(result.requiredTimingPresets).toEqual(["general"]);
    expect(result.draftRows[0]).toMatchObject({ start_time: "11:00", due_time: "15:00", planned_at: "2026-11-03 11:00", due_at: "2026-11-03 15:00" });
  });

  it("uses 3:00 PM to 9:00 PM for Second Half and needs no timing preset", () => {
    const result = business({ "TASK FREQUENCY": "Second Half" });
    expect(result.issues).toEqual([]);
    expect(result.requiredTimingPresets).toEqual([]);
    expect(result.draftRows[0]).toMatchObject({ start_time: "15:00", due_time: "21:00", due_at: "2026-11-03 21:00" });
  });

  it("replaces an older sheet due time with the fixed deadline and says so", () => {
    const result = business({ "TASK FREQUENCY": "Daily - First Half", "START TIME": "10:00", "DUE TIME": "13:00" });
    expect(result.draftRows[0]).toMatchObject({ start_time: "10:00", due_time: "15:00" });
    expect(result.issues).toEqual([expect.objectContaining({ field: "DUE TIME", severity: "warning" })]);
  });

  it("keeps a sheet start time that is not before the deadline as an error", () => {
    const result = business({ "TASK FREQUENCY": "First Half", "START TIME": "16:00" });
    expect(result.issues).toEqual([expect.objectContaining({ field: "DUE TIME", severity: "error" })]);
  });

  it("leaves custom deadlines and other schedules unchanged", () => {
    expect(business({ "TASK FREQUENCY": "Daily", "DUE TIME": "18:30" }).draftRows[0]).toMatchObject({ due_time: "18:30" });
    expect(business({ "TASK FREQUENCY": "Daily - Morning" }).draftRows[0]).toMatchObject({ due_time: "13:00" });
    expect(business({ "TASK FREQUENCY": "Morning & Evening" }).draftRows[0]).toMatchObject({ due_time: "20:00" });
  });

  it("applies the same rule to the current task sheet", () => {
    const result = normalizeLegacyTaskSheet([
      legacyRow({ FREQUENCY: "Daily - Second Half" }),
      legacyRow({ FREQUENCY: "Daily - First Half", "START TIME": "09:00", "DUE TIME": "20:00" }),
    ], { timingPresets: createDefaultTaskImportTimingPresets() });
    expect(result.draftRows.map((row) => [row.start_time, row.due_time])).toEqual([["15:00", "21:00"], ["09:00", "15:00"]]);
    expect(result.issues).toEqual([expect.objectContaining({ row: 3, field: "DUE TIME", severity: "warning" })]);
  });
});
