import { normalizeFormAnswer } from "./answers.ts";
import { FORM_SUBMIT_TARGET, type FormAnswers, type FormBranch, type FormFieldDefinition, type FormSectionDefinition, type FormTemplateDefinition } from "./types.ts";
import { evaluateFormRule, isEmptyFormValue, isFormFieldVisible } from "./visibility.ts";

/** Section every field belongs to when a form was authored before sections existed. */
export const DEFAULT_SECTION_KEY = "section_1";

export function formSections(definition: FormTemplateDefinition): readonly FormSectionDefinition[] {
  const sections = definition.sections ?? [];
  return sections.length ? sections : [{ key: DEFAULT_SECTION_KEY, title: definition.name || "Questions" }];
}

/** Unknown or missing section keys fall back to the first section, never to nothing. */
export function fieldSectionKey(field: FormFieldDefinition, sections: readonly FormSectionDefinition[]): string {
  const first = sections[0]?.key ?? DEFAULT_SECTION_KEY;
  return field.sectionKey && sections.some((section) => section.key === field.sectionKey) ? field.sectionKey : first;
}

export function fieldsInSection(definition: FormTemplateDefinition, sectionKey: string): readonly FormFieldDefinition[] {
  const sections = formSections(definition);
  return [...definition.fields].sort((a, b) => a.sortOrder - b.sortOrder).filter((field) => fieldSectionKey(field, sections) === sectionKey);
}

export const FORM_QUESTION_TARGET_PREFIX = "__question__:";
export const FORM_CONTINUE_TARGET = "__continue__";
export const FORM_STAGE_END_TARGET = "__stage_end__";

export function formBranchMatches(field: FormFieldDefinition, branch: FormBranch, answers: FormAnswers): boolean {
  return branch.rule ? evaluateFormRule(branch.rule, answers) : branch.operator === "default" ||
    evaluateFormRule({ kind: "predicate", fieldKey: field.key, operator: branch.operator, value: branch.value }, answers);
}

export function formHasAdvancedRouting(definition: FormTemplateDefinition): boolean {
  return !!definition.sections?.some(s => s.visibility || s.rule || s.next?.startsWith(FORM_QUESTION_TARGET_PREFIX) || s.next === FORM_STAGE_END_TARGET || s.next === FORM_CONTINUE_TARGET) ||
    definition.fields.some(f => f.branches?.some(b => b.rule || b.operator === "default" || b.targetSectionKey.startsWith(FORM_QUESTION_TARGET_PREFIX)));
}

export function isFormSectionEligible(section: FormSectionDefinition, answers: FormAnswers, routed = false): boolean {
  if (section.visibility === "routed" && !routed) return false;
  if (!section.rule || section.visibility === "always") return true;
  return section.visibility === "unless" ? evaluateFormRule({ ...section.rule, negate: !section.rule.negate }, answers) : evaluateFormRule(section.rule, answers);
}

export type FormNavigationResult = Readonly<{
  visibleFields: readonly FormFieldDefinition[];
  eligibleSectionKeys: readonly string[];
  reachedSectionKeys: readonly string[];
  skippedSectionKeys: readonly string[];
  destination: string | undefined;
  submissionAllowed: boolean;
  endKind: "submit" | "stage_end" | "pending";
  issues: readonly import("./types").FormValidationIssue[];
  routes: readonly Readonly<{ fieldKey?: string; sectionKey: string; target: string; name?: string }>[];
}>;

/** One bounded walk drives rendering, validation, payload pruning and preview.
 * Old branches resolve at section end; new rules jump at their source question.
 * Only previously reached answers are available to conditions (never stale data).
 */
