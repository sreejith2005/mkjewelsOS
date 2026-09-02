import { describe, expect, it } from "vitest";
import {
  FORM_FIELD_TYPES,
  checkFormPublishability,
  evaluateFormCondition,
  evaluateFormRule,
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

const opts = (...labels: readonly string[]) => labels.map((label) => ({ value: label.trim(), label: label.trim() }));

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
      options: ["select", "multiselect", "radio"].includes(type) ? opts("One") : undefined,
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
      field("select", { key: "same", options: opts("A", "A") }),
      field("divider", { key: "same", sortOrder: 3, required: true, options: opts("bad"), validation: { min: 2, max: 1 } }),
    ]));
    expect(new Set(issues.map((issue) => issue.code))).toEqual(expect.objectContaining(new Set(["invalid_options", "duplicate_key", "invalid_order", "unexpected_options", "layout_required", "invalid_validation"])));
  });

  it("canonicalizes option whitespace and rejects duplicates after trimming", () => {
    expect(normalizeFormDefinition(template([field("select", { options: opts(" Option ", "Other") })])).fields[0]?.options).toEqual(opts("Option", "Other"));
    expect(validateFormDefinition(template([field("select", { options: opts("Option", " Option ") })]))).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid_options" })]));
  });

  it("accepts stable options on checkbox questions without requiring legacy checkboxes to have options", () => {
    expect(validateFormDefinition(template([field("checkbox", { options: opts("Repair", "Cleaning") })]))).toEqual([]);
    expect(validateFormDefinition(template([field("checkbox")]))).toEqual([]);
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

  it("allows a file field to be drafted and published", () => {
    const draft = template([field("file")]);
    expect(validateFormDefinition(draft)).toEqual([]);
    expect(checkFormPublishability(draft).valid).toBe(true);
  });
});

