import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@jewelos/api-client/client", () => ({ getSupabase: () => ({ rpc }) }));
import { loadMySidebarCounts, loadMyLeaveUpdateIds, markMyLeaveUpdatesRead } from "./api";
describe("loadMySidebarCounts", () => {
  beforeEach(() => rpc.mockReset());
  it("gets exact actor-scoped counts without inbox pagination or a supplied user id", async () => {
    rpc.mockResolvedValue({ data: { checklist_tasks: 1203, notifications: 701 }, error: null });
    expect(await loadMySidebarCounts()).toEqual({ checklist_tasks: 1203, notifications: 701 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_sidebar_counts");
  });
  it("propagates authorization and transport failures instead of inventing zero counts", async () => {
    const error = new Error("Not authorized");
    rpc.mockResolvedValue({ data: null, error });
    await expect(loadMySidebarCounts()).rejects.toBe(error);
  });
  it("acknowledges only actor-owned leave updates through the Availability RPC", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    expect(await markMyLeaveUpdatesRead(["snapshot-id"], ["shown-leave"])).toBe(3);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("mark_my_leave_updates_read", { p_notification_ids: ["snapshot-id"], p_leave_ids: ["shown-leave"] });
  });
  it("captures only currently unread own status IDs before loading their content", async () => {
    rpc.mockResolvedValue({ data: ["snapshot-id"], error: null });
    expect(await loadMyLeaveUpdateIds()).toEqual(["snapshot-id"]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_leave_update_ids");
  });
});
