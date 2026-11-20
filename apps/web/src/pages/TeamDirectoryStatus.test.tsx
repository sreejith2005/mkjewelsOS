// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ manage: true, update: vi.fn() }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ access: { profileId: "actor", permissions: { "users.manage": mocks.manage } }, profile: { tenant_id: "tenant", user_role: "admin" } }) }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: vi.fn() }));
vi.mock("@/lib/useMediaQuery", () => ({ useMediaQuery: () => true }));
vi.mock("@/pages/UserManagementPage", () => ({ AddUserForm: () => null, EditUser: () => null }));
vi.mock("@jewelos/data/users/api", () => ({ updateUserProfile: mocks.update }));
vi.mock("@jewelos/api-client", () => ({ supabase: { from: (table: string) => {
  const person = (id: string, name: string, account_status: string, working_status = "active") => ({ id, employee_name: name, employee_code: id, email: `${id}@example.invalid`, department_id: "dept", branch_id: "branch", account_status, working_status, user_role: "staff" });
  const records: Record<string, unknown[]> = {
    user_profiles: [person("asha", "Asha", "active"), person("ravi", "Ravi", "inactive"), person("old", "Old", "suspended"), person("actor", "Actor", "active")],
    departments: [{ id: "dept", branch_id: "branch", name: "Sales" }], branches: [{ id: "branch", name: "Branch" }], dropdown_masters: [],
  };
  const chain = { select: () => chain, eq: () => chain, is: () => chain, order: async () => ({ data: records[table] ?? [], error: null }) }; return chain;
} } }));
import { TeamDirectoryPage } from "./TeamDirectoryPage";
afterEach(() => { cleanup(); vi.resetAllMocks(); mocks.manage = true; });
const status = (name: string) => screen.getByRole("switch", { name: `${name} account active` });

it("switches an account between Active and Inactive through the audited profile update", async () => {
  mocks.update.mockResolvedValue(undefined);
  render(<TeamDirectoryPage />); await act(async () => {});
  expect(status("Asha").getAttribute("aria-checked")).toBe("true");
  expect(status("Ravi").getAttribute("aria-checked")).toBe("false");
  // An older Suspended account cannot sign in, so it reads as Inactive.
  expect(status("Old").getAttribute("aria-checked")).toBe("false");
  expect(screen.queryByText(/suspended/i)).toBeNull();
  fireEvent.click(status("Asha")); await act(async () => {});
  expect(mocks.update).toHaveBeenCalledWith("asha", { account_status: "inactive" });
  fireEvent.click(status("Ravi")); await act(async () => {});
  expect(mocks.update).toHaveBeenCalledWith("ravi", { account_status: "active" });
});

it("never offers the switch on your own account or to people who cannot manage users", async () => {
  render(<TeamDirectoryPage />); await act(async () => {});
  expect(screen.queryByRole("switch", { name: "Actor account active" })).toBeNull();
  cleanup(); mocks.manage = false;
  render(<TeamDirectoryPage />); await act(async () => {});
  expect(screen.queryAllByRole("switch")).toHaveLength(0);
  expect(screen.getAllByText("Inactive").length).toBe(2);
});

it("shows the server's refusal and keeps the saved state", async () => {
  mocks.update.mockRejectedValue(new Error("At least one active super_admin is required"));
  render(<TeamDirectoryPage />); await act(async () => {});
  fireEvent.click(status("Asha")); await act(async () => {});
  expect(screen.getByText("At least one active super_admin is required")).toBeTruthy();
  expect(status("Asha").getAttribute("aria-checked")).toBe("true");
});
