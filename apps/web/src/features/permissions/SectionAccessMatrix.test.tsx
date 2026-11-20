// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), desktop: true }));
vi.mock("./api", () => ({ fetchSectionAccessMatrix: mocks.read, saveSectionAccessBulk: mocks.save }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));
vi.mock("@/lib/useMediaQuery", () => ({ useMediaQuery: () => mocks.desktop }));
import { SectionAccessMatrix } from "./SectionAccessMatrix";
afterEach(() => { cleanup(); vi.resetAllMocks(); mocks.desktop = true; });

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
const cell = (name: string) => screen.getByRole("switch", { name }) as HTMLButtonElement;
const checked = (name: string) => cell(name).getAttribute("aria-checked");

it("shows every employee's current state as one switch per section and saves several changes at once", async () => {
  mocks.read.mockResolvedValue(matrix); mocks.save.mockResolvedValue(2);
  render(<SectionAccessMatrix {...props} />); await act(async () => {});
  expect(screen.queryByText("Former")).toBeNull();
  expect(checked("CRM for Asha")).toBe("true");
  expect(checked("Users for Asha")).toBe("false");
  expect(checked("Users for Ravi")).toBe("true");
  expect(cell("Users for Ravi").title).toBe("On · personal setting");
  expect(cell("CRM for Asha").title).toBe("On · default");

  // Turning off an inherited section stores Disable; turning Ravi's personal On off matches his default, so it clears.
  fireEvent.click(cell("CRM for Asha"));
  fireEvent.click(cell("Users for Ravi"));
  expect(checked("CRM for Asha")).toBe("false");
  expect(screen.getByText("2 changes · 2 employees")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" })); await act(async () => {});
  expect(mocks.save).toHaveBeenCalledWith({ asha: { "crm.view": "deny" }, ravi: { "users.view": null } });
  expect(screen.getByText("Section access saved for 2 employees.")).toBeTruthy();
});

it("sets a column for all shown employees but never for Super Admin or yourself", async () => {
  mocks.read.mockResolvedValue(matrix); mocks.save.mockResolvedValue(1);
  render(<SectionAccessMatrix {...props} />); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Set Users for all shown employees"), { target: { value: "on" } });
  // Ravi already has it on through his saved choice, so only Asha changes.
  expect(screen.getByText("1 change · 1 employee")).toBeTruthy();
  expect(cell("Users for Owner").disabled).toBe(true);
  expect(cell("Users for Me").disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" })); await act(async () => {});
  expect(mocks.save).toHaveBeenCalledWith({ asha: { "users.view": "grant" } });
});

it("a column reset and a person reset clear personal settings", async () => {
  mocks.read.mockResolvedValue(matrix);
  render(<SectionAccessMatrix {...props} />); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Set Users for all shown employees"), { target: { value: "reset" } });
  expect(checked("Users for Ravi")).toBe("false");
  expect(screen.getByText("1 change · 1 employee")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  fireEvent.click(screen.getByRole("button", { name: "Reset Ravi to default" }));
  expect(screen.getByText("1 change · 1 employee")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Reset Asha to default" })).toBeNull();
});

it("flipping a switch back is not a change, and Discard clears the draft", async () => {
  mocks.read.mockResolvedValue(matrix);
  render(<SectionAccessMatrix {...props} />); await act(async () => {});
  fireEvent.click(cell("Users for Ravi"));
  fireEvent.click(cell("Users for Ravi"));
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  fireEvent.click(cell("CRM for Asha"));
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(checked("CRM for Asha")).toBe("true");
});

it("filters by search and by personal settings", async () => {
  mocks.read.mockResolvedValue(matrix);
  render(<SectionAccessMatrix {...props} />); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Search section access"), { target: { value: "ravi" } });
  expect(screen.queryByRole("row", { name: /Asha/ })).toBeNull();
  expect(screen.getByRole("row", { name: /Ravi/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search section access"), { target: { value: "" } });
  fireEvent.click(screen.getByLabelText("Only personal settings"));
  expect(screen.queryByRole("row", { name: /Asha/ })).toBeNull();
  expect(screen.getByRole("row", { name: /Ravi/ })).toBeTruthy();
});

it("on a phone each person opens into a list of section switches", async () => {
  mocks.desktop = false; mocks.read.mockResolvedValue(matrix); mocks.save.mockResolvedValue(1);
  render(<SectionAccessMatrix {...props} />); await act(async () => {});
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByRole("switch", { name: "CRM for Asha" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Asha/ }));
  fireEvent.click(cell("CRM for Asha"));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" })); await act(async () => {});
  expect(mocks.save).toHaveBeenCalledWith({ asha: { "crm.view": "deny" } });
});
