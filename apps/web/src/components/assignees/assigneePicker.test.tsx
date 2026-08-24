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

  it("selects one user with the keyboard and explains an empty search", async () => {
    const user = userEvent.setup(); const onChange = vi.fn();
    render(<AssigneePicker branchNames={new Map([["b", "Bandra"]])} departmentNames={new Map([["d", "Sales"]])} label="Assigned CRM" multiple={false} onChange={onChange} people={[{ branch_id: "b", department_id: "d", employee_code: "MK-8", employee_name: "Asha", id: "asha", user_role: "crm" }]} selectedIds={[]}/>);
    screen.getByRole("radio", { name: "Asha" }).focus(); await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(["asha"]);
    await user.clear(screen.getByRole("textbox", { name: "Search assigned crm" })); await user.type(screen.getByRole("textbox", { name: "Search assigned crm" }), "nobody");
    expect(screen.getByText("No matching people.")).toBeTruthy();
  });
});
