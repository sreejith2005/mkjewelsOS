// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TasksPage } from "./TasksPage";

const mocks = vi.hoisted(() => ({ page: vi.fn(), feed: vi.fn() }));
vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  const profile = { id: "admin", tenant_id: "tenant", user_role: "admin" as const };
  return { useAuth: () => ({ profile, access: builtinAccessContext(profile) }) };
});
vi.mock("@/features/tasks/api", () => ({
  loadTaskPage: mocks.page, loadTaskFeed: mocks.feed,
  ensureMyRecurringTasks: async () => ({ created: 0 }),
  loadTaskFeedReferenceData: async () => ({ categories: [] }),
  loadTaskAuthoringReferenceData: vi.fn(), createDelegationTask: vi.fn(),
  reviseTask: vi.fn(), updateTask: vi.fn(), uploadAndCompleteTask: vi.fn(),
  uploadTaskAttachment: vi.fn(), loadFmsTaskDeepLink: vi.fn(),
}));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: vi.fn() }));
vi.mock("@/features/tasks/TaskCard", () => ({ TaskCard: ({ task }: { task: { title: string } }) => <div>{task.title}</div> }));
vi.mock("@/features/tasks/TaskAdminControls", () => ({ TaskAdminControls: () => null }));

const page = (title: string, total = 12000) => ({
  tasks: [{ id: title, title, task_type: "delegation", assignees: [], isWatchedByViewer: false }],
  total, counts: { pending: total, overdue: 20, completed: 10, open: total + 20 },
});
beforeEach(() => { mocks.page.mockReset(); mocks.feed.mockReset(); window.history.replaceState({}, "", "/tasks"); });
afterEach(cleanup);

describe("task workspace paging", () => {
  it("uses complete counts and fetches only the selected page", async () => {
    mocks.page.mockResolvedValue(page("First page"));
    render(<TasksPage />);
    await screen.findByText("First page");
    expect(screen.getByText("1 - 50 of 12000")).toBeTruthy();
    expect(mocks.page).toHaveBeenCalledWith("admin", "tenant", "mine", "pending", 0);
    expect(mocks.feed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(mocks.page).toHaveBeenCalledWith("admin", "tenant", "mine", "pending", 50));
    fireEvent.click(screen.getByRole("button", { name: /All Tasks/ }));
    await waitFor(() => expect(mocks.page).toHaveBeenCalledWith("admin", "tenant", "all", "pending", 0));
  });
  it("discards a late response after the selected tab changes", async () => {
    let finishOld: ((value: ReturnType<typeof page>) => void) | undefined;
    mocks.page.mockImplementation((_viewer: string, _tenant: string, view: string) => view === "mine"
      ? new Promise<ReturnType<typeof page>>((resolve) => { finishOld = resolve; })
      : Promise.resolve(page("Delegated page")));
    render(<TasksPage />);
    await waitFor(() => expect(mocks.page).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Delegated/ }));
    await screen.findByText("Delegated page");
    await act(async () => { finishOld?.(page("Old page")); });
    expect(screen.queryByText("Old page")).toBeNull();
    expect(screen.getByText("Delegated page")).toBeTruthy();
  });
});
