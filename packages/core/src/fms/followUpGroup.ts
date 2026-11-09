import { suggestFmsAssignment } from "./assignmentAuthoring.ts";
import { fmsOutgoingStageKeys, hasFmsStageRouting, normalizeFmsDefinition, normalizeFmsFollowUpGroupTag } from "./engine.ts";
import { fmsStageTemplate } from "./stageTemplate.ts";
import { fmsStageKeyFactory } from "./transfer.ts";
import type { FmsAssigneeRule, FmsBranchRule, FmsDecisionOption, FmsFlowDefinition, FmsFollowUpGroupTag, FmsFormFieldRef, FmsStageDefinition } from "./types.ts";

/**
 * Follow-Up Groups: a builder shortcut that adds three ordinary Decision steps
 * (Follow-Up 1, 2, 3) after a main step. Nothing here is a new runtime concept:
 * each step is a native `task` stage, its outcome routes with the existing
 * stage routing, Follow-Up 3 routes back to Follow-Up 1 with the existing loop
 * engine (a new visit row per return, never an overwrite), and the only extra
 * data is `sla.followUpGroup`, which identifies the group for reporting.
 */
export const FMS_FOLLOW_UP_GROUP_SIZE = 3;
/** Stable outcome keys of a follow-up step. Labels may be renamed; reports read these keys. */
export const FMS_FOLLOW_UP_OUTCOME = { proceed: "proceed", again: "follow_up_again", close: "not_interested" } as const;
export const FMS_FOLLOW_UP_DECISION_OPTIONS: readonly FmsDecisionOption[] = [
  { key: FMS_FOLLOW_UP_OUTCOME.proceed, label: "Interested, proceed" },
  { key: FMS_FOLLOW_UP_OUTCOME.again, label: "No answer, follow up again" },
  { key: FMS_FOLLOW_UP_OUTCOME.close, label: "Not interested, close" },
];
/** Steps a follow-up group cannot follow: they never hand work to a single next step. */
const NOT_A_PARENT = new Set(["branch", "parallel_start", "end"]);

export type FmsFollowUpGroupInsertOptions = Readonly<{
  /** The main step the group follows up. Without it the group is added unconnected. */
  afterKey?: string | undefined;
  newId: () => string;
  /** Linked form questions, for the same assignment suggestion Add Step makes. */
  formFields?: Readonly<Record<string, readonly FmsFormFieldRef[]>> | undefined;
  /** The workflow context's default person, exactly as Add Step applies it. */
  assigneeRules?: readonly FmsAssigneeRule[] | undefined;
}>;
export type FmsFollowUpGroupInsert = Readonly<{
  definition: FmsFlowDefinition;
  groupId: string;
  stageKeys: readonly string[];
  parentStageKey?: string | undefined;
  /** True when the main step's single next step was moved behind the group. */
  linkedFromParent: boolean;
  proceedStageKey?: string | undefined;
  closeStageKey?: string | undefined;
}>;

/**
 * Adds one Follow-Up Group as three new steps. Existing steps are never
 * changed except one: a main step with a plain single next step now leads to
 * Follow-Up 1, and "Interested, proceed" leads to that former next step. A main
 * step that already routes (Decision routes, branch, parallel) keeps every
 * route; the group is added unconnected and validation asks for the link.
 * "Not interested, close" uses an existing Do not contact or Lost End Node, or
 * is left for the author to choose, which validation reports until set.
 */
