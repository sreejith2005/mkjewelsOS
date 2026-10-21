import { beforeEach, expect, it, vi } from "vitest";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@jewelos/api-client/client", () => ({ getSupabase: () => ({ rpc }) }));
import { loadFmsTaskWorkspace, loadFmsTaskStages, loadFmsTaskStagePage } from "./taskWorkspace";
import { defaultFmsWorkspaceFilters } from "@jewelos/core";
beforeEach(() => rpc.mockReset());
it("requests summary counts without hydrating records or choosing an actor", async () => {
 rpc.mockResolvedValue({ data: { total: 250, activeTotal: 250, familyTotal: 0, families: [], counts: { active: 250, pending: 200, overdue: 50, waiting: 0, completed: 0 } }, error: null });
 expect((await loadFmsTaskWorkspace(defaultFmsWorkspaceFilters())).total).toBe(250);
 expect(rpc).toHaveBeenCalledWith("get_fms_task_workspace", { p_filter: defaultFmsWorkspaceFilters(), p_offset: 0, p_limit: 50 });
});
it("rejects malformed responses and surfaces retryable errors", async () => {
 rpc.mockResolvedValueOnce({ data: {}, error: null });
 await expect(loadFmsTaskWorkspace(defaultFmsWorkspaceFilters())).rejects.toThrow();
 rpc.mockResolvedValue({ data: null, error: { message: "Unavailable" } });
 await expect(loadFmsTaskStages("family", defaultFmsWorkspaceFilters())).rejects.toThrow("Unavailable");
});
it("loads only the exact expanded published stage and bounded page", async () => {
 rpc.mockResolvedValue({ data: { records: [], total: 250 }, error: null });
 await loadFmsTaskStagePage({ familyId: "family", flowId: "flow", stageId: "stage", starting: false }, defaultFmsWorkspaceFilters(), 50);
 expect(rpc).toHaveBeenCalledWith("get_fms_task_stage_page", expect.objectContaining({ p_family_id: "family", p_flow_id: "flow", p_stage_id: "stage", p_offset: 50, p_limit: 50 }));
});
