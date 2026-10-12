// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BulkDeleteDialog } from "./BulkDeleteDialog";
const api = vi.hoisted(() => ({ prepare: vi.fn(), execute: vi.fn() }));
vi.mock("@jewelos/data/taskControl/bulkDelete", () => ({ prepareTaskBulkDelete: api.prepare, executeTaskBulkDelete: api.execute, readTaskDeleteTargets: vi.fn(), readTaskDeleteSchedules: vi.fn(), selectTaskBulkDeleteTargets: (rows: Array<{ kind?: string }>, series: boolean) => rows.filter((row) => row.kind !== "template" || series) }));
vi.mock("@/features/taskEvidence/api", () => ({ fetchTaskEvidenceWorkspace: vi.fn() }));
vi.mock("@/features/tasks/api", () => ({ adminDeleteTask: vi.fn() }));
vi.mock("@/features/taskTemplates/api", () => ({ deleteTaskTemplate: vi.fn() }));
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
  await waitFor(() => expect(api.execute).toHaveBeenCalledWith(expect.any(Array), true, "", expect.any(Function), expect.any(Function), expect.any(Function)));
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
  await screen.findByText("0 task occurrence(s) and 1 schedule(s) selected for deletion.");
  expect((screen.getByRole("button", { name: "Confirm deletion" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByLabelText("Delete entire recurring series"));
  expect((screen.getByRole("button", { name: "Confirm deletion" }) as HTMLButtonElement).disabled).toBe(true);
  expect(api.execute).not.toHaveBeenCalled();
});
