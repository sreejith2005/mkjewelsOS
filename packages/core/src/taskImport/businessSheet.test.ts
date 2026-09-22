import { describe, expect, it } from "vitest";
import {
  COMPACT_TASK_IMPORT_HEADERS,
  IDEAL_TASK_IMPORT_HEADERS,
  isTaskImportDraftSourceFormat,
  normalizeBusinessTaskSheet,
} from "./businessSheet";
import { createDefaultTaskImportTimingPresets } from "./frequency";

const businessRow = (overrides: Record<string, string> = {}) =>
  Object.fromEntries(IDEAL_TASK_IMPORT_HEADERS.map((header) => [header, overrides[header] ?? ""]));

describe("business task sheets", () => {
  it("identifies every draft-format adapter without including canonical workbooks", () => {
    expect(["ideal_business_sheet", "compact_work_list", "mk_daily_checklist_csv"].every(isTaskImportDraftSourceFormat)).toBe(true);
    expect(isTaskImportDraftSourceFormat("canonical")).toBe(false);
  });

  it("publishes the exact compact source signature", () => {
    expect(COMPACT_TASK_IMPORT_HEADERS).toEqual([
      "EMPLOYEE NAME", "DESIGNATION", "MAIN TASK", "TASK TYPE", "TASK FREQUENCY", "KRA",
    ]);
  });

  it("defaults optional cells while retaining one source row", () => {
    const result = normalizeBusinessTaskSheet([
      businessRow({ "MAIN TASK": "Clean display", "EMPLOYEE NAME": "Named Person" }),
    ], {
      format: "ideal_business_sheet",
      defaultStartsOn: "2026-09-22",
      timingPresets: { manual: { startTime: "09:00", dueTime: "18:00" } },
    });

    expect(result.issues).toEqual([]);
    expect(result.requiredTimingPresets).toEqual(["manual"]);
    expect(result.draftRows).toHaveLength(1);
    expect(result.draftRows[0]).toMatchObject({
      source_row: 2,
      title: "Clean display",
      task_type: "delegation",
      schedule_kind: "as_required",
      priority: "medium",
      buddy_assignment_allowed: true,
      is_active: false,
      assignment_status: "assigning_left",
    });
  });

  it.each([
    ["Daily - Opening", "11:00", "13:00", 0],
    ["As Required", "11:00", "20:00", 0],
    ["Throughout Day", "11:00", "20:00", 0],
    ["3x Daily", "11:00", "20:00", 3],
  ])("uses store-hour defaults for %s", (frequency, startTime, dueTime, checkpoints) => {
    const result = normalizeBusinessTaskSheet([
      businessRow({ "MAIN TASK": "Synthetic task", "TASK FREQUENCY": frequency }),
    ], {
      format: "ideal_business_sheet",
      defaultStartsOn: "2026-09-22",
      timingPresets: createDefaultTaskImportTimingPresets(),
    });

    expect(result.issues).toEqual([]);
    expect(result.draftRows).toHaveLength(1);
    expect(result.draftRows[0]).toMatchObject({ start_time: startTime, due_time: dueTime });
    expect(result.draftRows[0]?.checklist).toHaveLength(checkpoints);
  });

  it("lets valid explicit times override only their side of a default window", () => {
    const startOverride = normalizeBusinessTaskSheet([
      businessRow({
        "MAIN TASK": "Synthetic opening task",
        "TASK FREQUENCY": "Daily - Opening",
        "START TIME": "12:00",
      }),
    ], {
      format: "ideal_business_sheet",
      defaultStartsOn: "2026-09-22",
      timingPresets: createDefaultTaskImportTimingPresets(),
    });
    const dueOverride = normalizeBusinessTaskSheet([
      businessRow({
        "MAIN TASK": "Synthetic opening task",
        "TASK FREQUENCY": "Daily - Opening",
        "DUE TIME": "14:00",
      }),
    ], {
      format: "ideal_business_sheet",
      defaultStartsOn: "2026-09-22",
      timingPresets: createDefaultTaskImportTimingPresets(),
    });

    expect(startOverride.draftRows[0]).toMatchObject({ start_time: "12:00", due_time: "13:00" });
    expect(dueOverride.draftRows[0]).toMatchObject({ start_time: "11:00", due_time: "14:00" });
  });

  it("does not replace an invalid explicit time with a store-hour default", () => {
    const result = normalizeBusinessTaskSheet([
      businessRow({
        "MAIN TASK": "Synthetic opening task",
        "TASK FREQUENCY": "Daily - Opening",
        "START TIME": "eleven",
      }),
    ], {
      format: "ideal_business_sheet",
      defaultStartsOn: "2026-09-22",
      timingPresets: createDefaultTaskImportTimingPresets(),
    });

    expect(result.issues).toContainEqual(expect.objectContaining({ field: "START TIME" }));
    expect(result.draftRows[0]).toMatchObject({ start_time: "eleven", due_time: "13:00" });
  });

  it("uses explicit newline checkpoints instead of generated checkpoints", () => {
    const result = normalizeBusinessTaskSheet([
      businessRow({
        "MAIN TASK": "Update follow-ups",
        "TASK FREQUENCY": "Morning & Evening",
        CHECKPOINTS: "Opening review\nClosing review",
      }),
    ], {
      format: "ideal_business_sheet",
      defaultStartsOn: "2026-09-22",
      timingPresets: {
        morning: { startTime: "09:00", dueTime: "12:00" },
        evening: { startTime: "17:00", dueTime: "19:00" },
      },
    });
    expect(result.draftRows[0]?.checklist.map((item) => item.item_text))
      .toEqual(["Opening review", "Closing review"]);
  });

  it("keeps one source row when a frequency generates checkpoints", () => {
    const result = normalizeBusinessTaskSheet([
      businessRow({ "MAIN TASK": "Inspect cases", "TASK FREQUENCY": "3× Daily" }),
    ], {
      format: "ideal_business_sheet",
      defaultStartsOn: "2026-09-22",
      timingPresets: { general: { startTime: "09:00", dueTime: "18:00" } },
    });
    expect(result.draftRows).toHaveLength(1);
    expect(result.draftRows[0]?.checklist).toHaveLength(3);
  });

  it("accepts commas, quotes, and embedded newlines as plain text", () => {
    const description = "Check rings, chains, and \"special orders\"\nRecord exceptions.";
    const result = normalizeBusinessTaskSheet([
      businessRow({ "MAIN TASK": "Review, record, report", "TASK DESCRIPTION": description }),
    ], {
      format: "ideal_business_sheet",
      timingPresets: { manual: { startTime: "09:00", dueTime: "18:00" } },
    });
    expect(result.draftRows[0]?.description).toBe(description);
  });

  it("rejects unsafe or invalid explicit values", () => {
    const result = normalizeBusinessTaskSheet([
      businessRow({
        "MAIN TASK": `=${"A".repeat(500)}`,
        "START TIME": "9am",
        "DUE TIME": "18:00",
        "EVIDENCE REQUIRED": "sometimes",
      }),
    ], { format: "ideal_business_sheet" });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "cell" }),
      expect.objectContaining({ field: "MAIN TASK" }),
      expect.objectContaining({ field: "START TIME" }),
      expect.objectContaining({ field: "EVIDENCE REQUIRED" }),
    ]));
  });

  it("normalizes the six-column operational list without using designation for identity", () => {
    const result = normalizeBusinessTaskSheet([{
      "EMPLOYEE NAME": "Named Person",
      DESIGNATION: "Sales Executive",
      "MAIN TASK": "Attend customer",
      "TASK TYPE": "",
      "TASK FREQUENCY": "Per Customer",
      KRA: "Customer Experience",
    }], {
      format: "compact_work_list",
      defaultStartsOn: "2026-09-22",
      timingPresets: { manual: { startTime: "09:00", dueTime: "18:00" } },
    });

    expect(result.issues).toEqual([]);
    expect(result.draftRows[0]).toMatchObject({
      assignee_name: "Named Person",
      title: "Attend customer",
      task_type: "delegation",
      schedule_kind: "as_required",
      category: "Customer Experience",
    });
    expect(JSON.stringify(result.draftRows[0])).not.toContain("Sales Executive");
  });

  it("reports only the timing preset actually needed by blank cells", () => {
    const result = normalizeBusinessTaskSheet([
      businessRow({
        "MAIN TASK": "Open showroom",
        "TASK FREQUENCY": "Daily – Opening",
        "START TIME": "08:30",
      }),
    ], { format: "ideal_business_sheet", defaultStartsOn: "2026-09-22" });
    expect(result.requiredTimingPresets).toEqual(["opening"]);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: "DUE TIME" }));
    expect(result.issues).not.toContainEqual(expect.objectContaining({ field: "START TIME" }));
  });

  it("does not accept an invalid timing preset as configured", () => {
    const result = normalizeBusinessTaskSheet([
      businessRow({ "MAIN TASK": "Review counter", "TASK FREQUENCY": "Daily" }),
    ], {
      format: "ideal_business_sheet",
      defaultStartsOn: "2026-09-22",
      timingPresets: { general: { startTime: "9am", dueTime: "18:00" } },
    });
    expect(result.requiredTimingPresets).toEqual(["general"]);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: "START TIME" }));
  });

  it("requires complete windows for compound morning and evening timing", () => {
    const result = normalizeBusinessTaskSheet([
      businessRow({ "MAIN TASK": "Review follow-ups", "TASK FREQUENCY": "Morning & Evening" }),
    ], {
      format: "ideal_business_sheet",
      defaultStartsOn: "2026-09-22",
      timingPresets: {
        morning: { startTime: "09:00", dueTime: "12:00" },
        evening: { startTime: "", dueTime: "19:00" },
      },
    });
    expect(result.requiredTimingPresets).toEqual(["evening", "morning"]);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: "DUE TIME" }));
  });

  it("keeps a configured preset visible when its due time conflicts with an explicit row start", () => {
    const result = normalizeBusinessTaskSheet([
      businessRow({
        "MAIN TASK": "Late review",
        "TASK FREQUENCY": "Daily",
        "START TIME": "15:00",
      }),
    ], {
      format: "ideal_business_sheet",
      defaultStartsOn: "2026-09-22",
      timingPresets: { general: { startTime: "09:00", dueTime: "12:00" } },
    });
    expect(result.requiredTimingPresets).toEqual(["general"]);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: "DUE TIME", reason: "Due time must be later than start time" }));
  });

  it("retains the physical worksheet row number after a blank line", () => {
    const source = { ...businessRow({ "MAIN TASK": "Physical row four" }), __rowNum__: 3 };
    const result = normalizeBusinessTaskSheet([source], {
      format: "ideal_business_sheet",
      timingPresets: { manual: { startTime: "09:00", dueTime: "18:00" } },
    });
    expect(result.draftRows[0]?.source_row).toBe(4);
  });

  it("blocks a populated row beyond the server source-row limit", () => {
    const source = { ...businessRow({ "MAIN TASK": "Too far down" }), __rowNum__: 2501 };
    const result = normalizeBusinessTaskSheet([source], {
      format: "ideal_business_sheet",
      timingPresets: { manual: { startTime: "09:00", dueTime: "18:00" } },
    });
    expect(result.issues).toContainEqual(expect.objectContaining({
      row: 2502,
      field: "sheet",
      reason: "Task rows must stay within worksheet row 2501",
    }));
  });

  it("allows a blank verifier so the assignee manager fallback can run", () => {
    const result = normalizeBusinessTaskSheet([
      businessRow({ "MAIN TASK": "Verify closing", "VERIFICATION REQUIRED": "Yes" }),
    ], {
      format: "ideal_business_sheet",
      timingPresets: { manual: { startTime: "09:00", dueTime: "18:00" } },
    });
    expect(result.issues).toEqual([]);
    expect(result.draftRows[0]).toMatchObject({ verification_required: true, verifier_label: "" });
  });
});
