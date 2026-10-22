import { describe, expect, it } from "vitest";
import {
  canManageRecurringWorkspace,
  canPauseRecurringTemplate,
  canRunRecurringTemplateNow,
  deriveRecurringWorkCardState,
  isRecurringInstanceInTab,
  recurringInstanceDisplayStatus,
  recurringInstanceNeedsWork,
  recurringPerformanceScores,
  recurringPerformanceRows,
  recurringStatusPill,
  recurringTemplateDeletePrompt,
  RECURRING_TODO_TABS,
  type RecurringInstanceLike,
} from "./recurringTodo";

function instance(overrides: Partial<RecurringInstanceLike> = {}): RecurringInstanceLike {
  return {
    actual_datetime: null,
    assignee_id: null,
    assignees: [],
    checklist: [],
    due_datetime: null,
    id: "task-1",
    planned_datetime: "2026-08-26T10:00:00.000Z",
    revised_datetime: null,
    status: "pending",
    has_attachment: false,
    has_form_submission: false,
    ...overrides,
  };
}

describe("recurringInstanceDisplayStatus", () => {
  it("shows an unfinished prior occurrence as overdue without rewriting its persisted status", () => {
    expect(recurringInstanceDisplayStatus(instance(), "2026-08-27T10:00:00.000Z")).toBe("overdue");
  });

  it("keeps an unfinished current occurrence pending", () => {
    expect(
      recurringInstanceDisplayStatus(
        instance({ planned_datetime: "2026-08-27T12:00:00.000Z" }),
        "2026-08-27T10:00:00.000Z",
      ),
    ).toBe("pending");
  });

  it("leaves a settled occurrence alone", () => {
    for (const status of ["completed", "rejected", "blocked"])
      expect(recurringInstanceDisplayStatus(instance({ status }), "2026-08-27T10:00:00.000Z")).toBe(status);
  });
});

describe("recurringInstanceNeedsWork", () => {
  it("returns a rejected occurrence to the doer as work still owed", () => {
    expect(recurringInstanceNeedsWork(instance({ status: "rejected" }))).toBe(true);
  });

  it("treats a completed occurrence as finished", () => {
    expect(recurringInstanceNeedsWork(instance({ status: "completed" }))).toBe(false);
  });
});

describe("RECURRING_TODO_TABS", () => {
  it("keeps the approved buckets, in the approved order and wording", () => {
    expect(RECURRING_TODO_TABS.map(([, label]) => label)).toEqual([
      "Today",
      "Overdue",
      "Rejected",
      "Completed",
      "Coverage Required",
      "Manager Review",
      "My Work",
      "Schedules",
      "Verification",
      "Follow-ups",
      "Performance",
    ]);
  });
});

