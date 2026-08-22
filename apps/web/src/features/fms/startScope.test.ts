import { describe, expect, it } from "vitest";
import type { UserProfile } from "@/types";
import type { FmsData, FmsFlowRow } from "./api";
import { fmsStartBranches, fmsStartDepartments, fmsStartUsers, resolveFmsQuickStart } from "./startScope";

const data = {
  branches: [{ id: "a", name: "Andheri" }, { id: "b", name: "Bandra" }],
  departments: [{ id: "global", branch_id: null, name: "Shared" }, { id: "b-sales", branch_id: "b", name: "Sales" }],
  users: [
    { id: "right", branch_id: "b", department_id: "b-sales", working_status: "active", account_status: "invited" },
    { id: "wrong-branch", branch_id: "a", department_id: "b-sales", working_status: "active", account_status: "active" },
    { id: "inactive", branch_id: "b", department_id: "b-sales", working_status: "inactive", account_status: "active" },
  ],
} as FmsData;

describe("FMS manual start scope", () => {
  it("shows all branches to administrators and only the own branch to operational users", () => {
    expect(fmsStartBranches(data.branches, { user_role: "admin", branch_id: "a", department_id: "global" } as UserProfile)).toHaveLength(2);
    expect(fmsStartBranches(data.branches, { user_role: "manager", branch_id: "b", department_id: "b-sales" } as UserProfile).map((item) => item.id)).toEqual(["b"]);
  });

  it("keeps tenant-wide departments and requires users to match both selected scope fields", () => {
    expect(fmsStartDepartments(data, "b", { user_role: "admin", branch_id: "a", department_id: "global" } as UserProfile).map((item) => item.id)).toEqual(["global", "b-sales"]);
    expect(fmsStartUsers(data, "b", "b-sales").map((item) => item.id)).toEqual(["right"]);
  });

  it("starts directly from the published first-step assignment and uses its scope", () => {
    const quickData = {
      ...data,
      stages: [{ id: "first", fms_flow_id: "flow", sort_order: 0 }],
      assignees: [{ fms_stage_id: "first", assignee_type: "specific_user", user_profile_id: "right", fallback_user_profile_id: null, sort_order: 0 }],
      availability: [],
    } as unknown as FmsData;
    const flow = { id: "flow", name: "Sales intake", branch_id: null, department_id: null } as FmsFlowRow;
    expect(resolveFmsQuickStart(quickData, flow, { user_role: "admin", branch_id: "a", department_id: "global" } as UserProfile)).toEqual(expect.objectContaining({ title: "Sales intake", branchId: "b", departmentId: "b-sales", firstAssigneeId: "right", context: {} }));
  });

  it("keeps the configured owner and leaves coverage resolution to the database", () => {
    const quickData = {
      ...data,
      users: [...data.users, { id: "fallback", branch_id: "b", department_id: "b-sales", working_status: "active", account_status: "active" }],
      stages: [{ id: "first", fms_flow_id: "flow", sort_order: 0 }],
      assignees: [{ fms_stage_id: "first", assignee_type: "specific_user", user_profile_id: "right", fallback_user_profile_id: "fallback", sort_order: 0 }],
      availability: [{ user_profile_id: "right", status: "absent" }],
    } as unknown as FmsData;
    const flow = { id: "flow", name: "Sales intake", branch_id: null, department_id: null } as FmsFlowRow;
    expect(resolveFmsQuickStart(quickData, flow, { user_role: "admin", branch_id: "a", department_id: "global" } as UserProfile).firstAssigneeId).toBe("right");
  });
});
