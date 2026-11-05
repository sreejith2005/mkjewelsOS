import { describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@jewelos/api-client", () => ({ supabase: { rpc } }));

import { loadCrmClientRuns, parseCrmClientRuns } from "./crmClientRuns";

describe("CRM client FMS runs (0378)", () => {
  it("keeps the run, its open steps and assignee names, and drops malformed entries", () => {
    expect(parseCrmClientRuns([
      { instanceId: "i1", referenceNumber: "FMS-1", title: "Asha", status: "active", workflowName: "Not Bought", sourceType: "crm_walkin", crmCaseId: "c1", caseOpen: true, startedAt: "2026-11-04T05:00:00Z", completedAt: null,
        openSteps: [{ instanceStageId: "s1", stageName: "Follow-up", status: "pending", visitNumber: 2, dueAt: "2026-11-04T15:30:00Z", assignees: ["Neel", 7] }] },
      "not a run", { title: "no id" },
    ])).toEqual([{ instanceId: "i1", referenceNumber: "FMS-1", title: "Asha", status: "active", workflowName: "Not Bought", sourceType: "crm_walkin", crmCaseId: "c1", caseOpen: true, startedAt: "2026-11-04T05:00:00Z", completedAt: null,
      openSteps: [{ instanceStageId: "s1", stageName: "Follow-up", status: "pending", visitNumber: 2, dueAt: "2026-11-04T15:30:00Z", assignees: ["Neel"] }] }]);
  });
  it("refuses a response that is not a list", () => {
    expect(() => parseCrmClientRuns({ rows: [] })).toThrow();
  });
  it("reads as the signed-in person and surfaces a refusal", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(loadCrmClientRuns("client-1")).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledWith("get_crm_client_fms_runs", { p_crm_client_id: "client-1" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "CRM access required" } });
    await expect(loadCrmClientRuns("client-1")).rejects.toThrow("CRM access required");
  });
});
