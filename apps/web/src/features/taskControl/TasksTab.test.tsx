// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TasksTab } from "./TasksTab";
import type { EvidenceWorkspace } from "@/features/taskEvidence/types";
vi.mock("@/features/taskEvidence/api", () => ({ signedTaskEvidenceUrl: vi.fn() }));
afterEach(cleanup);
const evidence: EvidenceWorkspace = {
  filters: { from: "2026-10-01", to: "2026-10-10", view: "all", page: 1, page_size: 25 },
  stats: { tasks_total: 1, upload_tasks: 0, upload_tasks_with_evidence: 0, upload_tasks_awaiting_evidence: 0, completed: 0, remaining: 1, overdue: 0, evidence_files: 0, evidence_bytes: 0 },
  tasks_total: 1, missing: [], missing_total: 0,
  tasks: [{ task_id: "employee-task", task_title: "Wrong task", task_type: "checklist", task_status: "pending", requires_upload: false, is_upload_work: false, overdue: false, branch_name: "Branch", department_name: "Department", assignee_names: "Employee", planned_datetime: "2026-10-10T05:30:00Z", due_datetime: null, actual_datetime: null, attachments: [] }],
};
const props = { evidence, view: "all" as const, page: 1, pageSize: 25, onView: vi.fn(), onPage: vi.fn(), onPageSize: vi.fn() };
it("opens management for the exact filtered task without changing the view", () => {
  const manage = vi.fn();
  render(<TasksTab {...props} onManage={manage} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit task" }));
  expect(manage).toHaveBeenCalledWith("employee-task");
  expect(props.onView).not.toHaveBeenCalled();
});
it("keeps management unavailable to readers and to FMS work", () => {
  const { rerender } = render(<TasksTab {...props} />);
  expect(screen.queryByRole("button", { name: "Edit task" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  rerender(<TasksTab {...props} onManage={vi.fn()} evidence={{ ...evidence, tasks: evidence.tasks.map((row) => ({ ...row, task_type: "fms" })) }} />);
  expect(screen.queryByRole("button", { name: "Edit task" })).toBeNull();
});
it("selects a page without losing tasks selected on another page", () => {
  const selection = { ids: ["earlier-page"], onChange: vi.fn() };
  const remove = vi.fn();
  render(<TasksTab {...props} selection={selection} onBulkDelete={remove} />);
  fireEvent.click(screen.getByRole("button", { name: "Select this page" }));
  expect(selection.onChange).toHaveBeenCalledWith(["earlier-page", "employee-task"]);
  fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
  expect(remove).toHaveBeenCalledWith(["earlier-page"]);
  fireEvent.click(screen.getByRole("button", { name: "Delete all matching" }));
  expect(remove).toHaveBeenLastCalledWith(null);
});
it("selects individual task identities and disables empty selected deletion", () => {
  const onChange = vi.fn();
  render(<TasksTab {...props} selection={{ ids: [], onChange }} onBulkDelete={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Delete selected" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Select Wrong task"));
  expect(onChange).toHaveBeenCalledWith(["employee-task"]);
});
it("offers Delete All when only unmaterialized schedules may remain", () => {
  const remove = vi.fn();
  render(<TasksTab {...props} evidence={{ ...evidence, tasks: [], tasks_total: 0 }} selection={{ ids: [], onChange: vi.fn() }} onBulkDelete={remove} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete all matching" }));
  expect(remove).toHaveBeenCalledWith(null);
});
it("labels every kind of work and keeps FMS rows out of task management and evidence", () => {
  const base = evidence.tasks[0]!;
  const rows = [
    { ...base, task_id: "one", task_title: "One-time job", work_kind: "one_time" },
    { ...base, task_id: "rec", task_title: "Daily count", work_kind: "recurring" },
    { ...base, task_id: "crm", task_title: "Walk-in form", work_kind: "crm", work_context: "CRM walk-in" },
    { ...base, task_id: "fms", task_title: "Inspect piece", task_type: "fms", work_kind: "fms_step", work_context: "Repair flow · FMS-1", requires_upload: true },
    { ...base, task_id: "start", task_title: "Repair flow", task_type: "fms", work_kind: "fms_start", work_context: "Start form · Intake" },
  ];
  render(<TasksTab {...props} onManage={vi.fn()} evidence={{ ...evidence, tasks: rows, tasks_total: 5 }} />);
  expect(screen.getAllByTestId("work-kind").map((node) => node.textContent)).toEqual(["One-time", "Recurring", "CRM", "FMS step", "FMS start"]);
  expect(screen.getByText("Repair flow · FMS-1")).toBeTruthy();
  expect(screen.getByText("CRM walk-in")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Edit task" })).toHaveLength(3);
  expect(screen.queryByText("Required, no file yet")).toBeNull();
  expect(screen.getAllByText("Forms and files for FMS work stay on the FMS step.")).toHaveLength(2);
});
it("filters by work type and shows each type's count", () => {
  const onKind = vi.fn();
  render(<TasksTab {...props} kind="all" onKind={onKind} evidence={{ ...evidence, kind_counts: { all: 9, one_time: 3, recurring: 2, crm: 1, fms: 3 } }} />);
  const group = screen.getByRole("group", { name: "Work type" });
  expect(group.textContent).toContain("FMS · 3");
  fireEvent.click(screen.getByRole("button", { name: "FMS · 3" }));
  expect(onKind).toHaveBeenCalledWith("fms");
  expect(screen.getByText(/of 9 in scope/)).toBeTruthy();
});
it("deletes CRM tasks directly and FMS work through its own action", () => {
  const base = evidence.tasks[0]!;
  const rows = [
    { ...base, task_id: "crm", task_title: "Walk-in form", work_kind: "crm" },
    { ...base, task_id: "fms", task_title: "Inspect piece", task_type: "fms", work_kind: "fms_step", task_status: "in_progress" },
    { ...base, task_id: "done", task_title: "Closed step", task_type: "fms", work_kind: "fms_step", task_status: "completed" },
    { ...base, task_id: "start", task_title: "Repair flow", task_type: "fms", work_kind: "fms_start" },
  ];
  const remove = vi.fn();
  render(<TasksTab {...props} onManage={vi.fn()} onDelete={remove} evidence={{ ...evidence, tasks: rows, tasks_total: 4 }} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(remove).toHaveBeenLastCalledWith(expect.objectContaining({ task_id: "crm" }));
  expect(screen.getAllByRole("button", { name: "Delete FMS task" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Delete FMS task" }));
  expect(remove).toHaveBeenLastCalledWith(expect.objectContaining({ task_id: "fms" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete start form" }));
  expect(remove).toHaveBeenLastCalledWith(expect.objectContaining({ task_id: "start" }));
});
