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
  users: [{ branch_id: "branch-1", buddy_id: null, department_id: "department-1", employee_code: "E-1", employee_name: "Ashwini", first_name: "Ashwini", id: "doer-1", last_name: null, tenant_id: "tenant-1", user_role: "staff", working_status: "active" }],
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
    onManageTemplates={vi.fn()}
    onSave={vi.fn()}
    onSaveRecurring={vi.fn()}
    onUploadAttachment={vi.fn()}
    onUseTemplate={vi.fn()}
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

  it("confirms that a recurring task has been scheduled", async () => {
    const onSaveRecurring = vi.fn().mockResolvedValue(undefined);
    renderComposer({ onSaveRecurring });

    fireEvent.change(screen.getByPlaceholderText("Add Title"), { target: { value: "Daily stock check" } });
    fireEvent.click(screen.getByRole("button", { name: /Users/i }));
    fireEvent.change(screen.getByLabelText("Department"), { target: { value: "department-1" } });
    fireEvent.click(screen.getByLabelText(/Ashwini/i));
    fireEvent.click(screen.getByRole("button", { name: /Due Date/i }));
    fireEvent.change(screen.getByLabelText("Due date and time"), { target: { value: "2026-12-01T09:00" } });
    fireEvent.click(screen.getByLabelText("Repeat"));
    fireEvent.click(screen.getByRole("button", { name: /Assign Task/i }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSaveRecurring).toHaveBeenCalledTimes(1);
    expect(onSaveRecurring).toHaveBeenCalledWith(expect.objectContaining({ initial_planned_datetime: "2026-12-01T03:30:00.000Z" }));
    expect(toastSuccess).toHaveBeenCalledWith("Recurring task scheduled", expect.objectContaining({ description: expect.stringContaining("Daily") }));
  });
});
