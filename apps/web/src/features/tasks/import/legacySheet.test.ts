import { describe, expect, it } from "vitest";
import { LEGACY_TASK_HEADERS, normalizeLegacyTaskSheet } from "./legacySheet";

const row = (overrides: Record<string, string> = {}) => Object.fromEntries(LEGACY_TASK_HEADERS.map((header) => [header, overrides[header] ?? ({
  "EMPLOYEE EMAIL": "person@example.com", "EMPLOYEE NAME": "Person", DEPARTMENT: "Sales", "BRANCH NAME": "Bandra",
  "TASK TYPE": "TASK", "CORE TASK": "Opening", TASK: "Open showroom", "TASK DESCRIPTION": "", FREQUENCY: "Daily",
  "TASK START DATE": "2026-08-26", "START TIME": "09:00", "DUE TIME": "18:00", PRIORITY: "Medium",
  "EVIDENCE REQUIRED": "No", "VERIFICATION REQUIRED": "No", VERIFIER: "", "BUDDY ALLOWED": "No", ACTIVE: "Yes",
} as Record<string, string>)[header] ?? ""]));

describe("current task sheet", () => {
  it("does not fill down blank identity and scope fields", () => {
    const second = row({ "EMPLOYEE EMAIL": "", "EMPLOYEE NAME": "", "BRANCH NAME": "" });
    const result = normalizeLegacyTaskSheet([row(), second]);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 3, field: "EMPLOYEE EMAIL" }),
      expect.objectContaining({ row: 3, field: "BRANCH NAME" }),
    ]));
  });

  it("turns a checklist row into a core-titled task with one item", () => {
    const result = normalizeLegacyTaskSheet([row({ "TASK TYPE": "CHECK LIST", "CORE TASK": "Opening", TASK: "Open shutters" })]);
    expect(result.draftRows[0]).toMatchObject({ task_type: "checklist", title: "Opening", checklist: [{ item_text: "Open shutters", required: true }] });
  });

  it("requires explicit mapping when only an employee name is present", () => {
    const result = normalizeLegacyTaskSheet([row({ "EMPLOYEE EMAIL": "", "EMPLOYEE NAME": "Named Person" })]);
    expect(result.identityRequirements).toEqual([expect.objectContaining({ kind: "assignee", label: "Named Person", source_rows: [2] })]);
  });
});
