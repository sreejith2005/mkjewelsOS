import { describe, expect, it } from "vitest";
import { buildScheduleRule } from "../recurrenceBuilder";
import {
  createDefaultTaskImportTimingPresets,
  normalizeTaskFrequencyLabel,
  planTaskImportFrequency,
  taskImportScheduledStart,
  taskImportTriggerLabel,
} from "./frequency";

const OBSERVED_TIMING_CASES = [
  ["", "manual", "manual"],
  ["13th Monthly", "general", "general"],
  ["1st Monthly", "general", "general"],
  ["1st Week Monthly", "general", "general"],
  ["2\u00c3\u0097 Daily", "opening", "closing"],
  ["3\u00c3\u0097 Daily", "opening", "closing"],
  ["7th Monthly", "general", "general"],
  ["After Customer Visit", "manual", "manual"],
  ["After Event", "manual", "manual"],
  ["After Serving", "manual", "manual"],
  ["After Shoot", "manual", "manual"],
  ["After Visit", "manual", "manual"],
  ["Annual", "general", "general"],
  ["As Applicable", "manual", "manual"],
  ["As Assigned", "manual", "manual"],
  ["As Required", "manual", "manual"],
  ["As Required/Ongoing", "manual", "manual"],
  ["As Scheduled", "manual", "manual"],
  ["Campaign-Based", "manual", "manual"],
  ["Daily", "general", "general"],
  ["Daily / As Required", "general", "general"],
  ["Daily \u00e2\u0080\u0093 Closing", "closing", "closing"],
  ["Daily \u00e2\u0080\u0093 Morning", "morning", "morning"],
  ["Daily \u00e2\u0080\u0093 Opening", "opening", "opening"],
  ["Daily \u00e2\u0080\u0093 T-1", "general", "general"],
  ["Daily/As Assigned", "general", "general"],
  ["Daily/As Posted", "general", "general"],
  ["Daily/As Required", "general", "general"],
  ["Daily/As Scheduled", "general", "general"],
  ["Daily/Monthly", "general", "general"],
  ["Daily/Ongoing", "general", "general"],
  ["Daily/Per Refill", "general", "general"],
  ["Daily/Weekly", "general", "general"],
  ["Every 15 Days", "general", "general"],
  ["Every Monday", "general", "general"],
  ["Monday & Thursday", "general", "general"],
  ["Monday & Thursday/As Required", "general", "general"],
  ["Monthly", "general", "general"],
  ["Monthly / As Required", "general", "general"],
  ["Monthly \u00e2\u0080\u0093 1st to 5th", "general", "general"],
  ["Monthly/As Required", "general", "general"],
  ["Monthly/As Scheduled", "general", "general"],
  ["Morning & Closing", "morning", "closing"],
  ["Morning & Evening", "morning", "evening"],
  ["Ongoing", "manual", "manual"],
  ["Per Bag", "manual", "manual"],
  ["Per CAM Piece", "manual", "manual"],
  ["Per Call", "manual", "manual"],
  ["Per Customer", "manual", "manual"],
  ["Per Customer/As Applicable", "manual", "manual"],
  ["Per Enquiry", "manual", "manual"],
  ["Per Follow-Up", "manual", "manual"],
  ["Per Interaction", "manual", "manual"],
  ["Per Issue", "manual", "manual"],
  ["Per Job", "manual", "manual"],
  ["Per Lead", "manual", "manual"],
  ["Per Lost Lead", "manual", "manual"],
  ["Per Movement", "manual", "manual"],
  ["Per Not-Bought Customer", "manual", "manual"],
  ["Per Parcel", "manual", "manual"],
  ["Per Piece/Batch", "manual", "manual"],
  ["Per Product", "manual", "manual"],
  ["Per Prospect", "manual", "manual"],
  ["Per Receipt", "manual", "manual"],
  ["Per Video Call", "manual", "manual"],
  ["Per Visit", "manual", "manual"],
  ["Shoot Days", "manual", "manual"],
  ["Sunday", "general", "general"],
  ["Throughout Day", "opening", "closing"],
  ["Weekly", "general", "general"],
  ["Weekly/As Required", "general", "general"],
  ["Weekly/As Scheduled", "general", "general"],
] as const;

