import { describe, expect, it } from "vitest";
import { applyIdentityMappings } from "./identityMappings";
import { normalizeLegacyTaskSheet, LEGACY_TASK_HEADERS } from "./legacySheet";

const candidate = (overrides: Partial<{ id: string; employee_name: string; email: string; branch_id: string; department_id: string; manager_id: string | null }> = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  employee_name: "Named Person",
  email: "named@example.com",
  branch_id: "branch-1",
  department_id: "department-1",
  manager_id: null,
  ...overrides,
});

const draftRow = (overrides: Record<string, string> = {}) => {
  const values = Object.fromEntries(LEGACY_TASK_HEADERS.map((header) => [header, ""]));
  Object.assign(values, { "EMPLOYEE NAME": "Named Person", DEPARTMENT: "Sales", "BRANCH NAME": "Bandra", "TASK TYPE": "TASK", "CORE TASK": "Core", TASK: "Task", FREQUENCY: "As Required", "START TIME": "09:00", "DUE TIME": "18:00", PRIORITY: "Medium", "EVIDENCE REQUIRED": "No", "VERIFICATION REQUIRED": "No", "BUDDY ALLOWED": "No", ACTIVE: "Yes", ...overrides });
  return normalizeLegacyTaskSheet([values]).draftRows;
};

describe("automatic identity preview", () => {
  it("assigns one exact active name match without a manual selector", () => {
    const result = applyIdentityMappings(draftRow(), [candidate()]);
    expect(result.issues).toEqual([]);
    expect(result.rows[0]).toMatchObject({ assignee_profile_id: candidate().id, assignment_status: "assigned" });
  });

  it("keeps blank, unmatched, and ambiguous employees in Assigning Left", () => {
    const blank = applyIdentityMappings(draftRow({ "EMPLOYEE NAME": "" }), [candidate()]);
    const unmatched = applyIdentityMappings(draftRow(), []);
    const ambiguous = applyIdentityMappings(draftRow(), [candidate(), candidate({ id: "00000000-0000-4000-8000-000000000002" })]);

    for (const result of [blank, unmatched, ambiguous]) {
      expect(result.issues).toEqual([]);
      expect(result.rows[0]).toMatchObject({ assignee_profile_id: "", assignment_status: "assigning_left" });
    }
  });

  it("falls back to the resolved employee's reporting manager for verification", () => {
    const manager = candidate({ id: "00000000-0000-4000-8000-000000000009", employee_name: "Manager", email: "manager@example.com" });
    const employee = candidate({ manager_id: manager.id });
    const result = applyIdentityMappings(draftRow({ "VERIFICATION REQUIRED": "Yes", VERIFIER: "Role label" }), [employee, manager]);

    expect(result.rows[0]).toMatchObject({ assignee_profile_id: employee.id, verifier_profile_id: manager.id, assignment_status: "assigned" });
  });

  it("imports a resolved employee even when no verifier can be resolved", () => {
    const employee = candidate();
    const result = applyIdentityMappings(draftRow({ "VERIFICATION REQUIRED": "Yes", VERIFIER: "Unknown verifier" }), [employee]);

    expect(result.rows[0]).toMatchObject({ assignee_profile_id: employee.id, verifier_profile_id: "", assignment_status: "assigned" });
  });
});
