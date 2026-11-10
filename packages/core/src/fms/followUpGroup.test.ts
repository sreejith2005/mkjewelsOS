import { describe, expect, it } from "vitest";
import { normalizeFmsDefinition, validateFmsDefinition } from "./engine";
import { fmsFollowUpAttempts, fmsFollowUpGroups, insertFmsFollowUpGroup, setFmsFollowUpGroupParent, summarizeFmsFollowUps, type FmsFollowUpStageRow, type FmsFollowUpVisitRow } from "./followUpGroup";
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
  it("adds three plain steps, exactly like Add Step, chained between the main step and its next step", () => {
    const before = normalizeFmsDefinition(sales(false));
    const result = insertFmsFollowUpGroup(before, { afterKey: "intro", newId });
    const [k1, k2, k3] = result.stageKeys as [string, string, string];
    expect(result.definition.stages).toHaveLength(before.stages.length + 3);
    const group = [k1, k2, k3].map((key) => byKey(result.definition, key));
    expect(group.map((stage) => [stage.name, stage.type, stage.sla.decisionMode, stage.sla.decisionOptions, stage.branchRules, stage.sla.followUpGroup])).toEqual([1, 2, 3].map((number) =>
      [`Follow-Up ${number}`, "task", "normal", undefined, [], { groupId: result.groupId, number, parentStageKey: "intro" }]));
    expect(new Set(result.stageKeys).size).toBe(3);
    expect(byKey(result.definition, "intro").defaultNextStageKey).toBe(k1);
    expect(group.map((stage) => stage.defaultNextStageKey)).toEqual([k2, k3, "demo"]);
    // Nothing else changed.
    for (const stage of before.stages.filter((item) => item.key !== "intro")) expect(byKey(result.definition, stage.key)).toEqual(stage);
    expect(validateFmsDefinition(result.definition)).toEqual([]);
  });

  it("never rewires a main step that already routes; the group is added unconnected and reported", () => {
    const flow = normalizeFmsDefinition(sales());
    const routed = { ...flow, stages: flow.stages.map((stage) => stage.key === "intro" ? { ...stage, defaultNextStageKey: undefined, sla: { ...stage.sla, decisionMode: "yes_no" as const, decisionOptions: [{ key: "yes", label: "Yes" }] }, branchRules: [{ id: "r1", source: "outcome" as const, operator: "equals" as const, value: "yes", nextStageKey: "demo", order: 0 }] } : stage) };
    const result = insertFmsFollowUpGroup(routed, { afterKey: "intro", newId });
    expect(result.linkedFromParent).toBe(false);
    expect(byKey(result.definition, "intro")).toEqual(byKey(normalizeFmsDefinition(routed), "intro"));
    expect(byKey(result.definition, result.stageKeys[2]!).defaultNextStageKey).toBeUndefined();
    expect(validateFmsDefinition(result.definition).some((issue) => issue.code === "unreachable_stage" && issue.stageKey === result.stageKeys[0])).toBe(true);
  });

  it("keeps two groups in one workflow separate", () => {
    const first = insertFmsFollowUpGroup(sales(false), { afterKey: "intro", newId });
    const second = insertFmsFollowUpGroup(first.definition, { afterKey: "demo", newId });
    expect(second.groupId).not.toBe(first.groupId);
    const groups = fmsFollowUpGroups(second.definition.stages);
    expect(groups.map((group) => [group.groupId, group.parentStageKey, group.members.map((stage) => stage.key), group.proceedStageKeys, group.loopsBack, group.problems])).toEqual([
      [first.groupId, "intro", first.stageKeys, ["demo"], false, []],
      [second.groupId, "demo", second.stageKeys, ["store"], false, []],
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

/** The author routes the follow-ups like any step: here on a "Result" question each follow-up asks. */
function routedGroup() {
  const result = insertFmsFollowUpGroup(sales(), { afterKey: "intro", newId });
  const [k1, k2, k3] = result.stageKeys as [string, string, string];
  const rule = (value: string, nextStageKey: string, order: number) => ({ id: newId(), source: "form_answer" as const, sourceKey: "result", operator: "equals" as const, value, nextStageKey, order });
  const definition: FmsFlowDefinition = { ...result.definition, stages: result.definition.stages.map((stage) => [k1, k2, k3].includes(stage.key) ? {
    ...stage, formTemplateId: formId, assigneeRules: [{ type: "specific_user" as const, userProfileId: userId }], sla: { ...stage.sla, assignment: { mode: "fixed_employee" as const, sources: [], allowHandoff: false } }, branchRules: [rule("interested", "demo", 0), rule("not_interested", "lost", 1)],
    // No answer: the plain next step; the author points Follow-Up 3 back to Follow-Up 1.
    defaultNextStageKey: stage.key === k1 ? k2 : stage.key === k2 ? k3 : k1,
  } : stage) };
  return { definition, keys: [k1, k2, k3] as const };
}
const resultField = { formFields: { [formId]: [{ key: "result", label: "Result", type: "dropdown", options: ["interested", "no_answer", "not_interested"].map((value) => ({ value, label: value })), optionValues: ["interested", "no_answer", "not_interested"] }] } };

describe("Follow-Up Group loop the author configured", () => {
  it("validates, reports the loop, and returns from Follow-Up 3 to Follow-Up 1 until the customer proceeds", () => {
    const { definition, keys: [k1, k2, k3] } = routedGroup();
    expect(validateFmsDefinition(definition, resultField)).toEqual([]);
    const view = fmsFollowUpGroups(normalizeFmsDefinition(definition).stages)[0]!;
    expect([view.loopsBack, view.proceedStageKeys, view.closeStageKeys]).toEqual([true, ["demo"], ["lost"]]);
    const noAnswer = { result: "no_answer" };
    const run = simulateFmsDefinition(definition, { answers: { [k1]: [noAnswer, { result: "interested" }], [k2]: [noAnswer], [k3]: [noAnswer] }, starterId: userId });
    expect(run.events.map((event) => [event.stageKey, event.visit])).toEqual([["start", 1], ["intro", 1], [k1, 1], [k2, 1], [k3, 1], [k1, 2], ["demo", 1], ["store", 1]]);
  });

  it("closes on rejection and creates no further follow-up", () => {
    const { definition, keys: [k1, k2] } = routedGroup();
    const run = simulateFmsDefinition(definition, { answers: { [k1]: [{ result: "no_answer" }], [k2]: [{ result: "not_interested" }] }, starterId: userId });
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

  it("reads exits from where each run went next when the follow-ups have no preset outcome", () => {
    const rows: FmsFollowUpStageRow[] = [
      { id: "demo", fms_flow_id: "v2", stage_key: "demo", name: "Product Demonstration", planned_time_rule: {} },
      { id: "end_lost", fms_flow_id: "v2", stage_key: "lost", name: "Lost", planned_time_rule: { terminal: { outcome: "lost" } }, step_type: "end" },
      ...[1, 2, 3].map((number) => ({ id: `f${number}`, fms_flow_id: "v2", stage_key: `f${number}`, name: `Follow-Up ${number}`, planned_time_rule: { followUpGroup: { groupId: "g", number, parentStageKey: "intro" } } })),
    ];
    const plain = (id: string, instance: string, stage: string, previous?: string): FmsFollowUpVisitRow => ({ id, fms_instance_id: instance, fms_stage_id: stage, status: "completed", activated_at: `2026-11-03T10:${String(++minute).padStart(2, "0")}:00Z`, completed_by: "emp_9", previous_instance_stage_id: previous ?? null });
    const runs = [
      plain("p1", "r1", "f1"), plain("p2", "r1", "f2", "p1"), plain("p3", "r1", "f3", "p2"), plain("p4", "r1", "f1", "p3"), plain("p5", "r1", "demo", "p4"),
      plain("q1", "r2", "f1"), plain("q2", "r2", "end_lost", "q1"),
      plain("z1", "r3", "f1"),
    ];
    const attempts = fmsFollowUpAttempts(runs, rows, { r3: "do_not_contact" });
    expect(attempts.map((row) => [row.instanceId, row.followUpNumber, row.round, row.attempt, row.exit])).toEqual([
      ["r1", 1, 1, 1, "follow_up"], ["r1", 2, 1, 2, "follow_up"], ["r1", 3, 1, 3, "follow_up"], ["r1", 1, 2, 4, "proceed"],
      ["r2", 1, 1, 1, "close"],
      ["r3", 1, 1, 1, "close"],
    ]);
    expect(summarizeFmsFollowUps(attempts)[0]).toMatchObject({ proceeded: 1, closed: 2, averageAttemptsToProceed: 4, proceededAt: { followUp1: 0, followUp2: 0, followUp3: 0, laterRounds: 1 } });
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
