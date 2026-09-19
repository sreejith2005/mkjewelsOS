import { describe, expect, it } from "vitest";
import {
  canManageTaskTemplates,
  canSelectTaskControlBranch,
  canViewTaskControl,
  evidenceCellState,
  evidenceFileSize,
  prettyTemplateDate,
  prettyTemplateTime,
  taskControlShowsSearch,
  taskDelayedScore,
  taskPendingScore,
  formatTaskPerformanceScore,
  taskControlTabsFor,
  taskRowTone,
  TASK_VIEW_LABELS,
} from "./taskControlView.ts";

describe("task performance scores", () => {
  it("calculates pending and delayed negative scores with the approved zero-work rules", () => {
    expect(taskPendingScore({ assigned: 100, completed: 75, remaining: 25, overdue: 0, onTimeCompleted: 25 })).toBe(-25);
    expect(taskPendingScore({ assigned: 33, completed: 2, remaining: 31, overdue: 0, onTimeCompleted: 0 })).toBe(-93.9);
    expect(taskDelayedScore({ assigned: 100, completed: 75, remaining: 25, overdue: 0, onTimeCompleted: 25 })).toBe(-66.7);
    expect(taskDelayedScore({ assigned: 33, completed: 0, remaining: 33, overdue: 0, onTimeCompleted: 0 })).toBe(-100);
    expect(taskPendingScore({ assigned: 0, completed: 0, remaining: 0, overdue: 0, onTimeCompleted: 0 })).toBeNull();
    expect(formatTaskPerformanceScore(-93.9)).toBe("−93.9%");
    expect(formatTaskPerformanceScore(null)).toBe("No data");
  });

  it("rounds halves away from zero like the database and never prints a plus sign", () => {
    // 7 of 8 on time is -12.5; 1 of 16 complete is -93.75 -> -93.8 (Postgres round()).
    expect(taskDelayedScore({ assigned: 8, completed: 8, onTimeCompleted: 7 })).toBe(-12.5);
    expect(taskPendingScore({ assigned: 16, completed: 1, onTimeCompleted: 1 })).toBe(-93.8);
    expect(taskPendingScore({ assigned: 4, completed: 4, onTimeCompleted: 4 })).toBe(0);
    expect(formatTaskPerformanceScore(0)).toBe("−0.0%");
    expect(formatTaskPerformanceScore(undefined)).toBe("No data");
    expect(formatTaskPerformanceScore(Number.NaN)).toBe("No data");
  });
});

describe("task control access", () => {
  it("opens for leaders only", () => {
    for (const role of ["super_admin", "admin", "manager", "hr"]) expect(canViewTaskControl(role)).toBe(true);
    for (const role of ["staff", "", "sales"]) expect(canViewTaskControl(role)).toBe(false);
  });

  it("limits template management to super admin and admin", () => {
    expect(canManageTaskTemplates("super_admin")).toBe(true);
    expect(canManageTaskTemplates("admin")).toBe(true);
    expect(canManageTaskTemplates("manager")).toBe(false);
    expect(canManageTaskTemplates("hr")).toBe(false);
  });

  // A manager is pinned to their own branch by the server, so offering the
  // control would present a scope the RPC rejects.
  it("hides the branch control from a manager", () => {
    expect(canSelectTaskControlBranch("hr")).toBe(true);
    expect(canSelectTaskControlBranch("manager")).toBe(false);
  });

  it("drops the Templates tab for a role that cannot manage them", () => {
    expect(taskControlTabsFor("admin")).toEqual(["overview", "people", "tasks", "templates"]);
    expect(taskControlTabsFor("manager")).toEqual(["overview", "people", "tasks"]);
  });

  it("shows the search box only where the server searches", () => {
    expect(taskControlShowsSearch("tasks")).toBe(true);
    expect(taskControlShowsSearch("templates")).toBe(true);
    expect(taskControlShowsSearch("overview")).toBe(false);
    expect(taskControlShowsSearch("people")).toBe(false);
  });

  it("keeps the seven view chips in the web page's order", () => {
    expect(TASK_VIEW_LABELS.map(([value]) => value)).toEqual([
      "all", "remaining", "overdue", "completed", "checklist", "upload", "awaiting_evidence",
    ]);
  });
});

describe("evidenceFileSize", () => {
  it("prints bytes, kilobytes and megabytes as web does", () => {
    expect(evidenceFileSize(null)).toBe("—");
    expect(evidenceFileSize(512)).toBe("512 B");
    expect(evidenceFileSize(2048)).toBe("2 KB");
    expect(evidenceFileSize(5_242_880)).toBe("5.0 MB");
  });
});

describe("template date and time labels", () => {
  // The month abbreviation comes from ICU, which differs between Node ("Sept")
  // and Hermes, so the shape is asserted rather than one runtime's spelling.
  it("formats a start date in the tenant calendar", () => {
    expect(prettyTemplateDate("2026-09-12")).toMatch(/^12 Sep\w* 2026$/);
    expect(prettyTemplateDate("2026-01-05")).toMatch(/^05 Jan\w* 2026$/);
    expect(prettyTemplateDate(null)).toBe("—");
    expect(prettyTemplateDate("not-a-date")).toBe("not-a-date");
  });

  it("formats a clock time as 12-hour", () => {
    expect(prettyTemplateTime("09:30")).toBe("09:30 AM");
    expect(prettyTemplateTime("00:05")).toBe("12:05 AM");
    expect(prettyTemplateTime("12:00")).toBe("12:00 PM");
    expect(prettyTemplateTime("18:45")).toBe("06:45 PM");
    expect(prettyTemplateTime(null)).toBe("—");
  });
});

describe("taskRowTone", () => {
  it("ranks completed and rejected above being late", () => {
    expect(taskRowTone({ task_status: "completed", overdue: true })).toBe("success");
    expect(taskRowTone({ task_status: "rejected", overdue: false })).toBe("danger");
    expect(taskRowTone({ task_status: "pending", overdue: true })).toBe("danger");
    expect(taskRowTone({ task_status: "pending", overdue: false })).toBe("warning");
  });
});

describe("evidenceCellState", () => {
  it("separates files, a missing required file, and nothing required", () => {
    expect(evidenceCellState({ attachments: [{}], requires_upload: true })).toBe("files");
    expect(evidenceCellState({ attachments: [], requires_upload: true })).toBe("missing");
    expect(evidenceCellState({ attachments: [], requires_upload: false })).toBe("not-required");
  });
});
