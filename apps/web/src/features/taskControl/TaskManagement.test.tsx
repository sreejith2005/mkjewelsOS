// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TaskManagement } from "./TaskManagement";
const db = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@jewelos/api-client", () => ({ supabase: db }));
vi.mock("@/features/tasks/TaskAdminControls", () => ({ TaskAdminControls: ({ task, onChanged }: { task: { title: string }; onChanged: () => Promise<void> }) => <button onClick={() => void onChanged()}>Delete {task.title}</button> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function prepare(result: unknown) {
  db.from.mockReturnValue(db); db.select.mockReturnValue(db); db.eq.mockReturnValue(db); db.maybeSingle.mockResolvedValue(result);
}
it("loads only the selected persisted task and refreshes after its action", async () => {
  prepare({ data: { id: "selected", title: "Wrong schedule" }, error: null });
  const changed = vi.fn().mockResolvedValue(undefined);
  render(<TaskManagement taskId="selected" onChanged={changed} />);
  fireEvent.click(await screen.findByRole("button", { name: "Delete Wrong schedule" }));
  expect(db.from).toHaveBeenCalledWith("task_instances");
  expect(db.eq).toHaveBeenCalledWith("id", "selected");
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
});
it("shows deleted or inaccessible tasks without mutation controls", async () => {
  prepare({ data: null, error: null });
  render(<TaskManagement taskId="gone" onChanged={vi.fn()} />);
  expect(await screen.findByText("This task is no longer available." )).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
it("ignores a late response after the selected task changes", async () => {
  let resolve: (value: unknown) => void = () => {};
  prepare({ data: { id: "new", title: "New task" }, error: null });
  db.maybeSingle.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const { rerender } = render(<TaskManagement taskId="old" onChanged={vi.fn()} />);
  rerender(<TaskManagement taskId="new" onChanged={vi.fn()} />);
  await screen.findByText("Delete New task");
  resolve({ data: { id: "old", title: "Old task" }, error: null });
  await waitFor(() => expect(screen.queryByText("Delete Old task")).toBeNull());
});
