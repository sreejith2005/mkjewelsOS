// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TasksPage } from "./TasksPage";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), page: vi.fn(), tabs: vi.fn(), dueAt: null as string | null }));
vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  const profile = { id: "employee", tenant_id: "tenant", user_role: "staff" as const };
  return { useAuth: () => ({ profile, access: builtinAccessContext(profile) }) };
});
vi.mock("@jewelos/api-client/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@jewelos/api-client/client")>(),
  getSupabase: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/features/tasks/api", () => ({
  loadTaskPage: mocks.page, loadTaskTabCounts: mocks.tabs, loadTaskFeed: vi.fn(), loadTaskSearchPage: vi.fn(),
  ensureMyRecurringTasks: async () => ({ created: 0 }), loadMyOnDemandDuties: async () => [], startOnDemandDuty: vi.fn(),
  loadTaskFeedReferenceData: async () => ({ categories: [] }), loadTaskAuthoringReferenceData: vi.fn(),
  createDelegationTask: vi.fn(), reviseTask: vi.fn(), updateTask: vi.fn(), uploadAndCompleteTask: vi.fn(),
  uploadTaskAttachment: vi.fn(), loadFmsTaskDeepLink: vi.fn(),
}));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: vi.fn() }));

const id = "00000000-0000-4000-8000-000000000001";
const counts = (n: number) => ({ active: n, pending: n, overdue: 0, waiting: 0, completed: 0 });
const dateScopes = () => within(screen.getByRole("group", { name: "Task date scope" }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dueAt = null;
  window.history.replaceState({}, "", "/tasks");
  mocks.page.mockResolvedValue({ tasks: [], total: 0, counts: { pending: 0, overdue: 0, completed: 0, open: 0 } });
  mocks.tabs.mockImplementation(async (_all, _scope, _status, _filters, fmsFilter) => ({ mine: 0, delegated: 0, inLoop: 0, fms: fmsFilter?.dateScope === "overall" ? 1 : 0 }));
  // A durable assignment without a deadline is returned by Overall, excluded by
  // strict Today/Overdue. Keep the real data decoder and employee hierarchy.
  mocks.rpc.mockImplementation(async (name: string, args: { p_filter: { dateScope: string } }) => {
    const total = args.p_filter.dateScope === "overall" ? 1 : 0;
    if (name === "get_fms_task_workspace") return { error: null, data: {
      families: total ? [{ id, name: "Enquiries", count: 1 }] : [], total, activeTotal: total, familyTotal: total, counts: counts(total),
    } };
    if (name === "get_fms_task_stages") return { error: null, data: [{
      id: `${id}:stage`, flowId: id, stageId: id, name: "Call", version: 1, count: total,
      pipeline: "", order: 0, starting: false, nextStageIds: [],
    }] };
    if (name === "get_fms_task_stage_page") return { error: null, data: { total, records: total ? [{
      id, name: "Assigned customer", reference: "FMS-1", dueAt: mocks.dueAt, status: "pending", visitNumber: 1,
      description: "Call the customer", target: { kind: "stage", instanceId: id, instanceStageId: id },
    }] : [] } };
    throw new Error(`Unexpected RPC: ${name}`);
  });
});
afterEach(() => { cleanup(); window.sessionStorage.clear(); });

it.each([null, "2099-11-03T05:30:00Z"])("shows assigned FMS work due %s on entry without changing ordinary defaults", async (dueAt) => {
  mocks.dueAt = dueAt;
  render(<TasksPage />);
  await waitFor(() => expect(mocks.page).toHaveBeenCalled());
  expect(dateScopes().getByRole("button", { name: "today" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: /^FMS/ }));
  await screen.findByRole("heading", { name: "Assigned customer" });
  expect(dateScopes().getByRole("button", { name: "overall" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "FMS (1)" })).toBeTruthy();
  expect(mocks.rpc).toHaveBeenCalledWith("get_fms_task_stage_page", expect.objectContaining({ p_filter: expect.objectContaining({ dateScope: "overall" }) }));
  fireEvent.click(screen.getByRole("button", { name: /^My Tasks/ }));
  await waitFor(() => expect(mocks.page).toHaveBeenLastCalledWith("employee", "tenant", "mine", "pending", 0, "today"));
});

it("shows assigned work on the FMS list URL used by Home and completed forms", async () => {
  window.history.replaceState({}, "", "/tasks?view=fms");
  render(<TasksPage />);
  await screen.findByRole("heading", { name: "Assigned customer" });
  expect(dateScopes().getByRole("button", { name: "overall" }).getAttribute("aria-pressed")).toBe("true");
});

it("keeps an explicitly selected Today scope strict across subsection switches", async () => {
  render(<TasksPage />);
  await waitFor(() => expect(mocks.page).toHaveBeenCalled());
  fireEvent.click(dateScopes().getByRole("button", { name: "today" }));
  fireEvent.click(screen.getByRole("button", { name: /^FMS/ }));
  await screen.findByText("No FMS work here");
  expect(screen.queryByRole("heading", { name: "Assigned customer" })).toBeNull();
  fireEvent.click(dateScopes().getByRole("button", { name: "overall" }));
  // Reopen the hierarchy if Today's empty result was loaded first.
  fireEvent.click(await screen.findByRole("button", { name: /Enquiries/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Call.*1/ }));
  await screen.findByRole("heading", { name: "Assigned customer" });
  fireEvent.click(screen.getByRole("button", { name: /^Delegated/ }));
  await waitFor(() => expect(mocks.page).toHaveBeenCalledWith("employee", "tenant", "delegated", "pending", 0, "overall"));
});
