import { expect, it } from "vitest";
import { decodeFmsWorkspace, decodeFmsStages, decodeFmsRecords, fmsWorkspaceFilter, orderFmsWorkspaceStages, type FmsStageSummary } from "./taskWorkspace";
const id = "00000000-0000-4000-8000-000000000001";
const counts = { active: 250, pending: 240, overdue: 10, waiting: 2, completed: 3 };
it("keeps exact summary totals independent of loaded families", () => {
  expect(decodeFmsWorkspace({ total: 300, activeTotal: 250, counts, families: [{ id, name: "Enquiries", count: 250 }], familyTotal: 2 }).activeTotal).toBe(250);
  expect(() => decodeFmsWorkspace({ total: 1, counts, families: [{ id: "bad", name: "Name", count: 2 }] })).toThrow();
});
it("rejects malformed stage/record identifiers and unbounded pages", () => {
  expect(() => decodeFmsStages([{ id, flowId: id, stageId: "invalid" }])).toThrow();
  expect(() => decodeFmsRecords({ records: Array(51).fill({ id }), total: 100 })).toThrow();
});
it("validates local FMS filters without accepting a caller-selected actor", () => {
  expect(fmsWorkspaceFilter({ query: " Rahul ", status: "active", from: "", to: "", familyId: "", stageId: "" })).toMatchObject({ query: "Rahul", status: "active" });
  expect(() => fmsWorkspaceFilter({ query: "", status: "active", from: "2026-02-30", to: "", familyId: "", stageId: "" })).toThrow();
});
it("orders real graph edges without merging identically named versioned stages", () => {
 const stage = (key: string, order: number, nextStageIds: string[] = [], version = 1): FmsStageSummary => ({ id: key, flowId: `flow${version}`, stageId: key, name: "Same name", order, nextStageIds, version, count: 1, pipeline: "", starting: false });
 const rows = [stage("a", 0, ["c"]), stage("b", 1), stage("c", 2, ["b"]), stage("older", 0, [], 0)];
 expect(orderFmsWorkspaceStages(rows).map(s => s.id)).toEqual(["a", "c", "b", "older"]);
});
