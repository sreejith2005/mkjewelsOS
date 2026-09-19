import { describe, expect, it } from "vitest";
import { buildManualTaskCreateRequest, type ManualTaskDraftInput } from "./manualTaskDraft";

const people = [
  { id: "doer-1", branchId: "branch-1", departmentId: "department-1", eligible: true },
  { id: "watcher-1", branchId: "branch-1", departmentId: "department-1", eligible: true },
  { id: "outside-1", branchId: "branch-2", departmentId: "department-2", eligible: false },
] as const;

function draft(overrides: Partial<ManualTaskDraftInput> = {}): ManualTaskDraftInput {
  return {
    title: " Photograph the counter ",
    description: " Before opening ",
    plannedDatetime: "2026-09-20T03:30:00.000Z",
    priority: "high",
    mode: "task",
    selectedDoerIds: ["doer-1", "doer-1"],
    selectedWatcherIds: ["watcher-1", "doer-1", "watcher-1"],
    formTemplateId: "",
    checklistItems: [],
    eligiblePeople: people,
    ...overrides,
  };
}

describe("buildManualTaskCreateRequest", () => {
  it("builds the server request from the selected eligible doer's organization", () => {
    expect(buildManualTaskCreateRequest(draft())).toEqual({
      payload: {
        title: "Photograph the counter",
        description: "Before opening",
        planned_datetime: "2026-09-20T03:30:00.000Z",
        priority: "high",
        branch_id: "branch-1",
        department_id: "department-1",
        task_type: "delegation",
        requires_upload: true,
        requires_remark: false,
        requires_form: false,
        form_template_id: "",
      },
      doerIds: ["doer-1"],
      watcherIds: ["watcher-1"],
      checklist: [],
    });
  });

  it("builds a required-form checklist with trimmed non-empty items", () => {
    expect(buildManualTaskCreateRequest(draft({
      mode: "checklist",
      formTemplateId: "form-1",
      checklistItems: [" First ", "", "Second"],
    }))).toEqual(expect.objectContaining({
      payload: expect.objectContaining({
        task_type: "checklist",
        requires_upload: false,
        requires_form: true,
        form_template_id: "form-1",
      }),
      checklist: [
        { item_text: "First", is_required: true, sort_order: 0 },
        { item_text: "Second", is_required: true, sort_order: 1 },
      ],
    }));
  });

  it.each([
    ["blank title", { title: " " }, "Add a task title."],
    ["missing doer", { selectedDoerIds: [] }, "Select at least one user."],
    ["multiple doers", { selectedDoerIds: ["doer-1", "watcher-1"] }, "Select at least one user."],
    ["ineligible doer", { selectedDoerIds: ["outside-1"] }, "The selected user is outside your task authoring scope."],
    ["unknown doer", { selectedDoerIds: ["missing"] }, "The selected user is no longer available."],
    ["missing organization", { eligiblePeople: [{ id: "doer-1", branchId: null, departmentId: null, eligible: true }] }, "The selected user needs an active branch and department."],
    ["missing due date", { plannedDatetime: "" }, "Choose a due date and time."],
    ["invalid due date", { plannedDatetime: "not-a-date" }, "Choose a valid due date and time."],
    ["empty checklist", { mode: "checklist", checklistItems: [" "] }, "Add at least one checklist item."],
  ] as const)("rejects %s", (_label, overrides, message) => {
    expect(buildManualTaskCreateRequest(draft(overrides))).toEqual({ error: { message } });
  });
});
