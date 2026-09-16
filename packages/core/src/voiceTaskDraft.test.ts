import { describe, expect, it } from "vitest";
import {
  autoAssignFromDepartment,
  buildVoiceTaskDraft,
  matchDepartmentByLabel,
  resolveVoiceAssignment,
  voiceDraftGapMessage,
  voiceDraftGaps,
  type VoiceAssignmentCandidate,
  type VoiceDepartment,
  type VoiceResolutionContext,
  type VoiceTaskHints,
} from "./voiceTaskDraft.ts";

const crm: VoiceDepartment = { id: "dept-crm", name: "Customer Relations", code: "CRM", head_id: "priya" };
const mdo: VoiceDepartment = { id: "dept-mdo", name: "Market Development", code: "MDO", head_id: null };

function person(overrides: Partial<VoiceAssignmentCandidate> & Pick<VoiceAssignmentCandidate, "id" | "employee_name">): VoiceAssignmentCandidate {
  return {
    branch_id: "branch-1",
    department_id: "dept-crm",
    account_status: "active",
    working_status: "active",
    open_task_count: 0,
    ...overrides,
  };
}

const people: VoiceAssignmentCandidate[] = [
  person({ id: "priya", employee_name: "Priya Nair", open_task_count: 6 }),
  person({ id: "anil", employee_name: "Anil Kumar", open_task_count: 4 }),
  person({ id: "reshma", employee_name: "Reshma Menon", open_task_count: 2 }),
  person({ id: "vivek", employee_name: "Vivek Rao", department_id: "dept-mdo", open_task_count: 1 }),
];

const context: VoiceResolutionContext = { people, departments: [crm, mdo], availability: [] };

const hints = (overrides: Partial<VoiceTaskHints> = {}): VoiceTaskHints => ({
  title: "Call back the Kochi walk-in",
  description: "",
  assignee_hint: null,
  department_hint: null,
  due_datetime: "2026-09-17T11:30:00.000Z",
  priority: "high",
  task_type: "delegation",
  checklist_items: [],
  ...overrides,
});

describe("matchDepartmentByLabel", () => {
  it("matches a spoken short code", () => {
    expect(matchDepartmentByLabel("CRM", [crm, mdo])?.id).toBe("dept-crm");
    expect(matchDepartmentByLabel("mdo", [crm, mdo])?.id).toBe("dept-mdo");
  });

  it("matches a full department name and a distinctive fragment", () => {
    expect(matchDepartmentByLabel("Customer Relations", [crm, mdo])?.id).toBe("dept-crm");
    expect(matchDepartmentByLabel("market", [crm, mdo])?.id).toBe("dept-mdo");
  });

  it("refuses an ambiguous or unknown label", () => {
    const duplicate: VoiceDepartment = { id: "dept-crm-2", name: "Customer Relations", code: "CR2", head_id: null };
    expect(matchDepartmentByLabel("Customer Relations", [crm, duplicate])).toBeUndefined();
    expect(matchDepartmentByLabel("logistics", [crm, mdo])).toBeUndefined();
    expect(matchDepartmentByLabel("", [crm, mdo])).toBeUndefined();
  });
});

describe("autoAssignFromDepartment", () => {
  it("prefers the department head even when others carry less work", () => {
    expect(autoAssignFromDepartment(crm, context)).toEqual({ assigneeId: "priya", reason: "Customer Relations department head" });
  });

  it("falls back to the lowest open load when the head is on leave", () => {
    const onLeave = { ...context, availability: [{ user_profile_id: "priya", status: "absent" }] };
    expect(autoAssignFromDepartment(crm, onLeave)).toEqual({ assigneeId: "reshma", reason: "Lowest open load in Customer Relations" });
  });

  it("skips half-day and inactive members", () => {
    const constrained: VoiceResolutionContext = {
      ...context,
      people: [
        person({ id: "priya", employee_name: "Priya Nair" }),
        person({ id: "anil", employee_name: "Anil Kumar", open_task_count: 1 }),
        person({ id: "reshma", employee_name: "Reshma Menon", working_status: "inactive", open_task_count: 0 }),
      ],
      availability: [{ user_profile_id: "priya", status: "half_day" }],
    };
    expect(autoAssignFromDepartment(crm, constrained).assigneeId).toBe("anil");
  });

  it("breaks an equal load by name so the result is stable", () => {
    const tied: VoiceResolutionContext = {
      ...context,
      people: [
        person({ id: "zoya", employee_name: "Zoya Khan", open_task_count: 3 }),
        person({ id: "anil", employee_name: "Anil Kumar", open_task_count: 3 }),
      ],
      departments: [{ ...crm, head_id: null }],
    };
    expect(autoAssignFromDepartment({ ...crm, head_id: null }, tied).assigneeId).toBe("anil");
  });

  it("assigns nobody when the department has no eligible member", () => {
    const empty = { ...context, people: [] };
    expect(autoAssignFromDepartment(crm, empty)).toEqual({ assigneeId: null, reason: null });
  });
});

