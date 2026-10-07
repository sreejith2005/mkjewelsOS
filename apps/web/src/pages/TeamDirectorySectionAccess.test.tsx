// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ manage: true }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ access: { profileId: "actor", permissions: { "permissions.manage": mocks.manage } }, profile: { tenant_id: "tenant" } }) }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: vi.fn() }));
vi.mock("@/features/permissions/UserSectionAccess", () => ({ UserSectionAccess: ({ profileId }: { profileId: string }) => <div>Editing sections for {profileId}</div> }));
vi.mock("@/pages/UserManagementPage", () => ({ AddUserForm: () => null, EditUser: () => null }));
vi.mock("@jewelos/api-client", () => ({ supabase: { from: (table: string) => {
  const records: Record<string, unknown[]> = { user_profiles: [{ id: "person", employee_name: "Employee", employee_code: "E1", email: "test@example.invalid", department_id: "dept", branch_id: "branch", account_status: "active", working_status: "active", user_role: "staff" }], departments: [{ id: "dept", branch_id: "branch", name: "Sales" }], branches: [{ id: "branch", name: "Branch" }], dropdown_masters: [] };
  const chain = { select: () => chain, eq: () => chain, order: async () => ({ data: records[table] ?? [], error: null }) }; return chain;
} } }));
import { TeamDirectoryPage } from "./TeamDirectoryPage";
afterEach(() => { cleanup(); mocks.manage = true; });
it("opens the employee-specific section editor from within Users", async () => {
  render(<TeamDirectoryPage />); await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Section access for Employee" }));
  expect(screen.getByText("Editing sections for person")).toBeTruthy();
});
it("does not expose section administration to ordinary directory readers", async () => {
  mocks.manage = false; render(<TeamDirectoryPage />); await act(async () => {});
  expect(screen.queryByRole("button", { name: "Section access for Employee" })).toBeNull();
});
