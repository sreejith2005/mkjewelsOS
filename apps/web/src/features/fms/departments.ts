import type { FmsData } from "./api";

type Department = FmsData["departments"][number];
type User = FmsData["users"][number];

/** Tenant-wide departments have no branch_id and remain valid inside any branch. */
export function fmsDepartmentsForBranch(departments: readonly Department[], branchId?: string | null): Department[] {
  return departments.filter((department) => !branchId || department.branch_id === null || department.branch_id === branchId);
}

export function fmsDepartmentLabel(department: Department, branches: FmsData["branches"]): string {
  if (!department.branch_id) return department.name;
  const branch = branches.find((item) => item.id === department.branch_id);
  return branch ? `${branch.name} · ${department.name}` : department.name;
}

/** Primary and fallback selectors must use the same Users-section population. */
export function fmsUsersForDepartment(users: readonly User[], departmentId?: string | null): User[] {
  if (!departmentId) return [];
  return users.filter((user) => user.department_id === departmentId && user.working_status !== "resigned");
}
