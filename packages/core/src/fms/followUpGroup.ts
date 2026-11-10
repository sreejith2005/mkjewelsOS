import { suggestFmsAssignment } from "./assignmentAuthoring.ts";
import { fmsOutgoingStageKeys, hasFmsStageRouting, normalizeFmsDefinition, normalizeFmsFollowUpGroupTag } from "./engine.ts";
import { fmsStageTemplate } from "./stageTemplate.ts";
import { fmsStageKeyFactory } from "./transfer.ts";
import type { FmsAssigneeRule, FmsFlowDefinition, FmsFollowUpGroupTag, FmsFormFieldRef, FmsStageDefinition } from "./types.ts";

/**
 * Follow-Up Groups: a builder shortcut that adds three ordinary steps
 * (Follow-Up 1, 2, 3) after a main step, each exactly what Add Step creates.
 * The author adds questions, conditions and any loop back to Follow-Up 1 like
 * on any step. The only extra data is `sla.followUpGroup`, which identifies the
 * group for reporting; the runtime never reads it, and a return to an earlier
 * follow-up runs on the existing loop engine (a new visit per round).
 */
export const FMS_FOLLOW_UP_GROUP_SIZE = 3;
/**
 * Outcome keys used by the first release (2026-11-09), which created Decision
 * steps. Kept only so reports read those groups correctly; new groups have no
 * preset outcomes.
 */
export const FMS_FOLLOW_UP_OUTCOME = { proceed: "proceed", again: "follow_up_again", close: "not_interested" } as const;
/** Steps a follow-up group cannot follow: they never hand work to a single next step. */
const NOT_A_PARENT = new Set(["branch", "parallel_start", "end"]);
const CLOSING_ENDS = new Set(["lost", "do_not_contact"]);

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
  /** Where Follow-Up 3 continues: the main step's former next step. */
  nextStageKey?: string | undefined;
}>;

/**
 * Adds one Follow-Up Group as three new plain steps chained Follow-Up 1 ->
 * 2 -> 3. Existing steps are never changed except one: a main step with a
 * plain single next step now leads to Follow-Up 1, and Follow-Up 3 leads to
 * that former next step. A main step that already routes (conditions, branch,
 * parallel) keeps every route; the group is added unconnected.
 */
export function insertFmsFollowUpGroup(raw: FmsFlowDefinition, options: FmsFollowUpGroupInsertOptions): FmsFollowUpGroupInsert {
  const flow = normalizeFmsDefinition(raw);
  const stages = flow.stages;
  const candidate = options.afterKey ? stages.find((stage) => stage.key === options.afterKey) : undefined;
  const parent = candidate && !NOT_A_PARENT.has(candidate.type) ? candidate : undefined;
  const linkedFromParent = !!parent && !hasFmsStageRouting(parent);
  const nextStageKey = linkedFromParent ? parent!.defaultNextStageKey : undefined;
  const nextKey = fmsStageKeyFactory(stages.map((stage) => stage.key));
  const keys = Array.from({ length: FMS_FOLLOW_UP_GROUP_SIZE }, () => nextKey());
  const groupId = options.newId();
  const baseOrder = Math.max(-1, ...stages.map((stage) => stage.order)) + 1;
  let previous: FmsStageDefinition | undefined = parent ?? stages.at(-1);
  const group = keys.map((key, index): FmsStageDefinition => {
    const number = (index + 1) as FmsFollowUpGroupTag["number"];
    const template = fmsStageTemplate("task", baseOrder + index, options.newId);
    const followUpGroup: FmsFollowUpGroupTag = { groupId, number, ...(parent ? { parentStageKey: parent.key } : {}) };
    const next = index < keys.length - 1 ? keys[index + 1] : nextStageKey;
    const stage: FmsStageDefinition = {
      ...template, key, name: `Follow-Up ${number}`, order: baseOrder + index,
      assigneeRules: options.assigneeRules ? [...options.assigneeRules] : [],
      ...(next ? { defaultNextStageKey: next } : {}),
      sla: {
        ...template.sla,
        // Same defaults as Add Step: suggested assignment, and a deadline the author opts into.
        ...(flow.assignmentVersion === 2 ? { assignment: suggestFmsAssignment(previous, options.formFields ?? {}) } : {}),
        deadlineEnabled: false,
        followUpGroup,
      },
    };
    previous = stage;
    return stage;
  });
  const updated = stages.map((stage) => linkedFromParent && stage.key === parent!.key ? { ...stage, defaultNextStageKey: keys[0] } : stage);
  return { definition: { ...flow, stages: [...updated, ...group] }, groupId, stageKeys: keys, parentStageKey: parent?.key, linkedFromParent, nextStageKey };
}

