import { describe, expect, it } from "vitest";
import { normalizeFmsDefinition, validateFmsDefinition } from "./engine";
import { FMS_FOLLOW_UP_OUTCOME, fmsFollowUpAttempts, fmsFollowUpGroups, insertFmsFollowUpGroup, setFmsFollowUpGroupParent, summarizeFmsFollowUps, type FmsFollowUpStageRow, type FmsFollowUpVisitRow } from "./followUpGroup";
import { simulateFmsDefinition } from "./simulation";
import { fmsStageTemplate } from "./stageTemplate";
import { exportFmsWorkflow, parseFmsTransfer, pasteFmsFragment, removeFmsStages } from "./transfer";
import type { FmsFlowDefinition, FmsStageDefinition, FmsTerminalOutcome } from "./types";

const formId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
let seq = 0;
const newId = () => `id_${++seq}`;
const step = (key: string, order: number, type: "form" | "task", patch: Partial<FmsStageDefinition> = {}): FmsStageDefinition => ({
  ...fmsStageTemplate(type, order, newId), key, name: key, order, ...(type === "form" ? { formTemplateId: formId } : {}),
  assigneeRules: [{ type: "specific_user", userProfileId: userId }], sla: { dueDate: "", deadlineEnabled: false }, ...patch,
});
const end = (key: string, order: number, outcome: FmsTerminalOutcome): FmsStageDefinition => ({
  ...fmsStageTemplate("end", order, newId), key, name: key, order, sla: { dueDate: "", deadlineEnabled: false, terminal: { outcome } },
});
/** Introduction Call -> Product Demonstration -> Store Appointment, with a Lost ending. */
function sales(withEnd = true): FmsFlowDefinition {
  return { name: "Sales", scope: "tenant", manualTrigger: true, stages: [
    step("start", 0, "form", { defaultNextStageKey: "intro" }),
    step("intro", 1, "task", { name: "Introduction Call", defaultNextStageKey: "demo" }),
    step("demo", 2, "task", { name: "Product Demonstration", defaultNextStageKey: "store" }),
    step("store", 3, "task", { name: "Store Appointment" }),
    ...(withEnd ? [end("lost", 4, "lost")] : []),
  ] };
}
const byKey = (flow: FmsFlowDefinition, key: string) => flow.stages.find((stage) => stage.key === key)!;
const target = (stage: FmsStageDefinition, outcome: string) => stage.branchRules.find((rule) => rule.value === outcome)?.nextStageKey;

