import { FMS_ASSIGNMENT_LABELS } from "./assignmentAuthoring.ts";
import { fmsFallbackStageKey, fmsFieldOptions, fmsOutgoingStageKeys, hasFmsStageRouting, normalizeFmsDefinition, resolveFmsBranch, evaluateFmsBranchRule, validateFmsDefinition } from "./engine.ts";
import type { FmsBranchRule, FmsFlowDefinition, FmsFormFieldRef, FmsStageDefinition, FmsValidationIssue } from "./types.ts";

/**
 * Deterministic workflow diagnostics. Publish-readiness issues come from
 * `validateFmsDefinition` unchanged and are the authority; the extra rules
 * here only add warnings and suggestions with their evidence. Nothing in this
 * module calls an API, a model, or the database.
 */
export type FmsDiagnosticSeverity = "error" | "warning" | "suggestion";
export type FmsDiagnosticFinding = Readonly<{
  id: string;
  severity: FmsDiagnosticSeverity;
  code: string;
  stageKey?: string | undefined;
  title: string;
  evidence: readonly string[];
  fix?: string | undefined;
  /** "validator" = the publish check itself; "analysis" = an added static rule. */
  source: "validator" | "analysis";
}>;

export type FmsDiagnosticUser = Readonly<{ id: string; name: string; active: boolean; loginEnabled: boolean; availability?: string | undefined }>;
export type FmsDiagnosticForm = Readonly<{ id: string; name: string; version: number; familyId: string; lifecycle: string }>;
export type FmsDiagnosticCatalog = Readonly<{
  formFields: Readonly<Record<string, readonly FmsFormFieldRef[]>>;
  forms: readonly FmsDiagnosticForm[];
  /** When absent, people checks are skipped rather than guessed. */
  users?: readonly FmsDiagnosticUser[] | undefined;
}>;

const HUMAN = new Set(["form", "task", "approval"]);
const SEVERITY_ORDER: Readonly<Record<FmsDiagnosticSeverity, number>> = { error: 0, warning: 1, suggestion: 2 };

export function fmsStageLabel(stage: FmsStageDefinition | undefined, key?: string): string {
  return stage ? `${stage.name || "Untitled step"} (${stage.key})` : key ? `missing step ${key}` : "the workflow";
}

function ruleLabel(rule: FmsBranchRule): string {
  return rule.label ? `"${rule.label}"` : `Route ${rule.order + 1}`;
}

function optionText(field: FmsFormFieldRef | undefined, value: unknown): string {
  const values = Array.isArray(value) ? value.map(String) : value === undefined || value === null ? [] : [String(value)];
  const options = fmsFieldOptions(field);
  return values.map((item) => { const label = options.find((option) => option.value === item)?.label; return label && label !== item ? `${label} [${item}]` : item; }).join(", ") || "—";
}

/** Human-readable assignment source of one stage, without guessing runtime results. */
export function describeFmsAssignment(stage: FmsStageDefinition, definition: FmsFlowDefinition, users: readonly FmsDiagnosticUser[] = []): string {
  if (!HUMAN.has(stage.type)) return "Automatic step (no employee)";
  const named = (id: string | undefined) => (id && users.find((user) => user.id === id)?.name) || (id ? "an employee outside your directory view" : "nobody");
  const fixed = stage.assigneeRules.filter((rule) => rule.type === "specific_user" && rule.userProfileId).map((rule) => named(rule.userProfileId));
  if (definition.assignmentVersion !== 2) return fixed.length ? `Legacy assignment: ${fixed.join(", ")}` : `Legacy assignment: ${stage.assigneeRules.map((rule) => rule.type).join(", ") || "none"}`;
  const config = stage.sla.assignment;
  if (!config) return "No assignment strategy chosen";
  const parts = [FMS_ASSIGNMENT_LABELS[config.mode]];
  if (config.mode === "fixed_employee") parts.push(fixed.join(", ") || "no employee chosen");
  if (config.mode === "hierarchy") parts.push(stage.assigneeRules.map((rule) => rule.role ? `${rule.type}: ${rule.role}` : rule.type).join(", ") || "no rule");
  if (config.mode === "previous_form") {
    if (config.followFormAssignee) parts.push("follows the Assigned To answer of the previous form");
    for (const source of config.sources) {
      const sourceStage = definition.stages.find((item) => item.key === source.sourceStageKey);
      parts.push(`${sourceStage?.name ?? source.sourceStageKey} · question ${source.fieldKey}${source.routeRuleId ? ` (route ${source.routeRuleId})` : ""}`);
    }
  }
  if (config.allowHandoff) parts.push("the previous doer may hand off");
  if (config.fallbackRule) parts.push(`fallback: ${config.fallbackRule.type === "specific_user" ? named(config.fallbackRule.userProfileId) : config.fallbackRule.type.replaceAll("_", " ")}`);
  return parts.join(" · ");
}

