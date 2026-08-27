import { describe, expect, it, vi } from "vitest";

vi.mock("@jewelos/api-client", () => ({ supabase: {} }));

import { taskFeedCurrentOrOverdueFilter, taskFeedIdBatches } from "./api";

describe("task feed effective-deadline scope", () => {
  it("requests today plus only unfinished historical effective deadlines", () => {
    expect(taskFeedCurrentOrOverdueFilter("2026-08-27T00:00:00.000+05:30", "2026-08-27T23:59:59.999+05:30")).toBe(
      "and(revised_datetime.gte.2026-08-27T00:00:00.000+05:30,revised_datetime.lte.2026-08-27T23:59:59.999+05:30),and(revised_datetime.is.null,due_datetime.gte.2026-08-27T00:00:00.000+05:30,due_datetime.lte.2026-08-27T23:59:59.999+05:30),and(revised_datetime.is.null,due_datetime.is.null,planned_datetime.gte.2026-08-27T00:00:00.000+05:30,planned_datetime.lte.2026-08-27T23:59:59.999+05:30),and(revised_datetime.lt.2026-08-27T00:00:00.000+05:30,status.not.in.(completed,rejected,blocked)),and(revised_datetime.is.null,due_datetime.lt.2026-08-27T00:00:00.000+05:30,status.not.in.(completed,rejected,blocked)),and(revised_datetime.is.null,due_datetime.is.null,planned_datetime.lt.2026-08-27T00:00:00.000+05:30,status.not.in.(completed,rejected,blocked))",
    );
  });

  it("batches task identifiers before requesting detailed assignee rows", () => {
    expect(taskFeedIdBatches(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });
});