describe("Forms visibility and answer validation", () => {
  it("evaluates nested universal rules without evaluating code", () => {
    const rule = {
      kind: "all" as const,
      rules: [
        { kind: "predicate" as const, fieldKey: "call_status", operator: "in" as const, value: ["connected", "ringing"] },
        { kind: "any" as const, rules: [
          { kind: "predicate" as const, fieldKey: "interest", operator: "equals" as const, value: "interested" },
          { kind: "predicate" as const, fieldKey: "follow_up", operator: "not_empty" as const },
        ] },
      ],
    };
    expect(evaluateFormRule(rule, { call_status: "connected", interest: "interested" })).toBe(true);
    expect(evaluateFormRule(rule, { call_status: "connected", interest: "lost" })).toBe(false);
  });

  it("supports universal negative and numeric comparisons", () => {
    expect(evaluateFormRule({ kind: "predicate", fieldKey: "attempt", operator: "greater_than_or_equal", value: 3 }, { attempt: 3 })).toBe(true);
    expect(evaluateFormRule({ kind: "predicate", fieldKey: "status", operator: "not_in", value: ["closed", "lost"] }, { status: "active" })).toBe(true);
    expect(evaluateFormRule({ kind: "predicate", fieldKey: "remark", operator: "is_empty" }, { remark: "" })).toBe(true);
  });
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

  it("keeps optionless legacy checkbox boolean validation", () => {
    expect(validateFormField(field("checkbox", { required: true }), false, {} as const)?.code).toBe("required");
    expect(validateFormField(field("checkbox", { required: true }), true, {} as const)).toBeUndefined();
  });

  it("validates option-backed checkbox questions as multi-answer arrays", () => {
    const checkbox = field("checkbox", { required: true, options: opts("Repair", "Cleaning") });
    expect(validateFormField(checkbox, [], {})?.code).toBe("required");
    expect(validateFormField(checkbox, ["Repair", "Cleaning"], {})).toBeUndefined();
    expect(validateFormField(checkbox, ["Repair", "Repair"], {})?.code).toBe("invalid_shape");
    expect(validateFormField(checkbox, ["Unknown"], {})?.code).toBe("invalid_option");
    expect(validateFormField(checkbox, true, {})?.code).toBe("invalid_shape");
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
    expect(validateFormField(field("select", { options: opts("A") }), "B", {})?.code).toBe("invalid_option");
    expect(validateFormField(field("radio", { options: opts("A") }), "A", {})).toBeUndefined();
    expect(validateFormField(field("multiselect", { options: opts("A", "B") }), ["A", "C"], {})?.code).toBe("invalid_option");
  });

  it.each(["text", "email", "phone", "select", "date", "datetime", "user_dropdown", "branch_dropdown", "department_dropdown"] as const)("rejects a whitespace-only required %s value", (type) => {
    const options = type === "select" ? { options: opts("Option") } : {};
    expect(validateFormField(field(type, { required: true, ...options }), "   ", {})?.code).toBe("required");
  });

  it("validates calendar dates strictly, including leap years", () => {
    expect(validateFormField(field("date"), "2024-02-29", {})).toBeUndefined();
    expect(validateFormField(field("date"), "2026-02-29", {})?.code).toBe("invalid_date");
    expect(validateFormField(field("date"), "2026-02-30", {})?.code).toBe("invalid_date");
    expect(validateFormField(field("datetime"), "2026-02-30T12:30:00Z", {})?.code).toBe("invalid_datetime");
  });

  it("enforces scalar, array, and boolean shapes", () => {
    expect(validateFormField(field("text"), ["x"], {})?.code).toBe("invalid_shape");
    expect(validateFormField(field("number"), "1", {})?.code).toBe("invalid_shape");
    expect(validateFormField(field("checkbox"), "true", {})?.code).toBe("invalid_shape");
    expect(validateFormField(field("checkbox", { options: opts("A") }), true, {})?.code).toBe("invalid_shape");
    expect(validateFormField(field("multiselect", { options: opts("A") }), "A", {})?.code).toBe("invalid_shape");
  });

  it("rejects unknown answer keys", () => {
    const result = validateCompleteForm(template([field("text")]), { field_text: "ok", unexpected: "no" });
    expect(result.issues.map((issue) => issue.code)).toContain("unknown_answer");
  });

  it("evaluates conditions against earlier normalized answers", () => {
    const fields = [
      field("text", { key: "source" }),
      field("text", { key: "detail", sortOrder: 1, required: true, condition: { fieldKey: "source", operator: "equals", value: "Show" } }),
    ];
    expect(validateCompleteForm(template(fields), { source: " Show " }).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "required", fieldKey: "detail" })]));
  });
});

describe("Forms answer normalization and formatting", () => {
  it("drops hidden and empty answers, trims values, converts numbers, and deduplicates arrays", () => {
    const fields = [
      field("number", { key: "amount" }),
      field("text", { key: "hidden", sortOrder: 1, condition: { fieldKey: "amount", operator: "equals", value: 2 } }),
      field("multiselect", { key: "choices", sortOrder: 2, options: opts("A", "B") }),
    ];
    expect(normalizeFormAnswers(template(fields), { amount: "0", hidden: "secret", choices: [" A ", "A", "B"] })).toEqual({ amount: 0, choices: ["A", "B"] });
  });

  it("normalizes sequentially before evaluating later conditions", () => {
    const fields = [
      field("text", { key: "source" }),
      field("text", { key: "detail", sortOrder: 1, condition: { fieldKey: "source", operator: "equals", value: "Show" } }),
    ];
    expect(normalizeFormAnswers(template(fields), { source: " Show ", detail: " kept " })).toEqual({ source: "Show", detail: "kept" });
  });

  it("formats from stable keys without storing a label-keyed duplicate", () => {
    const rows = formatFormSubmission([
      field("currency", { key: "amount" }),
      field("checkbox", { key: "confirmed", sortOrder: 1 }),
      field("checkbox", { key: "services", sortOrder: 2, options: [{ value: "repair", label: "Repair" }, { value: "clean", label: "Cleaning" }] }),
    ], { amount: 1250, confirmed: true, services: ["repair", "clean"] });
    expect(rows.map((row) => [row.key, row.label, row.value])).toEqual([
      ["amount", "currency", expect.stringContaining("1,250")],
      ["confirmed", "checkbox", "Yes"],
      ["services", "checkbox", "Repair, Cleaning"],
    ]);
  });
});
