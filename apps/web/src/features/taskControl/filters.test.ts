import { describe, expect, it } from "vitest";
import {
  applyBranch, applyPreset, completionRate, defaultFilters, evidenceFilter, needsAttention,
  presetRange, progressContext, rangeIsValid, totals,
} from "./filters";

const base = { ...defaultFilters("2026-03-18"), from: "2026-03-01", to: "2026-03-18" };
const person = (employee_name: string, assigned: number, completed: number, remaining: number, overdue: number) =>
  ({ employee_name, assigned, completed, remaining, overdue });

describe("task control filters", () => {
  it("derives every preset range from the tenant-local day", () => {
    expect(presetRange("today", "2026-03-18")).toEqual({ from: "2026-03-18", to: "2026-03-18" });
    expect(presetRange("last_7_days", "2026-03-18")).toEqual({ from: "2026-03-12", to: "2026-03-18" });
    expect(presetRange("last_30_days", "2026-03-18")).toEqual({ from: "2026-02-17", to: "2026-03-18" });
    expect(presetRange("this_month", "2026-03-18")).toEqual({ from: "2026-03-01", to: "2026-03-18" });
  });

  it("rewrites dates for a preset but leaves custom dates alone", () => {
    expect(applyPreset(base, "today", "2026-03-18")).toMatchObject({ preset: "today", from: "2026-03-18", to: "2026-03-18" });
    expect(applyPreset(base, "custom", "2026-03-18")).toMatchObject({ preset: "custom", from: "2026-03-01", to: "2026-03-18" });
  });

  it("clears the department when the branch changes", () => {
    expect(applyBranch({ ...base, department_id: "d1" }, "b2")).toMatchObject({ branch_id: "b2", department_id: "" });
  });

  it("projects the same scope into both server contracts", () => {
    const filters = { ...base, branch_id: "b1", user_profile_id: "u1", search: "  audit  " };
    expect(progressContext(filters)).toEqual({ from: "2026-03-01", to: "2026-03-18", branch_id: "b1", user_profile_id: "u1" });
    expect(evidenceFilter(filters, "awaiting_evidence", 2, 25)).toEqual({
      from: "2026-03-01", to: "2026-03-18", branch_id: "b1", user_profile_id: "u1",
      view: "awaiting_evidence", page: 2, page_size: 25, search: "audit",
    });
  });

  it("omits empty scope keys and an empty search rather than sending blanks", () => {
    expect(progressContext(base)).toEqual({ from: "2026-03-01", to: "2026-03-18" });
    expect(evidenceFilter({ ...base, search: "   " }, "all", 1, 10)).not.toHaveProperty("search");
  });

  it("rejects inverted and over-long ranges before the server does", () => {
    expect(rangeIsValid(base)).toBe(true);
    expect(rangeIsValid({ ...base, from: "2026-03-19" })).toBe(false);
    expect(rangeIsValid({ ...base, from: "2024-01-01" })).toBe(false);
  });

  it("summarises progress without dividing by zero", () => {
    expect(completionRate({ assigned: 0, completed: 0, remaining: 0, overdue: 0 })).toBe(0);
    expect(completionRate({ assigned: 8, completed: 6, remaining: 2, overdue: 1 })).toBe(75);
    expect(totals([person("A", 3, 1, 2, 1), person("B", 5, 5, 0, 0)])).toEqual({ assigned: 8, completed: 6, remaining: 2, overdue: 1 });
  });

  it("ranks the people who are behind, loudest signal first", () => {
    const ranked = needsAttention([
      person("Fully done", 4, 4, 0, 0),
      person("Idle", 0, 0, 0, 0),
      person("Backlog", 9, 3, 6, 0),
      person("Overdue few", 3, 1, 2, 1),
      person("Overdue many", 5, 1, 4, 3),
    ]);
    expect(ranked.map((row) => row.employee_name)).toEqual(["Overdue many", "Overdue few", "Backlog"]);
  });
});
