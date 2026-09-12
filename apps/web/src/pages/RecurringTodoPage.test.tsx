import { describe, expect, it } from "vitest";
import {
  canManageRecurringWorkspace,
  deriveRecurringWorkCardState,
  RECURRING_TODO_TABS,
  type RecurringInstanceLike,
} from "@jewelos/core";

// The bucket, action and verification rules this page used to hold inline now
// live in `@jewelos/core` so the Android app cannot disagree with them. The
// assertions below follow them there; what is still decided in the page is
// still asserted against the page's own source.

function instance(overrides: Partial<RecurringInstanceLike> = {}): RecurringInstanceLike {
  return {
    actual_datetime: null,
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

describe("Recurring / To-Do workspace contract", () => {
  it("keeps operational buckets and manager tools in the dedicated workspace", async () => {
    const source = await import("./RecurringTodoPage?raw").then((module) => module.default);
    expect(RECURRING_TODO_TABS.map(([, label]) => label)).toEqual([
      "Today", "Overdue", "Rejected", "Completed", "Coverage Required", "Manager Review",
      "My Work", "Schedules", "Verification", "Follow-ups", "Performance",
    ]);
    for (const label of ["Import schedules"]) {
      expect(source).toContain(label);
    }
    for (const action of ["Start", "Complete", "Upload", "Verify", "Reject", "Pause", "Activate", "Run now"]) {
      expect(source).toContain(action);
    }
    expect(source).toContain("Complete form");
    expect(source).toContain('aria-label="Complete checklist"');
    expect(source).toContain("completeRecurringTaskWithImage");

    // The form is the work: a form-backed occurrence collapses to that action.
    const form = deriveRecurringWorkCardState({
      task: instance({ requires_form: true, form_template_id: "f", task_type: "checklist" }),
      viewerId: "me", canManage: true, followupEnabled: true,
    });
    expect(form.showCompleteForm).toBe(true);
    expect(form.showCompleteChecklist).toBe(false);
    expect(form.showComplete).toBe(false);

    // Unresolved coverage withholds the form and the plain completion.
    const uncovered = deriveRecurringWorkCardState({
      task: instance({ requires_form: true, form_template_id: "f", coverage_status: "coverage_required" }),
      viewerId: "me", canManage: true, followupEnabled: true,
    });
    expect(uncovered.showCompleteForm).toBe(false);

    // A checklist occurrence completes in one tap; a task does not.
    expect(deriveRecurringWorkCardState({
      task: instance({ task_type: "checklist" }), viewerId: "me", canManage: true, followupEnabled: true,
    }).showCompleteChecklist).toBe(true);
    expect(deriveRecurringWorkCardState({
      task: instance({ task_type: "checklist" }), viewerId: "me", canManage: true, followupEnabled: true,
    }).showComplete).toBe(false);
  });

  it("admits only the roles the workspace RPC itself admits", () => {
    expect(canManageRecurringWorkspace("super_admin")).toBe(true);
    expect(canManageRecurringWorkspace("admin")).toBe(true);
    expect(canManageRecurringWorkspace("manager")).toBe(false);
  });

  it("materializes a due schedule immediately after saving it", async () => {
    const source = await import("./RecurringTodoPage?raw").then((module) => module.default);

    expect(source).toContain("materializeRecurringTemplate");
    expect(source).toContain("const templateId = await saveRecurringTemplate(id, payload);");
    expect(source).toContain("await materializeRecurringTemplate(templateId, payload);");
  });

  it("asks for a real completion remark instead of writing a placeholder", async () => {
    const source = await import("./RecurringTodoPage?raw").then((module) => module.default);

    expect(source).not.toContain("Completed from Recurring / To-Do");
    expect(source).toContain("const entered = state.needsRemark ? window.prompt(state.remarkPrompt) : null;");
    expect(source).toContain("if (state.needsRemark && !entered?.trim()) return;");

    const own = deriveRecurringWorkCardState({
      task: instance({ assignees: [{ id: "me", name: "Me" }] }),
      viewerId: "me", canManage: false, followupEnabled: false,
    });
    expect(own.needsRemark).toBe(false);
    expect(own.remarkPrompt).toBe("Completion remark");

    const onBehalf = deriveRecurringWorkCardState({
      task: instance({ assignees: [{ id: "other", name: "Other" }] }),
      viewerId: "me", canManage: true, followupEnabled: false,
    });
    expect(onBehalf.needsRemark).toBe(true);
    expect(onBehalf.remarkPrompt).toBe("Why are you completing this on behalf of the doer?");

    // A schedule that demands a remark demands it from the doer too.
    expect(deriveRecurringWorkCardState({
      task: instance({ assignees: [{ id: "me", name: "Me" }], requires_remark: true }),
      viewerId: "me", canManage: false, followupEnabled: false,
    }).needsRemark).toBe(true);
  });

  it("offers verification to the named verifier as well as an administrator", () => {
    const awaiting = { status: "completed", verification_status: "pending" } as const;
    const verifier = deriveRecurringWorkCardState({
      task: instance({ ...awaiting, verifier_user_profile_id: "me" }),
      viewerId: "me", canManage: false, followupEnabled: false,
    });
    expect(verifier.canVerify).toBe(true);
    expect(verifier.showVerify).toBe(true);

    expect(deriveRecurringWorkCardState({
      task: instance(awaiting), viewerId: "me", canManage: true, followupEnabled: false,
    }).showVerify).toBe(true);

    // Anyone else sees no decision to make.
    expect(deriveRecurringWorkCardState({
      task: instance(awaiting), viewerId: "me", canManage: false, followupEnabled: false,
    }).showVerify).toBe(false);

    // A form-backed occurrence is verified through the form, not here.
    expect(deriveRecurringWorkCardState({
      task: instance({ ...awaiting, requires_form: true, verifier_user_profile_id: "me" }),
      viewerId: "me", canManage: true, followupEnabled: false,
    }).showVerify).toBe(false);
  });

  it("filters the workspace on the reference filter set and reports the on-time outcome", async () => {
    const source = await import("./RecurringTodoPage?raw").then((module) => module.default);

    for (const filter of ["status: statusFilter", "priority: priorityFilter", "branch_id: branchFilter", "department_id: departmentFilter"]) {
      expect(source).toContain(filter);
    }
    for (const tile of ["On time", "Delayed", "On behalf"]) {
      expect(source).toContain(tile);
    }
    expect(source).toContain("Delayed by ${task.completion_delay_minutes ?? 0} min");
  });
});
