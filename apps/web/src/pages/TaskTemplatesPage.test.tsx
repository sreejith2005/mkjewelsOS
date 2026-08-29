import { describe, expect, it } from "vitest";

describe("Task Templates directory", () => {
  it("shows the reference column set and row actions", async () => {
    const source = await import("./TaskTemplatesPage?raw").then((module) => module.default);
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
    for (const action of ["Edit", "Schedule", "Deactivate", "Delete", "Add Task", "Refresh", "Reset"]) {
      expect(source).toContain(action);
    }
    expect(source).toContain("All Departments");
    expect(source).toContain("All Users");
  });

  it("keeps every table row on a single line", async () => {
    const source = await import("./TaskTemplatesPage?raw").then((module) => module.default);

    // The four actions wrapping is what turned each row into a four-line block,
    // so the table variant must stay nowrap and the cell must shrink to content.
    expect(source).toContain('compact ? "flex-wrap" : "flex-nowrap"');
    expect(source).toContain('<td className="w-px whitespace-nowrap px-2 py-2">');
    expect(source).not.toContain('<div className="flex flex-wrap gap-1.5">');

    // Dense cells: no cell may fall back to the roomy p-3 padding.
    expect(source).not.toMatch(/<t[dh] className="[^"]*\bp-3\b/);
  });

  it("reads the directory through the audited RPC only", async () => {
    const source = await import("./TaskTemplatesPage?raw").then((module) => module.default);

    expect(source).toContain("loadTaskTemplateDirectory");
    expect(source).toContain("setTaskTemplateSchedule");
    expect(source).toContain("deleteTaskTemplate");
    expect(source).toContain("setRecurringTemplateActive");
    expect(source).toContain('["super_admin", "admin"].includes(profile.user_role)');
  });
});
