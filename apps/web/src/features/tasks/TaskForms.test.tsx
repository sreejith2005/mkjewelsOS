// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskReferenceData } from "./api";
import { TaskTemplateForm } from "./TaskForms";

const referenceData = {
  branches: [{ id: "branch-1", name: "Bandra" }],
  categories: [],
  priorities: [],
  departments: [{ branch_id: "branch-1", id: "department-1", name: "Sales" }],
  designations: [],
  forms: [],
  templates: [],
  users: [
    { branch_id: "branch-1", buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "department-1", employee_code: "MK-101", employee_name: "Ananya Shah", first_name: "Ananya", id: "user-1", last_name: "Shah", tenant_id: "tenant-1", user_role: "staff", working_status: "active" },
    { branch_id: "branch-1", buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "department-1", employee_code: "MK-102", employee_name: "Ravi Iyer", first_name: "Ravi", id: "boss", last_name: "Iyer", tenant_id: "tenant-1", user_role: "manager", working_status: "active" },
  ],
} as TaskReferenceData;

afterEach(() => cleanup());

function fillBasics() {
  fireEvent.change(screen.getByLabelText("Assign To User *"), { target: { value: "user-1" } });
  fireEvent.change(screen.getByLabelText("Core Task *"), { target: { value: "Open showroom" } });
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "09:00" } });
  fireEvent.change(screen.getByLabelText("Due time"), { target: { value: "18:00" } });
}

function submit(name: string) {
  fireEvent.submit(screen.getByRole("button", { name }).closest("form") as HTMLFormElement);
}

describe("Task Control template form", () => {
  it("starts a new task with the employee selected in Task Control", () => {
    render(<TaskTemplateForm data={referenceData} initialAssigneeId="user-1" onCancel={vi.fn()} onSave={vi.fn()} template={null} />);
    expect((screen.getByLabelText("Assign To User *") as HTMLSelectElement).value).toBe("user-1");
  });

  it("uses the selected user's branch and department without showing scope selectors", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskTemplateForm data={referenceData} onCancel={vi.fn()} onSave={onSave} template={null} />);
    for (const label of ["Department", "Branch"]) expect(screen.queryByLabelText(label)).toBeNull();
    fillBasics();
    submit("Save Task");
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[1]).toMatchObject({
      branch_id: "branch-1", department_id: "department-1", default_assignee_user_id: "user-1",
      recurrence_rule: "FREQ=DAILY", schedule_kind: "daily", planned_time: "09:00", due_time: "18:00",
    });
  });

  it("saves the third Saturday of every month on its first real date", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskTemplateForm data={referenceData} onCancel={vi.fn()} onSave={onSave} template={null} />);
    fillBasics();
    fireEvent.click(screen.getByRole("button", { name: "3rd Saturday of every month" }));
    fireEvent.change(screen.getByLabelText("Starts on"), { target: { value: "2030-11-01" } });
    expect(screen.getByTestId("schedule-preview").textContent).toContain("Every month on the 3rd Saturday");
    expect(screen.getByTestId("schedule-preview-dates").textContent).toContain("Sat, 16 Nov, 2030");
    submit("Save Task");
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[1]).toMatchObject({ recurrence_rule: "FREQ=MONTHLY;BYDAY=3SA", schedule_kind: "monthly", starts_on: "2030-11-16" });
  });

  it("shows an invalid choice next to the builder and does not save it", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskTemplateForm data={referenceData} onCancel={vi.fn()} onSave={onSave} template={null} />);
    fillBasics();
    fireEvent.click(screen.getByRole("button", { name: "Custom…" }));
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "weekly" } });
    for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
      const toggle = screen.getByRole("button", { name: day });
      if (toggle.getAttribute("aria-pressed") === "true") fireEvent.click(toggle);
    }
    expect(screen.getAllByRole("alert").some((node) => node.textContent?.includes("Choose at least one weekday."))).toBe(true);
    submit("Save Task");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps everything an edited template already has", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const template = {
      id: "template-1", title: "Weekly display check", description: null, default_assignee_user_id: "user-1",
      task_type: "checklist", checklist_items: [{ item_text: "Polish glass", is_required: true, sort_order: 0 }],
      priority: "high", form_template_id: null, planned_time: "10:30:00", due_time: "12:00:00", schedule_kind: "weekly",
      recurrence_rule: "FREQ=WEEKLY", starts_on: "2026-09-22", verification_required: true, verifier_user_profile_id: "boss",
      followup_enabled: true, requires_remark: true, buddy_assignment_allowed: false, is_active: false, personal_performance_enabled: true,
    };
    render(<TaskTemplateForm data={referenceData} onCancel={vi.fn()} onSave={onSave} template={template as never} />);
    expect(screen.getByText(/Saving changes future occurrences/)).toBeTruthy();
    submit("Update Task");
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toBe("template-1");
    expect(onSave.mock.calls[0]?.[1]).toMatchObject({
      recurrence_rule: "FREQ=WEEKLY", starts_on: "2026-09-22", priority: "high", verification_required: true,
      verifier_user_profile_id: "boss", followup_enabled: true, requires_remark: true, buddy_assignment_allowed: false,
      is_active: false, checklist_items: [{ item_text: "Polish glass", is_required: true, sort_order: 0 }],
    });
  });

  it("offers the latest published form version for an existing pinned template", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const forms = [
      { id: "form-v1", name: "Check", family_id: "family", version: 1, lifecycle: "archived" },
      { id: "form-v2", name: "Check", family_id: "family", version: 2, lifecycle: "published" },
    ] as TaskReferenceData["forms"];
    render(<TaskTemplateForm data={{ ...referenceData, forms }} template={{ id: "template-1", form_template_id: "form-v1", recurrence_rule: "FREQ=DAILY", schedule_kind: "daily", starts_on: "2026-10-01" } as never} onCancel={vi.fn()} onSave={onSave} />);
    const picker = screen.getByLabelText("Required form version") as HTMLSelectElement;
    expect(picker.value).toBe("form-v1");
    expect(screen.getByRole("option", { name: "Check v2 (published)" })).toBeTruthy();
    fireEvent.change(picker, { target: { value: "form-v2" } });
    fillBasics();
    submit("Update Task");
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[1]).toMatchObject({ form_template_id: "form-v2", requires_form: true });
  });

  it("saves an as-needed duty with its wording and no calendar", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskTemplateForm data={referenceData} onCancel={vi.fn()} onSave={onSave} template={null} />);
    fireEvent.change(screen.getByLabelText("Assign To User *"), { target: { value: "user-1" } });
    fireEvent.change(screen.getByLabelText("Core Task *"), { target: { value: "Customer follow-up" } });
    fireEvent.click(screen.getByRole("button", { name: "As needed" }));
    fireEvent.change(screen.getByLabelText("When does it apply?"), { target: { value: "Per Customer" } });
    submit("Save Task");
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[1]).toMatchObject({ schedule_kind: "as_required", trigger_label: "Per Customer", is_active: false });
    expect(onSave.mock.calls[0]?.[1]).not.toHaveProperty("starts_on");
  });
});
