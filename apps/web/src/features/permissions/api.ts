import { supabase } from "@jewelos/api-client";
import {
  DASHBOARD_AUTHORITIES,
  USER_ROLES,
  isPermissionKey,
  type DashboardAuthority,
  type PermissionEffect,
  type PermissionKey,
  type PermissionOverrides,
  type RolePermissionMatrix,
  type UserRole,
} from "@jewelos/core";

const isRole = (value: unknown): value is UserRole => typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
const isAuthority = (value: unknown): value is DashboardAuthority => typeof value === "string" && (DASHBOARD_AUTHORITIES as readonly string[]).includes(value);
const isEffect = (value: unknown): value is PermissionEffect => value === "grant" || value === "deny";
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

export type PermissionAdminUser = Readonly<{
  id: string;
  employeeName: string;
  employeeCode: string;
  role: UserRole;
  designationId: string | null;
  accountStatus: string;
  dashboardAuthority: DashboardAuthority | null;
  overrideCount: number;
}>;

export type Designation = Readonly<{ id: string; label: string }>;

export type PermissionAdminContext = Readonly<{
  roles: readonly UserRole[];
  rolePermissions: RolePermissionMatrix;
  designations: readonly Designation[];
  designationOverrides: Readonly<Record<string, PermissionOverrides>>;
  users: readonly PermissionAdminUser[];
}>;

export type UserAccessRow = Readonly<{
  key: PermissionKey;
  roleDefault: boolean;
  roleConfigured: boolean;
  designation: PermissionEffect | null;
  user: PermissionEffect | null;
  effective: boolean;
}>;

export type UserAccessBreakdown = Readonly<{
  profileId: string;
  employeeName: string;
  employeeCode: string;
  baseRole: UserRole;
  designationId: string | null;
  designationLabel: string | null;
  dashboardAuthority: DashboardAuthority | null;
  effectiveRole: UserRole;
  rows: readonly UserAccessRow[];
}>;

export type RolePermissionChanges = Readonly<Partial<Record<PermissionKey, boolean | null>>>;
export type OverrideChanges = Readonly<Partial<Record<PermissionKey, PermissionEffect | null>>>;

export async function fetchPermissionAdminContext(): Promise<PermissionAdminContext> {
  const { data, error } = await supabase.rpc("get_permission_admin_context");
  if (error) throw error;
  const value = asRecord(data);
  const roles = asArray(value.roles).filter(isRole);
  const rolePermissions: Partial<Record<UserRole, Partial<Record<PermissionKey, boolean>>>> = {};
  for (const row of asArray(value.role_permissions).map(asRecord)) {
    if (isRole(row.role) && isPermissionKey(row.key) && typeof row.allowed === "boolean") (rolePermissions[row.role] ??= {})[row.key] = row.allowed;
  }
  const designationOverrides: Record<string, Partial<Record<PermissionKey, PermissionEffect>>> = {};
  for (const row of asArray(value.designation_overrides).map(asRecord)) {
    const designationId = asString(row.designation_id);
    if (designationId && isPermissionKey(row.key) && isEffect(row.effect)) (designationOverrides[designationId] ??= {})[row.key] = row.effect;
  }
  const designations = asArray(value.designations).map(asRecord).flatMap((row): Designation[] => {
    const id = asString(row.id);
    const label = asString(row.label);
    return id && label ? [{ id, label }] : [];
  });
  const users = asArray(value.users).map(asRecord).flatMap((row): PermissionAdminUser[] => {
    const id = asString(row.id);
    const employeeName = asString(row.employee_name);
    if (!id || !employeeName || !isRole(row.user_role)) return [];
    return [{
      id,
      employeeName,
      employeeCode: asString(row.employee_code) ?? "",
      role: row.user_role,
      designationId: asString(row.designation_id),
      accountStatus: asString(row.account_status) ?? "",
      dashboardAuthority: isAuthority(row.dashboard_authority) ? row.dashboard_authority : null,
      overrideCount: typeof row.override_count === "number" ? row.override_count : 0,
    }];
  });
  return { roles: roles.length ? roles : USER_ROLES, rolePermissions, designations, designationOverrides, users };
}

function parseBreakdown(data: unknown): UserAccessBreakdown {
  const value = asRecord(data);
  const profile = asRecord(value.profile);
  const profileId = asString(profile.id);
  const employeeName = asString(profile.employee_name);
  if (!profileId || !employeeName || !isRole(profile.base_role) || !isRole(value.effective_role)) throw new Error("The access breakdown returned an invalid response.");
  const rows = asArray(value.rows).map(asRecord).flatMap((row): UserAccessRow[] => isPermissionKey(row.key) ? [{
    key: row.key,
    roleDefault: row.role_default === true,
    roleConfigured: row.role_configured === true,
    designation: isEffect(row.designation) ? row.designation : null,
    user: isEffect(row.user) ? row.user : null,
    effective: row.effective === true,
  }] : []);
  return {
    profileId,
    employeeName,
    employeeCode: asString(profile.employee_code) ?? "",
    baseRole: profile.base_role,
    designationId: asString(profile.designation_id),
    designationLabel: asString(profile.designation_label),
    dashboardAuthority: isAuthority(value.dashboard_authority) ? value.dashboard_authority : null,
    effectiveRole: value.effective_role,
    rows,
  };
}

export async function fetchUserAccessBreakdown(profileId: string): Promise<UserAccessBreakdown> {
  const { data, error } = await supabase.rpc("get_user_access_breakdown", { p_profile_id: profileId });
  if (error) throw error;
  return parseBreakdown(data);
}

export async function saveRolePermissions(role: UserRole, changes: RolePermissionChanges): Promise<void> {
  const { error } = await supabase.rpc("save_role_permissions_with_audit", { p_role: role, p_permissions: changes });
  if (error) throw error;
}

export async function saveDesignationPermissions(designationId: string, changes: OverrideChanges): Promise<void> {
  const { error } = await supabase.rpc("save_designation_permissions_with_audit", { p_designation_id: designationId, p_overrides: changes });
  if (error) throw error;
}

export async function saveUserAccess(profileId: string, authority: DashboardAuthority | null, changes: OverrideChanges): Promise<UserAccessBreakdown> {
  const { data, error } = await supabase.rpc("save_user_access_with_audit", {
    p_profile_id: profileId,
    p_overrides: changes,
    ...(authority ? { p_dashboard_authority: authority } : {}),
  });
  if (error) throw error;
  return parseBreakdown(data);
}
