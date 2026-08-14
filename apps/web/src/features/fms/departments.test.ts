import { describe, expect, it } from "vitest";
import { fmsDepartmentLabel, fmsDepartmentsForBranch, fmsUsersForDepartment } from "./departments";

const departments = [
  { id: "global", branch_id: null, name: "Sales" },
  { id: "b1-dept", branch_id: "b1", name: "Workshop" },
  { id: "b2-dept", branch_id: "b2", name: "Accounts" },
];

describe("FMS department options", () => {
  it("keeps tenant-wide departments visible after choosing a branch", () => {
    expect(fmsDepartmentsForBranch(departments, "b1").map((item) => item.id)).toEqual(["global", "b1-dept"]);
  });

  it("shows every department before a branch is selected", () => {
    expect(fmsDepartmentsForBranch(departments).map((item) => item.id)).toEqual(["global", "b1-dept", "b2-dept"]);
  });

  it("adds branch context only to branch-specific department labels", () => {
    expect(fmsDepartmentLabel(departments[0]!, [{ id: "b1", name: "Main" }])).toBe("Sales");
    expect(fmsDepartmentLabel(departments[1]!, [{ id: "b1", name: "Main" }])).toBe("Main · Workshop");
  });

  it("uses the same non-resigned department population for primary and fallback", () => {
    const users = [
      { id: "primary", employee_name: "Primary", user_role: "staff", branch_id: "b1", department_id: "global", working_status: "active", is_login_enabled: true },
      { id: "fallback", employee_name: "Fallback", user_role: "staff", branch_id: "b1", department_id: "global", working_status: "inactive", is_login_enabled: false },
      { id: "resigned", employee_name: "Resigned", user_role: "staff", branch_id: "b1", department_id: "global", working_status: "resigned", is_login_enabled: false },
      { id: "other-branch", employee_name: "Other", user_role: "staff", branch_id: "b2", department_id: "global", working_status: "active", is_login_enabled: true },
    ];
    expect(fmsUsersForDepartment(users, "global").map((user) => user.id)).toEqual(["primary", "fallback", "other-branch"]);
  });
});
