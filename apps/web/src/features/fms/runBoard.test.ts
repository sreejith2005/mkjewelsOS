import { describe, expect, it } from "vitest";
import type { FmsInstance, FmsInstanceStage, FmsStageRow } from "./api";
import { fmsBoardColumns, fmsRunCard, fmsRunColumnKeys, fmsRunMatches, fmsRunPath, fmsStepsInFlowOrder } from "./runBoard";

const step = (id: string, patch: Partial<FmsStageRow> = {}): FmsStageRow => ({ id, fms_flow_id: "v2", stage_key: id, name: id.toUpperCase(), method: null, step_type: "task", sort_order: 0, is_required: true, planned_time_rule: {}, completion_rule: "any_doer", allow_multiple_doers: false, requires_upload: false, requires_remark: false, checklist_definition: [], form_template_id: null, requires_next_doer_handoff: false, can_move_backward: false, can_reject: false, can_request_revision: false, can_escalate: false, default_next_stage_id: null, parallel_target_stage_ids: [], join_rule: null, join_required_stage_ids: null, split_to_flow_id: null, ...patch });
const run = (id: string, patch: Partial<FmsInstance> = {}): FmsInstance => ({ id, fms_flow_id: "v2", reference_number: `FMS-${id}`, title: "INSTAGRAM LEADS · Form submission", status: "active", priority: "medium", context: {}, branch_id: null, department_id: null, started_by: "starter", started_at: null, completed_at: null, parent_instance_id: null, flow_version: 2, ...patch });
const visit = (id: string, instance: string, stage: string, patch: Partial<FmsInstanceStage> = {}): FmsInstanceStage => ({ id, fms_instance_id: instance, fms_stage_id: stage, status: "completed", assigned_to: ["a"], planned_datetime: null, actual_datetime: "2026-10-20T10:00:00Z", delay_minutes: null, sla_breached: null, form_submission_id: null, remark: null, outcome: null, completed_by: "a", escalation_count: 0, ...patch });

// Saved out of order on purpose: the board follows the connections, not the save order.
const steps = [
  step("enquiry", { step_type: "form", sort_order: 0, default_next_stage_id: "follow2" }),
  step("follow2", { sort_order: 2, default_next_stage_id: "proposal" }),
  step("proposal", { sort_order: 1 }),
  step("notify", { step_type: "notification", sort_order: 3 }),
];
const byId = new Map(steps.map((item) => [item.id, item]));

describe("FMS runs board", () => {
  it("orders steps by their connections and adds a Finished column", () => {
    expect(fmsStepsInFlowOrder(steps).map((item) => item.id)).toEqual(["enquiry", "follow2", "proposal", "notify"]);
    expect(fmsBoardColumns(steps, "v2").map((column) => column.name)).toEqual(["ENQUIRY", "FOLLOW2", "PROPOSAL", "Finished"]);
  });
  it("places a run in the column of its open step, with who has it and when it is due", () => {
    const card = fmsRunCard(run("r1"), [visit("v1", "r1", "enquiry"), visit("v2", "r1", "follow2", { status: "in_progress", assigned_to: ["sales"], planned_datetime: "2026-10-30T10:00:00Z", actual_datetime: null, completed_by: null })], byId, "2026-10-26T10:00:00Z");
    expect(card).toMatchObject({ stepKeys: ["follow2"], stepNames: ["FOLLOW2"], assigneeIds: ["sales"], dueAt: "2026-10-30T10:00:00Z", overdue: false, finished: false });
    expect(fmsRunColumnKeys(card)).toEqual(["follow2"]);
  });
  it("flags an overdue open step and files finished runs under Finished", () => {
    const late = fmsRunCard(run("r2"), [visit("v3", "r2", "proposal", { status: "pending", planned_datetime: "2026-10-01T10:00:00Z", actual_datetime: null })], byId, "2026-10-26T10:00:00Z");
    expect(late.overdue).toBe(true);
    const done = fmsRunCard(run("r3", { status: "completed" }), [visit("v4", "r3", "proposal")], byId);
    expect(fmsRunColumnKeys(done)).toEqual(["__finished"]);
  });
  it("filters by view, my work and the run name", () => {
    const open = fmsRunCard(run("r4"), [visit("v5", "r4", "follow2", { status: "in_progress", assigned_to: ["me"] })], byId);
    const finished = fmsRunCard(run("r5", { status: "cancelled" }), [], byId);
    const base = { mineOnly: false, profileId: "me", query: "" };
    expect(fmsRunMatches(open, { ...base, view: "in_progress", name: "Asha" })).toBe(true);
    expect(fmsRunMatches(finished, { ...base, view: "in_progress", name: "Ravi" })).toBe(false);
    expect(fmsRunMatches(finished, { ...base, view: "finished", name: "Ravi" })).toBe(true);
    expect(fmsRunMatches(finished, { ...base, view: "all", mineOnly: true, name: "Ravi" })).toBe(false);
    expect(fmsRunMatches(open, { ...base, view: "all", mineOnly: true, name: "Asha" })).toBe(true);
    expect(fmsRunMatches(open, { ...base, view: "all", query: "asha", name: "Asha Rao" })).toBe(true);
    expect(fmsRunMatches(open, { ...base, view: "all", query: "ravi", name: "Asha Rao" })).toBe(false);
  });
  it("draws the run's path: done, current, upcoming, and not needed once finished", () => {
    const visits = [visit("v6", "r6", "enquiry", { completed_by: "starter" }), visit("v7", "r6", "follow2", { status: "in_progress", assigned_to: ["sales"], planned_datetime: "2026-10-30T10:00:00Z", actual_datetime: null, completed_by: null })];
    expect(fmsRunPath(run("r6"), visits, steps).map((item) => [item.key, item.state, item.peopleIds.join()])).toEqual([["enquiry", "done", "starter"], ["follow2", "current", "sales"], ["proposal", "upcoming", ""]]);
    expect(fmsRunPath(run("r7", { status: "completed" }), [visit("v8", "r7", "enquiry")], steps).map((item) => item.state)).toEqual(["done", "not_needed", "not_needed"]);
  });
});
