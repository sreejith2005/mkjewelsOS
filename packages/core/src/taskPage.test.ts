import { describe, expect, it } from "vitest";
import { decodeTaskPage, taskAdminInitialEdit, taskAdminEditPayload } from "./taskPage";

describe("task page contracts", () => {
  it("retains full server counts on a bounded page", () => {
    const result = decodeTaskPage({ ids: ["00000000-0000-4000-8000-000000000001"], total: 12000,
      counts: { pending: 12000, overdue: 50, completed: 200, open: 12050 } });
    expect(result.total).toBe(12000);
    expect(result.counts.open).toBe(12050);
  });
  it("rejects duplicate, oversized, malformed and inconsistent pages", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const counts = { pending: 2, overdue: 0, completed: 0, open: 2 };
    for (const value of [null, { ids: [id, id], total: 2, counts },
      { ids: ["bad"], total: 2, counts }, { ids: Array(51).fill(id), total: 60, counts },
      { ids: [], total: -1, counts }, { ids: [], total: 2, counts: { ...counts, open: 1 } }]) {
      expect(() => decodeTaskPage(value)).toThrow("Invalid task page response");
    }
  });
  it("accepts an empty final page without discarding the total", () => {
    expect(decodeTaskPage({ ids: [], total: 25, counts: { pending: 25, overdue: 0, completed: 0, open: 25 } }).total).toBe(25);
  });
  it("edits in Kolkata time even when the device uses another zone", () => {
    const initial = taskAdminInitialEdit({ title: "Task", description: null, priority: "medium", planned_datetime: "2026-10-10T05:30:00Z", due_datetime: "2026-10-10T07:30:00Z", revised_datetime: null });
    expect(initial.planned).toBe("2026-10-10T11:00");
    expect(initial.due).toBe("2026-10-10T13:00");
    expect(taskAdminEditPayload(initial)).toMatchObject({ planned_datetime: "2026-10-10T05:30:00.000Z", due_datetime: "2026-10-10T07:30:00.000Z" });
  });
  it("validates admin edits and sends only supported fields", () => {
    expect(taskAdminEditPayload({ title: "  Correct task ", description: "Notes", priority: "high", planned: "2026-10-10T11:00:00+05:30", due: "2026-10-10T13:00:00+05:30" })).toEqual({
      title: "Correct task", description: "Notes", priority: "high", planned_datetime: "2026-10-10T05:30:00.000Z", due_datetime: "2026-10-10T07:30:00.000Z",
    });
    expect(() => taskAdminEditPayload({ title: "", description: "", priority: "low", planned: "invalid", due: "invalid" })).toThrow();
    expect(() => taskAdminEditPayload({ title: "Task", description: "", priority: "low", planned: "2026-10-10T13:00:00Z", due: "2026-10-10T11:00:00Z" })).toThrow();
  });
});
