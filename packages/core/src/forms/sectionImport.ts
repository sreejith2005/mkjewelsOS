import { fieldsInSection, formSections } from "./sections.ts";
import { filterFormRule, formRuleFieldKeys, pruneFormRules, renameFormRuleField } from "./rules.ts";
import { FORM_SUBMIT_TARGET, type FormFieldDefinition, type FormSectionDefinition, type FormTemplateDefinition } from "./types.ts";

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
  /** Questions whose visibility reads a question outside the section; that part of the rule is dropped. */
  externalDependencies: readonly FormSectionDependency[];
  /** "Skip to another section" jumps that point outside the copy and are dropped. */
  droppedJumps: number;
}>;

const KEY = /^[a-z][a-z0-9_]{0,63}$/;

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
    externalDependencies: fields.flatMap((field) => {
      const outside = [...new Set(conditionKeys(field).filter((key) => !inside.has(key)))];
      return outside.length ? [{ fieldKey: field.key, label: field.label || field.key, dependsOn: outside.map((key) => ({ key, label: labelOf(key) })) }] : [];
    }),
    droppedJumps: fields.reduce((count, field) => count + (field.branches ?? []).filter((branch) => branch.targetSectionKey !== FORM_SUBMIT_TARGET).length, 0) + (section.next && section.next !== FORM_SUBMIT_TARGET ? 1 : 0),
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
  const copied = sourceFields.map(({ id: _id, ...field }): FormFieldDefinition => {
    let rule = filterFormRule(field.rule, inside);
    for (const [from, to] of keyMap) rule = renameFormRuleField(rule, from, to);
    const condition = field.condition && inside(field.condition.fieldKey) ? { ...field.condition, fieldKey: keyMap.get(field.condition.fieldKey)! } : undefined;
    const branches = (field.branches ?? []).filter((branch) => branch.targetSectionKey === FORM_SUBMIT_TARGET);
    const { rule: _rule, condition: _condition, branches: _branches, ...rest } = field;
    return { ...rest, key: keyMap.get(field.key)!, sectionKey: newSectionKey, ...(rule ? { rule } : {}), ...(condition ? { condition } : {}), ...(branches.length ? { branches } : {}) };
  });
  const { next: _next, ...copiedSection } = section;
  const definition: FormTemplateDefinition = {
    ...target,
    sections: [...keptSections, { ...copiedSection, key: newSectionKey, ...(section.next === FORM_SUBMIT_TARGET ? { next: FORM_SUBMIT_TARGET } : {}) }],
    fields: pruneFormRules([...target.fields, ...copied].map((field, sortOrder) => ({ ...field, sortOrder }))),
  };
  return { definition, sectionKey: newSectionKey, keyMap, plan };
}
