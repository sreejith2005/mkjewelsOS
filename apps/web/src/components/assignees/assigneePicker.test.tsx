// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssigneePicker } from "./AssigneePicker";

describe("AssigneePicker", () => {
  it("searches across name, code, branch, department, and role while showing organization context", async () => {
    const user = userEvent.setup();
    render(<AssigneePicker
      branchNames={new Map([["branch-1", "Bandra"]])}
      departmentNames={new Map([["department-1", "Sales"]])}
      label="Assign user"
      multiple={false}
      onChange={vi.fn()}
      people={[{ branch_id: "branch-1", department_id: "department-1", employee_code: "MK-101", employee_name: "Ananya Shah", id: "user-1", user_role: "staff" }]}
      selectedIds={[]}
    />);

    await user.type(screen.getByRole("textbox", { name: "Search assign user" }), "bandra");

    expect(screen.getByText("Ananya Shah")).toBeTruthy();
    expect(screen.getByText("Sales · Bandra · Staff")).toBeTruthy();
  });
});
