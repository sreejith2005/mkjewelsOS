// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ loadFmsTaskWorkspace: vi.fn(), loadFmsTaskStages: vi.fn(), loadFmsTaskStagePage: vi.fn() }));
vi.mock("@jewelos/data/fms/taskWorkspace", () => api);
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: vi.fn() }));
import { FmsTaskWorkspace } from "./FmsTaskWorkspace";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
const id = "00000000-0000-4000-8000-000000000001";
afterEach(cleanup);
beforeEach(() => {
 vi.clearAllMocks();
 api.loadFmsTaskWorkspace.mockResolvedValue({ families: [{ id, name: "Enquiries", count: 250 }], total: 250, activeTotal: 250, familyTotal: 1, counts: { active: 250, pending: 240, overdue: 10, waiting: 0, completed: 0 } });
 api.loadFmsTaskStages.mockResolvedValue([{ id: `${id}:stage`, flowId: id, stageId: id, name: "Introduction Call", version: 1, count: 250, pipeline: "Sales", order: 0, starting: false, nextStageIds: [] }]);
 api.loadFmsTaskStagePage.mockResolvedValue({ total: 250, records: [{ id, name: "Rahul Shah", reference: "FMS-1", dueAt: null, status: "pending", visitNumber: 2, description: "Call the client", target: { kind: "stage", instanceId: id, instanceStageId: id } }] });
});
it("preserves the shared calendar scope through summary, stage and record drilldowns", async () => {
 const onCount = vi.fn();
 const { rerender } = render(<FmsTaskWorkspace actorId={id} tenantId={id} scope="today" onNavigate={vi.fn()} onCount={onCount} />);
 await screen.findByText("Rahul Shah");
 expect(api.loadFmsTaskWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "today" }), 0);
 expect(api.loadFmsTaskStages).toHaveBeenLastCalledWith(id, expect.objectContaining({ scope: "today" }));
 expect(api.loadFmsTaskStagePage).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ scope: "today" }), 0);
 rerender(<FmsTaskWorkspace actorId={id} tenantId={id} scope="overall" onNavigate={vi.fn()} onCount={onCount} />);
 await waitFor(() => expect(api.loadFmsTaskWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "overall" }), 0));
 expect(onCount).toHaveBeenCalledWith(250);
});
it("loads exact family counts first and lazily opens stages, records and existing work", async () => {
 api.loadFmsTaskWorkspace.mockResolvedValue({ families: [{ id, name: "Enquiries", count: 250 }, { id: "00000000-0000-4000-8000-000000000002", name: "Repairs", count: 3 }], total: 253, activeTotal: 253, familyTotal: 2, counts: { active: 253, pending: 243, overdue: 10, waiting: 0, completed: 0 } });
 const user = userEvent.setup(); const navigate = vi.fn();
 render(<FmsTaskWorkspace actorId={id} tenantId={id} onNavigate={navigate} onCount={vi.fn()} />);
 await screen.findByRole("button", { name: /Enquiries.*250/ });
 expect(api.loadFmsTaskStages).not.toHaveBeenCalled(); expect(api.loadFmsTaskStagePage).not.toHaveBeenCalled();
 await user.click(screen.getByRole("button", { name: /Enquiries.*250/ }));
 await user.click(await screen.findByRole("button", { name: /Introduction Call.*250/ }));
 await screen.findByText("Rahul Shah");
 await user.click(screen.getByRole("heading", { name: "Rahul Shah" }));
 expect(navigate).toHaveBeenCalledWith(`/tasks/fms?instance=${id}&stage=${id}`);
 expect(screen.getByText(/1 - 50 of 250/)).toBeTruthy();
});
it("has a retry action after a failed summary without fetching records", async () => {
 api.loadFmsTaskWorkspace.mockRejectedValueOnce(new Error("Try again")).mockResolvedValueOnce({ families: [{ id, name: "Enquiries", count: 250 }, { id: "00000000-0000-4000-8000-000000000002", name: "Repairs", count: 3 }], total: 253, activeTotal: 253, familyTotal: 2, counts: { active: 253, pending: 243, overdue: 10, waiting: 0, completed: 0 } });
 render(<FmsTaskWorkspace actorId={id} tenantId={id} onNavigate={vi.fn()} onCount={vi.fn()} />);
 await screen.findByText("Try again");
 await userEvent.click(screen.getByRole("button", { name: "Retry" }));
 await waitFor(() => expect(api.loadFmsTaskWorkspace).toHaveBeenCalledTimes(2));
 expect(api.loadFmsTaskStagePage).not.toHaveBeenCalled();
});
it("preserves expanded work across realtime refreshes", async () => {
 render(<FmsTaskWorkspace actorId={id} tenantId={id} onNavigate={vi.fn()} onCount={vi.fn()} />);
 await screen.findByText("Rahul Shah");
 act(() => { void vi.mocked(useTenantRealtimeRefresh).mock.calls[0]?.[0].refresh(); });
 await waitFor(() => expect(api.loadFmsTaskWorkspace).toHaveBeenCalledTimes(2));
 await waitFor(() => expect(api.loadFmsTaskStagePage).toHaveBeenCalledTimes(2));
 expect(screen.getByRole("button", { name: /Introduction Call.*250/ }).getAttribute("aria-expanded")).toBe("true");
 expect(screen.getByText("Rahul Shah")).toBeTruthy();
});

