import { describe, expect, it } from "vitest";
import {
  autoAssignFromDepartment,
  buildVoiceTaskDraft as buildDraft,
  matchDepartmentByLabel,
  resolveVoiceAssignment,
  VOICE_TASK_SPEAKING_GUIDE,
  voiceDraftGapMessage,
  voiceDraftGaps,
  type VoiceAssignmentCandidate,
  type VoiceDepartment,
  type VoiceDraftGap,
  type VoiceResolutionContext,
  type VoiceTaskHints,
} from "./voiceTaskDraft.ts";
import { resolveVoiceDeadline, type VoiceDeadline } from "./voiceDeadline.ts";

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
  date_expression: "tomorrow",
  time_expression: "5 pm",
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

  it("tolerates filler words, spelled-out codes, and the echoed label form", () => {
    expect(matchDepartmentByLabel("MDO department", [crm, mdo])?.id).toBe("dept-mdo");
    expect(matchDepartmentByLabel("the CRM team", [crm, mdo])?.id).toBe("dept-crm");
    expect(matchDepartmentByLabel("M.D.O.", [crm, mdo])?.id).toBe("dept-mdo");
    expect(matchDepartmentByLabel("Customer Relations (CRM)", [crm, mdo])?.id).toBe("dept-crm");
    expect(matchDepartmentByLabel("department", [crm, mdo])).toBeUndefined();
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

  it("ignores a form of address around the spoken name", () => {
    expect(resolveVoiceAssignment(hints({ assignee_hint: "Anil sir" }), context).assigneeId).toBe("anil");
    expect(resolveVoiceAssignment(hints({ assignee_hint: "Priya ji" }), context).assigneeId).toBe("priya");
  });

  it("accepts a one-letter transcription slip only when it stays unique", () => {
    expect(resolveVoiceAssignment(hints({ assignee_hint: "Rashma" }), context).assigneeId).toBe("reshma");
    const twoNear = { ...context, people: [...people, person({ id: "rashmi", employee_name: "Rashmi Das" })] };
    expect(resolveVoiceAssignment(hints({ assignee_hint: "Rashma" }), twoNear).assigneeId).toBeNull();
    expect(resolveVoiceAssignment(hints({ assignee_hint: "Anu" }), { ...context, people: [person({ id: "anil", employee_name: "Anil Kumar" })] }).assigneeId).toBeNull();
  });

  it("settles a shared first name by the department spoken with it", () => {
    const twoReshmas = {
      ...context,
      people: [
        person({ id: "reshma", employee_name: "Reshma Menon" }),
        person({ id: "reshma-mdo", employee_name: "Reshma Pillai", department_id: "dept-mdo" }),
      ],
    };
    const resolution = resolveVoiceAssignment(hints({ assignee_hint: "Reshma", department_hint: "MDO" }), twoReshmas);
    expect(resolution).toEqual({ assigneeId: "reshma-mdo", reason: 'Matched "Reshma" in Market Development' });
  });

  it("treats a department spoken in place of a person as the department", () => {
    expect(resolveVoiceAssignment(hints({ assignee_hint: "MDO team" }), context)).toEqual({ assigneeId: "vivek", reason: "Lowest open load in Market Development" });
  });

  it("resolves nobody when neither a name nor a department is usable", () => {
    expect(resolveVoiceAssignment(hints(), context)).toEqual({ assigneeId: null, reason: null });
  });
});

const deadlineFor = (value: VoiceTaskHints): VoiceDeadline => resolveVoiceDeadline({
  dateExpression: value.date_expression,
  timeExpression: value.time_expression,
  now: "2026-09-16T10:00:00+05:30",
  timeZone: "Asia/Kolkata",
});

/** The draft the worker builds: hints plus the deadline resolved from them. */
function buildVoiceTaskDraft(value: VoiceTaskHints, resolution: VoiceResolutionContext) {
  return buildDraft(value, resolution, deadlineFor(value));
}

describe("buildVoiceTaskDraft", () => {
  it("fills the due date only from a resolved deadline", () => {
    const draft = buildVoiceTaskDraft(hints(), context);
    expect(draft.plannedDatetime).toBe("2026-09-17T11:30:00.000Z");
    expect(draft.deadline).toMatchObject({ status: "resolved", dateExpression: "tomorrow", timeExpression: "5 pm" });
  });

  it("leaves the due date empty for an ambiguous or missing deadline", () => {
    const ranged = buildVoiceTaskDraft(hints({ date_expression: "next week", time_expression: null }), context);
    expect(ranged.plannedDatetime).toBeNull();
    expect(ranged.deadline.status).toBe("ambiguous");
    expect(voiceDraftGaps(ranged)).toContain("due");
    const missing = buildVoiceTaskDraft(hints({ date_expression: null, time_expression: null }), context);
    expect(missing.plannedDatetime).toBeNull();
    expect(missing.deadline.status).toBe("missing");
  });

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
    const draft = buildVoiceTaskDraft(hints({ title: "   ", date_expression: null, time_expression: null, task_type: "checklist", checklist_items: [] }), context);
    expect(voiceDraftGaps(draft)).toEqual(["title", "assignee", "due", "checklist"]);
  });
});

describe("VOICE_TASK_SPEAKING_GUIDE", () => {
  it("asks for the task first, then details, the assignee, and the deadline", () => {
    expect(VOICE_TASK_SPEAKING_GUIDE.map((step) => step.id).slice(0, 4)).toEqual(["task", "details", "assignee", "due"]);
  });

  it("prompts for every part the composer can report as missing", () => {
    const allGaps: readonly VoiceDraftGap[] = ["title", "assignee", "due", "checklist"];
    const prompted = VOICE_TASK_SPEAKING_GUIDE.flatMap((step) => step.gap ? [step.gap] : []);
    expect([...prompted].sort()).toEqual([...allGaps].sort());
  });

  it("marks exactly the always-required parts as required", () => {
    expect(VOICE_TASK_SPEAKING_GUIDE.filter((step) => step.required).map((step) => step.gap)).toEqual(["title", "assignee", "due"]);
  });
});
