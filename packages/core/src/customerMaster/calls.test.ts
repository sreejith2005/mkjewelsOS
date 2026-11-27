import { describe, expect, it } from "vitest";
import { callDurationLabel, callPartsLabel, callSummary } from "./calls";

describe("Runo call labels", () => {
  it("says which parts a call has", () => {
    expect(callPartsLabel({ call: { duration_seconds: 5 }, has_interaction_form: true })).toBe("Call log + interaction form");
    expect(callPartsLabel({ call: { duration_seconds: 5 }, has_interaction_form: false })).toContain("Call log only");
    expect(callPartsLabel({ has_interaction_form: true })).toBeNull();
  });
  it("formats the duration and the summary", () => {
    expect(callDurationLabel(95)).toBe("1 min 35 s");
    expect(callDurationLabel(120)).toBe("2 min");
    expect(callDurationLabel(0)).toBe("0 s");
    expect(callDurationLabel(undefined)).toBeNull();
    expect(callSummary({ type: "Outgoing", duration_seconds: 95, tag: "Connected" })).toBe("Outgoing · 1 min 35 s · Connected");
    expect(callSummary({})).toBeNull();
  });
});
