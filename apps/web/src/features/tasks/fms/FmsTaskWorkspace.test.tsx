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
it("loads exact family counts first and lazily opens stages, records and existing work", async () => {
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
 api.loadFmsTaskWorkspace.mockRejectedValueOnce(new Error("Try again"));
 render(<FmsTaskWorkspace actorId={id} tenantId={id} onNavigate={vi.fn()} onCount={vi.fn()} />);
 await screen.findByText("Try again");
 await userEvent.click(screen.getByRole("button", { name: "Retry" }));
 await waitFor(() => expect(api.loadFmsTaskWorkspace).toHaveBeenCalledTimes(2));
 expect(api.loadFmsTaskStagePage).not.toHaveBeenCalled();
});
it("preserves expanded work across realtime refreshes", async () => {
 const user = userEvent.setup();
 render(<FmsTaskWorkspace actorId={id} tenantId={id} onNavigate={vi.fn()} onCount={vi.fn()} />);
 await user.click(await screen.findByRole("button", { name: /Enquiries.*250/ }));
 await user.click(await screen.findByRole("button", { name: /Introduction Call.*250/ }));
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
 await user.click(await screen.findByRole("button", { name: /Enquiries.*250/ }));
 await user.click(await screen.findByRole("button", { name: /Introduction Call.*250/ }));
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
 await user.click(await screen.findByRole("button", { name: /Enquiries.*250/ }));
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
 await screen.findByText("No work in this stage for these filters.");
 expect(screen.queryByText("Rahul Shah")).toBeNull();
 if (order === "summary-first") await act(async () => resolvePage({ total: 250, records: [{ id, name: "Rahul Shah" }] }));
 expect(screen.queryByText("Rahul Shah")).toBeNull();
});
