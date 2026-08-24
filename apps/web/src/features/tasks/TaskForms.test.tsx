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
});
