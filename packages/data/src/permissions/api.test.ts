import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@jewelos/api-client/client", () => ({ getSupabase: () => ({ rpc: mocks.rpc }) }));
import { fetchPermissionAdminContext, fetchUserAccessBreakdown, saveDepartmentPermissions, saveUserSectionAccess } from "./api";
beforeEach(() => mocks.rpc.mockReset());
const result = { profile: { id: "p", employee_name: "Employee", base_role: "staff", department_id: "d", department_name: "Sales" }, effective_role: "staff", dashboard_authority: "manager", rows: [{ key: "crm.view", department: "grant", effective: true }] };
it("loads departments with branch labels and module overrides", async () => {
  mocks.rpc.mockResolvedValue({ data: { departments: [{ id: "d", name: "Sales", branch_name: "Branch" }], department_overrides: [{ department_id: "d", key: "crm.view", effect: "grant" }] }, error: null });
  expect(await fetchPermissionAdminContext()).toMatchObject({ departments: [{ id: "d", name: "Sales", branchName: "Branch" }], departmentOverrides: { d: { "crm.view": "grant" } } });
});
it("parses department explanations from the server", async () => {
  mocks.rpc.mockResolvedValue({ data: result, error: null });
  expect(await fetchUserAccessBreakdown("p")).toMatchObject({ departmentId: "d", departmentName: "Sales", rows: [{ key: "crm.view", department: "grant" }] });
});
it("saves section overrides through a narrow RPC without an authority argument", async () => {
  mocks.rpc.mockResolvedValue({ data: result, error: null });
  await saveUserSectionAccess("p", { "crm.view": "grant" });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("save_user_section_access_with_audit", { p_profile_id: "p", p_overrides: { "crm.view": "grant" } });
});
it("resets a department rule with null through its audited RPC", async () => {
  mocks.rpc.mockResolvedValue({ data: {}, error: null });
  await saveDepartmentPermissions("d", { "crm.view": null });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("save_department_permissions_with_audit", { p_department_id: "d", p_overrides: { "crm.view": null } });
});