function stagesOnCycles(stages: readonly FmsStageDefinition[]): ReadonlySet<string> {
  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  const onCycle = new Set<string>();
  for (const start of stages) {
    const seen = new Set<string>(); const pending = [...fmsOutgoingStageKeys(start)];
    while (pending.length) {
      const key = pending.pop()!;
      if (key === start.key) { onCycle.add(start.key); break; }
      if (seen.has(key)) continue; seen.add(key);
      const stage = byKey.get(key); if (stage) pending.push(...fmsOutgoingStageKeys(stage));
    }
  }
  return onCycle;
}

function reaches(stages: readonly FmsStageDefinition[], from: string, predicate: (stage: FmsStageDefinition) => boolean): boolean {
  const byKey = new Map(stages.map((stage) => [stage.key, stage])); const seen = new Set<string>(); const pending = [from];
  while (pending.length) {
    const key = pending.pop()!; if (seen.has(key)) continue; seen.add(key);
    const stage = byKey.get(key); if (!stage) continue;
    if (predicate(stage)) return true;
    pending.push(...fmsOutgoingStageKeys(stage));
  }
  return false;
}

function analyseRoutes(stage: FmsStageDefinition, byKey: ReadonlyMap<string, FmsStageDefinition>, fields: readonly FmsFormFieldRef[] | undefined, add: (finding: Omit<FmsDiagnosticFinding, "id" | "source">) => void): void {
  const rules = [...stage.branchRules].sort((a, b) => a.order - b.order);
  const fallback = fmsFallbackStageKey(stage);
  const fallbackName = fallback ? fmsStageLabel(byKey.get(fallback), fallback) : "nowhere (the workflow would stop here)";
  // An earlier catch-all makes every later route on the same source unreachable.
  rules.forEach((rule, index) => {
    if (rule.operator === "default") return;
    const earlier = rules.slice(0, index).find((prior) => prior.operator !== "default" && prior.source === rule.source && prior.sourceKey === rule.sourceKey
      && (prior.operator === "not_empty" || (prior.operator === rule.operator && ["equals", "in"].includes(rule.operator) && JSON.stringify(prior.value) === JSON.stringify(rule.value))));
    if (earlier) add({ severity: "warning", code: "route_shadowed", stageKey: stage.key, title: `${ruleLabel(rule)} can never run`, evidence: [`${ruleLabel(earlier)} is checked first and already matches every answer ${ruleLabel(rule)} matches.`, `Routes are checked in order; the first match wins.`], fix: `Move ${ruleLabel(rule)} above ${ruleLabel(earlier)}, or narrow ${ruleLabel(earlier)}.` });
  });
  const answerRules = rules.filter((rule) => rule.source === "form_answer" && rule.operator !== "default" && rule.sourceKey);
  for (const sourceKey of [...new Set(answerRules.map((rule) => rule.sourceKey!))]) {
    const field = fields?.find((item) => item.key === sourceKey);
    if (!field) continue;
    if (!field.required || field.shown === false || field.hasCondition) {
      add({ severity: "warning", code: "route_on_optional_question", stageKey: stage.key, title: `Routing uses "${field.label}", which can be left blank`, evidence: [`"${field.label}" is ${!field.required ? "optional" : field.shown === false ? "hidden" : "shown only under a condition"}.`, `A blank answer matches no route and goes to the fallback: ${fallbackName}.`], fix: "Make the question required and always visible, or confirm the fallback is the right destination for a blank answer." });
    }
    const options = fmsFieldOptions(field);
    if (!options.length) continue;
    const covered = new Set(answerRules.filter((rule) => rule.sourceKey === sourceKey && ["equals", "in"].includes(rule.operator)).flatMap((rule) => Array.isArray(rule.value) ? rule.value.map(String) : [String(rule.value ?? "")]));
    if (answerRules.some((rule) => rule.sourceKey === sourceKey && ["not_equals", "not_empty", "contains"].includes(rule.operator))) continue;
    const uncovered = options.filter((option) => !covered.has(option.value));
    if (uncovered.length && uncovered.length < options.length) {
      add({ severity: "suggestion", code: "option_uses_fallback", stageKey: stage.key, title: `${uncovered.length} answer${uncovered.length === 1 ? "" : "s"} of "${field.label}" take${uncovered.length === 1 ? "s" : ""} the fallback`, evidence: [`No route matches: ${uncovered.map((option) => `${option.label} [${option.value}]`).join(", ")}.`, `These answers continue to ${fallbackName}.`], fix: "Add a route for these answers if they need a different next step." });
    }
  }
  if (stage.sla.decisionMode === "yes_no" && rules.length && !rules.some((rule) => rule.source === "outcome")) {
    add({ severity: "suggestion", code: "decision_not_routed", stageKey: stage.key, title: "Decision options do not change the path", evidence: [`Options: ${(stage.sla.decisionOptions ?? []).map((option) => option.label).join(", ")}.`, "No route checks this step's outcome."], fix: "Add an outcome route per option if the decision should lead to different steps." });
  }
}

