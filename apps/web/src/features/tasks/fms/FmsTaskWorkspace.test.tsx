// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ loadFmsTaskWorkspace: vi.fn(), loadFmsTaskStages: vi.fn(), loadFmsTaskStagePage: vi.fn(), loadFmsTaskBoard: vi.fn(), FMS_BOARD_PAGE_SIZE: 20 }));
const auth = vi.hoisted(() => ({ access: null as unknown }));
const permission = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock("@jewelos/data/fms/taskWorkspace", () => api);
vi.mock("@jewelos/data/tasks/api", () => ({ loadTaskAssignmentUsers: vi.fn().mockResolvedValue([{ id: "00000000-0000-4000-8000-000000000090", employee_name: "Riya Mahto" }]) }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: vi.fn() }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@jewelos/core", async (original) => ({ ...await original<typeof import("@jewelos/core")>(), hasPermission: (_access: unknown, key: string) => permission.allowed.has(key) }));
import { FmsTaskWorkspace } from "./FmsTaskWorkspace";
import { fmsTasksReturnPath } from "./boardReturn";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const family = id(1);
const card = (n: number, patch: Record<string, unknown> = {}) => ({ id: id(100 + n), name: `Lead ${n}`, reference: `INST-2026-${1000 + n}`, description: "", dueAt: "2026-11-05T10:00:00Z", status: "pending", visitNumber: 1,
  priority: "medium", urgency: "upcoming", assignees: [{ id: id(90), name: "Riya Mahto" }], target: { kind: "stage", instanceId: id(200 + n), instanceStageId: id(100 + n) }, ...patch });
const column = (n: number, name: string, patch: Record<string, unknown> = {}) => ({ id: `${id(10 + n)}:stage`, flowId: id(5), stageId: id(10 + n), name, version: 1, stepType: "form", count: 0, overdue: 0, dueToday: 0,
  pipeline: "", order: n, starting: false, nextStageIds: [] as string[], records: [] as unknown[], ...patch });
const board = () => ({
  name: "Instagram Online Sales Funnel",
  counts: { active: 3, overdue: 1, dueToday: 1, upcoming: 1, noDue: 0, waiting: 0, completed: 0, shown: 3 },
  stages: [
    column(2, "Demo", { nextStageIds: [id(13)], count: 1, dueToday: 1, records: [card(2, { urgency: "today", priority: "high" })] }),
    column(1, "Introduction", { nextStageIds: [id(12)], count: 22, overdue: 1, records: [card(1, { urgency: "overdue", dueAt: "2020-01-01T04:30:00Z" }), card(3, { visitNumber: 2 })] }),
    column(3, "Follow-up 3", { nextStageIds: [id(14)] }),
    column(4, "Lead Closed", { stepType: "end" }),
    column(5, "Route check", { stepType: "branch" }),
  ],
});
const go = (path: string) => window.history.pushState({}, "", path);
afterEach(() => { cleanup(); go("/"); window.sessionStorage.clear(); });
beforeEach(() => {
  vi.clearAllMocks();
  auth.access = {}; permission.allowed = new Set(["tasks.manage_team"]);
  Object.defineProperty(window, "matchMedia", { configurable: true, value: undefined });
  api.loadFmsTaskWorkspace.mockResolvedValue({ families: [{ id: family, name: "Instagram Online Sales Funnel", count: 24, active: 24, overdue: 5, dueToday: 8 }, { id: id(2), name: "Order & Repair FMS", count: 15, active: 15, overdue: 3, dueToday: 4 }],
    total: 39, activeTotal: 39, familyTotal: 2, counts: { active: 39, pending: 31, overdue: 8, waiting: 2, completed: 7, dueToday: 12 } });
  api.loadFmsTaskBoard.mockResolvedValue(board());
  api.loadFmsTaskStagePage.mockResolvedValue({ total: 22, records: [card(4), card(1, { urgency: "overdue" })] });
});
const renderWorkspace = (navigate = vi.fn((path: string) => go(path))) => {
  const view = render(<FmsTaskWorkspace actorId={id(9)} tenantId={id(8)} onNavigate={navigate} onCount={vi.fn()} />);
  // The app re-renders the page after navigate(); mirror that here.
  navigate.mockImplementation((path: string) => { go(path); view.rerender(<FmsTaskWorkspace actorId={id(9)} tenantId={id(8)} onNavigate={navigate} onCount={vi.fn()} />); });
  return { navigate, ...view };
};
const openBoard = () => { go(`/tasks?view=fms&workflow=${family}`); return renderWorkspace(); };

it("lists every workflow with exact server counts and opens its board URL", async () => {
  const { navigate } = renderWorkspace();
  const row = await screen.findByRole("link", { name: /Instagram Online Sales Funnel/ });
  expect(row.textContent).toMatch(/24 active tasks.*5 overdue.*8 due today/);
  expect(screen.getByRole("link", { name: /Order & Repair FMS/ }).textContent).toMatch(/15 active tasks.*3 overdue.*4 due today/);
  expect(api.loadFmsTaskBoard).not.toHaveBeenCalled(); expect(api.loadFmsTaskStagePage).not.toHaveBeenCalled();
  expect(row.getAttribute("href")).toBe(`/tasks?view=fms&workflow=${family}`);
  await userEvent.click(row);
  expect(navigate).toHaveBeenCalledWith(`/tasks?view=fms&workflow=${family}`);
  expect(await screen.findByRole("region", { name: "Workflow stages" })).toBeTruthy();
});

it("shows a direct board link: one column per person step, in route order, with exact counts", async () => {
  openBoard();
  const region = await screen.findByRole("region", { name: "Workflow stages" });
  // Only steps holding work are columns by default.
  expect(within(region).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Introduction", "Demo"]);
  expect(screen.queryByText("Lead Closed")).toBeNull(); expect(screen.queryByText("Route check")).toBeNull();
  const intro = screen.getByRole("region", { name: "Introduction: 22 tasks" });
  expect(intro.textContent).toContain("22 pending"); expect(intro.textContent).toContain("1 overdue");
  await userEvent.click(screen.getByRole("button", { name: "Show empty steps (1)" }));
  expect(within(screen.getByRole("region", { name: "Follow-up 3: 0 tasks" })).getByText("No pending work.")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Hide empty steps" }));
  expect(screen.queryByRole("region", { name: "Follow-up 3: 0 tasks" })).toBeNull();
  expect(screen.getByLabelText("Workflow counts").textContent).toMatch(/Active: 3.*Due today: 1.*Overdue: 1/);
  expect(api.loadFmsTaskWorkspace).not.toHaveBeenCalled();
  expect(api.loadFmsTaskBoard).toHaveBeenCalledTimes(1);
  expect(api.loadFmsTaskStagePage).not.toHaveBeenCalled();
});

it("highlights overdue and due-today cards and distinguishes repeat visits", async () => {
  openBoard();
  const overdue = await screen.findByRole("link", { name: "Open work — Lead 1" });
  expect(overdue.className).toContain("border-danger");
  expect(overdue.textContent).toMatch(/Overdue · 1 Jan 2020 · 10:00 am/i);
  expect(overdue.textContent).toContain("REF: INST-2026-1001");
  expect(screen.getByRole("link", { name: "Open work — Lead 2" }).textContent).toContain("High priority");
  expect(screen.getByRole("link", { name: "Open work — Lead 3" }).textContent).toContain("Visit 2");
});

it("loads the rest of a column on demand without duplicate cards", async () => {
  openBoard();
  await userEvent.click(await screen.findByRole("button", { name: "Show 20 more" }));
  await screen.findByRole("link", { name: "Open work — Lead 4" });
  expect(api.loadFmsTaskStagePage).toHaveBeenCalledWith({ familyId: family, flowId: id(5), stageId: id(11), starting: false }, expect.objectContaining({ status: "active" }), 2, 20);
  expect(screen.getAllByRole("link", { name: "Open work — Lead 1" })).toHaveLength(1);
});

it("filters by due state, priority, sort and search on the server", async () => {
  const user = userEvent.setup();
  openBoard();
  await user.click(await screen.findByRole("button", { name: "Overdue (1)" }));
  await waitFor(() => expect(api.loadFmsTaskBoard).toHaveBeenLastCalledWith(family, expect.objectContaining({ due: "overdue" })));
  await user.selectOptions(screen.getByRole("combobox", { name: "Priority" }), "high");
  await waitFor(() => expect(api.loadFmsTaskBoard).toHaveBeenLastCalledWith(family, expect.objectContaining({ priority: "high", due: "overdue" })));
  await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "priority");
  await waitFor(() => expect(api.loadFmsTaskBoard).toHaveBeenLastCalledWith(family, expect.objectContaining({ sort: "priority" })));
  await user.type(screen.getByRole("searchbox"), "INST-2026-1001");
  await waitFor(() => expect(api.loadFmsTaskBoard).toHaveBeenLastCalledWith(family, expect.objectContaining({ query: "INST-2026-1001" })));
});

it("opens the existing work page and returns to the same board afterwards", async () => {
  const { navigate } = openBoard();
  await userEvent.click(await screen.findByRole("link", { name: "Open work — Lead 1" }));
  const work = `/tasks/fms?instance=${id(201)}&stage=${id(101)}`;
  expect(navigate).toHaveBeenLastCalledWith(work);
  expect(fmsTasksReturnPath(work)).toBe(`/tasks?view=fms&workflow=${family}`);
  expect(fmsTasksReturnPath(`/tasks/fms?instance=${id(202)}&stage=${id(102)}`)).toBe("/tasks?view=fms");
});

it("Back returns to the workflow list, and browser Back reopens the board", async () => {
  const { navigate } = openBoard();
  await userEvent.click(await screen.findByRole("button", { name: "All FMS workflows" }));
  expect(navigate).toHaveBeenLastCalledWith("/tasks?view=fms");
  await screen.findByRole("link", { name: /Order & Repair FMS/ });
  await act(async () => { window.history.back(); await new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true })); });
  expect(await screen.findByRole("region", { name: "Workflow stages" })).toBeTruthy();
});

