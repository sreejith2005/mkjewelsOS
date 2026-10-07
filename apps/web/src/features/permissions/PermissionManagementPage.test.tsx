// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PermissionAdminContext, UserAccessBreakdown } from "./api";
import { PermissionManagementPage } from "./PermissionManagementPage";

const mocks = vi.hoisted(() => ({ context: vi.fn(), departmentSave: vi.fn(), breakdown: vi.fn(), save: vi.fn(), refresh: undefined as (() => Promise<void>) | undefined }));
vi.mock("./api", () => ({ fetchPermissionAdminContext: mocks.context, fetchUserAccessBreakdown: mocks.breakdown, saveDesignationPermissions: vi.fn(), saveRolePermissions: vi.fn(), saveUserAccess: mocks.save, saveDepartmentPermissions: mocks.departmentSave }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ access: { permissions: { "permissions.manage": true }, profileId: "actor" }, profile: { tenant_id: "tenant" }, refreshAccess: vi.fn() }) }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: ({ refresh }: { refresh: () => Promise<void> }) => { mocks.refresh = refresh; } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); mocks.refresh = undefined; });

const context: PermissionAdminContext = { departments: [], departmentOverrides: {}, roles: ["staff"], rolePermissions: {}, designations: [], designationOverrides: {}, users: [{ id: "target", employeeName: "Synthetic User", employeeCode: "TEST", role: "staff", designationId: null, accountStatus: "active", dashboardAuthority: null, overrideCount: 0 }] };
const breakdown: UserAccessBreakdown = { profileId: "target", employeeName: "Synthetic User", employeeCode: "TEST", baseRole: "staff", departmentId: null, departmentName: null, designationId: null, designationLabel: null, dashboardAuthority: null, effectiveRole: "staff", rows: [{ key: "tasks.view", roleDefault: true, roleConfigured: false, department: null, designation: null, user: null, effective: true }] };

