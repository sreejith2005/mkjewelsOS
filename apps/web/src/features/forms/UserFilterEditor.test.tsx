// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UserFilterEditor } from "./UserFilterEditor";
afterEach(cleanup);

const SALES = "11111111-1111-4111-8111-111111111111";
const options = { users: [{ id: "1", label: "Asha", departmentId: SALES }, { id: "2", label: "Ravi" }], branches: [], departments: [{ id: SALES, branchId: null, label: "Sales" }], masters: [] };

it("adds a Department is equal to Sales rule", () => {
  const onChange = vi.fn();
  const { rerender } = render(<UserFilterEditor onChange={onChange} options={options} value={undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
  const added = onChange.mock.calls[0]![0];
  expect(added).toEqual({ match: "all", rules: [{ attribute: "department", operator: "equals", values: [] }] });
  rerender(<UserFilterEditor onChange={onChange} options={options} value={added} />);
  expect(screen.getByRole("alert").textContent).toMatch(/Choose a value/);
  fireEvent.change(screen.getByLabelText("Rule 1 value"), { target: { value: SALES } });
  const chosen = onChange.mock.calls.at(-1)![0];
  expect(chosen.rules[0].values).toEqual([SALES]);
  rerender(<UserFilterEditor onChange={onChange} options={options} value={chosen} />);
  expect(screen.getByText("1 of 2 people you can see match.")).toBeTruthy();
});

it("removing the last rule clears the filter", () => {
  const onChange = vi.fn();
  render(<UserFilterEditor onChange={onChange} options={options} value={{ match: "all", rules: [{ attribute: "role", operator: "equals", values: ["staff"] }] }} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove rule 1" }));
  expect(onChange).toHaveBeenCalledWith(undefined);
});
