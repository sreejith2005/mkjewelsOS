import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setUuidFactory } from "../runtime";
import { fmsDepartmentLabel, fmsDepartmentsForBranch, fmsUsersForDepartment } from "./departments";
import { flowToDefinition, newerFormVersion, newFmsStage, parseBranchRuleValue, removeFmsStage } from "./definition";
import { fmsGraphEdges, layoutFmsDefinition } from "./graph";
import type { FmsData, FmsFlowRow } from "./api";

// The same cases the web `features/fms/*.test.ts` files cover, run against the
// shared copies the native builder uses.
beforeAll(() => setUuidFactory(randomUUID));

describe("FMS definition adapter", () => {
  it.each(["task", "approval", "form", "notification", "branch", "parallel_start", "parallel_join"] as const)("creates a safe %s stage", (type) => {
    const value = newFmsStage(type, 2);
    expect(value.type).toBe(type);
    expect(value.order).toBe(2);
    expect(value.key).toBe("stage_3");
  });
  it("uses manager approval for approval stages", () => expect(newFmsStage("approval", 0).completionRule).toBe("manager_approval"));
  it("creates a deterministic default route for branch stages", () => expect(newFmsStage("branch", 0).branchRules[0]?.operator).toBe("default"));
  it("does not create human assignees for automatic stages", () => expect(newFmsStage("notification", 0).assigneeRules).toEqual([]));
  it("rehydrates graph relationships while leaving legacy role assignments out of the named-user editor", () => {
    const flow: FmsFlowRow = { id: "f", family_id: "family", version: 3, name: "Flow", description: "D", status: "draft", scope_type: "tenant", branch_id: null, department_id: null, is_active: true, usage_count: 2 };
    const stage = { method: null, sort_order: 0, is_required: true, completion_rule: "any_doer" as const, allow_multiple_doers: false, requires_upload: false, requires_remark: false, checklist_definition: [], form_template_id: null, requires_next_doer_handoff: false, can_move_backward: false, can_reject: false, can_request_revision: false, can_escalate: false, parallel_target_stage_ids: [], join_rule: null, join_required_stage_ids: [], split_to_flow_id: null };
    const data = {
      flows: [flow],
      stages: [
        { ...stage, id: "s1", fms_flow_id: "f", stage_key: "start", name: "Start", step_type: "task" as const, planned_time_rule: { dueDate: "2099-12-30" }, default_next_stage_id: "s2" },
        { ...stage, id: "s2", fms_flow_id: "f", stage_key: "done", name: "Done", step_type: "end" as const, sort_order: 1, planned_time_rule: { dueDate: "2099-12-31" }, default_next_stage_id: null },
      ],
      assignees: [{ fms_stage_id: "s1", assignee_type: "reporter", user_profile_id: null, role_value: null, allow_next_selection: false, sort_order: 0 }],
      branchRules: [], forms: [], formFields: {}, users: [], availability: [], branches: [], departments: [],
    } as unknown as FmsData;
    const definition = flowToDefinition(flow, data);
    expect(definition.version).toBe(3);
    expect(definition.stages[0]?.defaultNextStageKey).toBe("done");
    expect(definition.stages[0]?.assigneeRules).toEqual([]);
    expect(definition.stages[0]?.sla.dueDate).toBe("2099-12-30");
    expect(definition.stages[1]?.type).toBe("end");
  });
  it("restores a multi-value route on load and leaves single answers alone", () => {
    expect(parseBranchRuleValue("in", '["bought","interested"]')).toEqual(["bought", "interested"]);
    expect(parseBranchRuleValue("in", "bought, interested")).toEqual(["bought", "interested"]);
    expect(parseBranchRuleValue("equals", "bought")).toBe("bought");
    expect(parseBranchRuleValue("equals", null)).toBeUndefined();
  });
  it("offers the newest published version of a pinned Form family", () => {
    const forms = [{ id: "v1", name: "Purchase", version: 1, family_id: "fam", lifecycle: "archived" }, { id: "v2", name: "Purchase", version: 2, family_id: "fam", lifecycle: "published" }] as unknown as FmsData["forms"];
    expect(newerFormVersion(forms, "v1")?.id).toBe("v2");
    expect(newerFormVersion(forms, "v2")).toBeUndefined();
    expect(newerFormVersion(forms, undefined)).toBeUndefined();
  });
  it("repairs simple incoming routes when a stage is removed", () => {
    const first = { ...newFmsStage("form", 0), key: "first", defaultNextStageKey: "middle" };
    const middle = { ...newFmsStage("task", 1), key: "middle", defaultNextStageKey: "last" };
    const last = { ...newFmsStage("task", 2), key: "last" };
    expect(removeFmsStage([first, middle, last], "middle")[0]?.defaultNextStageKey).toBe("last");
  });
});

