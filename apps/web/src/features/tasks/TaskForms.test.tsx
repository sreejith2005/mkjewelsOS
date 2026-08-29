// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskReferenceData, TaskTemplate } from "./api";
import { TaskTemplateForm } from "./TaskForms";

const referenceData = {
  branches: [{ id: "branch-1", name: "Bandra" }],
  categories: [],
  priorities: [],
  departments: [{ branch_id: "branch-1", id: "department-1", name: "Sales" }],
  forms: [],
  templates: [],
  users: [{ branch_id: "branch-1", buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "department-1", employee_code: "MK-101", employee_name: "Ananya Shah", first_name: "Ananya", id: "user-1", last_name: "Shah", tenant_id: "tenant-1", user_role: "staff", working_status: "active" }],
} as TaskReferenceData;

describe("recurring schedule completion mode authoring", () => {
  it("places Task Type before Buddy Assignment Allowed and derives image-evidence tasks", async () => {
    const source = await import("./TaskForms?raw").then((module) => module.default);

    expect(source.indexOf('label="Task Type"')).toBeLessThan(
      source.indexOf('label="Buddy Assignment Allowed"'),
    );
    expect(source).toContain('task_type: mode === "task" ? "delegation" : "checklist"');
    expect(source).toContain('requires_upload: mode === "task"');
  });

  it("derives scope from the selected assignee and hides redundant selectors", () => {
    render(<TaskTemplateForm data={referenceData} onCancel={vi.fn()} onSave={vi.fn()} template={null} />);

    fireEvent.change(screen.getByLabelText("Assign To User *"), { target: { value: "user-1" } });

    expect(screen.queryByLabelText("Department")).toBeNull();
    expect(screen.queryByLabelText("Branch")).toBeNull();
  });

  it("round-trips an imported schedule instead of resetting its controls", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const template = {
      buddy_assignment_allowed: false,
      checklist_items: [
        { item_text: "Open the safe", is_required: true, sort_order: 0 },
        { item_text: "Log the count", is_required: false, sort_order: 1 },
      ],
      default_assignee_user_id: "user-1",
      due_time: "18:30:00",
      followup_enabled: true,
      form_template_id: null,
      id: "template-1",
      is_active: false,
      planned_time: "09:00:00",
      priority: "high",
      recurrence_rule: "FREQ=WEEKLY",
      requires_form: false,
      requires_remark: true,
      schedule_kind: "weekly",
      starts_on: "2026-08-20",
      task_type: "checklist",
      title: "Daily vault count",
      verification_required: true,
      verifier_user_profile_id: "user-1",
    } as unknown as TaskTemplate;

    render(<TaskTemplateForm data={referenceData} onCancel={vi.fn()} onSave={onSave} template={template} />);
    fireEvent.submit(screen.getByRole("button", { name: "Update Task" }).closest("form") as HTMLFormElement);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());

    expect(onSave.mock.calls[0]?.[1]).toMatchObject({
      buddy_assignment_allowed: false,
      checklist_items: [
        { is_required: true, item_text: "Open the safe", sort_order: 0 },
        { is_required: false, item_text: "Log the count", sort_order: 1 },
      ],
      followup_enabled: true,
      is_active: false,
      priority: "high",
      requires_remark: true,
      verification_required: true,
      verifier_user_profile_id: "user-1",
    });
  });

  it("stores alternate days as a two-day recurrence interval", async () => {
    const source = await import("./TaskForms?raw").then((module) => module.default);

    expect(source).toContain('["alternate_days", "ALTERNATE DAYS", "FREQ=DAILY;INTERVAL=2"]');
    expect(source).toContain('const SCHEDULE_KINDS: Record<string, string> = { alternate_days: "recurring" };');
  });
});
