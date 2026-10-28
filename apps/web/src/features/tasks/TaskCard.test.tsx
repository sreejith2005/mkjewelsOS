// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveTaskMutationCapability, type TaskMutationCapability } from "@jewelos/core";
import type { TaskBundle } from "./api";
import { TaskCard } from "./TaskCard";
const contextView = vi.hoisted(() => vi.fn());
vi.mock("@/features/fms/FmsWorkContext", () => ({ FmsWorkContext: (props: { instanceId: string; instanceStageId: string }) => {
  contextView(props); return <p>Client name: Synthetic client from the previous form</p>;
} }));

it("loads full previous-form details only when an FMS task is expanded", () => {
  contextView.mockClear();
  render(<TaskCard task={{ ...task, task_type: "fms", fms_instance_id: "instance-5", fms_instance_stage_id: "stage-3" }} capability={capability} categoryLabel="FMS" onAction={async () => undefined} />);
  expect(contextView).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /View details/i }));
  expect(screen.getByText("Client name: Synthetic client from the previous form")).toBeTruthy();
  expect(contextView).toHaveBeenCalledWith({ instanceId: "instance-5", instanceStageId: "stage-3" });
  expect(screen.queryByText("Frequency")).toBeNull();
  expect(screen.queryByText("No description provided")).toBeNull();
});

afterEach(cleanup);