export function evaluateFormNavigation(definition: FormTemplateDefinition, answers: FormAnswers, currentSectionKey?: string, currentQuestionKey?: string): FormNavigationResult {
  const sections = formSections(definition);
  const visibleFields: FormFieldDefinition[] = [];
  const reached: string[] = [];
  const active: Record<string, import("./types").FormAnswer> = {};
  const issues: import("./types").FormValidationIssue[] = [];
  const routes: { fieldKey?: string; sectionKey: string; target: string; name?: string }[] = [];
  let si = 0; let startQuestion: string | undefined; let explicitlyRouted = false;
  let endKind: FormNavigationResult["endKind"] = "submit";
  let pending = false;
  let destination: string | undefined;
  const move = (target: string, sourceSection: number, sourceField?: FormFieldDefinition): boolean => {
    if (target === FORM_SUBMIT_TARGET || target === FORM_STAGE_END_TARGET) { endKind = target === FORM_STAGE_END_TARGET ? "stage_end" : "submit"; si = sections.length; return false; }
    const question = target.startsWith(FORM_QUESTION_TARGET_PREFIX) ? definition.fields.find(f => f.key === target.slice(FORM_QUESTION_TARGET_PREFIX.length)) : undefined;
    const sectionKey = question ? fieldSectionKey(question, sections) : target;
    const targetIndex = sections.findIndex(s => s.key === sectionKey);
    if (targetIndex < sourceSection || targetIndex === sourceSection && (!question || !sourceField || question.sortOrder <= sourceField.sortOrder) || targetIndex < 0 || target.startsWith(FORM_QUESTION_TARGET_PREFIX) && !question) {
      issues.push({ code: "invalid_route", fieldKey: sourceField?.key, message: "A route points to a missing or earlier destination." });
      pending = true; si = sections.length; return false;
    }
    si = targetIndex; startQuestion = question?.key; explicitlyRouted = true; return true;
  };
  // Every transition moves forward by section or question. The bound is also a
  // guard for malformed unsaved preview definitions.
  let budget = definition.fields.length + sections.length + 1;
  while (si < sections.length && budget-- > 0 && !pending) {
    const section = sections[si]!;
    if (!isFormSectionEligible(section, active, explicitlyRouted)) { si++; startQuestion = undefined; explicitlyRouted = false; continue; }
    if (!reached.includes(section.key)) reached.push(section.key);
    const fields = fieldsInSection(definition, section.key);
    const start = startQuestion ? fields.findIndex(f => f.key === startQuestion) : 0;
    startQuestion = undefined; explicitlyRouted = false;
    let legacyTarget: string | undefined; let undecided = false; let jumped = false; let continued = false;
    for (const field of fields.slice(Math.max(0, start))) {
      if (!isFormFieldVisible(field, active)) continue;
      visibleFields.push(field);
      const value = answers[field.key];
      if (value != null && !isEmptyFormValue(value)) active[field.key] = normalizeFormAnswer(field, value);
      const branches = field.branches ?? [];
      const advanced = branches.some(b => b.rule || b.operator === "default" || b.targetSectionKey.startsWith(FORM_QUESTION_TARGET_PREFIX));
      const match = branches.find(b => formBranchMatches(field, b, active));
      if (!advanced) {
        if (match) legacyTarget = match.targetSectionKey;
        else if (branches.length && isEmptyFormValue(value)) undecided = true;
        continue;
      }
      if (!match && branches.length && isEmptyFormValue(value)) { pending = true; endKind = "pending"; break; }
      if (!match) continue;
      if (match.targetSectionKey === FORM_CONTINUE_TARGET) { continued = true; routes.push({ fieldKey: field.key, sectionKey: section.key, target: FORM_CONTINUE_TARGET }); continue; }
      routes.push({ fieldKey: field.key, sectionKey: section.key, target: match.targetSectionKey, ...(match.name ? { name: match.name } : {}) });
      if (field.key === currentQuestionKey || section.key === currentSectionKey) destination = match.targetSectionKey;
      jumped = true; move(match.targetSectionKey, si, field); break;
    }
    if (pending) break;
    if (jumped) continue;
    if (undecided && !legacyTarget) { pending = true; endKind = "pending"; break; }
    const target = legacyTarget ?? (continued ? undefined : section.next);
    if (section.key === currentSectionKey) destination = target;
    if (!target || target === FORM_CONTINUE_TARGET) { si++; continue; }
    routes.push({ sectionKey: section.key, target });
    move(target, si, fields.at(-1));
  }
  if (budget < 0) issues.push({ code: "routing_cycle", message: "Routing did not terminate." });
  if (currentSectionKey && !destination) {
    const index = reached.indexOf(currentSectionKey);
    destination = reached[index + 1] ?? (!pending ? FORM_SUBMIT_TARGET : undefined);
  }
  return { visibleFields, eligibleSectionKeys: sections.filter(s => isFormSectionEligible(s, active, reached.includes(s.key))).map(s => s.key), reachedSectionKeys: reached,
    skippedSectionKeys: sections.filter(s => !reached.includes(s.key)).map(s => s.key), destination,
    submissionAllowed: !pending && !issues.length, endKind: pending ? "pending" : endKind, issues, routes };
}

export function reachableSectionKeys(definition: FormTemplateDefinition, answers: FormAnswers): ReadonlySet<string> {
  return new Set(evaluateFormNavigation(definition, answers).reachedSectionKeys);
}

export function isFormFieldActive(definition: FormTemplateDefinition, field: FormFieldDefinition, answers: FormAnswers, _reachable?: ReadonlySet<string>): boolean {
  return evaluateFormNavigation(definition, answers).visibleFields.some(f => f.key === field.key);
}

export function visibleFormSections(definition: FormTemplateDefinition, answers: FormAnswers): readonly Readonly<{ section: FormSectionDefinition; fields: readonly FormFieldDefinition[] }>[] {
  const path = evaluateFormNavigation(definition, answers);
  return path.reachedSectionKeys.map(key => ({ section: formSections(definition).find(s => s.key === key)!, fields: path.visibleFields.filter(f => fieldSectionKey(f, formSections(definition)) === key) }));
}

/**
 * The Form reduced to one section, for an FMS stage that asks only that part.
 * The section is the whole form here: no section navigation leads elsewhere, so
 * its questions keep their own visibility rules but never branch into the rest.
 * Returns undefined when the section is not part of this Form version.
 */
export function formDefinitionForSection(definition: FormTemplateDefinition, sectionKey: string): FormTemplateDefinition | undefined {
  const section = (definition.sections ?? []).find((item) => item.key === sectionKey);
  if (!section) return undefined;
  const { next: _next, rule: _rule, visibility: _visibility, ...only } = section;
  const keys = new Set(fieldsInSection(definition, sectionKey).map(f => f.key));
  return {
    ...definition,
    sections: [only],
    // Order stays the Form's own; numbering restarts so the section validates as a form.
    fields: fieldsInSection(definition, sectionKey).map(({ branches, ...field }, sortOrder) => {
      const internal = branches?.filter(b => (b.rule || b.operator === "default" || b.targetSectionKey.startsWith(FORM_QUESTION_TARGET_PREFIX)) &&
        (b.targetSectionKey === FORM_SUBMIT_TARGET || b.targetSectionKey === FORM_STAGE_END_TARGET || b.targetSectionKey === FORM_CONTINUE_TARGET || b.targetSectionKey.startsWith(FORM_QUESTION_TARGET_PREFIX) && keys.has(b.targetSectionKey.slice(FORM_QUESTION_TARGET_PREFIX.length))));
      return { ...field, sortOrder, ...(internal?.length ? { branches: internal } : {}) };
    }),
  };
}
