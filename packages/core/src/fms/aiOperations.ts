import { USER_ROLES, type UserRole } from "../roleMenu.ts";
import { suggestFmsAssignment } from "./assignmentAuthoring.ts";
import { fmsFieldOptions, normalizeFmsDefinition } from "./engine.ts";
import { FMS_AI_LIMITS, type FmsAiAssignment, type FmsAiFormSpec, type FmsAiOperation, type FmsAiValidationIssue } from "./aiContract.ts";
import type { FormTemplateDefinition } from "../forms/types.ts";
import { fmsStageTemplate } from "./stageTemplate.ts";
import { FMS_STAGE_TYPES, type FmsAssigneeRule, type FmsBranchRule, type FmsFlowDefinition, type FmsFormFieldRef, type FmsStageDefinition } from "./types.ts";
import type { FmsAssignmentConfig } from "./workContracts.ts";

/** The catalog the operations are checked against: only what the caller may see. */
export type FmsAiCatalog = Readonly<{
  forms: readonly Readonly<{ id: string; name: string; version: number; lifecycle: string }>[];
  formFields: Readonly<Record<string, readonly FmsFormFieldRef[]>>;
  /** Active, sign-in-enabled employees visible to the caller. */
  users: readonly Readonly<{ id: string; name: string; active: boolean; loginEnabled: boolean }>[];
}>;

export type FmsAiApplyResult =
  | Readonly<{ ok: true; definition: FmsFlowDefinition; notes: readonly string[] }>
  | Readonly<{ ok: false; errors: readonly FmsAiValidationIssue[] }>;

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HUMAN = new Set(["form", "task", "approval"]);

