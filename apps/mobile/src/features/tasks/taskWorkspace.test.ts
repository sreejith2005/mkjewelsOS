import { describe, expect, it, vi } from "vitest";
import { findWorkspaceTask, loadTaskWorkspacePage, loadTaskDetail, type TaskWorkspace } from "./taskWorkspace";

const api = vi.hoisted(() => ({ page: vi.fn(), feed: vi.fn(), references: vi.fn() }));
vi.mock("@jewelos/data/tasks/api", () => ({ loadTaskPage: api.page, loadTaskFeed: api.feed, loadTaskFeedReferenceData: api.references }));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), debug: vi.fn() } }));

describe("task workspace details", () => {
  it("opens a task from the In Loop list", () => {
    // The lookup reads only id; the feed bundle is intentionally minimal here.
    const watched = { id: "watched-task" } as TaskWorkspace["inLoop"][number];
    const workspace = { mine: [], delegated: [], inLoop: [watched], categories: [] };
    expect(findWorkspaceTask(workspace, "watched-task")).toBe(watched);
  });
});


describe("paged task workspace", () => {
  it("requests only the selected page and keeps full counts", async () => {
    api.page.mockResolvedValue({ tasks: [], total: 12345, counts: { pending: 12345, overdue: 0, completed: 0, open: 12345 } });
    api.references.mockResolvedValue({ categories: [] });
    const page = await loadTaskWorkspacePage({ id: "viewer", tenant_id: "tenant", user_role: "admin" }, "delegated", "pending", 50);
    expect(api.page).toHaveBeenCalledWith("viewer", "tenant", "delegated", "pending", 50);
    expect(page.total).toBe(12345);
    expect(api.feed).not.toHaveBeenCalled();
  });
  it("opens a persisted task directly without loading the board", async () => {
    const task = { id: "00000000-0000-4000-8000-000000000001" };
    api.feed.mockResolvedValue([task]);
    expect(await loadTaskDetail({ id: "viewer", tenant_id: "tenant", user_role: "staff" }, task.id)).toBe(task);
    expect(api.feed).toHaveBeenCalledWith("viewer", "", "", { tenantId: "tenant", recordId: task.id });
  });
});
