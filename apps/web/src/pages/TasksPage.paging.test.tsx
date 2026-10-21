// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TasksPage } from "./TasksPage";

const mocks = vi.hoisted(() => ({ page: vi.fn(), feed: vi.fn(), tabs: vi.fn(), search: vi.fn(), prepare: vi.fn(), duties: vi.fn() }));
vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  const profile = { id: "admin", tenant_id: "tenant", user_role: "admin" as const };
  return { useAuth: () => ({ profile, access: builtinAccessContext(profile) }) };
});
vi.mock("@/features/tasks/api", () => ({
  loadTaskPage: mocks.page, loadTaskFeed: mocks.feed,
  loadTaskTabCounts: mocks.tabs, loadTaskSearchPage: mocks.search,
  ensureMyRecurringTasks: mocks.prepare,
  loadTaskFeedReferenceData: async () => ({ categories: [] }),
  loadTaskAuthoringReferenceData: vi.fn(), createDelegationTask: vi.fn(),
  reviseTask: vi.fn(), updateTask: vi.fn(), uploadAndCompleteTask: vi.fn(),
  uploadTaskAttachment: vi.fn(), loadFmsTaskDeepLink: vi.fn(),
  loadMyOnDemandDuties: mocks.duties, startOnDemandDuty: vi.fn(),
}));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: vi.fn() }));
vi.mock("@/features/tasks/TaskCard", () => ({ TaskCard: ({ task }: { task: { title: string } }) => <div>{task.title}</div> }));
vi.mock("@/features/tasks/TaskAdminControls", () => ({ TaskAdminControls: () => null }));

const page = (title: string, total = 12000) => ({
  tasks: [{ id: title, title, task_type: "delegation", assignees: [], isWatchedByViewer: false }],
  total, counts: { pending: total, overdue: 20, completed: 10, open: total + 20 },
});
beforeEach(() => { mocks.search.mockReset(); mocks.page.mockReset(); mocks.feed.mockReset(); mocks.tabs.mockReset(); mocks.prepare.mockReset(); mocks.prepare.mockResolvedValue({ created: 0 }); mocks.duties.mockReset(); mocks.duties.mockResolvedValue([]); mocks.tabs.mockResolvedValue({ mine: 4, delegated: 7, inLoop: 2, all: 13 }); window.history.replaceState({}, "", "/tasks"); });
afterEach(cleanup);

describe("task workspace paging", () => {
  it("shows anytime duties as a closed bar above the tasks on every Pending page", async () => {
    mocks.duties.mockResolvedValue([{ templateId: "d1", title: "Greet customer", description: null, triggerLabel: "Per Customer", taskType: "delegation",
      priority: "medium", dueTime: null, requiresUpload: true, startedToday: 1, completedToday: 0, openCount: 1, openTaskId: "Started greeting" }]);
    mocks.page.mockResolvedValue({ ...page("First of many"), tasks: [
      { id: "First of many", title: "First of many", task_type: "delegation", assignees: [], isWatchedByViewer: false },
      { id: "Started greeting", title: "Started greeting", task_type: "delegation", task_template_id: "d1", assignees: [], isWatchedByViewer: false },
    ] });
    render(<TasksPage />);
    const bar = await screen.findByRole("button", { name: /Anytime duties \(1\)/ });
    await screen.findByText("First of many");
    expect(bar.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Greet customer")).toBeNull();
    expect(bar.compareDocumentPosition(screen.getByText("First of many")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Anytime duty · Per Customer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Overdue/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Anytime duties/ })).toBeNull());
  });

  it("searches unopened subsections and restores the board on clear", async () => {
    mocks.page.mockResolvedValue(page("Board task"));
    mocks.search.mockResolvedValue({ ...page("Matching watched task", 1), sections: { "Matching watched task": "inLoop" } });
    render(<TasksPage />);
    await screen.findByText("Board task");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search all tasks" }), { target: { value: "watched" } });
    await screen.findByText("Matching watched task");
    expect(mocks.search).toHaveBeenCalledWith("admin", "tenant", expect.objectContaining({ query: "watched", subsection: "any" }), 0);
    expect(screen.getByText("In Loop")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    await screen.findByText("Board task");
  });

  it("refreshes unopened My Tasks counts when recurring catch-up creates work", async () => {
    mocks.page.mockResolvedValue(page("Available task"));
    render(<TasksPage />);
    await screen.findByText("Available task");
    let finishPreparation: ((value: { created: number }) => void) | undefined;
    mocks.prepare.mockImplementationOnce(() => new Promise(resolve => { finishPreparation = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: /In Loop/ }));
    await waitFor(() => expect(finishPreparation).toBeTypeOf("function"));
    await waitFor(() => expect(screen.getByRole("button", { name: "My Tasks (4)" })).toBeTruthy());
    mocks.tabs.mockResolvedValue({ mine: 5, delegated: 7, inLoop: 12020, all: 13 });
    await act(async () => { finishPreparation?.({ created: 1 }); });
    await waitFor(() => expect(screen.getByRole("button", { name: "My Tasks (5)" })).toBeTruthy());
  });
  it("shows every authorized subsection count without opening the subsection", async () => {
    mocks.page.mockResolvedValue(page("First page", 4));
    render(<TasksPage />);
    await screen.findByText("First page");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delegated (7)" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "In Loop (2)" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "All Tasks (13)" })).toBeTruthy();
    });
    expect(mocks.page).toHaveBeenCalledTimes(1);
  });
  it("keeps tasks usable when unopened subsection counts cannot refresh", async () => {
    mocks.page.mockResolvedValue(page("Available task"));
    mocks.tabs.mockRejectedValue(new Error("Counts temporarily unavailable"));
    render(<TasksPage />);
    await screen.findByText("Available task");
    expect(screen.getByText(/Unable to refresh subsection counts/)).toBeTruthy();
  });
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
