// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock("./api", () => ({ fetchSectionAccessMatrix: mocks.read, saveSectionAccessBulk: mocks.save }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));
import { SectionAccessMatrix } from "./SectionAccessMatrix";
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const user = (id: string, name: string, extra: object = {}) => ({
  id, employeeName: name, employeeCode: id.toUpperCase(), branchId: "bandra", departmentId: "sales",
  accountStatus: "active", workingStatus: "active", effectiveRole: "staff", overrides: {}, inherited: { "crm.view": true, "users.view": false }, ...extra,
});
const matrix = {
  sections: ["crm.view", "users.view"],
  users: [
    user("asha", "Asha"),
    user("ravi", "Ravi", { overrides: { "users.view": "grant" } }),
    user("owner", "Owner", { effectiveRole: "super_admin" }),
    user("me", "Me"),
    user("left", "Former", { accountStatus: "left" }),
  ],
};
const props = { selfId: "me", tenantId: "tenant", branches: [{ id: "bandra", name: "Bandra" }], departments: [{ id: "sales", name: "Sales", branch_id: null }] };
const radio = (name: string) => screen.getByRole("radio", { name });

it("shows every employee's current state and saves several choices at once", async () => {
  mocks.read.mockResolvedValue(matrix); mocks.save.mockResolvedValue(2);
  render(<SectionAccessMatrix {...props} />); await act(async () => {});
  expect(screen.queryByText("Former")).toBeNull();
  const asha = within(screen.getByRole("row", { name: /Asha/ }));
  expect(asha.getAllByText("On").length).toBeGreaterThan(0);
  expect(radio("Inherit: CRM for Asha").getAttribute("aria-checked")).toBe("true");
  expect(radio("On: Users for Ravi").getAttribute("aria-checked")).toBe("true");

  fireEvent.click(radio("Off: CRM for Asha"));
  fireEvent.click(radio("Inherit: Users for Ravi"));
  expect(screen.getByText("2 changes · 2 employees")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" })); await act(async () => {});
  expect(mocks.save).toHaveBeenCalledWith({ asha: { "crm.view": "deny" }, ravi: { "users.view": null } });
  expect(screen.getByText("Section access saved for 2 employees.")).toBeTruthy();
});

it("sets a column for all shown employees but never for Super Admin or yourself", async () => {
  mocks.read.mockResolvedValue(matrix); mocks.save.mockResolvedValue(2);
  render(<SectionAccessMatrix {...props} />); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Set Users for all shown employees"), { target: { value: "grant" } });
  // Ravi already has On saved, so only Asha changes.
  expect(screen.getByText("1 change · 1 employee")).toBeTruthy();
  expect((radio("Off: Users for Owner") as HTMLButtonElement).disabled).toBe(true);
  expect((radio("Off: Users for Me") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" })); await act(async () => {});
  expect(mocks.save).toHaveBeenCalledWith({ asha: { "users.view": "grant" } });
});

it("choosing the saved value again is not a change, and Discard clears the draft", async () => {
  mocks.read.mockResolvedValue(matrix);
  render(<SectionAccessMatrix {...props} />); await act(async () => {});
  fireEvent.click(radio("Off: Users for Ravi"));
  fireEvent.click(radio("On: Users for Ravi"));
  expect(screen.getByText("No changes")).toBeTruthy();
  fireEvent.click(radio("Off: CRM for Asha"));
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(radio("Inherit: CRM for Asha").getAttribute("aria-checked")).toBe("true");
});

it("filters by search", async () => {
  mocks.read.mockResolvedValue(matrix);
  render(<SectionAccessMatrix {...props} />); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Search section access"), { target: { value: "ravi" } });
  expect(screen.queryByRole("row", { name: /Asha/ })).toBeNull();
  expect(screen.getByRole("row", { name: /Ravi/ })).toBeTruthy();
});
