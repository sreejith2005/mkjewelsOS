// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AssigningLeftPanel } from "./AssigningLeftPanel";

it("assigns an unresolved record without exposing technical import controls", () => {
  const onAssign = vi.fn();
  render(<AssigningLeftPanel
    busy={false}
    candidates={[{ id: "profile-1", employee_name: "Employee One", email: "employee@example.invalid", branch_id: "branch-1", department_id: "department-1", manager_id: null, import_aliases: [] }]}
    onAssign={onAssign}
    records={[{ record_kind: "task", id: "task-1", title: "Count stock", destination: "Tasks", branch_id: "branch-1", department_id: "department-1", starts_at: "2026-08-27T09:00:00Z", verification_pending: false, created_at: "2026-08-27T08:00:00Z" }]}
  />);

  fireEvent.change(screen.getByLabelText("Assign Count stock"), { target: { value: "profile-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Assign now" }));
  expect(onAssign).toHaveBeenCalledWith("task", "task-1", "profile-1");
  expect(screen.queryByText(/row hash|profile id/i)).toBeNull();
});

it("shows the live number of records still awaiting assignment", () => {
  const record = { record_kind: "template" as const, id: "template-1", title: "Open showroom", destination: "Recurring / To-Do", branch_id: "branch-1", department_id: "department-1", starts_at: "2026-08-28", verification_pending: false, created_at: "2026-08-28T08:00:00Z" };
  render(<AssigningLeftPanel
    busy={false}
    candidates={[]}
    onAssign={vi.fn()}
    records={[record, { ...record, id: "template-2", title: "Close showroom" }]}
  />);

  expect(screen.getByText("2 tasks awaiting assignment")).toBeTruthy();
});
