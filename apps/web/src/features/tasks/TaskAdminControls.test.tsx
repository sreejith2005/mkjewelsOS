// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskAdminControls } from "./TaskAdminControls";
const api = vi.hoisted(() => ({ edit: vi.fn(), remove: vi.fn() }));
vi.mock("./api", () => ({ adminEditTask: api.edit, adminDeleteTask: api.remove }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const task = { id: "task-1", title: "Recurring task", description: "", priority: "medium", planned_datetime: "2026-10-10T05:30:00Z", due_datetime: "2026-10-10T07:30:00Z", revised_datetime: null, task_template_id: "template-1" };
describe("task administration", () => {
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
    api.edit.mockRejectedValueOnce(new Error("Task administration denied"));
    render(<TaskAdminControls task={task} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit task" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Corrected" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText("Task administration denied")).toBeTruthy());
    expect(api.edit).toHaveBeenCalledWith("task-1", expect.objectContaining({ title: "Corrected", planned: "2026-10-10T11:00" }));
  });
});
