import { ALL_MENU_ITEMS, USER_ROLES, canAccessPage, isImplementedPage, type MenuItem, type PageId, type UserRole } from "../roleMenu";
import type { SectionControls } from "../settings/sectionAvailability";
import {
  DASHBOARD_AUTHORITIES,
  PAGE_VIEW_PERMISSION,
  PERMISSION_CATALOG,
  SECTION_PARENT,
  getPermissionDefinition,
  isPermissionKey,
  type DashboardAuthority,
  type PermissionKey,
} from "./catalog";

export type PermissionEffect = "grant" | "deny";

export type PermissionOverrides = Readonly<Partial<Record<PermissionKey, PermissionEffect>>>;

/** Tenant-configured role rows; an absent key falls back to the catalog default. */
export type RolePermissionMatrix = Readonly<Partial<Record<UserRole, Readonly<Partial<Record<PermissionKey, boolean>>>>>>;

export type AccessSubject = Readonly<{
  role: UserRole;
  dashboardAuthority: DashboardAuthority | null;
  rolePermissions?: RolePermissionMatrix;
  designationOverrides?: PermissionOverrides;
  userOverrides?: PermissionOverrides;
}>;

export type PermissionDecisionSource = "role" | "designation" | "user" | "authority" | "protected";

export type PermissionExplanation = Readonly<{
  key: PermissionKey;
  effectiveRole: UserRole;
  roleDefault: boolean;
  roleConfigured: boolean;
  designation: PermissionEffect | null;
  user: PermissionEffect | null;
  effective: boolean;
  decidedBy: PermissionDecisionSource;
}>;

/** The role every role-level rule sees: dashboard authority wins over the base role. */
export function effectiveRoleFor(subject: Pick<AccessSubject, "role" | "dashboardAuthority">): UserRole {
  return subject.dashboardAuthority ?? subject.role;
}

/**
 * Mirrors `permission_effective_for()` in migration 0156. The database is the
 * authority; this copy exists for live previews and must stay in parity.
 */
export function explainPermission(subject: AccessSubject, key: PermissionKey): PermissionExplanation {
  const definition = getPermissionDefinition(key);
  if (!definition) throw new Error(`Unknown permission: ${key}`);
  const effectiveRole = effectiveRoleFor(subject);
  const builtin = definition.defaultRoles.includes(effectiveRole);
  if (definition.kind === "protected" || definition.kind === "authority") {
    const effective = definition.kind === "protected" ? effectiveRole === "super_admin" : builtin;
    return { key, effectiveRole, roleDefault: effective, roleConfigured: false, designation: null, user: null, effective, decidedBy: definition.kind };
  }
  const configured = subject.rolePermissions?.[effectiveRole]?.[key];
  const roleDefault = configured ?? builtin;
  const designation = subject.designationOverrides?.[key] ?? null;
  const user = subject.userOverrides?.[key] ?? null;
  const effective = user ? user === "grant" : designation ? designation === "grant" : roleDefault;
  return {
    key,
    effectiveRole,
    roleDefault,
    roleConfigured: configured !== undefined,
    designation,
    user,
    effective,
    decidedBy: user ? "user" : designation ? "designation" : "role",
  };
}

export type PermissionMap = Readonly<Record<PermissionKey, boolean>>;

export function resolvePermissions(subject: AccessSubject): PermissionMap {
  return Object.fromEntries(PERMISSION_CATALOG.map((item) => [item.key, explainPermission(subject, item.key).effective])) as Record<PermissionKey, boolean>;
}

/** The access snapshot the web client receives from `get_my_access_context()`. */
export type AccessContext = Readonly<{
  profileId: string;
  baseRole: UserRole;
  dashboardAuthority: DashboardAuthority | null;
  effectiveRole: UserRole;
  permissions: PermissionMap;
}>;

const isUserRole = (value: unknown): value is UserRole => typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
const isAuthority = (value: unknown): value is DashboardAuthority => typeof value === "string" && (DASHBOARD_AUTHORITIES as readonly string[]).includes(value);

