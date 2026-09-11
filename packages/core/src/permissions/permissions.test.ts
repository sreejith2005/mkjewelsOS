import { describe, expect, it } from "vitest";
import { PAGE_IDS, ROLE_PAGES, USER_ROLES, canAccessPage, getImplementedMenuForRole } from "../roleMenu";
import { DEFAULT_SECTION_CONTROLS, isSectionUnderMaintenance, type SectionControls } from "../settings/sectionAvailability";
import { PAGE_VIEW_PERMISSION, PERMISSION_CATALOG, PERMISSION_KEYS, isConfigurablePermission } from "./catalog";
import {
  builtinAccessContext,
  canViewPage,
  explainPermission,
  getAccessibleMenu,
  hasDashboardAccess,
  hasPermission,
  parsePermissionOverrides,
  resolvePageAccess,
  resolvePermissions,
  validateAccessContext,
  type AccessContext,
  type AccessSubject,
} from "./resolve";

const access = (subject: AccessSubject, id = "u1"): AccessContext => ({
  profileId: id,
  baseRole: subject.role,
  dashboardAuthority: subject.dashboardAuthority,
  effectiveRole: subject.dashboardAuthority ?? subject.role,
  permissions: resolvePermissions(subject),
});

const withSection = (page: keyof SectionControls["section_availability"], enabled: boolean, developerMode = false): SectionControls => ({
  ...DEFAULT_SECTION_CONTROLS,
  developer_mode_enabled: developerMode,
  section_availability: { ...DEFAULT_SECTION_CONTROLS.section_availability, [page]: enabled },
});

