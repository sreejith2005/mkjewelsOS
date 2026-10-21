import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ contexts: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@jewelos/api-client/client", () => ({ getSupabase: () => ({ rpc: state.rpc, from: state.from }) }));
vi.mock("../fms/work", () => ({ loadFmsTaskContexts: state.contexts }));
import { fetchHomeSummary } from "./api";
it("batch-hydrates the same authorized record name on the existing Home entry", async () => {
 // Starter rows come from a separate RPC, not get_home_summary.
 state.rpc.mockImplementation(async (name: string) => ({ data: name === "get_home_summary" ? { fms_stages: [{ stage_id: "visit", instance_id: "instance" }] } : [], error: null }));
 state.from.mockImplementation((table: string) => ({ select: () => ({ in: async () => ({ data: table === "fms_instance_stages" ? [{ id: "visit", fms_stage_id: "definition" }] : table === "fms_stages" ? [{ id: "definition", form_template_id: null }] : [], error: null }) }) }));
 state.contexts.mockResolvedValue(new Map([["visit", { recordName: "Rahul Shah", workflowName: "Enquiries", stageName: "Call", reference: "FMS-1", titleTemplate: "", receivedFields: [], journey: [], instructions: "", expectedResult: "", dueAt: null, assignedNames: [], shortDescription: "", dueLabel: "", nextCursor: null }]]));
 expect((await fetchHomeSummary()).fms_stages[0]?.record_name).toBe("Rahul Shah");
 expect(state.contexts).toHaveBeenCalledWith(["visit"]);
});
