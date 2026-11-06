import { describe, expect, it } from "vitest";
import { formatTaskPerformanceScore } from "../taskControlView.ts";
import {
  completionSegments,
  decodePerformanceSearch,
  encodePerformanceSearch,
  parsePerformanceFilter,
  parsePerformancePayload,
  performanceAttentionOrder,
  performanceContext,
  performancePeriodRange,
  performanceReconciles,
  performanceScores,
  timingSegments,
  weekStart,
  type PerformanceCounts,
} from "./taskPerformance.ts";

const counts = (over: Partial<PerformanceCounts>): PerformanceCounts => ({
  assigned: 0, on_time: 0, late: 0, completed_untimed: 0, pending: 0, in_progress: 0, overdue: 0, ...over,
});

describe("performance scores use Task Control's formulas", () => {
  it("100 assigned, 75 completed -> Work Not Done -25.0%", () => {
    const row = counts({ assigned: 100, on_time: 75, pending: 25 });
    expect(performanceScores(row).pendingScore).toBe(-25);
    expect(formatTaskPerformanceScore(performanceScores(row).pendingScore)).toBe("−25.0%");
  });

  it("50 completed, 40 on time -> Work Not Done On Time -20.0%", () => {
    const row = counts({ assigned: 50, on_time: 40, late: 10 });
    expect(performanceScores(row).delayedScore).toBe(-20);
  });

  it("zero assigned is No data for both scores", () => {
    const scores = performanceScores(counts({}));
    expect(scores.pendingScore).toBeNull();
    expect(scores.delayedScore).toBeNull();
    expect(formatTaskPerformanceScore(scores.pendingScore)).toBe("No data");
  });

  it("assigned but nothing completed keeps Task Control's -100 delayed score", () => {
    const scores = performanceScores(counts({ assigned: 33, overdue: 33 }));
    expect(scores.pendingScore).toBe(-100);
    expect(scores.delayedScore).toBe(-100);
  });

  it("a completion with no recorded time is completed but never on time", () => {
    const scores = performanceScores(counts({ assigned: 4, on_time: 1, completed_untimed: 1, overdue: 2 }));
    expect(scores.completed).toBe(2);
    expect(scores.pendingScore).toBe(-50);
    expect(scores.delayedScore).toBe(-50);
  });

  it("does not use the screenshot's pending / total x -100 formula", () => {
    // 10 assigned, 4 completed, 2 pending, 4 overdue: pending/total*-100 would read -20%.
    expect(performanceScores(counts({ assigned: 10, on_time: 4, pending: 2, overdue: 4 })).pendingScore).toBe(-60);
  });
});

describe("reconciliation", () => {
  it("every assignment is in exactly one bucket", () => {
    expect(performanceReconciles(counts({ assigned: 7, on_time: 1, late: 1, completed_untimed: 1, pending: 1, in_progress: 1, overdue: 2 }))).toBe(true);
    expect(performanceReconciles(counts({ assigned: 8, on_time: 1 }))).toBe(false);
  });

  it("donut segments add up to the centre total", () => {
    const row = counts({ assigned: 9, on_time: 2, late: 1, completed_untimed: 1, pending: 2, in_progress: 1, overdue: 2 });
    expect(completionSegments(row).reduce((sum, s) => sum + s.value, 0)).toBe(row.assigned);
    expect(timingSegments(row).reduce((sum, s) => sum + s.value, 0)).toBe(4);
    expect(timingSegments(counts({ assigned: 1, on_time: 1 })).map((s) => s.key)).toEqual(["on_time", "late"]);
  });

  it("orders people by overdue, then backlog, then the worse score", () => {
    const ordered = performanceAttentionOrder([
      { employee_name: "Clear", ...counts({ assigned: 2, on_time: 2 }) },
      { employee_name: "Overdue", ...counts({ assigned: 2, overdue: 1, on_time: 1 }) },
      { employee_name: "Backlog", ...counts({ assigned: 3, pending: 3 }) },
    ]);
    expect(ordered.map((r) => r.employee_name)).toEqual(["Overdue", "Backlog", "Clear"]);
  });
});

describe("periods in India time", () => {
  it("this week starts on Monday and ends today", () => {
    expect(performancePeriodRange("this_week", undefined, "2026-11-05")).toEqual({ from: "2026-11-02", to: "2026-11-05" });
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
  });

  it("a chosen week, month or year covers all of it", () => {
    expect(performancePeriodRange("week", "2026-11-05", "2026-11-05")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(performancePeriodRange("month", "2024-02", "2026-11-05")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(performancePeriodRange("year", "2025", "2026-11-05")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("rejects periods longer than 366 days", () => {
    expect(() => parsePerformanceFilter({ period: "custom", from: "2025-01-01", to: "2026-06-01" }, "2026-11-05")).toThrow("366");
  });
});

describe("filters and links", () => {
  it("personal scope never sends another person, branch or department", () => {
    const filter = parsePerformanceFilter({ scope: "me", period: "today", from: "2026-11-05", to: "2026-11-05", user_profile_id: "43820000-0000-0000-0000-000000000004", branch_id: "23820000-0000-0000-0000-000000000001" });
    expect(performanceContext(filter)).toEqual({ scope: "me", from: "2026-11-05", to: "2026-11-05" });
  });

  it("round-trips a team link and keeps only valid identifiers", () => {
    const filter = parsePerformanceFilter({ scope: "team", period: "month", from: "2026-10-01", to: "2026-10-31", flow_id: "63820000-0000-0000-0000-0000000000ff", kind: "fms" });
    expect(decodePerformanceSearch(encodePerformanceSearch(filter), true, "2026-11-05")).toEqual(filter);
    expect(() => parsePerformanceFilter({ scope: "team", branch_id: "not-a-uuid" })).toThrow();
  });

  it("a team link opened without the permission falls back to personal", () => {
    expect(decodePerformanceSearch("scope=team&period=today", false, "2026-11-05").scope).toBe("me");
    expect(decodePerformanceSearch("", true, "2026-11-05").scope).toBe("team");
  });
});

describe("response validation", () => {
  it("rejects a response with missing counts instead of drawing zeros", () => {
    expect(() => parsePerformancePayload({ version: 1, generatedAt: "x", timezone: "Asia/Kolkata", from: "a", to: "b", granularity: "day", summary: { assigned: 1 } })).toThrow();
  });
});
