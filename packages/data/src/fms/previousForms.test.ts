import { describe, expect, it, vi } from "vitest";
import { loadFmsPreviousForms, parseFmsPreviousForms } from "./work";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@jewelos/api-client/client", () => ({ getSupabase: () => ({ rpc }) }));
describe("previous FMS form reads", () => {
  it("validates grouped form metadata and refuses malformed responses", () => {
    const page = { forms: [{ id: "visit", stageName: "Initial", visitNumber: 1, isInitial: true, submittedAt: null, submittedBy: "Employee A", fields: [] }], nextCursor: null };
    expect(parseFmsPreviousForms(page).forms[0]?.submittedBy).toBe("Employee A");
    expect(() => parseFmsPreviousForms({ ...page, forms: [{ ...page.forms[0], fields: [null] }] })).toThrow("invalid response");
  });
  it("uses the exact assignment identity and a bounded page", async () => {
    rpc.mockResolvedValueOnce({ data: { forms: [], nextCursor: null }, error: null });
    await loadFmsPreviousForms("instance", "stage", "10");
    expect(rpc).toHaveBeenCalledWith("get_fms_work_form_context", { p_instance_id: "instance", p_instance_stage_id: "stage", p_offset: 10, p_limit: 10 });
    await expect(loadFmsPreviousForms("instance", "stage", "-1")).rejects.toThrow("Invalid previous-form cursor");
  });
});
