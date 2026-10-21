// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BulkDeleteDialog } from "./BulkDeleteDialog";
const api = vi.hoisted(() => ({ prepare: vi.fn(), execute: vi.fn() }));
vi.mock("@jewelos/data/taskControl/bulkDelete", () => ({ prepareTaskBulkDelete: api.prepare, executeTaskBulkDelete: api.execute, readTaskDeleteTargets: vi.fn(), readTaskDeleteSchedules: vi.fn(), selectTaskBulkDeleteTargets: (rows: Array<{ kind?: string }>, series: boolean) => rows.filter((row) => row.kind !== "template" || series) }));
vi.mock("@/features/taskEvidence/api", () => ({ fetchTaskEvidenceWorkspace: vi.fn() }));
vi.mock("@/features/tasks/api", () => ({ adminDeleteTask: vi.fn() }));
vi.mock("@/features/taskTemplates/api", () => ({ deleteTaskTemplate: vi.fn() }));
vi.mock("@jewelos/data/taskControl/fmsWork", () => ({ cancelFmsRun: vi.fn(), cancelFmsStartForm: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("defaults full Delete All to series deletion and still requires confirmation", async () => {
  api.prepare.mockResolvedValue([{ id: "one", task_template_id: "series" }, { id: "two", task_template_id: "series" }]);
  api.execute.mockResolvedValue({ succeeded: ["one", "two"], failed: [] });
  const finished = vi.fn().mockResolvedValue(undefined);
  render(<BulkDeleteDialog request={{ filter: { from: "2026-10-01", to: "2026-10-12", user_profile_id: "employee" }, selected: null }} onClose={vi.fn()} onFinished={finished} />);
  await screen.findByText("2 task(s) selected for deletion.");
  expect(api.execute).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Delete entire recurring series") as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText(/inactive and not-yet-generated schedules/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
  await waitFor(() => expect(api.execute).toHaveBeenCalledWith(expect.any(Array), true, "", expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function)));
  await waitFor(() => expect(finished).toHaveBeenCalled());
});
it("shows partial failures rather than claiming all tasks were deleted", async () => {
  api.prepare.mockResolvedValue([{ id: "failed", task_template_id: null }]);
  api.execute.mockResolvedValue({ succeeded: [], failed: [{ id: "failed", message: "Permission denied" }] });
  render(<BulkDeleteDialog request={{ filter: {}, selected: ["failed"] }} onClose={vi.fn()} onFinished={vi.fn()} />);
  await screen.findByText("1 task(s) selected for deletion.");
  fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
  expect(await screen.findByText(/Permission denied/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Confirm deletion" })).toBeNull();
});
it("includes inactive schedules with no occurrences and allows occurrences-only opt out", async () => {
  api.prepare.mockResolvedValue([{ id: "paused", task_template_id: "paused", kind: "template" }]);
  render(<BulkDeleteDialog request={{ filter: {}, selected: null }} onClose={vi.fn()} onFinished={vi.fn()} />);
  await screen.findByText("1 schedule(s) selected for deletion.");
  expect((screen.getByRole("button", { name: "Confirm deletion" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByLabelText("Delete entire recurring series"));
  expect((screen.getByRole("button", { name: "Confirm deletion" }) as HTMLButtonElement).disabled).toBe(true);
  expect(api.execute).not.toHaveBeenCalled();
});
it("requires a reason before cancelling selected FMS work and counts each run once", async () => {
  api.prepare.mockResolvedValue([
    { id: "task", task_template_id: null },
    { id: "step-a", task_template_id: null, kind: "fms_step", fms_instance_id: "run-1" },
    { id: "step-b", task_template_id: null, kind: "fms_step", fms_instance_id: "run-1" },
    { id: "start", task_template_id: null, kind: "fms_start" },
  ]);
  api.execute.mockResolvedValue({ succeeded: ["task", "step-a", "step-b", "start"], failed: [] });
  render(<BulkDeleteDialog request={{ filter: {}, selected: ["task", "step-a", "step-b", "start"] }} onClose={vi.fn()} onFinished={vi.fn().mockResolvedValue(undefined)} />);
  await screen.findByText("1 task(s), 1 FMS run(s), 1 FMS start form(s) selected for deletion.");
  const confirm = screen.getByRole("button", { name: "Confirm deletion" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "Duplicate runs" } });
  expect(confirm.disabled).toBe(false);
  fireEvent.click(confirm);
  await waitFor(() => expect(api.execute).toHaveBeenCalledWith(expect.any(Array), false, "Duplicate runs", expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function)));
});
