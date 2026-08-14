import type { UserProfile } from "@/types";
import type { FmsData } from "./api";
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

export function isFmsStartUserAvailable(data: FmsData, userId: string) {
  return data.availability.find((item) => item.user_profile_id === userId)?.status !== "absent";
}
