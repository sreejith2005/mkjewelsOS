import { fmsFallbackStageKey, normalizeFmsDefinition, resolveFmsBranch } from "./engine";
import type { FmsFlowDefinition, FmsStageDefinition } from "./types";
import { normalizeFormAnswers } from "../forms/answers";
import { validateCompleteForm } from "../forms/validation";
import type { FormAnswers, FormTemplateDefinition } from "../forms/types";

export type FmsSimulationInput = Readonly<{
  answers: Readonly<Record<string, readonly FormAnswers[]>>;
  forms?: Readonly<Record<string, FormTemplateDefinition>>;
  outcomes?: Readonly<Record<string, readonly string[]>>;
  handoffs?: Readonly<Record<string, readonly string[]>>;
  starterId?: string;
  maxEvents?: number;
}>;
export type FmsSimulationEvent = Readonly<{ stageKey: string; stageName: string; visit: number; status: "simulated" | "skipped" | "waiting" | "held";
  assignmentMethod: string; selectedUserId: string | null; selectedUserIds: readonly string[]; routeRuleId: string | null; formTemplateId: string | null; outcome: string | null; answers: FormAnswers; note: string }>;
/** Deterministic authoring aid only. It never calls an API or creates work;
 * final routing, form visibility, coverage and eligibility remain server-owned. */
