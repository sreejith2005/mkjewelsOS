// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const person = (id: string, name: string, branch = "branch-1") => ({
  branch_id: branch, buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "department-1",
  employee_code: id, employee_name: name, first_name: name, id, last_name: null, tenant_id: "tenant-1", user_role: "staff", working_status: "active",
});

const data = {
  branches: [{ id: "branch-1", name: "Bandra" }, { id: "branch-2", name: "Andheri" }],
  categories: [],
  priorities: [],
  departments: [{ branch_id: "branch-1", id: "department-1", name: "Sales" }],
  designations: [],
  forms: [],
  templates: [],
  users: [person("doer-1", "Teammate"), person("doer-3", "Cross-branch teammate", "branch-2")],
} as TaskReferenceData;

const profile = { branch_id: "branch-1", department_id: "department-1", designation_id: null, id: "admin-1", tenant_id: "tenant-1", user_role: "admin" } as UserProfile;

function renderComposer(overrides: Partial<Parameters<typeof TaskComposer>[0]> = {}) {
  render(<TaskComposer data={data} onClose={vi.fn()} onCreated={vi.fn()} onSave={vi.fn()} onUploadAttachment={vi.fn()} profile={profile} {...overrides} />);
}

function chooseUsers(...names: string[]) {
  fireEvent.click(screen.getByRole("button", { name: /Users/i }));
  for (const name of names) fireEvent.click(screen.getByLabelText(name));
}

describe("Create Task scheduling", () => {
  it("offers recurring creation to an ordinary employee with the schedule save path", () => {
    renderComposer({ profile: { ...profile, user_role: "staff" }, onSaveSchedule: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Recurring" }));
    expect(screen.getByLabelText("Repeats")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create schedule" })).toBeTruthy();
  });
  it("keeps the one-time composer unchanged for authors who cannot schedule", () => {
    renderComposer();
    expect(screen.queryByTestId("task-schedule-type")).toBeNull();
    expect(screen.getByRole("button", { name: /Due Date/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /In Loop/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assign Task" })).toBeTruthy();
  });

  it("defaults to a one-time task when scheduling is offered", () => {
    renderComposer({ onSaveSchedule: vi.fn() });
    expect(screen.getByRole("button", { name: "One-time" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("schedule-fields")).toBeNull();
    expect(screen.getByRole("button", { name: "Assign Task" })).toBeTruthy();
  });

  it("creates one recurring schedule per selected user, separately even across branches", async () => {
    const onSaveSchedule = vi.fn().mockResolvedValue("template");
    const onCreated = vi.fn();
    const onSave = vi.fn();
    renderComposer({ onSaveSchedule, onCreated, onSave });
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Monthly stock audit" } });
    fireEvent.click(screen.getByRole("button", { name: "Recurring" }));
    expect(screen.queryByRole("button", { name: /Due Date/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /In Loop/i })).toBeNull();
    expect(screen.getByTestId("schedule-unsupported-note")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Repeats"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "monthly_weekday" } });
    fireEvent.change(screen.getByLabelText("Which"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Weekday"), { target: { value: "SA" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "11:00" } });
    fireEvent.change(screen.getByLabelText("Due time"), { target: { value: "18:00" } });
    chooseUsers("Teammate", "Cross-branch teammate");
    expect(screen.getByTestId("schedule-separate-note")).toBeTruthy();
    expect(screen.queryByTestId("task-assignment-mode")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onSave).not.toHaveBeenCalled();
    expect(onSaveSchedule).toHaveBeenCalledTimes(2);
    expect(onSaveSchedule.mock.calls.map(([payload]) => payload.default_assignee_user_id)).toEqual(["doer-1", "doer-3"]);
    expect(onSaveSchedule.mock.calls[1]?.[0]).toMatchObject({
      recurrence_rule: "FREQ=MONTHLY;BYDAY=3SA", schedule_kind: "monthly", planned_time: "11:00", due_time: "18:00",
      priority: "medium", branch_id: "branch-2", task_type: "delegation", requires_upload: true,
    });
  });

  it("retries only the schedules that were not saved", async () => {
    const onSaveSchedule = vi.fn().mockResolvedValueOnce("first").mockRejectedValueOnce(new Error("Network down")).mockResolvedValue("second");
    const onCreated = vi.fn();
    renderComposer({ onSaveSchedule, onCreated });
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Daily cash count" } });
    fireEvent.click(screen.getByRole("button", { name: "Recurring" }));
    chooseUsers("Teammate", "Cross-branch teammate");
    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));
    await screen.findByText("Network down");
    expect(screen.getByText(/1 of 2 schedules are saved/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create remaining" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onSaveSchedule.mock.calls.map(([payload]) => payload.default_assignee_user_id)).toEqual(["doer-1", "doer-3", "doer-3"]);
  });

  it("creates an as-needed duty without a calendar", async () => {
    const onSaveSchedule = vi.fn().mockResolvedValue("duty");
    const onCreated = vi.fn();
    renderComposer({ onSaveSchedule, onCreated });
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Customer follow-up" } });
    fireEvent.click(screen.getByRole("button", { name: "As needed" }));
    fireEvent.change(screen.getByPlaceholderText(/As Required, Per Customer/), { target: { value: "Per Customer" } });
    chooseUsers("Teammate");
    fireEvent.click(screen.getByRole("button", { name: "Create duty" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onSaveSchedule.mock.calls[0]?.[0]).toMatchObject({ schedule_kind: "as_required", trigger_label: "Per Customer", is_active: false });
  });

  it("asks for a verifier next to the option before saving", async () => {
    const onSaveSchedule = vi.fn();
    renderComposer({ onSaveSchedule });
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Vault audit" } });
    fireEvent.click(screen.getByRole("button", { name: "Recurring" }));
    chooseUsers("Teammate");
    fireEvent.click(screen.getByText("More options"));
    fireEvent.click(screen.getByLabelText(/Verify completed work/));
    expect(screen.getByText("Choose who verifies the completed work.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create schedule" }));
    await screen.findByText(/Choose who verifies the completed work, or turn verification off/);
    expect(onSaveSchedule).not.toHaveBeenCalled();
  });
});
