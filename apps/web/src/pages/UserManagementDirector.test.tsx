// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MyOrgScope } from "@jewelos/core";
import type { Branch, Department, UserProfile } from "@/types";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), saveDirector: vi.fn(), endDirector: vi.fn() }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ access: { permissions: { "users.manage": true } } }) }));
vi.mock("@jewelos/api-client", () => ({ supabase: { functions: { invoke: mocks.invoke }, rpc: mocks.rpc } }));
vi.mock("@/lib/edgeSession", () => ({ refreshSessionForSensitiveAction: vi.fn(async () => undefined) }));
vi.mock("@jewelos/data/users/franchise", () => ({ saveDirector: mocks.saveDirector, endDirector: mocks.endDirector }));
import { AddUserForm, EditUser } from "./UserManagementPage";

const branches = [
  { id: "bandra", name: "Bandra", is_active: true, franchise_group_id: "mum" },
  { id: "andheri", name: "Andheri", is_active: true, franchise_group_id: "mum" },
  { id: "ahd1", name: "Ahmedabad CG Road", is_active: true, franchise_group_id: "ahd" },
  { id: "ahd2", name: "Ahmedabad SG Highway", is_active: true, franchise_group_id: "ahd" },
] as Branch[];
const franchises = [{ id: "mum", name: "Mumbai", is_active: true }, { id: "ahd", name: "Ahmedabad", is_active: true }];
const departments = [{ id: "sales", name: "Sales", branch_id: null, is_active: true }] as Department[];
const scope = (companyScope: boolean): MyOrgScope => ({ enforcementEnabled: true, companyScope, branchId: "bandra", franchiseGroupId: "mum", authorities: [], readableBranchIds: [], manageableBranchIds: ["bandra", "andheri"] });
const data = (companyScope: boolean) => ({ profiles: [], branches, departments, dropdowns: [], franchises, scope: scope(companyScope) });
const director: UserProfile = {
  id: "yash", auth_user_id: "auth", tenant_id: "tenant", branch_id: "ahd1", department_id: "leadership", employee_name: "Yash Test", employee_code: "MK-9", email: "yash@example.in",
  user_role: "admin", account_status: "active", working_status: "active", is_login_enabled: true, week_off: [], buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null,
  designation_id: null, first_name: null, last_name: null, username: null, personal_email: null, official_email: null, personal_mobile: null, removed_at: null, removed_by: null,
  official_mobile: null, created_at: null, updated_at: null, created_by: null, updated_by: null,
};
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("lets an Admin create a Director for whole franchises without a department, designation or single store", async () => {
  mocks.invoke.mockResolvedValue({ data: { success: true }, error: null });
  render(<AddUserForm data={data(true)} role="admin" onClose={() => {}} onDone={async () => {}} />);
  fireEvent.change(screen.getByLabelText("System role"), { target: { value: "director" } });
  expect(screen.queryByLabelText("Department")).toBeNull();
  expect(screen.queryByLabelText("Designation")).toBeNull();
  expect(screen.queryByLabelText("Store / branch")).toBeNull();
  expect(screen.queryByLabelText("Reports to")).toBeNull();
  fireEvent.click(screen.getByLabelText("Whole Ahmedabad franchise"));
  expect(screen.getByRole("status").textContent).toContain("Sees 2 stores: Ahmedabad CG Road, Ahmedabad SG Highway");
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Yash" } });
  fireEvent.change(screen.getByLabelText("Personal email"), { target: { value: "yash@example.in" } });
  fireEvent.change(screen.getByLabelText("Set login password"), { target: { value: "abc123" } });
  fireEvent.change(screen.getByLabelText("Confirm login password"), { target: { value: "abc123" } });
  fireEvent.submit(screen.getByLabelText("First name").closest("form")!);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
  const [, options] = mocks.invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
  expect(options.body).toMatchObject({ user_role: "director", department_id: "", designation_id: "", branch_id: "", director_franchise_ids: ["ahd"], director_branch_ids: [] });
});

it("combines single stores and refuses a Director with nothing chosen", async () => {
  render(<AddUserForm data={data(true)} role="admin" onClose={() => {}} onDone={async () => {}} />);
  fireEvent.change(screen.getByLabelText("System role"), { target: { value: "director" } });
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Yash" } });
  fireEvent.change(screen.getByLabelText("Personal email"), { target: { value: "yash@example.in" } });
  fireEvent.submit(screen.getByLabelText("First name").closest("form")!);
  expect(await screen.findByText("Choose at least one franchise or store for this Director.")).toBeTruthy();
  expect(mocks.invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Bandra"));
  fireEvent.click(screen.getByLabelText("Ahmedabad SG Highway"));
  expect(screen.getByRole("status").textContent).toContain("Sees 2 stores");
  // Ticking the whole franchise covers its stores (the single-store tick is folded in).
  fireEvent.click(screen.getByLabelText("Whole Ahmedabad franchise"));
  expect((screen.getByLabelText("Ahmedabad SG Highway") as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("Sees 3 stores");
});

it("does not offer Admin or Director to a Director creating users", () => {
  render(<AddUserForm data={data(false)} role="admin" onClose={() => {}} onDone={async () => {}} />);
  const options = within(screen.getByLabelText("System role")).getAllByRole("option").map((option) => option.textContent);
  expect(options).not.toContain("Director");
  expect(options).not.toContain("Admin");
  expect(screen.getByLabelText("Department")).toBeTruthy();
});

it("edits a Director's franchises and stores through the Director contract", async () => {
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.saveDirector.mockResolvedValue(undefined);
  const saved = vi.fn(async () => undefined);
  render(<EditUser data={data(true)} directorScope={{ franchiseGroupIds: ["ahd"], branchIds: [] }} onClose={() => {}} onSaved={saved} superAdmin={false} user={director} />);
  expect((screen.getByLabelText("System role") as HTMLSelectElement).value).toBe("director");
  expect(screen.queryByLabelText("Department")).toBeNull();
  expect(screen.queryByLabelText("Designation")).toBeNull();
  expect((screen.getByLabelText("Whole Ahmedabad franchise") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByLabelText("Bandra"));
  fireEvent.click(screen.getByRole("button", { name: "Save user" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const [name, args] = mocks.rpc.mock.calls[0] as [string, { p_changes: Record<string, unknown> }];
  expect(name).toBe("update_user_profile_with_audit");
  expect(Object.keys(args.p_changes).sort()).toEqual(["account_status", "employee_code", "employee_name", "official_mobile", "personal_mobile"]);
  expect(mocks.saveDirector).toHaveBeenCalledWith("yash", { franchiseGroupIds: ["ahd"], branchIds: ["bandra"] }, null, "Changed in Users");
});

it("lets an Admin turn a Director into a company-wide Admin", async () => {
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.endDirector.mockResolvedValue(undefined);
  const saved = vi.fn(async () => undefined);
  render(<EditUser data={data(true)} directorScope={{ franchiseGroupIds: ["ahd"], branchIds: [] }} onClose={() => {}} onSaved={saved} superAdmin={false} user={director} />);
  fireEvent.change(screen.getByLabelText("System role"), { target: { value: "admin" } });
  expect(screen.getByLabelText("Department")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save user" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(mocks.endDirector).toHaveBeenCalledWith("yash", "Changed to Admin in Users");
  expect(mocks.saveDirector).not.toHaveBeenCalled();
});