describe("isRecurringInstanceInTab", () => {
  const base = {
    viewerId: "me",
    todayKey: "2026-08-27",
    plannedKey: "2026-08-27",
    followupEnabled: false,
    now: "2026-08-27T10:00:00.000Z",
  };

  it("shows today's unfinished occurrence in Today and hides a completed one", () => {
    expect(isRecurringInstanceInTab({ ...base, task: instance(), tab: "today" })).toBe(true);
    expect(
      isRecurringInstanceInTab({ ...base, task: instance({ status: "completed" }), tab: "today" }),
    ).toBe(false);
  });

  it("keeps a different day out of Today", () => {
    expect(
      isRecurringInstanceInTab({ ...base, plannedKey: "2026-08-26", task: instance(), tab: "today" }),
    ).toBe(false);
  });

  it("uses the display status for Overdue", () => {
    expect(
      isRecurringInstanceInTab({
        ...base,
        task: instance({ planned_datetime: "2026-08-26T10:00:00.000Z" }),
        tab: "overdue",
      }),
    ).toBe(true);
  });

  it("buckets rejected, completed, coverage and manager review by their own field", () => {
    expect(isRecurringInstanceInTab({ ...base, task: instance({ status: "rejected" }), tab: "rejected" })).toBe(true);
    expect(isRecurringInstanceInTab({ ...base, task: instance({ status: "completed" }), tab: "completed" })).toBe(true);
    expect(
      isRecurringInstanceInTab({ ...base, task: instance({ coverage_status: "coverage_required" }), tab: "coverage" }),
    ).toBe(true);
    expect(
      isRecurringInstanceInTab({
        ...base,
        task: instance({ coverage_status: "manager_review" }),
        tab: "manager_review",
      }),
    ).toBe(true);
  });

  it("shows My Work only to an assignee", () => {
    const mine = instance({ assignees: [{ id: "me", name: "Me" }] });
    expect(isRecurringInstanceInTab({ ...base, task: mine, tab: "my_work" })).toBe(true);
    expect(isRecurringInstanceInTab({ ...base, task: instance(), tab: "my_work" })).toBe(false);
  });

  it("shows Verification only for a completed occurrence awaiting a decision", () => {
    expect(
      isRecurringInstanceInTab({
        ...base,
        task: instance({ status: "completed", verification_status: "pending" }),
        tab: "verification",
      }),
    ).toBe(true);
    expect(
      isRecurringInstanceInTab({
        ...base,
        task: instance({ status: "completed", verification_status: "verified" }),
        tab: "verification",
      }),
    ).toBe(false);
  });

  it("shows Follow-ups only for outstanding work on a follow-up enabled schedule", () => {
    const task = instance({ task_template_id: "template-1" });
    expect(isRecurringInstanceInTab({ ...base, task, tab: "followups", followupEnabled: true })).toBe(true);
    expect(isRecurringInstanceInTab({ ...base, task, tab: "followups", followupEnabled: false })).toBe(false);
    expect(
      isRecurringInstanceInTab({
        ...base,
        task: instance({ task_template_id: "template-1", status: "completed" }),
        tab: "followups",
        followupEnabled: true,
      }),
    ).toBe(false);
  });

  it("lists nothing for the two tabs that are not occurrence lists", () => {
    expect(isRecurringInstanceInTab({ ...base, task: instance(), tab: "schedules" })).toBe(false);
    expect(isRecurringInstanceInTab({ ...base, task: instance(), tab: "performance" })).toBe(false);
  });
});

describe("recurringStatusPill", () => {
  const now = "2026-08-27T10:00:00.000Z";

  it("prefers the coverage state over the workflow status", () => {
    expect(recurringStatusPill(instance({ coverage_status: "coverage_required" }), now)).toEqual({
      label: "coverage_required",
      tone: "danger",
    });
    expect(recurringStatusPill(instance({ coverage_status: "manager_review", status: "completed" }), now)).toEqual({
      label: "manager_review",
      tone: "warning",
    });
  });

  it("tones an overdue occurrence as a danger and a completed one as a success", () => {
    expect(recurringStatusPill(instance(), now).tone).toBe("danger");
    expect(recurringStatusPill(instance({ status: "completed" }), now)).toEqual({
      label: "completed",
      tone: "success",
    });
  });

  it("falls back to pending when there is no status at all", () => {
    expect(
      recurringStatusPill(instance({ status: null, planned_datetime: "2026-08-27T12:00:00.000Z" }), now).label,
    ).toBe("pending");
  });
});

