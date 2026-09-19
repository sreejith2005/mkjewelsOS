import { describe, expect, it } from "vitest";
import {
  formatTaskPerformanceScore,
  METRIC_CATALOG,
  recurringPerformanceScores,
  TASK_DELAYED_SCORE_LABEL,
  TASK_PENDING_SCORE_LABEL,
} from "@jewelos/core";
import { delayedScore, pendingScore, totals } from "@jewelos/data/taskControl/filters";

/**
 * Native renders the scores it is handed by the shared packages; these pin the
 * values and labels the phone shows to the same contract as web.
 */
describe("native task performance scores", () => {
  const row = { assigned: 33, completed: 2, remaining: 31, overdue: 4, on_time_completed: 1 };

  it("prints the shared pending and delayed scores", () => {
    expect(formatTaskPerformanceScore(pendingScore(row))).toBe("−93.9%");
    expect(formatTaskPerformanceScore(delayedScore(row))).toBe("−50.0%");
    expect(formatTaskPerformanceScore(delayedScore({ ...row, completed: 0, on_time_completed: 0 }))).toBe("−100.0%");
    expect(formatTaskPerformanceScore(pendingScore(totals([])))).toBe("No data");
  });

  it("uses the same labels on Task Control, Dashboard, and Recurring", () => {
    expect([TASK_PENDING_SCORE_LABEL, TASK_DELAYED_SCORE_LABEL]).toEqual(["Work not done", "Work not done on time"]);
    const dashboard = METRIC_CATALOG.filter((item) => item.format === "score").map((item) => item.displayName);
    expect(dashboard).toEqual([TASK_PENDING_SCORE_LABEL, TASK_DELAYED_SCORE_LABEL]);
    expect(
      recurringPerformanceScores({ name: "Asha", assigned: 4, completed: 3, verified: 0, onTime: 1, delayed: 2, onBehalf: 0 }),
    ).toEqual({ pending: -25, delayed: -66.7 });
  });
});
