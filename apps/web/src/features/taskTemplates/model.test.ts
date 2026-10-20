import { expect, it } from "vitest";
import { templateCanActivate, templateCanAssignNow, templateFrequencyLabel, templateStatusLabel, type TaskTemplateDirectoryRow } from "./model";

function row(overrides: Partial<TaskTemplateDirectoryRow>): TaskTemplateDirectoryRow {
  return {
    id: "t", title: "Offer water", description: null, assignee_user_id: "u", assignee_name: "Doer", assignee_type: "specific_user",
    department_id: null, department_name: "", branch_id: null, branch_name: "", task_type: "checklist", schedule_kind: "daily",
    recurrence_rule: "FREQ=DAILY", starts_on: "2026-10-20", planned_time: "11:00:00", due_time: "13:00:00", priority: "medium",
    requires_upload: false, requires_form: false, verification_required: false, followup_enabled: false, buddy_assignment_allowed: true,
    is_active: true, assignment_status: "assigned", schedule_status: "ready", source: "bulk_import", checklist_count: 1,
    created_at: null, updated_at: null, ...overrides,
  };
}

it("labels as-needed duties as on demand with their sheet trigger", () => {
  const duty = row({ schedule_kind: "as_required", trigger_label: "Per Customer", is_active: false, starts_on: null, schedule_status: "paused" });
  expect(templateStatusLabel(duty)).toBe("ON DEMAND");
  expect(templateFrequencyLabel(duty)).toBe("PER CUSTOMER");
  expect(templateFrequencyLabel({ ...duty, trigger_label: null })).toBe("AS NEEDED");
  expect(templateCanAssignNow(duty)).toBe(true);
  expect(templateCanActivate(duty)).toBe(false);
});

it("keeps unassigned duties and dated schedules on their existing labels", () => {
  expect(templateStatusLabel(row({ schedule_kind: "as_required", schedule_status: "assigning_left", is_active: false }))).toBe("ASSIGNING LEFT");
  expect(templateCanAssignNow(row({ schedule_kind: "as_required", schedule_status: "assigning_left" }))).toBe(false);
  expect(templateStatusLabel(row({}))).toBe("ACTIVE");
  expect(templateFrequencyLabel(row({}))).toBe("DAILY");
  expect(templateCanAssignNow(row({}))).toBe(false);
});