export function insertFmsFollowUpGroup(raw: FmsFlowDefinition, options: FmsFollowUpGroupInsertOptions): FmsFollowUpGroupInsert {
  const flow = normalizeFmsDefinition(raw);
  const stages = flow.stages;
  const candidate = options.afterKey ? stages.find((stage) => stage.key === options.afterKey) : undefined;
  const parent = candidate && !NOT_A_PARENT.has(candidate.type) ? candidate : undefined;
  const linkedFromParent = !!parent && !hasFmsStageRouting(parent);
  const proceedStageKey = linkedFromParent ? parent!.defaultNextStageKey : undefined;
  const ends = stages.filter((stage) => stage.type === "end");
  const closeStageKey = (ends.find((stage) => stage.sla.terminal?.outcome === "do_not_contact") ?? ends.find((stage) => stage.sla.terminal?.outcome === "lost"))?.key;
  const nextKey = fmsStageKeyFactory(stages.map((stage) => stage.key));
  const keys = Array.from({ length: FMS_FOLLOW_UP_GROUP_SIZE }, () => nextKey());
  const groupId = options.newId();
  const baseOrder = Math.max(-1, ...stages.map((stage) => stage.order)) + 1;
  const [proceedLabel, againLabel, closeLabel] = FMS_FOLLOW_UP_DECISION_OPTIONS.map((option) => option.label) as [string, string, string];
  const route = (value: string, nextStageKey: string | undefined, label: string, order: number): FmsBranchRule =>
    ({ id: options.newId(), source: "outcome", operator: "equals", value, ...(nextStageKey ? { nextStageKey } : {}), order, label });
  let previous: FmsStageDefinition | undefined = parent ?? stages.at(-1);
  const group = keys.map((key, index): FmsStageDefinition => {
    const number = (index + 1) as FmsFollowUpGroupTag["number"];
    const template = fmsStageTemplate("task", baseOrder + index, options.newId);
    const followUpGroup: FmsFollowUpGroupTag = { groupId, number, ...(parent ? { parentStageKey: parent.key } : {}) };
    const stage: FmsStageDefinition = {
      ...template, key, name: `Follow-Up ${number}`, order: baseOrder + index,
      assigneeRules: options.assigneeRules ? [...options.assigneeRules] : [],
      branchRules: [
        route(FMS_FOLLOW_UP_OUTCOME.proceed, proceedStageKey, proceedLabel, 0),
        // Follow-Up 3 returns to Follow-Up 1: the next round is a new visit, driven by this employee's answer.
        route(FMS_FOLLOW_UP_OUTCOME.again, keys[(index + 1) % keys.length], number === FMS_FOLLOW_UP_GROUP_SIZE ? `${againLabel} (next round)` : againLabel, 1),
        route(FMS_FOLLOW_UP_OUTCOME.close, closeStageKey, closeLabel, 2),
      ],
      sla: {
        ...template.sla,
        // Same defaults as Add Step: suggested assignment, and a deadline the author opts into.
        ...(flow.assignmentVersion === 2 ? { assignment: suggestFmsAssignment(previous, options.formFields ?? {}) } : {}),
        deadlineEnabled: false,
        decisionMode: "yes_no",
        decisionOptions: FMS_FOLLOW_UP_DECISION_OPTIONS,
        followUpGroup,
      },
    };
    previous = stage;
    return stage;
  });
  const updated = stages.map((stage) => linkedFromParent && stage.key === parent!.key ? { ...stage, defaultNextStageKey: keys[0] } : stage);
  return { definition: { ...flow, stages: [...updated, ...group] }, groupId, stageKeys: keys, parentStageKey: parent?.key, linkedFromParent, proceedStageKey, closeStageKey };
}

export type FmsFollowUpGroupView = Readonly<{
  groupId: string;
  /** The saved main step, or the step that leads into Follow-Up 1 when none is saved. */
  parentStageKey?: string | undefined;
  /** True when `parentStageKey` is stored on the steps rather than inferred from the canvas. */
  parentSaved: boolean;
  members: readonly FmsStageDefinition[];
  proceedStageKeys: readonly string[];
  closeStageKeys: readonly string[];
  /** The last follow-up returns to Follow-Up 1, so follow-ups continue in rounds. */
  loopsBack: boolean;
  /** Configuration the author should complete. Missing destinations also block publishing through route validation. */
  problems: readonly string[];
  notes: readonly string[];
}>;

const tagOf = (stage: FmsStageDefinition) => stage.type === "end" ? undefined : normalizeFmsFollowUpGroupTag(stage.sla.followUpGroup);
const ruleTargets = (members: readonly FmsStageDefinition[], outcome: string) =>
  [...new Set(members.flatMap((stage) => stage.branchRules.filter((rule) => String(rule.value ?? "") === outcome && rule.nextStageKey).map((rule) => rule.nextStageKey!)))];

