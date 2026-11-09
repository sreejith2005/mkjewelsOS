import { describe, expect, it } from "vitest";
import { validateFormDefinition } from "./definition.ts";
import { formUserFilterProblem, formUserMatchesFilter, type FormUserFilter } from "./userFilter.ts";

const SALES = "11111111-1111-4111-8111-111111111111";
const CRM = "22222222-2222-4222-8222-222222222222";
const SENIOR = "33333333-3333-4333-8333-333333333333";
const salesStaff = { label: "Asha Mehta", departmentId: SALES, role: "staff", branchId: null };
const crmStaff = { label: "Ravi Shah", departmentId: CRM, role: "crm" };
const manager = { label: "Meera Iyer", departmentId: SALES, role: "manager", designationId: SENIOR };

describe("formUserMatchesFilter", () => {
  it("lists everyone without a filter", () => {
    expect(formUserMatchesFilter(undefined, crmStaff)).toBe(true);
    expect(formUserMatchesFilter({ match: "all", rules: [] }, crmStaff)).toBe(true);
  });
  it("Department = Sales lists only Sales people", () => {
    const filter: FormUserFilter = { match: "all", rules: [{ attribute: "department", operator: "equals", values: [SALES] }] };
    expect([salesStaff, crmStaff, manager].filter((person) => formUserMatchesFilter(filter, person)).map((person) => person.label)).toEqual(["Asha Mehta", "Meera Iyer"]);
  });
  it("all rules must match, or any with match any", () => {
    const rules = [{ attribute: "department", operator: "equals", values: [SALES] }, { attribute: "role", operator: "not_in", values: ["manager", "admin"] }] as const;
    expect(formUserMatchesFilter({ match: "all", rules }, manager)).toBe(false);
    expect(formUserMatchesFilter({ match: "any", rules }, manager)).toBe(true);
  });
  it("treats a missing value as empty, never as a match", () => {
    expect(formUserMatchesFilter({ match: "all", rules: [{ attribute: "designation", operator: "equals", values: [SENIOR] }] }, salesStaff)).toBe(false);
    expect(formUserMatchesFilter({ match: "all", rules: [{ attribute: "designation", operator: "is_empty", values: [] }] }, salesStaff)).toBe(true);
    expect(formUserMatchesFilter({ match: "all", rules: [{ attribute: "store", operator: "not_equals", values: [SALES] }] }, salesStaff)).toBe(true);
  });
  it("name contains is case-insensitive", () => {
    expect(formUserMatchesFilter({ match: "all", rules: [{ attribute: "name", operator: "contains", values: ["MEHTA"] }] }, salesStaff)).toBe(true);
    expect(formUserMatchesFilter({ match: "all", rules: [{ attribute: "name", operator: "not_contains", values: ["mehta"] }] }, salesStaff)).toBe(false);
  });
});

describe("formUserFilterProblem", () => {
  it("accepts a valid filter and rejects the same things as the server", () => {
    expect(formUserFilterProblem({ match: "all", rules: [{ attribute: "role", operator: "in", values: ["staff", "crm"] }] })).toBeNull();
    expect(formUserFilterProblem({ match: "all", rules: [{ attribute: "department", operator: "contains", values: ["x"] }] })).toMatch(/cannot use/);
    expect(formUserFilterProblem({ match: "all", rules: [{ attribute: "department", operator: "equals", values: ["1 or 1=1"] }] })).toMatch(/identifiers/);
    expect(formUserFilterProblem({ match: "all", rules: [{ attribute: "role", operator: "in", values: [] }] })).toMatch(/Choose a value/);
    expect(formUserFilterProblem({ match: "all", rules: [{ attribute: "role", operator: "equals", values: ["owner"] }] })).toMatch(/Unknown role/);
  });
  it("is only allowed on a Users question", () => {
    const issues = validateFormDefinition({ name: "F", fields: [{ key: "t", label: "T", type: "text", sortOrder: 0, validation: { userFilter: { match: "all", rules: [] } } }] });
    expect(issues.some((issue) => /Only a Users question/.test(issue.message))).toBe(true);
  });
});
