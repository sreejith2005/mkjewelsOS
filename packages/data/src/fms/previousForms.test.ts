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
  it("keeps every earlier answer readable when one stored value is a legacy object", () => {
    const field = (key: string, type: string, value: unknown) => ({ sourceStageKey: "initial", submissionId: "s", formTemplateId: "f", formName: "Enquiry", formVersion: 1,
      value, userName: null, valueLabel: null, attachment: null, field: { key, label: key, type, sortOrder: 0, options: [] } });
    const page = parseFmsPreviousForms({ nextCursor: null, forms: [{ id: "visit", stageName: "Initial", visitNumber: 1, isInitial: true, submittedAt: null, submittedBy: null,
      fields: [field("photo", "text", { id: "x", name: "ring.jpg" }), field("tags", "multiselect", ["a", 2]), field("future", "signature_pad", "Signed")] }] });
    expect(page.forms[0]?.fields.map(item => item.value)).toEqual(["ring.jpg", ["a", "2"], "Signed"]);
    expect(page.forms[0]?.fields[2]?.field.type).toBe("text");
  });
  it("uses the exact assignment identity and a bounded page", async () => {
    rpc.mockResolvedValueOnce({ data: { forms: [], nextCursor: null }, error: null });
    await loadFmsPreviousForms("instance", "stage", "10");
    expect(rpc).toHaveBeenCalledWith("get_fms_work_form_context", { p_instance_id: "instance", p_instance_stage_id: "stage", p_offset: 10, p_limit: 10 });
    await expect(loadFmsPreviousForms("instance", "stage", "-1")).rejects.toThrow("Invalid previous-form cursor");
  });
});
