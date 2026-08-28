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
  branch_id: "branch-1",
  category_id: null,
  checklist_completion_pct: 0,
  checklists: [],
  core_task_label: null,
  created_by: "manager-1",
  delay_minutes: null,
  department_id: "department-1",
  description: null,
  due_datetime: null,
  form_template_id: null,
  hasAttachment: false,
  hasFormSubmission: false,
  id: "task-1",
  isWatchedByViewer: false,
  planned_datetime: "2026-08-27T10:00:00.000Z",
  priority: "medium",
  requires_form: false,
  requires_remark: false,
  requires_upload: false,
  revised_datetime: null,
  source: "manual",
  status: "pending",
  task_template_id: null,
  task_type: "delegation",
  tenant_id: "tenant-1",
  title: "Direct completion task",
  verifier_user_profile_id: null,
} as TaskBundle;

describe("TaskCard direct completion", () => {
  it("shows a Complete action beside an eligible task and does not expose Start or Delegate", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);

    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={task} />);

    fireEvent.click(screen.getByRole("button", { name: /^Direct completion task/ }));
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
});
