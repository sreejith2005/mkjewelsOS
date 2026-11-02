// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const reassign = vi.hoisted(() => ({
  loadReassignSources: vi.fn(),
  loadReassignCandidates: vi.fn(),
  executeReassignPlan: vi.fn(),
}));
vi.mock("@jewelos/data/taskControl/reassign", () => reassign);
vi.mock("@jewelos/data/tasks/api", () => ({
  loadTaskAssignmentUsers: vi.fn().mockResolvedValue([
    { id: "receiver", employee_name: "Ravi Receiver", employee_code: "R1", branch_id: null, department_id: null, user_role: "staff" },
    { id: "leaver", employee_name: "Lata Leaver", employee_code: "L1", branch_id: null, department_id: null, user_role: "staff" },
  ]),
}));

import { ReassignDialog } from "./ReassignDialog";

const candidates = {
  tasks: [
    { id: "t-old", title: "Missed follow-up", task_template_id: null, due_at: null, overdue: true },
    { id: "t-new", title: "Call client", task_template_id: "daily", due_at: null, overdue: false },
  ],
  fms_steps: [{ id: "s-1", title: "Follow-up · Lead 12" }],
  schedules: [{ id: "daily", title: "Daily stock check" }],
};

function setup(selectedIds: readonly string[] | null) {
  reassign.loadReassignSources.mockResolvedValue([{ id: "leaver", label: "Lata Leaver (left)", former: true }]);
  reassign.loadReassignCandidates.mockResolvedValue(candidates);
  reassign.executeReassignPlan.mockResolvedValue({ moved: ["t-new", "s-1", "daily"], skipped: [{ id: "t-old", reason: "This task is already completed" }], error: null });
  const onFinished = vi.fn().mockResolvedValue(undefined);
  render(<ReassignDialog branchNames={new Map()} departmentNames={new Map()} onClose={vi.fn()} onFinished={onFinished} request={{ selectedIds, fromUserId: "leaver" }} />);
  return { onFinished };
}

describe("ReassignDialog", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("moves all open work of one person to the chosen receiver and reports what could not move", async () => {
    const { onFinished } = setup(null);
    expect(await screen.findByText("Overdue tasks (1)", { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Overdue tasks/));
    fireEvent.click(await screen.findByLabelText(/Ravi Receiver/));
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "Lata left" } });
    fireEvent.click(screen.getByRole("button", { name: "Reassign 3 items" }));
    await waitFor(() => expect(reassign.executeReassignPlan).toHaveBeenCalledWith("leaver", "receiver", "Lata left",
      { taskIds: ["t-new"], fmsStageIds: ["s-1"], templateIds: ["daily"] }, expect.any(Function)));
    expect(await screen.findByText(/3 item\(s\) moved/)).toBeTruthy();
    expect(screen.getByText(/Missed follow-up: This task is already completed/)).toBeTruthy();
    expect(onFinished).toHaveBeenCalled();
  });

  it("never offers the person losing the work as the receiver", async () => {
    setup(null);
    expect(await screen.findByLabelText(/Ravi Receiver/)).toBeTruthy();
    expect(screen.queryByLabelText(/Lata Leaver/)).toBeNull();
  });

  it("needs a reason before reassigning selected rows", async () => {
    setup(["t-new", "someone-elses"]);
    expect(await screen.findByText(/1 selected item\(s\) are finished or not/)).toBeTruthy();
    fireEvent.click(await screen.findByLabelText(/Ravi Receiver/));
    expect((screen.getByRole("button", { name: /Reassign 2 items/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
