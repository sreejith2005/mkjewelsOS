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

/**
 * Ordered comparison works on numbers and on strings that sort correctly, which
 * covers the ISO `date`/`datetime` answers the builder offers these operators for.
 * Returns undefined when the two sides cannot be ordered against each other.
 */
function compare(source: unknown, expected: unknown): number | undefined {
  const left = typeof source === "string" && source.trim() !== "" && Number.isFinite(Number(source)) ? Number(source) : source;
  const right = typeof expected === "string" && expected.trim() !== "" && Number.isFinite(Number(expected)) ? Number(expected) : expected;
  if (typeof left === "number" && typeof right === "number" && Number.isFinite(left) && Number.isFinite(right)) return left < right ? -1 : left > right ? 1 : 0;
  if (typeof left === "string" && typeof right === "string") return left < right ? -1 : left > right ? 1 : 0;
  return undefined;
}

function ordered(source: unknown, expected: unknown, accept: (result: number) => boolean): boolean {
  const result = compare(source, expected);
  return result !== undefined && accept(result);
}

function isOneOf(value: unknown, expected: unknown): boolean {
  const candidates = Array.isArray(expected) ? expected : [expected];
  if (Array.isArray(value)) return value.some((item) => candidates.some((candidate) => candidate === item));
  return candidates.some((candidate) => candidate === value);
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
    case "greater_than": return ordered(source, predicate.value, (result) => result > 0);
    case "less_than": return ordered(source, predicate.value, (result) => result < 0);
    case "greater_than_or_equal": return ordered(source, predicate.value, (result) => result >= 0);
    case "less_than_or_equal": return ordered(source, predicate.value, (result) => result <= 0);
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