describe("recurringPerformanceRows", () => {
  it("totals each assignee's work and orders the best completion first", () => {
    const rows = recurringPerformanceRows([
      instance({
        assignees: [{ id: "a", name: "Asha" }],
        status: "completed",
        verification_status: "verified",
        on_time_status: "on_time",
      }),
      instance({
        assignees: [{ id: "a", name: "Asha" }],
        status: "completed",
        on_time_status: "delayed",
        completion_mode: "on_behalf",
      }),
      instance({ assignees: [{ id: "b", name: "Bala" }] }),
    ]);

    expect(rows).toEqual([
      { name: "Asha", assigned: 2, completed: 2, verified: 1, onTime: 1, delayed: 1, onBehalf: 1 },
      { name: "Bala", assigned: 1, completed: 0, verified: 0, onTime: 0, delayed: 0, onBehalf: 0 },
    ]);
  });

  it("counts an occurrence once per assignee", () => {
    const rows = recurringPerformanceRows([
      instance({
        assignees: [
          { id: "a", name: "Asha" },
          { id: "b", name: "Bala" },
        ],
      }),
    ]);
    expect(rows.map((row) => row.assigned)).toEqual([1, 1]);
  });

  it("breaks a tie on completions by name", () => {
    const rows = recurringPerformanceRows([
      instance({ assignees: [{ id: "b", name: "Bala" }] }),
      instance({ assignees: [{ id: "a", name: "Asha" }] }),
    ]);
    expect(rows.map((row) => row.name)).toEqual(["Asha", "Bala"]);
  });
});

describe("recurringPerformanceScores", () => {
  it("reports the shared pending and delayed scores, including assigned-but-unfinished work", () => {
    expect(
      recurringPerformanceScores({ name: "Asha", assigned: 4, completed: 3, verified: 0, onTime: 1, delayed: 2, onBehalf: 0 }),
    ).toEqual({ pending: -25, delayed: -66.7 });
    expect(
      recurringPerformanceScores({ name: "Bala", assigned: 1, completed: 0, verified: 0, onTime: 0, delayed: 0, onBehalf: 0 }),
    ).toEqual({ pending: -100, delayed: -100 });
    expect(
      recurringPerformanceScores({ name: "Chitra", assigned: 0, completed: 0, verified: 0, onTime: 0, delayed: 0, onBehalf: 0 }),
    ).toEqual({ pending: null, delayed: null });
  });
});

describe("canManageRecurringWorkspace", () => {
  it("admits only the roles the workspace RPC itself admits", () => {
    expect(canManageRecurringWorkspace("super_admin")).toBe(true);
    expect(canManageRecurringWorkspace("admin")).toBe(true);
    for (const role of ["manager", "hr", "employee", "", null, undefined])
      expect(canManageRecurringWorkspace(role)).toBe(false);
  });
});

