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
  fireEvent.click(screen.getByRole("button", { name: "Edit / delete task" }));
  expect(manage).toHaveBeenCalledWith("employee-task");
  expect(props.onView).not.toHaveBeenCalled();
});
it("keeps management unavailable to readers and to FMS work", () => {
  const { rerender } = render(<TasksTab {...props} />);
  expect(screen.queryByRole("button", { name: "Edit / delete task" })).toBeNull();
  rerender(<TasksTab {...props} onManage={vi.fn()} evidence={{ ...evidence, tasks: evidence.tasks.map((row) => ({ ...row, task_type: "fms" })) }} />);
  expect(screen.queryByRole("button", { name: "Edit / delete task" })).toBeNull();
});
