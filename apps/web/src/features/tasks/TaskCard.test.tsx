// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskMutationCapability } from "@jewelos/core";
import type { TaskBundle } from "./api";
import { TaskCard } from "./TaskCard";

afterEach(cleanup);

const capability: TaskMutationCapability = {
  access: "doer",
  canMutate: true,
  canUseElevatedActions: false,
  watcherLabel: null,
};

const task = {
  actual_datetime: null,
  assignee_id: "doer-1",
  assigneeName: "Ashwini Kamble",
  assignees: [{ id: "doer-1", name: "Ashwini Kamble" }],
  assignment_status: "assigned",
  branch_id: "branch-1",
  branch_name: null,
  buddy_assignment_allowed: true,
  category_id: null,
  checklist_completion_pct: 0,
  checklists: [],
  coverageOriginalAssigneeName: null,
  coverage_original_assignee_id: null,
  coverage_status: null,
  core_task_label: null,
  created_by: "manager-1",
  delay_minutes: null,
  department_id: "department-1",
  department_name: null,
  description: null,
  due_datetime: null,
  due_time: null,
  form_template_id: null,
  hasAttachment: false,
  hasFormSubmission: false,
  id: "task-1",
  isWatchedByViewer: false,
  is_active: null,
  planned_datetime: "2026-08-27T10:00:00.000Z",
  planned_time: null,
  priority: "medium",
  requires_form: false,
  requires_remark: false,
  requires_upload: false,
  revised_datetime: null,
  schedule_kind: null,
  scheduled_date: null,
  source: "manual",
  starts_on: null,
  status: "pending",
  task_template_id: null,
  task_type: "delegation",
  tenant_id: "tenant-1",
  title: "Direct completion task",
  verification_required: null,
  verification_status: null,
  verifierName: null,
  verifier_user_profile_id: null,
} as TaskBundle;

describe("TaskCard direct completion", () => {
  it("identifies work covered for an absent colleague", () => {
    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={vi.fn()} task={{
      ...task,
      coverageOriginalAssigneeName: "Nikita Patil",
      coverage_status: "covered",
    } as TaskBundle} />);

    expect(screen.getByText("Covering for: Nikita Patil")).toBeTruthy();
  });

  it("keeps operational details collapsed behind a named accessible disclosure", () => {
    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={vi.fn()} task={{ ...task, description: "Inspect every showcase before opening." }} />);

    const disclosure = screen.getByRole("button", { name: /View details/i });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(disclosure.getAttribute("aria-controls")).toBe("task-details-task-1");
    expect(screen.queryByText("Inspect every showcase before opening.")).toBeNull();

    fireEvent.click(disclosure);

    expect(screen.getByRole("button", { name: /Hide details/i }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "Details for Direct completion task" }).getAttribute("id")).toBe("task-details-task-1");
    expect(screen.getByText("Inspect every showcase before opening.")).not.toBeNull();
  });

  it("shows a Complete action beside an eligible task and does not expose Start or Delegate", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);

    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={task} />);

    fireEvent.click(screen.getByRole("button", { name: /View details/i }));
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delegate" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Complete task: Direct completion task" }));

    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ kind: "complete", remark: "" }));
  });

  it("uses a header Upload action that requests upload and completion for evidence tasks", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const file = new File(["evidence"], "evidence.png", { type: "image/png" });

    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, requires_upload: true, title: "Upload completion task" }} />);

    fireEvent.change(screen.getByLabelText("Upload task: Upload completion task"), { target: { files: [file] } });

    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ file, kind: "upload_and_complete" }));
    expect(screen.queryByRole("button", { name: "Complete task: Upload completion task" })).toBeNull();
  });

  it("keeps the completion action available while a required checklist item is outstanding", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const checklists = [{ completed_at: null, completed_by: null, id: "item-1", is_completed: false, is_required: true, item_text: "Photograph the tray", sort_order: 1, task_instance_id: "task-1" }];

    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, checklists, title: "Checklist task" }} />);

    const complete = screen.getByRole("button", { name: "Complete task: Checklist task" });
    expect(complete).toHaveProperty("disabled", false);

    fireEvent.click(complete);
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ kind: "complete", remark: "" }));
  });

  it("offers the one-shot upload while a required checklist item is outstanding", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const file = new File(["evidence"], "evidence.png", { type: "image/png" });
    const checklists = [{ completed_at: null, completed_by: null, id: "item-1", is_completed: false, is_required: true, item_text: "Photograph the tray", sort_order: 1, task_instance_id: "task-1" }];

    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, checklists, requires_upload: true, title: "Checklist upload task" }} />);

    fireEvent.change(screen.getByLabelText("Upload task: Checklist upload task"), { target: { files: [file] } });

    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ file, kind: "upload_and_complete" }));
  });

  it("still lets a doer tick an individual checklist item", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const checklists = [{ completed_at: null, completed_by: null, id: "item-1", is_completed: false, is_required: true, item_text: "Photograph the tray", sort_order: 1, task_instance_id: "task-1" }];

    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, checklists, title: "Checklist task" }} />);

    fireEvent.click(screen.getByRole("button", { name: /View details/i }));
    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));

    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ checklistId: "item-1", completed: true, kind: "checklist" }));
  });

  it("shows an upload failure and lets the user retry the same supported file", async () => {
    const onAction = vi.fn().mockRejectedValueOnce(new Error("Upload failed")).mockResolvedValueOnce(undefined);
    const file = new File(["evidence"], "evidence.webp", { type: "image/webp" });

    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, requires_upload: true, title: "Retry upload task" }} />);

    const input = screen.getByLabelText("Upload task: Retry upload task") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Upload failed")).toBeTruthy());
    expect(input.value).toBe("");

    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(2));
  });
});