it("restores expanded groups after a search filter reload", async () => {
 const user = userEvent.setup();
 render(<FmsTaskWorkspace actorId={id} tenantId={id} onNavigate={vi.fn()} onCount={vi.fn()} />);
 await screen.findByText("Rahul Shah");
 await user.type(screen.getByRole("searchbox"), "Rahul");
 await waitFor(() => expect(api.loadFmsTaskWorkspace).toHaveBeenCalledTimes(2));
 await waitFor(() => expect(api.loadFmsTaskStagePage).toHaveBeenCalledTimes(2));
 expect(screen.getByRole("button", { name: /Introduction Call.*250/ }).getAttribute("aria-expanded")).toBe("true");
 expect(screen.getByText("Rahul Shah")).toBeTruthy();
});

it.each(["summary-first", "records-first"])("hides records when an expanded stage becomes empty: %s", async order => {
 const user = userEvent.setup();
 const stages = await api.loadFmsTaskStages();
 api.loadFmsTaskStages.mockResolvedValue([...stages, { ...stages[0], id: "other", stageId: "other", name: "Other stage", count: 1 }]);
 render(<FmsTaskWorkspace actorId={id} tenantId={id} onNavigate={vi.fn()} onCount={vi.fn()} />);
 // Two stages have work, so only the single workflow opens by itself.
 await user.click(await screen.findByRole("button", { name: /Introduction Call.*250/ }));
 await screen.findByText("Rahul Shah");
 let resolveStages!: (value: unknown) => void;
 let resolvePage!: (value: unknown) => void;
 api.loadFmsTaskStages.mockImplementationOnce(() => new Promise(resolve => { resolveStages = resolve; }));
 api.loadFmsTaskStagePage.mockImplementationOnce(() => new Promise(resolve => { resolvePage = resolve; }));
 act(() => { void vi.mocked(useTenantRealtimeRefresh).mock.calls[0]?.[0].refresh(); });
 await waitFor(() => expect(resolvePage).toBeTypeOf("function"));
 const emptyStage = [...stages.map((stage: { count: number }) => ({ ...stage, count: 0 })), { ...stages[0], id: "other", stageId: "other", name: "Other stage", count: 1 }];
 if (order === "records-first") await act(async () => resolvePage({ total: 0, records: [] }));
 await act(async () => resolveStages(emptyStage));
 // A stage without work is not listed at all, so its stale records go with it.
 await waitFor(() => expect(screen.queryByRole("button", { name: /Introduction Call/ })).toBeNull());
 expect(screen.queryByText("Rahul Shah")).toBeNull();
 if (order === "summary-first") await act(async () => resolvePage({ total: 250, records: [{ id, name: "Rahul Shah" }] }));
 expect(screen.queryByText("Rahul Shah")).toBeNull();
});