/** Removes a stage and repairs every reference to it (the builder's delete). */
export function removeFmsStageFromStages(stages: readonly FmsStageDefinition[], key: string): readonly FmsStageDefinition[] {
  const removed = stages.find((stage) => stage.key === key);
  const replacement = removed?.type === "branch" || removed?.type === "parallel_start" ? undefined : removed?.defaultNextStageKey;
  return stages.filter((stage) => stage.key !== key).map((stage) => ({
    ...stage,
    defaultNextStageKey: stage.defaultNextStageKey === key ? replacement : stage.defaultNextStageKey,
    branchRules: stage.branchRules.map((rule) => rule.nextStageKey === key ? { ...rule, nextStageKey: replacement } : rule),
    parallelTargetStageKeys: stage.parallelTargetStageKeys.filter((target) => target !== key),
    joinRequiredStageKeys: stage.joinRequiredStageKeys.filter((target) => target !== key),
    sla: {
      ...stage.sla,
      ...(stage.sla.triggerStageKey === key ? { triggerStageKey: undefined } : {}),
      ...(stage.sla.conditional && !("field" in stage.sla.conditional) && stage.sla.conditional.decisionStageKey === key ? { conditional: undefined } : {}),
    },
  }));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Turns an untrusted JSON definition (from the browser or the model) into a
 * normalized definition, or null when its basic shape is wrong. Field-level
 * correctness is then judged by `validateFmsDefinition`, never assumed.
 */
export function coerceFmsDefinition(raw: unknown, maxStages = 120): FmsFlowDefinition | null {
  if (!isRecord(raw) || typeof raw.name !== "string" || !Array.isArray(raw.stages) || raw.stages.length > maxStages) return null;
  if (!["tenant", "branch", "department"].includes(String(raw.scope ?? "tenant"))) return null;
  for (const stage of raw.stages) {
    if (!isRecord(stage) || typeof stage.key !== "string" || typeof stage.name !== "string" || !FMS_STAGE_TYPES.includes(stage.type as never)) return null;
    for (const list of ["checklist", "assigneeRules", "branchRules", "parallelTargetStageKeys", "joinRequiredStageKeys"]) if (stage[list] !== undefined && !Array.isArray(stage[list])) return null;
    if (stage.sla !== undefined && !isRecord(stage.sla)) return null;
    if (!Array.isArray(stage.branchRules ?? []) || (stage.branchRules as unknown[] ?? []).some((rule) => !isRecord(rule))) return null;
    if ((stage.assigneeRules as unknown[] ?? []).some((rule) => !isRecord(rule))) return null;
  }
  try {
    return normalizeFmsDefinition({
      ...(raw as unknown as FmsFlowDefinition),
      assignmentVersion: raw.assignmentVersion === 2 ? 2 : raw.assignmentVersion === 1 ? 1 : undefined,
      scope: (raw.scope ?? "tenant") as FmsFlowDefinition["scope"],
      manualTrigger: true,
      stages: (raw.stages as Record<string, unknown>[]).map((stage, order) => ({
        ...(stage as unknown as FmsStageDefinition),
        order: Number.isFinite(stage.order) ? Number(stage.order) : order,
        checklist: (stage.checklist ?? []) as FmsStageDefinition["checklist"],
        assigneeRules: (stage.assigneeRules ?? []) as FmsStageDefinition["assigneeRules"],
        branchRules: (stage.branchRules ?? []) as FmsStageDefinition["branchRules"],
        parallelTargetStageKeys: (stage.parallelTargetStageKeys ?? []) as string[],
        joinRequiredStageKeys: (stage.joinRequiredStageKeys ?? []) as string[],
        sla: (stage.sla ?? { dueDate: "" }) as FmsStageDefinition["sla"],
      })),
    });
  } catch {
    return null;
  }
}

/** Matches a model-supplied answer to a stable option value: exact value first, then an unambiguous label. */
function resolveOptionValue(field: FmsFormFieldRef, supplied: string): Readonly<{ value?: string; note?: string }> {
  const options = fmsFieldOptions(field);
  if (!options.length) return { value: supplied };
  if (options.some((option) => option.value === supplied)) return { value: supplied };
  const byLabel = options.filter((option) => option.label.trim().toLowerCase() === supplied.trim().toLowerCase());
  if (byLabel.length === 1) return { value: byLabel[0]!.value, note: `Answer "${supplied}" of "${field.label}" was matched to its stored value "${byLabel[0]!.value}".` };
  return {};
}

/**
 * Applies typed AI edit operations to a definition, all-or-nothing. Unchanged
 * stages keep every field (including canvas positions). Every reference to a
 * person, Form, question, option, or step must resolve exactly in the catalog
 * or the draft; nothing is guessed.
 */
export function applyFmsAiOperations(base: FmsFlowDefinition, operations: readonly FmsAiOperation[], catalog: FmsAiCatalog, newId: () => string): FmsAiApplyResult {
  const errors: FmsAiValidationIssue[] = [];
  const notes: string[] = [];
  if (operations.length > FMS_AI_LIMITS.maxOperations) return { ok: false, errors: [{ code: "too_many_operations", message: `At most ${FMS_AI_LIMITS.maxOperations} changes can be applied at once.` }] };
  let flow: FmsFlowDefinition = normalizeFmsDefinition(base);
  const startingCount = flow.stages.length;
  const activeUsers = new Map(catalog.users.filter((user) => user.active && user.loginEnabled).map((user) => [user.id, user]));
  const publishedForms = new Map(catalog.forms.filter((form) => form.lifecycle === "published").map((form) => [form.id, form]));

  operations.forEach((operation, index) => {
    const where = `Change ${index + 1} (${operation.op})`;
    const fail = (code: string, message: string, stageKey?: string | null) => errors.push({ code, message: `${where}: ${message}`, ...(stageKey ? { stageKey } : {}) });
    const stages = [...flow.stages];
    const find = (key: string | null | undefined) => key ? stages.find((stage) => stage.key === key) : undefined;
    const target = find(operation.stageKey);
    const replace = (stage: FmsStageDefinition) => { flow = { ...flow, stages: flow.stages.map((item) => item.key === stage.key ? stage : item) }; };
    const needTarget = (): FmsStageDefinition | undefined => { if (!target) fail("unknown_stage", operation.stageKey ? `step "${operation.stageKey}" does not exist` : "a step key is required", operation.stageKey); return target; };
    const user = (id: string | null | undefined, label: string): string | undefined => {
      if (!id || !UUID.test(id) || !activeUsers.has(id)) { fail("unknown_employee", `${label} must be an active employee from the directory (got "${id ?? ""}"). Ask the user who should do this instead of guessing.`, operation.stageKey); return undefined; }
      return id;
    };

    switch (operation.op) {
      case "set_workflow_details": {
        const name = operation.name?.trim();
        if (name !== undefined && name !== null && (!name || name.length > 150)) fail("invalid_name", "the workflow name must be 1 to 150 characters");
        flow = { ...flow, ...(name ? { name } : {}), ...(operation.workflowDescription !== null ? { description: operation.workflowDescription } : {}) };
        break;
      }
      case "add_stage": {
        const key = operation.stageKey;
        const type = operation.stageType;
        if (!key || !KEY.test(key)) { fail("invalid_stage_key", "a new step needs a stable key such as review_order"); break; }
        if (find(key)) { fail("duplicate_stage_key", `step "${key}" already exists`, key); break; }
        if (!type) { fail("invalid_stage", "a new step needs a step type", key); break; }
        if (!stages.length && type !== "form") { fail("first_stage_must_be_form", "every workflow starts with a Form step", key); break; }
        if (stages.length >= Math.max(FMS_AI_LIMITS.maxStages, startingCount)) { fail("too_many_stages", `a workflow built here can have at most ${FMS_AI_LIMITS.maxStages} steps`, key); break; }
        const sourceIndex = operation.afterStageKey ? stages.findIndex((stage) => stage.key === operation.afterStageKey) : -1;
        if (operation.afterStageKey && sourceIndex < 0) { fail("unknown_stage", `step "${operation.afterStageKey}" does not exist`, operation.afterStageKey); break; }
        const source = sourceIndex >= 0 ? stages[sourceIndex] : undefined;
        const template = fmsStageTemplate(type, stages.length, newId);
        let stage: FmsStageDefinition = { ...template, key, name: operation.name?.trim() || (type === "form" && !stages.length ? "Start form" : template.name) };
        if (flow.assignmentVersion === 2) stage = { ...stage, sla: { ...stage.sla, assignment: suggestFmsAssignment(source ?? stages.at(-1), catalog.formFields) } };
        if (operation.instructions) stage = { ...stage, sla: { ...stage.sla, taskDisplay: { fields: [], instructions: operation.instructions } } };
        // "Add after" mirrors the builder: the new step takes over the source's next step.
        if (source && source.type !== "branch" && source.type !== "parallel_start") {
          stage = source.defaultNextStageKey ? { ...stage, defaultNextStageKey: source.defaultNextStageKey } : stage;
          stages[sourceIndex] = { ...source, defaultNextStageKey: key };
          stages.splice(sourceIndex + 1, 0, stage);
        } else stages.push(stage);
        flow = { ...flow, stages: stages.map((item, order) => ({ ...item, order })) };
        break;
      }
      case "update_stage": {
        const stage = needTarget(); if (!stage) break;
        if (operation.stageType && operation.stageType !== stage.type) { fail("type_change_not_supported", "change a step's type by removing it and adding a new step", stage.key); break; }
        replace({
          ...stage,
          ...(operation.name ? { name: operation.name.trim() } : {}),
          ...(operation.requiresUpload !== null ? { requiresUpload: operation.requiresUpload } : {}),
          ...(operation.requiresRemark !== null ? { requiresRemark: operation.requiresRemark } : {}),
          ...(operation.instructions ? { sla: { ...stage.sla, taskDisplay: { ...(stage.sla.taskDisplay ?? { fields: [] }), instructions: operation.instructions } } } : {}),
        });
        break;
      }
      case "remove_stage": {
        const stage = needTarget(); if (!stage) break;
        if (flow.stages[0]?.key === stage.key) { fail("cannot_remove_trigger", "the first Form starts the workflow and cannot be removed", stage.key); break; }
        flow = { ...flow, stages: removeFmsStageFromStages(flow.stages, stage.key).map((item, order) => ({ ...item, order })) };
        break;
      }
      case "set_next": {
        const stage = needTarget(); if (!stage) break;
        if (stage.type === "branch" || stage.type === "parallel_start") { fail("invalid_next", "use add_route for a branch and set_parallel for a parallel start", stage.key); break; }
        if (operation.nextStageKey && !find(operation.nextStageKey)) { fail("unknown_stage", `step "${operation.nextStageKey}" does not exist`, stage.key); break; }
        if (operation.nextStageKey === stage.key) { fail("self_route", "a step cannot continue to itself", stage.key); break; }
        const next = operation.nextStageKey ?? undefined;
        replace({ ...stage, defaultNextStageKey: next, branchRules: stage.branchRules.map((rule) => rule.operator === "default" ? { ...rule, nextStageKey: next } : rule) });
        break;
      }
      case "clear_routes": {
        const stage = needTarget(); if (!stage) break;
        replace({ ...stage, branchRules: stage.type === "branch" ? stage.branchRules.filter((rule) => rule.operator === "default") : [] });
        break;
      }
      case "add_route": {
        const stage = needTarget(); if (!stage) break;
        const route = operation.route;
        if (!route) { fail("invalid_route", "a route is required", stage.key); break; }
        if (!find(route.targetStageKey)) { fail("unknown_stage", `route target "${route.targetStageKey}" does not exist`, stage.key); break; }
        if (stage.type === "parallel_start" || stage.type === "parallel_join") { fail("invalid_route", "parallel steps do not take routes", stage.key); break; }
        let value: unknown;
        let sourceKey: string | undefined;
        if (route.operator !== "default") {
          if (route.source === "form_answer") {
            const fields = stage.formTemplateId ? catalog.formFields[stage.formTemplateId] : undefined;
            if (!stage.formTemplateId || !fields) { fail("route_without_form", "routing on an answer needs a published Form linked to this step first", stage.key); break; }
            const field = fields.find((item) => item.key === route.questionKey) ?? fields.filter((item) => item.label.trim().toLowerCase() === (route.questionKey ?? "").trim().toLowerCase()).at(0);
            if (!field) { fail("unknown_question", `question "${route.questionKey ?? ""}" is not in the linked Form`, stage.key); break; }
            if (field.key !== route.questionKey) notes.push(`Question "${route.questionKey}" was matched to its stable key "${field.key}".`);
            sourceKey = field.key;
            const resolved: string[] = [];
            for (const supplied of route.values) {
              const match = resolveOptionValue(field, supplied);
              if (!match.value) { fail("unknown_option", `"${supplied}" is not an answer offered by "${field.label}"`, stage.key); continue; }
              resolved.push(match.value); if (match.note) notes.push(match.note);
            }
            if (route.operator !== "not_empty" && !resolved.length) { if (!route.values.length) fail("invalid_route_value", "the route needs the answer it matches", stage.key); break; }
            value = route.operator === "in" ? resolved : resolved[0];
          } else {
            if (stage.sla.decisionMode !== "yes_no" || !stage.sla.decisionOptions?.length) { fail("route_without_decision", "routing on an outcome needs decision options on this step first", stage.key); break; }
            const supplied = route.values[0] ?? "";
            const option = stage.sla.decisionOptions.find((item) => item.key === supplied) ?? stage.sla.decisionOptions.find((item) => item.label.trim().toLowerCase() === supplied.trim().toLowerCase());
            if (!option) { fail("unknown_option", `"${supplied}" is not one of this step's decision options`, stage.key); break; }
            value = option.key;
          }
        }
        const rules = [...stage.branchRules].sort((a, b) => a.order - b.order);
        const fallback = rules.find((rule) => rule.operator === "default");
        const others = rules.filter((rule) => rule.operator !== "default");
        let next: FmsBranchRule[];
        if (route.operator === "default") {
          next = [...others, { id: fallback?.id ?? newId(), source: "outcome", operator: "default", nextStageKey: route.targetStageKey, order: 0, ...(route.label ? { label: route.label } : {}) }];
        } else {
          const rule: FmsBranchRule = { id: newId(), source: route.source, ...(sourceKey ? { sourceKey } : {}), operator: route.operator, ...(value !== undefined ? { value } : {}), nextStageKey: route.targetStageKey, order: 0, ...(route.label ? { label: route.label } : {}) };
          next = [...others, rule, ...(fallback ? [fallback] : [])];
        }
        replace({ ...stage, branchRules: next.map((rule, order) => ({ ...rule, order })) });
        break;
      }
      case "set_assignment": {
        const stage = needTarget(); if (!stage) break;
        if (!HUMAN.has(stage.type)) { fail("assignment_on_automatic_step", "automatic steps have no employee", stage.key); break; }
        const spec = operation.assignment;
        if (!spec) { fail("invalid_assignment", "an assignment is required", stage.key); break; }
        const compiled = compileAssignment(stage, spec, flow, catalog, user, (code, message) => fail(code, message, stage.key));
        if (compiled) replace(compiled);
        break;
      }
      case "link_form": {
        const stage = needTarget(); if (!stage) break;
        if (!HUMAN.has(stage.type)) { fail("form_on_automatic_step", "only Form, Task and Approval steps can link a Form", stage.key); break; }
        const id = operation.formTemplateId ?? "";
        const form = publishedForms.get(id);
        if (!UUID.test(id) || !form) { fail("unknown_form", `Form "${id}" is not a published Form you can use. If it does not exist yet, it must be created and published first.`, stage.key); break; }
        replace({ ...stage, formTemplateId: form.id });
        break;
      }
      case "set_timing": {
        const stage = needTarget(); if (!stage) break;
        const timing = operation.timing;
        if (!timing) { fail("invalid_deadline", "timing is required", stage.key); break; }
        if (timing.method === "none") { replace({ ...stage, sla: { ...stage.sla, deadlineEnabled: false } }); break; }
        const minutes = Math.round((timing.hours ?? 0) * 60 + (timing.minutes ?? 0));
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525600) { fail("invalid_deadline", "a turnaround time must be between 1 minute and 8,760 hours", stage.key); break; }
        replace({ ...stage, sla: { ...stage.sla, deadlineEnabled: true, timingMethod: "tat_hours", tatMinutes: minutes, tatHours: minutes / 60, tatUnit: minutes % 60 === 0 ? "hours" : "minutes" } });
        break;
      }
      case "set_decision_options": {
        const stage = needTarget(); if (!stage) break;
        const options = operation.decisionOptions ?? [];
        if (!options.length) { replace({ ...stage, sla: { ...stage.sla, decisionMode: "normal", decisionOptions: undefined } }); break; }
        if (!HUMAN.has(stage.type) || flow.stages[0]?.key === stage.key) { fail("invalid_decision", "decision options belong on human steps after the starting Form", stage.key); break; }
        if (new Set(options.map((option) => option.key)).size !== options.length) { fail("invalid_decision", "decision option keys must be unique", stage.key); break; }
        replace({ ...stage, sla: { ...stage.sla, decisionMode: "yes_no", decisionOptions: options } });
        break;
      }
      case "set_checklist": {
        const stage = needTarget(); if (!stage) break;
        const used = new Set<string>();
        const checklist = (operation.checklist ?? []).map((item, position) => {
          const base = item.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "item_$1").slice(0, 50) || `item_${position + 1}`;
          let key = /^[a-z]/.test(base) ? base : `item_${base}`; let n = 2;
          while (used.has(key)) key = `${base}_${n++}`;
          used.add(key);
          return { key, label: item.label, required: item.required };
        });
        replace({ ...stage, checklist });
        break;
      }
      case "set_follow_up": {
        const stage = needTarget(); if (!stage) break;
        const followUp = operation.followUp;
        if (followUp && (followUp.maxVisits < 1 || followUp.maxVisits > 50)) { fail("invalid_visit_limit", "a visit limit must be between 1 and 50", stage.key); break; }
        replace({ ...stage, sla: { ...stage.sla, followUp: followUp ?? undefined } });
        break;
      }
      case "set_parallel": {
        const stage = needTarget(); if (!stage) break;
        if (stage.type === "parallel_start") {
          const targets = operation.parallelTargets ?? [];
          const missing = targets.filter((key) => !find(key));
          if (targets.length < 2 || missing.length) { fail("invalid_parallel", missing.length ? `unknown targets: ${missing.join(", ")}` : "a parallel start needs at least two targets", stage.key); break; }
          replace({ ...stage, parallelTargetStageKeys: targets });
        } else if (stage.type === "parallel_join") {
          if (!operation.joinRule) { fail("invalid_join", "choose all or any", stage.key); break; }
          replace({ ...stage, joinRule: operation.joinRule, joinRequiredStageKeys: [] });
        } else fail("invalid_parallel", "only parallel steps take parallel settings", stage.key);
        break;
      }
    }
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, definition: normalizeFmsDefinition(flow), notes: [...new Set(notes)] };
}

