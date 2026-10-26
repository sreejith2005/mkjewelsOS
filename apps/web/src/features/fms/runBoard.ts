import { calculateFmsDelay } from "@jewelos/core";
import type { FmsInstance, FmsInstanceStage, FmsStageRow } from "./api";

/** Runs board: where each run (one client, lead, order...) is in its workflow. */
export type FmsRunView = "in_progress" | "finished" | "all";
const OPEN_VISIT = new Set(["pending", "in_progress", "in_review", "overdue"]);
const FINISHED_RUN = new Set(["completed", "cancelled"]);
const AUTOMATIC = new Set(["branch", "parallel_start", "parallel_join", "notification", "end"]);

/** A workflow version's steps in the order people read it: each step before the steps it leads to. */
export function fmsStepsInFlowOrder(definitions: readonly FmsStageRow[]): readonly FmsStageRow[] {
  const ordered = [...definitions].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const byId = new Map(ordered.map((step) => [step.id, step]));
  const seen = new Set<string>(); const result: FmsStageRow[] = [];
  const visit = (step: FmsStageRow) => {
    const post: FmsStageRow[] = [];
    const walk = (id: string) => {
      const item = byId.get(id);
      if (!item || seen.has(id)) return;
      seen.add(id);
      for (const next of [...[item.default_next_stage_id, ...(item.parallel_target_stage_ids ?? [])].filter((value): value is string => !!value)].reverse()) walk(next);
      post.push(item);
    };
    walk(step.id);
    result.push(...post.reverse());
  };
  for (const step of ordered) visit(step);
  return result;
}

export type FmsBoardColumn = Readonly<{ key: string; name: string; finished?: true }>;

/** One column per step people act on, from the newest version, then a Finished column. */
export function fmsBoardColumns(definitions: readonly FmsStageRow[], latestFlowId: string | undefined): readonly FmsBoardColumn[] {
  const steps = fmsStepsInFlowOrder(definitions.filter((step) => step.fms_flow_id === latestFlowId && !AUTOMATIC.has(step.step_type)));
  return [...steps.map((step) => ({ key: step.stage_key, name: step.name })), { key: "__finished", name: "Finished", finished: true as const }];
}

export type FmsRunCard = Readonly<{
  instance: FmsInstance;
  /** Stage keys of the steps open right now (more than one when paths run in parallel). */
  stepKeys: readonly string[];
  stepNames: readonly string[];
  assigneeIds: readonly string[];
  dueAt: string | null;
  overdue: boolean;
  finished: boolean;
}>;

export function fmsRunCard(instance: FmsInstance, visits: readonly FmsInstanceStage[], definitions: ReadonlyMap<string, FmsStageRow>, now?: string): FmsRunCard {
  const open = visits.filter((visit) => visit.fms_instance_id === instance.id && OPEN_VISIT.has(visit.status));
  const steps = open.map((visit) => definitions.get(visit.fms_stage_id)).filter((step): step is FmsStageRow => !!step);
  const dueAt = open.map((visit) => visit.planned_datetime).filter((value): value is string => !!value).sort()[0] ?? null;
  return {
    instance,
    stepKeys: [...new Set(steps.map((step) => step.stage_key))],
    stepNames: [...new Set(steps.map((step) => step.name))],
    assigneeIds: [...new Set(open.flatMap((visit) => visit.assigned_to ?? []))],
    dueAt,
    overdue: instance.status === "overdue" || open.some((visit) => calculateFmsDelay(visit.planned_datetime, visit.actual_datetime, now).overdue),
    finished: FINISHED_RUN.has(instance.status),
  };
}

/** Plain-word filter: the view, "only my work" (assigned to me now, or started by me), and a name/reference search. */
export function fmsRunMatches(card: FmsRunCard, input: Readonly<{ view: FmsRunView; mineOnly: boolean; profileId: string; query: string; name: string }>): boolean {
  if (input.view === "in_progress" && card.finished) return false;
  if (input.view === "finished" && !card.finished) return false;
  if (input.mineOnly && !card.assigneeIds.includes(input.profileId) && card.instance.started_by !== input.profileId) return false;
  const query = input.query.trim().toLowerCase();
  return !query || `${input.name} ${card.instance.reference_number} ${card.instance.title}`.toLowerCase().includes(query);
}

/** The board column a run belongs in; an open step missing from the newest version gets its own column. */
export function fmsRunColumnKeys(card: FmsRunCard): readonly string[] {
  if (card.finished) return ["__finished"];
  return card.stepKeys.length ? card.stepKeys : ["__waiting"];
}

export type FmsPathStep = Readonly<{
  key: string; name: string;
  state: "done" | "current" | "skipped" | "upcoming" | "not_needed";
  /** Who did it (done) or who has it now (current). */
  peopleIds: readonly string[];
  at: string | null;
  visits: number;
}>;

/** The run's journey through its own workflow version, step by step, for the visual path. */
export function fmsRunPath(instance: FmsInstance, visits: readonly FmsInstanceStage[], definitions: readonly FmsStageRow[]): readonly FmsPathStep[] {
  const own = visits.filter((visit) => visit.fms_instance_id === instance.id);
  const finished = FINISHED_RUN.has(instance.status);
  return fmsStepsInFlowOrder(definitions.filter((step) => step.fms_flow_id === instance.fms_flow_id && !AUTOMATIC.has(step.step_type))).map((step) => {
    const mine = own.filter((visit) => visit.fms_stage_id === step.id);
    const latest = [...mine].sort((a, b) => (a.visit_number ?? 1) - (b.visit_number ?? 1)).at(-1);
    const open = mine.find((visit) => OPEN_VISIT.has(visit.status));
    const base = { key: step.stage_key, name: step.name, visits: mine.length };
    if (open) return { ...base, state: "current" as const, peopleIds: open.assigned_to ?? [], at: open.planned_datetime };
    if (latest?.status === "completed" && latest.outcome === "condition_skipped") return { ...base, state: "skipped" as const, peopleIds: [], at: latest.actual_datetime };
    if (latest?.status === "completed") return { ...base, state: "done" as const, peopleIds: latest.completed_by ? [latest.completed_by] : latest.assigned_to ?? [], at: latest.actual_datetime };
    if (latest) return { ...base, state: finished ? "not_needed" as const : "upcoming" as const, peopleIds: [], at: null };
    return { ...base, state: finished ? "not_needed" as const : "upcoming" as const, peopleIds: [], at: null };
  });
}