describe("task import frequency planning", () => {
  it("keeps every observed frequency on its approved timing family", () => {
    expect(OBSERVED_TIMING_CASES).toHaveLength(72);
    for (const [frequency, startTimingPreset, dueTimingPreset] of OBSERVED_TIMING_CASES) {
      expect(planTaskImportFrequency(frequency, "2026-09-22", "Synthetic task")).toMatchObject({
        startTimingPreset,
        dueTimingPreset,
      });
    }
  });

  it("creates independent store-hour timing defaults", () => {
    const first = createDefaultTaskImportTimingPresets();
    const second = createDefaultTaskImportTimingPresets();

    expect(first).toEqual({
      general: { startTime: "11:00", dueTime: "13:00" },
      opening: { startTime: "11:00", dueTime: "13:00" },
      morning: { startTime: "11:00", dueTime: "13:00" },
      closing: { startTime: "18:00", dueTime: "20:00" },
      evening: { startTime: "18:00", dueTime: "20:00" },
      manual: { startTime: "11:00", dueTime: "20:00" },
    });
    expect(first).not.toBe(second);
    expect(first.general).not.toBe(second.general);
    expect(first.manual).not.toBe(second.manual);
  });

  it.each([
    ["Daily – Opening", "daily - opening"],
    ["Daily — Closing", "daily - closing"],
    ["Daily / As Required", "daily/as required"],
    ["3× Daily", "3x daily"],
    ["Daily \u00e2\u0080\u0093 Opening", "daily - opening"],
    ["2\u00c3\u0097 Daily", "2x daily"],
  ])("normalizes %s without losing meaning", (source, expected) => {
    expect(normalizeTaskFrequencyLabel(source)).toBe(expected);
  });

  it.each([
    ["Daily", "daily", "FREQ=DAILY"],
    ["Every Monday", "weekly", "FREQ=WEEKLY;BYDAY=MO"],
    ["Monday & Thursday", "weekly", "FREQ=WEEKLY;BYDAY=MO,TH"],
    ["1st Monthly", "monthly", "FREQ=MONTHLY;BYMONTHDAY=1"],
    ["Monthly – 1st to 5th", "monthly", "FREQ=MONTHLY;BYMONTHDAY=1,2,3,4,5"],
    ["Every 15 Days", "daily", "FREQ=DAILY;INTERVAL=15"],
    ["Annual", "yearly", "FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=22"],
    ["Per Customer", "as_required", "FREQ=DAILY"],
  ])("maps %s to a closed recurrence plan", (source, kind, rule) => {
    expect(planTaskImportFrequency(source, "2026-09-22", "Follow up")).toMatchObject({
      scheduleKind: kind,
      recurrenceRule: rule,
    });
  });

  it.each([
    "Daily",
    "Daily – T-1",
    "Daily/Ongoing",
    "Daily/As Required",
    "Daily/As Assigned",
    "Daily/As Posted",
    "Daily/As Scheduled",
    "Daily/Per Refill",
    "Daily/Weekly",
    "Daily/Monthly",
    "Throughout Day",
  ])("treats %s as one daily card", (frequency) => {
    expect(planTaskImportFrequency(frequency, "2026-09-22", "Task")).toMatchObject({
      scheduleKind: "daily",
      recurrenceRule: "FREQ=DAILY",
      generatedCheckpoints: [],
    });
  });

  it.each([
    ["Daily – Opening", "opening", "opening"],
    ["Daily – Morning", "morning", "morning"],
    ["Daily – Closing", "closing", "closing"],
    ["Morning & Evening", "morning", "evening"],
    ["Morning & Closing", "morning", "closing"],
  ])("selects explicit timing presets for %s", (frequency, start, due) => {
    expect(planTaskImportFrequency(frequency, "2026-09-22", "Task")).toMatchObject({
      startTimingPreset: start,
      dueTimingPreset: due,
    });
  });

  it.each([
    ["2× Daily", ["Checkpoint 1: Update follow-ups", "Checkpoint 2: Update follow-ups"]],
    ["3x Daily", ["Checkpoint 1: Update follow-ups", "Checkpoint 2: Update follow-ups", "Checkpoint 3: Update follow-ups"]],
    ["Morning & Evening", ["Morning: Update follow-ups", "Evening: Update follow-ups"]],
    ["Morning & Closing", ["Morning: Update follow-ups", "Closing: Update follow-ups"]],
  ])("creates one daily card with labeled checkpoints for %s", (frequency, checkpoints) => {
    expect(planTaskImportFrequency(frequency, "2026-09-22", "Update follow-ups"))
      .toMatchObject({
        scheduleKind: "daily",
        destination: "recurring_todo",
        generatedCheckpoints: checkpoints,
      });
  });

  it.each([
    ["Weekly", "FREQ=WEEKLY;BYDAY=TU"],
    ["Weekly/As Required", "FREQ=WEEKLY;BYDAY=TU"],
    ["Weekly/As Scheduled", "FREQ=WEEKLY;BYDAY=TU"],
    ["Every Monday", "FREQ=WEEKLY;BYDAY=MO"],
    ["Sunday", "FREQ=WEEKLY;BYDAY=SU"],
    ["Monday & Thursday", "FREQ=WEEKLY;BYDAY=MO,TH"],
    ["Monday & Thursday/As Required", "FREQ=WEEKLY;BYDAY=MO,TH"],
  ])("builds the weekly rule for %s", (frequency, rule) => {
    expect(planTaskImportFrequency(frequency, "2026-09-22", "Task").recurrenceRule).toBe(rule);
  });

  it.each([
    ["Monthly", "FREQ=MONTHLY;BYMONTHDAY=22"],
    ["Monthly/As Required", "FREQ=MONTHLY;BYMONTHDAY=22"],
    ["Monthly/As Scheduled", "FREQ=MONTHLY;BYMONTHDAY=22"],
    ["1st Monthly", "FREQ=MONTHLY;BYMONTHDAY=1"],
    ["1st Week Monthly", "FREQ=MONTHLY;BYMONTHDAY=1"],
    ["7th Monthly", "FREQ=MONTHLY;BYMONTHDAY=7"],
    ["13th Monthly", "FREQ=MONTHLY;BYMONTHDAY=13"],
    ["Monthly - 1st to 5th", "FREQ=MONTHLY;BYMONTHDAY=1,2,3,4,5"],
  ])("builds the monthly rule for %s", (frequency, rule) => {
    expect(planTaskImportFrequency(frequency, "2026-09-22", "Task").recurrenceRule).toBe(rule);
  });

  it.each([
    "As Required",
    "As Required/Ongoing",
    "As Scheduled",
    "As Assigned",
    "As Applicable",
    "Ongoing",
    "Campaign-Based",
    "Shoot Days",
    "Per Customer",
    "Per Customer/As Applicable",
    "Per Lead",
    "Per Product",
    "Per Not-Bought Customer",
    "Per Receipt",
    "Per Call",
    "Per Enquiry",
    "Per Visit",
    "Per Refill",
    "Per Piece/Batch",
    "Per Job",
    "Per Issue",
    "Per Bag",
    "Per Lost Lead",
    "Per Parcel",
    "Per CAM Piece",
    "Per Prospect",
    "Per Follow-Up",
    "Per Interaction",
    "Per Movement",
    "Per Video Call",
    "After Serving",
    "After Customer Visit",
    "After Shoot",
    "After Event",
    "After Visit",
  ])("maps observed event label %s to manual work", (frequency) => {
    expect(planTaskImportFrequency(frequency, "2026-09-22", "Task")).toMatchObject({
      scheduleKind: "as_required",
      destination: "recurring_todo",
      recurrenceRule: "FREQ=DAILY",
      startTimingPreset: "manual",
      dueTimingPreset: "manual",
    });
  });

  it.each([
    ["Daily - Opening", "opening", "opening"],
    ["Daily - Morning", "morning", "morning"],
    ["Daily - Closing", "closing", "closing"],
    ["Throughout Day", "opening", "closing"],
    ["2x Daily", "opening", "closing"],
    ["3x Daily", "opening", "closing"],
    ["Morning & Evening", "morning", "evening"],
    ["Morning & Closing", "morning", "closing"],
    ["As Required", "manual", "manual"],
    ["Per Customer", "manual", "manual"],
    ["Per Lead", "manual", "manual"],
    ["After Visit", "manual", "manual"],
    ["", "manual", "manual"],
  ])("selects the store-hour timing family for %s", (frequency, start, due) => {
    expect(planTaskImportFrequency(frequency, "2026-09-22", "Task")).toMatchObject({
      startTimingPreset: start,
      dueTimingPreset: due,
    });
  });

  it("treats a blank frequency as manual but rejects unknown text", () => {
    expect(planTaskImportFrequency("", "", "Task").scheduleKind).toBe("as_required");
    expect(() => planTaskImportFrequency("Whenever possible", "2026-09-22", "Task"))
      .toThrow(/unsupported frequency/i);
  });

  it("keeps the sheet wording only for event-driven work", () => {
    expect(taskImportTriggerLabel(" Per  Customer ", "as_required")).toBe("Per Customer");
    expect(taskImportTriggerLabel("Per Customer / As Applicable", "as_required")).toBe("Per Customer/As Applicable");
    expect(taskImportTriggerLabel("Per Not-Bought Customer", "as_required")).toBe("Per Not-Bought Customer");
    expect(taskImportTriggerLabel("", "as_required")).toBe("");
    expect(taskImportTriggerLabel("Daily – Opening", "daily")).toBe("");
    expect(taskImportTriggerLabel("x".repeat(120), "as_required")).toHaveLength(80);
  });
});

