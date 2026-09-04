import { describe, expect, it } from "vitest";

const templatesTab = () => import("@/features/taskControl/TemplatesTab?raw").then((module) => module.default);
const page = () => import("./TaskTemplatesPage?raw").then((module) => module.default);

describe("Task Control templates directory", () => {
  it("shows the reference column set and row actions", async () => {
    const source = await templatesTab();
    for (const header of [
      "User",
      "Department",
      "Task",
      "Task Type",
      "Frequency",
      "Start Date",
      "Start",
      "Due",
      "Evidence",
      "Source",
      "Status",
      "Action",
    ]) {
      expect(source).toContain(`"${header}"`);
    }
    for (const action of ["Edit", "Schedule", "Deactivate", "Delete"]) {
      expect(source).toContain(action);
    }
  });

  it("keeps every table row on a single line", async () => {
    const source = await templatesTab();

    // The four actions wrapping is what turned each row into a four-line block,
    // so the table variant must stay nowrap and the cell must shrink to content.
    expect(source).toContain('compact ? "flex-wrap" : "flex-nowrap"');
    expect(source).toContain('<td className="w-px whitespace-nowrap px-2 py-2">');
    expect(source).not.toContain('<div className="flex flex-wrap gap-1.5">');

    // Dense cells: no cell may fall back to the roomy p-3 padding.
    expect(source).not.toMatch(/<t[dh] className="[^"]*\bp-3\b/);
  });

  it("reads the directory through the audited RPC only", async () => {
    const source = await page();

    expect(source).toContain("loadTaskTemplateDirectory");
    expect(source).toContain("setTaskTemplateSchedule");
    expect(source).toContain("deleteTaskTemplate");
    expect(source).toContain("setRecurringTemplateActive");
    expect(source).toContain('const MANAGE_ROLES = ["super_admin", "admin"]');
  });
});

describe("Task Control workspace", () => {
  it("gathers progress, evidence and templates behind one shared filter", async () => {
    const source = await page();

    for (const panel of ["OverviewTab", "PeopleTab", "EvidenceTab", "TemplatesTab", "TaskControlFilterBar"]) {
      expect(source).toContain(panel);
    }
    // One snapshot call, so the progress and evidence panels can never render
    // numbers taken from two different filter states.
    expect(source).toContain("fetchTaskControlSnapshot(filters, page, pageSize)");
    expect(source).toContain("Add Task");
    expect(source).toContain("Refresh");
  });

  it("reserves the workspace for authorized leaders and templates for admins", async () => {
    const source = await page();

    expect(source).toContain('const OVERSIGHT_ROLES = ["super_admin", "admin", "manager", "hr"]');
    expect(source).toContain('tab !== "templates" || canManageTemplates');
    expect(source).toContain("Task Control is available only to authorized leaders.");
  });
});
