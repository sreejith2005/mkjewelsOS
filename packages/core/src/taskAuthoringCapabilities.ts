import type { UserRole } from "./roleMenu";

export type TaskAuthoringScope = "department" | "branch" | "tenant";

export type TaskAuthoringCapability = Readonly<{
  scope: TaskAuthoringScope;
}>;

const TENANT_WIDE_ROLES = new Set<UserRole>(["super_admin", "admin"]);

/** Determines the assignee scope for manually authored Tasks. */
export function deriveTaskAuthoringCapability({
  designationValue,
  userRole,
}: Readonly<{ designationValue: string | null | undefined; userRole: UserRole }>): TaskAuthoringCapability {
  if (TENANT_WIDE_ROLES.has(userRole) || designationValue === "process_coordinator") return { scope: "tenant" };
  if (userRole === "manager") return { scope: "branch" };
  return { scope: "department" };
}
