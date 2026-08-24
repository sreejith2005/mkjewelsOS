export type BuddyCandidate = Readonly<{
  id: string;
  account_status: string;
  is_login_enabled: boolean | null;
  working_status: string;
  branch_id: string | null;
  department_id: string | null;
}>;

export type BuddyScope = Readonly<{
  branchId: string;
  departmentId: string;
  excludedId?: string;
}>;

/**
 * Mirrors the availability and organisational-scope checks enforced in the
 * database. The database remains authoritative for role hierarchy checks.
 */
export function eligibleBuddies<T extends BuddyCandidate>(
  profiles: readonly T[],
  scope: BuddyScope,
): T[] {
  if (!scope.branchId || !scope.departmentId) return [];

  return profiles.filter(
    (profile) =>
      profile.id !== scope.excludedId &&
      profile.account_status === "active" &&
      profile.is_login_enabled &&
      profile.working_status === "active" &&
      profile.branch_id === scope.branchId &&
      profile.department_id === scope.departmentId,
  );
}
