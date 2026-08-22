import { describe, expect, it } from "vitest";
import { parseRecurringWorkspace } from "./model";

describe("parseRecurringWorkspace", () => {
  it("accepts the database workspace envelope", () => {
    expect(parseRecurringWorkspace({ templates: [], instances: [], stats: { total: 0 } }).stats.total).toBe(0);
  });

  it("rejects malformed envelopes", () => {
    expect(() => parseRecurringWorkspace({ templates: "no" })).toThrow("Recurring workspace response is invalid");
  });
});
