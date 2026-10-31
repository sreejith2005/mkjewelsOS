import { FORM_CONTINUE_TARGET, FORM_QUESTION_TARGET_PREFIX, FORM_STAGE_END_TARGET, fieldsInSection, formSections } from "./sections.ts";
import { filterFormRule, formRuleFieldKeys, pruneFormRules } from "./rules.ts";
import { FORM_SUBMIT_TARGET, type FormBranch, type FormRule, type FormFieldDefinition, type FormSectionDefinition, type FormTemplateDefinition } from "./types.ts";

/**
 * Copying one Section of a Form into another Form, as an editable copy. Used
 * when an FMS step imports a section into its own questionnaire. The source
 * Form is never changed; the copy gets collision-free question and section
 * keys, keeps visibility rules between its own questions, and reports — before
 * anything is imported — every rule that reads a question outside the section,
 * because that part of the condition cannot come along.
 */

export type FormSectionDependency = Readonly<{ fieldKey: string; label: string; dependsOn: readonly Readonly<{ key: string; label: string }>[] }>;
export type FormSectionImportPlan = Readonly<{
  sectionKey: string;
  title: string;
  questions: readonly Readonly<{ key: string; label: string; type: FormFieldDefinition["type"]; required: boolean }>[];
  /** Visibility, route, or section conditions that read outside the copied section. */
  externalDependencies: readonly FormSectionDependency[];
  /** Routes with external destinations or conditions, and external section end actions, are dropped. */
  droppedJumps: number;
}>;

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const TERMINAL_TARGETS: ReadonlySet<string> = new Set([FORM_SUBMIT_TARGET, FORM_STAGE_END_TARGET, FORM_CONTINUE_TARGET]);

function retainedBranch(branch: FormBranch, inside: ReadonlySet<string>): boolean {
  const target = branch.targetSectionKey;
  return (TERMINAL_TARGETS.has(target) || target.startsWith(FORM_QUESTION_TARGET_PREFIX) && inside.has(target.slice(FORM_QUESTION_TARGET_PREFIX.length)))
    && formRuleFieldKeys(branch.rule).every(key => inside.has(key));
}

/** Map each original key exactly once, including when generated keys collide with other source keys. */
function remapRule(rule: FormRule | undefined, keyMap: ReadonlyMap<string, string>): FormRule | undefined {
  if (!rule) return undefined;
  return rule.kind === "predicate" ? { ...rule, fieldKey: keyMap.get(rule.fieldKey) ?? rule.fieldKey }
    : { ...rule, rules: rule.rules.map(child => remapRule(child, keyMap)!) };
}

