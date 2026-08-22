import { describe, expect, it } from "vitest";
import {
  classifyCoverageWindow,
  resolveTaskCoverage,
  type TaskCoverageProfile,
} from "./taskCoverage";

const original: TaskCoverageProfile = {
  id: "original",
  week_off: ["Sunday"],
  working_status: "active",
};
const primary: TaskCoverageProfile = { ...original, id: "primary" };
const secondary: TaskCoverageProfile = { ...original, id: "secondary" };
const manager: TaskCoverageProfile = { ...original, id: "manager" };
const targetDate = "2026-08-22";

describe("task coverage resolution", () => {
  it("keeps work with the original employee when available", () => {
    expect(resolveTaskCoverage({
      availabilityByUser: new Map(),
      manager,
      original,
      primary,
      secondary,
      targetDate,
    })).toEqual({
      effectiveAssigneeId: "original",
      originalAssigneeId: "original",
      resolution: "original",
    });
  });

  it("uses the primary buddy when the original employee is absent", () => {
    expect(resolveTaskCoverage({
      availabilityByUser: new Map([["original", "absent"]]),
      manager,
      original,
      primary,
      secondary,
      targetDate,
    }).resolution).toBe("primary_buddy");
  });

  it("uses the secondary buddy when the original and primary are unavailable", () => {
    expect(resolveTaskCoverage({
      availabilityByUser: new Map([["original", "absent"], ["primary", "absent"]]),
      manager,
      original,
      primary,
      secondary,
      targetDate,
    })).toMatchObject({ effectiveAssigneeId: "secondary", resolution: "secondary_buddy" });
  });

  it("uses the reporting manager after both buddies", () => {
    expect(resolveTaskCoverage({
      availabilityByUser: new Map([["original", "absent"], ["primary", "absent"], ["secondary", "absent"]]),
      manager,
      original,
      primary,
      secondary,
      targetDate,
    }).resolution).toBe("reporting_manager");
  });

  it("requires coverage when every distinct candidate is unavailable", () => {
    expect(resolveTaskCoverage({
      availabilityByUser: new Map([["original", "absent"], ["primary", "absent"], ["secondary", "absent"], ["manager", "absent"]]),
      manager,
      original,
      primary,
      secondary,
      targetDate,
    })).toEqual({
      effectiveAssigneeId: null,
      originalAssigneeId: "original",
      resolution: "coverage_required",
    });
  });

  it("skips duplicate fallback candidates", () => {
    expect(resolveTaskCoverage({
      availabilityByUser: new Map([["original", "absent"], ["primary", "absent"]]),
      manager,
      original,
      primary,
      secondary: primary,
      targetDate,
    }).resolution).toBe("reporting_manager");
  });

  it("treats remote and half-day employees as available", () => {
    for (const status of ["remote", "half_day"]) {
      expect(resolveTaskCoverage({
        availabilityByUser: new Map([["original", status]]),
        original,
        targetDate,
      }).resolution).toBe("original");
    }
  });
});

describe("short-deadline coverage window", () => {
  const now = new Date("2026-08-21T20:00:00.000Z"); // 22 Aug in Kolkata

  it("moves pending work due today or tomorrow in Kolkata", () => {
    expect(classifyCoverageWindow("2026-08-22T18:00:00+05:30", "pending", now)).toBe("move");
    expect(classifyCoverageWindow("2026-08-23T18:00:00+05:30", "assigned", now)).toBe("move");
  });

  it("flags in-progress short-deadline work for manager review", () => {
    expect(classifyCoverageWindow("2026-08-23T10:00:00+05:30", "in_progress", now)).toBe("review");
  });

  it("ignores completed and later-dated work", () => {
    expect(classifyCoverageWindow("2026-08-22T10:00:00+05:30", "completed", now)).toBe("ignore");
    expect(classifyCoverageWindow("2026-08-24T10:00:00+05:30", "pending", now)).toBe("ignore");
  });
});