describe("FMS graph presentation", () => {
  it("lays out explicit routes rather than stage array order", () => {
    const first = { ...newFmsStage("form", 0), key: "first", defaultNextStageKey: "last" };
    const middle = { ...newFmsStage("task", 1), key: "middle" };
    const last = { ...newFmsStage("task", 2), key: "last" };
    const positions = layoutFmsDefinition({ name: "Graph", scope: "tenant", manualTrigger: true, stages: [first, middle, last] });
    expect(positions.get("last")!.x).toBeGreaterThan(positions.get("first")!.x);
    expect(positions.get("middle")!.x).toBeGreaterThan(positions.get("last")!.x);
  });
  it("labels conditional and parallel edges", () => {
    const branch = { ...newFmsStage("branch", 0), key: "route", branchRules: [{ id: "r", source: "outcome" as const, operator: "default" as const, nextStageKey: "done", order: 0 }] };
    const done = { ...newFmsStage("task", 1), key: "done" };
    expect(fmsGraphEdges([branch, done])).toEqual([{ from: "route", to: "done", label: "Otherwise", kind: "branch", ruleId: "r" }]);
  });
  it("names a form-answer edge with the question and answer labels, not their stable keys", () => {
    const formId = "00000000-0000-4000-8000-000000000001";
    const fields = { [formId]: [{ key: "purchased_jewellery", label: "Did the customer buy jewellery?", options: [{ value: "bought", label: "Bought Jewellery" }, { value: "not_bought", label: "Did Not Buy" }] }] };
    const purchase = { ...newFmsStage("form", 0), key: "purchase", formTemplateId: formId, defaultNextStageKey: "reason", branchRules: [{ id: "r1", source: "form_answer" as const, sourceKey: "purchased_jewellery", operator: "equals" as const, value: "bought", nextStageKey: "product", order: 0 }] };
    const product = { ...newFmsStage("task", 1), key: "product" };
    const reason = { ...newFmsStage("task", 2), key: "reason" };
    const edges = fmsGraphEdges([purchase, product, reason], fields);
    expect(edges[0]).toMatchObject({ to: "product", label: "Did the customer buy jewellery? is Bought Jewellery" });
    expect(edges[1]).toMatchObject({ to: "reason", label: "Otherwise" });
  });
});

describe("FMS department options", () => {
  const departments = [
    { id: "global", branch_id: null, name: "Sales" },
    { id: "b1-dept", branch_id: "b1", name: "Workshop" },
    { id: "b2-dept", branch_id: "b2", name: "Accounts" },
  ] as unknown as FmsData["departments"];
  it("keeps tenant-wide departments visible after choosing a branch", () => {
    expect(fmsDepartmentsForBranch(departments, "b1").map((item) => item.id)).toEqual(["global", "b1-dept"]);
  });
  it("shows every department before a branch is selected", () => {
    expect(fmsDepartmentsForBranch(departments).map((item) => item.id)).toEqual(["global", "b1-dept", "b2-dept"]);
  });
  it("adds branch context only to branch-specific department labels", () => {
    const branches = [{ id: "b1", name: "Main" }] as unknown as FmsData["branches"];
    expect(fmsDepartmentLabel(departments[0]!, branches)).toBe("Sales");
    expect(fmsDepartmentLabel(departments[1]!, branches)).toBe("Main · Workshop");
  });
  it("uses the same non-resigned department population for primary and fallback", () => {
    const users = [
      { id: "primary", department_id: "global", working_status: "active" },
      { id: "fallback", department_id: "global", working_status: "inactive" },
      { id: "resigned", department_id: "global", working_status: "resigned" },
      { id: "other-branch", department_id: "global", working_status: "active" },
    ] as unknown as FmsData["users"];
    expect(fmsUsersForDepartment(users, "global").map((user) => user.id)).toEqual(["primary", "fallback", "other-branch"]);
  });
});
