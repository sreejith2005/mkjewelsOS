import { describe, expect, it } from "vitest";
import { fmsLogActionLabel, fmsLogDetailLines } from "./logPresentation";

const person = "00000000-0000-4000-8000-000000000001";
const stranger = "00000000-0000-4000-8000-000000000002";

describe("FMS history entries", () => {
  it("keeps readable fields, names people and drops identifiers", () => {
    const lines = fmsLogDetailLines({ reason: "Client asked to reschedule", to: person, from: stranger, form_submission_id: stranger, stage_id: stranger,
      guard: "x", nested: { secret: true }, status: "in_review", activated: true }, new Map([[person, "Employee A"]]));
    expect(lines).toEqual([
      { label: "Reason", value: "Client asked to reschedule" },
      { label: "To", value: "Employee A" },
      { label: "Status", value: "Waiting for approval" },
      { label: "Activated", value: "Yes" },
    ]);
    expect(JSON.stringify(lines)).not.toContain(stranger);
  });

  it("ignores missing or non-object details", () => {
    expect(fmsLogDetailLines(null)).toEqual([]);
    expect(fmsLogDetailLines(["a"])).toEqual([]);
    expect(fmsLogDetailLines("text")).toEqual([]);
  });

  it("words action codes for employees", () => {
    expect(fmsLogActionLabel("stage_completed")).toBe("Stage completed");
    expect(fmsLogActionLabel("")).toBe("Update");
  });
});
