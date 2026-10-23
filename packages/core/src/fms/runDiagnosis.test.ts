import { describe, expect, it } from "vitest";
import { diffFmsDefinitions, fmsDefinitionFingerprint, fmsDiffIsEmpty } from "./definitionDiff";
import { analyseFmsRun, parseFmsRunSnapshot } from "./runDiagnosis";
import { fmsStageTemplate } from "./stageTemplate";
import type { FmsFlowDefinition } from "./types";
import { INACTIVE, NEHA, sequentialIds } from "./aiFixtures.test-helpers";

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  schema: 1, generated_at: "2026-10-23T06:00:00Z",
  instance: { id: "i1", reference_number: "FMS-1", status: "active", flow_id: "f1", flow_version: 3, assignment_version: 2, execution_version: 2, held: false, cancelled: false },
  flow: { id: "f1", name: "Stock", version: 3, status: "published" },
  stages: [], assignment_decisions: [], logs: [], pending_requests: [], diagnostic_events: [], route_answers: [],
  people: [{ id: NEHA, name: "Neha", role: "staff", active: true, login_enabled: true, availability_today: "present" }, { id: INACTIVE, name: "Old Staff", role: "staff", active: false, login_enabled: false, availability_today: null }],
  truncated: [], redacted: ["remarks"], absent: [], diagnostic_history_since: "2026-10-23", ...overrides,
});
const stage = (overrides: Record<string, unknown>) => ({ instance_stage_id: "s1", stage_key: "check", stage_name: "Check", step_type: "task", status: "pending", visit_number: 1, assigned_to: [NEHA], next_doer_ids: [], planned_at: null, has_form_submission: false, sla_breached: false, ...overrides });
const now = new Date("2026-10-23T07:00:00Z");

describe("parseFmsRunSnapshot", () => {
  it("rejects anything that is not the snapshot contract", () => {
    expect(parseFmsRunSnapshot(null)).toBeNull();
    expect(parseFmsRunSnapshot({ ...snapshot(), schema: 2 })).toBeNull();
    expect(parseFmsRunSnapshot({ ...snapshot(), instance: "x" })).toBeNull();
  });
  it("bounds lists and keeps unknown fields out", () => {
    const parsed = parseFmsRunSnapshot(snapshot({ stages: Array.from({ length: 250 }, () => stage({})), secret: "x" }));
    expect(parsed?.stages).toHaveLength(200);
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });
});

describe("analyseFmsRun", () => {
  const run = (overrides: Record<string, unknown>) => analyseFmsRun(parseFmsRunSnapshot(snapshot(overrides))!, now);
  it("names who holds an open step and where it appears", () => {
    expect(run({ stages: [stage({})] }).find((item) => item.title.includes("is with Neha"))).toMatchObject({ basis: "observed", stageKey: "check" });
  });
  it("observes an inactive assignee and an empty assignee list", () => {
    expect(run({ stages: [stage({ assigned_to: [INACTIVE] })] }).some((item) => item.severity === "error" && item.title.includes("Old Staff cannot act"))).toBe(true);
    expect(run({ stages: [stage({ assigned_to: [] })] }).some((item) => item.title === "Check has nobody assigned")).toBe(true);
  });
  it("marks an assignee outside the caller's directory as indeterminate, not inactive", () => {
    expect(run({ stages: [stage({ assigned_to: ["77777777-7777-4777-8777-777777777777"] })] }).find((item) => item.stageKey === "check" && item.basis === "indeterminate")).toBeTruthy();
  });
  it("reports recorded failed attempts and unfinished idempotent requests", () => {
    const observations = run({ stages: [stage({})], pending_requests: [{ linked_record_id: "s1", created_at: "2026-10-23T05:00:00Z" }], diagnostic_events: [{ operation: "fms_stage_transition", sqlstate: "42501", stage_key: "check", created_at: "2026-10-23T05:00:01Z" }] });
    expect(observations.find((item) => item.title.startsWith("A submission was started"))?.stageKey).toBe("check");
    expect(observations.find((item) => item.title === "A fms stage transition attempt failed")?.evidence[0]).toContain("42501");
  });
  it("says there is not enough evidence instead of inventing a cause", () => {
    const observations = run({ stages: [stage({ status: "completed" })] });
    const gap = observations.find((item) => item.title === "The run is active but no step is open");
    expect(gap?.basis).toBe("indeterminate");
    expect(gap?.evidence.join(" ")).toContain("Not enough execution evidence to determine");
    expect(observations.some((item) => item.title === "No recorded failed attempts" && item.basis === "indeterminate")).toBe(true);
  });
  it("observes holds, overdue steps, and replaced selections", () => {
    const observations = run({ instance: { ...snapshot().instance, status: "on_hold", held: true }, stages: [stage({ planned_at: "2026-10-22T00:00:00Z" })], assignment_decisions: [{ target_stage_key: "check", visit_number: 1, method: "previous_form", selected_user_ids: [INACTIVE], effective_user_ids: [NEHA] }] });
    expect(observations.map((item) => item.title)).toEqual(expect.arrayContaining(["This run is on hold", "Check is past its deadline", "The selected employee for check was replaced"]));
  });
});

describe("definition diff and fingerprint", () => {
  const base: FmsFlowDefinition = { assignmentVersion: 2, name: "Flow", scope: "tenant", manualTrigger: true, stages: [{ ...fmsStageTemplate("form", 0, sequentialIds()), key: "start", defaultNextStageKey: "work" }, { ...fmsStageTemplate("task", 1, sequentialIds()), key: "work" }] };
  it("is independent of key order and changes with content", () => {
    const reverseKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;
    const reordered = reverseKeys(base) as FmsFlowDefinition;
    expect(Object.keys(reordered)[0]).not.toBe(Object.keys(base)[0]);
    expect(fmsDefinitionFingerprint(reordered)).toBe(fmsDefinitionFingerprint(base));
    expect(fmsDefinitionFingerprint({ ...base, name: "Other" })).not.toBe(fmsDefinitionFingerprint(base));
    expect(fmsDefinitionFingerprint(base)).toMatch(/^fms1-[0-9a-f]{16}$/);
  });
  it("lists added, removed and changed steps by key", () => {
    const after: FmsFlowDefinition = { ...base, stages: [{ ...base.stages[0]!, name: "Request" }, { ...fmsStageTemplate("approval", 1, sequentialIds()), key: "approve" }] };
    const diff = diffFmsDefinitions(base, after);
    expect(diff.added.map((stage) => stage.key)).toEqual(["approve"]);
    expect(diff.removed.map((stage) => stage.key)).toEqual(["work"]);
    expect(diff.changed[0]?.changes.map((change) => change.field)).toEqual(["name"]);
    expect(fmsDiffIsEmpty(diffFmsDefinitions(base, base))).toBe(true);
  });
});
