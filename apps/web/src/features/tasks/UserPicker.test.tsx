// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserPicker } from "./UserPicker";

describe("UserPicker", () => {
  it("shows each employee's profile and searchable organization context", () => {
    render(<UserPicker branchNames={new Map([["branch-1", "Bandra"]])} departmentNames={new Map([["department-1", "Sales"]])} disabledIds={[]} label="Eligible users" onChange={vi.fn()} selectedIds={[]} users={[{ branch_id: "branch-1", buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "department-1", employee_code: "MK-101", employee_name: "Ananya Shah", first_name: "Ananya", id: "user-1", last_name: "Shah", tenant_id: "tenant-1", user_role: "staff", working_status: "active" }]}/>);

    expect(screen.getByText("Ananya Shah")).toBeTruthy();
    expect(screen.getByText("Sales · Bandra · Staff")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search eligible users" }), { target: { value: "sales" } });
    expect(screen.getByText("Ananya Shah")).toBeTruthy();
  });
});
