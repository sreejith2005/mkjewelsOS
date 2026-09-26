import { describe, expect, it, vi } from "vitest";
import { findWorkspaceTask, type TaskWorkspace } from "./taskWorkspace";

vi.mock("@jewelos/data/tasks/api", () => ({}));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), debug: vi.fn() } }));

describe("task workspace details", () => {
  it("opens a task from the In Loop list", () => {
    // The lookup reads only id; the feed bundle is intentionally minimal here.
    const watched = { id: "watched-task" } as TaskWorkspace["inLoop"][number];
    const workspace = { mine: [], delegated: [], inLoop: [watched], categories: [] };
    expect(findWorkspaceTask(workspace, "watched-task")).toBe(watched);
  });
});