/** Static findings for a draft or published definition. Pure and deterministic. */
export function diagnoseFmsDefinition(raw: FmsFlowDefinition, catalog: FmsDiagnosticCatalog): readonly FmsDiagnosticFinding[] {
  const definition = normalizeFmsDefinition(raw);
  const byKey = new Map(definition.stages.map((stage) => [stage.key, stage]));
  const findings: Omit<FmsDiagnosticFinding, "id">[] = [];
  const issues: readonly FmsValidationIssue[] = validateFmsDefinition(definition, { formFields: catalog.formFields, availableFormIds: catalog.forms.map((form) => form.id) });
  for (const issue of issues) findings.push({ severity: "error", code: issue.code, stageKey: issue.stageKey, title: issue.message, evidence: [issue.stageKey ? `Step: ${fmsStageLabel(byKey.get(issue.stageKey), issue.stageKey)}` : "Workflow settings"], source: "validator" });
  const add = (finding: Omit<FmsDiagnosticFinding, "id" | "source">) => findings.push({ ...finding, source: "analysis" });

  if (definition.assignmentVersion !== 2 && definition.stages.length) add({ severity: "suggestion", code: "legacy_assignment_contract", title: "This draft uses the legacy assignment contract", evidence: ["assignmentVersion is 1. Running and published versions keep their own contract."], fix: "Use “Upgrade this draft to stage-specific assignment” in the builder when you are ready." });
  const users = catalog.users;
  const onCycle = stagesOnCycles(definition.stages);
  const names = new Map<string, string[]>();
  for (const stage of definition.stages) {
    names.set(stage.name.toLowerCase(), [...(names.get(stage.name.toLowerCase()) ?? []), stage.key]);
    const fields = stage.formTemplateId ? catalog.formFields[stage.formTemplateId] : undefined;
    if (hasFmsStageRouting(stage) || stage.type === "branch") analyseRoutes(stage, byKey, fields, add);
    if (stage.formTemplateId) {
      const pinned = catalog.forms.find((form) => form.id === stage.formTemplateId);
      const newer = pinned ? catalog.forms.filter((form) => form.familyId === pinned.familyId && form.lifecycle === "published" && form.version > pinned.version).sort((a, b) => b.version - a.version)[0] : undefined;
      if (pinned && newer) add({ severity: "suggestion", code: "older_form_version", stageKey: stage.key, title: `Pinned to "${pinned.name}" v${pinned.version}; v${newer.version} is published`, evidence: ["A stage keeps its exact Form version until you change it, so running work is unaffected."], fix: "Review the newer version's questions, then switch the linked Form in this step if routes still match." });
    }
    if (!HUMAN.has(stage.type)) continue;
    const config = stage.sla.assignment;
    if (users && (definition.assignmentVersion !== 2 || config?.mode === "fixed_employee")) {
      for (const rule of stage.assigneeRules.filter((item) => item.type === "specific_user" && item.userProfileId)) {
        const user = users.find((item) => item.id === rule.userProfileId);
        if (!user) add({ severity: "warning", code: "assignee_not_visible", stageKey: stage.key, title: "The fixed employee is not in your active directory", evidence: ["The saved employee ID does not match any employee you can see. They may have left, or belong elsewhere."], fix: "Choose an active employee for this step." });
        else if (!user.active || !user.loginEnabled) add({ severity: "error", code: "assignee_inactive", stageKey: stage.key, title: `${user.name} cannot receive work`, evidence: [`${user.name} is ${!user.active ? "inactive" : "unable to sign in"}.`], fix: "Choose an active employee, or use a role or previous-form assignment." });
        else if (user.availability === "absent") add({ severity: "warning", code: "assignee_absent_today", stageKey: stage.key, title: `${user.name} is marked absent today`, evidence: ["Today's availability record says absent. Leave coverage may redirect new work."], fix: "No change is needed for a short absence; for a permanent change pick another employee." });
      }
    }
    if (definition.assignmentVersion === 2 && config?.mode === "manual_handoff" && !config.fallbackRule) add({ severity: "suggestion", code: "handoff_without_fallback", stageKey: stage.key, title: "Manual handoff has no fallback", evidence: ["If the previous employee does not choose someone, this step waits for a manager."], fix: "Add a fallback (for example the previous step's employee)." });
    if (onCycle.has(stage.key) && !stage.sla.followUp) add({ severity: "suggestion", code: "loop_without_visit_limit", stageKey: stage.key, title: "This step can repeat without a visit limit", evidence: ["A route returns to this step, and no follow-up limit is set."], fix: "Set a visit limit with Hold or Escalate so a repeating loop is noticed." });
  }
  for (const stage of definition.stages.filter((item) => item.type === "parallel_start")) {
    const unjoined = stage.parallelTargetStageKeys.filter((key) => !reaches(definition.stages, key, (item) => item.type === "parallel_join"));
    if (unjoined.length && unjoined.length < stage.parallelTargetStageKeys.length) add({ severity: "warning", code: "parallel_branch_not_joined", stageKey: stage.key, title: "Some parallel branches never reach a join", evidence: [`Not joined: ${unjoined.map((key) => fmsStageLabel(byKey.get(key), key)).join(", ")}.`], fix: "Route every parallel branch into the same Parallel Join, or none of them." });
  }
  for (const stage of definition.stages.filter((item) => item.type === "parallel_join")) {
    for (const next of fmsOutgoingStageKeys(stage)) {
      const target = byKey.get(next);
      if (target?.sla.assignment?.mode === "previous_form" && target.sla.assignment.followFormAssignee) add({ severity: "warning", code: "simple_assignment_after_join", stageKey: target.key, title: "Simple assignment follows a parallel join", evidence: ["After a join there are several previous forms, so “Assigned To” is ambiguous."], fix: "Choose an explicit source question, a fixed employee, or a fallback." });
    }
  }
  for (const [, keys] of names) if (keys.length > 1) add({ severity: "suggestion", code: "duplicate_step_name", stageKey: keys[1], title: "Two steps share a name", evidence: [`Steps ${keys.join(", ")} have the same name, which is confusing in Tasks and notifications.`], fix: "Give each step a distinct name." });

  const counters = new Map<string, number>();
  return findings
    .map((finding) => { const base = `${finding.code}:${finding.stageKey ?? "flow"}`; const n = (counters.get(base) ?? 0) + 1; counters.set(base, n); return { ...finding, id: `${base}:${n}` }; })
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || definition.stages.findIndex((stage) => stage.key === a.stageKey) - definition.stages.findIndex((stage) => stage.key === b.stageKey));
}

