import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@jewelos/api-client/client", () => ({ getSupabase: () => ({ rpc: mocks.rpc }) }));
import { deleteLeaveRequests } from "./api";
beforeEach(() => mocks.rpc.mockReset());

it("uses the same audited batch contract for one or many leave requests", async () => {
  mocks.rpc.mockResolvedValue({ data: 2, error: null });
  expect(await deleteLeaveRequests(["first", "second"])).toBe(2);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("delete_leave_requests_with_audit", { p_ids: ["first", "second"] });
});

it("surfaces server denial instead of reporting a successful deletion", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "Leave deletion denied" } });
  await expect(deleteLeaveRequests(["first"])).rejects.toThrow("Delete leave requests: Leave deletion denied");
});

it("fails if the server omits the deletion result", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  await expect(deleteLeaveRequests(["first"])).rejects.toThrow("Leave deletion did not return a result");
});