/**
 * Parses the server payload. Unknown keys are ignored and missing keys are
 * denied, so a newer client talking to an older database fails closed on the
 * permissions it does not know about.
 */
export function validateAccessContext(input: unknown): AccessContext {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Access context must be an object");
  const value = input as Record<string, unknown>;
  if (typeof value.profile_id !== "string" || !isUserRole(value.base_role) || !isUserRole(value.effective_role)) throw new Error("Invalid access context");
  if (value.dashboard_authority !== null && !isAuthority(value.dashboard_authority)) throw new Error("Invalid dashboard authority");
  const raw = value.permissions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid permissions");
  const permissions = Object.fromEntries(PERMISSION_CATALOG.map((item) => [item.key, (raw as Record<string, unknown>)[item.key] === true])) as Record<PermissionKey, boolean>;
  return {
    profileId: value.profile_id,
    baseRole: value.base_role,
    dashboardAuthority: value.dashboard_authority,
    effectiveRole: value.effective_role,
    permissions,
  };
}

/**
 * Built-in access for a profile when the access RPC is not deployed yet. It
 * reproduces the pre-permission behaviour exactly; the server still enforces.
 */
export function builtinAccessContext(profile: Readonly<{ id: string; user_role: UserRole }>): AccessContext {
  return {
    profileId: profile.id,
    baseRole: profile.user_role,
    dashboardAuthority: null,
    effectiveRole: profile.user_role,
    permissions: resolvePermissions({ role: profile.user_role, dashboardAuthority: null }),
  };
}

export function hasPermission(access: AccessContext | null | undefined, key: PermissionKey): boolean {
  return Boolean(access?.permissions[key]);
}

const AUTHORITY_RANK: Readonly<Record<DashboardAuthority, number>> = { staff: 0, manager: 1, admin: 2, super_admin: 3 };

/** Maps any role onto the authority ladder; functional roles sit at Staff level. */
export function authorityLevelForRole(role: UserRole): DashboardAuthority {
  return isAuthority(role) ? role : "staff";
}

export function hasDashboardAccess(access: AccessContext | null | undefined, level: DashboardAuthority): boolean {
  if (!access) return false;
  return AUTHORITY_RANK[authorityLevelForRole(access.effectiveRole)] >= AUTHORITY_RANK[level];
}

export function canViewPage(access: AccessContext, page: PageId): boolean {
  const permission = PAGE_VIEW_PERMISSION[page];
  if (permission) return hasPermission(access, permission);
  const parent = SECTION_PARENT[page];
  if (parent && !canViewPage(access, parent)) return false;
  return canAccessPage(access.effectiveRole, page);
}

export function isSectionEnabled(controls: SectionControls, page: PageId): boolean {
  const parent = SECTION_PARENT[page];
  return controls.section_availability[page] !== false && (!parent || controls.section_availability[parent] !== false);
}

export type PageAccessDecision = "allowed" | "disabled" | "denied";

/**
 * Feature availability and permissions are separate questions: a disabled
 * section is unavailable to everyone except Developer Mode managers, and an
 * enabled section is available only to users holding its permission.
 */
export function resolvePageAccess(access: AccessContext, controls: SectionControls, page: PageId): PageAccessDecision {
  if (!isImplementedPage(page) || !canViewPage(access, page)) return "denied";
  if (!isSectionEnabled(controls, page) && !hasPermission(access, "developer_mode.manage")) return "disabled";
  return "allowed";
}

export function getAccessibleMenu(access: AccessContext, controls: SectionControls): readonly MenuItem[] {
  return ALL_MENU_ITEMS.filter((item) => resolvePageAccess(access, controls, item.id) === "allowed");
}

export function isPermissionEffect(value: unknown): value is PermissionEffect {
  return value === "grant" || value === "deny";
}

/** Parses a `{ key: "grant" | "deny" }` payload, ignoring unknown keys. */
export function parsePermissionOverrides(input: unknown): PermissionOverrides {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(([key, effect]) => isPermissionKey(key) && isPermissionEffect(effect)),
  ) as PermissionOverrides;
}
