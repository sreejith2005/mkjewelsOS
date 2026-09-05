// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
  users: [{ branch_id: "branch-1", buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "department-1", employee_code: "MK-101", employee_name: "Ananya Shah", first_name: "Ananya", id: "user-1", last_name: "Shah", tenant_id: "tenant-1", user_role: "staff", working_status: "active" }],
} as TaskReferenceData;

describe("recurring schedule form", () => {

  it("uses the selected user's branch and department without showing scope selectors", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TaskTemplateForm data={referenceData} onCancel={vi.fn()} onSave={onSave} template={null} />);

    for (const label of [
      "Assign To User *",
      "Core Task *",
      "Description",
      "Frequency *",
      "Task Start Date *",
      "Scheduled Start Time",
      "Due Time",
      "Task Type *",
      "Buddy Assignment Allowed",
    ]) expect(screen.getByLabelText(label)).toBeTruthy();

    for (const label of [
      "Department",
      "Branch",
      "Priority",
      "Schedule Status",
      "Completion Remark Required",
      "Follow-ups Allowed",
      "Form Required",
      "Verification Required",
    ]) expect(screen.queryByLabelText(label)).toBeNull();

    fireEvent.change(screen.getByLabelText("Assign To User *"), { target: { value: "user-1" } });
    fireEvent.change(screen.getByLabelText("Core Task *"), { target: { value: "Open showroom" } });
    fireEvent.change(screen.getByLabelText("Scheduled Start Time"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("Due Time"), { target: { value: "18:00" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save Task" }).closest("form") as HTMLFormElement);

    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[1]).toMatchObject({
      branch_id: "branch-1",
      department_id: "department-1",
      default_assignee_user_id: "user-1",
    });
  });

});
