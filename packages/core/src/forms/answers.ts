import { fieldSectionKey, formSections, reachableSectionKeys } from "./sections";
import type { FormAnswer, FormAnswers, FormFieldDefinition, FormTemplateDefinition } from "./types";
import { isEmptyFormValue, isFormFieldVisible } from "./visibility";

export function normalizeFormAnswer(field: FormFieldDefinition, value: FormAnswer): FormAnswer {
  if (typeof value === "string") {
    const normalized = value.trim();
    if ((field.type === "number" || field.type === "currency" || field.type === "rating") && normalized !== "") return Number(normalized);
    return normalized;
  }
  if (Array.isArray(value)) return Object.freeze([...new Set(value.map((item) => item.trim()).filter(Boolean))]);
  return value;
}

export function normalizeFormAnswers(template: FormTemplateDefinition, answers: FormAnswers): FormAnswers {
  const normalized: Record<string, FormAnswer> = {};
  const sections = formSections(template);
  const reachable = reachableSectionKeys(template, answers);
  for (const field of [...template.fields].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const value = answers[field.key];
    if (!reachable.has(fieldSectionKey(field, sections)) || !isFormFieldVisible(field, normalized) || isEmptyFormValue(value) || field.type === "section_header" || field.type === "divider") continue;
    const normalizedValue = normalizeFormAnswer(field, value as FormAnswer);
    if (isEmptyFormValue(normalizedValue)) continue;
    normalized[field.key] = normalizedValue;
  }
  return Object.freeze(normalized);
}
