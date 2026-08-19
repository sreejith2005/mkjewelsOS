import type { FormAnswers, FormCondition, FormFieldDefinition } from "./types";

export function isEmptyFormValue(value: unknown): boolean {
  return value === undefined || value === null || value === "" ||
    (Array.isArray(value) && value.length === 0);
}

function containsValue(source: unknown, expected: unknown): boolean {
  if (Array.isArray(source)) return source.some((value) => value === expected);
  return typeof source === "string" && typeof expected === "string" && source.includes(expected);
}

export function evaluateFormCondition(condition: FormCondition, answers: FormAnswers): boolean {
  const source = answers[condition.fieldKey];
  switch (condition.operator) {
    case "equals": return source === condition.value;
    case "not_equals": return source !== condition.value;
    case "contains": return containsValue(source, condition.value);
    case "not_empty": return !isEmptyFormValue(source);
  }
}

export function isFormFieldVisible(field: FormFieldDefinition, answers: FormAnswers): boolean {
  if (field.shown === false) return false;
  return field.condition ? evaluateFormCondition(field.condition, answers) : true;
}
