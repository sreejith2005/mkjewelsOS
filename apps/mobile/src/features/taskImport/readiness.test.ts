import { describe, expect, it } from "vitest";
import {
  taskImportActionLabel,
  taskImportBlockedReminder,
  taskImportReadinessCounts,
} from "./readiness";

describe("native task import readiness", () => {
  it.each([
    [3, 3, "Import all 3 records"],
    [3, 2, "Import 2 valid records"],
    [2, 1, "Import 1 valid record"],
    [2, 0, "Import 0 valid records"],
  ])("labels %i source and %i ready records", (total, ready, expected) => {
    expect(taskImportActionLabel(total, ready)).toBe(expected);
  });

  it("counts only eligible mapped rows as assigned or Assigning Left", () => {
    expect(taskImportReadinessCounts([
      { assignee_profile_id: "profile-1" },
      { assignee_profile_id: "" },
      { assignee_profile_id: "" },
    ], 2)).toEqual({
      ready: 3,
      blocked: 2,
      assigned: 1,
      assigningLeft: 2,
    });
  });

  it("describes blocked source rows after a partial import", () => {
    expect(taskImportBlockedReminder(0)).toBe("");
    expect(taskImportBlockedReminder(1)).toBe(" 1 source row remains blocked for correction.");
    expect(taskImportBlockedReminder(2)).toBe(" 2 source rows remain blocked for correction.");
  });
});