/** Every Follow-Up Group in a workflow, in the order of its first step. Untagged steps are never grouped. */
export function fmsFollowUpGroups(stages: readonly FmsStageDefinition[]): readonly FmsFollowUpGroupView[] {
  const byGroup = new Map<string, FmsStageDefinition[]>();
  for (const stage of stages) { const tag = tagOf(stage); if (tag) byGroup.set(tag.groupId, [...(byGroup.get(tag.groupId) ?? []), stage]); }
  const keys = new Set(stages.map((stage) => stage.key));
  return [...byGroup.entries()].map(([groupId, unsorted]) => {
    const members = [...unsorted].sort((a, b) => tagOf(a)!.number - tagOf(b)!.number || a.order - b.order);
    const memberKeys = new Set(members.map((stage) => stage.key));
    const first = members[0]!; const last = members.at(-1)!;
    const saved = members.map((stage) => tagOf(stage)!.parentStageKey).find((key) => !!key && keys.has(key) && !memberKeys.has(key));
    const inferred = saved ? undefined : stages.find((stage) => !memberKeys.has(stage.key) && fmsOutgoingStageKeys(stage).includes(first.key))?.key;
    const proceedStageKeys = ruleTargets(members, FMS_FOLLOW_UP_OUTCOME.proceed);
    const closeStageKeys = ruleTargets(members, FMS_FOLLOW_UP_OUTCOME.close);
    const loopsBack = members.length > 1 && fmsOutgoingStageKeys(last).includes(first.key);
    const problems: string[] = []; const notes: string[] = [];
    const numbers = new Set(members.map((stage) => tagOf(stage)!.number));
    for (let number = 1; number <= FMS_FOLLOW_UP_GROUP_SIZE; number++) if (!numbers.has(number as 1)) notes.push(`Follow-Up ${number} is no longer in this group.`);
    if (!saved && !inferred) problems.push(`Connect the main step to ${first.name || "Follow-Up 1"}.`);
    for (const stage of members) {
      const name = stage.name || `Follow-Up ${tagOf(stage)!.number}`;
      if (stage.sla.decisionMode !== "yes_no") { problems.push(`${name} is not a Decision step, so its answer cannot continue, proceed or close.`); continue; }
      const target = (outcome: string) => stage.branchRules.find((rule) => String(rule.value ?? "") === outcome)?.nextStageKey;
      if (!target(FMS_FOLLOW_UP_OUTCOME.proceed)) problems.push(`${name}: choose the step "Interested, proceed" goes to.`);
      if (!target(FMS_FOLLOW_UP_OUTCOME.close)) problems.push(`${name}: choose where "Not interested, close" goes, for example a Lost or Do not contact End Node.`);
    }
    if (!loopsBack) notes.push(`${last.name || "The last follow-up"} does not return to ${first.name || "Follow-Up 1"}, so follow-ups stop after it.`);
    return { groupId, parentStageKey: saved ?? inferred, parentSaved: !!saved, members, proceedStageKeys, closeStageKeys, loopsBack, problems, notes };
  });
}

/** Sets the main step of one group on all of its steps, in one change. */
export function setFmsFollowUpGroupParent(stages: readonly FmsStageDefinition[], groupId: string, parentStageKey: string | undefined): readonly FmsStageDefinition[] {
  return stages.map((stage) => {
    const tag = tagOf(stage);
    if (!tag || tag.groupId !== groupId) return stage;
    const { parentStageKey: _previous, ...rest } = tag;
    return { ...stage, sla: { ...stage.sla, followUpGroup: parentStageKey ? { ...rest, parentStageKey } : rest } };
  });
}

// ---------------------------------------------------------------- analytics

