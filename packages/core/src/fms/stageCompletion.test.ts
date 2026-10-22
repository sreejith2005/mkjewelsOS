import { describe, expect, it } from "vitest";
import { fmsStageCompletionChecklist, fmsEmployeeStatusLabel, type FmsStageRequirementInput } from "./stageCompletion";

const none: FmsStageRequirementInput = {
  formRequired: false, formSubmitted: false, decisionRequired: false, decisionChosen: false,
  requiredChecklistOpen: 0, requiredChecklistTotal: 0, evidenceRequired: false, evidenceCount: 0,
  remarkRequired: false, remarkProvided: false, nextAssigneeRequired: false, nextAssigneeChosen: false,
};

describe("stage completion guidance", () => {
  it("lists nothing for a stage with no requirements", () => {
    expect(fmsStageCompletionChecklist(none)).toEqual([]);
  });

  it("lists every outstanding requirement in work order", () => {
    const items = fmsStageCompletionChecklist({ ...none, formRequired: true, formName: "Call report", requiredChecklistTotal: 3, requiredChecklistOpen: 2,
      evidenceRequired: true, decisionRequired: true, remarkRequired: true, nextAssigneeRequired: true });
    expect(items.map(item => item.key)).toEqual(["form", "checklist", "evidence", "decision", "remark", "next_assignee"]);
    expect(items.every(item => !item.done)).toBe(true);
    expect(items[0]?.label).toBe('Fill and submit the form "Call report"');
    expect(items[1]?.label).toContain("2 left");
  });

  it("marks finished requirements as done", () => {
    const items = fmsStageCompletionChecklist({ ...none, formRequired: true, formSubmitted: true, requiredChecklistTotal: 2, evidenceRequired: true, evidenceCount: 1,
      remarkRequired: true, remarkProvided: true });
    expect(items.every(item => item.done)).toBe(true);
    expect(items[0]?.label).toBe("Fill and submit the stage form");
  });
});

describe("status wording", () => {
  it("uses employee words instead of stored codes", () => {
    expect(fmsEmployeeStatusLabel("in_review")).toBe("Waiting for approval");
    expect(fmsEmployeeStatusLabel("pending")).toBe("Not started");
    expect(fmsEmployeeStatusLabel("some_new_state")).toBe("Some New State");
    expect(fmsEmployeeStatusLabel("")).toBe("Unknown");
  });
});
