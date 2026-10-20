import { describe, expect, it } from "vitest";
import { buildManualTaskCreateRequests, canShareManualTask, taskPriorityChoices, type ManualTaskDraftInput } from "./manualTaskDraft";

const people = [
  { id: "doer-1", branchId: "branch-1", departmentId: "department-1", eligible: true },
  { id: "watcher-1", branchId: "branch-1", departmentId: "department-1", eligible: true },
  { id: "outside-1", branchId: "branch-2", departmentId: "department-2", eligible: false },
  { id: "doer-2", branchId: "branch-1", departmentId: "department-1", eligible: true },
  { id: "doer-other-department", branchId: "branch-1", departmentId: "department-2", eligible: true },
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

describe("buildManualTaskCreateRequests", () => {
  it("builds the server request from the selected eligible doer's organization", () => {
    expect(buildManualTaskCreateRequests(draft())).toEqual({ requests: [{
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
    }] });
  });

  it("creates one task per selected user by default, each in that user's organization", () => {
    const result = buildManualTaskCreateRequests(draft({ selectedDoerIds: ["doer-1", "doer-other-department"] }));
    if ("error" in result) throw new Error(result.error.message);
    expect(result.requests.map((request) => [request.doerIds, request.payload.department_id, request.watcherIds])).toEqual([
      [["doer-1"], "department-1", ["watcher-1"]],
      [["doer-other-department"], "department-2", ["watcher-1"]],
    ]);
  });

  it("creates one shared task for users in the same branch and department", () => {
    const result = buildManualTaskCreateRequests(draft({ assignmentMode: "shared", selectedDoerIds: ["doer-1", "doer-2"] }));
    if ("error" in result) throw new Error(result.error.message);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toEqual(expect.objectContaining({
      doerIds: ["doer-1", "doer-2"],
      watcherIds: ["watcher-1"],
      payload: expect.objectContaining({ branch_id: "branch-1", department_id: "department-1" }),
    }));
  });

  it("checks whether a group can share one task", () => {
    expect(canShareManualTask([people[0], people[3]])).toBe(true);
    expect(canShareManualTask([people[0], people[4]])).toBe(false);
  });

  it("builds a required-form checklist with trimmed non-empty items", () => {
    expect(buildManualTaskCreateRequests(draft({
      mode: "checklist",
      formTemplateId: "form-1",
      checklistItems: [" First ", "", "Second"],
    }))).toEqual({ requests: [expect.objectContaining({
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
    })] });
  });

  it.each([
    ["blank title", { title: " " }, "Add a task title."],
    ["missing doer", { selectedDoerIds: [] }, "Select at least one user."],
    ["shared task across departments", { assignmentMode: "shared", selectedDoerIds: ["doer-1", "doer-other-department"] }, "A shared task needs every user in the same branch and department. Choose a separate task for each user instead."],
    ["one ineligible user among several", { selectedDoerIds: ["doer-1", "outside-1"] }, "The selected user is outside your task authoring scope."],
    ["ineligible doer", { selectedDoerIds: ["outside-1"] }, "The selected user is outside your task authoring scope."],
    ["unknown doer", { selectedDoerIds: ["missing"] }, "The selected user is no longer available."],
    ["missing organization", { eligiblePeople: [{ id: "doer-1", branchId: null, departmentId: null, eligible: true }] }, "The selected user needs an active branch and department."],
    ["missing due date", { plannedDatetime: "" }, "Choose a due date and time."],
    ["invalid due date", { plannedDatetime: "not-a-date" }, "Choose a valid due date and time."],
    ["empty checklist", { mode: "checklist", checklistItems: [" "] }, "Add at least one checklist item."],
  ] as const)("rejects %s", (_label, overrides, message) => {
    expect(buildManualTaskCreateRequests(draft(overrides))).toEqual({ error: { message } });
  });
});

describe("taskPriorityChoices", () => {
  it("always offers all three fixed priorities, high first", () => {
    expect(taskPriorityChoices([{ value: "high", label: "High" }])).toEqual([
      { value: "high", label: "High" },
      { value: "medium", label: "Medium" },
      { value: "low", label: "Low" },
    ]);
    expect(taskPriorityChoices([]).map((choice) => choice.value)).toEqual(["high", "medium", "low"]);
  });

  it("uses Dropdown Master labels and ignores codes the database does not accept", () => {
    expect(taskPriorityChoices([
      { value: "low", label: "Can wait" },
      { value: "urgent", label: "Urgent" },
      { value: "medium", label: "  " },
    ])).toEqual([
      { value: "high", label: "High" },
      { value: "medium", label: "Medium" },
      { value: "low", label: "Can wait" },
    ]);
  });
});
