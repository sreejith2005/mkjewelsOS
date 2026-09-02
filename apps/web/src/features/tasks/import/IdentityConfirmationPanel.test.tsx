// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { IdentityConfirmationPanel } from "./IdentityConfirmationPanel";

const candidate = (id: string, email: string) => ({ id, employee_name: "Duplicate Person", email, branch_id: "branch", department_id: "department", manager_id: null, import_aliases: [] });

it("asks once for an unresolved name and shows its affected row count", () => {
  const onConfirm = vi.fn();
  render(<IdentityConfirmationPanel busy={false} candidates={[candidate("one", "one@example.com"), candidate("two", "two@example.com")]} onConfirm={onConfirm} unresolved={[{ label: "Duplicate Person", source_rows: Array.from({ length: 142 }, (_, index) => index + 2) }]} />);

  expect(screen.getByText("142 rows")).toBeTruthy();
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "two" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm and remember" }));
  expect(onConfirm).toHaveBeenCalledWith("Duplicate Person", "two");
});
