// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UserFilterEditor } from "./UserFilterEditor";
afterEach(cleanup);

const SALES = "11111111-1111-4111-8111-111111111111";
const options = { users: [{ id: "1", label: "Asha", departmentId: SALES }, { id: "2", label: "Ravi" }], branches: [], departments: [{ id: SALES, branchId: null, label: "Sales" }], masters: [] };

it("starts a Department Is in rule so several departments can be selected", () => {
  const onChange = vi.fn();
  const { rerender } = render(<UserFilterEditor onChange={onChange} options={options} value={undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
  const added = onChange.mock.calls[0]![0];
  expect(added).toEqual({ match: "all", rules: [{ attribute: "department", operator: "in", values: [] }] });
  rerender(<UserFilterEditor onChange={onChange} options={options} value={added} />);
  expect(screen.getByRole("alert").textContent).toMatch(/Choose a value/);
  fireEvent.click(screen.getByRole("checkbox", { name: "Sales" }));
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

it("selects Sales and CRM as alternatives within one Department rule", () => {
  const CRM = "22222222-2222-4222-8222-222222222222";
  const both = { ...options, users: [{ id: "1", label: "Asha", departmentId: SALES }, { id: "2", label: "Ravi", departmentId: CRM }], departments: [...options.departments, { id: CRM, branchId: null, label: "CRM" }] };
  const onChange = vi.fn();
  const { rerender } = render(<UserFilterEditor onChange={onChange} options={both} value={undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
  rerender(<UserFilterEditor onChange={onChange} options={both} value={onChange.mock.calls.at(-1)![0]} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Sales" }));
  rerender(<UserFilterEditor onChange={onChange} options={both} value={onChange.mock.calls.at(-1)![0]} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "CRM" }));
  const chosen = onChange.mock.calls.at(-1)![0];
  expect(chosen).toEqual({ match: "all", rules: [{ attribute: "department", operator: "in", values: [SALES, CRM] }] });
  rerender(<UserFilterEditor onChange={onChange} options={both} value={chosen} />);
  expect(screen.getByText("2 of 2 people you can see match.")).toBeTruthy();
});
