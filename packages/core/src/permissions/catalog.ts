import { ROLE_PAGES, USER_ROLES, type PageId, type UserRole } from "../roleMenu";

/**
 * How a permission may be configured.
 *
 * - `module`: access to an application section; configurable per role,
 *   designation and user.
 * - `action`: a capability inside a section that maps to an existing server
 *   check; configurable per role, designation and user.
 * - `authority`: follows the user's dashboard authority and cannot be
 *   overridden, because the underlying data scope is enforced by the
 *   role-level rules throughout the task engine.
 * - `protected`: reserved for Super Admin authority so permission management
 *   and Developer Mode can never be locked out.
 */
export type PermissionKind = "module" | "action" | "authority" | "protected";

export const DASHBOARD_AUTHORITIES = ["staff", "manager", "admin", "super_admin"] as const;
export type DashboardAuthority = (typeof DASHBOARD_AUTHORITIES)[number];

export const PERMISSION_CATEGORIES = [
  "Home & Dashboard",
  "Tasks",
  "Workflows",
  "Forms",
  "CRM",
  "Notifications",
  "People",
  "Reports",
  "Master data",
  "Settings",
  "Administration",
] as const;
export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

export type PermissionDefinition = Readonly<{
  key: string;
  kind: PermissionKind;
  category: PermissionCategory;
  label: string;
  description: string;
  defaultRoles: readonly UserRole[];
  pageId: PageId | null;
}>;

const ALL_ROLES: readonly UserRole[] = USER_ROLES;
const rolesWithPage = (page: PageId): readonly UserRole[] => USER_ROLES.filter((role) => ROLE_PAGES[role].includes(page));

function modulePermission(key: string, page: PageId, category: PermissionCategory, label: string, description: string): PermissionDefinition {
  return { key, kind: "module", category, label, description, defaultRoles: rolesWithPage(page), pageId: page };
}

/**
 * The permission catalog. Every entry corresponds to functionality that exists
 * today; role defaults reproduce the behaviour that shipped before permissions
 * were configurable. The database seed in migration 0156 must match this list
 * (enforced by `catalog.migration.test.ts`).
 */