describe("resolveVoiceAssignment", () => {
  it("resolves a spoken first name to a unique roster member", () => {
    expect(resolveVoiceAssignment(hints({ assignee_hint: "Reshma" }), context)).toEqual({ assigneeId: "reshma", reason: 'Matched "Reshma"' });
  });

  it("resolves nobody when a spoken first name is shared by two people", () => {
    const twoReshmas = {
      ...context,
      people: [
        person({ id: "reshma", employee_name: "Reshma Menon" }),
        person({ id: "reshma-2", employee_name: "Reshma Pillai" }),
      ],
    };
    expect(resolveVoiceAssignment(hints({ assignee_hint: "Reshma" }), twoReshmas).assigneeId).toBeNull();
  });

  it("prefers the named person over a department also mentioned", () => {
    const resolution = resolveVoiceAssignment(hints({ assignee_hint: "Vivek Rao", department_hint: "CRM" }), context);
    expect(resolution.assigneeId).toBe("vivek");
  });

  it("assigns a named person even when they are on leave, leaving coverage to the existing rules", () => {
    const onLeave = { ...context, availability: [{ user_profile_id: "reshma", status: "absent" }] };
    expect(resolveVoiceAssignment(hints({ assignee_hint: "Reshma" }), onLeave).assigneeId).toBe("reshma");
  });

  it("falls back to the department when the name matches nobody", () => {
    expect(resolveVoiceAssignment(hints({ assignee_hint: "Somebody Else", department_hint: "CRM" }), context).assigneeId).toBe("priya");
  });

  it("resolves nobody when neither a name nor a department is usable", () => {
    expect(resolveVoiceAssignment(hints(), context)).toEqual({ assigneeId: null, reason: null });
  });
});

describe("buildVoiceTaskDraft", () => {
  it("trims text and drops checklist items on a delegation task", () => {
    const draft = buildVoiceTaskDraft(hints({ title: "  Call back  ", description: " today ", checklist_items: ["ignored"] }), context);
    expect(draft.title).toBe("Call back");
    expect(draft.description).toBe("today");
    expect(draft.checklist).toEqual([]);
  });

  it("keeps non-empty checklist items on a checklist task", () => {
    const draft = buildVoiceTaskDraft(hints({ task_type: "checklist", checklist_items: [" Open store ", "", "Count stock"] }), context);
    expect(draft.checklist).toEqual(["Open store", "Count stock"]);
  });
});

describe("voiceDraftGaps", () => {
  it("reports no gaps for a complete delegation draft", () => {
    expect(voiceDraftGaps(buildVoiceTaskDraft(hints({ assignee_hint: "Reshma" }), context))).toEqual([]);
  });

  it("names the missing user when nothing resolved", () => {
    const gaps = voiceDraftGaps(buildVoiceTaskDraft(hints(), context));
    expect(gaps).toContain("assignee");
    expect(voiceDraftGapMessage("assignee")).toBe("User not selected.");
  });

  it("reports a missing title, due date, and empty checklist", () => {
    const draft = buildVoiceTaskDraft(hints({ title: "   ", due_datetime: null, task_type: "checklist", checklist_items: [] }), context);
    expect(voiceDraftGaps(draft)).toEqual(["title", "assignee", "due", "checklist"]);
  });
});
