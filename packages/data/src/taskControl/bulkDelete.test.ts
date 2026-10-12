import { describe, expect, it, vi } from "vitest";
import { prepareTaskBulkDelete, executeTaskBulkDelete } from "./bulkDelete";
import type { EvidenceWorkspace } from "../taskEvidence/types";
const workspace = (ids: string[], total: number): EvidenceWorkspace => ({
  filters: { from: "2026-10-01", to: "2026-10-12", view: "all", page: 1, page_size: 100 },
  stats: { tasks_total: total, upload_tasks: 0, upload_tasks_with_evidence: 0, upload_tasks_awaiting_evidence: 0, completed: 0, remaining: total, overdue: 0, evidence_files: 0, evidence_bytes: 0 },
  tasks_total: total, missing: [], missing_total: 0,
  tasks: ids.map((task_id) => ({ task_id, task_type: "checklist", task_title: task_id, task_status: "pending", requires_upload: false, is_upload_work: false, overdue: false, branch_name: null, department_name: null, assignee_names: null, planned_datetime: "2026-10-12T00:00:00Z", due_datetime: null, actual_datetime: null, attachments: [] })),
});
describe("bulk task deletion", () => {
  it("collects all filtered pages before any write", async () => {
    const read = vi.fn().mockResolvedValueOnce(workspace(Array.from({ length: 100 }, (_, i) => String(i)), 101)).mockResolvedValueOnce(workspace(["100"], 101));
    const targets = vi.fn(async (ids: readonly string[]) => ids.map((id) => ({ id, task_template_id: null })));
    const result = await prepareTaskBulkDelete({ user_profile_id: "employee", search: "wrong", view: "remaining" }, null, read, targets);
    expect(result).toHaveLength(101);
    expect(read.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ user_profile_id: "employee", search: "wrong", view: "remaining", page: 2, page_size: 100 }));
    expect(targets.mock.calls.every(([ids]) => ids.length <= 100)).toBe(true);
  });
  it("rejects a changing result set without broadening the deletion", async () => {
    const read = vi.fn().mockResolvedValueOnce(workspace(Array.from({ length: 100 }, (_, i) => String(i)), 101)).mockResolvedValueOnce(workspace([], 100));
    await expect(prepareTaskBulkDelete({}, null, read, vi.fn())).rejects.toThrow("changed");
  });
  it("loads only selected identities and rejects missing rows", async () => {
    const read = vi.fn();
    const targets = vi.fn().mockResolvedValue([]);
    await expect(prepareTaskBulkDelete({}, ["one"], read, targets)).rejects.toThrow("no longer available");
    expect(read).not.toHaveBeenCalled();
  });
  it("deletes a recurring series once and reports failures for retry", async () => {
    const remove = vi.fn(async (id: string) => { if (id === "bad") throw new Error("Permission denied"); });
    const result = await executeTaskBulkDelete([{ id: "a", task_template_id: "series" }, { id: "b", task_template_id: "series" }, { id: "bad", task_template_id: null }], true, "Correction", remove, vi.fn());
    expect(remove).toHaveBeenCalledTimes(2);
    expect(result.succeeded).toEqual(expect.arrayContaining(["a", "b"]));
    expect(result.failed).toEqual([{ id: "bad", message: "Permission denied" }]);
  });
  it("limits in-flight writes and leaves queued tasks for retry after a failure", async () => {
    let active = 0, peak = 0;
    const remove = vi.fn(async () => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; throw new Error("Denied"); });
    const targets = Array.from({ length: 10 }, (_, i) => ({ id: String(i), task_template_id: null }));
    const result = await executeTaskBulkDelete(targets, false, "", remove, vi.fn());
    expect(peak).toBe(3);
    expect(remove).toHaveBeenCalledTimes(3);
    expect(result.failed).toHaveLength(10);
    expect(result.failed.filter((row) => row.message.startsWith("Not attempted"))).toHaveLength(7);
  });
  it("keeps ordinary tasks as occurrence deletes when series mode is selected", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    await executeTaskBulkDelete([{ id: "ordinary", task_template_id: null }], true, "Correcting assignments", remove, vi.fn());
    expect(remove).toHaveBeenCalledWith("ordinary", false, "Correcting assignments");
  });
});
