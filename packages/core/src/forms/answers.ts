import type { FormAnswer, FormAnswers, FormFieldDefinition, FormTemplateDefinition } from "./types";
import { isEmptyFormValue, isFormFieldVisible } from "./visibility";

function normalizeAnswer(field: FormFieldDefinition, value: FormAnswer): FormAnswer {
  if ((field.type === "number" || field.type === "currency" || field.type === "rating") && typeof value === "string") return Number(value);
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return Object.freeze([...new Set(value.map((item) => item.trim()).filter(Boolean))]);
  return value;
}

export function normalizeFormAnswers(template: FormTemplateDefinition, answers: FormAnswers): FormAnswers {
  const normalized: Record<string, FormAnswer> = {};
  for (const field of [...template.fields].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const value = answers[field.key];
    if (!isFormFieldVisible(field, answers) || isEmptyFormValue(value) || field.type === "section_header" || field.type === "divider") continue;
    normalized[field.key] = normalizeAnswer(field, value as FormAnswer);
  }
  return Object.freeze(normalized);
}
