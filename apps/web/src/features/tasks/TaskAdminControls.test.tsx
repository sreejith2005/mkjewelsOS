// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskAdminControls } from "./TaskAdminControls";
const api = vi.hoisted(() => ({ edit: vi.fn(), remove: vi.fn(), load: vi.fn() }));
vi.mock("./api", () => ({ adminEditTask: api.edit, adminDeleteTask: api.remove, loadTaskAdminEditData: api.load }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const task = { id: "task-1", title: "Recurring task", description: "", priority: "medium", planned_datetime: "2026-10-10T05:30:00Z", due_datetime: "2026-10-10T07:30:00Z", revised_datetime: null, task_template_id: "template-1" };
describe("task administration", () => {
  const loadedEdit = { title: "Recurring task", description: "", priority: "medium", planned: "2026-10-10T11:00", due: "2026-10-10T13:00",
    taskType: "delegation", requiresUpload: true, requiresRemark: false, requiresForm: false, formTemplateId: "", verificationRequired: false,
    verifierId: "", buddyAssignmentAllowed: false, branchId: "", departmentId: "", categoryId: "", coreTaskLabel: "",
    doerIds: [], watcherIds: [], checklist: [] };
  const reference = { users: [], branches: [], departments: [], categories: [], forms: [] };
  it("requires explicit series selection and confirmation", async () => {
    const changed = vi.fn();
    render(<TaskAdminControls task={task} onChanged={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete task" }));
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Delete entire recurring series"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("task-1", true, ""));
    expect(changed).toHaveBeenCalled();
  });
  it("saves supported fields and exposes server denial", async () => {
    api.load.mockResolvedValueOnce({ edit: loadedEdit, reference });
    api.edit.mockRejectedValueOnce(new Error("Task administration denied"));
    render(<TaskAdminControls task={task} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit task" }));
    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Corrected" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText("Task administration denied")).toBeTruthy());
    expect(api.edit).toHaveBeenCalledWith("task-1", expect.objectContaining({ title: "Corrected", planned: "2026-10-10T11:00" }));
  });
  it("loads the current requirements and saves a checklist conversion with independent upload settings", async () => {
    api.load.mockResolvedValueOnce({ edit: loadedEdit, reference });
    api.edit.mockResolvedValueOnce(undefined);
    const changed = vi.fn();
    render(<TaskAdminControls task={task} onChanged={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit task" }));
    const type = await screen.findByLabelText("Task type");
    expect(screen.getByLabelText<HTMLInputElement>("Upload required").checked).toBe(true);
    fireEvent.change(type, { target: { value: "checklist" } });
    fireEvent.click(screen.getByLabelText("Upload required"));
    expect(screen.queryByLabelText("Completion remark required")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add checklist item" }));
    fireEvent.change(screen.getByLabelText("Checklist item 1"), { target: { value: "Lock the safe" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(api.edit).toHaveBeenCalledWith("task-1", expect.objectContaining({ taskType: "checklist", requiresUpload: false,
      checklist: [{ itemText: "Lock the safe", required: true }] }));
  });
  it("blocks saving when current task details cannot be loaded", async () => {
    api.load.mockRejectedValueOnce(new Error("Could not load task"));
    render(<TaskAdminControls task={task} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit task" }));
    expect(await screen.findByText("Could not load task")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save changes" }).disabled).toBe(true);
  });
});