describe("deriveRecurringWorkCardState", () => {
  const view = (task: RecurringInstanceLike, overrides: Partial<{ viewerId: string; canManage: boolean; followupEnabled: boolean }> = {}) =>
    deriveRecurringWorkCardState({
      task,
      viewerId: "me",
      canManage: false,
      followupEnabled: false,
      ...overrides,
    });

  it("never asks for a completion remark, on behalf or not", () => {
    const mine = view(instance({ assignees: [{ id: "me", name: "Me" }], requires_remark: true }));
    expect(mine.isOwnWork).toBe(true);
    expect(mine).not.toHaveProperty("needsRemark");
    expect(view(instance({ assignees: [{ id: "other", name: "Other" }] }))).not.toHaveProperty("remarkPrompt");
  });

  it("offers Complete checklist only once every required item is ticked", () => {
    const open = view(instance({ task_type: "checklist", checklist: [{ is_required: true, is_completed: false }] }));
    expect(open.checklistDone).toBe(false);
    expect(open.showCompleteChecklist).toBe(false);
    expect(view(instance({ task_type: "checklist", checklist: [{ is_required: true, is_completed: true }] })).showCompleteChecklist).toBe(true);
  });

  it("keeps a form task's checklist visible and its form action waiting on it", () => {
    const state = view(instance({ requires_form: true, form_template_id: "form-1", checklist: [{ is_required: true, is_completed: false }] }));
    expect(state.showChecklist).toBe(true);
    expect(state.completeFormDisabled).toBe(true);
  });

  it("offers verification to the named verifier as well as an administrator", () => {
    const task = instance({ status: "completed", verification_status: "pending", verifier_user_profile_id: "me" });
    expect(view(task).showVerify).toBe(true);
    expect(view(instance({ status: "completed", verification_status: "pending" })).showVerify).toBe(false);
    expect(view(instance({ status: "completed", verification_status: "pending" }), { canManage: true }).showVerify).toBe(true);
  });

  it("withholds completion until required checklist items and owed evidence are done", () => {
    expect(view(instance({ checklist: [{ is_required: true, is_completed: false }] })).canComplete).toBe(false);
    expect(view(instance({ checklist: [{ is_required: false, is_completed: false }] })).canComplete).toBe(true);
    expect(view(instance({ requires_upload: true })).canComplete).toBe(false);
    expect(view(instance({ requires_upload: true, has_attachment: true })).canComplete).toBe(true);
    expect(view(instance({ requires_form: true })).canComplete).toBe(false);
    expect(view(instance({ requires_form: true, has_form_submission: true })).canComplete).toBe(true);
  });

  it("collapses a form-backed occurrence to the form action alone", () => {
    const state = view(instance({ requires_form: true, form_template_id: "form-1", task_type: "checklist" }));
    expect(state.showCompleteForm).toBe(true);
    expect(state.completeFormDisabled).toBe(false);
    expect(state.showCompleteChecklist).toBe(false);
    expect(state.showComplete).toBe(false);
    expect(state.showUpload).toBe(false);
    expect(state.showChecklist).toBe(false);
  });

  it("disables the form action when the account cannot read the form version", () => {
    expect(view(instance({ requires_form: true })).completeFormDisabled).toBe(true);
  });

  it("hides both the form and the completion action while coverage is unresolved", () => {
    const uncovered = { coverage_status: "coverage_required" as const };
    expect(view(instance({ requires_form: true, form_template_id: "f", ...uncovered })).showCompleteForm).toBe(false);
    expect(view(instance({ task_type: "delegation", ...uncovered })).showComplete).toBe(false);
  });

  it("lets a checklist occurrence be completed even while coverage is unresolved", () => {
    expect(
      view(instance({ task_type: "checklist", coverage_status: "coverage_required" })).showCompleteChecklist,
    ).toBe(true);
  });

  it("offers upload-to-complete for either task type when upload is required", () => {
    expect(view(instance({ task_type: "delegation", requires_upload: true })).showUpload).toBe(true);
    expect(view(instance({ task_type: "delegation", requires_upload: true, has_attachment: true })).showUpload).toBe(false);
    expect(view(instance({ task_type: "checklist", requires_upload: true })).showUpload).toBe(true);
    expect(view(instance({ task_type: "checklist", requires_upload: true })).showCompleteChecklist).toBe(false);
  });

  it("offers follow-up only to a manager, on an enabled schedule, while work is outstanding", () => {
    const task = instance();
    expect(view(task, { canManage: true, followupEnabled: true }).showFollowup).toBe(true);
    expect(view(task, { canManage: false, followupEnabled: true }).showFollowup).toBe(false);
    expect(view(task, { canManage: true, followupEnabled: false }).showFollowup).toBe(false);
    expect(view(instance({ status: "completed" }), { canManage: true, followupEnabled: true }).showFollowup).toBe(false);
  });
});

describe("schedule actions", () => {
  it("has nothing to pause on an as-required schedule", () => {
    expect(canPauseRecurringTemplate({ schedule_kind: "daily" })).toBe(true);
    expect(canPauseRecurringTemplate({ schedule_kind: "as_required" })).toBe(false);
  });

  it("runs an as-required schedule now even while it is inactive", () => {
    expect(canRunRecurringTemplateNow({ is_active: true, schedule_kind: "daily" })).toBe(true);
    expect(canRunRecurringTemplateNow({ is_active: false, schedule_kind: "daily" })).toBe(false);
    expect(canRunRecurringTemplateNow({ is_active: false, schedule_kind: "as_required" })).toBe(true);
  });

  it("warns that deleting a used schedule archives it", () => {
    expect(recurringTemplateDeletePrompt("Open the safe")).toBe(
      "Delete Open the safe? Used schedules will be archived to preserve task history.",
    );
  });
});
