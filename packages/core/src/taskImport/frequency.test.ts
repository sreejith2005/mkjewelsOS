import { describe, expect, it } from "vitest";
import { normalizeTaskFrequencyLabel, planTaskImportFrequency } from "./frequency";

describe("task import frequency planning", () => {
  it.each([
    ["Daily – Opening", "daily - opening"],
    ["Daily — Closing", "daily - closing"],
    ["Daily / As Required", "daily/as required"],
    ["3× Daily", "3x daily"],
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
      .toMatchObject({ scheduleKind: "daily", generatedCheckpoints: checkpoints });
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

  it("treats a blank frequency as manual but rejects unknown text", () => {
    expect(planTaskImportFrequency("", "", "Task").scheduleKind).toBe("as_required");
    expect(() => planTaskImportFrequency("Whenever possible", "2026-09-22", "Task"))
      .toThrow(/unsupported frequency/i);
  });
});
