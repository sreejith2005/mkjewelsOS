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
  it("keeps the due panel open while choosing date and time, then closes on Done", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /Due Date/i }));
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2030-10-06" } });
    fireEvent.change(screen.getByLabelText("Due time"), { target: { value: "18:00" } });
    expect(screen.getByTestId("task-panel-due")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByTestId("task-panel-due")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Due Date/i }));
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("2030-10-06");
    expect((screen.getByLabelText("Due time") as HTMLInputElement).value).toBe("18:00");
  });
  it("honors the server roster for a staff profile with elevated assignment authority", () => {
    renderComposer({ profile: { ...profile, user_role: "staff" } });
    fireEvent.click(screen.getByRole("button", { name: /Users/i }));
    expect(screen.getByLabelText("Other department")).toBeTruthy();
  });
  it("retries a failed attachment against the saved task without creating another task", async () => {
    const onSave = vi.fn().mockResolvedValue("saved-task");
    const onCreated = vi.fn();
    const onUploadAttachment = vi.fn().mockRejectedValueOnce(new Error("Upload interrupted")).mockResolvedValue(undefined);
    renderComposer({ onSave, onCreated, onUploadAttachment });
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Counter review" } });
    fireEvent.click(screen.getByRole("button", { name: /Users/i }));
    fireEvent.click(screen.getByLabelText("Teammate"));
    fireEvent.click(screen.getByRole("button", { name: /Due Date/i }));
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2030-10-06" } });
    fireEvent.change(screen.getByLabelText("Due time"), { target: { value: "18:00" } });
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
    expect(screen.getByTestId("task-panel-users")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Due Date/i }));
    expect(screen.getByTestId("task-selector-users").textContent).toContain("Teammate");
    expect(screen.queryByTestId("task-panel-users")).toBeNull();
  });

  function fillTitleAndDue() {
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Counter review" } });
    fireEvent.click(screen.getByRole("button", { name: /Due Date/i }));
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2030-10-06" } });
    fireEvent.change(screen.getByLabelText("Due time"), { target: { value: "18:00" } });
  }

  it("creates a separate task for each selected user by default, keeping every In Loop pick", async () => {
    const onSave = vi.fn().mockResolvedValueOnce("task-a").mockResolvedValueOnce("task-b");
    const onCreated = vi.fn();
    renderComposer({ onSave, onCreated });
    fireEvent.click(screen.getByRole("button", { name: /Users/i }));
    fireEvent.click(screen.getByLabelText("Teammate"));
    fireEvent.click(screen.getByLabelText("Other department"));
    expect((screen.getByLabelText(/Separate task for each user/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/One shared task/) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /In Loop/i }));
    fireEvent.click(screen.getByLabelText("Ashwini"));
    fireEvent.click(screen.getByLabelText("Cross-branch teammate"));
    expect(screen.getByTestId("task-selector-watchers").textContent).toContain("2 in loop");
    fillTitleAndDue();
    fireEvent.click(screen.getByRole("button", { name: "Assign Task" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls.map((call) => [call[1], (call[0] as { department_id: string }).department_id, call[2]])).toEqual([
      [["doer-1"], "department-1", ["user-1", "doer-3"]],
      [["doer-2"], "department-2", ["user-1", "doer-3"]],
    ]);
    expect(toastSuccess).toHaveBeenCalledWith("2 tasks assigned", { description: "Sent to 2 users." });
  });

  it("creates one shared task when chosen for users in the same branch and department", async () => {
    const onSave = vi.fn().mockResolvedValue("shared-task");
    const onCreated = vi.fn();
    renderComposer({ onSave, onCreated });
    fireEvent.click(screen.getByRole("button", { name: /Users/i }));
    fireEvent.click(screen.getByLabelText("Ashwini"));
    fireEvent.click(screen.getByLabelText("Teammate"));
    fireEvent.click(screen.getByLabelText(/One shared task/));
    expect(screen.getByTestId("task-selector-users").textContent).toContain("2 users · shared");
    fillTitleAndDue();
    fireEvent.click(screen.getByRole("button", { name: "Assign Task" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]?.[1]).toEqual(["user-1", "doer-1"]);
    expect(toastSuccess).toHaveBeenCalledWith("Task assigned", { description: "Sent to 2 users." });
  });

  it("resumes after a partial failure without creating a saved task twice", async () => {
    const onSave = vi.fn().mockResolvedValueOnce("task-a").mockRejectedValueOnce(new Error("Network lost")).mockResolvedValueOnce("task-b");
    const onCreated = vi.fn();
    renderComposer({ onSave, onCreated });
    fireEvent.click(screen.getByRole("button", { name: /Users/i }));
    fireEvent.click(screen.getByLabelText("Teammate"));
    fireEvent.click(screen.getByLabelText("Other department"));
    fillTitleAndDue();
    fireEvent.click(screen.getByRole("button", { name: "Assign Task" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Assign remaining" })).toBeTruthy());
    expect(screen.getByText(/1 of 2 tasks are saved/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Assign remaining" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(onSave.mock.calls.map((call) => call[1])).toEqual([["doer-1"], ["doer-2"], ["doer-2"]]);
  });
  it("limits normal staff to themselves and colleagues in their department", () => {
    renderComposer({ profile: { ...profile, user_role: "staff" }, data: { ...data, users: data.users.filter(user => user.department_id === "department-1") } });

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

describe("TaskComposer priority on a phone", () => {
  it("offers High, Medium and Low even when Dropdown Master lists only High", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /High/i }));
    const panel = screen.getByTestId("task-panel-priority");
    expect(within(panel).getAllByRole("button").map((button) => button.textContent)).toEqual(["High", "Medium", "Low"]);
    fireEvent.click(within(panel).getByRole("button", { name: "Low" }));
    expect(screen.queryByTestId("task-panel-priority")).toBeNull();
    expect(screen.getByRole("button", { name: /Low/i }).getAttribute("aria-expanded")).toBe("false");
  });

  it("scrolls an opened panel into view so it is not hidden below the fold", () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      renderComposer();
      fireEvent.click(screen.getByRole("button", { name: /High/i }));
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