it("opens the only workflow and its only stage with work, and names the action", async () => {
 const navigate = vi.fn();
 render(<FmsTaskWorkspace actorId={id} tenantId={id} onNavigate={navigate} onCount={vi.fn()} />);
 const link = await screen.findByRole("link", { name: "Open work — Rahul Shah" });
 expect(screen.getByRole("button", { name: /Enquiries.*250/ }).getAttribute("aria-expanded")).toBe("true");
 expect(link.textContent).toContain("Introduction Call");
 expect(link.textContent).toContain("Visit 2");
 expect(screen.getByText("Work you can do now: to do and overdue.")).toBeTruthy();
 await userEvent.setup().click(screen.getByRole("button", { name: /Enquiries.*250/ }));
 expect(screen.queryByText("Rahul Shah")).toBeNull();
});
it("lists only stages with work and never shows the starting form as a stage", async () => {
 const stages = await api.loadFmsTaskStages();
 api.loadFmsTaskStages.mockResolvedValue([
  { ...stages[0], id: "start", stageId: "11111111-1111-4111-8111-111111111111", name: "Start form", count: 0, starting: true },
  ...stages,
  { ...stages[0], id: "empty", stageId: "22222222-2222-4222-8222-222222222222", name: "Follow Up 1", count: 0, order: 1 },
 ]);
 render(<FmsTaskWorkspace actorId={id} tenantId={id} onNavigate={vi.fn()} onCount={vi.fn()} />);
 await screen.findByRole("link", { name: "Open work — Rahul Shah" });
 expect(screen.getByRole("button", { name: /Introduction Call.*250/ })).toBeTruthy();
 expect(screen.queryByRole("button", { name: /Start form/ })).toBeNull();
 expect(screen.queryByRole("button", { name: /Follow Up 1/ })).toBeNull();
});
it("keeps a pending starter assignment reachable, labelled as a form to start", async () => {
 const { visibleFmsWorkspaceStages } = await import("./FmsTaskGroups");
 const stages = await api.loadFmsTaskStages();
 const visible = visibleFmsWorkspaceStages([{ ...stages[0], id: "start", stageId: "11111111-1111-4111-8111-111111111111", name: "Start form", count: 1, starting: true }, { ...stages[0], count: 0 }]);
 expect(visible.map((stage: { name: string }) => stage.name)).toEqual(["Start form"]);
 api.loadFmsTaskStages.mockResolvedValue(visible);
 render(<FmsTaskWorkspace actorId={id} tenantId={id} onNavigate={vi.fn()} onCount={vi.fn()} />);
 expect((await screen.findByRole("button", { name: /Start form/ })).textContent).toContain("Form to start");
});
it("names each record's action for the work that is waiting", async () => {
 const { fmsRecordAction } = await import("./FmsTaskGroups");
 const stage = { kind: "stage", instanceId: id, instanceStageId: id } as const;
 expect(fmsRecordAction({ status: "pending", target: { kind: "stage_form", instanceId: id, instanceStageId: id, formTemplateId: id } })).toBe("Fill form");
 expect(fmsRecordAction({ status: "overdue", target: { kind: "starter_form", starterAssignmentId: id, formTemplateId: id } })).toBe("Start form");
 expect(fmsRecordAction({ status: "pending", target: stage })).toBe("Open work");
 expect(fmsRecordAction({ status: "waiting", target: stage })).toBe("View details");
 expect(fmsRecordAction({ status: "completed", target: stage })).toBe("View");
});
