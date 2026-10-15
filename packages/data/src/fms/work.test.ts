import { describe, expect, it } from "vitest";
import { parseFmsWorkPreview, parseFmsWorkResult, fmsWorkJson } from "./work";

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
  it("converts readonly form arrays to checked RPC JSON and rejects non-JSON values", () => {
    expect(fmsWorkJson({ answers: { options: ["a", "b"] }, omitted: undefined })).toEqual({ answers: { options: ["a", "b"] } });
    expect(() => fmsWorkJson({ unsafe: Number.NaN })).toThrow();
  });
});