it("a realtime refresh reloads counts and keeps one card per visit", async () => {
  openBoard();
  await screen.findByRole("link", { name: "Open work — Lead 1" });
  const next = board(); next.stages[1] = { ...next.stages[1]!, count: 21, overdue: 0, records: [card(3, { visitNumber: 2 })] };
  next.counts = { ...next.counts, active: 2, overdue: 0, upcoming: 1 };
  api.loadFmsTaskBoard.mockResolvedValueOnce(next);
  act(() => { void vi.mocked(useTenantRealtimeRefresh).mock.calls.at(-1)?.[0].refresh(); });
  await waitFor(() => expect(screen.queryByRole("link", { name: "Open work — Lead 1" })).toBeNull());
  expect(screen.getAllByRole("link", { name: "Open work — Lead 3" })).toHaveLength(1);
  expect(screen.getByRole("region", { name: "Introduction: 21 tasks" })).toBeTruthy();
});

it("staff keep the original workflow -> stage list and never load the board", async () => {
  permission.allowed = new Set();
  api.loadFmsTaskStages.mockResolvedValue([{ id: `${id(11)}:stage`, flowId: id(5), stageId: id(11), name: "Introduction", version: 1, count: 2, pipeline: "", order: 0, starting: false, nextStageIds: [] }]);
  go(`/tasks?view=fms&workflow=${family}`);
  renderWorkspace();
  expect(await screen.findByRole("button", { name: /Instagram Online Sales Funnel.*24/ })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Workflow stages" })).toBeNull();
  expect(api.loadFmsTaskBoard).not.toHaveBeenCalled();
});

it("the step bar jumps to a column on a computer", async () => {
  const scrollTo = vi.fn(); Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
  openBoard();
  const stages = await screen.findByRole("navigation", { name: "Stages" });
  await userEvent.click(within(stages).getByRole("button", { name: /Demo/ }));
  expect(scrollTo).toHaveBeenCalled();
  expect(screen.getByRole("region", { name: "Demo: 1 tasks" }).className).toContain("border-task-accent");
  expect(screen.getByRole("link", { name: "Open work — Lead 1" })).toBeTruthy();
});

it("a manager starts on the whole team, can filter by employee, or narrow to their own work", async () => {
  const user = userEvent.setup();
  const { unmount } = renderWorkspace();
  await screen.findByRole("link", { name: /Instagram Online Sales Funnel/ });
  expect(api.loadFmsTaskWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "all" }), 0);
  unmount();
  openBoard();
  await waitFor(() => expect(api.loadFmsTaskBoard).toHaveBeenLastCalledWith(family, expect.objectContaining({ scope: "all" })));
  expect((screen.getByRole("combobox", { name: "Whose work" }) as HTMLSelectElement).value).toBe("all");
  await screen.findByRole("option", { name: "Riya Mahto" });
  await user.selectOptions(screen.getByRole("combobox", { name: "Employee" }), id(90));
  await waitFor(() => expect(api.loadFmsTaskBoard).toHaveBeenLastCalledWith(family, expect.objectContaining({ scope: "all", assigneeId: id(90) })));
  expect((await screen.findByRole("link", { name: "Open work — Lead 1" })).textContent).toContain("Assigned: Riya Mahto");
  await user.selectOptions(screen.getByRole("combobox", { name: "Whose work" }), "mine");
  await waitFor(() => expect(api.loadFmsTaskBoard).toHaveBeenLastCalledWith(family, expect.objectContaining({ scope: "mine", assigneeId: "" })));
  expect(screen.queryByRole("combobox", { name: "Employee" })).toBeNull();
});

