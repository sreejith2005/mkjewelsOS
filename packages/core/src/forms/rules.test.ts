import { describe, expect, it } from "vitest";
import {
  describeFormRule,
  evaluateFormRule,
  filterFormRule,
  formRuleFieldKeys,
  formRuleHasIncompletePredicate,
  isFormFieldVisible,
  normalizeFormAnswers,
  normalizeFormDefinition,
  normalizeFormRule,
  operatorsForFieldType,
  pruneFormRules,
  renameFormRuleField,
  validateCompleteForm,
  validateFormDefinition,
  visibleFormSections,
  type FormFieldDefinition,
  type FormRule,
  type FormRulePredicate,
  type FormTemplateDefinition,
} from "./index";

const opts = (...labels: readonly string[]) => labels.map((label) => ({ value: label.toLowerCase(), label }));
const predicate = (overrides: Partial<FormRulePredicate> & Pick<FormRulePredicate, "fieldKey" | "operator">): FormRulePredicate =>
  ({ kind: "predicate", ...overrides });

const field = (key: string, type: FormFieldDefinition["type"], sortOrder: number, overrides: Partial<FormFieldDefinition> = {}): FormFieldDefinition =>
  ({ key, label: key, type, sortOrder, ...overrides });

const template = (fields: readonly FormFieldDefinition[]): FormTemplateDefinition => ({ name: "Conditional form", fields });

/** The shape the builder produces: a dropdown, then questions gated on its answer. */
const branchingForm = (): FormTemplateDefinition => template([
  field("metal", "select", 0, { options: opts("Gold", "Silver"), required: true }),
  field("karat", "select", 1, { options: opts("18k", "22k"), required: true, rule: predicate({ fieldKey: "metal", operator: "equals", value: "gold" }) }),
  field("polish", "text", 2, { rule: predicate({ fieldKey: "metal", operator: "equals", value: "silver" }) }),
]);

describe("Visibility rule evaluation", () => {
  it("asks a different follow-up question for each option", () => {
    const form = normalizeFormDefinition(branchingForm());
    const shown = (answers: Record<string, string>) => form.fields.filter((item) => isFormFieldVisible(item, answers)).map((item) => item.key);
    expect(shown({})).toEqual(["metal"]);
    expect(shown({ metal: "gold" })).toEqual(["metal", "karat"]);
    expect(shown({ metal: "silver" })).toEqual(["metal", "polish"]);
  });

  it("evaluates every operator the builder offers", () => {
    const answers = { text: "yellow gold", count: 5, tags: ["ready", "urgent"], due: "2026-08-31", blank: "" };
    const check = (rule: FormRulePredicate) => evaluateFormRule(rule, answers);
    expect(check(predicate({ fieldKey: "text", operator: "contains", value: "gold" }))).toBe(true);
    expect(check(predicate({ fieldKey: "text", operator: "not_contains", value: "silver" }))).toBe(true);
    expect(check(predicate({ fieldKey: "tags", operator: "contains", value: "urgent" }))).toBe(true);
    expect(check(predicate({ fieldKey: "tags", operator: "in", value: ["urgent", "later"] }))).toBe(true);
    expect(check(predicate({ fieldKey: "tags", operator: "not_in", value: ["later"] }))).toBe(true);
    expect(check(predicate({ fieldKey: "count", operator: "greater_than", value: 4 }))).toBe(true);
    expect(check(predicate({ fieldKey: "count", operator: "greater_than_or_equal", value: 5 }))).toBe(true);
    expect(check(predicate({ fieldKey: "count", operator: "less_than", value: 5 }))).toBe(false);
    expect(check(predicate({ fieldKey: "count", operator: "less_than_or_equal", value: 5 }))).toBe(true);
    // Dates order lexicographically, which is what the ISO answers rely on.
    expect(check(predicate({ fieldKey: "due", operator: "greater_than", value: "2026-01-01" }))).toBe(true);
    expect(check(predicate({ fieldKey: "due", operator: "less_than", value: "2026-01-01" }))).toBe(false);
    expect(check(predicate({ fieldKey: "blank", operator: "is_empty" }))).toBe(true);
    expect(check(predicate({ fieldKey: "missing", operator: "is_empty" }))).toBe(true);
    expect(check(predicate({ fieldKey: "text", operator: "not_empty" }))).toBe(true);
  });

  it("refuses to order values it cannot compare", () => {
    expect(evaluateFormRule(predicate({ fieldKey: "name", operator: "greater_than", value: 3 }), { name: "abc" })).toBe(false);
    expect(evaluateFormRule(predicate({ fieldKey: "name", operator: "less_than", value: 3 }), {})).toBe(false);
  });

  it("combines comparisons with all and any", () => {
    const rule: FormRule = { kind: "any", rules: [
      { kind: "all", rules: [predicate({ fieldKey: "metal", operator: "equals", value: "gold" }), predicate({ fieldKey: "budget", operator: "greater_than", value: 50000 })] },
      predicate({ fieldKey: "vip", operator: "equals", value: true }),
    ] };
    expect(evaluateFormRule(rule, { metal: "gold", budget: 60000 })).toBe(true);
    expect(evaluateFormRule(rule, { metal: "gold", budget: 10000 })).toBe(false);
    expect(evaluateFormRule(rule, { metal: "silver", budget: 10000, vip: true })).toBe(true);
  });
});