describe("permission catalog", () => {
  it("has unique keys", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("reproduces the shipped role page matrix for every role and page (behaviour-preserving defaults)", () => {
    for (const role of USER_ROLES) {
      const context = builtinAccessContext({ id: "p", user_role: role });
      for (const page of PAGE_IDS) {
        expect(canViewPage(context, page), `${role} -> ${page}`).toBe(canAccessPage(role, page));
      }
    }
  });

  it("keeps the implemented menu identical for every role with no overrides", () => {
    for (const role of USER_ROLES) {
      const menu = getAccessibleMenu(builtinAccessContext({ id: "p", user_role: role }), DEFAULT_SECTION_CONTROLS).map((item) => item.id);
      const expected = getImplementedMenuForRole(role).map((item) => item.id);
      // Super Admins see every section; nobody else gains or loses one.
      expect(menu, role).toEqual(expected);
    }
  });

  it("defines a section permission for every navigable page that roles can reach", () => {
    for (const role of USER_ROLES) for (const page of ROLE_PAGES[role]) {
      if (page === "meeting_ai" || page === "task_evidence" || page === "delegation_tasks" || page === "fms_tasks") continue;
      expect(PAGE_VIEW_PERMISSION[page], page).toBeDefined();
    }
  });

  it("only module and action permissions are configurable", () => {
    expect(isConfigurablePermission("tasks.view")).toBe(true);
    expect(isConfigurablePermission("users.manage")).toBe(true);
    expect(isConfigurablePermission("tasks.view_all")).toBe(false);
    expect(isConfigurablePermission("permissions.manage")).toBe(false);
    expect(PERMISSION_CATALOG.filter((item) => item.kind === "protected").map((item) => item.key).sort()).toEqual(["developer_mode.manage", "permissions.manage"]);
  });
});

describe("permission resolution", () => {
  it("Staff with no override receives the Staff dashboard and defaults", () => {
    const context = access({ role: "staff", dashboardAuthority: null });
    expect(hasDashboardAccess(context, "staff")).toBe(true);
    expect(hasDashboardAccess(context, "manager")).toBe(false);
    expect(hasPermission(context, "tasks.view")).toBe(true);
    expect(hasPermission(context, "tasks.manage_team")).toBe(false);
    expect(hasPermission(context, "users.view")).toBe(false);
  });

  it("Staff with Manager dashboard authority receives Manager access", () => {
    const context = access({ role: "staff", dashboardAuthority: "manager" });
    expect(context.effectiveRole).toBe("manager");
    expect(hasDashboardAccess(context, "manager")).toBe(true);
    expect(hasDashboardAccess(context, "admin")).toBe(false);
    expect(hasPermission(context, "tasks.manage_team")).toBe(true);
    expect(hasPermission(context, "crm.view")).toBe(true);
    expect(hasPermission(context, "users.view")).toBe(true);
  });

  it("Process Coordinator (Staff role) with Admin authority receives Admin functionality", () => {
    const context = access({ role: "staff", dashboardAuthority: "admin" });
    expect(hasPermission(context, "tasks.view_all")).toBe(true);
    expect(hasPermission(context, "users.manage")).toBe(true);
    expect(hasPermission(context, "permissions.manage")).toBe(false);
  });

  it("Manager with an explicit user deny is denied", () => {
    const explanation = explainPermission({ role: "manager", dashboardAuthority: null, userOverrides: { "crm.view": "deny" } }, "crm.view");
    expect(explanation).toMatchObject({ roleDefault: true, user: "deny", effective: false, decidedBy: "user" });
  });

  it("Staff with an explicit user grant is allowed", () => {
    const explanation = explainPermission({ role: "staff", dashboardAuthority: null, userOverrides: { "reports.view": "grant", "crm.view": "grant" } }, "crm.view");
    expect(explanation).toMatchObject({ roleDefault: false, user: "grant", effective: true, decidedBy: "user" });
  });

  it("the user example: Staff + Admin authority + deny user deletion", () => {
    const context = access({ role: "staff", dashboardAuthority: "admin", userOverrides: { "users.delete": "deny", "users.manage": "grant" } });
    expect(hasPermission(context, "tasks.view_all")).toBe(true);
    expect(hasPermission(context, "tasks.manage_team")).toBe(true);
    expect(hasPermission(context, "users.delete")).toBe(false);
  });

  it("role configuration changes the default and remains overridable", () => {
    const rolePermissions = { hr: { "crm.view": true, "users.view": false } } as const;
    expect(explainPermission({ role: "hr", dashboardAuthority: null, rolePermissions }, "crm.view")).toMatchObject({ roleDefault: true, roleConfigured: true, effective: true });
    expect(explainPermission({ role: "hr", dashboardAuthority: null, rolePermissions }, "users.view")).toMatchObject({ roleDefault: false, effective: false });
    expect(explainPermission({ role: "hr", dashboardAuthority: null, rolePermissions, userOverrides: { "users.view": "grant" } }, "users.view").effective).toBe(true);
  });

  it("dashboard authority selects which role row supplies defaults", () => {
    const rolePermissions = { manager: { "reports.export": false } } as const;
    expect(explainPermission({ role: "staff", dashboardAuthority: "manager", rolePermissions }, "reports.export").effective).toBe(false);
    expect(explainPermission({ role: "staff", dashboardAuthority: null, rolePermissions }, "reports.export").effective).toBe(true);
  });

  it("designation overrides apply between role and user", () => {
    const subject: AccessSubject = { role: "staff", dashboardAuthority: null, designationOverrides: { "task_control.view": "grant", "reports.view": "deny" } };
    expect(explainPermission(subject, "task_control.view")).toMatchObject({ effective: true, decidedBy: "designation" });
    expect(explainPermission(subject, "reports.view")).toMatchObject({ effective: false, decidedBy: "designation" });
    expect(explainPermission({ ...subject, userOverrides: { "reports.view": "grant" } }, "reports.view")).toMatchObject({ effective: true, decidedBy: "user" });
  });

  it("protected permissions follow Super Admin authority only and ignore overrides", () => {
    const subject: AccessSubject = { role: "admin", dashboardAuthority: null, userOverrides: { "permissions.manage": "grant" }, rolePermissions: { admin: { "permissions.manage": true } } };
    expect(explainPermission(subject, "permissions.manage").effective).toBe(false);
    expect(explainPermission({ role: "super_admin", dashboardAuthority: null, userOverrides: { "developer_mode.manage": "deny" } }, "developer_mode.manage").effective).toBe(true);
    expect(explainPermission({ role: "staff", dashboardAuthority: "super_admin" }, "permissions.manage").effective).toBe(true);
  });

  it("authority permissions ignore overrides", () => {
    expect(explainPermission({ role: "staff", dashboardAuthority: null, userOverrides: { "tasks.view_all": "grant" } }, "tasks.view_all").effective).toBe(false);
    expect(explainPermission({ role: "admin", dashboardAuthority: null, userOverrides: { "tasks.view_all": "deny" } }, "tasks.view_all").effective).toBe(true);
  });

  it("lowering authority lowers access", () => {
    const context = access({ role: "manager", dashboardAuthority: "staff" });
    expect(hasPermission(context, "crm.view")).toBe(false);
    expect(hasPermission(context, "tasks.manage_team")).toBe(false);
  });
});

describe("section availability and page access", () => {
  const staff = access({ role: "staff", dashboardAuthority: null });
  const admin = access({ role: "admin", dashboardAuthority: null });
  const superAdmin = access({ role: "super_admin", dashboardAuthority: null });

  it("a disabled section stays disabled after the Developer Mode strip is switched off", () => {
    expect(isSectionUnderMaintenance(withSection("reports", false, false), "reports")).toBe(true);
    expect(isSectionUnderMaintenance(withSection("reports", false, true), "reports")).toBe(true);
    expect(isSectionUnderMaintenance(DEFAULT_SECTION_CONTROLS, "reports")).toBe(false);
  });

  it("Staff + module disabled -> disabled; Admin + module disabled -> disabled", () => {
    expect(resolvePageAccess(staff, withSection("reports", false), "reports")).toBe("disabled");
    expect(resolvePageAccess(admin, withSection("reports", false), "reports")).toBe("disabled");
  });

  it("Super Admin keeps access to a disabled module", () => {
    expect(resolvePageAccess(superAdmin, withSection("reports", false), "reports")).toBe("allowed");
  });

  it("a user without the section permission is denied even when enabled", () => {
    expect(resolvePageAccess(staff, DEFAULT_SECTION_CONTROLS, "users")).toBe("denied");
    expect(resolvePageAccess(access({ role: "staff", dashboardAuthority: null, userOverrides: { "users.view": "grant" } }), DEFAULT_SECTION_CONTROLS, "users")).toBe("allowed");
  });

  it("disabled sections are removed from the navigation for ordinary users", () => {
    const controls = withSection("reports", false);
    expect(getAccessibleMenu(staff, controls).some((item) => item.id === "reports")).toBe(false);
    expect(getAccessibleMenu(superAdmin, controls).some((item) => item.id === "reports")).toBe(true);
  });

  it("legacy links follow their parent section", () => {
    expect(isSectionUnderMaintenance(withSection("fms_builder", false), "fms_tasks")).toBe(true);
    expect(isSectionUnderMaintenance(withSection("task_templates", false), "task_evidence")).toBe(true);
    expect(resolvePageAccess(admin, withSection("fms_builder", false), "fms_tasks")).toBe("disabled");
  });

  it("unimplemented pages are denied", () => {
    expect(resolvePageAccess(superAdmin, DEFAULT_SECTION_CONTROLS, "meeting_ai")).toBe("denied");
  });
});

describe("server payload parsing", () => {
  it("accepts the access RPC payload and denies unknown or missing keys", () => {
    const parsed = validateAccessContext({ profile_id: "p", base_role: "staff", dashboard_authority: "manager", effective_role: "manager", permissions: { "tasks.view": true, "not.real": true } });
    expect(parsed.effectiveRole).toBe("manager");
    expect(parsed.permissions["tasks.view"]).toBe(true);
    expect(parsed.permissions["reports.view"]).toBe(false);
    expect(Object.hasOwn(parsed.permissions, "not.real")).toBe(false);
  });

  it("rejects malformed payloads rather than trusting them", () => {
    expect(() => validateAccessContext({ profile_id: "p", base_role: "root", effective_role: "staff", dashboard_authority: null, permissions: {} })).toThrow();
    expect(() => validateAccessContext({ profile_id: "p", base_role: "staff", effective_role: "staff", dashboard_authority: "hr", permissions: {} })).toThrow();
    expect(() => validateAccessContext(null)).toThrow();
  });

  it("parses override payloads and drops unknown keys and effects", () => {
    expect(parsePermissionOverrides({ "tasks.view": "deny", "crm.view": "maybe", "x.y": "grant" })).toEqual({ "tasks.view": "deny" });
  });
});
