import { toISO, addDays, TODAY, TODAY_ISO } from "../lib/utils.js";
import { USERS, DEPARTMENTS } from "./org.js";

/* ---------------------------------------------------------------------------
   FMS - Flow Management System.
   A flow is a template. An instance is one live run of it. Step types:
   task | approval | form | notification | branch | parallel_start |
   parallel_join | end
   --------------------------------------------------------------------------- */

export const FMS_FLOWS = [
  {
    id: "f1", name: "Custom order \u2192 delivery", category: "sales", trigger_type: "manual",
    description: "From design brief to customer handover, with workshop and QC gates.",
    is_active: true, version: 3, usage_count: 47,
    steps: [
      { id: "s1", order: 1, type: "form", name: "Capture design brief", assignee_rule: { type: "reporter", label: "Whoever starts it" }, sla_minutes: 60, form_id: "fm1", next_step_id: "s2" },
      { id: "s2", order: 2, type: "approval", name: "Manager approves quote", assignee_rule: { type: "department_head", label: "Sales head" }, sla_minutes: 240, next_step_id: "s3" },
      { id: "s3", order: 3, type: "branch", name: "Route by order value", assignee_rule: { type: "system", label: "Automatic" }, sla_minutes: 0, condition_field: "budget", branches: [{ operator: ">", value: 500000, label: "Above \u20b95L \u2192 Director sign-off", next: "s4" }, { operator: "<=", value: 500000, label: "Standard route", next: "s5" }] },
      { id: "s4", order: 4, type: "approval", name: "Director sign-off", assignee_rule: { type: "role", label: "Director" }, sla_minutes: 480, next_step_id: "s5" },
      { id: "s5", order: 5, type: "task", name: "Workshop production", assignee_rule: { type: "specific_user", label: "Imran Qureshi" }, sla_minutes: 10080, next_step_id: "s6" },
      { id: "s6", order: 6, type: "task", name: "Hallmark & QC check", assignee_rule: { type: "department_head", label: "Inventory head" }, sla_minutes: 720, next_step_id: "s7" },
      { id: "s7", order: 7, type: "notification", name: "Tell the customer it's ready", assignee_rule: { type: "previous_step_doer", label: "Previous handler" }, sla_minutes: 60, next_step_id: "s8" },
      { id: "s8", order: 8, type: "end", name: "Handover complete", assignee_rule: { type: "system", label: "Automatic" }, sla_minutes: 0, next_step_id: null },
    ],
  },
  {
    id: "f2", name: "Repair intake", category: "service", trigger_type: "manual",
    description: "Log a repair, estimate it, get customer approval, return the piece.",
    is_active: true, version: 2, usage_count: 128,
    steps: [
      { id: "s1", order: 1, type: "form", name: "Log the piece in", assignee_rule: { type: "reporter", label: "Whoever starts it" }, sla_minutes: 30, form_id: "fm2", next_step_id: "s2" },
      { id: "s2", order: 2, type: "task", name: "Workshop estimate", assignee_rule: { type: "specific_user", label: "Imran Qureshi" }, sla_minutes: 1440, next_step_id: "s3" },
      { id: "s3", order: 3, type: "approval", name: "Customer approves cost", assignee_rule: { type: "previous_step_doer", label: "Previous handler" }, sla_minutes: 2880, next_step_id: "s4" },
      { id: "s4", order: 4, type: "task", name: "Carry out repair", assignee_rule: { type: "specific_user", label: "Imran Qureshi" }, sla_minutes: 4320, next_step_id: "s5" },
      { id: "s5", order: 5, type: "notification", name: "Ready for collection", assignee_rule: { type: "department_head", label: "Customer head" }, sla_minutes: 60, next_step_id: "s6" },
      { id: "s6", order: 6, type: "end", name: "Closed", assignee_rule: { type: "system", label: "Automatic" }, sla_minutes: 0, next_step_id: null },
    ],
  },
  {
    id: "f3", name: "Stock transfer between branches", category: "inventory", trigger_type: "manual",
    description: "Move stock with a paper trail on both ends.",
    is_active: true, version: 1, usage_count: 63,
    steps: [
      { id: "s1", order: 1, type: "form", name: "Raise transfer request", assignee_rule: { type: "reporter", label: "Whoever starts it" }, sla_minutes: 60, form_id: "fm3", next_step_id: "s2" },
      { id: "s2", order: 2, type: "approval", name: "Inventory head approves", assignee_rule: { type: "department_head", label: "Inventory head" }, sla_minutes: 240, next_step_id: "s3" },
      { id: "s3", order: 3, type: "parallel_start", name: "Both branches act", assignee_rule: { type: "system", label: "Automatic" }, sla_minutes: 0, next_step_id: "s4" },
      { id: "s4", order: 4, type: "task", name: "Sending branch packs & seals", assignee_rule: { type: "manager", label: "Source branch manager" }, sla_minutes: 480, next_step_id: "s5" },
      { id: "s5", order: 5, type: "task", name: "Receiving branch verifies", assignee_rule: { type: "manager", label: "Destination manager" }, sla_minutes: 480, next_step_id: "s6" },
      { id: "s6", order: 6, type: "parallel_join", name: "Both confirmed", assignee_rule: { type: "system", label: "Automatic" }, sla_minutes: 0, join_rule: "all", next_step_id: "s7" },
      { id: "s7", order: 7, type: "end", name: "Transfer closed", assignee_rule: { type: "system", label: "Automatic" }, sla_minutes: 0, next_step_id: null },
    ],
  },
  {
    id: "f4", name: "New vendor onboarding", category: "procurement", trigger_type: "manual",
    description: "KYC, terms and first purchase order for a new supplier.",
    is_active: false, version: 1, usage_count: 9,
    steps: [
      { id: "s1", order: 1, type: "form", name: "Vendor KYC", assignee_rule: { type: "reporter", label: "Whoever starts it" }, sla_minutes: 120, form_id: "fm4", next_step_id: "s2" },
      { id: "s2", order: 2, type: "task", name: "Verify GST & bank details", assignee_rule: { type: "role", label: "Admin" }, sla_minutes: 1440, next_step_id: "s3" },
      { id: "s3", order: 3, type: "approval", name: "Director approves terms", assignee_rule: { type: "role", label: "Director" }, sla_minutes: 2880, next_step_id: "s4" },
      { id: "s4", order: 4, type: "end", name: "Vendor active", assignee_rule: { type: "system", label: "Automatic" }, sla_minutes: 0, next_step_id: null },
    ],
  },
];