describe("Visibility rule normalization", () => {
  it("drops predicates with nothing to compare and collapses single-child groups", () => {
    expect(normalizeFormRule({ kind: "all", rules: [
      predicate({ fieldKey: "metal", operator: "equals", value: "gold" }),
      predicate({ fieldKey: "karat", operator: "equals", value: "" }),
    ] })).toEqual(predicate({ fieldKey: "metal", operator: "equals", value: "gold" }));
    expect(normalizeFormRule({ kind: "all", rules: [] })).toBeUndefined();
  });

  it("keeps list operators as a deduplicated list and strips the value from empty checks", () => {
    expect(normalizeFormRule(predicate({ fieldKey: "metal", operator: "in", value: ["gold", "gold", "silver"] })))
      .toEqual(predicate({ fieldKey: "metal", operator: "in", value: ["gold", "silver"] }));
    expect(normalizeFormRule(predicate({ fieldKey: "metal", operator: "not_empty", value: "ignored" })))
      .toEqual(predicate({ fieldKey: "metal", operator: "not_empty" }));
  });

  it("keeps a rule through the definition normalizer and prefers it over a legacy condition", () => {
    const normalized = normalizeFormDefinition(template([
      field("metal", "select", 0, { options: opts("Gold") }),
      field("karat", "text", 1, {
        rule: predicate({ fieldKey: "metal", operator: "equals", value: "gold" }),
        condition: { fieldKey: "metal", operator: "not_empty" },
      }),
    ]));
    expect(normalized.fields[1]?.rule).toEqual(predicate({ fieldKey: "metal", operator: "equals", value: "gold" }));
    expect(normalized.fields[1]?.condition).toBeUndefined();
  });

  it("rejects a rule that reads a question the respondent has not reached", () => {
    const issues = validateFormDefinition(normalizeFormDefinition(template([
      field("karat", "text", 0, { rule: predicate({ fieldKey: "metal", operator: "equals", value: "gold" }) }),
      field("metal", "select", 1, { options: opts("Gold") }),
    ])));
    expect(issues.map((issue) => issue.code)).toContain("invalid_dependency");
  });

  it("rejects a rule that reads its own answer", () => {
    const issues = validateFormDefinition(normalizeFormDefinition(template([
      field("metal", "select", 0, { options: opts("Gold") }),
      field("karat", "text", 1, { rule: predicate({ fieldKey: "karat", operator: "not_empty" }) }),
    ])));
    expect(issues.map((issue) => issue.code)).toContain("self_dependency");
  });

  it("flags a half-finished comparison instead of quietly dropping it", () => {
    expect(formRuleHasIncompletePredicate(predicate({ fieldKey: "metal", operator: "equals", value: "" }))).toBe(true);
    expect(formRuleHasIncompletePredicate(predicate({ fieldKey: "metal", operator: "in", value: [] }))).toBe(true);
    expect(formRuleHasIncompletePredicate(predicate({ fieldKey: "metal", operator: "is_empty" }))).toBe(false);
    expect(formRuleHasIncompletePredicate(undefined)).toBe(false);
  });
});