function compileAssignment(stage: FmsStageDefinition, spec: FmsAiAssignment, flow: FmsFlowDefinition, catalog: FmsAiCatalog, user: (id: string | null | undefined, label: string) => string | undefined, fail: (code: string, message: string) => void): FmsStageDefinition | undefined {
  const fallbackRule = (): FmsAssigneeRule | undefined | null => {
    switch (spec.fallback) {
      case "none": return undefined;
      case "starter": return { type: "reporter" };
      case "previous_step_doer": return { type: "previous_step_doer" };
      case "specific_employee": { const id = user(spec.fallbackEmployeeId, "The fallback employee"); return id ? { type: "specific_user", userProfileId: id } : null; }
    }
  };
  if (flow.assignmentVersion !== 2) {
    if (spec.mode !== "fixed_employee") { fail("legacy_assignment_contract", "this draft uses the legacy assignment contract; upgrade it in the builder before using assignment strategies"); return undefined; }
    const ids = spec.employeeIds.map((id) => user(id, "The employee"));
    if (!ids.length || ids.some((id) => !id)) { if (!ids.length) fail("unknown_employee", "choose at least one employee"); return undefined; }
    return { ...stage, assigneeRules: ids.map((id) => ({ type: "specific_user" as const, userProfileId: id! })), allowMultipleDoers: ids.length > 1 || stage.allowMultipleDoers };
  }
  const fallback = fallbackRule();
  if (fallback === null) return undefined;
  const config = (mode: FmsAssignmentConfig["mode"], extra: Partial<FmsAssignmentConfig> = {}): FmsAssignmentConfig => ({ mode, sources: [], allowHandoff: spec.allowHandoff, ...(fallback ? { fallbackRule: fallback } : {}), ...extra });
  switch (spec.mode) {
    case "fixed_employee": {
      const ids = spec.employeeIds.map((id) => user(id, "The employee"));
      if (!ids.length) { fail("unknown_employee", "choose at least one employee; ask the user if it is unclear"); return undefined; }
      if (ids.some((id) => !id)) return undefined;
      return { ...stage, assigneeRules: ids.map((id) => ({ type: "specific_user" as const, userProfileId: id! })), allowMultipleDoers: ids.length > 1 || stage.allowMultipleDoers, sla: { ...stage.sla, assignment: { mode: "fixed_employee", sources: [], allowHandoff: false } } };
    }
    case "previous_form": {
      if (spec.followFormAssignee && !spec.sourceStageKey) return { ...stage, sla: { ...stage.sla, assignment: config("previous_form", { followFormAssignee: true, fallbackRule: fallback ?? { type: "previous_step_doer" } }) } };
      const source = flow.stages.find((item) => item.key === spec.sourceStageKey);
      if (!source || !source.formTemplateId) { fail("invalid_assignment_source", "the assignment source must be an earlier step with a linked Form"); return undefined; }
      const fields = catalog.formFields[source.formTemplateId] ?? [];
      const field = fields.find((item) => item.key === spec.questionKey) ?? fields.find((item) => item.label.trim().toLowerCase() === (spec.questionKey ?? "").trim().toLowerCase());
      if (!field || field.type !== "user_dropdown") { fail("invalid_assignment_source", `"${spec.questionKey ?? ""}" is not an employee question in ${source.name}'s Form`); return undefined; }
      return { ...stage, sla: { ...stage.sla, assignment: config("previous_form", { sources: [{ sourceStageKey: source.key, formTemplateId: source.formTemplateId, fieldKey: field.key }] }) } };
    }
    case "previous_stage_employee": return { ...stage, sla: { ...stage.sla, assignment: config("previous_stage_employee") } };
    case "manual_handoff": return { ...stage, sla: { ...stage.sla, assignment: config("manual_handoff", { allowHandoff: true }) } };
    case "hierarchy": {
      const hierarchy = spec.hierarchy ?? "manager";
      if (hierarchy === "role" && !USER_ROLES.includes(spec.role as UserRole)) { fail("invalid_assignee", `"${spec.role ?? ""}" is not a JewelOS role`); return undefined; }
      const rule: FmsAssigneeRule = hierarchy === "role" ? { type: "role", role: spec.role as UserRole } : { type: hierarchy };
      return { ...stage, assigneeRules: [rule], sla: { ...stage.sla, assignment: config("hierarchy") } };
    }
  }
}