export type FmsRouteEvaluation = Readonly<{ ruleId: string; order: number; label: string; source: FmsBranchRule["source"]; questionKey?: string | undefined; questionLabel?: string | undefined; operator: FmsBranchRule["operator"]; expected: string; actual: string; matched: boolean; targetStageKey?: string | undefined }>;
export type FmsRouteExplanation = Readonly<{
  stageKey: string; stageName: string; evaluations: readonly FmsRouteEvaluation[];
  chosenRuleId: string | null; nextStageKey: string | null; nextStageName: string | null; viaFallback: boolean; note: string;
}>;

/**
 * What the current engine rules would do on completing one stage with the
 * given answers/outcome: every route in evaluation order and the first match.
 * Uses `resolveFmsBranch`, the same resolver the simulation uses.
 */
export function explainFmsRoute(raw: FmsFlowDefinition, stageKey: string, input: Readonly<{ answers?: Readonly<Record<string, unknown>>; outcome?: string | null }>, formFields: Readonly<Record<string, readonly FmsFormFieldRef[]>> = {}): FmsRouteExplanation | null {
  const definition = normalizeFmsDefinition(raw);
  const stage = definition.stages.find((item) => item.key === stageKey);
  if (!stage) return null;
  const byKey = new Map(definition.stages.map((item) => [item.key, item]));
  const fields = stage.formTemplateId ? formFields[stage.formTemplateId] : undefined;
  const answers = input.answers ?? {};
  const rules = [...stage.branchRules].sort((a, b) => a.order - b.order);
  const evaluations = rules.map((rule) => {
    const field = rule.source === "form_answer" ? fields?.find((item) => item.key === rule.sourceKey) : undefined;
    const actualValue = rule.source === "outcome" ? input.outcome ?? undefined : rule.source === "form_answer" ? answers[rule.sourceKey ?? ""] : undefined;
    return { ruleId: rule.id, order: rule.order, label: ruleLabel(rule), source: rule.source, questionKey: rule.sourceKey, questionLabel: field?.label, operator: rule.operator, expected: rule.operator === "default" ? "anything (fallback)" : optionText(field, rule.value), actual: rule.source === "context" ? "process field (not evaluated in preview)" : optionText(field, actualValue), matched: rule.source === "context" ? false : evaluateFmsBranchRule(rule, actualValue), targetStageKey: rule.nextStageKey };
  });
  const chosen = resolveFmsBranch(rules.filter((rule) => rule.source !== "context"), { formAnswers: answers, outcome: input.outcome ?? undefined });
  const next = stage.type === "parallel_start" ? null : chosen?.nextStageKey ?? (stage.type === "branch" ? undefined : fmsFallbackStageKey(stage)) ?? null;
  const viaFallback = !chosen || chosen.operator === "default";
  const note = stage.type === "parallel_start" ? "A parallel start activates every target at once." : !rules.length ? (next ? "This step has one next step and no routes." : "This step has no next step, so completing it completes the workflow (if no other branch is still open).") : chosen && chosen.operator !== "default" ? `${ruleLabel(chosen)} is the first route that matches.` : next ? "No route matched, so the fallback is used." : "No route matched and there is no fallback: the workflow cannot continue from here.";
  return { stageKey: stage.key, stageName: stage.name, evaluations, chosenRuleId: chosen?.id ?? null, nextStageKey: next, nextStageName: next ? byKey.get(next)?.name ?? next : null, viaFallback, note };
}
