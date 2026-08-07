import { describe, expect, it } from "vitest";
import { calculateDelayMinutes, calculateSla } from "./sla";

describe("SLA helpers", () => {
  it("calculates signed delay minutes", () => {
    expect(calculateDelayMinutes("2026-08-07T10:00:00Z", "2026-08-07T10:17:20Z")).toBe(17);
    expect(calculateDelayMinutes("2026-08-07T10:00:00Z", "2026-08-07T09:45:00Z")).toBe(-15);
    expect(calculateDelayMinutes("2026-08-07T10:00:00Z", null)).toBeNull();
  });

  it("reports pending, overdue, and on-time states", () => {
    expect(calculateSla("2026-08-07T10:00:00Z", null, "2026-08-07T09:00:00Z")).toEqual({
      delayMinutes: null,
      slaBreached: false,
      status: "pending",
    });
    expect(calculateSla("2026-08-07T10:00:00Z", null, "2026-08-07T10:01:00Z").status).toBe("overdue");
    expect(calculateSla("2026-08-07T10:00:00Z", "2026-08-07T10:00:00Z").status).toBe("on_time");
    expect(calculateSla("2026-08-07T10:00:00Z", "2026-08-07T10:01:00Z").slaBreached).toBe(true);
  });
});