/**
 * A Form the assistant proposed, as an ordinary Form draft definition. The
 * author creates the draft explicitly, then reviews and publishes it in Forms;
 * nothing is created or published here. Validate with `validateFormDefinition`.
 */
export function fmsAiFormSpecToDefinition(spec: FmsAiFormSpec): FormTemplateDefinition {
  return {
    name: spec.name,
    description: spec.purpose,
    permissions: { roles: [] },
    fields: spec.fields.map((field, sortOrder) => ({
      key: field.key, label: field.label, type: field.type, sortOrder, required: field.required, shown: true,
      ...(field.options.length && ["select", "radio", "multiselect", "checkbox"].includes(field.type) ? { options: field.options.map((option) => ({ value: option.value, label: option.label })) } : {}),
    })),
  };
}

/**
 * Route ids for one compiled proposal, derived from the request id so the
 * Edge Function and the browser compile byte-identical definitions (and the
 * same fingerprint). The ids are UUID-shaped like the builder's own route ids;
 * a new request id gives new ids.
 */
export function fmsAiIdFactory(seed: string): () => string {
  let counter = 0;
  const lane = (text: string, salt: number) => {
    let h = 0x811c9dc5 ^ salt;
    for (let index = 0; index < text.length; index += 1) h = Math.imul(h ^ text.charCodeAt(index), 16777619);
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  return () => {
    counter += 1;
    const text = `${seed}#${counter}`;
    const hex = [1, 2, 3, 4].map((salt) => lane(text, salt * 0x9e3779b1)).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
}
