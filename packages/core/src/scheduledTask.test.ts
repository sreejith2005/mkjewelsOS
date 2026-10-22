import { describe, expect, it } from "vitest";
import {
  buildScheduledTaskPayload,
  scheduledTaskDraftFromTemplate,
  scheduledTaskStartsOn,
  validateScheduledTaskDraft,
  type ScheduledTaskDraft,
} from "./scheduledTask";

const assignee = { id: "user-1", branch_id: "branch-1", department_id: "dept-1" };

function draft(overrides: Partial<ScheduledTaskDraft> = {}): ScheduledTaskDraft {
  return {
    title: "Monthly stock audit",
    description: "",
    mode: "checklist",
    checklistItems: ["Count trays", "Sign register"],
    priority: "medium",
    formTemplateId: "",
    startTime: "11:00",
    dueTime: "18:00",
    // 2026-10-21 is a Wednesday.
    timing: { type: "calendar", spec: { pattern: "monthly_weekday", interval: 1, ordinal: 3, weekday: "SA", end: { type: "never" } }, startsOn: "2026-10-21" },
    verificationRequired: false,
    verifierId: "",
    followupEnabled: false,
    requiresRemark: false,
    buddy: true,
    active: true,
    personalPerformance: true,
    ...overrides,
  };
}

describe("scheduled task payload", () => {
  it("saves the third Saturday from its first real date", () => {
    const payload = buildScheduledTaskPayload(draft(), assignee, true);
    expect(payload).toMatchObject({
      recurrence_rule: "FREQ=MONTHLY;BYDAY=3SA",
      schedule_kind: "monthly",
      starts_on: "2026-11-21",
      planned_time: "11:00",
      due_time: "18:00",
      task_type: "checklist",
      requires_upload: false,
      default_assignee_user_id: "user-1",
      branch_id: "branch-1",
      department_id: "dept-1",
      is_active: true,
      checklist_items: [
        { item_text: "Count trays", is_required: true, sort_order: 0 },
        { item_text: "Sign register", is_required: true, sort_order: 1 },
      ],
    });
  });

  it("keeps every option the author chose", () => {
    const payload = buildScheduledTaskPayload(draft({
      mode: "task", priority: "high", formTemplateId: "form-1", verificationRequired: true, verifierId: "boss",
      followupEnabled: true, requiresRemark: true, buddy: false,
    }), assignee, true);
    expect(payload).toMatchObject({
      task_type: "delegation", requires_upload: true, checklist_items: [], priority: "high", requires_form: true,
      form_template_id: "form-1", verification_required: true, verifier_user_profile_id: "boss",
      followup_enabled: true, requires_remark: true, buddy_assignment_allowed: false,
    });
  });

  it("saves an as-needed duty without a calendar and with its wording", () => {
    const payload = buildScheduledTaskPayload(draft({ timing: { type: "as_required", triggerLabel: " Per Customer " } }), assignee, true);
    expect(payload).toMatchObject({ schedule_kind: "as_required", recurrence_rule: "FREQ=DAILY;COUNT=1", trigger_label: "Per Customer", is_active: false });
    expect(payload).not.toHaveProperty("starts_on");
  });

  it("does not move an edited schedule's start date", () => {
    expect(scheduledTaskStartsOn(draft(), false)).toBe("2026-10-21");
    expect(scheduledTaskStartsOn(draft(), true)).toBe("2026-11-21");
  });
});

describe("editing a stored template", () => {
  const stored = {
    title: "Weekly display check",
    description: "Front counter",
    task_type: "checklist",
    checklist_items: [{ item_text: "Polish glass", is_required: true, sort_order: 0 }],
    priority: "high",
    form_template_id: null,
    planned_time: "10:30:00",
    due_time: "12:00:00",
    schedule_kind: "weekly",
    recurrence_rule: "FREQ=WEEKLY",
    starts_on: "2026-09-22",
    verification_required: true,
    verifier_user_profile_id: "boss",
    followup_enabled: true,
    requires_remark: true,
    buddy_assignment_allowed: false,
    is_active: false,
    personal_performance_enabled: false,
  };

  it("writes back exactly what it holds when nothing changes", () => {
    const loaded = scheduledTaskDraftFromTemplate(stored, "2026-10-21");
    const payload = buildScheduledTaskPayload(loaded, assignee, false);
    expect(payload).toMatchObject({
      recurrence_rule: "FREQ=WEEKLY",
      schedule_kind: "weekly",
      starts_on: "2026-09-22",
      planned_time: "10:30",
      due_time: "12:00",
      priority: "high",
      verification_required: true,
      verifier_user_profile_id: "boss",
      followup_enabled: true,
      requires_remark: true,
      buddy_assignment_allowed: false,
      is_active: false,
      personal_performance_enabled: false,
      checklist_items: [{ item_text: "Polish glass", is_required: true, sort_order: 0 }],
    });
  });

  it("still reads the older rule as a pattern the form can show", () => {
    const loaded = scheduledTaskDraftFromTemplate(stored, "2026-10-21");
    expect(loaded.timing).toMatchObject({ type: "calendar", spec: { pattern: "weekly", weekdays: ["TU"] } });
  });

  it("opens an as-needed duty with its wording", () => {
    const loaded = scheduledTaskDraftFromTemplate({ ...stored, schedule_kind: "as_required", trigger_label: "Per Visit" }, "2026-10-21");
    expect(loaded.timing).toEqual({ type: "as_required", triggerLabel: "Per Visit" });
  });
});

describe("scheduled task validation", () => {
  it("accepts a complete draft", () => {
    expect(validateScheduledTaskDraft(draft(), [assignee])).toBeNull();
  });

  it.each([
    [{ title: " " }, /title/],
    [{ dueTime: "10:00" }, /later than/],
    [{ startTime: "" }, /start time/],
    [{ verificationRequired: true, verifierId: "" }, /verifies/],
    [{ timing: { type: "calendar", spec: null, startsOn: "2026-10-21" } }, /how often/],
    [{ timing: { type: "calendar", spec: { pattern: "weekly", interval: 1, weekdays: [], end: { type: "never" } }, startsOn: "2026-10-21" } }, /weekday/],
    [{ timing: { type: "calendar", spec: null, startsOn: "2026-10-21", keepRule: { recurrenceRule: "FREQ=HOURLY", scheduleKind: "daily" } } }, /can no longer be saved/],
  ] as const)("refuses %j", (overrides, message) => {
    expect(validateScheduledTaskDraft(draft(overrides as Partial<ScheduledTaskDraft>), [assignee])).toMatch(message);
  });

  it("needs someone to do the work", () => {
    expect(validateScheduledTaskDraft(draft(), [])).toMatch(/who does/);
  });

  it("does not ask an as-needed duty for times", () => {
    expect(validateScheduledTaskDraft(draft({ startTime: "", dueTime: "", timing: { type: "as_required", triggerLabel: "" } }), [assignee])).toBeNull();
  });
});
