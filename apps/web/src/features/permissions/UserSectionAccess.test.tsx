// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), refresh: undefined as (() => Promise<void>) | undefined }));
vi.mock("./api", () => ({ fetchUserAccessBreakdown: mocks.read, saveUserSectionAccess: mocks.save }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: ({ refresh }: { refresh: () => Promise<void> }) => { mocks.refresh = refresh; } }));
import { UserSectionAccess } from "./UserSectionAccess";
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const breakdown = { profileId: "person", employeeName: "Employee", departmentName: "Sales", effectiveRole: "staff", dashboardAuthority: "manager", rows: [{ key: "crm.view", roleDefault: false, department: "grant", designation: null, user: null, effective: true }] };
const props = { profileId: "person", selfId: "admin", tenantId: "tenant", onClose: vi.fn(), onSaved: vi.fn() };
it("lets an administrator disable CRM for an employee without an authority payload", async () => {
  mocks.read.mockResolvedValue(breakdown); mocks.save.mockResolvedValue({ ...breakdown, rows: [{ ...breakdown.rows[0], user: "deny", effective: false }] });
  render(<UserSectionAccess {...props} />); await act(async () => {});
  expect(screen.getByText("Enabled \u00b7 Department")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("CRM section access"), { target: { value: "deny" } });
  expect(screen.getByText("Disabled \u00b7 Individual")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save section access" })); await act(async () => {});
  expect(mocks.save).toHaveBeenCalledWith("person", { "crm.view": "deny" });
});
it("preserves a local edit when committed rules refresh", async () => {
  mocks.read.mockResolvedValue(breakdown);
  render(<UserSectionAccess {...props} />); await act(async () => {});
  fireEvent.change(screen.getByLabelText("CRM section access"), { target: { value: "deny" } });
  await act(async () => { await mocks.refresh?.(); });
  expect((screen.getByLabelText("CRM section access") as HTMLSelectElement).value).toBe("deny");
});
it("keeps self access locked", async () => {
  mocks.read.mockResolvedValue(breakdown);
  render(<UserSectionAccess {...props} selfId="person" />); await act(async () => {});
  expect((screen.getByLabelText("CRM section access") as HTMLSelectElement).disabled).toBe(true);
});
it("ignores a delayed old employee response", async () => {
  let resolve: ((value: typeof breakdown) => void) | undefined;
  mocks.read.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ ...breakdown, profileId: "new", employeeName: "New employee" });
  const view = render(<UserSectionAccess {...props} />);
  view.rerender(<UserSectionAccess {...props} profileId="new" />); await act(async () => {});
  await act(async () => { resolve?.(breakdown); });
  expect(screen.getByText(/New employee/)).toBeTruthy();
  expect(screen.queryByText("Employee")).toBeNull();
});