/** One recorded visit (`fms_instance_stages` row, read through RLS as the viewer). */
export type FmsFollowUpVisitRow = Readonly<{
  id: string; fms_instance_id: string; fms_stage_id: string; status: string;
  outcome?: string | null | undefined; visit_number?: number | null | undefined;
  activated_at?: string | null | undefined; created_at?: string | null | undefined;
  actual_datetime?: string | null | undefined; planned_datetime?: string | null | undefined;
  completed_by?: string | null | undefined; assigned_to?: readonly string[] | null | undefined;
  previous_instance_stage_id?: string | null | undefined;
}>;
/** One step of a published version (`fms_stages` row). `planned_time_rule` is the stored `sla`. */
export type FmsFollowUpStageRow = Readonly<{ id: string; fms_flow_id: string; stage_key: string; name: string; planned_time_rule: unknown }>;
export type FmsFollowUpExit = "proceed" | "follow_up" | "close" | "other";
export type FmsFollowUpAttempt = Readonly<{
  instanceId: string; flowId: string; groupId: string;
  parentStageKey: string | null; parentStageName: string | null;
  followUpNumber: 1 | 2 | 3; round: number; attempt: number;
  instanceStageId: string; stageKey: string; stageName: string; status: string; visitNumber: number;
  employeeId: string | null; assignedTo: readonly string[];
  activatedAt: string | null; dueAt: string | null; completedAt: string | null;
  outcome: string | null; exit: FmsFollowUpExit | null; nextStageKey: string | null;
}>;
const OPEN = new Set(["pending", "in_progress", "in_review", "overdue", "blocked"]);
const when = (visit: FmsFollowUpVisitRow) => visit.activated_at ?? visit.created_at ?? "";

/**
 * Numbers every recorded follow-up visit per run and group: `attempt` counts
 * all follow-up visits in order, `round` starts at 1 and increases each time
 * the run returns to an earlier follow-up (normally Follow-Up 3 to 1). Only
 * steps tagged in the version the run used are counted, so a step merely named
 * "Follow-Up" in an older workflow is never reinterpreted.
 */
export function fmsFollowUpAttempts(visits: readonly FmsFollowUpVisitRow[], stageRows: readonly FmsFollowUpStageRow[]): readonly FmsFollowUpAttempt[] {
  const stages = new Map(stageRows.map((row) => [row.id, row]));
  const tagFor = new Map(stageRows.flatMap((row) => {
    const sla = row.planned_time_rule && typeof row.planned_time_rule === "object" ? row.planned_time_rule as Record<string, unknown> : {};
    const tag = normalizeFmsFollowUpGroupTag(sla.followUpGroup);
    return tag ? [[row.id, tag] as const] : [];
  }));
  const stageKeyById = new Map(stageRows.map((row) => [row.id, row.stage_key]));
  const nameByFlowKey = new Map(stageRows.map((row) => [`${row.fms_flow_id}:${row.stage_key}`, row.name]));
  const nextById = new Map<string, string>();
  for (const visit of visits) if (visit.previous_instance_stage_id) { const key = stageKeyById.get(visit.fms_stage_id); if (key && !nextById.has(visit.previous_instance_stage_id)) nextById.set(visit.previous_instance_stage_id, key); }
  const runs = new Map<string, FmsFollowUpVisitRow[]>();
  for (const visit of visits) {
    const tag = tagFor.get(visit.fms_stage_id);
    if (!tag) continue;
    const key = `${visit.fms_instance_id}:${tag.groupId}`;
    runs.set(key, [...(runs.get(key) ?? []), visit]);
  }
  const attempts: FmsFollowUpAttempt[] = [];
  for (const run of runs.values()) {
    const ordered = [...run].sort((a, b) => when(a).localeCompare(when(b)) || (a.visit_number ?? 1) - (b.visit_number ?? 1) || a.id.localeCompare(b.id));
    let round = 1; let previousNumber = 0;
    ordered.forEach((visit, index) => {
      const tag = tagFor.get(visit.fms_stage_id)!; const stage = stages.get(visit.fms_stage_id)!;
      if (index > 0 && tag.number <= previousNumber) round += 1;
      previousNumber = tag.number;
      const nextStageKey = nextById.get(visit.id) ?? null;
      const outcome = visit.outcome ?? null;
      const exit: FmsFollowUpExit | null = visit.status !== "completed" ? null
        : outcome === FMS_FOLLOW_UP_OUTCOME.proceed ? "proceed" : outcome === FMS_FOLLOW_UP_OUTCOME.close ? "close" : outcome === FMS_FOLLOW_UP_OUTCOME.again ? "follow_up" : "other";
      attempts.push({
        instanceId: visit.fms_instance_id, flowId: stage.fms_flow_id, groupId: tag.groupId,
        parentStageKey: tag.parentStageKey ?? null, parentStageName: tag.parentStageKey ? nameByFlowKey.get(`${stage.fms_flow_id}:${tag.parentStageKey}`) ?? null : null,
        followUpNumber: tag.number, round, attempt: index + 1,
        instanceStageId: visit.id, stageKey: stage.stage_key, stageName: stage.name, status: visit.status, visitNumber: visit.visit_number ?? 1,
        employeeId: visit.completed_by ?? null, assignedTo: visit.assigned_to ?? [],
        activatedAt: visit.activated_at ?? visit.created_at ?? null, dueAt: visit.planned_datetime ?? null, completedAt: visit.actual_datetime ?? null,
        outcome, exit, nextStageKey,
      });
    });
  }
  return attempts;
}

