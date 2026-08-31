// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskReferenceData } from "./api";
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

describe("recurring schedule form", () => {

  it("shows only the legacy recurring schedule fields", () => {
    render(<TaskTemplateForm data={referenceData} onCancel={vi.fn()} onSave={vi.fn()} template={null} />);

    for (const label of [
      "Assign To User *",
      "Department",
      "Branch",
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
      "Priority",
      "Schedule Status",
      "Completion Remark Required",
      "Follow-ups Allowed",
      "Form Required",
      "Verification Required",
    ]) expect(screen.queryByLabelText(label)).toBeNull();
  });

});
