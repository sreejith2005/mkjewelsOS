import type { FormAnswer, FormFieldDefinition, FormRule, FormRuleOperator, FormRulePredicate, FormValidationIssue } from "./types";

/** Every operator a visibility rule may use, in the order the builder offers them. */
export const FORM_RULE_OPERATORS = [
  "equals", "not_equals", "contains", "not_contains", "in", "not_in",
  "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal",
  "not_empty", "is_empty",
] as const;

const OPERATORS: ReadonlySet<string> = new Set(FORM_RULE_OPERATORS);
/** Operators that read only whether an answer exists, so they carry no value. */
export const FORM_VALUELESS_OPERATORS: ReadonlySet<FormRuleOperator> = new Set(["not_empty", "is_empty"]);
/** Operators that compare against a list of answers rather than a single one. */
export const FORM_LIST_OPERATORS: ReadonlySet<FormRuleOperator> = new Set(["in", "not_in"]);

export const FORM_RULE_MAX_DEPTH = 3;
export const FORM_RULE_MAX_PREDICATES = 20;

export const FORM_OPERATOR_LABELS: Readonly<Record<FormRuleOperator, string>> = {
  equals: "is", not_equals: "is not", contains: "contains", not_contains: "does not contain",
  in: "is any of", not_in: "is none of", greater_than: "is greater than", greater_than_or_equal: "is at least",
  less_than: "is less than", less_than_or_equal: "is at most", not_empty: "is answered", is_empty: "is not answered",
};

