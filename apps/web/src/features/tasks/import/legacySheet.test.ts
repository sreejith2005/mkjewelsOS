import { describe, expect, it } from "vitest";
import { LEGACY_TASK_HEADERS, normalizeLegacyTaskSheet } from "./legacySheet";

const row = (overrides: Record<string, string> = {}) => Object.fromEntries(LEGACY_TASK_HEADERS.map((header) => [header, overrides[header] ?? ({
  "EMPLOYEE EMAIL": "person@example.com", "EMPLOYEE NAME": "Person", DEPARTMENT: "Sales", "BRANCH NAME": "Bandra",
  "TASK TYPE": "TASK", "CORE TASK": "Opening", TASK: "Open showroom", "TASK DESCRIPTION": "", FREQUENCY: "Daily",
  "TASK START DATE": "2026-08-26", "START TIME": "09:00", "DUE TIME": "18:00", PRIORITY: "Medium",
  "EVIDENCE REQUIRED": "No", "VERIFICATION REQUIRED": "No", VERIFIER: "", "BUDDY ALLOWED": "No", ACTIVE: "Yes",
} as Record<string, string>)[header] ?? ""]));

describe("current task sheet", () => {
  it("keeps blank identity unassigned while filling only grouped operational context", () => {
    const second = row({
      "EMPLOYEE EMAIL": "",
      "EMPLOYEE NAME": "",
      "BRANCH NAME": "",
      "START TIME": "",
      "DUE TIME": "",
      "EVIDENCE REQUIRED": "",
    });
    const result = normalizeLegacyTaskSheet([row(), second]);
    expect(result.issues).toEqual([]);
    expect(result.draftRows[1]).toMatchObject({
      assignee_email: "",
      assignee_name: "",
      branch: "Bandra",
      start_time: "09:00",
      due_time: "18:00",
      requires_upload: false,
    });
  });

  it("uses one import start date for every blank scheduled row without duplicate date errors", () => {
    const result = normalizeLegacyTaskSheet([
      row({ "TASK START DATE": "" }),
      row({ "TASK START DATE": "", FREQUENCY: "Yearly" }),
    ], { defaultStartsOn: "2026-09-01" });

    expect(result.issues.filter((item) => item.field === "TASK START DATE")).toEqual([]);
    expect(result.draftRows.map((item) => item.starts_on)).toEqual(["2026-09-01", "2026-09-01"]);
    expect(result.draftRows[1]?.recurrence_rule).toBe("FREQ=YEARLY;BYMONTH=9;BYMONTHDAY=1");
  });

  it("uses TASK as the checklist headline while retaining CORE TASK and the checklist item", () => {
    const result = normalizeLegacyTaskSheet([row({
      "TASK TYPE": "CHECK LIST",
      "CORE TASK": "Opening",
      TASK: "Open shutters",
      "TASK DESCRIPTION": "Unlock the front shutters before opening.",
    })]);
    expect(result.draftRows[0]).toMatchObject({
      task_type: "checklist",
      title: "Open shutters",
      core_task_label: "Opening",
      description: "Unlock the front shutters before opening.",
      checklist: [{ item_text: "Open shutters", required: true }],
    });
  });

  it("collects written employee names for automatic batch matching", () => {
    const result = normalizeLegacyTaskSheet([row({ "EMPLOYEE EMAIL": "", "EMPLOYEE NAME": "Named Person" })]);
    expect(result.identityRequirements).toEqual([expect.objectContaining({ kind: "assignee", label: "Named Person", source_rows: [2] })]);
  });

  it("requires every explicit boolean even for an inactive as-required template", () => {
    const result = normalizeLegacyTaskSheet([row({ FREQUENCY: "As Required", ACTIVE: "" })]);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: "ACTIVE" }));
  });
});