describe("Add Follow-Up Group", () => {
  it("adds exactly three connected native Decision steps after the main step", () => {
    const before = normalizeFmsDefinition(sales());
    const result = insertFmsFollowUpGroup(before, { afterKey: "intro", newId });
    const [k1, k2, k3] = result.stageKeys as [string, string, string];
    expect(result.definition.stages).toHaveLength(before.stages.length + 3);
    const group = [k1, k2, k3].map((key) => byKey(result.definition, key));
    expect(group.map((stage) => [stage.name, stage.type, stage.sla.decisionMode, stage.sla.followUpGroup])).toEqual([1, 2, 3].map((number) =>
      [`Follow-Up ${number}`, "task", "yes_no", { groupId: result.groupId, number, parentStageKey: "intro" }]));
    expect(new Set(result.stageKeys).size).toBe(3);
    // Main step now leads to Follow-Up 1; "proceed" continues to its former next step.
    expect(byKey(result.definition, "intro").defaultNextStageKey).toBe(k1);
    expect(group.map((stage) => target(stage, FMS_FOLLOW_UP_OUTCOME.proceed))).toEqual(["demo", "demo", "demo"]);
    expect(group.map((stage) => target(stage, FMS_FOLLOW_UP_OUTCOME.again))).toEqual([k2, k3, k1]);
    expect(group.map((stage) => target(stage, FMS_FOLLOW_UP_OUTCOME.close))).toEqual(["lost", "lost", "lost"]);
    // Nothing else changed.
    for (const stage of before.stages.filter((item) => item.key !== "intro")) expect(byKey(result.definition, stage.key)).toEqual(stage);
    expect(validateFmsDefinition(result.definition)).toEqual([]);
  });

  it("leaves a missing close destination for the author, and validation blocks publishing until it is chosen", () => {
    const result = insertFmsFollowUpGroup(sales(false), { afterKey: "intro", newId });
    expect(result.closeStageKey).toBeUndefined();
    const issues = validateFmsDefinition(result.definition);
    expect(issues.filter((issue) => issue.code === "route_without_destination").map((issue) => issue.stageKey)).toEqual(result.stageKeys);
    expect(fmsFollowUpGroups(result.definition.stages)[0]!.problems.some((problem) => problem.includes("Not interested, close"))).toBe(true);
  });

  it("never rewires a main step that already routes; the group is added unconnected and reported", () => {
    const flow = normalizeFmsDefinition(sales());
    const routed = { ...flow, stages: flow.stages.map((stage) => stage.key === "intro" ? { ...stage, defaultNextStageKey: undefined, sla: { ...stage.sla, decisionMode: "yes_no" as const, decisionOptions: [{ key: "yes", label: "Yes" }] }, branchRules: [{ id: "r1", source: "outcome" as const, operator: "equals" as const, value: "yes", nextStageKey: "demo", order: 0 }] } : stage) };
    const result = insertFmsFollowUpGroup(routed, { afterKey: "intro", newId });
    expect(result.linkedFromParent).toBe(false);
    expect(byKey(result.definition, "intro")).toEqual(byKey(normalizeFmsDefinition(routed), "intro"));
    expect(validateFmsDefinition(result.definition).some((issue) => issue.code === "unreachable_stage" && issue.stageKey === result.stageKeys[0])).toBe(true);
    expect(validateFmsDefinition(result.definition).some((issue) => issue.code === "route_without_destination" && issue.message.includes("Interested, proceed"))).toBe(true);
  });

  it("keeps two groups in one workflow separate", () => {
    const first = insertFmsFollowUpGroup(sales(), { afterKey: "intro", newId });
    const second = insertFmsFollowUpGroup(first.definition, { afterKey: "demo", newId });
    expect(second.groupId).not.toBe(first.groupId);
    const groups = fmsFollowUpGroups(second.definition.stages);
    expect(groups.map((group) => [group.groupId, group.parentStageKey, group.members.map((stage) => stage.key), group.proceedStageKeys, group.loopsBack, group.problems])).toEqual([
      [first.groupId, "intro", first.stageKeys, ["demo"], true, []],
      [second.groupId, "demo", second.stageKeys, ["store"], true, []],
    ]);
    expect(validateFmsDefinition(second.definition)).toEqual([]);
  });

  it("survives a save and reload as stored JSON, and never groups a step only because of its name", () => {
    const result = insertFmsFollowUpGroup(sales(), { afterKey: "intro", newId });
    const reloaded = normalizeFmsDefinition(JSON.parse(JSON.stringify(result.definition)) as FmsFlowDefinition);
    expect(reloaded).toEqual(normalizeFmsDefinition(result.definition));
    const legacy = normalizeFmsDefinition({ ...sales(), stages: [...sales().stages.map((stage) => stage.key === "demo" ? { ...stage, name: "Follow-Up 1" } : stage)] });
    expect(fmsFollowUpGroups(legacy.stages)).toEqual([]);
    expect(normalizeFmsDefinition({ ...sales(), stages: [step("start", 0, "form", { sla: { dueDate: "", followUpGroup: { groupId: "bad id!", number: 4 as never } } })] }).stages[0]!.sla.followUpGroup).toBeUndefined();
  });

  it("an undo snapshot taken before the insert is untouched by it", () => {
    const before = normalizeFmsDefinition(sales());
    const snapshot = JSON.stringify(before);
    insertFmsFollowUpGroup(before, { afterKey: "intro", newId });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("export/import keeps the group; a paste becomes a new group and drops a parent that was not copied", () => {
    const result = insertFmsFollowUpGroup(sales(), { afterKey: "intro", newId });
    const imported = parseFmsTransfer(JSON.stringify(exportFmsWorkflow(result.definition, new Map())));
    expect(imported.stages.filter((stage) => stage.sla.followUpGroup).map((stage) => stage.sla.followUpGroup)).toEqual(result.stageKeys.map((key) => byKey(result.definition, key).sla.followUpGroup));
    const copied = result.definition.stages.filter((stage) => result.stageKeys.includes(stage.key));
    const pasted = pasteFmsFragment(result.definition, copied, { anchor: { x: 0, y: 0 }, newId });
    const tags = pasted.pastedKeys.map((key) => byKey(pasted.definition, key).sla.followUpGroup!);
    expect(new Set(tags.map((tag) => tag.groupId)).size).toBe(1);
    expect(tags[0]!.groupId).not.toBe(result.groupId);
    expect(tags.every((tag) => tag.parentStageKey === undefined)).toBe(true);
    expect(fmsFollowUpGroups(pasted.definition.stages)).toHaveLength(2);
  });

  it("deleting the main step clears the saved parent; the parent can be set again for the whole group", () => {
    const result = insertFmsFollowUpGroup(sales(), { afterKey: "intro", newId });
    const without = removeFmsStages(result.definition.stages, ["intro"]);
    expect(without.filter((stage) => stage.sla.followUpGroup).every((stage) => stage.sla.followUpGroup!.parentStageKey === undefined)).toBe(true);
    const reset = setFmsFollowUpGroupParent(without, result.groupId, "start");
    expect(reset.filter((stage) => stage.sla.followUpGroup).map((stage) => stage.sla.followUpGroup!.parentStageKey)).toEqual(["start", "start", "start"]);
  });
});

describe("Follow-Up Group loop in simulation", () => {
  it("returns from Follow-Up 3 to Follow-Up 1 and proceeds on a positive outcome", () => {
    const result = insertFmsFollowUpGroup(sales(), { afterKey: "intro", newId });
    const [k1, k2, k3] = result.stageKeys as [string, string, string];
    const run = simulateFmsDefinition(result.definition, { answers: {}, starterId: userId, outcomes: {
      [k1]: [FMS_FOLLOW_UP_OUTCOME.again, FMS_FOLLOW_UP_OUTCOME.proceed], [k2]: [FMS_FOLLOW_UP_OUTCOME.again], [k3]: [FMS_FOLLOW_UP_OUTCOME.again],
    } });
    expect(run.events.map((event) => [event.stageKey, event.visit])).toEqual([["start", 1], ["intro", 1], [k1, 1], [k2, 1], [k3, 1], [k1, 2], ["demo", 1], ["store", 1]]);
  });

  it("closes on rejection and creates no further follow-up", () => {
    const result = insertFmsFollowUpGroup(sales(), { afterKey: "intro", newId });
    const [k1, k2] = result.stageKeys as [string, string, string];
    const run = simulateFmsDefinition(result.definition, { answers: {}, starterId: userId, outcomes: { [k1]: [FMS_FOLLOW_UP_OUTCOME.again], [k2]: [FMS_FOLLOW_UP_OUTCOME.close] } });
    expect(run.events.map((event) => event.stageKey)).toEqual(["start", "intro", k1, k2, "lost"]);
    expect(run.terminal?.outcome).toBe("lost");
  });
});

describe("Follow-Up analytics from recorded visits", () => {
  const stageRows: FmsFollowUpStageRow[] = [
    { id: "s_intro", fms_flow_id: "flow_v1", stage_key: "intro", name: "Introduction Call", planned_time_rule: {} },
    { id: "s_demo", fms_flow_id: "flow_v1", stage_key: "demo", name: "Product Demonstration", planned_time_rule: {} },
    ...[1, 2, 3].map((number) => ({ id: `a${number}`, fms_flow_id: "flow_v1", stage_key: `a${number}`, name: `Follow-Up ${number}`, planned_time_rule: { followUpGroup: { groupId: "g_intro", number, parentStageKey: "intro" } } })),
    ...[1, 2, 3].map((number) => ({ id: `b${number}`, fms_flow_id: "flow_v1", stage_key: `b${number}`, name: `Follow-Up ${number}`, planned_time_rule: { followUpGroup: { groupId: "g_demo", number, parentStageKey: "demo" } } })),
    // An untagged step that is only named like a follow-up is never counted.
    { id: "legacy", fms_flow_id: "flow_v1", stage_key: "legacy", name: "Follow-Up 1", planned_time_rule: {} },
  ];
  let minute = 0;
  const visit = (id: string, instance: string, stage: string, outcome: string | null, patch: Partial<FmsFollowUpVisitRow> = {}): FmsFollowUpVisitRow =>
    ({ id, fms_instance_id: instance, fms_stage_id: stage, status: outcome ? "completed" : "pending", outcome, activated_at: `2026-11-01T10:${String(++minute).padStart(2, "0")}:00Z`, completed_by: outcome ? "emp_1" : null, ...patch });
  const visits: FmsFollowUpVisitRow[] = [
    visit("v1", "run_1", "a1", "follow_up_again"), visit("v2", "run_1", "a2", "follow_up_again", { previous_instance_stage_id: "v1", completed_by: "emp_2" }),
    visit("v3", "run_1", "a3", "follow_up_again", { previous_instance_stage_id: "v2" }), visit("v4", "run_1", "a1", "follow_up_again", { previous_instance_stage_id: "v3", visit_number: 2 }),
    visit("v5", "run_1", "a2", "proceed", { previous_instance_stage_id: "v4", visit_number: 2 }), visit("v6", "run_1", "s_demo", null, { previous_instance_stage_id: "v5" }),
    visit("v7", "run_1", "b1", "proceed"),
    visit("w1", "run_2", "a1", "not_interested"),
    visit("x1", "run_3", "a1", null, { status: "overdue", planned_datetime: "2026-11-01T09:00:00Z" }),
    visit("l1", "run_3", "legacy", "follow_up_again"),
  ];

  it("numbers follow-up number, round and total attempt per run and group", () => {
    const rows = fmsFollowUpAttempts(visits, stageRows).filter((row) => row.instanceId === "run_1" && row.groupId === "g_intro");
    expect(rows.map((row) => [row.parentStageName, `Follow-Up ${row.followUpNumber}`, row.round, row.attempt, row.employeeId, row.exit])).toEqual([
      ["Introduction Call", "Follow-Up 1", 1, 1, "emp_1", "follow_up"],
      ["Introduction Call", "Follow-Up 2", 1, 2, "emp_2", "follow_up"],
      ["Introduction Call", "Follow-Up 3", 1, 3, "emp_1", "follow_up"],
      ["Introduction Call", "Follow-Up 1", 2, 4, "emp_1", "follow_up"],
      ["Introduction Call", "Follow-Up 2", 2, 5, "emp_1", "proceed"],
    ]);
    expect(rows.at(-1)!.nextStageKey).toBe("demo");
    expect(fmsFollowUpAttempts(visits, stageRows).some((row) => row.instanceStageId === "l1")).toBe(false);
  });

  it("summarises each group separately", () => {
    const stats = summarizeFmsFollowUps(fmsFollowUpAttempts(visits, stageRows), new Date("2026-11-02T00:00:00Z"));
    const intro = stats.find((item) => item.groupId === "g_intro")!;
    expect(intro).toMatchObject({ parentStageKey: "intro", runs: 3, completedAttempts: 6, openAttempts: 1, overdueAttempts: 1, proceeded: 1, closed: 1, stillFollowingUp: 1,
      averageAttemptsToProceed: 5, averageRoundsToProceed: 2, proceededAt: { followUp1: 0, followUp2: 0, followUp3: 0, laterRounds: 1 }, completedByEmployee: { emp_1: 5, emp_2: 1 } });
    const demo = stats.find((item) => item.groupId === "g_demo")!;
    expect(demo).toMatchObject({ parentStageName: "Product Demonstration", runs: 1, proceeded: 1, averageAttemptsToProceed: 1, proceededAt: { followUp1: 1, followUp2: 0, followUp3: 0, laterRounds: 0 } });
  });
});
