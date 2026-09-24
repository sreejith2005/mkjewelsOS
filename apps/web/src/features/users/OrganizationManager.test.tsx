// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationData } from "@jewelos/data/users/organization";
import { OrganizationManager } from "./OrganizationManager";

const api = vi.hoisted(() => ({ saveBranch: vi.fn(), saveDepartment: vi.fn() }));
vi.mock("@jewelos/data/users/organization", () => api);

const data: OrganizationData = {
  branches: [{ id: "branch-1", name: "Main", code: "MAIN", address: null, city: null, state: null, pincode: null, manager_id: null, is_active: true }],
  departments: [{ id: "department-1", name: "Sales", code: "SALES", branch_id: "branch-1", head_id: null, is_active: true }],
  people: [{ id: "person-1", employee_name: "Asha", branch_id: "branch-1", department_id: "department-1", account_status: "active" }],
};

describe("OrganizationManager", () => {
  beforeEach(() => { vi.clearAllMocks(); api.saveDepartment.mockResolvedValue(undefined); });
  afterEach(cleanup);

  it("creates a scoped department through the audited API and refreshes the directory", async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<OrganizationManager data={data} onChanged={onChanged} />);
    expect(screen.getByText(/SALES · Main · 1 people/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add department" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Repairs" } });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "REPAIRS" } });
    fireEvent.change(screen.getByLabelText("Branch scope"), { target: { value: "branch-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveDepartment).toHaveBeenCalledWith(null, { name: "Repairs", code: "REPAIRS", branch_id: "branch-1", head_id: null, is_active: true }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("keeps the editor open with the server's reason when a department cannot be changed", async () => {
    api.saveDepartment.mockRejectedValue(new Error("Move employees before deactivating this department"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<OrganizationManager data={data} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Sales" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Active" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Move employees before deactivating this department")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    vi.restoreAllMocks();
  });
});