/* Resolves a step's assignee_rule against the live org chart. This is the one
   piece of FMS logic that transfers straight into the real backend. */
export function resolveAssignee(step, starter) {
  const r = step.assignee_rule || {};
  switch (r.type) {
    case "reporter":
    case "previous_step_doer":
      return starter.id;
    case "specific_user":
      return USERS.find((u) => r.label.includes(u.name.split(" ")[0]))?.id || null;
    case "department_head": {
      const key = r.label.toLowerCase().split(" ")[0];
      return DEPARTMENTS.find((d) => d.name.toLowerCase().includes(key))?.head_id || null;
    }
    case "role": {
      const map = { Director: "super_admin", Admin: "admin", Manager: "manager" };
      return USERS.find((u) => u.role_level === map[r.label])?.id || null;
    }
    case "manager":
      return starter.reporting_to || null;
    default:
      return null;
  }
}

export const seedFmsInstances = () => [
  {
    id: "fi1", flow_id: "f1", title: "Ananya Desai \u2014 solitaire ring + band", status: "active",
    priority: "high", reference_number: "CO-2026-0184", started_by: "u4", started_on: toISO(addDays(TODAY, -5)),
    context: { budget: 425000, customer: "Ananya Desai" }, current_step_ids: ["s5"], sla_breached: false,
    step_states: [
      { step_id: "s1", status: "completed", assigned_to: "u4", completed_on: toISO(addDays(TODAY, -5)) },
      { step_id: "s2", status: "completed", assigned_to: "u2", completed_on: toISO(addDays(TODAY, -4)) },
      { step_id: "s3", status: "completed", assigned_to: null, completed_on: toISO(addDays(TODAY, -4)), note: "Routed: standard (\u2264 \u20b95L)" },
      { step_id: "s5", status: "in_progress", assigned_to: "u5", completed_on: null },
      { step_id: "s6", status: "pending", assigned_to: "u7", completed_on: null },
      { step_id: "s7", status: "pending", assigned_to: "u4", completed_on: null },
      { step_id: "s8", status: "pending", assigned_to: null, completed_on: null },
    ],
  },
  {
    id: "fi2", flow_id: "f1", title: "Meera Iyer \u2014 full polki bridal set", status: "active",
    priority: "urgent", reference_number: "CO-2026-0191", started_by: "u3", started_on: toISO(addDays(TODAY, -2)),
    context: { budget: 1180000, customer: "Meera Iyer" }, current_step_ids: ["s4"], sla_breached: true,
    step_states: [
      { step_id: "s1", status: "completed", assigned_to: "u3", completed_on: toISO(addDays(TODAY, -2)) },
      { step_id: "s2", status: "completed", assigned_to: "u2", completed_on: toISO(addDays(TODAY, -1)) },
      { step_id: "s3", status: "completed", assigned_to: null, completed_on: toISO(addDays(TODAY, -1)), note: "Routed: above \u20b95L \u2192 Director" },
      { step_id: "s4", status: "in_progress", assigned_to: "u1", completed_on: null },
      { step_id: "s5", status: "pending", assigned_to: "u5", completed_on: null },
      { step_id: "s6", status: "pending", assigned_to: "u7", completed_on: null },
      { step_id: "s7", status: "pending", assigned_to: "u3", completed_on: null },
      { step_id: "s8", status: "pending", assigned_to: null, completed_on: null },
    ],
  },
  {
    id: "fi3", flow_id: "f2", title: "Rohan Bhatia \u2014 broken clasp, gold chain", status: "active",
    priority: "medium", reference_number: "RP-2026-0442", started_by: "u4", started_on: toISO(addDays(TODAY, -1)),
    context: { customer: "Rohan Bhatia" }, current_step_ids: ["s2"], sla_breached: false,
    step_states: [
      { step_id: "s1", status: "completed", assigned_to: "u4", completed_on: toISO(addDays(TODAY, -1)) },
      { step_id: "s2", status: "in_progress", assigned_to: "u5", completed_on: null },
      { step_id: "s3", status: "pending", assigned_to: "u4", completed_on: null },
      { step_id: "s4", status: "pending", assigned_to: "u5", completed_on: null },
      { step_id: "s5", status: "pending", assigned_to: "u6", completed_on: null },
      { step_id: "s6", status: "pending", assigned_to: null, completed_on: null },
    ],
  },
  {
    id: "fi4", flow_id: "f3", title: "Bandra \u2192 Andheri: 18 diamond studs", status: "completed",
    priority: "low", reference_number: "ST-2026-0077", started_by: "u7", started_on: toISO(addDays(TODAY, -12)),
    context: {}, current_step_ids: [], sla_breached: false,
    step_states: ["s1", "s2", "s3", "s4", "s5", "s6", "s7"].map((id, i) => ({
      step_id: id, status: "completed",
      assigned_to: ["u7", "u7", null, "u2", "u3", null, null][i],
      completed_on: toISO(addDays(TODAY, -10)),
    })),
  },
];
