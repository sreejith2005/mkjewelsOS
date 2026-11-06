// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecurringInstance, RecurringWorkspace } from "@/features/recurringTodo/api";
import { ReviewTab } from "./ReviewTab";
import { defaultFilters } from "./filters";

const { loadRecurringWorkspace, verifyRecurringTask, loadTaskForms, loadFormDynamicOptions } = vi.hoisted(() => ({
  loadRecurringWorkspace: vi.fn(),
  verifyRecurringTask: vi.fn(),
  loadTaskForms: vi.fn().mockResolvedValue({ bundles: [] }),
  loadFormDynamicOptions: vi.fn(),
}));

vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "admin-1", tenant_id: "t1", user_role: "admin" } }) }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));
vi.mock("@/features/forms/api", () => ({ loadTaskForms, loadFormDynamicOptions }));
vi.mock("@/features/tasks/TaskRequiredForm", () => ({ TaskRequiredForm: ({ taskId, templateId }: { taskId: string; templateId: string }) => <p>Required {taskId} / {templateId}</p> }));
vi.mock("@/features/tasks/api", () => ({ updateTask: vi.fn(), uploadTaskAttachment: vi.fn(), completeRecurringTaskWithImage: vi.fn() }));
vi.mock("@/features/recurringTodo/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadRecurringWorkspace,
  verifyRecurringTask,
  sendRecurringFollowup: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/task-templates?tab=review");
});

function occurrence(overrides: Partial<RecurringInstance>): RecurringInstance {
  return {
    id: "task-1", title: "Vault audit", description: null, status: "completed", verification_status: "pending",
    planned_datetime: "2026-10-20T05:30:00Z", due_datetime: "2026-10-20T12:30:00Z", revised_datetime: null, actual_datetime: "2026-10-20T10:00:00Z",
    task_template_id: "tpl-1", task_type: "delegation", requires_form: false, requires_upload: false, coverage_status: null,
    assignees: [{ id: "doer-1", name: "Teammate", is_original: true }], checklist: [], has_attachment: true, has_form_submission: false, followups: [],
    ...overrides,
  } as RecurringInstance;
}

const workspace: RecurringWorkspace = {
  templates: [{ id: "tpl-1", followup_enabled: true } as RecurringWorkspace["templates"][number]],
  instances: [
    occurrence({ id: "awaiting" }),
    occurrence({ id: "rejected", title: "Display polish", status: "rejected", verification_status: "rejected", verification_note: "Smudges" }),
    occurrence({ id: "uncovered", title: "Opening checklist", status: "pending", verification_status: "not_required", coverage_status: "coverage_required", actual_datetime: null }),
  ],
  stats: { total: 3, pending: 1, in_progress: 0, completed: 1, rejected: 1, overdue: 0, on_time: 1, delayed: 0, completed_on_behalf: 0, coverage_required: 1, manager_review: 0 },
};

describe("Task Control Review tab", () => {
  it("loads only the selected work item's exact required form when opened", async () => {
    loadRecurringWorkspace.mockResolvedValue({ ...workspace, instances: [occurrence({ id: "chosen", title: "Chosen work", status: "rejected", verification_status: "rejected", form_template_id: "form-chosen", requires_form: true }), occurrence({ id: "other", form_template_id: "form-other", requires_form: true })] });
    let finish!: (value: { bundles: { id: string; name: string; fields: never[]; sections: never[] }[] }) => void;
    loadTaskForms.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    loadFormDynamicOptions.mockResolvedValue({ users: [], branches: [], departments: [], masters: [] });
    render(<ReviewTab filters={defaultFilters("2026-10-21")} onOpenRecurringTasks={vi.fn()} reloadKey={0} />);
    await screen.findByText("Vault audit");
    fireEvent.click(screen.getByRole("button", { name: /^Rejected · 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Complete form" }));
    await waitFor(() => expect(loadTaskForms).toHaveBeenCalledWith(["form-chosen"], ["chosen"]));
    expect(screen.queryByText("Required chosen / form-chosen")).toBeNull();
    await act(async () => { finish({ bundles: [{ id: "form-chosen", name: "Chosen form", fields: [], sections: [] }] }); });
    expect(await screen.findByText("Required chosen / form-chosen")).toBeTruthy();
  });
  it("shows verification immediately without downloading every required form", async () => {
    loadRecurringWorkspace.mockResolvedValue({ ...workspace, instances: [occurrence({ form_template_id: "form-1", requires_form: true })] });
    loadTaskForms.mockReturnValue(new Promise(() => {}));
    render(<ReviewTab filters={defaultFilters("2026-10-21")} onOpenRecurringTasks={vi.fn()} reloadKey={0} />);
    await act(async () => {});
    expect(screen.queryByText("Vault audit")).toBeTruthy();
    expect(loadTaskForms).not.toHaveBeenCalled();
    expect(loadFormDynamicOptions).not.toHaveBeenCalled();
  });
  it("lists work awaiting verification and verifies it through the audited RPC", async () => {
    loadRecurringWorkspace.mockResolvedValue(workspace);
    verifyRecurringTask.mockResolvedValue(undefined);
    render(<ReviewTab filters={defaultFilters("2026-10-21")} onOpenRecurringTasks={vi.fn()} reloadKey={0} />);
    await screen.findByText("Vault audit");
    expect(loadRecurringWorkspace).toHaveBeenCalledWith(expect.objectContaining({ date_from: "2026-09-22", date_to: "2026-10-21" }));
    expect(screen.queryByText("Display polish")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Verify/ }));
    await waitFor(() => expect(verifyRecurringTask).toHaveBeenCalledWith("awaiting", "verified", ""));
  });

  it("opens the bucket a tile counts, and sends task totals to the Tasks tab", async () => {
    loadRecurringWorkspace.mockResolvedValue(workspace);
    const onOpenRecurringTasks = vi.fn();
    render(<ReviewTab filters={defaultFilters("2026-10-21")} onOpenRecurringTasks={onOpenRecurringTasks} reloadKey={0} />);
    await screen.findByText("Vault audit");
    fireEvent.click(screen.getByRole("button", { name: /^Coverage required/ }));
    expect(await screen.findByText("Opening checklist")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Rejected · 1/ }));
    expect(await screen.findByText("Returned for rework: Smudges")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Completed/ }));
    expect(onOpenRecurringTasks).toHaveBeenCalledWith("completed");
  });

  it("narrows to one person with the shared filter", async () => {
    loadRecurringWorkspace.mockResolvedValue(workspace);
    render(<ReviewTab filters={{ ...defaultFilters("2026-10-21"), user_profile_id: "someone-else" }} onOpenRecurringTasks={vi.fn()} reloadKey={0} />);
    await screen.findByText("Nothing needs attention in this list.");
  });
});