it("shows configured FMS context without replacing ordinary task content", () => {
  const contextual = { ...task, task_type: "fms" as const, fmsWorkContext: {
    workflowName: "Enquiry", stageName: "Call", reference: "FMS-local", instructions: "Call the client", expectedResult: "Record the reply",
    dueAt: null, assignedNames: ["Employee B"], titleTemplate: "Call {initial.client_name}", shortDescription: "Follow up on the enquiry", dueLabel: "Due",
    receivedFields: [{ sourceStageKey: "initial", submissionId: "submission", formTemplateId: "form", formName: "Enquiry form", formVersion: 1,
      field: { key: "client_name", label: "Client", type: "text" as const, sortOrder: 0 }, value: "Synthetic client" }], journey: [], nextCursor: null,
  } };
  render(<TaskCard task={contextual} capability={capability} categoryLabel="FMS" onAction={async () => undefined} />);
  expect(screen.getByText("Call Synthetic client | FMS-local")).toBeTruthy();
  expect(screen.getByText("Client:")).toBeTruthy();
  expect(screen.getByText("Follow up on the enquiry")).toBeTruthy();
});

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
  effective_due_datetime: null,
  form_template_id: null,
  fms_work_source: null,
  fms_instance_id: null,
  fms_instance_stage_id: null,
  fms_starter_assignment_id: null,
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
  it("opens the checklist instead of completing while a required item is unticked", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const checklists = [{ deleted_at: null, completed_at: null, completed_by: null, id: "item-1", is_completed: false, is_required: true, item_text: "Photograph the tray", sort_order: 1, task_instance_id: "task-1" }];
    render(<TaskCard viewerId="doer-1" capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, checklists, task_type: "checklist", title: "Checklist task" }} />);
    expect(screen.queryByRole("button", { name: "Complete task: Checklist task" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open checklist: Checklist task" }));
    const panel = await screen.findByRole("region", { name: "Checklist" });
    await waitFor(() => expect(document.activeElement).toBe(panel));
    expect(screen.getByRole("checkbox", { name: /Photograph the tray/ })).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("never asks anyone for a completion remark, including on-behalf completion", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const manager = deriveTaskMutationCapability({ assigneeIds: ["doer-1"], isWatcher: false, viewerId: "manager-1", viewerRole: "manager" });
    render(<TaskCard viewerId="manager-1" capability={manager} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, requires_remark: true }} />);
    fireEvent.click(screen.getByRole("button", { name: /View details/i }));
    expect(screen.queryByRole("textbox", { name: "Completion remark" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Complete task: Direct completion task" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ kind: "complete" }));
  });

  it("unlocks checklist items in order and finishes from the checklist once all are ticked", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const second = { ...{ deleted_at: null, completed_at: null, completed_by: null, id: "item-1", is_completed: false, is_required: true, item_text: "Photograph the tray", sort_order: 1, task_instance_id: "task-1" }, id: "item-2", item_text: "Lock the safe", sort_order: 2 };
    const { rerender } = render(<TaskCard viewerId="doer-1" capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, checklists: [{ deleted_at: null, completed_at: null, completed_by: null, id: "item-1", is_completed: false, is_required: true, item_text: "Photograph the tray", sort_order: 1, task_instance_id: "task-1" }, second], title: "Two steps" }} />);
    fireEvent.click(screen.getByRole("button", { name: /View details/i }));
    expect(screen.getByRole("checkbox", { name: /Photograph the tray/ })).toHaveProperty("disabled", false);
    expect(screen.getByRole("checkbox", { name: /Lock the safe/ }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("checkbox", { name: /Lock the safe/ }));
    expect(screen.getByText("Tick step 1 first.")).toBeTruthy();
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Complete checklist: Two steps" })).toBeNull();

    const ticked = [{ ...{ deleted_at: null, completed_at: null, completed_by: null, id: "item-1", is_completed: false, is_required: true, item_text: "Photograph the tray", sort_order: 1, task_instance_id: "task-1" }, is_completed: true }, { ...second, is_completed: true }];
    rerender(<TaskCard viewerId="doer-1" capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, checklists: ticked, title: "Two steps" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Complete checklist: Two steps" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ kind: "complete" }));
  });

  it("keeps the doer's own name off their own task", () => {
    render(<TaskCard viewerId="doer-1" capability={capability} categoryLabel="Uncategorized" onAction={vi.fn()} task={task} />);
    expect(screen.queryByText("Ashwini Kamble")).toBeNull();
    expect(screen.queryByText("Uncategorized")).toBeNull();
  });

  it("offers the required upload on an edited checklist", () => {
    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={vi.fn()} task={{ ...task, task_type: "checklist", requires_upload: true, title: "Edited checklist" }} />);
    expect(screen.getByLabelText("Upload task: Edited checklist")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Complete task: Edited checklist" })).toBeNull();
  });
  it("shows a manager watcher the remark thread without task mutation actions", () => {
    const watcher = deriveTaskMutationCapability({ assigneeIds: ["doer-1"], isWatcher: true, viewerId: "manager-1", viewerRole: "manager" });
    render(<TaskCard capability={watcher} categoryLabel="Uncategorized" onAction={vi.fn()} task={{ ...task, isWatchedByViewer: true }} />);
    expect(screen.queryByRole("button", { name: "Complete task: Direct completion task" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /View details/i }));
    expect(screen.getByRole("region", { name: "Remarks" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revise" })).toBeNull();
  });
  it("marks a linked FMS form action explicitly and delegates its stage identity", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);

    render(<TaskCard capability={capability} categoryLabel="FMS" onAction={onAction} task={{ ...task, form_template_id: "form-1", fms_work_source: "fms_stage", fms_instance_id: "instance-5", fms_instance_stage_id: "stage-3", requires_form: true, task_type: "fms", title: "KYC form" }} />);

    expect(screen.getAllByText("FMS").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /View details/i }));
    fireEvent.click(screen.getByRole("button", { name: "Complete FMS form" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ kind: "fill_fms_form" }));
  });
  it("opens the runtime workspace for an FMS stage that pins no form", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);

    render(<TaskCard capability={capability} categoryLabel="FMS" onAction={onAction} task={{ ...task, form_template_id: null, fms_work_source: "fms_stage", fms_instance_id: "instance-5", fms_instance_stage_id: "stage-3", requires_form: false, task_type: "fms", title: "Polishing step" }} />);

    fireEvent.click(screen.getByRole("button", { name: /View details/i }));
    fireEvent.click(screen.getByRole("button", { name: "Open FMS workflow" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ kind: "open_fms_stage" }));
  });
  it("puts form and workflow actions on the card face without opening details", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<TaskCard capability={capability} categoryLabel="FMS" onAction={onAction} task={{ ...task, form_template_id: "form-1", fms_work_source: "fms_stage", fms_instance_id: "instance-5", fms_instance_stage_id: "stage-3", requires_form: true, task_type: "fms", title: "KYC form" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Fill FMS form: KYC form" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ kind: "fill_fms_form" }));
    unmount();
    render(<TaskCard capability={capability} categoryLabel="FMS" onAction={onAction} task={{ ...task, form_template_id: null, fms_work_source: "fms_stage", fms_instance_id: "instance-5", fms_instance_stage_id: "stage-3", requires_form: false, task_type: "fms", title: "Polishing step" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Open FMS work: Polishing step" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ kind: "open_fms_stage" }));
  });
  it("says when work is due in plain words and explains coverage without technical text", () => {
    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={vi.fn()} task={{ ...task, planned_datetime: null, revised_datetime: null, status: "blocked", title: "Blocked task" }} />);
    expect(screen.getByText("No due date")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /View details/i }));
    expect(screen.getByText(/waiting for a manager to arrange cover/)).toBeTruthy();
    expect(screen.queryByText(/database-backed/)).toBeNull();
  });
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

    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ kind: "complete" }));
  });

  it("uses a header Upload action that requests upload and completion for evidence tasks", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const file = new File(["evidence"], "evidence.png", { type: "image/png" });

    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, requires_upload: true, title: "Upload completion task" }} />);

    fireEvent.change(screen.getByLabelText("Upload task: Upload completion task"), { target: { files: [file] } });

    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ file, kind: "upload_and_complete" }));
    expect(screen.queryByRole("button", { name: "Complete task: Upload completion task" })).toBeNull();
  });

  it("offers videos as evidence and completes the task with a phone recording", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const file = new File(["evidence"], "VID_20261016.mp4", { type: "video/mp4" });

    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, requires_upload: true, title: "Video proof task" }} />);

    const input = screen.getByLabelText("Upload task: Video proof task") as HTMLInputElement;
    expect(input.accept).toContain("video/mp4");
    expect(input.accept).toContain("video/quicktime");
    expect(input.hasAttribute("capture")).toBe(false);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ file, kind: "upload_and_complete" }));
  });

  it("explains the video size limit instead of uploading an oversized clip", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const file = new File(["evidence"], "long.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "size", { value: 50 * 1024 * 1024 + 1 });

    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, requires_upload: true, title: "Long video task" }} />);

    fireEvent.change(screen.getByLabelText("Upload task: Long video task"), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("Videos can be up to 50 MB. Record a shorter clip and try again.")).toBeTruthy());
    expect(onAction).not.toHaveBeenCalled();
  });

  it("withholds completion while a required checklist item is outstanding", () => {
    const checklists = [{ deleted_at: null, completed_at: null, completed_by: null, id: "item-1", is_completed: false, is_required: true, item_text: "Photograph the tray", sort_order: 1, task_instance_id: "task-1" }];
    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={vi.fn()} task={{ ...task, checklists, title: "Checklist task" }} />);
    expect(screen.queryByRole("button", { name: "Complete task: Checklist task" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open checklist: Checklist task" })).toBeTruthy();
  });

  it("withholds the one-shot upload until the checklist is ticked", () => {
    const checklists = [{ deleted_at: null, completed_at: null, completed_by: null, id: "item-1", is_completed: false, is_required: true, item_text: "Photograph the tray", sort_order: 1, task_instance_id: "task-1" }];
    const { rerender } = render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={vi.fn()} task={{ ...task, checklists, requires_upload: true, title: "Checklist upload task" }} />);
    expect(screen.queryByLabelText("Upload task: Checklist upload task")).toBeNull();
    rerender(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={vi.fn()} task={{ ...task, checklists: [{ ...checklists[0]!, is_completed: true }], requires_upload: true, title: "Checklist upload task" }} />);
    expect(screen.getByLabelText("Upload task: Checklist upload task")).toBeTruthy();
  });

  it("keeps an imported checklist without an upload requirement click-to-complete", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);

    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{
      ...task,
      requires_upload: false,
      task_type: "checklist",
      title: "Open the showroom",
    }} />);

    expect(screen.queryByLabelText("Upload task: Open the showroom")).toBeNull();
    const complete = screen.getByRole("button", { name: "Complete task: Open the showroom" });
    expect(complete).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: /View details/i }));
    expect(screen.queryByText("Evidence")).toBeNull();
    expect(screen.queryByText("Upload required evidence")).toBeNull();

    fireEvent.click(complete);
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ kind: "complete" }));
  });

  it("still lets a doer tick an individual checklist item", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const checklists = [{ deleted_at: null, completed_at: null, completed_by: null, id: "item-1", is_completed: false, is_required: true, item_text: "Photograph the tray", sort_order: 1, task_instance_id: "task-1" }];

    render(<TaskCard capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, checklists, title: "Checklist task" }} />);

    fireEvent.click(screen.getByRole("button", { name: /View details/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Photograph the tray/ }));

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

