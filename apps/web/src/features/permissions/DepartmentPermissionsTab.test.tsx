// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("./api", () => ({ saveDepartmentPermissions: mocks.save }));
import { DepartmentPermissionsTab } from "./DepartmentPermissionsTab";
import type { PermissionAdminContext } from "./api";
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const context: PermissionAdminContext = { roles: [], rolePermissions: {}, designations: [], designationOverrides: {}, users: [], departments: [{ id: "a", name: "Sales", branchName: "Branch A" }, { id: "b", name: "Sales", branchName: "Branch B" }], departmentOverrides: { a: { "crm.view": "grant" } } };
it("disambiguates departments and saves a department denial", async () => {
  render(<DepartmentPermissionsTab context={context} onSaved={vi.fn()} />);
  expect(screen.getByRole("option", { name: "Sales · Branch B" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("CRM department access"), { target: { value: "deny" } });
  fireEvent.click(screen.getByRole("button", { name: "Save department access" })); await act(async () => {});
  expect(mocks.save).toHaveBeenCalledWith("a", { "crm.view": "deny" });
});
it("reset to Inherit removes a persisted grant", async () => {
  render(<DepartmentPermissionsTab context={context} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("CRM department access"), { target: { value: "inherit" } });
  fireEvent.click(screen.getByRole("button", { name: "Save department access" })); await act(async () => {});
  expect(mocks.save).toHaveBeenCalledWith("a", { "crm.view": null });
});
it("retains draft through context refresh and clears on department switch", () => {
  const view = render(<DepartmentPermissionsTab context={context} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("CRM department access"), { target: { value: "deny" } });
  view.rerender(<DepartmentPermissionsTab context={{ ...context }} onSaved={vi.fn()} />);
  expect((screen.getByLabelText("CRM department access") as HTMLSelectElement).value).toBe("deny");
  fireEvent.change(screen.getByLabelText("Department"), { target: { value: "b" } });
  expect((screen.getByLabelText("CRM department access") as HTMLSelectElement).value).toBe("inherit");
});
