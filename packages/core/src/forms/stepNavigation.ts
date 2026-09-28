import { visibleFormSections } from "./sections";
import { validateCompleteForm } from "./validation";
import type { FormAnswer, FormAnswers, FormTemplateDefinition, FormValidationResult } from "./types";

export function updateVisibleFormAnswers(definition: FormTemplateDefinition, answers: Readonly<Record<string, FormAnswer>>, key: string, value: FormAnswer, defaults: FormAnswers = {}): Record<string, FormAnswer> {
  const previousKeys = new Set(visibleFormSections(definition, answers).flatMap(({ fields }) => fields.map((field) => field.key)));
  const updated = { ...answers, [key]: value };
  const activeKeys = new Set(visibleFormSections(definition, updated).flatMap(({ fields }) => fields.map((field) => field.key)));
  const visible: Record<string, FormAnswer> = {};
  for (const [answerKey, answer] of Object.entries(updated)) if (activeKeys.has(answerKey)) visible[answerKey] = answer;
  for (const activeKey of activeKeys) {
    const initial = defaults[activeKey];
    if (!previousKeys.has(activeKey) && visible[activeKey] === undefined && initial != null) visible[activeKey] = initial;
  }
  return visible;
}

export function nextFormStepKey(definition: FormTemplateDefinition, answers: FormAnswers, currentKey: string): string | undefined {
  const sections = visibleFormSections(definition, answers);
  const index = sections.findIndex(({ section }) => section.key === currentKey);
  return index < 0 ? undefined : sections[index + 1]?.section.key;
}

export function previousFormStepKey(definition: FormTemplateDefinition, answers: FormAnswers, currentKey: string): string | undefined {
  const sections = visibleFormSections(definition, answers);
  const index = sections.findIndex(({ section }) => section.key === currentKey);
  return index > 0 ? sections[index - 1]?.section.key : undefined;
}

/** Required and conditional fields on future steps are checked when reached. */
export function validateFormStep(definition: FormTemplateDefinition, answers: FormAnswers, sectionKey: string): FormValidationResult {
  const fieldKeys = new Set(visibleFormSections(definition, answers).find(({ section }) => section.key === sectionKey)?.fields.map((field) => field.key) ?? []);
  const issues = validateCompleteForm(definition, answers).issues.filter((issue) => !issue.fieldKey || fieldKeys.has(issue.fieldKey));
  return { valid: issues.length === 0, issues };
}
