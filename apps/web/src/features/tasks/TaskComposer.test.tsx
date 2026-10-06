// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  branches: [{ id: "branch-1", name: "Bandra" }, { id: "branch-2", name: "Andheri" }],
  categories: [{ id: "category-1", label: "Operations" }],
  priorities: [{ id: "priority-high", label: "High", value: "high" }],
  departments: [{ branch_id: "branch-1", id: "department-1", name: "Sales" }],
  designations: [],
  forms: [{ id: "form-1", name: "Stock count", version: 1, family_id: "form-family", lifecycle: "published" }],
  templates: [],
  users: [
    { branch_id: "branch-1", buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "department-1", employee_code: "E-1", employee_name: "Ashwini", first_name: "Ashwini", id: "user-1", last_name: null, tenant_id: "tenant-1", user_role: "staff", working_status: "active" },
    { branch_id: "branch-1", buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "department-1", employee_code: "E-2", employee_name: "Teammate", first_name: "Teammate", id: "doer-1", last_name: null, tenant_id: "tenant-1", user_role: "staff", working_status: "active" },
    { branch_id: "branch-2", buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "department-1", employee_code: "E-4", employee_name: "Cross-branch teammate", first_name: "Cross-branch", id: "doer-3", last_name: "teammate", tenant_id: "tenant-1", user_role: "staff", working_status: "active" },
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
  it("retries a failed attachment against the saved task without creating another task", async () => {
    const onSave = vi.fn().mockResolvedValue("saved-task");
    const onCreated = vi.fn();
    const onUploadAttachment = vi.fn().mockRejectedValueOnce(new Error("Upload interrupted")).mockResolvedValue(undefined);
    renderComposer({ onSave, onCreated, onUploadAttachment });
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Counter review" } });
    fireEvent.click(screen.getByRole("button", { name: /Users/i }));
    fireEvent.click(screen.getByLabelText("Teammate"));
    fireEvent.click(screen.getByRole("button", { name: /Due Date/i }));
    fireEvent.change(screen.getByLabelText("Due date and time"), { target: { value: "2030-10-06T18:00" } });
    const attachment = new File(["synthetic attachment"], "counter.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Attach image or document"), { target: { files: [attachment] } });
    fireEvent.click(screen.getByRole("button", { name: "Assign Task" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry attachment" })).toBeTruthy());
    expect(onCreated).not.toHaveBeenCalled();
    const replacement = new File(["replacement synthetic attachment"], "replacement.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Attach image or document"), { target: { files: [replacement] } });
    fireEvent.click(screen.getByRole("button", { name: "Retry attachment" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledOnce();
    expect(onUploadAttachment).toHaveBeenNthCalledWith(1, "saved-task", attachment);
    expect(onUploadAttachment).toHaveBeenNthCalledWith(2, "saved-task", replacement);
  });
  it("shows the selected assignee name while the picker is closed", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /Users/i }));
    fireEvent.click(screen.getByLabelText("Teammate"));
    expect(screen.getByTestId("task-selector-users").textContent).toContain("Teammate");
    expect(screen.queryByTestId("task-panel-users")).toBeNull();
  });
  it("limits normal staff to themselves and colleagues in their department", () => {
    renderComposer({ profile: { ...profile, user_role: "staff" } });

    fireEvent.click(screen.getByRole("button", { name: /Users/i }));

    expect(screen.getByLabelText("Ashwini")).toBeTruthy();
    expect(screen.getByLabelText("Teammate")).toBeTruthy();
    expect(screen.getByLabelText("Cross-branch teammate")).toBeTruthy();
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

  it("gives an open people picker the full row and keeps In Loop open for several picks", () => {
    renderComposer();

    fireEvent.click(screen.getByRole("button", { name: /Users/i }));
    expect(screen.getByTestId("task-selector-users").className).toContain("col-span-2");
    expect(screen.getByTestId("task-selector-due").className).not.toContain("col-span-2");

    fireEvent.click(screen.getByRole("button", { name: /In Loop/i }));
    expect(screen.getByLabelText("Search in loop · view and comment")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Teammate"));
    expect(screen.getByTestId("task-panel-watchers")).toBeTruthy();
  });

  it("does not expose recurrence authoring in manual Tasks", () => {
    renderComposer();
    expect(screen.queryByLabelText("Repeat")).toBeNull();
  });
});
