import { describe, expect, it } from "vitest";
import { parseFmsWorkPreview, parseFmsWorkResult, fmsWorkJson, reportFmsWorkFailure, type FmsDiagnosticEventClient } from "./work";

const id = "00000000-0000-4000-8000-000000000001";
const destination = { targetStageId: id, stageName: "Demo", formTemplateId: null, selectedUserId: id,
  effectiveUserId: id, employeeName: "Employee C", assignmentMethod: "previous_form", locked: false, allowHandoff: true, issue: null };
describe("FMS work protocol", () => {
  it("parses the validated preview without assuming progression", () => {
    expect(parseFmsWorkPreview({ fingerprint: "request", currentStageName: "Call", wouldDefer: true,
      requirements: ["Required evidence is missing"], destinations: [destination] }).wouldDefer).toBe(true);
  });
  it.each([null, {}, { fingerprint: "x", destinations: [{ ...destination, locked: "false" }] }])("rejects malformed preview %j", raw => {
    expect(() => parseFmsWorkPreview(raw)).toThrow("invalid response");
  });
  it("accepts only known durable result states and canonical work targets", () => {
    const result = { state: "successors_activated", submissionId: id, instanceId: id, sourceInstanceStageId: id,
      referenceNumber: "FMS-TEST", destinations: [destination], ownWorkTargets: [{ kind: "stage", instanceId: id, instanceStageId: id }] };
    expect(parseFmsWorkResult(result).ownWorkTargets[0]?.kind).toBe("stage");
    expect(() => parseFmsWorkResult({ ...result, state: "pretend_success" })).toThrow("invalid response");
  });
  it("reports a failed step transition once, with only the step, SQLSTATE and a correlation id", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const client: FmsDiagnosticEventClient = { rpc: (fn, args) => { calls.push([fn, { ...args }]); return Promise.resolve({ data: null, error: null }); } };
    await reportFmsWorkFailure({ kind: "stage_form", instanceStageId: id, formTemplateId: id, answers: { secret: "do not send" }, outcome: "", remark: "private remark", checklist: {} }, "P0001", client);
    await reportFmsWorkFailure({ kind: "review", instanceStageId: id, decision: "approved", remark: "" }, "not a code", client);
    await reportFmsWorkFailure({ kind: "starter_form", starterAssignmentId: id, formTemplateId: id, answers: {} }, "P0001", client);
    expect(calls).toHaveLength(2);
    expect(Object.keys(calls[0]![1]).sort()).toEqual(["p_correlation_id", "p_instance_stage_id", "p_operation", "p_sqlstate"]);
    expect(calls[0]![1]).toMatchObject({ p_operation: "fms_stage_transition", p_instance_stage_id: id, p_sqlstate: "P0001" });
    expect(JSON.stringify(calls)).not.toContain("private remark");
    expect(JSON.stringify(calls)).not.toContain("do not send");
    expect(calls[1]![1]).toMatchObject({ p_operation: "fms_stage_review", p_sqlstate: null });
  });
  it("never lets a failing diagnostic call affect the caller", async () => {
    const client: FmsDiagnosticEventClient = { rpc: () => Promise.reject(new Error("offline")) };
    await expect(reportFmsWorkFailure({ kind: "complete", instanceStageId: id, outcome: "", remark: "", checklist: {} }, "42501", client)).resolves.toBeUndefined();
  });
  it("converts readonly form arrays to checked RPC JSON and rejects non-JSON values", () => {
    expect(fmsWorkJson({ answers: { options: ["a", "b"] }, omitted: undefined })).toEqual({ answers: { options: ["a", "b"] } });
    expect(() => fmsWorkJson({ unsafe: Number.NaN })).toThrow();
  });
});
