import { describe, expect, it } from "vitest";
import { deriveTaskCardState, taskFormLinkedModule, type TaskCardInput } from "./taskCardState";
import type { TaskMutationCapability } from "./taskCapabilities";

const NOW = new Date("2026-09-09T10:00:00.000Z");

const task = (overrides: Partial<TaskCardInput> = {}): TaskCardInput => ({
  actual_datetime: null,
  assignee_id: "user-1",
  due_datetime: "2026-09-09T18:00:00.000Z",
  id: "task-1",
  planned_datetime: "2026-09-09T18:00:00.000Z",
  revised_datetime: null,
  status: "pending",
  task_type: "checklist",
  requires_form: false,
  requires_upload: false,
  ...overrides,
});

const capability = (overrides: Partial<TaskMutationCapability> = {}): TaskMutationCapability => ({
  access: "doer",
  canMutate: true,
  canUseElevatedActions: false,
  watcherLabel: null,
  ...overrides,
});

const derive = (
  overrides: Partial<Parameters<typeof deriveTaskCardState>[0]> = {},
) =>
  deriveTaskCardState({
    task: task(),
    hasAttachment: false,
    hasFormSubmission: false,
    checklists: [],
    capability: capability(),
    now: NOW,
    ...overrides,
  });

describe("deriveTaskCardState", () => {
  it("offers completion on an ordinary assigned task", () => {
    const state = derive();
    expect(state.readOnly).toBe(false);
    expect(state.canComplete).toBe(true);
    expect(state.showDirectComplete).toBe(true);
    expect(state.showDirectUpload).toBe(false);
  });

  describe("an outstanding checklist never withholds completion", () => {
    // Imported occurrences each carry one required item repeating the task
    // headline. Gating the action behind it left every such task uncompletable;
    // the server closes the remainder (migration 0142).
    it("still allows completion with required items outstanding", () => {
      const state = derive({
        checklists: [
          { is_completed: false, is_required: true },
          { is_completed: false, is_required: true },
        ],
      });
      expect(state.canComplete).toBe(true);
      expect(state.showDirectComplete).toBe(true);
      expect(state.checklistProgress.completedItems).toBe(0);
      expect(state.checklistProgress.totalItems).toBe(2);
    });
  });

  describe("read-only cases", () => {
    it("treats an FMS stage as read-only in the feed even for a doer", () => {
      expect(derive({ task: task({ task_type: "fms" }) }).readOnly).toBe(true);
    });

    it("treats an FMS stage as read-only even for an elevated viewer", () => {
      const state = derive({
        task: task({ task_type: "fms" }),
        capability: capability({ access: "elevated", canUseElevatedActions: true }),
      });
      expect(state.readOnly).toBe(true);
      expect(state.showDirectComplete).toBe(false);
    });

    it("is read-only when the viewer cannot mutate", () => {
      const state = derive({ capability: capability({ access: "read_only", canMutate: false }) });
      expect(state.readOnly).toBe(true);
      expect(state.showDirectComplete).toBe(false);
    });
  });

  describe("evidence and forms gate completion", () => {
    it("withholds completion until a required upload exists", () => {
      const state = derive({ task: task({ requires_upload: true }), hasAttachment: false });
      expect(state.canComplete).toBe(false);
      expect(state.showDirectUpload).toBe(true);
    });

    it("allows completion once the upload is present", () => {
      const state = derive({ task: task({ requires_upload: true }), hasAttachment: true });
      expect(state.canComplete).toBe(true);
      expect(state.showDirectUpload).toBe(false);
    });

    it("withholds completion until a required form is submitted", () => {
      const state = derive({ task: task({ requires_form: true }), hasFormSubmission: false });
      expect(state.canComplete).toBe(false);
      expect(state.formOnlyAction).toBe(true);
      // A form-only card shows the form action rather than a complete button.
      expect(state.showDirectComplete).toBe(false);
    });

    it("allows completion once the form is submitted", () => {
      expect(derive({ task: task({ requires_form: true }), hasFormSubmission: true }).canComplete).toBe(true);
    });

    it("stops treating the card as form-only once the task is completed", () => {
      const state = derive({ task: task({ requires_form: true, status: "completed" }) });
      expect(state.formOnlyAction).toBe(false);
      expect(state.completed).toBe(true);
    });
  });

  describe("revise", () => {
    it("offers revise on a delegation task to an elevated viewer", () => {
      const state = derive({
        task: task({ task_type: "delegation" }),
        capability: capability({ access: "elevated", canUseElevatedActions: true }),
      });
      expect(state.showReviseForm).toBe(true);
    });

    it("does not offer revise to an ordinary doer", () => {
      expect(derive({ task: task({ task_type: "delegation" }) }).showReviseForm).toBe(false);
    });

    it("does not offer revise on a checklist task", () => {
      const state = derive({
        capability: capability({ access: "elevated", canUseElevatedActions: true }),
      });
      expect(state.showReviseForm).toBe(false);
    });
  });

  describe("status", () => {
    it("marks a task overdue once its deadline has passed", () => {
      const state = derive({
        task: task({ due_datetime: "2026-09-09T08:00:00.000Z", planned_datetime: "2026-09-09T08:00:00.000Z" }),
      });
      expect(state.overdue).toBe(true);
    });

    it("prefers the revised deadline over the due date", () => {
      const state = derive({ task: task({ revised_datetime: "2026-09-10T18:00:00.000Z" }) });
      expect(state.deadline).toBe("2026-09-10T18:00:00.000Z");
      expect(state.overdue).toBe(false);
    });

    it("offers nothing on a blocked task", () => {
      const state = derive({ task: task({ status: "blocked" }) });
      expect(state.blocked).toBe(true);
      expect(state.showDirectComplete).toBe(false);
      expect(state.showReviseForm).toBe(false);
    });
  });
});

describe("taskFormLinkedModule", () => {
  it("files a delegation task's form under the only module the server accepts for it", () => {
    expect(taskFormLinkedModule("delegation")).toBe("delegation_task");
  });

  it("files every other task's form as a checklist task", () => {
    for (const type of ["checklist", "fms", null, undefined])
      expect(taskFormLinkedModule(type)).toBe("checklist_task");
  });
});