function uniqueKey(base: string, used: Set<string>, fallback: string): string {
  const root = (KEY.test(base) ? base : fallback).slice(0, 58);
  let candidate = root;
  for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${root}_${suffix}`;
  used.add(candidate);
  return candidate;
}

function conditionKeys(field: FormFieldDefinition): readonly string[] {
  return [...formRuleFieldKeys(field.rule), ...(field.condition ? [field.condition.fieldKey] : [])];
}

/** What importing a section would bring across, so the author can decide before anything changes. */
export function planFormSectionImport(source: FormTemplateDefinition, sectionKey: string): FormSectionImportPlan | undefined {
  const section = formSections(source).find((item) => item.key === sectionKey);
  if (!section) return undefined;
  const fields = fieldsInSection(source, sectionKey);
  const inside = new Set(fields.map((field) => field.key));
  const labelOf = (key: string) => source.fields.find((field) => field.key === key)?.label || key;
  return {
    sectionKey, title: section.title,
    questions: fields.filter((field) => field.type !== "section_header" && field.type !== "divider").map((field) => ({ key: field.key, label: field.label, type: field.type, required: field.required === true })),
    externalDependencies: [...fields.flatMap((field) => {
      const outside = [...new Set([...conditionKeys(field), ...(field.branches ?? []).flatMap(branch => formRuleFieldKeys(branch.rule))].filter((key) => !inside.has(key)))];
      return outside.length ? [{ fieldKey: field.key, label: field.label || field.key, dependsOn: outside.map((key) => ({ key, label: labelOf(key) })) }] : [];
    }), ...(() => {
      const outside = [...new Set(formRuleFieldKeys(section.rule).filter(key => !inside.has(key)))];
      return outside.length ? [{ fieldKey: section.key, label: section.title, dependsOn: outside.map(key => ({ key, label: labelOf(key) })) }] : [];
    })()],
    droppedJumps: fields.reduce((count, field) => count + (field.branches ?? []).filter(branch => !retainedBranch(branch, inside)).length, 0) + (section.next && !TERMINAL_TARGETS.has(section.next) ? 1 : 0),
  };
}

/**
 * Appends a copy of `sectionKey` from `source` to `target` as a new section.
 * A target that is still the empty starter section is replaced, not appended to.
 */
export function importFormSectionCopy(target: FormTemplateDefinition, source: FormTemplateDefinition, sectionKey: string): Readonly<{ definition: FormTemplateDefinition; sectionKey: string; keyMap: ReadonlyMap<string, string>; plan: FormSectionImportPlan }> | undefined {
  const plan = planFormSectionImport(source, sectionKey);
  const section = formSections(source).find((item) => item.key === sectionKey);
  if (!plan || !section) return undefined;
  const emptyStarter = target.fields.length === 0;
  const keptSections: readonly FormSectionDefinition[] = emptyStarter ? [] : formSections(target);
  const usedSections = new Set(keptSections.map((item) => item.key));
  const newSectionKey = uniqueKey(section.key, usedSections, "section");
  const usedFields = new Set(target.fields.map((field) => field.key));
  const sourceFields = fieldsInSection(source, sectionKey);
  const keyMap = new Map(sourceFields.map((field) => [field.key, uniqueKey(field.key, usedFields, "field")]));
  const inside = (key: string) => keyMap.has(key);
  const insideKeys = new Set(keyMap.keys());
  const copied = sourceFields.map(({ id: _id, ...field }): FormFieldDefinition => {
    const rule = remapRule(filterFormRule(field.rule, inside), keyMap);
    const condition = field.condition && inside(field.condition.fieldKey) ? { ...field.condition, fieldKey: keyMap.get(field.condition.fieldKey)! } : undefined;
    // A route condition is atomic: pruning an external predicate could broaden it.
    const branches = (field.branches ?? []).filter(branch => retainedBranch(branch, insideKeys)).map(branch => ({
      ...branch,
      ...(branch.rule ? { rule: remapRule(branch.rule, keyMap) } : {}),
      targetSectionKey: branch.targetSectionKey.startsWith(FORM_QUESTION_TARGET_PREFIX)
        ? FORM_QUESTION_TARGET_PREFIX + keyMap.get(branch.targetSectionKey.slice(FORM_QUESTION_TARGET_PREFIX.length))!
        : branch.targetSectionKey,
    }));
    const { rule: _rule, condition: _condition, branches: _branches, ...rest } = field;
    return { ...rest, key: keyMap.get(field.key)!, sectionKey: newSectionKey, ...(rule ? { rule } : {}), ...(condition ? { condition } : {}), ...(branches.length ? { branches } : {}) };
  });
  const { next: _next, rule: _sectionRule, visibility: _visibility, ...copiedSection } = section;
  const definition: FormTemplateDefinition = {
    ...target,
    sections: [...keptSections, { ...copiedSection, key: newSectionKey, ...(section.next && TERMINAL_TARGETS.has(section.next) ? { next: section.next } : {}) }],
    fields: pruneFormRules([...target.fields, ...copied].map((field, sortOrder) => ({ ...field, sortOrder }))),
  };
  return { definition, sectionKey: newSectionKey, keyMap, plan };
}
