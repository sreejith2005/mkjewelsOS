import type { UserProfile } from "@/types";
import type { FmsData, FmsFlowRow } from "./api";
import { fmsDepartmentsForBranch } from "./departments";

type StartProfile = Pick<UserProfile, "branch_id" | "department_id" | "user_role">;

export function fmsStartBranches(branches: FmsData["branches"], profile: StartProfile) {
  return profile.user_role === "super_admin" || profile.user_role === "admin"
    ? branches
    : branches.filter((branch) => branch.id === profile.branch_id);
}

export function fmsStartDepartments(data: FmsData, branchId: string, profile: StartProfile) {
  const departments = fmsDepartmentsForBranch(data.departments, branchId);
  return profile.user_role === "crm" || profile.user_role === "staff"
    ? departments.filter((department) => department.id === profile.department_id)
    : departments;
}

export function fmsStartUsers(data: FmsData, branchId: string, departmentId: string) {
  if (!branchId || !departmentId) return [];
  return data.users.filter((user) =>
    user.branch_id === branchId
    && user.department_id === departmentId
    && user.working_status !== "inactive"
    && user.working_status !== "resigned"
    && user.account_status !== "inactive"
    && user.account_status !== "suspended"
  );
}

export function resolveFmsQuickStart(data: FmsData, flow: FmsFlowRow, profile: StartProfile) {
  const firstStage = data.stages
    .filter((stage) => stage.fms_flow_id === flow.id)
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id))[0];
  if (!firstStage) throw new Error("This published workflow has no first step");

  const firstRule = data.assignees
    .filter((rule) => rule.fms_stage_id === firstStage.id && rule.assignee_type === "specific_user")
    .sort((left, right) => left.sort_order - right.sort_order)[0];
  const assignee = data.users.find((user) => user.id === firstRule?.user_profile_id
    && user.working_status !== "inactive"
    && user.working_status !== "resigned"
    && user.account_status !== "inactive"
    && user.account_status !== "suspended"
  );

  const branchId = flow.branch_id ?? assignee?.branch_id ?? profile.branch_id;
  const departmentId = flow.department_id ?? assignee?.department_id ?? profile.department_id;
  if (!branchId || !departmentId) throw new Error("The published workflow needs a valid branch and department before it can start");

  return {
    flowId: flow.id,
    title: flow.name,
    priority: "medium" as const,
    context: {},
    branchId,
    departmentId,
    firstAssigneeId: assignee?.id ?? null,
  };
}
