import { expect, it } from "vitest";
import { resolvePermissions, resolvePageAccess, getAccessibleMenu, DEFAULT_SECTION_CONTROLS, previewSectionAccess, type AccessContext } from "@jewelos/core";
it("department CRM grant reaches native drawer and direct destination", () => {
  const access: AccessContext = { profileId: "employee", baseRole: "staff", effectiveRole: "staff", dashboardAuthority: null, permissions: resolvePermissions({ role: "staff", dashboardAuthority: null, departmentOverrides: { "crm.view": "grant" } }) };
  expect(getAccessibleMenu(access, DEFAULT_SECTION_CONTROLS).some(item => item.id === "crm")).toBe(true);
  expect(resolvePageAccess(access, DEFAULT_SECTION_CONTROLS, "crm")).toBe("allowed");
  const denied: AccessContext = { ...access, permissions: resolvePermissions({ role: "staff", dashboardAuthority: null, departmentOverrides: { "crm.view": "grant" }, userOverrides: { "crm.view": "deny" } }) };
  expect(getAccessibleMenu(denied, DEFAULT_SECTION_CONTROLS).some(item => item.id === "crm")).toBe(false);
  expect(resolvePageAccess(denied, DEFAULT_SECTION_CONTROLS, "crm")).toBe("denied");
});
it("native individual inherit previews the department rule", () => {
  expect(previewSectionAccess({ key: "crm.view", roleDefault: false, department: "grant", designation: null, user: "deny", effective: false }, null, "staff")).toEqual({ effective: true, source: "Department" });
});
