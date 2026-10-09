import { describe, expect, it } from "vitest";
import { IMPLEMENTED_PAGE_IDS, getPageForPath } from "../roleMenu";
import { APP_HELP, getAppHelp } from "./appHelp";

describe("app help", () => {
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
