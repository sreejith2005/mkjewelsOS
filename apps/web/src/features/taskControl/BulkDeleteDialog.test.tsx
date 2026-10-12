// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BulkDeleteDialog } from "./BulkDeleteDialog";
const api = vi.hoisted(() => ({ prepare: vi.fn(), execute: vi.fn() }));
vi.mock("@jewelos/data/taskControl/bulkDelete", () => ({ prepareTaskBulkDelete: api.prepare, executeTaskBulkDelete: api.execute, readTaskDeleteTargets: vi.fn() }));
vi.mock("@/features/taskEvidence/api", () => ({ fetchTaskEvidenceWorkspace: vi.fn() }));
vi.mock("@/features/tasks/api", () => ({ adminDeleteTask: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("requires confirmation and explicit series choice after preparing all pages", async () => {
  api.prepare.mockResolvedValue([{ id: "one", task_template_id: "series" }, { id: "two", task_template_id: "series" }]);
  api.execute.mockResolvedValue({ succeeded: ["one", "two"], failed: [] });
  const finished = vi.fn().mockResolvedValue(undefined);
  render(<BulkDeleteDialog request={{ filter: { from: "2026-10-01", to: "2026-10-12", user_profile_id: "employee" }, selected: null }} onClose={vi.fn()} onFinished={finished} />);
  await screen.findByText("2 task(s) selected for deletion.");
  expect(api.execute).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Delete entire recurring series"));
  expect(screen.getByText(/outside these filters/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
  await waitFor(() => expect(api.execute).toHaveBeenCalledWith(expect.any(Array), true, "", expect.any(Function), expect.any(Function)));
  await waitFor(() => expect(finished).toHaveBeenCalled());
});
it("shows partial failures rather than claiming all tasks were deleted", async () => {
  api.prepare.mockResolvedValue([{ id: "failed", task_template_id: null }]);
  api.execute.mockResolvedValue({ succeeded: [], failed: [{ id: "failed", message: "Permission denied" }] });
  render(<BulkDeleteDialog request={{ filter: {}, selected: ["failed"] }} onClose={vi.fn()} onFinished={vi.fn()} />);
  await screen.findByText("1 task(s) selected for deletion.");
  fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
  expect(await screen.findByText(/remain selected for retry. Permission denied/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Confirm deletion" })).toBeNull();
});
