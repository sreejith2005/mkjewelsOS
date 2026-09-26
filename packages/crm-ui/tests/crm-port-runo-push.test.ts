// crm-port addition (no original counterpart): the original POSTed to /api/leads/<id>/runo;
// the port invokes the crm-runo-push Edge Function. `ok` must stay the route's ok, because the
// original lead form chooses its message from it.
import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/crm-port/runtime", () => ({ crmHost: () => ({ supabase: { functions: { invoke } } }) }));
import { pushLeadToRuno } from "@/crm-port/phase4";

afterEach(() => vi.resetAllMocks());

describe("pushLeadToRuno", () => {
  it("invokes crm-runo-push with the lead id in the body and reports success", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(pushLeadToRuno("lead-1")).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("crm-runo-push", { body: { leadId: "lead-1" } });
  });

  it("reports not ok when the function answers with an error status", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("Edge Function returned a non-2xx status code") });
    await expect(pushLeadToRuno("lead-1")).resolves.toEqual({ ok: false });
  });

  it("reports not ok, never throws, when the call itself fails", async () => {
    invoke.mockRejectedValue(new Error("network"));
    await expect(pushLeadToRuno("lead-1")).resolves.toEqual({ ok: false });
  });
});