export type FmsFollowUpGroupView = Readonly<{
  groupId: string;
  /** The saved main step, or the step that leads into Follow-Up 1 when none is saved. */
  parentStageKey?: string | undefined;
  /** True when `parentStageKey` is stored on the steps rather than inferred from the canvas. */
  parentSaved: boolean;
  members: readonly FmsStageDefinition[];
  /** Steps outside the group that the follow-ups lead to, other than a Lost / Do not contact ending. */
  proceedStageKeys: readonly string[];
  /** Lost or Do not contact End Nodes the follow-ups lead to. */
  closeStageKeys: readonly string[];
  /** Some follow-up leads back to the same or an earlier follow-up, so follow-ups can repeat in rounds. */
  loopsBack: boolean;
  /** Things the author must do for the group to be reachable. */
  problems: readonly string[];
  /** Optional suggestions; nothing here blocks publishing. */
  notes: readonly string[];
}>;

const tagOf = (stage: FmsStageDefinition) => stage.type === "end" ? undefined : normalizeFmsFollowUpGroupTag(stage.sla.followUpGroup);

/** Every Follow-Up Group in a workflow, in the order of its first step. Untagged steps are never grouped. */
export function fmsFollowUpGroups(stages: readonly FmsStageDefinition[]): readonly FmsFollowUpGroupView[] {
  const byGroup = new Map<string, FmsStageDefinition[]>();
  for (const stage of stages) { const tag = tagOf(stage); if (tag) byGroup.set(tag.groupId, [...(byGroup.get(tag.groupId) ?? []), stage]); }
  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  return [...byGroup.entries()].map(([groupId, unsorted]) => {
    const members = [...unsorted].sort((a, b) => tagOf(a)!.number - tagOf(b)!.number || a.order - b.order);
    const memberKeys = new Set(members.map((stage) => stage.key));
    const first = members[0]!; const last = members.at(-1)!;
    const saved = members.map((stage) => tagOf(stage)!.parentStageKey).find((key) => !!key && byKey.has(key) && !memberKeys.has(key));
    const inferred = saved ? undefined : stages.find((stage) => !memberKeys.has(stage.key) && fmsOutgoingStageKeys(stage).includes(first.key))?.key;
    const exits = [...new Set(members.flatMap((stage) => fmsOutgoingStageKeys(stage).filter((key) => !memberKeys.has(key) && byKey.has(key))))];
    const closing = (key: string) => { const stage = byKey.get(key); return stage?.type === "end" && CLOSING_ENDS.has(stage.sla.terminal?.outcome ?? ""); };
    const number = (stage: FmsStageDefinition) => tagOf(stage)!.number;
    const loopsBack = members.some((stage) => fmsOutgoingStageKeys(stage).some((key) => { const target = byKey.get(key); return !!target && memberKeys.has(key) && number(target) <= number(stage); }));
    const problems: string[] = []; const notes: string[] = [];
    const numbers = new Set(members.map(number));
    for (let n = 1; n <= FMS_FOLLOW_UP_GROUP_SIZE; n++) if (!numbers.has(n as 1)) notes.push(`Follow-Up ${n} is no longer in this group.`);
    if (!saved && !inferred) problems.push(`Connect the main step to ${first.name || "Follow-Up 1"}.`);
    if (!loopsBack) notes.push(`To repeat follow-ups, add a condition on ${last.name || "the last follow-up"} that goes back to ${first.name || "Follow-Up 1"}.`);
    return { groupId, parentStageKey: saved ?? inferred, parentSaved: !!saved, members, proceedStageKeys: exits.filter((key) => !closing(key)), closeStageKeys: exits.filter(closing), loopsBack, problems, notes };
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
export type FmsFollowUpStageRow = Readonly<{ id: string; fms_flow_id: string; stage_key: string; name: string; planned_time_rule: unknown; step_type?: string | null | undefined }>;
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
const lastCompletedOf = (visits: readonly FmsFollowUpVisitRow[]) => [...visits].reverse().find((visit) => visit.status === "completed")?.id;
const when = (visit: FmsFollowUpVisitRow) => visit.activated_at ?? visit.created_at ?? "";

/**
 * Numbers every recorded follow-up visit per run and group: `attempt` counts
 * all follow-up visits in order, `round` starts at 1 and increases each time
 * the run returns to an earlier follow-up (normally Follow-Up 3 to 1). Only
 * steps tagged in the version the run used are counted, so a step merely named
 * "Follow-Up" in an older workflow is never reinterpreted.
 */
export function fmsFollowUpAttempts(visits: readonly FmsFollowUpVisitRow[], stageRows: readonly FmsFollowUpStageRow[], runOutcomes: Readonly<Record<string, string>> = {}): readonly FmsFollowUpAttempt[] {
  const stages = new Map(stageRows.map((row) => [row.id, row]));
  const tagFor = new Map(stageRows.flatMap((row) => {
    const sla = row.planned_time_rule && typeof row.planned_time_rule === "object" ? row.planned_time_rule as Record<string, unknown> : {};
    const tag = normalizeFmsFollowUpGroupTag(sla.followUpGroup);
    return tag ? [[row.id, tag] as const] : [];
  }));
  const stageKeyById = new Map(stageRows.map((row) => [row.id, row.stage_key]));
  const nameByFlowKey = new Map(stageRows.map((row) => [`${row.fms_flow_id}:${row.stage_key}`, row.name]));
  const rowByFlowKey = new Map(stageRows.map((row) => [`${row.fms_flow_id}:${row.stage_key}`, row]));
  const endOutcome = (row: FmsFollowUpStageRow | undefined) => {
    if (!row || row.step_type !== "end") return undefined;
    const sla = row.planned_time_rule && typeof row.planned_time_rule === "object" ? row.planned_time_rule as Record<string, unknown> : {};
    const terminal = sla.terminal && typeof sla.terminal === "object" ? sla.terminal as Record<string, unknown> : {};
    return typeof terminal.outcome === "string" ? terminal.outcome : "other";
  };
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
      const exit: FmsFollowUpExit | null = visit.status !== "completed" ? null : (() => {
        // First-release groups recorded a fixed outcome; every other group is read from where the run went next.
        if (outcome === FMS_FOLLOW_UP_OUTCOME.proceed) return "proceed";
        if (outcome === FMS_FOLLOW_UP_OUTCOME.close) return "close";
        if (outcome === FMS_FOLLOW_UP_OUTCOME.again) return "follow_up";
        const next = nextStageKey ? rowByFlowKey.get(`${stage.fms_flow_id}:${nextStageKey}`) : undefined;
        if (next && tagFor.get(next.id)?.groupId === tag.groupId) return "follow_up";
        const ending = next ? endOutcome(next) : visit.id === lastCompletedOf(ordered) ? runOutcomes[visit.fms_instance_id] : undefined;
        if (ending !== undefined) return CLOSING_ENDS.has(ending) ? "close" : ending === "won" ? "proceed" : "other";
        return next ? "proceed" : "other";
      })();
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