it("refreshes the selected user's committed access while preserving local authority and override edits", async () => {
  mocks.context.mockResolvedValue(context);
  mocks.breakdown.mockResolvedValue(breakdown);
  render(<PermissionManagementPage onBack={() => {}} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Users" }));
  fireEvent.click(screen.getByRole("button", { name: /Synthetic User/ }));
  await act(async () => {});
  fireEvent.click(screen.getByRole("radio", { name: "Manager" }));
  const override = screen.getByLabelText("Open Tasks override for Synthetic User");
  fireEvent.change(override, { target: { value: "deny" } });
  mocks.context.mockResolvedValue({ ...context });
  mocks.breakdown.mockResolvedValue({ ...breakdown, employeeName: "Updated User", dashboardAuthority: "admin", effectiveRole: "admin" });
  await act(async () => { await mocks.refresh?.(); });
  expect(mocks.breakdown).toHaveBeenCalledTimes(2);
  expect((screen.getByRole("radio", { name: "Manager" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText("Open Tasks override for Updated User") as HTMLSelectElement).value).toBe("deny");
  fireEvent.click(screen.getByRole("button", { name: /Synthetic User/ }));
  expect((screen.getByLabelText("Open Tasks override for Updated User") as HTMLSelectElement).value).toBe("deny");
});

it("adopts remote authority when the selected user's editor is clean", async () => {
  mocks.context.mockResolvedValue(context);
  mocks.breakdown.mockResolvedValue(breakdown);
  render(<PermissionManagementPage onBack={() => {}} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Users" }));
  fireEvent.click(screen.getByRole("button", { name: /Synthetic User/ }));
  await act(async () => {});
  mocks.context.mockResolvedValue({ ...context });
  mocks.breakdown.mockResolvedValue({ ...breakdown, dashboardAuthority: "manager", effectiveRole: "manager" });
  await act(async () => { await mocks.refresh?.(); });
  expect((screen.getByRole("radio", { name: "Manager" }) as HTMLInputElement).checked).toBe(true);
});

it("ignores a delayed breakdown after another user is selected", async () => {
  let finish: ((value: UserAccessBreakdown) => void) | undefined;
  mocks.context.mockResolvedValue({ ...context, users: [...context.users, { ...context.users[0], id: "other", employeeName: "Other User" }] });
  mocks.breakdown.mockImplementationOnce(() => new Promise<UserAccessBreakdown>((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce({ ...breakdown, profileId: "other", employeeName: "Other User" });
  render(<PermissionManagementPage onBack={() => {}} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Users" }));
  fireEvent.click(screen.getByRole("button", { name: /Synthetic User/ }));
  fireEvent.click(screen.getByRole("button", { name: /Other User/ }));
  await act(async () => {});
  await act(async () => { finish?.(breakdown); });
  expect(screen.queryByLabelText("Open Tasks override for Other User")).not.toBeNull();
  expect(screen.queryByLabelText("Open Tasks override for Synthetic User")).toBeNull();
});

it("ignores a delayed save after selection changes", async () => {
  let finish: ((value: UserAccessBreakdown) => void) | undefined;
  mocks.context.mockResolvedValue({ ...context, users: [...context.users, { ...context.users[0], id: "other", employeeName: "Other User" }] });
  mocks.breakdown.mockResolvedValueOnce(breakdown).mockResolvedValue({ ...breakdown, profileId: "other", employeeName: "Other User" });
  mocks.save.mockImplementation(() => new Promise<UserAccessBreakdown>((resolve) => { finish = resolve; }));
  render(<PermissionManagementPage onBack={() => {}} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Users" }));
  fireEvent.click(screen.getByRole("button", { name: /Synthetic User/ }));
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Open Tasks override for Synthetic User"), { target: { value: "deny" } });
  fireEvent.click(screen.getByRole("button", { name: "Save access" }));
  fireEvent.click(screen.getByRole("button", { name: /Other User/ }));
  await act(async () => {});
  await act(async () => { finish?.(breakdown); });
  expect(screen.queryByLabelText("Open Tasks override for Other User")).not.toBeNull();
  expect(screen.queryByLabelText("Open Tasks override for Synthetic User")).toBeNull();
});

it("retains override edits made while an earlier save is pending", async () => {
  let finish: ((value: UserAccessBreakdown) => void) | undefined;
  mocks.context.mockResolvedValue(context);
  mocks.breakdown.mockResolvedValue(breakdown);
  mocks.save.mockImplementation(() => new Promise<UserAccessBreakdown>((resolve) => { finish = resolve; }));
  render(<PermissionManagementPage onBack={() => {}} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Users" }));
  fireEvent.click(screen.getByRole("button", { name: /Synthetic User/ }));
  await act(async () => {});
  fireEvent.change(screen.getByLabelText("Open Tasks override for Synthetic User"), { target: { value: "deny" } });
  fireEvent.click(screen.getByRole("button", { name: "Save access" }));
  fireEvent.change(screen.getByLabelText("Open Tasks override for Synthetic User"), { target: { value: "grant" } });
  await act(async () => { finish?.({ ...breakdown, rows: breakdown.rows.map((row) => ({ ...row, user: "deny", effective: false })) }); });
  expect((screen.getByLabelText("Open Tasks override for Synthetic User") as HTMLSelectElement).value).toBe("grant");
});

it("does not replace a successful save with an older background read", async () => {
  let finishRead: ((value: UserAccessBreakdown) => void) | undefined;
  let finishContext: ((value: PermissionAdminContext) => void) | undefined;
  const saved: UserAccessBreakdown = { ...breakdown, rows: breakdown.rows.map((row) => ({ ...row, user: "deny", effective: false })) };
  mocks.context.mockResolvedValueOnce(context).mockResolvedValueOnce({ ...context })
    .mockImplementationOnce(() => new Promise<PermissionAdminContext>((resolve) => { finishContext = resolve; }));
  mocks.breakdown.mockResolvedValueOnce(breakdown)
    .mockImplementationOnce(() => new Promise<UserAccessBreakdown>((resolve) => { finishRead = resolve; }))
    .mockResolvedValue(saved);
  mocks.save.mockResolvedValue(saved);
  render(<PermissionManagementPage onBack={() => {}} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Users" }));
  fireEvent.click(screen.getByRole("button", { name: /Synthetic User/ }));
  await act(async () => {});
  await act(async () => { await mocks.refresh?.(); });
  fireEvent.change(screen.getByLabelText("Open Tasks override for Synthetic User"), { target: { value: "deny" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save access" })); });
  await act(async () => { finishRead?.(breakdown); });
  expect((screen.getByLabelText("Open Tasks override for Synthetic User") as HTMLSelectElement).value).toBe("deny");
  await act(async () => { finishContext?.({ ...context }); });
});

it("allows retrying the same user after the initial breakdown read fails", async () => {
  mocks.context.mockResolvedValue(context);
  mocks.breakdown.mockRejectedValueOnce(new Error("Temporary read failure")).mockResolvedValueOnce(breakdown);
  render(<PermissionManagementPage onBack={() => {}} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Users" }));
  fireEvent.click(screen.getByRole("button", { name: /Synthetic User/ }));
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /Synthetic User/ }));
  await act(async () => {});
  expect(screen.queryByLabelText("Open Tasks override for Synthetic User")).not.toBeNull();
});

it("ignores a delayed pre-save department context after the committed refresh", async () => {
  const before: PermissionAdminContext = { ...context, departments: [{ id: "sales", name: "Sales", branchName: null }] };
  const after: PermissionAdminContext = { ...before, departmentOverrides: { sales: { "crm.view": "grant" } } };
  let resolve: ((value: PermissionAdminContext) => void) | undefined;
  mocks.context.mockResolvedValueOnce(before).mockImplementationOnce(() => new Promise<PermissionAdminContext>(r => { resolve = r; })).mockResolvedValue(after);
  render(<PermissionManagementPage onBack={() => {}} />); await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Departments" }));
  let oldRead: Promise<void> | undefined;
  act(() => { oldRead = mocks.refresh?.(); });
  fireEvent.change(screen.getByLabelText("CRM department access"), { target: { value: "grant" } });
  fireEvent.click(screen.getByRole("button", { name: "Save department access" })); await act(async () => {});
  await act(async () => { resolve?.(before); await oldRead; });
  expect((screen.getByLabelText("CRM department access") as HTMLSelectElement).value).toBe("grant");
});
