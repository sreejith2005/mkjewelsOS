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
  forms: [{ id: "form-1", name: "Stock count" }],
  templates: [],
  users: [{ branch_id: "branch-1", buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "department-1", employee_code: "E-1", employee_name: "Ashwini", first_name: "Ashwini", id: "doer-1", last_name: null, tenant_id: "tenant-1", user_role: "staff", working_status: "active" }],
} as TaskReferenceData;

const profile = {
  branch_id: "branch-1",
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
