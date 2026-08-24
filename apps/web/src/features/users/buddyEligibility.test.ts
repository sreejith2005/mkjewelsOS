import { describe, expect, it } from "vitest";
import { eligibleBuddies } from "./buddyEligibility";

const scope = {
  branchId: "branch-a",
  departmentId: "department-a",
  designationId: "designation-a",
};

describe("eligibleBuddies", () => {
  it("only returns available employees in the selected organisational scope", () => {
    const eligible = {
      id: "eligible",
      account_status: "active",
      is_login_enabled: true,
      working_status: "active",
      branch_id: "branch-a",
      department_id: "department-a",
      designation_id: "designation-a",
    };

    expect(
      eligibleBuddies(
        [
          eligible,
          { ...eligible, id: "inactive", account_status: "invited" },
          { ...eligible, id: "disabled", is_login_enabled: false },
          { ...eligible, id: "away", working_status: "resigned" },
          { ...eligible, id: "other-branch", branch_id: "branch-b" },
          { ...eligible, id: "other-department", department_id: "department-b" },
          { ...eligible, id: "other-designation", designation_id: "designation-b" },
        ],
        scope,
      ).map((profile) => profile.id),
    ).toEqual(["eligible"]);
  });

  it("excludes the employee being edited and waits for a designation selection", () => {
    const profile = {
      id: "employee",
      account_status: "active",
      is_login_enabled: true,
      working_status: "active",
      branch_id: "branch-a",
      department_id: "department-a",
      designation_id: "designation-a",
    };

    expect(eligibleBuddies([profile], { ...scope, excludedId: "employee" })).toEqual([]);
    expect(eligibleBuddies([profile], { ...scope, designationId: "" })).toEqual([]);
  });
});
