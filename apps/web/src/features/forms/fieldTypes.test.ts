import { describe, expect, it } from "vitest";
import type { FormFieldDefinition } from "@jewelos/core";
import { convertFormFieldType, pruneOptionValueReferences } from "./fieldTypes";

const fields = (...items: FormFieldDefinition[]) => items;
const field = (key: string, type: FormFieldDefinition["type"], overrides: Partial<FormFieldDefinition> = {}): FormFieldDefinition => ({
  key, label: key, type, sortOrder: 0, sectionKey: "section_1", ...overrides,
});

describe("safe form field type conversion", () => {
  it("removes branches and dependent predicates when an option is deleted", () => {
    const input = fields(
      field("metal", "checkbox", { options: [{ value: "gold", label: "Gold" }], branches: [{ operator: "contains", value: "silver", targetSectionKey: "section_2" }] }),
      field("follow_up", "text", { rule: { kind: "any", rules: [
        { kind: "predicate", fieldKey: "metal", operator: "contains", value: "silver" },
        { kind: "predicate", fieldKey: "metal", operator: "contains", value: "gold" },
      ] } }),
    );
    const result = pruneOptionValueReferences(input, "metal", new Set(["gold"]));
    expect(result[0]?.branches).toBeUndefined();
    expect(result[1]?.rule).toEqual({ kind: "predicate", fieldKey: "metal", operator: "contains", value: "gold" });
  });

  it("initializes a valid stable option when converting text to dropdown", () => {
    const result = convertFormFieldType(fields(field("source", "text")), 0, "select");
    expect(result.fields[0]).toEqual(expect.objectContaining({
      key: "source", type: "select", options: [{ value: "option_1", label: "Option 1" }],
    }));
    expect(result.cleared).toEqual([]);
  });

  it("removes incompatible options, branches, and dependent guided routes when converting dropdown to text", () => {
    const result = convertFormFieldType(fields(
      field("source", "select", { options: [{ value: "yes", label: "Yes" }], branches: [{ operator: "equals", value: "yes", targetSectionKey: "section_2" }] }),
      field("detail", "text", { sortOrder: 1, rule: { kind: "predicate", fieldKey: "source", operator: "equals", value: "yes" } }),
    ), 0, "text");
    expect(result.fields[0]).toEqual(expect.not.objectContaining({ options: expect.anything() }));
    expect(result.fields[0]).toEqual(expect.not.objectContaining({ branches: expect.anything() }));
    expect(result.fields[1]).toEqual(expect.not.objectContaining({ rule: expect.anything() }));
    expect(result.cleared).toEqual(expect.arrayContaining(["options", "routing"]));
  });

  it("preserves option ids and rewrites single-answer routes when converting radio to checkbox and back", () => {
    const input = fields(
      field("source", "radio", { options: [{ value: "yes", label: "Yes" }], branches: [{ operator: "equals", value: "yes", targetSectionKey: "section_2" }] }),
      field("detail", "text", { sortOrder: 1, rule: { kind: "predicate", fieldKey: "source", operator: "equals", value: "yes" } }),
    );
    const checkbox = convertFormFieldType(input, 0, "checkbox");
    expect(checkbox.fields[0]?.options).toEqual([{ value: "yes", label: "Yes" }]);
    expect(checkbox.fields[0]?.branches?.[0]?.operator).toBe("contains");
    expect(checkbox.fields[1]?.rule).toEqual(expect.objectContaining({ operator: "contains" }));

    const radio = convertFormFieldType(checkbox.fields, 0, "radio");
    expect(radio.fields[0]?.branches?.[0]?.operator).toBe("equals");
    expect(radio.fields[1]?.rule).toEqual(expect.objectContaining({ operator: "equals" }));
  });

  it("converts historical multiselect to checkbox without losing options", () => {
    const result = convertFormFieldType(fields(field("legacy", "multiselect", { options: [{ value: "a", label: "A" }] })), 0, "checkbox");
    expect(result.fields[0]).toEqual(expect.objectContaining({ type: "checkbox", options: [{ value: "a", label: "A" }] }));
  });
});
