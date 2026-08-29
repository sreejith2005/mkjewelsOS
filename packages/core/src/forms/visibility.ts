import type { FormAnswers, FormCondition, FormFieldDefinition, FormRule, FormRulePredicate } from "./types";

export function isEmptyFormValue(value: unknown): boolean {
  return value === undefined || value === null || value === "" ||
    (Array.isArray(value) && value.length === 0);
}

function containsValue(source: unknown, expected: unknown): boolean {
  if (Array.isArray(source)) return source.some((value) => value === expected);
  return typeof source === "string" && typeof expected === "string" && source.includes(expected);
}

export function evaluateFormCondition(condition: FormCondition, answers: FormAnswers): boolean {
  return evaluateFormRule({ kind: "predicate", ...condition }, answers);
}

function comparable(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isOneOf(value: unknown, expected: unknown): boolean {
  return Array.isArray(expected) && expected.some((item) => item === value);
}

function evaluatePredicate(predicate: FormRulePredicate, answers: FormAnswers): boolean {
  const source = answers[predicate.fieldKey];
  switch (predicate.operator) {
    case "equals": return source === predicate.value;
    case "not_equals": return source !== predicate.value;
    case "contains": return containsValue(source, predicate.value);
    case "not_contains": return !containsValue(source, predicate.value);
    case "in": return isOneOf(source, predicate.value);
    case "not_in": return !isOneOf(source, predicate.value);
    case "not_empty": return !isEmptyFormValue(source);
    case "is_empty": return isEmptyFormValue(source);
    case "greater_than": return comparable(source) !== undefined && comparable(predicate.value)! < comparable(source)!;
    case "less_than": return comparable(source) !== undefined && comparable(predicate.value)! > comparable(source)!;
    case "greater_than_or_equal": return comparable(source) !== undefined && comparable(predicate.value)! <= comparable(source)!;
    case "less_than_or_equal": return comparable(source) !== undefined && comparable(predicate.value)! >= comparable(source)!;
  }
}

export function evaluateFormRule(rule: FormRule, answers: FormAnswers): boolean {
  if (rule.kind === "all") return rule.rules.every((child) => evaluateFormRule(child, answers));
  if (rule.kind === "any") return rule.rules.some((child) => evaluateFormRule(child, answers));
  return evaluatePredicate(rule as FormRulePredicate, answers);
}

export function isFormFieldVisible(field: FormFieldDefinition, answers: FormAnswers): boolean {
  if (field.shown === false) return false;
  return field.rule ? evaluateFormRule(field.rule, answers) : field.condition ? evaluateFormCondition(field.condition, answers) : true;
}
