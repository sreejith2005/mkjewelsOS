import { describe, expect, it } from "vitest";
import {
  FORM_FIELD_TYPES,
  checkFormPublishability,
  evaluateFormCondition,
  formatFormSubmission,
  isEmptyFormValue,
  isFormFieldVisible,
  normalizeFormAnswers,
  normalizeFormDefinition,
  validateCompleteForm,
  validateFormDefinition,
  validateFormField,
  type FormFieldDefinition,
  type FormTemplateDefinition,
} from "./index";

const field = (type: FormFieldDefinition["type"], overrides: Partial<FormFieldDefinition> = {}): FormFieldDefinition => ({
  key: `field_${type}`,
  label: type,
  type,
  sortOrder: 0,
  ...overrides,
});

const template = (fields: readonly FormFieldDefinition[]): FormTemplateDefinition => ({ name: "Synthetic form", fields });

describe("Forms definition contract", () => {
  it("publishes every supported Phase 4A field type", () => {
    const fields = FORM_FIELD_TYPES.map((type, sortOrder) => field(type, {
      key: `field_${sortOrder}`,
      sortOrder,
      options: ["One"] && (["select", "multiselect", "radio"].includes(type) ? ["One"] : undefined),
    }));
    expect(checkFormPublishability(template(fields))).toEqual({ valid: true, issues: [] });
  });

  it("normalizes immutably and orders deterministically", () => {
    const input = template([field("text", { key: " second ", label: " Second ", sortOrder: 9 }), field("text", { key: "first", label: "First", sortOrder: 2 })]);
    const result = normalizeFormDefinition(input);
    expect(result.fields.map((item) => [item.key, item.sortOrder])).toEqual([["first", 0], ["second", 1]]);
    expect(result).not.toBe(input);
    expect(result.fields[0]).not.toBe(input.fields[1]);
    expect(Object.isFrozen(result.fields)).toBe(true);
  });

  it("rejects duplicate keys, gaps, invalid options, layout requirements, and invalid bounds", () => {
    const issues = validateFormDefinition(template([
      field("select", { key: "same", options: ["A", "A"] }),
      field("divider", { key: "same", sortOrder: 3, required: true, options: ["bad"], validation: { min: 2, max: 1 } }),
    ]));
    expect(new Set(issues.map((issue) => issue.code))).toEqual(expect.objectContaining(new Set(["invalid_options", "duplicate_key", "invalid_order", "unexpected_options", "layout_required", "invalid_validation"])));
  });

  it("rejects missing, forward, and self dependencies, which also prevents cycles", () => {
    const issues = validateFormDefinition(template([
      field("text", { key: "a", condition: { fieldKey: "b", operator: "equals", value: "yes" } }),
      field("text", { key: "b", sortOrder: 1, condition: { fieldKey: "b", operator: "not_empty" } }),
    ]));
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["invalid_dependency", "self_dependency"]));
  });

  it("rejects empty and oversized definitions", () => {
    expect(checkFormPublishability(template([])).issues.map((issue) => issue.code)).toContain("empty_form");
    expect(validateFormDefinition({ name: "", description: "x".repeat(2001), fields: Array.from({ length: 101 }, (_, index) => field("text", { key: `f_${index}`, sortOrder: index })) }).map((issue) => issue.code)).toEqual(expect.arrayContaining(["invalid_name", "invalid_description", "too_many_fields"]));
  });

  it("allows a file placeholder in a draft but rejects publication", () => {
    const draft = template([field("file")]);
    expect(validateFormDefinition(draft)).toEqual([]);
    expect(checkFormPublishability(draft).issues.map((issue) => issue.code)).toContain("file_storage_deferred");
  });
});