describe("calendar frequencies read by the shared schedule builder", () => {
  // 2026-10-21 is a Wednesday.
  it.each([
    ["3rd Saturday", "monthly", "FREQ=MONTHLY;BYDAY=3SA", "2026-11-21"],
    ["Third Saturday of every month", "monthly", "FREQ=MONTHLY;BYDAY=3SA", "2026-11-21"],
    ["Last Friday", "monthly", "FREQ=MONTHLY;BYDAY=-1FR", "2026-10-30"],
    ["Last Friday Monthly", "monthly", "FREQ=MONTHLY;BYDAY=-1FR", "2026-10-30"],
    ["2nd Saturday", "monthly", "FREQ=MONTHLY;BYDAY=2SA", "2026-11-14"],
    ["First Monday", "monthly", "FREQ=MONTHLY;BYDAY=1MO", "2026-11-02"],
    ["Every Saturday", "weekly", "FREQ=WEEKLY;BYDAY=SA", "2026-10-24"],
    ["Tuesday & Friday", "weekly", "FREQ=WEEKLY;BYDAY=TU,FR", "2026-10-23"],
    ["Mon, Wed & Fri", "weekly", "FREQ=WEEKLY;BYDAY=MO,WE,FR", "2026-10-21"],
    ["Monday to Saturday", "weekly", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA", "2026-10-21"],
    ["Every 2 Days", "daily", "FREQ=DAILY;INTERVAL=2", "2026-10-21"],
    ["Every 7 Days", "daily", "FREQ=DAILY;INTERVAL=7", "2026-10-21"],
    ["Every 30 Days", "daily", "FREQ=DAILY;INTERVAL=30", "2026-10-21"],
    ["Every 2 Weeks", "weekly", "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE", "2026-10-21"],
    ["Fortnightly", "weekly", "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE", "2026-10-21"],
    ["Every 2 Months", "monthly", "FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=21", "2026-10-21"],
    ["Half Yearly", "monthly", "FREQ=MONTHLY;INTERVAL=6;BYMONTHDAY=21", "2026-10-21"],
    ["Every 2 Years", "yearly", "FREQ=YEARLY;INTERVAL=2;BYMONTH=10;BYMONTHDAY=21", "2026-10-21"],
    ["25th Monthly", "monthly", "FREQ=MONTHLY;BYMONTHDAY=25", "2026-10-25"],
    ["Last Day of Month", "monthly", "FREQ=MONTHLY;BYMONTHDAY=-1", "2026-10-31"],
    ["Month End", "monthly", "FREQ=MONTHLY;BYMONTHDAY=-1", "2026-10-31"],
  ])("plans %s and starts it on its first real date", (label, kind, rule, firstDate) => {
    const plan = planTaskImportFrequency(label, "2026-10-21", "Task");
    expect(plan).toMatchObject({ scheduleKind: kind, recurrenceRule: rule, destination: "recurring_todo", anchorStart: true });
    expect(taskImportScheduledStart(plan, "2026-10-21")).toBe(firstDate);
  });

  it("builds the same rule as Create Task for the same schedule", () => {
    expect(planTaskImportFrequency("3rd Saturday", "2026-10-21", "Task").recurrenceRule)
      .toBe(buildScheduleRule({ pattern: "monthly_weekday", interval: 1, ordinal: 3, weekday: "SA", end: { type: "never" } }).recurrenceRule);
    expect(planTaskImportFrequency("Every Monday", "2026-10-21", "Task").recurrenceRule)
      .toBe(buildScheduleRule({ pattern: "weekly", interval: 1, weekdays: ["MO"], end: { type: "never" } }).recurrenceRule);
    expect(planTaskImportFrequency("Quarterly", "2026-10-21", "Task").recurrenceRule)
      .toBe(buildScheduleRule({ pattern: "monthly_dates", interval: 3, days: [21], end: { type: "never" } }).recurrenceRule);
    expect(planTaskImportFrequency("Annual", "2026-10-21", "Task").recurrenceRule)
      .toBe(buildScheduleRule({ pattern: "yearly", interval: 1, months: [10], day: 21, end: { type: "never" } }).recurrenceRule);
  });

  it("keeps older labels on the date the sheet gave them", () => {
    const plan = planTaskImportFrequency("Every Monday", "2026-10-21", "Task");
    expect(plan.anchorStart).toBeUndefined();
    expect(taskImportScheduledStart(plan, "2026-10-21")).toBe("2026-10-21");
  });

  it.each(["Per Order", "As Needed", "On Demand"])("treats %s as an anytime duty", (label) => {
    expect(planTaskImportFrequency(label, "2026-10-21", "Task")).toMatchObject({ scheduleKind: "as_required", recurrenceRule: "FREQ=DAILY" });
    expect(taskImportTriggerLabel(label, "as_required")).toBe(label);
  });

  it.each(["Saturday to Monday", "5th Saturday", "Every 0 Days", "Every 100 Days", "32nd Monthly", "Bi-annual", "Whenever", "Per Whatever"])(
    "still rejects %s instead of guessing",
    (label) => {
      expect(() => planTaskImportFrequency(label, "2026-10-21", "Task")).toThrow(/unsupported frequency/i);
    },
  );
});