export function simulateFmsDefinition(raw: FmsFlowDefinition, input: FmsSimulationInput) {
  const flow = normalizeFmsDefinition(raw); const byKey = new Map(flow.stages.map(stage => [stage.key, stage]));
  const events: FmsSimulationEvent[] = []; const visits = new Map<string, number>();
  type Token = { key: string; path: number[]; cohort: string | null; branch: string | null };
  const queue: Token[] = flow.stages[0] ? [{ key: flow.stages[0].key, path: [], cohort: null, branch: null }] : [];
  const arrivals = new Map<string, Map<string, number[]>>();
  const released = new Set<string>();
  const scopes = new Map<string, { targets: readonly string[]; parentCohort: string | null; parentBranch: string | null }>();
  let serial = 0;
  const limit = Math.max(1, Math.min(input.maxEvents ?? 100, 500));
  const route = (stage: FmsStageDefinition, answers: Readonly<Record<string, unknown>>, outcome: string | null) =>
    resolveFmsBranch(stage.branchRules, { formAnswers: answers, outcome })?.nextStageKey ?? fmsFallbackStageKey(stage);
  while (queue.length && events.length < limit) {
    const token = queue.shift()!; const stage = byKey.get(token.key);
    if (!stage) throw new Error(`Simulation route points to missing step ${token.key}`);
    const visit = (visits.get(stage.key) ?? 0) + 1;
    const supplied = input.answers[stage.key]?.[visit - 1] ?? input.answers[stage.key]?.[0] ?? {};
    const form = stage.formTemplateId ? input.forms?.[stage.formTemplateId] : undefined;
    const answers = form ? normalizeFormAnswers(form, supplied) : supplied;
    const outcome = input.outcomes?.[stage.key]?.[visit - 1] ?? input.outcomes?.[stage.key]?.[0] ?? null;
    const condition = stage.sla.conditional;
    const expected = condition ? "decisionOptionKey" in condition ? condition.decisionOptionKey : condition.outcome : null;
    const priorDecision = condition ? token.path.map(index => events[index]!).reverse().find(event => event.stageKey === condition.decisionStageKey) : null;
    const skipped = !!condition && priorDecision?.outcome !== expected;
    let selected: string | null = null; let selectedIds: string[] = []; let method = "automatic"; let note = ""; let status: FmsSimulationEvent["status"] = skipped ? "skipped" : "simulated";
    const previousHuman = token.path.map(index => events[index]!).reverse().find(event => event.status === "simulated" && ["form", "task", "approval"].includes(byKey.get(event.stageKey)?.type ?? ""));
    const previousEmployee = previousHuman?.selectedUserIds.length === 1 ? previousHuman.selectedUserIds[0] ?? null : null;
    const config = stage.sla.assignment;
    const automatic = ["branch", "parallel_start", "parallel_join", "notification", "end"].includes(stage.type);
    if (!automatic && !skipped) {
      method = config?.mode ?? "legacy";
      if (stage.key === flow.stages[0]?.key && token.path.length === 0) selected = input.starterId ?? null;
      else if (config?.mode === "fixed_employee" || !config) {
        selectedIds = [...new Set(stage.assigneeRules.flatMap(rule => rule.type === "specific_user" && rule.userProfileId ? [rule.userProfileId] : []))];
        if (selectedIds.length === 1) selected = selectedIds[0] ?? null;
        else if (selectedIds.length > 1 && !stage.allowMultipleDoers) { selectedIds = []; note = "Choose one fixed employee or enable multiple doers."; }
      }
      else if (config.mode === "previous_form") {
        for (const index of [...token.path].reverse()) {
          const prior = events[index]!;
          if (prior.status !== "simulated") continue;
          const source = config.sources.find(source => source.sourceStageKey === prior.stageKey && source.formTemplateId === prior.formTemplateId && (!source.routeRuleId || source.routeRuleId === prior.routeRuleId));
          if (source && typeof prior.answers[source.fieldKey] === "string" && prior.answers[source.fieldKey]) { selected = String(prior.answers[source.fieldKey]); break; }
        }
      } else if (config.mode === "previous_stage_employee") selected = previousEmployee;
      if (config?.allowHandoff && config.mode !== "fixed_employee") selected = input.handoffs?.[stage.key]?.[visit - 1] ?? selected;
      if (!selected && !selectedIds.length && config?.fallbackRule) {
        const fallback = config.fallbackRule;
        selected = fallback.type === "specific_user" ? fallback.userProfileId ?? null : fallback.type === "reporter" ? input.starterId ?? null : fallback.type === "previous_step_doer" ? previousEmployee : null;
        method = "configured_fallback";
      }
      if (selected) selectedIds = [selected];
      if (!selectedIds.length) { status = "waiting"; note ||= config?.mode === "hierarchy" ? "Hierarchy resolves on the server for the real employee and scope." : "Provide an employee answer or an explicit handoff. A previous step with multiple doers needs an explicit completing employee."; }
      if (form) { const validation = validateCompleteForm(form, supplied); if (!validation.valid) { status = "waiting"; note = validation.issues[0]?.message ?? "Complete the sample Form."; } }
      if (stage.sla.followUp && visit > stage.sla.followUp.maxVisits) { status = "held"; note = "Configured follow-up limit reached."; }
    }
    if (stage.type === "parallel_join" && token.cohort) {
      const key = `${token.cohort}:${stage.key}`;
      if (released.has(key)) continue;
      const scope = scopes.get(token.cohort);
      const cohort = arrivals.get(key) ?? new Map<string, number[]>();
      cohort.set(token.branch ?? token.key, token.path); arrivals.set(key, cohort);
      const required = stage.joinRule === "specific" ? stage.joinRequiredStageKeys : scope?.targets ?? [];
      const ready = stage.joinRule === "any" || required.every(key => cohort.has(key));
      if (!ready) { status = "waiting"; note = "Waiting for the other parallel branches."; }
      else {
        released.add(key);
        token.path = [...new Set([...cohort.values()].flat())].sort((a, b) => a - b);
        token.cohort = scope?.parentCohort ?? null; token.branch = scope?.parentBranch ?? null;
      }
    }
    visits.set(stage.key, visit);
    const index = events.push({ stageKey: stage.key, stageName: stage.name, visit, status, assignmentMethod: method, selectedUserId: selected, selectedUserIds: selectedIds, routeRuleId: skipped ? null : resolveFmsBranch(stage.branchRules, { formAnswers: answers, outcome })?.id ?? null, formTemplateId: stage.formTemplateId ?? null, outcome, answers: skipped ? {} : answers, note }) - 1;
    if (status === "waiting" || status === "held" || stage.type === "end") continue;
    const path = [...token.path, index];
    if (stage.type === "parallel_start" && !skipped) {
      const cohort = `${stage.key}:${++serial}`;
      scopes.set(cohort, { targets: stage.parallelTargetStageKeys, parentCohort: token.cohort, parentBranch: token.branch });
      for (const key of stage.parallelTargetStageKeys) queue.push({ key, path, cohort, branch: key });
    } else {
      const next = skipped ? stage.defaultNextStageKey : route(stage, answers, outcome);
      if (next) queue.push({ ...token, key: next, path });
    }
  }
  return { events, limitReached: queue.length > 0, warnings: ["Simulation creates no work. The server revalidates forms, routes, employee permissions and availability at submission."] };
}
