// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TaskMutationCapability } from "@jewelos/core";
import type { TaskBundle } from "./api";
import { TaskCard } from "./TaskCard";

afterEach(cleanup);

// Pin the clock so the derived status stays deterministic against the fixture deadline.
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-02T02:00:00.000Z")); });
afterAll(() => { vi.useRealTimers(); });

const capability: TaskMutationCapability = {
  access: "doer",
  canMutate: true,
  canUseElevatedActions: false,
  watcherLabel: null,
};

const fullTask = {
  actual_datetime: null,
  assignee_id: "doer-1",
  assigneeName: "Ashwini Kamble",
  assignees: [{ id: "doer-1", name: "Ashwini Kamble" }],
  assignment_status: "assigned",
  branch_id: "branch-1",
  branch_name: "Pune Camp",
  buddy_assignment_allowed: true,
  category_id: null,
  checklist_completion_pct: 0,
  checklists: [{
    completed_at: null,
    completed_by: null,
    id: "check-1",
    is_completed: false,
    is_required: true,
    item_text: "Confirm the opening balance",
    sort_order: 0,
    task_instance_id: "task-1",
  }],
  core_task_label: "Showroom opening",
  created_by: "manager-1",
  delay_minutes: null,
  department_id: "department-1",
  department_name: "Retail Operations",
  description: "Inspect every showcase before opening.",
  due_datetime: "2026-09-02T04:30:00.000Z",
  due_time: "10:00:00",
  effective_due_datetime: "2026-09-02T04:30:00.000Z",
  form_template_id: null,
  hasAttachment: true,
  hasFormSubmission: false,
  id: "task-1",
  isWatchedByViewer: false,
  is_active: false,
  planned_datetime: "2026-09-02T03:30:00.000Z",
  planned_time: "09:00:00",
  priority: "high",
  requires_form: false,
  requires_remark: false,
  requires_upload: true,
  revised_datetime: "2026-09-02T05:00:00.000Z",
  schedule_kind: "daily",
  scheduled_date: "2026-09-02",
  source: "bulk_import",
  starts_on: "2026-09-01",
  status: "pending",
  task_template_id: "template-1",
  task_type: "checklist",
  tenant_id: "tenant-1",
  title: "Open the showroom",
  verification_required: true,
  verification_status: "pending",
  verifierName: "Nikita Patil",
  verifier_user_profile_id: "verifier-1",
} as TaskBundle;

function renderExpanded(task: TaskBundle = fullTask) {
  render(<TaskCard capability={capability} categoryLabel="Opening" onAction={vi.fn().mockResolvedValue(undefined)} task={task} />);
  expect(screen.getByText(task.title!)).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /View details/i }));
  return within(screen.getByRole("region", { name: `Details for ${task.title}` }));
}

describe("TaskDetails", () => {
  it("shows only what the header does not already say, in plain words", () => {
    const details = renderExpanded();

    expect(details.getByText("Inspect every showcase before opening.")).not.toBeNull();
    for (const [label, value] of [
      ["Repeats", "Daily · paused"],
      ["Evidence", "Evidence required · Uploaded"],
      ["Verification", "Verification pending · Nikita Patil"],
      ["Core task", "Showroom opening"],
    ] as const) {
      expect(details.getByText(label).parentElement?.textContent).toBe(label + value);
    }
    expect(details.getByText(/2 Sept 2026, 10:30 am \(was 2 Sept 2026, 10:00 am\)/i)).not.toBeNull();
    // Already on the card face, obvious to the doer, or shown by the checklist itself.
    for (const label of ["Assigned to", "Branch", "Department", "Task type", "Start", "Priority", "Buddy coverage", "Schedule state", "Status"]) {
      expect(details.queryByText(label)).toBeNull();
    }
    expect(screen.queryByText(/FREQ=/i)).toBeNull();
    expect(screen.queryByText("template-1")).toBeNull();
  });

  it("puts the checklist first, ahead of the details", () => {
    const details = renderExpanded();
    const checklist = details.getByRole("region", { name: "Checklist" });
    const description = details.getByText("Inspect every showcase before opening.");
    expect(checklist.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("adds nothing when a task has no description and no special requirements", () => {
    const details = renderExpanded({
      ...fullTask,
      core_task_label: null,
      description: null,
      hasAttachment: false,
      requires_upload: false,
      revised_datetime: null,
      schedule_kind: null,
      task_template_id: null,
      verification_required: false,
      verification_status: "not_required",
      verifierName: null,
      verifier_user_profile_id: null,
    } as TaskBundle);

    expect(details.queryByText("No description provided")).toBeNull();
    for (const label of ["Repeats", "Deadline moved", "Evidence", "Verification", "Core task"]) {
      expect(details.queryByText(label)).toBeNull();
    }
  });
});