describe("Forms visibility and answer validation", () => {
  it.each([
    [{ fieldKey: "source", operator: "equals" as const, value: "yes" }, { source: "yes" }, true],
    [{ fieldKey: "source", operator: "not_equals" as const, value: "no" }, { source: "yes" }, true],
    [{ fieldKey: "source", operator: "contains" as const, value: "ell" }, { source: "hello" }, true],
    [{ fieldKey: "source", operator: "contains" as const, value: "A" }, { source: ["A", "B"] }, true],
    [{ fieldKey: "source", operator: "not_empty" as const }, { source: 0 }, true],
  ])("evaluates conditional operator %#", (condition, answers, expected) => {
    expect(evaluateFormCondition(condition, answers)).toBe(expected);
  });

  it("treats zero and false as non-empty while empty strings and arrays are empty", () => {
    expect([isEmptyFormValue(0), isEmptyFormValue(false), isEmptyFormValue(""), isEmptyFormValue([])]).toEqual([false, false, true, true]);
  });

  it("does not require hidden fields", () => {
    const conditional = field("text", { key: "detail", required: true, condition: { fieldKey: "show", operator: "equals", value: true } });
    expect(isFormFieldVisible(conditional, { show: false })).toBe(false);
    expect(validateFormField(conditional, undefined, { show: false })).toBeUndefined();
  });

  it("requires a required checkbox to be true", () => {
    expect(validateFormField(field("checkbox", { required: true }), false, {} as const)?.code).toBe("required");
    expect(validateFormField(field("checkbox", { required: true }), true, {} as const)).toBeUndefined();
  });

  it("accepts numerical zero and validates numeric and rating bounds", () => {
    expect(validateFormField(field("number", { validation: { min: 0 } }), 0, {})).toBeUndefined();
    expect(validateFormField(field("currency", { validation: { min: 1 } }), 0, {})?.code).toBe("minimum");
    expect(validateFormField(field("rating"), 6, {})?.code).toBe("invalid_rating");
  });

  it("validates email, phone, date, datetime, select, radio, and multiselect values", () => {
    expect(validateFormField(field("email"), "bad", {})?.code).toBe("invalid_email");
    expect(validateFormField(field("phone"), "12", {})?.code).toBe("invalid_phone");
    expect(validateFormField(field("date"), "not-date", {})?.code).toBe("invalid_date");
    expect(validateFormField(field("datetime"), "2026-08-08", {})?.code).toBe("invalid_datetime");
    expect(validateFormField(field("select", { options: ["A"] }), "B", {})?.code).toBe("invalid_option");
    expect(validateFormField(field("radio", { options: ["A"] }), "A", {})).toBeUndefined();
    expect(validateFormField(field("multiselect", { options: ["A", "B"] }), ["A", "C"], {})?.code).toBe("invalid_option");
  });

  it("enforces scalar, array, and boolean shapes", () => {
    expect(validateFormField(field("text"), ["x"], {})?.code).toBe("invalid_shape");
    expect(validateFormField(field("number"), "1", {})?.code).toBe("invalid_shape");
    expect(validateFormField(field("checkbox"), "true", {})?.code).toBe("invalid_shape");
    expect(validateFormField(field("multiselect", { options: ["A"] }), "A", {})?.code).toBe("invalid_shape");
  });

  it("rejects unknown answer keys", () => {
    const result = validateCompleteForm(template([field("text")]), { field_text: "ok", unexpected: "no" });
    expect(result.issues.map((issue) => issue.code)).toContain("unknown_answer");
  });
});

describe("Forms answer normalization and formatting", () => {
  it("drops hidden and empty answers, trims values, converts numbers, and deduplicates arrays", () => {
    const fields = [
      field("number", { key: "amount" }),
      field("text", { key: "hidden", sortOrder: 1, condition: { fieldKey: "amount", operator: "equals", value: 2 } }),
      field("multiselect", { key: "choices", sortOrder: 2, options: ["A", "B"] }),
    ];
    expect(normalizeFormAnswers(template(fields), { amount: "0", hidden: "secret", choices: [" A ", "A", "B"] })).toEqual({ amount: 0, choices: ["A", "B"] });
  });

  it("formats from stable keys without storing a label-keyed duplicate", () => {
    const rows = formatFormSubmission([field("currency", { key: "amount" }), field("checkbox", { key: "confirmed", sortOrder: 1 })], { amount: 1250, confirmed: true });
    expect(rows.map((row) => [row.key, row.label, row.value])).toEqual([["amount", "currency", expect.stringContaining("1,250")], ["confirmed", "checkbox", "Yes"]]);
  });
});