export type FmsFollowUpGroupStats = Readonly<{
  groupId: string; parentStageKey: string | null; parentStageName: string | null; flowIds: readonly string[];
  /** Runs (customers) that reached this group. */
  runs: number;
  completedAttempts: number; openAttempts: number; overdueAttempts: number;
  proceeded: number; closed: number; stillFollowingUp: number;
  /** Mean completed follow-up attempts / rounds per run that proceeded. */
  averageAttemptsToProceed: number | null; averageRoundsToProceed: number | null;
  /** Runs that proceeded at Follow-Up 1, 2 or 3 of the first round, or in a later round. */
  proceededAt: Readonly<{ followUp1: number; followUp2: number; followUp3: number; laterRounds: number }>;
  /** Completed follow-up attempts per employee who completed them. */
  completedByEmployee: Readonly<Record<string, number>>;
}>;

/** Per-group totals from `fmsFollowUpAttempts`; groups in one workflow never mix. */
export function summarizeFmsFollowUps(attempts: readonly FmsFollowUpAttempt[], now: Date = new Date()): readonly FmsFollowUpGroupStats[] {
  const groups = new Map<string, FmsFollowUpAttempt[]>();
  for (const attempt of attempts) groups.set(attempt.groupId, [...(groups.get(attempt.groupId) ?? []), attempt]);
  return [...groups.entries()].map(([groupId, items]) => {
    const runs = new Map<string, FmsFollowUpAttempt[]>();
    for (const item of items) runs.set(item.instanceId, [...(runs.get(item.instanceId) ?? []), item]);
    const completed = items.filter((item) => item.status === "completed");
    const open = items.filter((item) => OPEN.has(item.status));
    const overdue = open.filter((item) => item.status === "overdue" || (!!item.dueAt && Date.parse(item.dueAt) < now.getTime()));
    let proceeded = 0; let closed = 0; let stillFollowingUp = 0; let attemptsSum = 0; let roundsSum = 0;
    const proceededAt = { followUp1: 0, followUp2: 0, followUp3: 0, laterRounds: 0 };
    for (const run of runs.values()) {
      const exit = run.find((item) => item.exit === "proceed" || item.exit === "close");
      if (exit?.exit === "proceed") {
        proceeded += 1;
        attemptsSum += run.filter((item) => item.status === "completed" && item.attempt <= exit.attempt).length; roundsSum += exit.round;
        if (exit.round > 1) proceededAt.laterRounds += 1; else proceededAt[`followUp${exit.followUpNumber}`] += 1;
      } else if (exit?.exit === "close") closed += 1;
      else if (run.some((item) => OPEN.has(item.status))) stillFollowingUp += 1;
    }
    const completedByEmployee: Record<string, number> = {};
    for (const item of completed) if (item.employeeId) completedByEmployee[item.employeeId] = (completedByEmployee[item.employeeId] ?? 0) + 1;
    const first = items[0]!;
    return {
      groupId, parentStageKey: first.parentStageKey, parentStageName: first.parentStageName, flowIds: [...new Set(items.map((item) => item.flowId))],
      runs: runs.size, completedAttempts: completed.length, openAttempts: open.length, overdueAttempts: overdue.length,
      proceeded, closed, stillFollowingUp,
      averageAttemptsToProceed: proceeded ? attemptsSum / proceeded : null, averageRoundsToProceed: proceeded ? roundsSum / proceeded : null,
      proceededAt, completedByEmployee,
    };
  });
}