export const PERMISSION_CATALOG = [
  modulePermission("home.view", "home", "Home & Dashboard", "Open Home", "Today's work, linked forms, FMS stages, and activity."),
  modulePermission("dashboard.view", "dashboard", "Home & Dashboard", "Open Dashboard", "Operational analytics for the user's authorized scope."),
  modulePermission("tasks.view", "checklist_tasks", "Tasks", "Open Tasks", "Assigned tasks, manual tasks, and task import."),
  { key: "tasks.manage_team", kind: "authority", category: "Tasks", label: "Manage team tasks", description: "Create, edit, and delegate tasks for others. Follows Manager authority or higher.", defaultRoles: ["super_admin", "admin", "manager"], pageId: null },
  { key: "tasks.view_all", kind: "authority", category: "Tasks", label: "View all tasks", description: "Tenant-wide task visibility. Follows Admin authority or higher.", defaultRoles: ["super_admin", "admin"], pageId: null },
  modulePermission("recurring_todo.view", "recurring_todo", "Tasks", "Open Recurring / To-Do", "Recurring schedules, verification, follow-ups, and coverage."),
  modulePermission("task_control.view", "task_templates", "Tasks", "Open Task Control", "Progress, overdue work, evidence, and task templates."),
  modulePermission("fms.view", "fms_builder", "Workflows", "Open FMS", "Run and view FMS workflows."),
  { key: "fms.manage", kind: "action", category: "Workflows", label: "Build and publish FMS flows", description: "Draft, publish, pause, archive, and delete FMS flows.", defaultRoles: ["super_admin", "admin"], pageId: null },
  modulePermission("forms.view", "forms_library", "Forms", "Open Forms Library", "Browse and fill published forms."),
  { key: "forms.manage", kind: "action", category: "Forms", label: "Author forms", description: "Create, edit, publish, and archive form templates.", defaultRoles: ["super_admin", "admin", "manager"], pageId: null },
  modulePermission("crm.view", "crm", "CRM", "Use CRM", "Clients, walk-ins, interactions, follow-ups, and documents."),
  modulePermission("notifications.view", "notifications", "Notifications", "Open Notifications", "The notification inbox."),
  { key: "notifications.manage", kind: "action", category: "Notifications", label: "Manage notification rules", description: "Templates, rules, and delivery logs.", defaultRoles: ["super_admin", "admin"], pageId: null },
  modulePermission("users.view", "users", "People", "Open Users", "Employee directory."),
  { key: "users.manage", kind: "action", category: "People", label: "Create and edit users", description: "Invite employees and edit their profiles.", defaultRoles: ["super_admin", "admin"], pageId: null },
  { key: "users.delete", kind: "action", category: "People", label: "Delete unused users", description: "Permanently delete invited or disabled accounts that were never used.", defaultRoles: ["super_admin"], pageId: null },
  modulePermission("availability.view", "availability", "People", "Open Availability", "Record and view working availability."),
  { key: "availability.manage_others", kind: "action", category: "People", label: "Record availability for others", description: "Mark other employees absent or present.", defaultRoles: ["super_admin", "admin", "manager", "hr"], pageId: null },
  modulePermission("reports.view", "reports", "Reports", "Open Reports", "Preview the reports available to the user's level."),
  { key: "reports.export", kind: "action", category: "Reports", label: "Export reports", description: "Request private CSV exports of the reports the user can view.", defaultRoles: ALL_ROLES, pageId: null },
  modulePermission("dropdowns.view", "dropdown_master", "Master data", "Open Dropdown Master", "Master dropdown values."),
  { key: "dropdowns.manage", kind: "action", category: "Master data", label: "Change dropdown values", description: "Create, rename, reorder, and deactivate master values.", defaultRoles: ["super_admin"], pageId: null },
  modulePermission("settings.view", "settings", "Settings", "Open Settings", "Account identity and personal preferences."),
  { key: "settings.manage_organization", kind: "action", category: "Settings", label: "Manage organization settings", description: "Tenant name, currency, timezone, and export limits.", defaultRoles: ["super_admin", "admin"], pageId: null },
  { key: "settings.manage_branch", kind: "action", category: "Settings", label: "Manage branch defaults", description: "Branch report defaults (own branch unless Admin or higher).", defaultRoles: ["super_admin", "admin", "manager"], pageId: null },
  { key: "daily_checklists.manage", kind: "action", category: "Settings", label: "Manage daily checklists", description: "Designation daily checklist content.", defaultRoles: ["super_admin", "hr"], pageId: null },
  { key: "permissions.manage", kind: "protected", category: "Administration", label: "Manage permissions", description: "Role, designation, and user permissions and dashboard authority. Super Admin authority only.", defaultRoles: ["super_admin"], pageId: null },
  { key: "developer_mode.manage", kind: "protected", category: "Administration", label: "Manage Developer Mode", description: "Enable or disable sections and use disabled sections. Super Admin authority only.", defaultRoles: ["super_admin"], pageId: null },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]["key"];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_CATALOG.map((item) => item.key);

const CATALOG_BY_KEY = new Map<string, PermissionDefinition>(PERMISSION_CATALOG.map((item) => [item.key, item]));

export function getPermissionDefinition(key: string): PermissionDefinition | undefined {
  return CATALOG_BY_KEY.get(key);
}

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && CATALOG_BY_KEY.has(value);
}

/** Only these kinds accept role, designation, or user configuration. */
export function isConfigurablePermission(key: PermissionKey): boolean {
  const kind = CATALOG_BY_KEY.get(key)?.kind;
  return kind === "module" || kind === "action";
}

/** The section-access permission for each page that has one. */
export const PAGE_VIEW_PERMISSION: Readonly<Partial<Record<PageId, PermissionKey>>> = Object.freeze(
  Object.fromEntries(
    PERMISSION_CATALOG.flatMap((item) => (item.pageId ? [[item.pageId, item.key]] : [])),
  ) as Partial<Record<PageId, PermissionKey>>,
);

/**
 * Legacy page ids that live inside another section. Their availability follows
 * the parent section so Developer Mode cannot be bypassed through an old link.
 */
export const SECTION_PARENT: Readonly<Partial<Record<PageId, PageId>>> = Object.freeze({
  fms_tasks: "fms_builder",
  task_evidence: "task_templates",
  delegation_tasks: "checklist_tasks",
});
