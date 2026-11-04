import { evaluateFormNavigation } from "./sections.ts";
import type { FormAnswer, FormAnswers, FormFieldDefinition, FormTemplateDefinition } from "./types.ts";
import { isEmptyFormValue, isFormFieldVisible } from "./visibility.ts";
import { formRepeatRowCount, isFormCrmFilesAnswer, isFormRepeatAnswer } from "./structuredAnswers.ts";

export function normalizeFormAnswer(field: FormFieldDefinition, value: FormAnswer): FormAnswer {
  if (typeof value === "string") {
    const normalized = value.trim();
    if ((field.type === "number" || field.type === "currency" || field.type === "rating") && normalized !== "") return Number(normalized);
    return normalized;
  }
  if (isFormRepeatAnswer(value)) {
    const size = formRepeatRowCount(value);
    return Object.freeze({ kind: "repeat", count: value.count, rows: value.rows.slice(0, size).map((row) => Object.freeze(Object.fromEntries(Object.entries(row).map(([key, text]) => [key, text.trim()])))) });
  }
  if (isFormCrmFilesAnswer(value)) return value;
  if (Array.isArray(value)) return Object.freeze([...new Set((value as readonly string[]).map((item) => item.trim()).filter(Boolean))]);
  return value;
}

export function normalizeFormAnswers(template: FormTemplateDefinition, answers: FormAnswers): FormAnswers {
  const normalized: Record<string, FormAnswer> = {};
  const active = new Set(evaluateFormNavigation(template, answers).visibleFields.map(f => f.key));
  for (const field of [...template.fields].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const value = answers[field.key];
    if (!active.has(field.key) || !isFormFieldVisible(field, normalized) || isEmptyFormValue(value) || field.type === "section_header" || field.type === "divider") continue;
    const normalizedValue = normalizeFormAnswer(field, value as FormAnswer);
    if (isEmptyFormValue(normalizedValue)) continue;
    normalized[field.key] = normalizedValue;
  }
  return Object.freeze(normalized);
}
