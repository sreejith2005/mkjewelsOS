// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@/types";
import type { TaskReferenceData } from "./api";
import { TaskComposer } from "./TaskComposer";

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));

afterEach(() => {
  cleanup();
  toastSuccess.mockClear();
});

const data = {
  branches: [{ id: "branch-1", name: "Bandra" }],
  categories: [{ id: "category-1", label: "Operations" }],
  priorities: [{ id: "priority-high", label: "High", value: "high" }],
  departments: [{ branch_id: "branch-1", id: "department-1", name: "Sales" }],
  designations: [],
  forms: [{ id: "form-1", name: "Stock count" }],
  templates: [],
  users: [
    { branch_id: "branch-1", buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "department-1", employee_code: "E-1", employee_name: "Ashwini", first_name: "Ashwini", id: "user-1", last_name: null, tenant_id: "tenant-1", user_role: "staff", working_status: "active" },
    { branch_id: "branch-1", buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "department-1", employee_code: "E-2", employee_name: "Teammate", first_name: "Teammate", id: "doer-1", last_name: null, tenant_id: "tenant-1", user_role: "staff", working_status: "active" },
    { branch_id: "branch-1", buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "department-2", employee_code: "E-3", employee_name: "Other department", first_name: "Other", id: "doer-2", last_name: "department", tenant_id: "tenant-1", user_role: "staff", working_status: "active" },
  ],
} as TaskReferenceData;

const profile = {
  branch_id: "branch-1",
  department_id: "department-1",
  designation_id: null,
  id: "user-1",
  tenant_id: "tenant-1",
  user_role: "manager",
} as UserProfile;

function renderComposer(overrides: Partial<Parameters<typeof TaskComposer>[0]> = {}) {
  render(<TaskComposer
    data={data}
    onClose={vi.fn()}
    onCreated={vi.fn()}
    onSave={vi.fn()}
    onUploadAttachment={vi.fn()}
    profile={profile}
    {...overrides}
  />);
}

describe("TaskComposer selector panels", () => {
  it("limits normal staff to themselves and colleagues in their department", () => {
    renderComposer({ profile: { ...profile, user_role: "staff" } });

    fireEvent.click(screen.getByRole("button", { name: /Users/i }));

    expect(screen.getByLabelText("Ashwini")).toBeTruthy();
    expect(screen.getByLabelText("Teammate")).toBeTruthy();
    expect(screen.queryByLabelText("Other department")).toBeNull();
  });

  it("keeps an opened selector panel anchored to the selector that opened it", () => {
    renderComposer();

    fireEvent.click(screen.getByRole("button", { name: /Users/i }));
    expect(within(screen.getByTestId("task-selector-users")).getByTestId("task-panel-users")).toBeTruthy();
    expect(screen.queryByTestId("task-panel-due")).toBeNull();

    ([
      ["Due Date", "due"],
      ["High", "priority"],
      ["Attach Form", "form"],
      ["In Loop", "watchers"],
    ] as const).forEach(([label, id]) => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(label, "i") }));
      expect(within(screen.getByTestId(`task-selector-${id}`)).getByTestId(`task-panel-${id}`)).toBeTruthy();
      expect(screen.queryByTestId("task-panel-users")).toBeNull();
    });
  });

  it("does not expose recurrence authoring in manual Tasks", () => {
    renderComposer();
    expect(screen.queryByLabelText("Repeat")).toBeNull();
  });
});
