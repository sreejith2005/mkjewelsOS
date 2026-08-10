import { describe, expect, it } from "vitest";
import { getMenuForRole } from "@jewelos/core";
import { eligibleFmsUsers, filterFmsInstances, parseFmsContext, priorFmsDefinitions } from "./runtimeView";
import type { FmsData, FmsInstance, FmsInstanceStage, FmsStageRow } from "./api";

const instance = (patch: Partial<FmsInstance> = {}): FmsInstance => ({ id: "i1", fms_flow_id: "f1", reference_number: "FMS-1", title: "Order check", status: "active", priority: "medium", context: {}, branch_id: "b1", department_id: "d1", started_by: "u1", started_at: null, completed_at: null, parent_instance_id: null, flow_version: 1, ...patch });
const runtimeStage = (patch: Partial<FmsInstanceStage> = {}): FmsInstanceStage => ({ id: "r1", fms_instance_id: "i1", fms_stage_id: "s1", status: "in_progress", assigned_to: ["u2"], planned_datetime: "2026-01-01T01:00:00Z", actual_datetime: null, delay_minutes: 0, sla_breached: false, form_submission_id: null, remark: null, outcome: null, completed_by: null, escalation_count: 0, ...patch });
const definition = (patch: Partial<FmsStageRow> = {}): FmsStageRow => ({ id: "s1", fms_flow_id: "f1", stage_key: "start", name: "Start", method: null, step_type: "task", sort_order: 0, is_required: true, planned_time_rule: {}, completion_rule: "any_doer", allow_multiple_doers: false, requires_upload: false, requires_remark: false, checklist_definition: [], form_template_id: null, requires_next_doer_handoff: false, can_move_backward: false, can_reject: false, can_request_revision: false, can_escalate: false, default_next_stage_id: null, parallel_target_stage_ids: [], join_rule: null, join_required_stage_ids: [], split_to_flow_id: null, ...patch });
const users: FmsData["users"] = [
  { id: "u1", employee_name: "One", user_role: "staff", branch_id: "b1", department_id: "d1", working_status: "active", is_login_enabled: true },
  { id: "u2", employee_name: "Two", user_role: "doer", branch_id: "b2", department_id: "d2", working_status: "active", is_login_enabled: true },
  { id: "u3", employee_name: "Three", user_role: "doer", branch_id: "b1", department_id: "d1", working_status: "inactive", is_login_enabled: true },
  { id: "u4", employee_name: "Four", user_role: "doer", branch_id: "b1", department_id: "d1", working_status: "active", is_login_enabled: false },
];

describe("FMS runtime view rules", () => {
  it("limits eligible assignees to active login-enabled instance scope", () => expect(eligibleFmsUsers(users, instance()).map((item) => item.id)).toEqual(["u1"]));
  it("supports tenant-wide eligible assignees", () => expect(eligibleFmsUsers(users, instance({ branch_id: null, department_id: null })).map((item) => item.id)).toEqual(["u1", "u2"]));
  it("shows assigned instances in My Stages", () => expect(filterFmsInstances({ instances: [instance()], stages: [runtimeStage()], profileId: "u2", tab: "mine", query: "", status: "all", priority: "all", overdueOnly: false, now: "2026-01-01T00:00:00Z" })).toHaveLength(1));
  it("hides unassigned instances from My Stages", () => expect(filterFmsInstances({ instances: [instance()], stages: [runtimeStage()], profileId: "u3", tab: "mine", query: "", status: "all", priority: "all", overdueOnly: false })).toHaveLength(0));
  it("shows only instances started by the viewer", () => expect(filterFmsInstances({ instances: [instance(), instance({ id: "i2", started_by: "u2" })], stages: [], profileId: "u1", tab: "started", query: "", status: "all", priority: "all", overdueOnly: false })).toHaveLength(1));
  it("combines normalized search, status, and priority filters", () => expect(filterFmsInstances({ instances: [instance({ status: "overdue", priority: "high" })], stages: [], profileId: "u1", tab: "branch", query: " order ", status: "overdue", priority: "high", overdueOnly: false })).toHaveLength(1));
  it("uses due timestamps for overdue filtering", () => expect(filterFmsInstances({ instances: [instance()], stages: [runtimeStage()], profileId: "u1", tab: "branch", query: "", status: "all", priority: "all", overdueOnly: true, now: "2026-01-01T02:00:00Z" })).toHaveLength(1));
  it("offers only earlier activated definitions as revision targets", () => { const current = definition({ id: "s3", sort_order: 2 }); const rows = [definition(), definition({ id: "s2", sort_order: 1 }), current, definition({ id: "other", fms_flow_id: "f2", sort_order: 0 })]; expect(priorFmsDefinitions(rows, [runtimeStage(), runtimeStage({ id: "r2", fms_stage_id: "s2" })], "f1", current).map((item) => item.id)).toEqual(["s1", "s2"]); });
  it("accepts an object context", () => expect(parseFmsContext('{"source":"manual"}')).toEqual({ source: "manual" }));
  it.each(["[]", "null", '"value"'])("rejects non-object context %s", (value) => expect(() => parseFmsContext(value)).toThrow("JSON object"));
  it("rejects more than 50 context keys", () => expect(() => parseFmsContext(JSON.stringify(Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`key_${index}`, index]))))).toThrow("50 keys"));
  it("exposes FMS builder only to authoring roles", () => { expect(getMenuForRole("admin").some((item) => item.id === "fms_builder")).toBe(true); expect(getMenuForRole("staff").some((item) => item.id === "fms_builder")).toBe(false); });
  it("keeps FMS tasks available to runtime roles and hidden from unrelated roles", () => { expect(getMenuForRole("doer").some((item) => item.id === "fms_tasks")).toBe(true); expect(getMenuForRole("housekeeping").some((item) => item.id === "fms_tasks")).toBe(false); });
});