describe("Builder edits keep rules pointing somewhere", () => {
  it("drops a rule whose question was deleted or moved after it", () => {
    const kept = pruneFormRules([
      field("metal", "select", 0, { options: opts("Gold") }),
      field("karat", "text", 1, { rule: predicate({ fieldKey: "metal", operator: "equals", value: "gold" }) }),
    ]);
    expect(kept[1]?.rule).toBeDefined();
    const reordered = pruneFormRules([
      field("karat", "text", 0, { rule: predicate({ fieldKey: "metal", operator: "equals", value: "gold" }) }),
      field("metal", "select", 1, { options: opts("Gold") }),
    ]);
    expect(reordered[0]?.rule).toBeUndefined();
  });

  it("prunes only the comparisons that broke", () => {
    const rule: FormRule = { kind: "all", rules: [
      predicate({ fieldKey: "metal", operator: "equals", value: "gold" }),
      predicate({ fieldKey: "gone", operator: "not_empty" }),
    ] };
    expect(filterFormRule(rule, (key) => key === "metal")).toEqual(predicate({ fieldKey: "metal", operator: "equals", value: "gold" }));
    expect(filterFormRule(rule, () => false)).toBeUndefined();
  });

  it("follows a renamed question so its dependants keep their condition", () => {
    const renamed = renameFormRuleField(predicate({ fieldKey: "field_1", operator: "equals", value: "gold" }), "field_1", "metal");
    expect(formRuleFieldKeys(renamed)).toEqual(["metal"]);
  });

  it("reads back as plain English for the builder summary", () => {
    const summary = describeFormRule({ kind: "all", rules: [
      predicate({ fieldKey: "metal", operator: "equals", value: "gold" }),
      predicate({ fieldKey: "budget", operator: "greater_than_or_equal", value: 50000 }),
    ] }, (key) => key === "metal" ? "Metal" : "Budget");
    expect(summary).toBe("Metal is gold and Budget is at least 50000");
  });

  it("offers operators that suit the answer being read", () => {
    expect(operatorsForFieldType("number")).toContain("greater_than");
    expect(operatorsForFieldType("number")).not.toContain("contains");
    expect(operatorsForFieldType("multiselect")).toContain("contains");
    expect(operatorsForFieldType("checkbox")).toEqual(["equals", "not_equals"]);
  });
});

describe("Hidden questions are never required and never stored", () => {
  it("skips validation and submission for a question the answers hid", () => {
    const form = normalizeFormDefinition(branchingForm());
    const result = validateCompleteForm(form, { metal: "silver", polish: "high" });
    expect(result.valid).toBe(true);
    expect(normalizeFormAnswers(form, { metal: "silver", polish: "high", karat: "22k" })).toEqual({ metal: "silver", polish: "high" });
  });

  it("still requires the follow-up the answers did reveal", () => {
    const form = normalizeFormDefinition(branchingForm());
    expect(validateCompleteForm(form, { metal: "gold" }).issues.map((issue) => issue.code)).toContain("required");
  });

  it("hides a question inside a reached section", () => {
    const form = normalizeFormDefinition({
      name: "Sectioned",
      sections: [{ key: "section_1", title: "Basics" }, { key: "section_2", title: "Details" }],
      fields: [
        field("metal", "select", 0, { sectionKey: "section_1", options: opts("Gold", "Silver") }),
        field("karat", "text", 1, { sectionKey: "section_2", rule: predicate({ fieldKey: "metal", operator: "equals", value: "gold" }) }),
        field("notes", "text", 2, { sectionKey: "section_2" }),
      ],
    });
    const keys = (answers: Record<string, string>) => visibleFormSections(form, answers).flatMap((entry) => entry.fields.map((item) => item.key));
    expect(keys({ metal: "gold" })).toEqual(["metal", "karat", "notes"]);
    expect(keys({ metal: "silver" })).toEqual(["metal", "notes"]);
  });
});
