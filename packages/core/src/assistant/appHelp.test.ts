import { describe, expect, it } from "vitest";
import { IMPLEMENTED_PAGE_IDS, getPageForPath } from "../roleMenu";
import { APP_HELP, getAppHelp } from "./appHelp";

describe("app help", () => {
  it("explains the exact naming controls and revision rule for form and FMS authors", () => {
    expect(JSON.stringify(APP_HELP.forms_library)).toContain("Use this question as the record name");
    expect(JSON.stringify(APP_HELP.forms_library)).toContain("new revision");
    expect(JSON.stringify(APP_HELP.fms_builder)).toContain("Task Naming");
    expect(JSON.stringify(APP_HELP.fms_builder)).toContain("Task name from");
  });
  it("explains the assigned FMS hierarchy without widening employee access", () => {
    const text = JSON.stringify(APP_HELP.checklist_tasks);
    expect(text).toContain("FMS subsection");
    expect(text).toContain("workflow family");
    expect(text).toContain("Waiting");
    expect(text).not.toContain("My Tasks lists recurring and FMS work");
  });
  it("covers every implemented page", () => {
    const missing = IMPLEMENTED_PAGE_IDS.filter((page) => !APP_HELP[page]);
    expect(missing).toEqual([]);
  });

  it("points each entry at a path that opens its own section", () => {
    for (const page of IMPLEMENTED_PAGE_IDS) {
      const entry = APP_HELP[page]!;
      expect(entry.section).toBe(page);
      expect(entry.recipes.length).toBeGreaterThan(0);
      // Assigned FMS work is authorized as Tasks (roleMenu.getPageForPath).
      expect(getPageForPath(entry.path)).toBe(page === "fms_tasks" ? "checklist_tasks" : page);
    }
  });

  it("adds the shared note and returns null for pages without help", () => {
    expect(getAppHelp("availability")?.note).toMatch(/role may not have that action/);
    expect(getAppHelp("meeting_ai")).toBeNull();
  });
});