describe("TaskCard checklist on a phone", () => {
  const item = (id: string, text: string, sort: number) => ({ deleted_at: null, completed_at: null, completed_by: null, id, is_completed: false, is_required: true, item_text: text, sort_order: sort, task_instance_id: "task-1" });
  const steps = [item("s1", "Open the shutter", 1), item("s2", "Switch on lights", 2), item("s3", "Count the trays", 3)];

  it("ticks at once and accepts the next tap while the first one is still saving", async () => {
    const pending: Array<() => void> = [];
    const onAction = vi.fn(() => new Promise<void>((resolve) => { pending.push(resolve); }));
    render(<TaskCard viewerId="doer-1" capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, checklists: steps, task_type: "checklist", title: "Opening" }} />);
    fireEvent.click(screen.getByRole("button", { name: /View details/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Open the shutter/ }));
    expect(screen.getByRole("checkbox", { name: /Open the shutter/ }).getAttribute("aria-checked")).toBe("true");
    const second = screen.getByRole("checkbox", { name: /Switch on lights/ });
    expect(second).toHaveProperty("disabled", false);
    expect(second.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(second);
    expect(second.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Saving/)).toBeTruthy();
    // Saves go out one at a time, in tap order.
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    expect(onAction).toHaveBeenLastCalledWith({ kind: "checklist", checklistId: "s1", completed: true });
    pending.shift()?.();
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(2));
    expect(onAction).toHaveBeenLastCalledWith({ kind: "checklist", checklistId: "s2", completed: true });
    pending.shift()?.();
    await waitFor(() => expect(screen.queryByText(/Saving/)).toBeNull());
  });

  it("puts a tick back and says so when the save fails", async () => {
    const onAction = vi.fn().mockRejectedValue(new Error("Network error"));
    render(<TaskCard viewerId="doer-1" capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, checklists: steps, task_type: "checklist", title: "Opening" }} />);
    fireEvent.click(screen.getByRole("button", { name: /View details/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Open the shutter/ }));
    await screen.findByText("Network error. Tap the step again.");
    expect(screen.getByRole("checkbox", { name: /Open the shutter/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("waits for ticks to save before completing", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const onAction = vi.fn((action: { kind: string }) => {
      order.push(action.kind);
      return action.kind === "checklist" ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
    });
    const one = [item("only", "Lock the safe", 1)];
    render(<TaskCard viewerId="doer-1" capability={capability} categoryLabel="Uncategorized" onAction={onAction} task={{ ...task, checklists: one, task_type: "checklist", title: "Closing" }} />);
    fireEvent.click(screen.getByRole("button", { name: /View details/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Lock the safe/ }));
    fireEvent.click(screen.getByRole("button", { name: "Complete checklist: Closing" }));
    await waitFor(() => expect(order).toEqual(["checklist"]));
    release();
    await waitFor(() => expect(order).toEqual(["checklist", "complete"]));
  });

  it("opens the checklist without a long smooth scroll", async () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<TaskCard viewerId="doer-1" capability={capability} categoryLabel="Uncategorized" onAction={vi.fn()} task={{ ...task, checklists: steps, task_type: "checklist", title: "Opening" }} />);
      fireEvent.click(screen.getByRole("button", { name: "Open checklist: Opening" }));
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "auto" }));
      expect(scrollIntoView).not.toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("checkbox", { name: /Open the shutter/ }));
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