it("on a phone shows one stage at a time with a stage selector", async () => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  openBoard();
  const stages = await screen.findByRole("navigation", { name: "Stages" });
  expect(within(stages).getAllByRole("button").map((button) => button.textContent)).toEqual(["Introduction22", "Demo1"]);
  expect(screen.getByRole("link", { name: "Open work — Lead 1" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Open work — Lead 2" })).toBeNull();
  await userEvent.click(within(stages).getByRole("button", { name: /Demo/ }));
  expect(screen.getByRole("link", { name: "Open work — Lead 2" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Open work — Lead 1" })).toBeNull();
});

it("names each record's action for the work that is waiting", async () => {
  const { fmsRecordAction } = await import("./FmsTaskGroups");
  const stage = { kind: "stage", instanceId: id(1), instanceStageId: id(1) } as const;
  expect(fmsRecordAction({ status: "pending", target: { kind: "stage_form", instanceId: id(1), instanceStageId: id(1), formTemplateId: id(1) } })).toBe("Fill form");
  expect(fmsRecordAction({ status: "overdue", target: { kind: "starter_form", starterAssignmentId: id(1), formTemplateId: id(1) } })).toBe("Start form");
  expect(fmsRecordAction({ status: "pending", target: stage })).toBe("Open work");
  expect(fmsRecordAction({ status: "waiting", target: stage })).toBe("View details");
  expect(fmsRecordAction({ status: "completed", target: stage })).toBe("View");
});