/** Operators that make sense for the field the predicate reads, most useful first. */
export function operatorsForFieldType(type: FormFieldDefinition["type"]): readonly FormRuleOperator[] {
  switch (type) {
    case "number": case "currency": case "rating":
      return ["equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "not_empty", "is_empty"];
    case "date": case "datetime":
      return ["equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "not_empty", "is_empty"];
    case "select": case "radio": case "user_dropdown": case "branch_dropdown": case "department_dropdown":
      return ["equals", "not_equals", "in", "not_in", "not_empty", "is_empty"];
    case "multiselect":
      return ["contains", "not_contains", "in", "not_in", "not_empty", "is_empty"];
    case "checkbox":
      return ["equals", "not_equals"];
    default:
      return ["equals", "not_equals", "contains", "not_contains", "not_empty", "is_empty"];
  }
}

function scalar(value: unknown): FormAnswer | undefined {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return undefined;
}

/**
 * Rebuilds a rule tree into its canonical shape, dropping unusable predicates
 * and collapsing groups that end up with a single child. Returns undefined when
 * nothing usable is left, which is how "no condition" is stored.
 */
export function normalizeFormRule(rule: FormRule | undefined): FormRule | undefined {
  if (!rule || typeof rule !== "object") return undefined;
  if (rule.kind === "all" || rule.kind === "any") {
    const rules = (rule.rules ?? []).map(normalizeFormRule).filter((child): child is FormRule => child !== undefined);
    if (rules.length === 0) return undefined;
    if (rules.length === 1) return rules[0];
    return Object.freeze({ kind: rule.kind, rules: Object.freeze(rules) });
  }
  const predicate = rule as FormRulePredicate;
  const fieldKey = typeof predicate.fieldKey === "string" ? predicate.fieldKey.trim().toLowerCase() : "";
  if (!fieldKey || !OPERATORS.has(predicate.operator)) return undefined;
  if (FORM_VALUELESS_OPERATORS.has(predicate.operator)) return Object.freeze({ kind: "predicate" as const, fieldKey, operator: predicate.operator });
  if (FORM_LIST_OPERATORS.has(predicate.operator)) {
    const values = (Array.isArray(predicate.value) ? predicate.value : []).map(scalar).filter((item): item is FormAnswer => item !== undefined);
    if (!values.length) return undefined;
    return Object.freeze({ kind: "predicate" as const, fieldKey, operator: predicate.operator, value: Object.freeze([...new Set(values)]) });
  }
  const value = scalar(predicate.value);
  if (value === undefined || value === "") return undefined;
  return Object.freeze({ kind: "predicate" as const, fieldKey, operator: predicate.operator, value });
}

function walk(rule: FormRule, depth: number, state: { predicates: number; depth: number }, keys: string[]): void {
  state.depth = Math.max(state.depth, depth);
  if (rule.kind === "all" || rule.kind === "any") {
    for (const child of rule.rules) walk(child, depth + 1, state, keys);
    return;
  }
  state.predicates += 1;
  keys.push((rule as FormRulePredicate).fieldKey);
}

/** Every field key a rule reads, in tree order. */
export function formRuleFieldKeys(rule: FormRule | undefined): readonly string[] {
  if (!rule) return [];
  const keys: string[] = [];
  walk(rule, 1, { predicates: 0, depth: 0 }, keys);
  return keys;
}

/**
 * A rule may only read answers the respondent has already been asked for, so
 * `earlier` carries the keys of the fields ordered before the one being checked.
 */
export function validateFormRule(rule: FormRule | undefined, field: FormFieldDefinition, earlier: ReadonlySet<string>): readonly FormValidationIssue[] {
  if (!rule) return [];
  const issues: FormValidationIssue[] = [];
  const name = field.label || field.key;
  const state = { predicates: 0, depth: 0 };
  const keys: string[] = [];
  walk(rule, 1, state, keys);
  if (state.depth > FORM_RULE_MAX_DEPTH) issues.push({ code: "rule_too_deep", fieldKey: field.key, message: `${name} nests its conditions too deeply` });
  if (state.predicates === 0) issues.push({ code: "empty_rule", fieldKey: field.key, message: `${name} has a condition with no comparisons` });
  if (state.predicates > FORM_RULE_MAX_PREDICATES) issues.push({ code: "too_many_rule_predicates", fieldKey: field.key, message: `${name} can compare at most ${FORM_RULE_MAX_PREDICATES} answers` });
  for (const key of keys) {
    if (key === field.key) issues.push({ code: "self_dependency", fieldKey: field.key, message: `${name} cannot depend on itself` });
    else if (!earlier.has(key)) issues.push({ code: "invalid_dependency", fieldKey: field.key, message: `${name} is shown based on a question that does not come before it` });
  }
  return issues;
}

/**
 * Drops every predicate whose field the builder can no longer offer - a deleted
 * question, or one that moved after the question the rule belongs to. Groups
 * left with a single child collapse, and an emptied rule disappears entirely,
 * so a rule never survives referring to something that is not there.
 */
export function filterFormRule(rule: FormRule | undefined, keep: (fieldKey: string) => boolean): FormRule | undefined {
  if (!rule) return undefined;
  if (rule.kind === "all" || rule.kind === "any") {
    const rules = rule.rules.map((child) => filterFormRule(child, keep)).filter((child): child is FormRule => child !== undefined);
    if (rules.length === 0) return undefined;
    if (rules.length === 1) return rules[0];
    return Object.freeze({ kind: rule.kind, rules: Object.freeze(rules) });
  }
  return keep((rule as FormRulePredicate).fieldKey) ? rule : undefined;
}

/** Follows a question through a key rename so its dependants keep pointing at it. */
export function renameFormRuleField(rule: FormRule | undefined, from: string, to: string): FormRule | undefined {
  if (!rule || from === to) return rule;
  if (rule.kind === "all" || rule.kind === "any") {
    return Object.freeze({ kind: rule.kind, rules: Object.freeze(rule.rules.map((child) => renameFormRuleField(child, from, to)!)) });
  }
  const predicate = rule as FormRulePredicate;
  return predicate.fieldKey === from ? Object.freeze({ ...predicate, fieldKey: to }) : rule;
}

/**
 * Re-checks every rule against the questions that now come before it. Ordering,
 * deletion, and renaming all funnel through here so the builder can never save a
 * form whose visibility rules point backwards at nothing.
 */
export function pruneFormRules(fields: readonly FormFieldDefinition[]): readonly FormFieldDefinition[] {
  const earlier = new Set<string>();
  return fields.map((field) => {
    const rule = filterFormRule(field.rule, (fieldKey) => earlier.has(fieldKey));
    const condition = field.condition && earlier.has(field.condition.fieldKey) ? field.condition : undefined;
    earlier.add(field.key);
    if (rule === field.rule && condition === field.condition) return field;
    const { rule: _rule, condition: _condition, ...rest } = field;
    return { ...rest, ...(rule ? { rule } : {}), ...(condition ? { condition } : {}) };
  });
}

/**
 * True when the author started a comparison but never gave it an answer to
 * match. Normalization drops such a predicate, so the builder has to catch it
 * before "only when ..." silently becomes "always asked".
 */
export function formRuleHasIncompletePredicate(rule: FormRule | undefined): boolean {
  if (!rule) return false;
  if (rule.kind === "all" || rule.kind === "any") return rule.rules.some(formRuleHasIncompletePredicate);
  const predicate = rule as FormRulePredicate;
  if (!predicate.fieldKey || !OPERATORS.has(predicate.operator)) return true;
  if (FORM_VALUELESS_OPERATORS.has(predicate.operator)) return false;
  if (FORM_LIST_OPERATORS.has(predicate.operator)) return !Array.isArray(predicate.value) || predicate.value.length === 0;
  return scalar(predicate.value) === undefined || predicate.value === "";
}

/** Plain-English summary used in the builder, e.g. `Metal is Gold and Budget is greater than 50000`. */
export function describeFormRule(rule: FormRule | undefined, labelFor: (fieldKey: string) => string): string {
  if (!rule) return "";
  if (rule.kind === "all" || rule.kind === "any") {
    const parts = rule.rules.map((child) => {
      const text = describeFormRule(child, labelFor);
      return child.kind === "predicate" ? text : `(${text})`;
    });
    return parts.join(rule.kind === "all" ? " and " : " or ");
  }
  const predicate = rule as FormRulePredicate;
  const operator = FORM_OPERATOR_LABELS[predicate.operator];
  if (FORM_VALUELESS_OPERATORS.has(predicate.operator)) return `${labelFor(predicate.fieldKey)} ${operator}`;
  const value = Array.isArray(predicate.value) ? predicate.value.join(", ") : String(predicate.value ?? "");
  return `${labelFor(predicate.fieldKey)} ${operator} ${value}`;
}
